import 'server-only';

import { createDataClient } from '@/lib/supabase/data';
import type {
  BrowseResult,
  FileDetails,
  FileRow,
  FileScope,
  FileSort,
  FolderRow,
  JobIndexResult,
  SearchResult,
  SortDirection
} from './types';

// Reads for the file manager. Every one of them is a SECURITY DEFINER database
// function that resolves the signed-in person itself and returns only what
// that person may see - the same rule (app.can_read_evidence /
// app.can_read_folder) that drives the table policy, the storage policy and
// SimpleBot. None of them ever returns a storage path: documents open through
// /api/evidence/<id>, which authorizes again and signs a 60-second URL.
//
// Paging and filtering happen in the database. No caller loads the filing
// hierarchy into the browser to search it.

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

type Json = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' ? v : null;
const bool = (v: unknown): boolean => v === true;

function toFile(raw: Json): FileRow {
  const location = raw.location as Json | undefined;
  return {
    id: String(raw.id),
    name: str(raw.name) ?? 'File',
    scope: (raw.scope === 'Library' ? 'Library' : 'Job') as FileScope,
    jobId: str(raw.job_id),
    folderId: str(raw.folder_id),
    category: str(raw.category) ?? 'Other',
    mimeType: str(raw.mime_type),
    sizeBytes: numOrNull(raw.size_bytes),
    addedAt: str(raw.added_at),
    addedByName: str(raw.added_by_name),
    modifiedAt: str(raw.modified_at) ?? str(raw.added_at),
    filingVersion: num(raw.filing_version),
    trashedAt: str(raw.trashed_at),
    trashedByName: str(raw.trashed_by_name),
    originalLocation: str(raw.original_location),
    evidenceLocked: bool(raw.evidence_locked),
    taskId: str(raw.task_id),
    issueId: str(raw.issue_id),
    submissionId: str(raw.submission_id),
    workPackageId: str(raw.work_package_id),
    canOpen: bool(raw.can_open),
    jobRef: str(raw.job_ref),
    customerName: str(raw.customer_name),
    postcode: str(raw.postcode),
    recordClass: str(raw.record_class),
    ...(location
      ? {
          location: {
            scope: (location.scope === 'Library'
              ? 'Library'
              : 'Job') as FileScope,
            jobId: str(location.job_id),
            jobRef: str(location.job_ref),
            folderId: str(location.folder_id),
            folderPath: str(location.folder_path)
          }
        }
      : {})
  };
}

const toFolder = (raw: Json): FolderRow => ({
  id: String(raw.id),
  name: str(raw.name) ?? 'Folder',
  parentId: str(raw.parent_id),
  version: num(raw.version),
  depth: num(raw.depth),
  updatedAt: str(raw.updated_at),
  trashedAt: str(raw.trashed_at),
  trashedByName: str(raw.trashed_by_name),
  originalLocation: str(raw.original_location),
  folderCount: num(raw.folder_count),
  fileCount: num(raw.file_count)
});

const rows = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

/** The refusal a read can produce, as staff wording. */
function readFailure(error: { code?: string; message: string }, what: string) {
  if (error.code !== 'P0001')
    console.error(`${what} failed`, error.code, error.message);
  return null;
}

export interface BrowseRequest {
  scope: FileScope;
  jobId?: string | null;
  folderId?: string | null;
  view?: 'folder' | 'trash';
  q?: string | null;
  sort?: FileSort;
  dir?: SortDirection;
  limit?: number;
  offset?: number;
}

/** public.file_browse: one folder's contents, or the scope's trash. */
export async function browseFiles(
  request: BrowseRequest
): Promise<BrowseResult | null> {
  const payload: Json = { scope: request.scope };
  if (request.jobId) payload.job_id = request.jobId;
  if (request.folderId) payload.folder_id = request.folderId;
  if (request.view && request.view !== 'folder') payload.view = request.view;
  if (request.q) payload.q = request.q.slice(0, 120);
  if (request.sort) payload.sort = request.sort;
  if (request.dir) payload.dir = request.dir;
  if (request.limit !== undefined) payload.limit = request.limit;
  if (request.offset) payload.offset = request.offset;

  const { data, error } = await (
    await client()
  ).rpc('file_browse', { p_request: payload });
  if (error) return readFailure(error, 'file_browse');

  const raw = (data ?? {}) as Json;
  const job = raw.job as Json | null;
  const folder = raw.folder as Json | null;
  return {
    scope: (raw.scope === 'Library' ? 'Library' : 'Job') as FileScope,
    view: raw.view === 'trash' ? 'trash' : 'folder',
    job: job
      ? {
          id: String(job.id),
          jobRef: str(job.job_ref) ?? '',
          customerName: str(job.customer_name),
          workflowStage: str(job.workflow_stage),
          recordClass: str(job.record_class)
        }
      : null,
    folder: folder
      ? {
          id: String(folder.id),
          name: str(folder.name) ?? 'Folder',
          parentId: str(folder.parent_id),
          version: num(folder.version)
        }
      : null,
    breadcrumbs: rows(raw.breadcrumbs).map((b) => ({
      id: String(b.id),
      name: str(b.name) ?? 'Folder'
    })),
    canManage: bool(raw.can_manage),
    canPurge: bool(raw.can_purge),
    sort: (str(raw.sort) ?? 'name') as FileSort,
    dir: raw.dir === 'desc' ? 'desc' : 'asc',
    q: str(raw.q),
    folders: rows(raw.folders).map(toFolder),
    files: rows(raw.files).map(toFile),
    totalFiles: num(raw.total_files),
    limit: num(raw.limit),
    offset: num(raw.offset)
  };
}

