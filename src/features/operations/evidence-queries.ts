import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

// Evidence reads, as the signed-in person may see them. Both database
// functions decide visibility from the evidence rows (app.can_read_evidence:
// job assignment, allocated work, category) and never return a storage path.
// Files open through /api/evidence/<id>, which authorizes again and issues a
// one-minute signed link.

export type EvidenceScope =
  | { job_id: string }
  | { task_id: string }
  | { work_package_id: string };

export type EvidenceItem = {
  id: string;
  job_id: string;
  task_id: string | null;
  work_package_id: string | null;
  issue_id?: string | null;
  category: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  upload_status: string;
  added_at: string | null;
  added_by_name: string | null;
  task_title: string | null;
  current: boolean | null;
  can_open: boolean;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

const client = async () => (await createDataClient()) as unknown as RpcClient;

/** public.list_evidence: the files of one job, task or work package. */
export async function getEvidence(
  scope: EvidenceScope
): Promise<EvidenceItem[] | null> {
  const { data, error } = await (
    await client()
  ).rpc('list_evidence', { p_request: scope });
  if (error) {
    if (error.code !== 'P0001')
      console.error('list_evidence failed', error.code, error.message);
    return null;
  }
  return (data as { evidence?: EvidenceItem[] } | null)?.evidence ?? [];
}

// -- Files library ------------------------------------------------------------

export const EVIDENCE_SEARCH_MAX = 200;

export interface EvidenceSearchRequest {
  /** Customer name, job reference, postcode or filename (partial). */
  q?: string;
  category?: string;
  job_id?: string;
  /** 'YYYY-MM-DD', inclusive. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface EvidenceSearchFile {
  id: string;
  job_id: string;
  job_ref: string;
  workflow_stage: string | null;
  customer_name: string | null;
  postcode: string | null;
  category: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  added_at: string | null;
  added_by_name: string | null;
  task_id: string | null;
  task_title: string | null;
  issue_id: string | null;
  submission_id: string | null;
  work_package_id: string | null;
  context_type: string | null;
}

export interface EvidenceSearchResult {
  total: number;
  limit: number;
  offset: number;
  files: EvidenceSearchFile[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the keys the function accepts, with blanks and malformed values left out. */
export function evidenceSearchPayload(
  request: EvidenceSearchRequest
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const q = request.q?.trim().slice(0, 120);
  if (q) out.q = q;
  if (request.category?.trim()) out.category = request.category.trim();
  if (request.job_id && UUID.test(request.job_id)) out.job_id = request.job_id;
  if (request.from && DATE.test(request.from)) out.from = request.from;
  if (request.to && DATE.test(request.to)) out.to = request.to;
  if (request.limit !== undefined)
    out.limit = Math.min(
      Math.max(Math.trunc(request.limit) || 1, 1),
      EVIDENCE_SEARCH_MAX
    );
  if (request.offset !== undefined && request.offset > 0)
    out.offset = Math.trunc(request.offset);
  return out;
}

/** public.search_evidence: authorized search across every job's files. */
export async function searchEvidence(
  request: EvidenceSearchRequest
): Promise<
  { ok: true; result: EvidenceSearchResult } | { ok: false; message: string }
> {
  const { data, error } = await (
    await client()
  ).rpc('search_evidence', { p_request: evidenceSearchPayload(request) });
  if (error) {
    if (error.code !== 'P0001')
      console.error('search_evidence failed', error.code, error.message);
    return {
      ok: false,
      message:
        error.code === 'P0001'
          ? 'That search is not valid. Check the dates and try again.'
          : 'Files could not be loaded. Refresh to try again.'
    };
  }
  const result = data as Partial<EvidenceSearchResult> | null;
  return {
    ok: true,
    result: {
      total: result?.total ?? 0,
      limit: result?.limit ?? 50,
      offset: result?.offset ?? 0,
      files: result?.files ?? []
    }
  };
}
