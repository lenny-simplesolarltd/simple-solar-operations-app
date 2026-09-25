import PageContainer from '@/components/layout/page-container';
import { ExportVisitsButton } from '@/features/programmes/components/export-button';
import {
  ProgrammeShell,
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import { VisitFilterBar } from '@/features/programmes/components/visit-filters';
import { VisitsTable } from '@/features/programmes/components/visits-table';
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
  title: 'Programme visits | Simple Solar Operations'
};

export default async function VisitsPage({
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
  if (!session.access.read) redirect('/dashboard');

  const filters = filtersFromParams(await searchParams);
  const [visits, installers] = await Promise.all([
    listVisits(programmeId, filters),
    session.access.readAll ? listInstallers(programmeId) : []
  ]);

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/visits'
        description={
          session.access.readAll
            ? 'Every visit in this programme.'
            : 'The visits you have recorded.'
        }
        actions={
          session.access.report ? (
            <ExportVisitsButton programmeId={programmeId} filters={filters} />
          ) : null
        }
      >
        <VisitFilterBar installers={installers} />
        <VisitsTable visits={visits} basePath={programmePath(programmeId)} />
      </ProgrammeShell>
    </PageContainer>
  );
}
