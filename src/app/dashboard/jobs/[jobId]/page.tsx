import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { FINANCE_LABEL, formatDate, pounds } from '@/features/jobs/format';
import { getJobDetail } from '@/features/jobs/server/queries';
import { TaskTable } from '@/features/jobs/task-table';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Job | Simple Solar Operations' };

const UUID = /^[0-9a-f-]{36}$/i;

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
  params
}: {
  params: Promise<{ jobId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();
  // RLS decides visibility: a job you may not see is simply not found.
  const detail = await getJobDetail(jobId);
  if (!detail) notFound();

  const { job, tasks } = detail;
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
          <Badge>{job.workflow_stage}</Badge>
        </div>

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
                {pounds.format(job.original_gross_pence / 100)}
              </Row>
              {presale &&
                presale.computed_total_pence !== presale.agreed_price_pence && (
                  <Row label='Designer total'>
                    {pounds.format(presale.computed_total_pence / 100)}
                  </Row>
                )}
              <Row label='Payment'>
                {FINANCE_LABEL[job.finance_route] ?? job.finance_route}
              </Row>
              <Row label='Salesperson'>
                {job.salesperson?.display_name ?? '-'}
              </Row>
              <Row label='Lead source'>{job.lead_source ?? '-'}</Row>
              <Row label='Quote reference'>{job.quote_reference ?? '-'}</Row>
              <Row label='Scope'>{scope.length ? scope.join(', ') : '-'}</Row>
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
                <Row label='Electrical notes'>{presale.electrical_notes}</Row>
              )}
              <p className='text-muted-foreground pt-2 text-xs'>
                Catalogue {presale.catalogue_version}. The presale is the record
                of what was sold and cannot be edited.
              </p>
            </CardContent>
          </Card>
        )}

        <section className='flex flex-col gap-3'>
          <h2 className='text-lg font-semibold'>Tasks</h2>
          <TaskTable tasks={tasks} showJob={false} />
        </section>
      </div>
    </PageContainer>
  );
}
