import type { FileRow, FileScope } from './types';

// Display helpers for the file manager. Presentation only: what a person may
// do is decided by the server and arrives on the row.

export { formatBytes } from '@/features/operations/evidence-rules';

/** The URL of a folder (or the top level) in the global file manager. */
export function filesHref(location: {
  scope: FileScope;
  jobId?: string | null;
  folderId?: string | null;
  view?: 'folder' | 'trash';
  q?: string | null;
}) {
  const params = new URLSearchParams();
  if (location.scope === 'Library') params.set('scope', 'library');
  if (location.jobId) params.set('job', location.jobId);
  if (location.folderId) params.set('folder', location.folderId);
  if (location.view === 'trash') params.set('view', 'trash');
  if (location.q) params.set('q', location.q);
  const query = params.toString();
  return query ? `/dashboard/files?${query}` : '/dashboard/files';
}

export const fileOpenUrl = (id: string) => `/api/evidence/${id}`;
export const fileDownloadUrl = (id: string) => `/api/evidence/${id}?download=1`;

export type FileKind = 'image' | 'pdf' | 'other';

export function fileKind(mimeType: string | null | undefined): FileKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

/** Short, human type for the Type column. */
export function fileTypeLabel(mimeType: string | null | undefined) {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return mime.slice(6).toUpperCase();
  return 'File';
}

/**
 * Why an action is not offered for this document, or null when it is. The
 * database refuses either way; this is what lets a disabled menu item say why.
 */
export function whyNotDeletable(file: FileRow): string | null {
  if (file.evidenceLocked)
    return 'This document is the evidence for work that has been recorded.';
  return null;
}

/** "Moved 3 documents", "Moved 1 document". */
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export const DRAG_TYPE = 'application/x-simple-solar-files';

/** What a drag carries: the ids being dragged, and where they came from. */
export interface FileDragPayload {
  fileIds: string[];
  folderIds: string[];
}

export function readDragPayload(
  transfer: DataTransfer | null
): FileDragPayload | null {
  if (!transfer) return null;
  const raw = transfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FileDragPayload>;
    const fileIds = Array.isArray(parsed.fileIds) ? parsed.fileIds : [];
    const folderIds = Array.isArray(parsed.folderIds) ? parsed.folderIds : [];
    if (fileIds.length === 0 && folderIds.length === 0) return null;
    return { fileIds, folderIds };
  } catch {
    return null;
  }
}

/** True when the drag comes from the desktop rather than from the page. */
export const isFileDrag = (transfer: DataTransfer | null) =>
  !!transfer &&
  transfer.types.includes('Files') &&
  !transfer.types.includes(DRAG_TYPE);
