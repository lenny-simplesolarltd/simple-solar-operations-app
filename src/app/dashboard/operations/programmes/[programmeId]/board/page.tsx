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
import { filtersFromParams, type SearchParams } from '../filters';

export const metadata: Metadata = {
  title: 'Programme board | Simple Solar Operations'
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
  const filters = filtersFromParams(await searchParams);
  delete filters.disposition;
  const [visits, installers] = await Promise.all([
    listVisits(programmeId, filters),
    listInstallers(programmeId)
  ]);

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
          visits={visits}
          canReview={session.access.review}
          basePath={programmePath(programmeId)}
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
