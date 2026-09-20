import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { FINANCE_LABEL, formatDate, pounds } from '@/features/jobs/format';
import {
  HistoryTab,
  MoneyTab,
  WorkTab
} from '@/features/jobs/components/job-sections';
import {
  JOB_TABS,
  JobTabNav,
  OFFICE_ONLY_TABS,
  parseJobTab
} from '@/features/jobs/components/job-tabs';
import { OperationsTab } from '@/features/jobs/components/operations/operations-tab';
import {
  getJobDetail,
  OPEN_TASK_STATUSES
} from '@/features/jobs/server/queries';
import { stageLabel } from '@/features/jobs/stages';
import { JobFilesTab } from '@/features/files/components/job-files-tab';
import { TaskTable } from '@/features/jobs/task-table';
import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth';
import { isOfficeClass } from '@/lib/roles';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Job | Simple Solar Operations' };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * What a historical import shows where the legacy source recorded nothing.
 * Deliberately not '-' or a zero: an unknown price is not a free job, and an
 * unknown salesperson is not "nobody sold it".
 */
const NOT_RECORDED = (
  <span className='text-muted-foreground font-normal italic'>Not recorded</span>
);

// Stages at which BOOKING_INTAKE accepts a booking form (the page re-checks).
const BOOKING_STAGES = ['Prebooking', 'ReadyToBook', 'BookingInProgress'];
// Stages at which MOVE_JOB accepts a move.
const MOVABLE_STAGES = [
  'BookingInProgress',
  'Booked',
  'AwaitingInstallation',
  'InProgress'
];

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex justify-between gap-4 border-b py-1.5 text-sm last:border-b-0'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-right font-medium'>{children}</span>
    </div>
  );
}