export interface FileSearchRequest {
  q?: string | null;
  scope?: FileScope | null;
  jobId?: string | null;
  category?: string | null;
  from?: string | null;
  to?: string | null;
  trashed?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * public.file_search: across every job and the library, with the folder each
 * result sits in so a result can say where it lives and open in place.
 */
export async function searchFiles(
  request: FileSearchRequest
): Promise<SearchResult | null> {
  const payload: Json = {};
  if (request.q) payload.q = request.q.slice(0, 120);
  if (request.scope) payload.scope = request.scope;
  if (request.jobId) payload.job_id = request.jobId;
  if (request.category) payload.category = request.category;
  if (request.from) payload.from = request.from;
  if (request.to) payload.to = request.to;
  if (request.trashed) payload.trashed = true;
  if (request.limit !== undefined) payload.limit = request.limit;
  if (request.offset) payload.offset = request.offset;

  const { data, error } = await (
    await client()
  ).rpc('file_search', { p_request: payload });
  if (error) return readFailure(error, 'file_search');

  const raw = (data ?? {}) as Json;
  return {
    total: num(raw.total),
    limit: num(raw.limit),
    offset: num(raw.offset),
    q: str(raw.q),
    trashed: bool(raw.trashed),
    files: rows(raw.files).map(toFile)
  };
}

/** public.file_job_index: the jobs whose documents this person can reach. */
export async function listFileJobs(request: {
  q?: string | null;
  limit?: number;
  offset?: number;
}): Promise<JobIndexResult | null> {
  const payload: Json = {};
  if (request.q) payload.q = request.q.slice(0, 120);
  if (request.limit !== undefined) payload.limit = request.limit;
  if (request.offset) payload.offset = request.offset;

  const { data, error } = await (
    await client()
  ).rpc('file_job_index', { p_request: payload });
  if (error) return readFailure(error, 'file_job_index');

  const raw = (data ?? {}) as Json;
  return {
    total: num(raw.total),
    limit: num(raw.limit),
    offset: num(raw.offset),
    canReadLibrary: bool(raw.can_read_library),
    canManageLibrary: bool(raw.can_manage_library),
    jobs: rows(raw.jobs).map((j) => ({
      jobId: String(j.job_id),
      jobRef: str(j.job_ref) ?? '',
      customerName: str(j.customer_name),
      postcode: str(j.postcode),
      workflowStage: str(j.workflow_stage),
      recordClass: str(j.record_class),
      fileCount: num(j.file_count)
    }))
  };
}

/** public.file_details: one document, where it lives and what has happened to it. */
export async function getFileDetails(
  fileId: string
): Promise<FileDetails | null> {
  const { data, error } = await (
    await client()
  ).rpc('file_details', { p_request: { file_id: fileId } });
  if (error) return readFailure(error, 'file_details');

  const raw = (data ?? {}) as Json;
  const file = (raw.file ?? {}) as Json;
  const location = (raw.location ?? {}) as Json;
  return {
    file: {
      ...toFile(file),
      uploadedFilename: str(file.uploaded_filename),
      uploadStatus: str(file.upload_status) ?? 'Uploaded',
      openUrl: str(file.open_url) ?? `/api/evidence/${String(file.id)}`,
      downloadUrl:
        str(file.download_url) ?? `/api/evidence/${String(file.id)}?download=1`
    },
    location: {
      scope: (location.scope === 'Library' ? 'Library' : 'Job') as FileScope,
      jobId: str(location.job_id),
      jobRef: str(location.job_ref),
      folderId: str(location.folder_id),
      folderPath: str(location.folder_path),
      customerName: str(location.customer_name),
      recordClass: str(location.record_class)
    },
    canManage: bool(raw.can_manage),
    canPurge: bool(raw.can_purge),
    evidenceLocked: bool(raw.evidence_locked),
    taskTitle: str(raw.task_title),
    history: rows(raw.history).map((h) => ({
      action: str(h.action) ?? '',
      at: str(h.at),
      byName: str(h.by_name),
      service: str(h.service),
      from: str(h.from),
      to: str(h.to),
      reason: str(h.reason)
    }))
  };
}
