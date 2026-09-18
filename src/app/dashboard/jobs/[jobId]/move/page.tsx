import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { getJobDetail } from '@/features/jobs/server/queries';
import { stageLabel } from '@/features/jobs/stages';
import { MoveJob } from '@/features/planner/components/move-job';
import { getCurrentUser } from '@/lib/auth';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Move job | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOVABLE_STAGES = [
  'BookingInProgress',
  'Booked',
  'AwaitingInstallation',
  'InProgress'
];

export default async function MoveJobPage({
  params
}: {
  params: Promise<{ jobId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();
  const detail = await getJobDetail(jobId);
  if (!detail) notFound();
  const { job } = detail;

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'job',
          jobId: job.id,
          jobRef: job.job_ref,
          customerName: `${job.customers.first_name} ${job.customers.last_name}`,
          workflowStage: job.workflow_stage
        }}
      />
      <div className='flex w-full max-w-3xl flex-col gap-4'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href={`/dashboard/jobs/${job.id}`}>
            <IconArrowLeft /> {job.job_ref}
          </Link>
        </Button>
        <div>
          <h1 className='text-2xl font-bold'>Move job · {job.job_ref}</h1>
          <p className='text-muted-foreground text-sm'>
            Choose what moves and the new dates, check the preview, then
            confirm. Installers, calendar entries and scaffold move together;
            follow-up tasks are created for anything affected.
          </p>
        </div>
        {MOVABLE_STAGES.includes(job.workflow_stage) ? (
          <MoveJob jobId={job.id} />
        ) : (
          <p className='bg-muted rounded-md px-3 py-2 text-sm'>
            A job can be moved once its booking is in progress; this one is{' '}
            {stageLabel(job.workflow_stage)}.
          </p>
        )}
      </div>
    </PageContainer>
  );
}
