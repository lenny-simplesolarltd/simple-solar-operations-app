import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { TaskStatusBadge } from '@/components/task-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDateTime } from '@/features/jobs/format';
import { DueLabel } from '@/features/tasks/components/due-label';
import { EvidenceList } from '@/features/operations/evidence-list';
import { TaskActions } from '@/features/tasks/components/task-actions';
import { getCurrentUser } from '@/lib/auth';
import type { TaskDetailRead } from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import { isAdmin } from '@/lib/roles';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Task | Simple Solar Operations' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex justify-between gap-4 border-b py-1.5 text-sm last:border-b-0'>
      <span className='text-muted-foreground shrink-0'>{label}</span>
      <span className='min-w-0 text-right font-medium break-words'>
        {children}
      </span>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  Complete: 'Completed',
  Reopen: 'Reopened',
  FollowUp: 'Follow-up recorded',
  EvidenceAttach: 'Evidence attached',
  CallOutcome: 'Call recorded',
  Reassign: 'Reassigned',
  Created: 'Created'
};

export default async function TaskPage({
  params
}: {
  params: Promise<{ taskId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { taskId } = await params;
  if (!UUID.test(taskId)) notFound();

  // The read decides visibility: job tasks need job read access, job-less
  // tasks belong to their owner/backup (or an admin).
  const result = await readOps<TaskDetailRead>('TASK_DETAIL', {
    task_id: taskId
  });
  if (!result.ok) {
    if (result.error.kind === 'not_found') notFound();
    return (
      <PageContainer>
        <ReadFailureState
          failure={result.error}
          action={
            <Button asChild variant='outline'>
              <Link href='/dashboard/tasks'>Back to my tasks</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const { task, job, events } = result.data;

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'task',
          taskId: task.id,
          title: task.title.slice(0, 160),
          status: task.status,
          ...(job ? { jobId: job.id, jobRef: job.job_ref } : {})
        }}
      />
      <div className='flex w-full flex-col gap-6'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href='/dashboard/tasks'>
            <IconArrowLeft /> My tasks
          </Link>
        </Button>

        <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
          <div className='min-w-0'>
            <p className='text-muted-foreground font-mono text-xs font-semibold'>
              {task.template_code ?? 'TASK'}
              {task.group && ` · ${task.group}`}
            </p>
            <h1 className='text-2xl font-bold text-balance'>{task.title}</h1>
            <div className='mt-2 flex flex-wrap items-center gap-2 text-sm'>
              <TaskStatusBadge status={task.status} />
              {task.revision_required && (
                <Badge variant='warning'>Revision required</Badge>
              )}
              <DueLabel task={task} />
            </div>
          </div>
          <TaskActions detail={result.data} isAdmin={isAdmin(user)} />
        </div>

        {task.blocking_reason && (
          <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
            Waiting: <span className='font-mono'>{task.blocking_reason}</span>
            {task.next_followup_at &&
              ` · follow up ${formatDateTime(task.next_followup_at)}`}
          </p>
        )}

        <div className='grid gap-4 lg:grid-cols-2'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Task</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label='Owner'>{task.owner_name ?? 'Unassigned'}</Row>
              <Row label='Backup'>{task.backup_name ?? '-'}</Row>
              <Row label='Priority'>{task.priority ?? '-'}</Row>
              <Row label='Created'>{formatDateTime(task.created_at)}</Row>
              {task.original_due_at &&
                !task.original_due_at.startsWith(task.due_at ?? '-') && (
                  <Row label='Originally due'>
                    {formatDateTime(task.original_due_at)}
                  </Row>
                )}
              {task.completed_at && (
                <Row label='Completed'>
                  {formatDateTime(task.completed_at)}
                  {task.completed_by_name && ` by ${task.completed_by_name}`}
                </Row>
              )}
              {task.completion_note && (
                <Row label='Note'>{task.completion_note}</Row>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Job</CardTitle>
            </CardHeader>
            <CardContent>
              {job ? (
                <>
                  <Row label='Job'>
                    <Link
                      href={`/dashboard/jobs/${job.id}`}
                      className='decoration-primary font-mono underline decoration-2 underline-offset-4'
                    >
                      {job.job_ref}
                    </Link>
                  </Row>
                  <Row label='Customer'>
                    {job.customer_name ?? '-'}
                    {job.postcode && ` · ${job.postcode}`}
                  </Row>
                  <Row label='Stage'>{job.workflow_stage}</Row>
                </>
              ) : (
                <p className='text-muted-foreground text-sm'>
                  This task is not linked to a job.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {job && (
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Evidence</CardTitle>
            </CardHeader>
            <CardContent>
              <EvidenceList
                scope={{ task_id: task.id }}
                empty='No file has been added to this task.'
              />
            </CardContent>
          </Card>
        )}

        <section className='flex flex-col gap-3'>
          <h2 className='text-lg font-semibold'>History</h2>
          {events.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              No changes recorded yet.
            </p>
          ) : (
            <ol className='flex flex-col gap-3 border-l pl-4'>
              {events.map((e) => (
                <li key={e.id} className='relative text-sm'>
                  <span
                    aria-hidden='true'
                    className='bg-brand absolute top-1.5 -left-[21px] size-2 rounded-full'
                  />
                  <p className='font-medium'>
                    {EVENT_LABEL[e.action] ?? e.action}
                    {e.new_status && e.old_status !== e.new_status && (
                      <span className='text-muted-foreground font-normal'>
                        {' '}
                        · {e.old_status ?? '-'} → {e.new_status}
                      </span>
                    )}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {formatDateTime(e.occurred_at)} · {e.actor_name}
                  </p>
                  {e.reason && <p className='mt-0.5 break-words'>{e.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
