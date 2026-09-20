import 'server-only';

import { EmptyState } from '@/components/empty-state';
import { browseFiles } from '../queries';
import type { FileSort, SortDirection } from '../types';
import { FileManager } from './file-manager';

// A job's Files tab.
//
// This is the SAME file manager as /dashboard/files, rooted at this job rather
// than at the top - the same folders, the same documents, the same commands.
// There is no separate "job files" implementation to keep in step: a document
// uploaded here is found there, and a folder made there is here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function JobFilesTab({
  jobId,
  searchParams
}: {
  jobId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const first = (v: string | string[] | undefined) =>
    ((Array.isArray(v) ? v[0] : v) ?? '').trim();

  const folder = first(searchParams.folder);
  const sort = first(searchParams.sort);
  const dir = first(searchParams.dir);

  const result = await browseFiles({
    scope: 'Job',
    jobId,
    folderId: UUID.test(folder) ? folder : null,
    view: first(searchParams.view) === 'trash' ? 'trash' : 'folder',
    q: first(searchParams.q) || null,
    sort: (['name', 'modified', 'size', 'category'] as FileSort[]).includes(
      sort as FileSort
    )
      ? (sort as FileSort)
      : undefined,
    dir: dir === 'desc' ? ('desc' as SortDirection) : undefined,
    limit: 300
  });

  if (!result) {
    return (
      <EmptyState
        title='Files could not be loaded'
        description='Refresh to try again.'
      />
    );
  }

  const href = (to: {
    folderId?: string | null;
    view?: 'folder' | 'trash';
    q?: string | null;
  }) => {
    const params = new URLSearchParams({ tab: 'files' });
    if (to.folderId) params.set('folder', to.folderId);
    if (to.view === 'trash') params.set('view', 'trash');
    if (to.q) params.set('q', to.q);
    return `/dashboard/jobs/${jobId}?${params.toString()}`;
  };

  return (
    <div className='flex flex-col gap-4'>
      <FileManager
        result={result}
        scope='Job'
        jobId={jobId}
        hrefFor={href}
        notice={
          result.job?.recordClass === 'HistoricalImport'
            ? 'This is an imported historical record. Its documents can be read and downloaded, but not reorganised.'
            : undefined
        }
      />
      <p className='text-muted-foreground text-xs'>
        Files are private. Open and Download use a link that works for 60
        seconds. The same documents appear in Files &amp; documents.
      </p>
    </div>
  );
}
