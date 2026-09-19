import { formatDate } from '@/features/jobs/format';
import type { TaskView } from '@/lib/backend/models';
import { cn } from '@/lib/utils';

/** Due date with the server's due class (judged on the Europe/London day). */
export function DueLabel({
  task,
  className
}: {
  task: Pick<TaskView, 'due_at' | 'due_class' | 'days_delta' | 'status'>;
  className?: string;
}) {
  if (!task.due_at)
    return (
      <span className={cn('text-muted-foreground', className)}>
        No due date
      </span>
    );
  const closed = ['Complete', 'Cancelled', 'NotRequired'].includes(task.status);
  const late = !closed && task.due_class === 'OVERDUE';
  const today = !closed && task.due_class === 'DUE_TODAY';
  return (
    <span
      className={cn(
        'whitespace-nowrap',
        late && 'text-destructive font-medium',
        today && 'text-warning font-medium',
        className
      )}
    >
      {formatDate(task.due_at)}
      {late && ` · ${-(task.days_delta ?? 0)}d late`}
      {today && ' · today'}
      {!closed && task.due_class === 'DUE_TOMORROW' && ' · tomorrow'}
    </span>
  );
}
