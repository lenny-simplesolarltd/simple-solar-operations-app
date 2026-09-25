import PageContainer from '@/components/layout/page-container';
import { ExportDailyReportButton } from '@/features/programmes/components/export-button';
import { DailyReportView } from '@/features/programmes/components/daily-report';
import {
  ProgrammeShell,
  ProgrammesNotEnabled
} from '@/features/programmes/components/shell';
import {
  currentAccess,
  getDailyReport,
  getProgramme,
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

  const raw = (await searchParams).date;
  const wanted = (Array.isArray(raw) ? raw[0] : raw) ?? '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : undefined;
  const report = await getDailyReport(programmeId, date);

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/report'
        description='The day as the client would read it. Nothing on this page is sent anywhere.'
        actions={
          <ExportDailyReportButton programmeId={programmeId} date={date} />
        }
      >
        {!report ? (
          <p className='text-muted-foreground text-sm'>
            You do not have access to this programme&rsquo;s reporting.
          </p>
        ) : (
          <DailyReportView report={report} />
        )}
      </ProgrammeShell>
    </PageContainer>
  );
}
