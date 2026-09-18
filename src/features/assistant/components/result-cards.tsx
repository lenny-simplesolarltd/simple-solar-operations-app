import { TaskStatusBadge } from '@/components/task-status-badge';
import { Badge } from '@/components/ui/badge';
import { dueState, formatDateTime } from '@/features/jobs/format';
import { cn } from '@/lib/utils';
import { IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';
import type { DisplayCard, JobCardData, TaskCardData } from '../protocol';

// Structured tool results. These show exactly what the application returned,
// so staff can check the assistant's wording against the data.

function CardShell({
  title,
  meta,
  children
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div className='bg-background overflow-hidden rounded-lg border'>
      <div className='flex items-baseline justify-between gap-3 border-b px-3 py-2'>
        <h3 className='min-w-0 truncate text-xs font-semibold'>{title}</h3>
        {meta && (
          <span className='text-muted-foreground shrink-0 text-xs'>{meta}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function ViewJobLink({
  job,
  onNavigate
}: {
  job: Pick<JobCardData, 'id' | 'jobRef'>;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={`/dashboard/jobs/${job.id}`}
      onClick={onNavigate}
      className='hover:bg-accent focus-visible:ring-ring -mr-1 inline-flex shrink-0 items-center gap-0.5 rounded-md py-1 pr-1 pl-2 text-xs font-medium outline-none focus-visible:ring-2'
    >
      View job
      <span className='sr-only'> {job.jobRef}</span>
      <IconChevronRight aria-hidden className='size-3.5' />
    </Link>
  );
}

function JobRow({
  job,
  onNavigate
}: {
  job: JobCardData;
  onNavigate?: () => void;
}) {
  return (
    <li className='flex items-center justify-between gap-3 px-3 py-2'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='font-mono text-xs font-semibold'>{job.jobRef}</span>
          <Badge variant='secondary' className='px-2 py-0 text-[11px]'>
            {job.workflowStage}
          </Badge>
        </div>
        <p className='truncate text-sm'>
          {job.customerName}
          <span className='text-muted-foreground'> · {job.postcode}</span>
        </p>
      </div>
      <ViewJobLink job={job} onNavigate={onNavigate} />
    </li>
  );
}

function TaskRow({
  task,
  showJob,
  onNavigate
}: {
  task: TaskCardData;
  showJob: boolean;
  onNavigate?: () => void;
}) {
  const due = dueState(task.dueAt);
  return (
    <li className='flex flex-col gap-1 px-3 py-2'>
      <div className='flex items-start justify-between gap-2'>
        <p className='min-w-0 text-sm'>
          <span className='font-mono text-xs font-semibold'>{task.code}</span>{' '}
          {task.title}
        </p>
        <TaskStatusBadge status={task.status} />
      </div>
      <p className='text-muted-foreground flex flex-wrap gap-x-2 text-xs'>
        <span
          className={cn(
            due === 'overdue' && 'text-destructive font-medium',
            due === 'today' && 'text-warning font-medium'
          )}
        >
          {task.dueAt
            ? `${formatDateTime(task.dueAt)}${due === 'overdue' ? ' · overdue' : due === 'today' ? ' · today' : ''}`
            : 'No due date'}
        </span>
        <span>· {task.ownerName}</span>
        {showJob && task.jobId && task.jobRef && (
          <Link
            href={`/dashboard/jobs/${task.jobId}`}
            onClick={onNavigate}
            className='text-foreground decoration-primary font-mono font-semibold underline decoration-2 underline-offset-2'
          >
            {task.jobRef}
          </Link>
        )}
      </p>
      {task.blockingReason && (
        <p className='text-destructive text-xs'>{task.blockingReason}</p>
      )}
    </li>
  );
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function ResultCard({
  card,
  onNavigate
}: {
  card: DisplayCard;
  /** Called when a link inside the card is followed (the mobile sheet closes). */
  onNavigate?: () => void;
}) {
  switch (card.kind) {
    case 'job_list':
      return (
        <CardShell
          title={`Jobs matching “${card.query}”`}
          meta={
            card.total > card.jobs.length
              ? `${card.jobs.length} of ${card.total}+`
              : count(card.jobs.length, 'match', 'matches')
          }
        >
          {card.jobs.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>
              No job you have access to matched.
            </p>
          ) : (
            <ul className='divide-y'>
              {card.jobs.map((job) => (
                <JobRow key={job.id} job={job} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </CardShell>
      );

    case 'job_summary':
      return (
        <CardShell title='Job' meta={card.job.jobRef}>
          <ul>
            <JobRow job={card.job} onNavigate={onNavigate} />
          </ul>
          <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t px-3 py-2 text-xs'>
            {card.facts.map((fact) => (
              <div key={fact.label} className='contents'>
                <dt className='text-muted-foreground'>{fact.label}</dt>
                <dd className='text-right font-medium'>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className='flex flex-wrap gap-1.5 border-t px-3 py-2'>
            <Badge variant='secondary'>
              {count(card.taskCounts.open, 'open task')}
            </Badge>
            {card.taskCounts.blocked > 0 && (
              <Badge variant='danger'>{card.taskCounts.blocked} blocked</Badge>
            )}
            {card.taskCounts.overdue > 0 && (
              <Badge variant='warning'>{card.taskCounts.overdue} overdue</Badge>
            )}
          </div>
        </CardShell>
      );

    case 'task_list': {
      // A list for one job already names it in the title.
      const showJob = new Set(card.tasks.map((t) => t.jobId)).size > 1;
      return (
        <CardShell title={card.title} meta={count(card.total, 'task')}>
          {card.tasks.length === 0 ? (
            <p className='text-muted-foreground px-3 py-3 text-sm'>
              Nothing here.
            </p>
          ) : (
            <ul className='divide-y'>
              {card.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  showJob={showJob}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
          {card.total > card.tasks.length && (
            <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
              Showing {card.tasks.length} of {card.total}.{' '}
              <Link
                href='/dashboard/tasks'
                onClick={onNavigate}
                className='text-foreground decoration-primary underline decoration-2 underline-offset-2'
              >
                Open Tasks
              </Link>{' '}
              for the full list.
            </p>
          )}
        </CardShell>
      );
    }

    case 'workflow':
      return (
        <CardShell title={card.title} meta={count(card.steps.length, 'step')}>
          <ol className='divide-y'>
            {card.steps.map((step) => (
              <li key={step.label} className='px-3 py-2'>
                <p className='text-sm font-medium'>{step.label}</p>
                {step.detail && (
                  <p className='text-muted-foreground text-xs'>{step.detail}</p>
                )}
              </li>
            ))}
          </ol>
          {card.footnote && (
            <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
              {card.footnote}
            </p>
          )}
        </CardShell>
      );
  }
}
