import { describe, expect, it } from 'vitest';
import {
  DRAG_TYPE,
  fileKind,
  fileTypeLabel,
  filesHref,
  isFileDrag,
  plural,
  readDragPayload,
  whyNotDeletable
} from '../format';
import type { FileRow } from '../types';

const file = (over: Partial<FileRow> = {}): FileRow => ({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'contract.pdf',
  scope: 'Job',
  jobId: '22222222-2222-2222-2222-222222222222',
  folderId: null,
  category: 'Contract',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  addedAt: '2026-09-20T10:00:00Z',
  addedByName: 'Tanya',
  modifiedAt: '2026-09-20T10:00:00Z',
  filingVersion: 1,
  trashedAt: null,
  trashedByName: null,
  evidenceLocked: false,
  taskId: null,
  issueId: null,
  submissionId: null,
  workPackageId: null,
  canOpen: true,
  ...over
});

describe('filesHref', () => {
  it('is the bare page at the top level', () => {
    expect(filesHref({ scope: 'Job' })).toBe('/dashboard/files');
  });

  it('addresses a job, a folder and the trash', () => {
    expect(filesHref({ scope: 'Job', jobId: 'j1', folderId: 'f1' })).toBe(
      '/dashboard/files?job=j1&folder=f1'
    );
    expect(filesHref({ scope: 'Library', view: 'trash' })).toBe(
      '/dashboard/files?scope=library&view=trash'
    );
  });

  it('leaves out what is not set, so URLs stay shareable', () => {
    expect(filesHref({ scope: 'Job', jobId: 'j1', folderId: null })).toBe(
      '/dashboard/files?job=j1'
    );
  });
});

describe('fileKind / fileTypeLabel', () => {
  it('recognises what can be previewed in place', () => {
    expect(fileKind('image/jpeg')).toBe('image');
    expect(fileKind('application/pdf')).toBe('pdf');
    expect(fileKind('text/csv')).toBe('other');
    expect(fileKind(null)).toBe('other');
  });

  it('labels a type in words a person reads', () => {
    expect(fileTypeLabel('application/pdf')).toBe('PDF');
    expect(fileTypeLabel('image/png')).toBe('PNG');
    expect(fileTypeLabel(null)).toBe('File');
  });
});

describe('whyNotDeletable', () => {
  it('says nothing about an ordinary document', () => {
    expect(whyNotDeletable(file())).toBeNull();
  });

  it('explains a document the business relies on', () => {
    expect(whyNotDeletable(file({ evidenceLocked: true }))).toMatch(
      /evidence for work/i
    );
  });
});

describe('plural', () => {
  it('counts in words', () => {
    expect(plural(1, 'document')).toBe('1 document');
    expect(plural(3, 'document')).toBe('3 documents');
    expect(plural(2, 'item')).toBe('2 items');
  });
});

// A tiny stand-in for the browser's DataTransfer, enough for the two readers.
const transfer = (data: Record<string, string>, types = Object.keys(data)) =>
  ({
    types,
    getData: (type: string) => data[type] ?? ''
  }) as unknown as DataTransfer;

describe('drag payloads', () => {
  it('reads what a page drag is carrying', () => {
    const payload = readDragPayload(
      transfer({
        [DRAG_TYPE]: JSON.stringify({ fileIds: ['a'], folderIds: [] })
      })
    );
    expect(payload).toEqual({ fileIds: ['a'], folderIds: [] });
  });

  it('ignores a drag carrying nothing of ours', () => {
    expect(readDragPayload(transfer({ 'text/plain': 'hello' }))).toBeNull();
    expect(readDragPayload(transfer({ [DRAG_TYPE]: 'not json' }))).toBeNull();
    expect(
      readDragPayload(
        transfer({
          [DRAG_TYPE]: JSON.stringify({ fileIds: [], folderIds: [] })
        })
      )
    ).toBeNull();
    expect(readDragPayload(null)).toBeNull();
  });

  it('tells a desktop drop apart from a drag within the page', () => {
    expect(isFileDrag(transfer({}, ['Files']))).toBe(true);
    // A drag of our own rows also exposes "Files" in some browsers; ours wins.
    expect(isFileDrag(transfer({}, ['Files', DRAG_TYPE]))).toBe(false);
    expect(isFileDrag(transfer({}, ['text/plain']))).toBe(false);
  });
});
