'use client';

import { EmptyState } from '@/components/empty-state';
import { TaskStatusBadge } from '@/components/task-status-badge';
import { Checkbox } from '@/components/ui/checkbox';
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

/**
 * Selection and in-flight state, supplied only by the screen that offers bulk
 * actions. Without it the list is exactly what it was: a read-only table.
 */
export interface TaskListSelection {
  selected: ReadonlySet<string>;
  onToggle: (taskId: string, next: boolean) => void;
  onTogglePage: (next: boolean) => void;
  /** taskId -> what is happening to it right now ("Completing...", "Reopening..."). */
  pending: ReadonlyMap<string, string>;
  /** taskId -> why the last attempt did not happen. */
  failed: ReadonlyMap<string, string>;
  /** A task that cannot take part in bulk work at all (a call task, cancellation work). */
  isSelectable: (task: TaskView) => boolean;
}

/** What is happening to a row, in the row itself (never a fake status badge). */
function RowState({
  task,
  selection
}: {
  task: TaskView;
  selection?: TaskListSelection;
}) {
  const pending = selection?.pending.get(task.id);
  const failed = selection?.failed.get(task.id);
  if (pending) {
    return (
      <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        <span
          className='border-muted-foreground/40 border-t-primary size-3 animate-spin rounded-full border-2'
          aria-hidden
        />
        {pending}
      </span>
    );
  }
  if (failed) {
    return <span className='text-destructive block text-xs'>{failed}</span>;
  }
  return null;
}

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
  emptyDescription,
  selection
}: {
  tasks: TaskView[];
  showOwner?: boolean;
  showCompleted?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  selection?: TaskListSelection;
}) {
  const selectableTasks = selection
    ? tasks.filter((t) => selection.isSelectable(t))
    : [];
  const selectedHere = selectableTasks.filter((t) =>
    selection?.selected.has(t.id)
  ).length;
  const allSelected =
    selectableTasks.length > 0 && selectedHere === selectableTasks.length;
  const someSelected = selectedHere > 0 && !allSelected;

  if (tasks.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <>
      <div className='hidden overflow-x-auto rounded-lg border md:block'>
        <Table>
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className='w-10'>
                  <Checkbox
                    aria-label={
                      allSelected
                        ? 'Clear selection'
                        : `Select all ${selectableTasks.length} tasks on this page`
                    }
                    checked={
                      allSelected
                        ? true
                        : someSelected
                          ? 'indeterminate'
                          : false
                    }
                    disabled={selectableTasks.length === 0}
                    onCheckedChange={(v) => selection.onTogglePage(v === true)}
                  />
                </TableHead>
              )}
              <TableHead>Task</TableHead>
              <TableHead>Job</TableHead>
              {showOwner && <TableHead>Owner</TableHead>}
              <TableHead>{showCompleted ? 'Completed' : 'Due'}</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow
                key={task.id}
                data-state={
                  selection?.selected.has(task.id) ? 'selected' : undefined
                }
                className={
                  selection?.pending.has(task.id)
                    ? 'opacity-60 transition-opacity'
                    : undefined
                }
              >
                {selection && (
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${task.template_code ?? ''} ${task.title}`}
                      checked={selection.selected.has(task.id)}
                      disabled={
                        !selection.isSelectable(task) ||
                        selection.pending.has(task.id)
                      }
                      onCheckedChange={(v) =>
                        selection.onToggle(task.id, v === true)
                      }
                    />
                  </TableCell>
                )}
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
                  <RowState task={task} selection={selection} />
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
                      {task.completion_mode === 'override' && (
                        <span className='text-warning block text-xs'>
                          by override
                        </span>
                      )}
                    </span>
                  ) : (
                    <DueLabel task={task} />
                  )}
                </TableCell>
                <TableCell>
                  <TaskStatusBadge status={task.status} />
                  {task.completion_mode === 'override' && (
                    <span
                      className='text-warning block text-xs'
                      title={task.override_reason ?? undefined}
                    >
                      Override
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className='flex flex-col gap-2 md:hidden'>
        {tasks.map((task) => (
          <li
            key={task.id}
            className={`bg-card rounded-lg border p-3 ${
              selection?.pending.has(task.id) ? 'opacity-60' : ''
            } ${selection?.selected.has(task.id) ? 'ring-primary ring-2' : ''}`}
          >
            <div className='flex items-start gap-2'>
              {selection && (
                <Checkbox
                  className='mt-1'
                  aria-label={`Select ${task.template_code ?? ''} ${task.title}`}
                  checked={selection.selected.has(task.id)}
                  disabled={
                    !selection.isSelectable(task) ||
                    selection.pending.has(task.id)
                  }
                  onCheckedChange={(v) =>
                    selection.onToggle(task.id, v === true)
                  }
                />
              )}
              <Link
                href={`/dashboard/tasks/${task.id}`}
                className='block flex-1'
              >
                <div className='flex items-start justify-between gap-2'>
                  <span className='text-muted-foreground font-mono text-xs font-semibold'>
                    {task.template_code}
                  </span>
                  <TaskStatusBadge status={task.status} />
                </div>
                <p className='mt-1 font-medium'>{task.title}</p>
              </Link>
            </div>
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
            <RowState task={task} selection={selection} />
          </li>
        ))}
      </ul>
    </>
  );
}
