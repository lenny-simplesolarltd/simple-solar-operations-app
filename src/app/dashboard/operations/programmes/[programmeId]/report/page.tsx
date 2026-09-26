import PageContainer from '@/components/layout/page-container';
import { ExportDailyReportButton } from '@/features/programmes/components/export-button';
import { DailyReportView } from '@/features/programmes/components/daily-report';
import {
  ProgrammeShell,
  ProgrammesNotEnabled
} from '@/features/programmes/components/shell';
import { ReportSchedules } from '@/features/programmes/components/report-schedules';
import {
  currentAccess,
  getDailyReport,
  getProgramme,
  getReportSubscriptions,
  getWeeklyReport,
  programmesEnabled
} from '@/features/programmes/server/queries';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../filters';

export const metadata: Metadata = {
  title: 'Daily report | Simple Solar Operations'
};

/**
 * The daily report, on the screen.
 *
 * The report already existed, but only as a CSV: the database computed every
 * summary counter the client asks about - attended, SIMs swapped, no access,
 * meters needing replacement, action required, confirmed live, not live, still
 * awaiting review - and the only consumer threw all of them away and wrote out
 * the detail lines. So nobody could read the day's report without opening a
 * spreadsheet and adding it up themselves.
 *
 * This is the readable form; the CSV stays exactly as it was, a machine export.
 * Nothing here is emailed - the office reads it, and sends it if and when they
 * decide to.
 */
export default async function ProgrammeReportPage({
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
  if (!session.access.report) redirect('/dashboard');

  const query = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? '';
  const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const date = isDate(one(query.date)) ? one(query.date) : undefined;
  // ?period=weekly previews exactly what the weekly email would carry, from the
  // same canonical read - so what is previewed and what is sent cannot differ.
  const weekly = one(query.period) === 'weekly';
  const from = isDate(one(query.from)) ? one(query.from) : undefined;
  const to = isDate(one(query.to)) ? one(query.to) : undefined;

  const [report, schedules] = await Promise.all([
    weekly
      ? getWeeklyReport(programmeId, { from, to })
      : getDailyReport(programmeId, date),
    getReportSubscriptions('Programme', programmeId)
  ]);

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/report'
        description={
          weekly
            ? 'The week as the client would read it, exactly as the weekly email carries it.'
            : 'The day as the client would read it. Nothing on this page is sent unless a schedule below says so.'
        }
        actions={
          <ExportDailyReportButton programmeId={programmeId} date={date} />
        }
      >
        <div className='flex flex-col gap-8'>
          {!report ? (
            <p className='text-muted-foreground text-sm'>
              You do not have access to this programme&rsquo;s reporting.
            </p>
          ) : (
            <DailyReportView report={report} />
          )}

          {schedules && (
            <ReportSchedules
              sourceKind='Programme'
              sourceId={programmeId}
              subscriptions={schedules.subscriptions}
              runs={schedules.runs}
              canManage={session.access.manage}
              previewHrefs={{
                Daily: '?period=daily',
                Weekly: '?period=weekly'
              }}
            />
          )}
        </div>
      </ProgrammeShell>
    </PageContainer>
  );
}
