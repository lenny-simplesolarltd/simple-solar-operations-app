import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import type { JobRow } from '@/lib/backend/models';
import Link from 'next/link';
import { dueState, formatDate } from '../format';
import { stageLabel } from '../stages';

function NextTask({ job }: { job: JobRow }) {
  if (!job.next_task)
    return <span className='text-muted-foreground'>No open tasks</span>;
  const due = job.next_task.due_at ? dueState(job.next_task.due_at) : 'none';
  return (
    <span className='block min-w-0'>
      <Link
        href={`/dashboard/tasks/${job.next_task.id}`}
        className='block truncate hover:underline'
      >
        {job.next_task.title}
      </Link>
      <span className='text-muted-foreground text-xs'>
        {job.next_task.owner_name ?? 'Unassigned'}
        {job.next_task.due_at && (
          <span className={due === 'overdue' ? 'text-destructive' : undefined}>
            {' '}
            · {formatDate(job.next_task.due_at)}
          </span>
        )}
      </span>
    </span>
  );
}

function Counts({ job }: { job: JobRow }) {
  return (
    <span className='text-sm tabular-nums'>
      {job.open_tasks}
      {job.overdue_tasks > 0 && (
        <span className='text-destructive ml-1 text-xs font-medium'>
          ({job.overdue_tasks} late)
        </span>
      )}
    </span>
  );
}

/** JOBS rows: table from tablet width, cards on phones. */
export function JobList({ jobs }: { jobs: JobRow[] }) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        title='No jobs found'
        description='Try a different search or stage.'
      />
    );
  }
  return (
    <>
      <div className='hidden overflow-x-auto rounded-lg border md:block'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className='hidden lg:table-cell'>Sold</TableHead>
              <TableHead>Open tasks</TableHead>
              <TableHead>Next task</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className='whitespace-nowrap'>
                  <Link
                    href={`/dashboard/jobs/${job.id}`}
                    className='group/job'
                  >
                    <span className='decoration-primary font-mono font-semibold underline decoration-2 underline-offset-4'>
                      {job.job_ref}
                    </span>
                    <span className='text-muted-foreground block text-xs'>
                      {[job.customer_name, job.postcode]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant='outline'>
                    {stageLabel(job.workflow_stage)}
                  </Badge>
                </TableCell>
                <TableCell className='hidden whitespace-nowrap lg:table-cell'>
                  {job.sold_at ? formatDate(job.sold_at) : '-'}
                  {job.salesperson_name && (
                    <span className='text-muted-foreground block text-xs'>
                      {job.salesperson_name}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Counts job={job} />
                </TableCell>
                <TableCell className='max-w-xs'>
                  <NextTask job={job} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className='flex flex-col gap-2 md:hidden'>
        {jobs.map((job) => (
          <li key={job.id} className='bg-card rounded-lg border p-3'>
            <Link
              href={`/dashboard/jobs/${job.id}`}
              className='flex items-start justify-between gap-2'
            >
              <span>
                <span className='font-mono font-semibold'>{job.job_ref}</span>
                <span className='text-muted-foreground block text-xs'>
                  {[job.customer_name, job.postcode]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Badge variant='outline'>{stageLabel(job.workflow_stage)}</Badge>
            </Link>
            <div className='mt-2 flex items-start justify-between gap-3 text-sm'>
              <NextTask job={job} />
              <Counts job={job} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
