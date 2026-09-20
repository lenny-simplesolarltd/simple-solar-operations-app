'use client';

import { Badge } from '@/components/ui/badge';
import type {
  BatchOperation,
  BatchProgress,
  BatchRow,
  BatchStatus
} from '@/lib/backend/models';

/** Staff wording for the bulk operations (the request forms they replace). */
export const BATCH_LABEL: Record<BatchOperation, string> = {
  TASK_BATCH_COMPLETE: 'Complete tasks',
  TASK_BATCH_OVERRIDE_COMPLETE: 'Complete tasks (override)',
  TASK_BATCH_REOPEN: 'Reopen tasks',
  TASK_BATCH_REASSIGN: 'Reassign tasks'
};

type Variant = 'success' | 'warning' | 'danger' | 'outline' | 'secondary';

export const BATCH_STATUS_VARIANT: Record<BatchStatus, Variant> = {
  Queued: 'secondary',
  Processing: 'secondary',
  Completed: 'success',
  CompletedWithErrors: 'warning',
  Cancelled: 'outline'
};

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  Queued: 'Queued',
  Processing: 'Processing',
  Completed: 'Complete',
  CompletedWithErrors: 'Needs attention',
  Cancelled: 'Cancelled'
};

/**
 * "10 complete · 1 retrying · 1 needs review" - only the parts that are
 * non-zero, so a clean run reads as one short line.
 */
export function progressParts(p: BatchProgress): string[] {
  const parts: string[] = [];
  if (p.succeeded) parts.push(`${p.succeeded} done`);
  if (p.processing) parts.push(`${p.processing} running`);
  if (p.pending) parts.push(`${p.pending} queued`);
  if (p.retrying) parts.push(`${p.retrying} retrying`);
  if (p.needs_review) parts.push(`${p.needs_review} needs review`);
  if (p.failed) parts.push(`${p.failed} failed`);
  if (p.skipped) parts.push(`${p.skipped} nothing to do`);
  if (p.cancelled) parts.push(`${p.cancelled} cancelled`);
  return parts;
}

export function BatchProgressLine({ batch }: { batch: BatchRow }) {
  const parts = progressParts(batch.progress);
  return (
    <span className='text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs'>
      <Badge
        variant={BATCH_STATUS_VARIANT[batch.status]}
        className='px-1.5 py-0 text-[10px]'
      >
        {BATCH_STATUS_LABEL[batch.status]}
      </Badge>
      {parts.length > 0 ? parts.join(' · ') : `${batch.progress.total} tasks`}
    </span>
  );
}
