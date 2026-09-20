import 'server-only';

import { searchVisibleJobs } from '@/features/jobs/server/search';
import {
  EVIDENCE_GROUPS,
  evidenceGroupCategories,
  evidenceGroupKey,
  evidenceGroupLabel,
  type EvidenceGroupKey
} from '@/features/operations/evidence-groups';
import {
  getEvidence,
  searchEvidence,
  type EvidenceSearchFile
} from '@/features/operations/evidence-queries';
import { evidenceCategoryLabel } from '@/features/operations/evidence-rules';
import { z } from 'zod';
import type { FileCardData } from '../../protocol';
import type { ReadTool, ToolResult } from '../registry';

// SimpleBot's read-only view of stored files (contracts, photos,
// commissioning records, delivery notes, ...): the SAME database functions the
// job Files tab and the Files library use (public.list_evidence,
// public.search_evidence), under the signed-in person's session. They decide
// what this person may see (app.can_read_evidence) and never return a storage
// path; the model only ever gets /api/evidence/<id> links, which authorize
// again and open a one-minute signed URL.

const ENFORCED =
  'public.list_evidence / public.search_evidence (app.can_read_evidence; no storage paths); session-bound client; /api/evidence/<id> re-checks on open';

const CATEGORY_CODES = EVIDENCE_GROUPS.flatMap((g) => [...g.categories]) as [
  string,
  ...string[]
];
const GROUP_KEYS = EVIDENCE_GROUPS.map((g) => g.key) as [
  EvidenceGroupKey,
  ...EvidenceGroupKey[]
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_REF = /^SS-[A-Z0-9]{2,8}-\d{2,6}$/;

/** At most this many files reach the model per call. */
const MODEL_LIMIT = 40;
const CARD_LIMIT = 12;

const jobInput = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .describe(
    'The job: its reference (e.g. SS-ABCD-0001), its id from find_job, or a customer name or postcode that identifies one job'
  );
const categoryInput = z
  .enum(CATEGORY_CODES)
  .describe(
    'Only files of this category: Contract (signed contract), CustomerDetails, FinanceAgreement, TaskEvidence, Progress / Completion (install photos), Variation, Return, Commissioning, Problem, DeliveryNote, Other'
  );
const groupInput = z
  .enum(GROUP_KEYS)
  .describe(
    "Only files in this group: contracts, customer-finance, task, photos (progress, completion, variation and return-visit photos), commissioning, issues, materials (delivery notes), other. Use 'photos' for 'what photos are on this job'."
  );

type FileLike = {
  id: string;
  category: string;
  issue_id?: string | null;
  filename: string | null;
  added_at: string | null;
  added_by_name: string | null;
  task_title: string | null;
  job_id?: string | null;
  job_ref?: string | null;
  customer_name?: string | null;
  folder_path?: string | null;
};

const fileForModel = (f: FileLike, withJob: boolean) => ({
  filename: f.filename ?? 'File',
  category: evidenceCategoryLabel(f.category),
  category_code: f.category,
  group: evidenceGroupLabel(evidenceGroupKey(f)),
  added_at: f.added_at,
  added_by: f.added_by_name,
  task_title: f.task_title,
  // Where staff would look for it, so an answer can say where it lives.
  folder: f.folder_path ?? 'Top level',
  ...(withJob
    ? {
        job_id: f.job_id ?? null,
        job_ref: f.job_ref ?? null,
        customer: f.customer_name ?? null
      }
    : {}),
  open_url: `/api/evidence/${f.id}`,
  download_url: `/api/evidence/${f.id}?download=1`
});

const fileCard = (f: FileLike): FileCardData => ({
  id: f.id,
  filename: f.filename ?? 'File',
  category: evidenceCategoryLabel(f.category),
  group: evidenceGroupLabel(evidenceGroupKey(f)),
  addedAt: f.added_at,
  addedBy: f.added_by_name,
  jobId: f.job_id ?? null,
  jobRef: f.job_ref ?? null
});

const HOW_TO_OPEN =
  'Staff open a file with the Open or Download link on the card (open_url / download_url); each link works for 60 seconds, so do not paste them as permanent links. Files are sorted newest first.';

type JobResolution =
  | { ok: true; jobId: string; jobRef: string | null }
  | { ok: false; result: ToolResult };

/**
 * A job the signed-in person can see, from an id, a reference, or a name /
 * postcode that matches exactly one job (the same search find_job uses).
 */
async function resolveJob(job: string): Promise<JobResolution> {
  if (UUID.test(job)) return { ok: true, jobId: job, jobRef: null };
  const { hits } = await searchVisibleJobs(job);
  const exact = hits.filter(
    (h) => h.jobRef.toUpperCase() === job.toUpperCase()
  );
  const match =
    exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (match) return { ok: true, jobId: match.id, jobRef: match.jobRef };
  if (hits.length > 1)
    return {
      ok: false,
      result: {
        ok: false,
        code: 'AMBIGUOUS_JOB',
        message: `"${job}" matches ${hits.length} jobs (${hits
          .slice(0, 5)
          .map((h) => `${h.jobRef} ${h.customerName}`)
          .join('; ')}). Ask which one, or use find_job.`
      }
    };
  return {
    ok: false,
    result: {
      ok: false,
      code: 'NOT_FOUND',
      message:
        'No job the signed-in staff member can see matched. It may not exist, or they may not have access to it.'
    }
  };
}

function fileResult(
  title: string,
  files: FileLike[],
  total: number,
  withJob: boolean,
  extra: Record<string, unknown>
): ToolResult {
  return {
    ok: true,
    data: {
      ...extra,
      total,
      files: files.slice(0, MODEL_LIMIT).map((f) => fileForModel(f, withJob)),
      truncated: total > Math.min(files.length, MODEL_LIMIT) || undefined,
      how_to_open: HOW_TO_OPEN,
      visibility_note:
        'Only files this staff member may see are listed; other files may exist. An empty list does not prove a document was never received - say it is not on file for them.'
    },
    display: {
      kind: 'file_list',
      title,
      total,
      files: files.slice(0, CARD_LIMIT).map(fileCard)
    }
  };
}

export const listJobFilesTool: ReadTool<{
  job: string;
  category?: string;
  group?: EvidenceGroupKey;
}> = {
  name: 'list_job_files',
  summary: 'List the files stored on a job (contracts, photos, documents)',
  description:
    "List the stored files on ONE job - signed contracts, customer and finance documents, task evidence, install photos, commissioning records, problem photos, delivery notes - with category, group, who added it and when, and Open / Download links. Use it for 'where is the signed contract for SS-XXXX', 'does this customer have a signed contract', 'what photos are on this job', 'show me the commissioning PDF', 'has the delivery note been uploaded'. Pass the job reference, the job id, or the customer name; narrow with category or group. The latest file is first. It lists stored files only; the app does not generate documents.",
  domain: 'evidence',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    category: categoryInput.optional(),
    group: groupInput.optional()
  }),
  authorization: { permissions: [], enforcedBy: ENFORCED },
  async execute({ job, category, group }) {
    const resolved = await resolveJob(job);
    let jobId: string;
    let jobRef: string | null;
    let files: FileLike[];
    if (resolved.ok) {
      jobId = resolved.jobId;
      jobRef = resolved.jobRef;
      const items = await getEvidence({ job_id: jobId });
      if (items === null)
        return {
          ok: false,
          code: 'NOT_FOUND',
          message:
            'The files of that job could not be read: it may not exist, or this staff member may not have access to it.'
        };
      // Only stored files can be opened; pending uploads are not files yet.
      files = items.filter((e) => e.can_open);
    } else {
      // Someone who cannot see the job itself (an installer) may still see
      // the files of their own allocated work on it.
      const ref = job.toUpperCase();
      if (resolved.result.ok || !JOB_REF.test(ref)) return resolved.result;
      const search = await searchEvidence({ q: ref, limit: 200 });
      const hits = search.ok
        ? search.result.files.filter((f) => f.job_ref === ref)
        : [];
      if (hits.length === 0) return resolved.result;
      jobId = hits[0].job_id;
      jobRef = ref;
      files = hits;
    }
    const filtered = files.filter(
      (f) =>
        (!category || f.category === category) &&
        (!group || evidenceGroupKey(f) === group)
    );
    const label = jobRef ?? 'this job';
    return fileResult(
      `Files · ${label}${group ? ` · ${evidenceGroupLabel(group)}` : category ? ` · ${evidenceCategoryLabel(category)}` : ''}`,
      filtered,
      filtered.length,
      false,
      {
        job_id: jobId,
        job_ref: jobRef,
        filter: { category: category ?? null, group: group ?? null },
        note:
          filtered.length === 0
            ? files.length === 0
              ? 'No stored files on this job that this staff member can see.'
              : 'No stored file of that kind on this job that this staff member can see; other kinds of file exist.'
            : undefined
      }
    );
  }
};

