import 'server-only';

import { kickDocumentWorker } from '@/features/documents/server/kick';
import {
  getJobDocuments,
  type DocumentRevisionRead
} from '@/features/documents/server/queries';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentType
} from '@/features/documents/types';
import { runCommand } from '@/lib/backend/command';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ReadTool
} from '../registry';
import { resolveJobReference } from './resolve-job';

/**
 * The documents the app itself produces - the quotation & contract pack and
 * the ROI report - as opposed to the files people upload, which are
 * list_job_files / search_files.
 *
 * Both tools sit on the machinery the Documents card already uses:
 *
 *   JOB_DOCUMENTS     the read model: current revision per type plus history,
 *                     with job visibility applied in the handler.
 *   DOCUMENT_GENERATE the command: it QUEUES a revision and returns. Rendering
 *                     happens in the worker, in its own transaction, from a
 *                     frozen snapshot.
 *
 * Two things follow that the model must say honestly, and the descriptions
 * make it say them. Generating is not instant - the answer after a confirmed
 * generation is "queued", never "here is the document". And a generation never
 * rewrites anything: a Ready revision is immutable because an email sent last
 * week points at exactly those bytes, so a regeneration makes a NEW revision
 * and supersedes the old one.
 */

const READ_ENFORCED =
  'app.read_job_documents via the read registry (JOB_DOCUMENTS; job visibility applied in the handler)';
const WRITE_ENFORCED =
  'app.cmd_document_generate via public.execute_command - roles and job assignment are the database’s; the worker re-checks its claim';

const jobInput = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .describe(
    'The job: its reference (e.g. SS-ABCD-0001), its id from find_job, or a customer name that identifies one job'
  );

const typeInput = z
  .enum(DOCUMENT_TYPES)
  .describe(
    'QuotationContract (the quotation & contract pack) or ROI (the ROI report). Omit for both.'
  );

/** What each status means to somebody waiting for a PDF. */
const STATUS_MEANING: Record<string, string> = {
  Queued: 'asked for, waiting to be rendered',
  Generating: 'being rendered now',
  Ready: 'stored and ready to open',
  Failed: 'stopped with a reason; a retry makes a new revision',
  Superseded: 'replaced by a later revision; the file is kept'
};

const revisionForModel = (r: DocumentRevisionRead) => ({
  revision: r.revision_number,
  status: r.status,
  what_that_means: STATUS_MEANING[r.status] ?? null,
  requested_at: r.requested_at,
  generated_at: r.generated_at,
  filename: r.filename,
  pages: r.page_count,
  error_code: r.error_code,
  error: r.error_detail?.message ?? null,
  attempts: r.attempt_count,
  next_attempt: r.next_attempt,
  // Only a stored revision has bytes behind it. Anything else has no link,
  // rather than a link that 404s.
  open_url: r.evidence_id ? `/api/evidence/${r.evidence_id}` : null,
  download_url: r.evidence_id
    ? `/api/evidence/${r.evidence_id}?download=1`
    : null
});

// -- Read ---------------------------------------------------------------------

export const getGeneratedDocumentsTool: ReadTool<{
  job: string;
  document_type?: DocumentType;
}> = {
  name: 'get_generated_documents',
  summary:
    'List the documents the app generates for a job (quotation pack, ROI)',
  description:
    "The customer documents THIS APP produces for a job - the Quotation & Contract pack and the ROI report - with the current revision of each, its status (Queued, Generating, Ready, Failed, Superseded), when it was generated, and Open / Download links when it is Ready. Also returns the earlier revisions, because a regeneration supersedes rather than replaces. Use it for 'has the quotation pack been generated', 'is the contract ready to send', 'why did the ROI fail'. For files PEOPLE uploaded - signed contracts, photos, delivery notes - use list_job_files instead.",
  domain: 'documents',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    document_type: typeInput.optional()
  }),
  authorization: {
    // JOB_DOCUMENTS is gated by ROLE in app.read_registry and there is no
    // permission code that stands in for it, so the coarse pre-check names the
    // same roles. The read re-decides it whatever this says.
    permissions: [],
    roles: ['Admin', 'Manager', 'Director', 'Office', 'Surveyor', 'Finance'],
    enforcedBy: READ_ENFORCED
  },

  async execute({ job, document_type }) {
    const resolved = await resolveJobReference(job);
    if (!resolved.ok) return resolved.result;

    const read = await getJobDocuments(resolved.jobId);
    if (!read.ok) {
      return {
        ok: false,
        code: read.error.code,
        message: read.error.message
      };
    }
    const data = read.data;
    if (data.is_historical_import) {
      return {
        ok: false,
        code: 'HISTORICAL_IMPORT',
        message: `${data.job_reference} is an imported historical record. The app does not generate customer documents for imported records - whatever the previous system produced would be on file as an uploaded document, so try list_job_files.`
      };
    }

    const documents = data.documents.filter(
      (d) => !document_type || d.document_type === document_type
    );

    return {
      ok: true,
      data: {
        job_ref: data.job_reference,
        has_presale: data.has_presale,
        documents: documents.map((d) => ({
          document: DOCUMENT_TYPE_LABELS[d.document_type],
          document_type: d.document_type,
          current: d.current ? revisionForModel(d.current) : null,
          earlier_revisions: d.history.map(revisionForModel)
        })),
        note: !data.has_presale
          ? 'This job has no presale recorded, so there is nothing to generate a document from.'
          : documents.every((d) => !d.current)
            ? 'Nothing has been generated for this job yet.'
            : undefined,
        how_to_open:
          'Staff open a document with the Open or Download link (open_url / download_url); each link works for 60 seconds, so do not paste them as permanent links.',
        regeneration_note:
          'A regeneration never rewrites a stored revision. It creates a new one and marks the old one Superseded - the old file is kept, because anything already emailed points at exactly those bytes.'
      }
    };
  }
};

