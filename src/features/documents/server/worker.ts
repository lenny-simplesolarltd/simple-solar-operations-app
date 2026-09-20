import 'server-only';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { renderDocument } from '../render/render';
import { TEMPLATE_DIRS, TEMPLATE_VERSIONS } from '../render/regions';
import { resolveDocument, type DocumentSource } from '../resolve';
import {
  GENERATION_ERRORS,
  GenerationError,
  type DocumentType
} from '../types';

// The generation worker.
//
// It is deliberately thin. Every decision about WHETHER work should happen -
// which revision is due, how many attempts remain, whether the job is a
// historical import, whether a Ready revision may be replaced - belongs to the
// database, exactly as the outbox and command batches do. This claims work,
// runs the renderer, puts the bytes somewhere and reports back.
//
// Three properties it has to keep:
//
//   Idempotent. A claimed revision is already Generating with its attempt
//     counted, so a crashed pass is recovered by the stall sweep rather than
//     duplicated. Reporting Ready twice is answered as a replay.
//   Concurrency safe. `document_revision_claim` takes rows `for update skip
//     locked`, so two workers running at once take disjoint sets and neither
//     waits.
//   Harmless on failure. Nothing here writes to the job, the presale, an
//     earlier revision or a communication. A failure marks one row and stops.

const BUCKET = 'evidence';