export const searchFilesTool: ReadTool<{
  query?: string;
  category?: string;
  group?: EvidenceGroupKey;
  job?: string;
}> = {
  name: 'search_files',
  summary: 'Search stored files across jobs (Files & documents)',
  description:
    "Search the stored files across every job this staff member can see (the Files & documents library): by customer name, job reference, postcode or filename, and/or by category or group. Returns the newest matches with job reference, customer, category, who added it and when, and Open / Download links. Use it for 'find the delivery note for Smith', 'latest commissioning PDF', 'contracts uploaded this week', or when the staff member names a customer rather than a job. For one known job prefer list_job_files.",
  domain: 'evidence',
  kind: 'read',
  status: 'available',
  inputSchema: z
    .strictObject({
      query: z
        .string()
        .trim()
        .min(2)
        .max(120)
        .optional()
        .describe(
          'Customer name, job reference, postcode or part of a filename'
        ),
      category: categoryInput.optional(),
      group: groupInput.optional(),
      job: jobInput.optional()
    })
    .refine((v) => v.query || v.category || v.group || v.job, {
      message: 'Give a search, a category, a group or a job.'
    }),
  authorization: { permissions: [], enforcedBy: ENFORCED },
  async execute({ query, category, group, job }) {
    let jobId: string | undefined;
    let q = query;
    if (job) {
      const resolved = await resolveJob(job);
      if (resolved.ok) jobId = resolved.jobId;
      else if (!q)
        q = job; // matched against job reference, customer, postcode
      else return resolved.result;
    }
    // One search per category: a group with several categories is searched
    // for each and merged, newest first.
    const categories = category
      ? [category]
      : group
        ? [...evidenceGroupCategories(group)]
        : [undefined];
    const results = await Promise.all(
      categories.map((c) =>
        searchEvidence({ q, category: c, job_id: jobId, limit: MODEL_LIMIT })
      )
    );
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok)
      return { ok: false, code: 'SEARCH_FAILED', message: failed.message };
    let files: EvidenceSearchFile[] = results.flatMap((r) =>
      r.ok ? r.result.files : []
    );
    let total = results.reduce((n, r) => n + (r.ok ? r.result.total : 0), 0);
    if (group === 'issues' && !category) {
      // Any file raised against an issue belongs to Issues too.
      const all = await searchEvidence({ q, job_id: jobId, limit: 200 });
      if (all.ok) {
        const extra = all.result.files.filter(
          (f) => f.issue_id && f.category !== 'Problem'
        );
        files = files.concat(extra);
        total += extra.length;
      }
    }
    files.sort((a, b) => (b.added_at ?? '').localeCompare(a.added_at ?? ''));
    return fileResult(
      q ? `Files matching “${q}”` : 'Files',
      files,
      total,
      true,
      {
        query: q ?? null,
        filter: {
          category: category ?? null,
          group: group ?? null,
          job_id: jobId ?? null
        },
        note:
          files.length === 0
            ? 'No stored file this staff member can see matched.'
            : undefined
      }
    );
  }
};

export const FILE_TOOLS = [listJobFilesTool, searchFilesTool];
