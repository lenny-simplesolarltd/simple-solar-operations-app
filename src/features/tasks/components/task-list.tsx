import { EmptyState } from '@/components/empty-state';
import { TaskStatusBadge } from '@/components/task-status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { formatDateTime } from '@/features/jobs/format';
import type { TaskView } from '@/lib/backend/models';
import Link from 'next/link';
import { DueLabel } from './due-label';

function JobCell({ task }: { task: TaskView }) {
  if (!task.job_id) return <span className='text-muted-foreground'>-</span>;
  const label = (
    <>
      <span className='font-mono font-semibold'>{task.job_ref}</span>
      <span className='text-muted-foreground block text-xs'>
        {task.customer_redacted
          ? 'Customer hidden'
          : [task.customer_name, task.postcode].filter(Boolean).join(' · ')}
      </span>
    </>
  );
  // A redacted row is a job this person cannot open; do not offer the link.
  return task.customer_redacted ? (
    <span>{label}</span>
  ) : (
    <Link href={`/dashboard/jobs/${task.job_id}`} className='hover:underline'>
      {label}
    </Link>
  );
}

/**
 * Task rows from the TASKS read model: a table from tablet width up, cards on
 * phones. The title opens the task (actions live on the task page).
 */
export function TaskList({
  tasks,
  showOwner = true,
  showCompleted = false,
  emptyTitle = 'Nothing here',
  emptyDescription
}: {
  tasks: TaskView[];
  showOwner?: boolean;
  showCompleted?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (tasks.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <>
      <div className='hidden overflow-x-auto rounded-lg border md:block'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Job</TableHead>
              {showOwner && <TableHead>Owner</TableHead>}
              <TableHead>{showCompleted ? 'Completed' : 'Due'}</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className='max-w-md'>
                  <Link
                    href={`/dashboard/tasks/${task.id}`}
                    className='group/task block'
                  >
                    <span className='text-muted-foreground font-mono text-xs font-semibold'>
                      {task.template_code}
                    </span>
                    <span className='decoration-primary block group-hover/task:underline group-hover/task:decoration-2 group-hover/task:underline-offset-4'>
                      {task.title}
                    </span>
                  </Link>
                  {task.blocking_reason && (
                    <span className='text-warning block font-mono text-xs'>
                      {task.blocking_reason}
                    </span>
                  )}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  <JobCell task={task} />
                </TableCell>
                {showOwner && (
                  <TableCell>
                    {task.owner_name ?? 'Unassigned'}
                    {task.backup_name && (
                      <span className='text-muted-foreground block text-xs'>
                        backup: {task.backup_name}
                      </span>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  {showCompleted && task.completed_at ? (
                    <span className='whitespace-nowrap'>
                      {formatDateTime(task.completed_at)}
                      {task.completed_by_name && (
                        <span className='text-muted-foreground block text-xs'>
                          {task.completed_by_name}
                        </span>
                      )}
                    </span>
                  ) : (
                    <DueLabel task={task} />
                  )}
                </TableCell>
                <TableCell>
                  <TaskStatusBadge status={task.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className='flex flex-col gap-2 md:hidden'>
        {tasks.map((task) => (
          <li key={task.id} className='bg-card rounded-lg border p-3'>
            <Link href={`/dashboard/tasks/${task.id}`} className='block'>
              <div className='flex items-start justify-between gap-2'>
                <span className='text-muted-foreground font-mono text-xs font-semibold'>
                  {task.template_code}
                </span>
                <TaskStatusBadge status={task.status} />
              </div>
              <p className='mt-1 font-medium'>{task.title}</p>
            </Link>
            <div className='mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm'>
              <JobCell task={task} />
              {showCompleted && task.completed_at ? (
                <span className='text-muted-foreground text-xs'>
                  {formatDateTime(task.completed_at)}
                </span>
              ) : (
                <DueLabel task={task} className='text-xs' />
              )}
            </div>
            {showOwner && (
              <p className='text-muted-foreground mt-1 text-xs'>
                {task.owner_name ?? 'Unassigned'}
                {task.backup_name && ` · backup ${task.backup_name}`}
              </p>
            )}
            {task.blocking_reason && (
              <p className='text-warning mt-1 font-mono text-xs'>
                {task.blocking_reason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
