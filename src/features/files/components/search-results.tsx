import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { evidenceCategoryLabel } from '@/features/operations/evidence-rules';
import { IconDownload, IconFolder } from '@tabler/icons-react';
import Link from 'next/link';
import {
  fileDownloadUrl,
  fileOpenUrl,
  fileTypeLabel,
  formatBytes
} from '../format';
import { filesHref } from '../format';
import type { SearchResult } from '../types';

// Search results. Every row says WHERE the document lives and links to that
// folder, because "I found it but I don't know where it is" is the thing a
// search in a file manager must never do.

export function SearchResults({
  find,
  results
}: {
  find: string;
  results: SearchResult | null;
}) {
  if (!results) {
    return (
      <EmptyState
        title='Could not search'
        description='Files could not be searched. Refresh to try again.'
      />
    );
  }
  if (results.files.length === 0) {
    return (
      <EmptyState
        title='Nothing matched'
        description={`No document you can see matches “${find}”. Try part of a file name, a job reference, a customer name or a postcode.`}
      />
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-sm' aria-live='polite'>
        {results.total} {results.total === 1 ? 'document' : 'documents'} match
        {results.total === 1 ? 'es' : ''} “{find}”
        {results.total > results.files.length
          ? `, showing the newest ${results.files.length}`
          : ''}
      </p>

      <ul className='flex flex-col gap-2'>
        {results.files.map((file) => {
          const location = file.location;
          const folderHref = location
            ? filesHref({
                scope: location.scope,
                jobId: location.jobId,
                folderId: location.folderId
              })
            : '/dashboard/files';
          return (
            <li
              key={file.id}
              className='bg-card flex flex-wrap items-start gap-3 rounded-lg border p-3'
            >
              <div className='min-w-48 flex-1'>
                <a
                  href={fileOpenUrl(file.id)}
                  target='_blank'
                  rel='noreferrer'
                  className='font-medium hover:underline'
                >
                  {file.name}
                </a>
                <p className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs'>
                  <Badge variant='outline'>
                    {fileTypeLabel(file.mimeType)}
                  </Badge>
                  <span>{evidenceCategoryLabel(file.category)}</span>
                  {formatBytes(file.sizeBytes) && (
                    <span>· {formatBytes(file.sizeBytes)}</span>
                  )}
                  {file.addedAt && <span>· {file.addedAt.slice(0, 10)}</span>}
                  {file.addedByName && <span>· {file.addedByName}</span>}
                </p>

                {/* Where it lives. */}
                <p className='mt-1 flex flex-wrap items-center gap-1.5 text-xs'>
                  <IconFolder className='size-3.5 shrink-0' aria-hidden />
                  <Link href={folderHref} className='underline'>
                    {location?.scope === 'Library'
                      ? 'Company documents'
                      : (location?.jobRef ?? file.jobRef ?? 'Job')}
                    {location?.folderPath ? ` / ${location.folderPath}` : ''}
                  </Link>
                  {file.customerName && (
                    <span className='text-muted-foreground'>
                      · {file.customerName}
                    </span>
                  )}
                  {file.recordClass === 'HistoricalImport' && (
                    <Badge variant='outline'>Historical</Badge>
                  )}
                </p>
              </div>

              <div className='flex shrink-0 gap-2'>
                {file.jobId && (
                  <Button asChild variant='outline' size='sm'>
                    <Link href={`/dashboard/jobs/${file.jobId}?tab=files`}>
                      Open job
                    </Link>
                  </Button>
                )}
                <Button asChild size='sm' variant='outline'>
                  <a href={fileDownloadUrl(file.id)} download>
                    <IconDownload className='size-4' aria-hidden />
                    <span className='sr-only'>Download {file.name}</span>
                  </a>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
