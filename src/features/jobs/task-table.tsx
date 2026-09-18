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
import Link from 'next/link';
import { dueState, formatDateTime } from './format';
import type { TaskListItem } from './server/queries';

export function TaskTable({
  tasks,
  showJob = true
}: {
  tasks: TaskListItem[];
  showJob?: boolean;
}) {
  if (tasks.length === 0) {
    return <EmptyState title='Nothing here' />;
  }
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            {showJob && <TableHead>Job</TableHead>}
            <TableHead>Owner</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const due = dueState(task.dueAt);
            return (
              <TableRow key={task.id}>
                <TableCell>
                  <span className='font-mono text-xs font-semibold'>
                    {task.code}
                  </span>
                  <span className='block'>{task.title}</span>
                  {task.blockingReason && (
                    <span className='text-destructive block text-xs'>
                      {task.blockingReason}
                    </span>
                  )}
                </TableCell>
                {showJob && (
                  <TableCell className='whitespace-nowrap'>
                    {task.jobId ? (
                      <Link
                        className='group/job'
                        href={`/dashboard/jobs/${task.jobId}`}
                      >
                        <span className='decoration-primary group-hover/job:decoration-foreground font-mono font-semibold underline decoration-2 underline-offset-4'>
                          {task.jobRef}
                        </span>
                        <span className='text-muted-foreground block text-xs'>
                          {task.jobName}
                        </span>
                      </Link>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                )}
                <TableCell>
                  {task.ownerName}
                  {task.backupName && (
                    <span className='text-muted-foreground block text-xs'>
                      backup: {task.backupName}
                    </span>
                  )}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {task.dueAt ? (
                    <span
                      className={
                        due === 'overdue'
                          ? 'text-destructive font-medium'
                          : due === 'today'
                            ? 'text-warning font-medium'
                            : ''
                      }
                    >
                      {formatDateTime(task.dueAt)}
                      {due === 'overdue' && ' · overdue'}
                      {due === 'today' && ' · today'}
                    </span>
                  ) : (
                    <span className='text-muted-foreground'>No due date</span>
                  )}
                </TableCell>
                <TableCell>
                  <TaskStatusBadge status={task.status} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
