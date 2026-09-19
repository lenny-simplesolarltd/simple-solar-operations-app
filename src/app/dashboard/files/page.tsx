import PageContainer from '@/components/layout/page-container';
import { EmptyState } from '@/components/empty-state';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { searchEvidence } from '@/features/operations/evidence-queries';
import {
  FilesResults,
  FilesSearchForm,
  parseFilesQuery
} from '@/features/operations/files-library';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Files & documents | Simple Solar Operations'
};

const PAGE_SIZE = 50;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Any signed-in staff member may search; public.search_evidence returns only
// the files that person may read (installers: their allocated work; Store:
// delivery notes; office: the jobs they are assigned to).
export default async function FilesPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const query = parseFilesQuery(await searchParams);
  const search = await searchEvidence({
    q: query.q,
    category: query.category,
    from: query.from,
    to: query.to,
    limit: PAGE_SIZE,
    offset: query.offset
  });

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'operations', surface: 'files' }} />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Files & documents'
          description='Contracts, photos, commissioning records, delivery notes and every other file stored on the jobs you can see.'
        />
        <p className='text-muted-foreground text-sm'>
          Files are private. Open and Download create a link that works for 60
          seconds, so open a file again rather than sharing its address.
        </p>
        <FilesSearchForm query={query} />
        {search.ok ? (
          <FilesResults
            files={search.result.files}
            total={search.result.total}
            query={query}
            pageSize={PAGE_SIZE}
          />
        ) : (
          <EmptyState title='Could not load' description={search.message} />
        )}
      </div>
    </PageContainer>
  );
}