export default async function JobPage({
  params,
  searchParams
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const { jobId } = await params;
  // Surveyors, Finance and installers read the job, its tasks and its files;
  // the work, operations, money and history reads are office-only.
  const visibleTabs = JOB_TABS.map((t) => t.id).filter(
    (t) => isOfficeClass(user) || !OFFICE_ONLY_TABS.includes(t)
  );
  const query = await searchParams;
  const tab = parseJobTab(query.tab, visibleTabs);
  if (!UUID.test(jobId)) notFound();
  // RLS decides visibility: a job you may not see is simply not found.
  const detail = await getJobDetail(jobId);
  if (!detail) notFound();

  const { job, tasks } = detail;
  const openTasks = tasks.filter((t) =>
    (OPEN_TASK_STATUSES as readonly string[]).includes(t.status)
  );
  const customer = job.customers;
  const presale = Array.isArray(job.presales) ? job.presales[0] : job.presales;
  const breakdown = (presale?.price_breakdown ?? []) as {
    key: string;
    label: string;
    pence: number;
  }[];
  const scope = [
    job.roof_required && 'Roof',
    job.electrical_required && 'Electrical',
    job.scaffold_required && 'Scaffold'
  ].filter(Boolean);

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'job',
          jobId: job.id,
          jobRef: job.job_ref,
          customerName: `${customer.first_name} ${customer.last_name}`,
          workflowStage: job.workflow_stage
        }}
      />
      <div className='flex w-full flex-col gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title={job.job_ref}
            description={`${customer.first_name} ${customer.last_name} · ${customer.postcode} · sold ${formatDate(job.sold_at)}`}
          />
          <div className='flex flex-wrap items-center gap-2'>
            {/* An imported record never passed through this system's
                workflow. app.historical_import_apply stamps every one of them
                OperationallyComplete so they stay out of the sweeps, which is
                a bookkeeping device and not evidence that the job finished -
                so showing it as a workflow stage would assert something the
                source does not prove. Historical records show only what they
                are. */}
            {job.record_class === 'HistoricalImport' ? (
              <Badge
                variant='secondary'
                title='Imported from the historical Job Booking form. Read-only history; no active work, and no workflow stage in this system.'
              >
                Historical record
              </Badge>
            ) : (
              <Badge>{stageLabel(job.workflow_stage)}</Badge>
            )}
            {isOfficeClass(user) &&
              BOOKING_STAGES.includes(job.workflow_stage) && (
                <Button asChild size='sm' variant='outline'>
                  <Link href={`/dashboard/jobs/${job.id}/booking`}>
                    Booking form
                  </Link>
                </Button>
              )}
            {isOfficeClass(user) &&
              MOVABLE_STAGES.includes(job.workflow_stage) && (
                <Button asChild size='sm' variant='outline'>
                  <Link href={`/dashboard/jobs/${job.id}/move`}>Move job</Link>
                </Button>
              )}
          </div>
        </div>

        <JobTabNav
          jobId={job.id}
          active={tab}
          counts={{ tasks: openTasks.length }}
          visible={visibleTabs}
        />

        {tab === 'tasks' && <TaskTable tasks={tasks} showJob={false} />}
        {tab === 'work' && <WorkTab jobId={job.id} />}
        {tab === 'operations' && <OperationsTab jobId={job.id} />}
        {tab === 'money' && <MoneyTab jobId={job.id} />}
        {tab === 'files' && <JobFilesTab jobId={job.id} searchParams={query} />}
        {tab === 'history' && <HistoryTab jobId={job.id} />}

        {tab === 'overview' && (
          <>
            <div className='grid gap-4 md:grid-cols-2'>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Customer</CardTitle>
                </CardHeader>
                <CardContent>
                  <Row label='Name'>
                    {customer.first_name} {customer.last_name}
                  </Row>
                  <Row label='Address'>
                    {[
                      customer.address_line1,
                      customer.address_line2,
                      customer.town,
                      customer.postcode
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </Row>
                  <Row label='Phone'>{customer.phone ?? '-'}</Row>
                  <Row label='Email'>{customer.email ?? '-'}</Row>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Sale</CardTitle>
                </CardHeader>
                <CardContent>
                  <Row label='Agreed price'>
                    {job.original_gross_pence === null
                      ? NOT_RECORDED
                      : pounds.format(job.original_gross_pence / 100)}
                  </Row>
                  {presale &&
                    presale.computed_total_pence !==
                      presale.agreed_price_pence && (
                      <Row label='Designer total'>
                        {pounds.format(presale.computed_total_pence / 100)}
                      </Row>
                    )}
                  <Row label='Payment'>
                    {job.finance_route === null
                      ? NOT_RECORDED
                      : (FINANCE_LABEL[job.finance_route] ?? job.finance_route)}
                  </Row>
                  <Row label='Salesperson'>
                    {job.salesperson?.display_name ??
                      (job.record_class === 'HistoricalImport'
                        ? NOT_RECORDED
                        : '-')}
                  </Row>
                  <Row label='Lead source'>{job.lead_source ?? '-'}</Row>
                  <Row label='Quote reference'>
                    {job.quote_reference ?? '-'}
                  </Row>
                  <Row label='Scope'>
                    {scope.length ? scope.join(', ') : '-'}
                  </Row>
                </CardContent>
              </Card>
            </div>

            {presale && (
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Presale · {Number(presale.system_kwp).toFixed(2)} kWp ·{' '}
                    {presale.net_panels} panels
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {breakdown.map((line) => (
                    <Row key={line.key} label={line.label}>
                      <span className='font-mono'>
                        {pounds.format(line.pence / 100)}
                      </span>
                    </Row>
                  ))}
                  {presale.roof_notes && (
                    <Row label='Roof notes'>{presale.roof_notes}</Row>
                  )}
                  {presale.electrical_notes && (
                    <Row label='Electrical notes'>
                      {presale.electrical_notes}
                    </Row>
                  )}
                  <p className='text-muted-foreground pt-2 text-xs'>
                    Catalogue {presale.catalogue_version}. The presale is the
                    record of what was sold and cannot be edited.
                  </p>
                </CardContent>
              </Card>
            )}

            <section className='flex flex-col gap-3'>
              <h2 className='text-lg font-semibold'>Open tasks</h2>
              <TaskTable tasks={openTasks} showJob={false} />
            </section>
          </>
        )}
      </div>
    </PageContainer>
  );
}
