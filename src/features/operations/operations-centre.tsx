'use client';

import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { formatDateTime } from '@/features/jobs/format';
import {
  cancelBatch,
  getBatchProgress,
  getBatches,
  retryBatch
} from '@/features/tasks/server/batch';
import type {
  BatchDetailRead,
  BatchItemRow,
  BatchRow
} from '@/lib/backend/models';
import { IconLoader2, IconRotate, IconX } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BATCH_LABEL,
  BATCH_STATUS_LABEL,
  BATCH_STATUS_VARIANT,
  progressParts
} from './batch-progress';

/**
 * The processing centre: what is running, what succeeded, what did not and
 * why. Everything shown is the authoritative per-item state from the database,
 * so it reads the same whether the operation came from the Tasks screen,
 * SimpleBot or the recovery sweep.
 */

const ACTIVE_MS = 2000;

const ITEM_VARIANT: Record<
  string,
  'success' | 'warning' | 'danger' | 'outline' | 'secondary'
> = {
  Succeeded: 'success',
  Processing: 'secondary',
  Pending: 'secondary',
  RetryDue: 'warning',
  NeedsReview: 'warning',
  Failed: 'danger',
  Cancelled: 'outline',
  Skipped: 'outline'
};

const ITEM_LABEL: Record<string, string> = {
  Succeeded: 'Done',
  Processing: 'Running',
  Pending: 'Queued',
  RetryDue: 'Retrying',
  NeedsReview: 'Needs review',
  Failed: 'Failed',
  Cancelled: 'Cancelled',
  Skipped: 'Nothing to do'
};

