// The shapes the file manager reads from the database. They mirror what
// public.file_browse, public.file_search, public.file_details and
// public.file_job_index return; nothing here is a source of truth.

/** Where in the filing hierarchy something lives. */
export type FileScope = 'Job' | 'Library';

export interface FileLocation {
  scope: FileScope;
  /** Null for a company document. */
  jobId: string | null;
  jobRef?: string | null;
  /** Null means the top level of the job or of the library. */
  folderId: string | null;
  folderPath?: string | null;
}

export interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  /** Quote it back on a rename / move / trash so a stale tab cannot win. */
  version: number;
  depth: number;
  updatedAt: string | null;
  trashedAt: string | null;
  trashedByName: string | null;
  /** Where it was before it went to the trash. */
  originalLocation: string | null;
  folderCount: number;
  fileCount: number;
}

export interface FileRow {
  id: string;
  /** What staff called it; falls back to the uploaded file name. */
  name: string;
  scope: FileScope;
  jobId: string | null;
  folderId: string | null;
  category: string;
  mimeType: string | null;
  sizeBytes: number | null;
  addedAt: string | null;
  addedByName: string | null;
  modifiedAt: string | null;
  /** Quote it back on a rename / move / trash. */
  filingVersion: number;
  trashedAt: string | null;
  trashedByName: string | null;
  originalLocation?: string | null;
  /**
   * A task, work package, submission or issue relies on this document, so it
   * can be filed but never deleted. The database refuses either way; this is
   * what lets the menu say so instead of failing late.
   */
  evidenceLocked: boolean;
  taskId: string | null;
  issueId: string | null;
  submissionId: string | null;
  workPackageId: string | null;
  canOpen: boolean;
  /** Search results only: where the document lives. */
  location?: FileLocation;
  jobRef?: string | null;
  customerName?: string | null;
  postcode?: string | null;
  recordClass?: string | null;
}

export interface Breadcrumb {
  id: string;
  name: string;
}

export interface BrowseJob {
  id: string;
  jobRef: string;
  customerName: string | null;
  workflowStage: string | null;
  recordClass: string | null;
}

export interface BrowseResult {
  scope: FileScope;
  view: 'folder' | 'trash';
  job: BrowseJob | null;
  folder: {
    id: string;
    name: string;
    parentId: string | null;
    version: number;
  } | null;
  breadcrumbs: Breadcrumb[];
  /** Server-decided. The UI uses it to offer actions, never to authorize them. */
  canManage: boolean;
  canPurge: boolean;
  sort: FileSort;
  dir: SortDirection;
  q: string | null;
  folders: FolderRow[];
  files: FileRow[];
  totalFiles: number;
  limit: number;
  offset: number;
}

export type FileSort = 'name' | 'modified' | 'size' | 'category';
export type SortDirection = 'asc' | 'desc';
export type FileView = 'list' | 'grid';

export interface JobIndexEntry {
  jobId: string;
  jobRef: string;
  customerName: string | null;
  postcode: string | null;
  workflowStage: string | null;
  recordClass: string | null;
  fileCount: number;
}

export interface JobIndexResult {
  total: number;
  limit: number;
  offset: number;
  jobs: JobIndexEntry[];
  canReadLibrary: boolean;
  canManageLibrary: boolean;
}

export interface SearchResult {
  total: number;
  limit: number;
  offset: number;
  q: string | null;
  trashed: boolean;
  files: FileRow[];
}

export interface HistoryEntry {
  action: string;
  at: string | null;
  byName: string | null;
  service: string | null;
  from: string | null;
  to: string | null;
  reason: string | null;
}

export interface FileDetails {
  file: FileRow & {
    uploadedFilename: string | null;
    uploadStatus: string;
    openUrl: string;
    downloadUrl: string;
  };
  location: FileLocation & {
    customerName: string | null;
    recordClass: string | null;
  };
  canManage: boolean;
  canPurge: boolean;
  evidenceLocked: boolean;
  taskTitle: string | null;
  history: HistoryEntry[];
}

/** Every command answers in this shape, so one helper renders every refusal. */
export type FileActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; code: string; message: string };
