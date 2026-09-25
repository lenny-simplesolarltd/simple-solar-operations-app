import PageContainer from '@/components/layout/page-container';
import { VisitBoard } from '@/features/programmes/components/board';
import { ExportVisitsButton } from '@/features/programmes/components/export-button';
import {
  ProgrammeShell,
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import { VisitFilterBar } from '@/features/programmes/components/visit-filters';
import {
  currentAccess,
  getProgramme,
  listInstallers,
  listVisits,
  programmesEnabled
} from '@/features/programmes/server/queries';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { COLUMN_CARDS, DISPOSITIONS } from '@/features/programmes/types';
import { filtersFromParams, type SearchParams } from '../filters';

export const metadata: Metadata = {
  title: 'Programme board | Simple Solar Operations'
};

/** The board's own filters, so "see all N" opens the same question in a list. */
const listQueryString = (
  params: Record<string, string | string[] | undefined>
) => {
  const q = new URLSearchParams();
  for (const key of [
    'from',
    'to',
    'installer',
    'outcome',
    'signal',
    'portal',
    'postcode',
    'status',
    'q'
  ]) {
    const v = params[key];
    const one = Array.isArray(v) ? v[0] : v;
    if (one) q.set(key, one);
  }
  return q.toString();
};

export default async function BoardPage({
  params,
  searchParams
}: {
  params: Promise<{ programmeId: string }>;
  searchParams: SearchParams;
}) {
  const session = await currentAccess();
  if (!session) redirect('/auth/sign-in');
  if (!(await programmesEnabled()))
    return (
      <PageContainer>
        <ProgrammesNotEnabled />
      </PageContainer>
    );

  const { programmeId } = await params;
  const programme = await getProgramme(programmeId);
  if (!programme) notFound();
  if (!session.access.readAll) redirect('/dashboard');

  // The board's columns ARE the statuses, so a status filter would hide the
  // columns it names. Everything else filters as usual.
  const query = await searchParams;
  const filters = filtersFromParams(query);
  delete filters.disposition;
  delete filters.offset;

  // Each column is its own query, so each gets its own true count. Loading one
  // flat page and dealing the rows into columns cannot work at programme scale:
  // whichever disposition happened to be busiest that week would fill the page
  // and the quiet columns would look empty when they were not.
  const [columns, installers] = await Promise.all([
    Promise.all(
      DISPOSITIONS.map(async (disposition) => {
        const page = await listVisits(programmeId, {
          ...filters,
          disposition,
          limit: COLUMN_CARDS
        });
        return { disposition, cards: page.visits, total: page.total };
      })
    ),
    listInstallers(programmeId)
  ]);
  const listQuery = listQueryString(query);

  return (
    <PageContainer scrollable={false}>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/board'
        description='Drag a card, or use its status menu — both run the same audited review.'
        actions={
          session.access.report ? (
            <ExportVisitsButton programmeId={programmeId} filters={filters} />
          ) : null
        }
      >
        <VisitFilterBar installers={installers} showDisposition={false} />
        <VisitBoard
          programmeId={programmeId}
          columns={columns}
          canReview={session.access.review}
          basePath={programmePath(programmeId)}
          listQuery={listQuery}
        />
        {!session.access.review && (
          <p className='text-muted-foreground text-xs'>
            You can see the board but not move cards on it.
          </p>
        )}
      </ProgrammeShell>
    </PageContainer>
  );
}