function ItemRow({ item }: { item: BatchItemRow }) {
  return (
    <TableRow>
      <TableCell className='whitespace-nowrap'>
        <Link
          href={`/dashboard/tasks/${item.task_id}`}
          className='hover:underline'
        >
          <span className='text-muted-foreground font-mono text-xs font-semibold'>
            {item.template_code}
          </span>
          <span className='block text-sm'>{item.title}</span>
        </Link>
      </TableCell>
      <TableCell className='whitespace-nowrap'>
        {item.job_id ? (
          <Link
            href={`/dashboard/jobs/${item.job_id}`}
            className='font-mono text-sm hover:underline'
          >
            {item.job_ref}
          </Link>
        ) : (
          <span className='text-muted-foreground'>-</span>
        )}
      </TableCell>
      <TableCell className='text-sm'>{item.owner_name ?? '-'}</TableCell>
      <TableCell>
        <Badge variant={ITEM_VARIANT[item.status] ?? 'outline'}>
          {ITEM_LABEL[item.status] ?? item.status}
        </Badge>
        {item.completion_mode === 'override' && (
          <Badge variant='warning' className='ml-1'>
            Override
          </Badge>
        )}
        {item.error_detail && (
          <span className='text-muted-foreground mt-0.5 block text-xs'>
            {item.error_detail}
          </span>
        )}
        {item.attempt_count > 1 && (
          <span className='text-muted-foreground block text-xs'>
            {item.attempt_count} attempts
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

function BatchDetail({
  batchId,
  onChanged
}: {
  batchId: string;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<BatchDetailRead | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so re-rendering the parent never restarts the watcher.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  // Bumping this re-runs the watcher after a retry or a cancel.
  const [round, setRound] = useState(0);
  const reload = () => setRound((n) => n + 1);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await getBatchProgress(batchId);
      if (!live || !r.ok) return;
      setDetail(r.data);
      if (r.data.status === 'Queued' || r.data.status === 'Processing') {
        timer.current = setTimeout(load, ACTIVE_MS);
      } else {
        onChangedRef.current();
      }
    };
    void load();
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [batchId, round]);

  if (!detail) {
    return (
      <p className='text-muted-foreground flex items-center gap-2 p-4 text-sm'>
        <IconLoader2 className='size-4 animate-spin' /> Loading…
      </p>
    );
  }

  const retryable = detail.items.filter((i) => i.retryable);
  const running = detail.status === 'Queued' || detail.status === 'Processing';
  const reason =
    (detail.payload.override_reason as string) ??
    (detail.payload.reopen_reason as string) ??
    (detail.payload.reason as string) ??
    (detail.payload.completion_note as string) ??
    null;

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='text-lg font-semibold'>
          {BATCH_LABEL[detail.operation] ?? detail.operation}
        </h2>
        <Badge variant={BATCH_STATUS_VARIANT[detail.status]}>
          {BATCH_STATUS_LABEL[detail.status]}
        </Badge>
        {detail.source === 'simplebot' && (
          <Badge variant='outline'>Asked for in SimpleBot</Badge>
        )}
        <span className='text-muted-foreground text-sm'>
          {progressParts(detail.progress).join(' · ')}
        </span>
      </div>
      <p className='text-muted-foreground text-sm'>
        Requested by {detail.requested_by} · {formatDateTime(detail.created_at)}
        {detail.finished_at &&
          ` · finished ${formatDateTime(detail.finished_at)}`}
      </p>
      {reason && (
        <p className='text-sm'>
          <span className='text-muted-foreground'>Reason: </span>
          {reason}
        </p>
      )}

      <div className='flex flex-wrap gap-2'>
        {retryable.length > 0 && (
          <Button
            size='sm'
            variant='outline'
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await retryBatch(batchId);
              setBusy(false);
              if (r.ok) {
                toast.success(`Retrying ${r.queued}`);
                reload();
              } else {
                toast.error(r.outcome.message);
              }
            }}
          >
            <IconRotate className='size-4' />
            Retry {retryable.length} needing review
          </Button>
        )}
        {running && (
          <Button
            size='sm'
            variant='outline'
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await cancelBatch(batchId);
              setBusy(false);
              if (r.ok) {
                toast.success('Cancelled what had not started');
                reload();
              } else {
                toast.error(r.outcome.message);
              }
            }}
          >
            <IconX className='size-4' />
            Cancel remaining
          </Button>
        )}
      </div>

      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.items.map((i) => (
              <ItemRow key={i.item_id} item={i} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function OperationsCentre({
  initial,
  canSeeEveryone
}: {
  initial: BatchRow[];
  canSeeEveryone: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get('batch');
  const [batches, setBatches] = useState(initial);
  const [everyone, setEveryone] = useState(false);

  // The initial list is rendered from the server, so there is nothing to fetch
  // on mount: this runs when the person switches Mine/Everyone, or when a
  // watched operation settles.
  const refresh = useCallback(
    async (all = everyone) => {
      const r = await getBatches({ limit: 40, all });
      if (r.ok) setBatches(r.data.batches);
    },
    [everyone]
  );

  const showEveryone = (all: boolean) => {
    setEveryone(all);
    void refresh(all);
  };

  const select = (batchId: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (batchId) next.set('batch', batchId);
    else next.delete('batch');
    router.replace(`/dashboard/operations?${next.toString()}`, {
      scroll: false
    });
  };

  return (
    <div className='flex flex-col gap-4'>
      {canSeeEveryone && (
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant={everyone ? 'outline' : 'default'}
            onClick={() => showEveryone(false)}
          >
            Mine
          </Button>
          <Button
            size='sm'
            variant={everyone ? 'default' : 'outline'}
            onClick={() => showEveryone(true)}
          >
            Everyone
          </Button>
        </div>
      )}

      {selected && (
        <div className='rounded-lg border p-4'>
          <Button
            size='sm'
            variant='ghost'
            className='mb-2'
            onClick={() => select(null)}
          >
            ← All operations
          </Button>
          <BatchDetail batchId={selected} onChanged={() => void refresh()} />
        </div>
      )}

      {!selected &&
        (batches.length === 0 ? (
          <EmptyState
            title='No operations yet'
            description='Bulk actions from the Tasks screen and from SimpleBot appear here.'
          />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operation</TableHead>
                  {everyone && <TableHead>Requested by</TableHead>}
                  <TableHead>Started</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow
                    key={b.batch_id}
                    className='cursor-pointer'
                    onClick={() => select(b.batch_id)}
                  >
                    <TableCell>
                      <button
                        type='button'
                        className='text-left hover:underline'
                        onClick={(e) => {
                          e.stopPropagation();
                          select(b.batch_id);
                        }}
                      >
                        {BATCH_LABEL[b.operation] ?? b.operation}
                      </button>
                      <span className='text-muted-foreground block text-xs'>
                        {b.total} {b.total === 1 ? 'task' : 'tasks'}
                        {b.source === 'simplebot' && ' · SimpleBot'}
                      </span>
                    </TableCell>
                    {everyone && (
                      <TableCell className='text-sm'>
                        {b.requested_by}
                      </TableCell>
                    )}
                    <TableCell className='text-sm whitespace-nowrap'>
                      {formatDateTime(b.started_at ?? b.created_at)}
                    </TableCell>
                    <TableCell className='text-muted-foreground text-sm'>
                      {progressParts(b.progress).join(' · ')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={BATCH_STATUS_VARIANT[b.status]}>
                        {BATCH_STATUS_LABEL[b.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
    </div>
  );
}
