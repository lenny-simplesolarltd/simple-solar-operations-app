import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { Input } from '@/components/ui/input';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { FileManager } from '@/features/files/components/file-manager';
import { filesHref } from '@/features/files/format';
import {
  browseFiles,
  listFileJobs,
  searchFiles
} from '@/features/files/queries';
import type {
  FileScope,
  FileSort,
  SortDirection
} from '@/features/files/types';
import { getCurrentUser } from '@/lib/auth';
import { IconFolder, IconSearch } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchResults } from '@/features/files/components/search-results';

export const metadata: Metadata = {
  title: 'Files & documents | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

/**
 * The global file manager.
 *
 * Three levels, all of them the same documents:
 *
 *   * no job and no scope - the top: company documents, plus the jobs whose
 *     files this person can reach;
 *   * ?job=<id> - that job's folders, which is exactly what the job's own
 *     Files tab shows;
 *   * ?scope=library - company documents.
 *
 * ?find=<text> searches across all of it instead, in the database, and each
 * result says which folder it lives in.
 */
export default async function FilesPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const params = await searchParams;
  const find = first(params.find).slice(0, 120);
  const jobParam = first(params.job);
  const scopeParam = first(params.scope);
  const folderParam = first(params.folder);
  const sort = first(params.sort);
  const dir = first(params.dir);

  // A global search: one database query, paged there, never the whole tree.
  if (find) {
    const results = await searchFiles({ q: find, limit: 100 });
    return (
      <PageContainer>
        <AssistantPageContext page={{ kind: 'operations', surface: 'files' }} />
        <div className='flex w-full flex-col gap-4'>
          <Heading
            title='Files & documents'
            description='Search across every job you can see and the company documents.'
          />
          <GlobalSearchForm defaultValue={find} />
          <SearchResults find={find} results={results} />
        </div>
      </PageContainer>
    );
  }

  const scope: FileScope | null =
    scopeParam === 'library' ? 'Library' : UUID.test(jobParam) ? 'Job' : null;

  // The top level: company documents and the jobs that have files.
  if (!scope) {
    const index = await listFileJobs({ q: first(params.q), limit: 100 });
    return (
      <PageContainer>
        <AssistantPageContext page={{ kind: 'operations', surface: 'files' }} />
        <div className='flex w-full flex-col gap-4'>
          <Heading
            title='Files & documents'
            description='Every contract, photo, commissioning record and delivery note, filed by job - plus the company documents that belong to no job.'
          />
          <GlobalSearchForm defaultValue='' />
          {index === null ? (
            <EmptyState
              title='Could not load'
              description='Files could not be loaded. Refresh to try again.'
            />
          ) : (
            <>
              {index.canReadLibrary && (
                <Link
                  href={filesHref({ scope: 'Library' })}
                  className='bg-card hover:bg-accent flex items-center gap-3 rounded-lg border p-4'
                >
                  <IconFolder className='size-6 shrink-0' aria-hidden />
                  <span>
                    <span className='block font-medium'>Company documents</span>
                    <span className='text-muted-foreground block text-sm'>
                      Policies, templates and anything else that belongs to no
                      single job.
                    </span>
                  </span>
                </Link>
              )}

              <section>
                <h2 className='mb-2 text-lg font-semibold'>Jobs</h2>
                {index.jobs.length === 0 ? (
                  <EmptyState
                    title='No job files yet'
                    description='Jobs appear here once they have documents you can see.'
                  />
                ) : (
                  <ul className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                    {index.jobs.map((job) => (
                      <li key={job.jobId}>
                        <Link
                          href={filesHref({ scope: 'Job', jobId: job.jobId })}
                          className='bg-card hover:bg-accent flex items-start gap-3 rounded-lg border p-3'
                        >
                          <IconFolder
                            className='mt-0.5 size-5 shrink-0'
                            aria-hidden
                          />
                          <span className='min-w-0'>
                            <span className='block font-mono font-semibold'>
                              {job.jobRef}
                            </span>
                            <span className='text-muted-foreground block truncate text-sm'>
                              {[job.customerName, job.postcode]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            <span className='mt-1 flex items-center gap-2'>
                              <Badge variant='secondary'>
                                {job.fileCount} file
                                {job.fileCount === 1 ? '' : 's'}
                              </Badge>
                              {job.recordClass === 'HistoricalImport' && (
                                <Badge variant='outline'>Historical</Badge>
                              )}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {index.total > index.jobs.length && (
                  <p className='text-muted-foreground mt-2 text-sm'>
                    Showing {index.jobs.length} of {index.total} jobs. Use the
                    search box to find one.
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </PageContainer>
    );
  }

  // Inside a job, or inside the library.
  const jobId = scope === 'Job' ? jobParam : null;
  const result = await browseFiles({
    scope,
    jobId,
    folderId: UUID.test(folderParam) ? folderParam : null,
    view: first(params.view) === 'trash' ? 'trash' : 'folder',
    q: first(params.q) || null,
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
      <PageContainer>
        <div className='flex w-full flex-col gap-4'>
          <Heading title='Files & documents' description='' />
          <EmptyState
            title='Not found'
            description='Those files could not be loaded. They may not exist, or you may not have access to them.'
          />
        </div>
      </PageContainer>
    );
  }

  const title =
    scope === 'Library'
      ? 'Company documents'
      : `${result.job?.jobRef ?? 'Job'} files`;

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'operations', surface: 'files' }} />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Files & documents'
          description={
            scope === 'Library'
              ? 'Documents that belong to the company rather than to a job.'
              : [result.job?.customerName, result.job?.workflowStage]
                  .filter(Boolean)
                  .join(' · ')
          }
        />
        <GlobalSearchForm defaultValue='' />
        <p className='text-muted-foreground text-sm'>
          Files are private. Open and Download create a link that works for 60
          seconds, so open a file again rather than sharing its address.
        </p>
        <FileManager
          result={result}
          scope={scope}
          jobId={jobId}
          heading={title}
          hrefFor={(to) =>
            filesHref({
              scope,
              jobId,
              folderId: to.folderId,
              view: to.view,
              q: to.q
            })
          }
          notice={
            result.job?.recordClass === 'HistoricalImport'
              ? 'This is an imported historical record. Its documents can be read and downloaded, but not reorganised.'
              : undefined
          }
        />
      </div>
    </PageContainer>
  );
}

function GlobalSearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form
      method='get'
      action='/dashboard/files'
      role='search'
      aria-label='Search all files'
      className='flex flex-wrap items-end gap-2'
    >
      <div className='flex min-w-56 flex-1 flex-col gap-1.5'>
        <label className='text-sm font-medium' htmlFor='files-find'>
          Search everything
        </label>
        <Input
          id='files-find'
          name='find'
          type='search'
          defaultValue={defaultValue}
          maxLength={120}
          placeholder='File name, folder, job reference, customer or postcode'
        />
      </div>
      <Button type='submit'>
        <IconSearch className='size-4' aria-hidden /> Search
      </Button>
      {defaultValue && (
        <Button asChild variant='ghost'>
          <Link href='/dashboard/files'>Clear</Link>
        </Button>
      )}
    </form>
  );
}