// -- Mutation -----------------------------------------------------------------

interface GenerateInput {
  job: string;
  document_type?: DocumentType;
}

export const generateDocumentPackTool: MutationTool<GenerateInput> = {
  name: 'generate_document_pack',
  summary: 'Generate or regenerate a job’s quotation pack or ROI report',
  description:
    "Ask the app to generate a job's customer documents - the Quotation & Contract pack, the ROI report, or both (the default). Use it when nothing has been generated yet, when a generation Failed and the reason has been fixed, or when the quote has changed and the customer documents need to catch up. Generating QUEUES the work: after they confirm, say it is queued and being rendered, never that the document is ready - they check with get_generated_documents. It never rewrites a stored revision: each generation is a NEW revision that supersedes the old one, and the old file is kept because anything already emailed points at it. Nothing is sent to the customer; generating a document emails no one.",
  domain: 'documents',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    document_type: typeInput.optional()
  }),
  authorization: {
    permissions: [],
    roles: ['Admin', 'Manager', 'Director', 'Office', 'Surveyor'],
    enforcedBy: WRITE_ENFORCED
  },

  async prepare({ job, document_type }) {
    const resolved = await resolveJobReference(job);
    if (!resolved.ok) {
      const r = resolved.result;
      return r.ok
        ? { ok: false, code: 'NOT_FOUND', message: 'No job matched.' }
        : { ok: false, code: r.code, message: r.message };
    }

    const read = await getJobDocuments(resolved.jobId);
    if (!read.ok) {
      return { ok: false, code: read.error.code, message: read.error.message };
    }
    const data = read.data;
    // Refuse here, not at execute. Showing somebody a confirmation card for
    // something the command will reject is a worse answer than saying so now.
    if (data.is_historical_import) {
      return {
        ok: false,
        code: 'HISTORICAL_IMPORT',
        message: `${data.job_reference} is an imported historical record. The app does not generate customer documents for imported records.`
      };
    }
    if (!data.has_presale) {
      return {
        ok: false,
        code: 'PRESALE_NOT_FOUND',
        message: `${data.job_reference} has no presale recorded. A customer document is generated from the quote, so there is nothing to generate from yet.`
      };
    }

    const wanted = data.documents.filter(
      (d) => !document_type || d.document_type === document_type
    );
    const changes: ActionPreview['changes'] = wanted.map((d) => ({
      label: DOCUMENT_TYPE_LABELS[d.document_type],
      from: d.current
        ? `Revision ${d.current.revision_number} (${d.current.status})`
        : 'Never generated',
      to: d.current
        ? `New revision ${d.current.revision_number + 1}, queued`
        : 'Revision 1, queued'
    }));
    if (changes.length === 0) {
      return {
        ok: false,
        code: 'NO_DOCUMENT_TYPE',
        message:
          'That document type is not one this job has. Ask for the quotation pack, the ROI report, or both.'
      };
    }

    const inFlight = wanted.filter(
      (d) =>
        d.current &&
        (d.current.status === 'Queued' || d.current.status === 'Generating')
    );

    return {
      ok: true,
      preview: {
        title:
          document_type === undefined
            ? 'Generate the customer documents'
            : `Generate the ${DOCUMENT_TYPE_LABELS[document_type]}`,
        summary: `${data.job_reference}: this queues the work from the current quote. Rendering happens in the background - it will not be ready the moment they confirm.`,
        changes,
        warnings: [
          'Any existing revision is KEPT and marked Superseded, not overwritten. Anything already emailed still points at the file it was sent with.',
          'Nothing is sent to the customer. Generating a document emails no one.',
          ...(inFlight.length > 0
            ? [
                `${inFlight
                  .map((d) => DOCUMENT_TYPE_LABELS[d.document_type])
                  .join(
                    ' and '
                  )} is already being generated. Confirming asks for another revision on top of it.`
              ]
            : [])
        ],
        confirmLabel: 'Generate',
        // A generation inserts a revision; there is no existing row whose
        // version could go stale, so there is nothing to quote back.
        expectedVersion: null
      }
    };
  },

  async execute({ job, document_type }, ctx: MutationContext) {
    const resolved = await resolveJobReference(job);
    if (!resolved.ok) return resolved.result;

    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'DOCUMENT_GENERATE',
      job_id: resolved.jobId,
      payload: {
        ...(document_type ? { document_type } : {}),
        // Provenance the Documents screen already understands.
        source: 'assistant'
      }
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }

    // Start the work now, exactly as the Generate button does. A failure to
    // start is not a failure to queue: the rows are committed, and the stall
    // sweep picks up anything this process does not finish.
    await kickDocumentWorker();

    const result = response.result as {
      revisions?: {
        document_type: DocumentType;
        revision_number: number;
        status: string;
      }[];
    };
    return {
      ok: true,
      data: {
        job_ref: resolved.jobRef,
        queued: (result.revisions ?? []).map((r) => ({
          document: DOCUMENT_TYPE_LABELS[r.document_type] ?? r.document_type,
          revision: r.revision_number,
          status: r.status
        })),
        note: 'Queued and being rendered. It is not ready yet - check with get_generated_documents. Nothing has been sent to the customer.'
      }
    };
  }
};

export const DOCUMENT_READ_TOOLS = [getGeneratedDocumentsTool];
export const DOCUMENT_MUTATION_TOOLS = [generateDocumentPackTool];