export type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
  storage: {
    from: (bucket: string) => {
      uploadToSignedUrl?: unknown;
      upload: (
        path: string,
        body: Uint8Array | Buffer,
        options?: { contentType?: string; upsert?: boolean }
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

interface ClaimedSource {
  presale: {
    id: string;
    submitted_at: string;
    design: Record<string, unknown>;
    design_schema_version: number;
    catalogue_version: string;
    system_kwp: number | string;
    net_panels: number;
    agreed_price_pence: number | string;
  };
  job: { id: string; reference: string; is_historical_import: boolean };
  customer: {
    first_name: string;
    last_name: string;
    address_line1: string;
    address_line2: string | null;
    town: string;
    postcode: string;
    email: string | null;
    phone: string | null;
  };
  salesperson: {
    display_name: string | null;
    email: string | null;
    phone: string | null;
  };
  settings: { electricity_inflation_pct: number; seg_inflates: boolean };
}

interface Claimed {
  revision_id: string;
  job_id: string;
  job_reference: string;
  document_type: DocumentType;
  revision_number: number;
  attempt: number;
  source: ClaimedSource;
}

export interface WorkerReport {
  claimed: number;
  generated: number;
  failed: number;
  releasedStalled: number;
  results: {
    revisionId: string;
    documentType: DocumentType;
    status: 'Ready' | 'Failed';
    code?: string;
    message?: string;
  }[];
}

/**
 * Failures that will fail identically next time.
 *
 * A missing consumption figure or an incomplete design is a fact about the
 * presale, not a transient fault: retrying it five times only delays the
 * person who has to go and fix it. Everything else - a storage blip, an
 * unexpected exception - is worth another go.
 */
const PERMANENT: readonly string[] = [
  GENERATION_ERRORS.INCOMPLETE_DESIGN,
  GENERATION_ERRORS.MISSING_CONSUMPTION,
  GENERATION_ERRORS.MISSING_GENERATION_FORECAST,
  GENERATION_ERRORS.UNRESOLVED_VARIABLE,
  GENERATION_ERRORS.HISTORICAL_IMPORT,
  GENERATION_ERRORS.MASTER_CHANGED,
  GENERATION_ERRORS.REGION_OVERFLOW
];

const masterShaCache = new Map<DocumentType, string>();

async function masterSha256(documentType: DocumentType): Promise<string> {
  const cached = masterShaCache.get(documentType);
  if (cached) return cached;
  const root = process.env.DOCUMENT_TEMPLATE_ROOT || process.cwd();
  const bytes = await readFile(
    path.join(root, TEMPLATE_DIRS[documentType], 'master.pdf')
  );
  const sha = createHash('sha256').update(bytes).digest('hex');
  masterShaCache.set(documentType, sha);
  return sha;
}

/** `SS-WDDG-5412-Quotation-Contract-R1.pdf` - meaningful, and safe to store. */
export function documentFilename(
  jobReference: string,
  documentType: DocumentType,
  revisionNumber: number
): string {
  const label =
    documentType === 'QuotationContract' ? 'Quotation-Contract' : 'ROI';
  const reference = jobReference.replace(/[^A-Za-z0-9-]+/g, '-');
  return `${reference}-${label}-R${revisionNumber}.pdf`;
}

function toSource(claimed: Claimed, generatedAt: Date): DocumentSource {
  const s = claimed.source;
  return {
    job: {
      id: s.job.id,
      reference: s.job.reference,
      isHistoricalImport: s.job.is_historical_import
    },
    customer: {
      firstName: s.customer.first_name,
      lastName: s.customer.last_name,
      addressLine1: s.customer.address_line1,
      addressLine2: s.customer.address_line2,
      town: s.customer.town,
      postcode: s.customer.postcode,
      email: s.customer.email,
      phone: s.customer.phone
    },
    salesperson: {
      displayName: s.salesperson.display_name ?? '',
      email: s.salesperson.email,
      phone: s.salesperson.phone
    },
    presale: {
      id: s.presale.id,
      submittedAt: s.presale.submitted_at,
      // The design is replayed exactly as the presale froze it.
      design: s.presale.design as never,
      designSchemaVersion: s.presale.design_schema_version,
      catalogueVersion: s.presale.catalogue_version,
      systemKwp: Number(s.presale.system_kwp),
      netPanels: Number(s.presale.net_panels),
      agreedPricePence: Number(s.presale.agreed_price_pence)
    },
    settings: {
      electricityInflationPct: Number(s.settings.electricity_inflation_pct),
      segInflates: Boolean(s.settings.seg_inflates)
    },
    generatedAt,
    generatedByPersonId: null
  };
}

async function generateOne(
  client: RpcClient,
  claimed: Claimed
): Promise<WorkerReport['results'][number]> {
  const { revision_id: revisionId, document_type: documentType } = claimed;

  try {
    const sha = await masterSha256(documentType);
    const { input } = resolveDocument(
      documentType,
      toSource(claimed, new Date()),
      sha
    );
    const rendered = await renderDocument(input);

    const filename = documentFilename(
      claimed.job_reference,
      documentType,
      claimed.revision_number
    );

    // The database hands back where the bytes go, because the path carries the
    // evidence id and only the database mints that.
    const begun = await client.rpc('document_revision_begin_upload', {
      p_revision_id: revisionId,
      p_filename: filename
    });
    if (begun.error) throw new Error(begun.error.message);
    const slot = begun.data as { storage_path: string };

    const upload = await client.storage
      .from(BUCKET)
      .upload(slot.storage_path, Buffer.from(rendered.bytes), {
        contentType: 'application/pdf',
        // A retry of the same revision writes to the same path; the revision
        // is not Ready yet, so nothing has been handed to anyone.
        upsert: true
      });
    if (upload.error) throw new Error(`storage: ${upload.error.message}`);

    const contentSha = createHash('sha256')
      .update(rendered.bytes)
      .digest('hex');
    const inputSha = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');

    const ready = await client.rpc('document_revision_ready', {
      p_revision_id: revisionId,
      p_content_sha256: contentSha,
      p_page_count: rendered.pageCount,
      p_input_snapshot: input,
      p_input_sha256: inputSha,
      p_template_version: TEMPLATE_VERSIONS[documentType],
      p_master_sha256: sha,
      p_omitted_pages: rendered.omittedPages
    });
    if (ready.error) throw new Error(ready.error.message);

    return { revisionId, documentType, status: 'Ready' };
  } catch (error) {
    const failure =
      error instanceof GenerationError
        ? error.toFailure()
        : {
            code: GENERATION_ERRORS.RENDER_FAILED,
            message: (error as Error).message
          };

    await client.rpc('document_revision_failed', {
      p_revision_id: revisionId,
      p_error_code: failure.code,
      p_error_detail: {
        message: failure.message,
        ...('unresolved' in failure && failure.unresolved
          ? { unresolved: failure.unresolved }
          : {})
      },
      p_retryable: !PERMANENT.includes(failure.code)
    });

    return {
      revisionId,
      documentType,
      status: 'Failed',
      code: failure.code,
      message: failure.message
    };
  }
}

/**
 * One pass: claim what is due and generate it.
 *
 * Called two ways - straight after a person asks for a document, so it starts
 * at once, and from a recovery endpoint that mops up anything a crashed pass
 * left behind.
 */
export async function runDocumentWorker(
  client: RpcClient,
  limit = 5
): Promise<WorkerReport> {
  const { data, error } = await client.rpc('document_revision_claim', {
    p_limit: limit
  });
  if (error) throw new Error(`document_revision_claim: ${error.message}`);

  const payload = data as { claimed: Claimed[]; released_stalled: number };
  const claimed = payload.claimed ?? [];

  // Sequential on purpose: each pass embeds fonts and rasterises a 24-page
  // master, and a server with four of those in flight is a server that has
  // stopped answering anything else.
  const results: WorkerReport['results'] = [];
  for (const one of claimed) results.push(await generateOne(client, one));

  return {
    claimed: claimed.length,
    generated: results.filter((r) => r.status === 'Ready').length,
    failed: results.filter((r) => r.status === 'Failed').length,
    releasedStalled: payload.released_stalled ?? 0,
    results
  };
}
