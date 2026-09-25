import PageContainer from '@/components/layout/page-container';
import {
  ByDayPanel,
  ByInstallerPanel,
  CsqPanel,
  DeliveryPanel,
  NeedsActionPanel,
  PortalPanel,
  ProgressPanel,
  StatGrid
} from '@/features/programmes/components/dashboard-panels';
import {
  ExportDailyReportButton,
  ExportVisitsButton
} from '@/features/programmes/components/export-button';
import {
  ProgrammeShell,
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import { VisitFilterBar } from '@/features/programmes/components/visit-filters';
import {
  currentAccess,
  getDashboard,
  getProgramme,
  listInstallers,
  programmesEnabled
} from '@/features/programmes/server/queries';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { filtersFromParams, type SearchParams } from './filters';

export const metadata: Metadata = {
  title: 'Programme | Simple Solar Operations'
};

/** Live programme reporting, filtered. */
export default async function ProgrammeOverviewPage({
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

  const filters = filtersFromParams(await searchParams);
  const [data, installers] = await Promise.all([
    getDashboard(programmeId, filters),
    session.access.readAll ? listInstallers(programmeId) : []
  ]);

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current=''
        actions={
          session.access.report ? (
            <>
              <ExportVisitsButton programmeId={programmeId} filters={filters} />
              <ExportDailyReportButton programmeId={programmeId} />
            </>
          ) : null
        }
      >
        {!data ? (
          <p className='text-muted-foreground text-sm'>
            You do not have access to this programme&rsquo;s reporting.
          </p>
        ) : (
          <div className='flex flex-col gap-4'>
            {data.total_properties > 0 && (
              <VisitFilterBar installers={installers} showSearch={false} />
            )}
            <DeliveryPanel
              data={data}
              importHref={
                session.access.manage
                  ? `${programmePath(programmeId)}/import`
                  : null
              }
            />
            {data.total_properties > 0 && (
              <NeedsActionPanel
                data={data}
                basePath={programmePath(programmeId)}
              />
            )}
            <ProgressPanel data={data} />
            <StatGrid data={data} />
            <div className='grid gap-4 lg:grid-cols-2'>
              <PortalPanel data={data} />
              <CsqPanel
                data={data}
                boundaryUnresolved={
                  programme.signalConfig.boundary_unresolved === true
                }
              />
              <ByInstallerPanel data={data} />
              <ByDayPanel data={data} />
            </div>
            <p className='text-muted-foreground text-xs'>
              Every figure is read live from the programme&rsquo;s own data. The
              CSV export is an output of this system, not a copy of it that
              anything reads back.
            </p>
          </div>
        )}
      </ProgrammeShell>
    </PageContainer>
  );
}
