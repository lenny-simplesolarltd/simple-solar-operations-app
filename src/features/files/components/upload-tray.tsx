'use client';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  evidenceFileProblem,
  evidenceMimeType,
  type EvidenceContext
} from '@/features/operations/evidence-rules';
import {
  beginEvidenceUpload,
  completeEvidenceUpload
} from '@/features/operations/evidence-upload';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconCheck,
  IconRefresh,
  IconX
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { plural } from '../format';

// The upload tray: what is happening to the files someone just dropped.
//
// One upload id per chosen file, kept across a retry, so retrying resumes the
// same registration instead of creating a second document. The registration
// names the folder, so a file dropped into a folder is filed there from the
// start rather than moved afterwards.
//
// Uploads keep running while the person navigates: the tray lives above the
// browser and is not unmounted by moving between folders.

export type UploadState =
  | { kind: 'waiting' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'done' }
  | { kind: 'failed'; message: string; retryable: boolean };

export interface UploadItem {
  /** Stable across retries - it IS the idempotency key. */
  uploadId: string;
  file: File;
  /** Where it is being filed, captured when it was dropped. */
  context: EvidenceContext;
  folderId: string | null;
  category?: string;
  state: UploadState;
}

/** At most this many bytes in flight at once, so a big drop stays responsive. */
const CONCURRENCY = 3;

export function useUploads(onFinished: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  /** How many are in flight, and which have already been picked up. */
  const running = useRef(0);
  const started = useRef<Set<string>>(new Set());

  const patch = useCallback((uploadId: string, state: UploadState) => {
    setItems((current) =>
      current.map((i) => (i.uploadId === uploadId ? { ...i, state } : i))
    );
  }, []);

  const run = useCallback(
    async (item: UploadItem) => {
      patch(item.uploadId, { kind: 'uploading', percent: 5 });

      const ticket = await beginEvidenceUpload({
        uploadId: item.uploadId,
        context: item.context,
        category: item.category,
        folderId: item.folderId,
        file: {
          name: item.file.name,
          type: item.file.type,
          size: item.file.size
        }
      });
      if (!ticket.ok) {
        patch(item.uploadId, {
          kind: 'failed',
          message: ticket.message,
          retryable: true
        });
        return;
      }

      if (ticket.token) {
        patch(item.uploadId, { kind: 'uploading', percent: 35 });
        const { error } = await createClient()
          .storage.from('evidence')
          .uploadToSignedUrl(ticket.path, ticket.token, item.file, {
            contentType: evidenceMimeType(item.file) ?? undefined
          });
        patch(item.uploadId, { kind: 'uploading', percent: 80 });
        // An error here is not final: the bytes may have arrived although the
        // answer was lost. The server check below is what decides.
        const done = await completeEvidenceUpload(ticket.evidenceId);
        if (!done.ok) {
          patch(item.uploadId, {
            kind: 'failed',
            message: error ? 'The upload failed. Try again.' : done.message,
            retryable: true
          });
          return;
        }
      }
      patch(item.uploadId, { kind: 'done' });
    },
    [patch]
  );

  // The scheduler is an effect rather than a self-calling function: whenever
  // the list changes it starts as many waiting uploads as the limit allows.
  // A finished upload nudges the list, which runs this again for the next one.
  useEffect(() => {
    const starting: UploadItem[] = [];
    for (const item of items) {
      if (running.current + starting.length >= CONCURRENCY) break;
      if (item.state.kind !== 'waiting' || started.current.has(item.uploadId))
        continue;
      started.current.add(item.uploadId);
      starting.push(item);
    }

    if (starting.length > 0) {
      running.current += starting.length;
      // Just after this render commits: run() reports progress immediately,
      // which must not be a state change made while the effect is still going.
      queueMicrotask(() => {
        for (const item of starting) {
          void run(item).finally(() => {
            running.current -= 1;
            // A new array identity, so this effect reconsiders the queue.
            setItems((current) => [...current]);
          });
        }
      });
      return;
    }

    if (
      running.current === 0 &&
      items.length > 0 &&
      items.every((i) => i.state.kind !== 'waiting')
    ) {
      onFinished();
    }
  }, [items, run, onFinished]);

  const add = useCallback(
    (
      files: File[],
      where: {
        context: EvidenceContext;
        folderId: string | null;
        category?: string;
      }
    ) => {
      const next: UploadItem[] = files.map((file) => {
        const problem = evidenceFileProblem(file);
        return {
          uploadId: crypto.randomUUID(),
          file,
          context: where.context,
          folderId: where.folderId,
          category: where.category,
          // Rejected before anything is sent, and said plainly.
          state: problem
            ? { kind: 'failed', message: problem, retryable: false }
            : { kind: 'waiting' }
        };
      });
      setItems((current) => [...current, ...next]);
    },
    []
  );

  const retry = useCallback(
    (uploadId: string) => {
      // The same upload id, so the server resumes the registration instead of
      // creating a second document.
      started.current.delete(uploadId);
      patch(uploadId, { kind: 'waiting' });
    },
    [patch]
  );

  const dismiss = useCallback((uploadId: string) => {
    setItems((current) => current.filter((i) => i.uploadId !== uploadId));
  }, []);

  const clearFinished = useCallback(() => {
    setItems((current) => current.filter((i) => i.state.kind !== 'done'));
  }, []);

  return { items, add, retry, dismiss, clearFinished };
}

function Row({
  item,
  onRetry,
  onDismiss
}: {
  item: UploadItem;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { state } = item;
  return (
    <li className='flex items-center gap-2 py-1.5 text-sm'>
      <span className='min-w-0 flex-1 truncate' title={item.file.name}>
        {item.file.name}
      </span>
      {state.kind === 'waiting' && (
        <span className='text-muted-foreground shrink-0 text-xs'>Waiting</span>
      )}
      {state.kind === 'uploading' && (
        <span className='flex w-28 shrink-0 items-center gap-2'>
          <Progress value={state.percent} className='h-1.5' />
          <span className='text-muted-foreground text-xs tabular-nums'>
            {state.percent}%
          </span>
        </span>
      )}
      {state.kind === 'done' && (
        <span className='text-success flex shrink-0 items-center gap-1 text-xs'>
          <IconCheck className='size-3.5' aria-hidden /> Complete
        </span>
      )}
      {state.kind === 'failed' && (
        <span className='text-destructive flex shrink-0 items-center gap-1.5 text-xs'>
          <IconAlertTriangle className='size-3.5 shrink-0' aria-hidden />
          <span className='max-w-56 truncate' title={state.message}>
            {state.message}
          </span>
          {state.retryable && (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='h-6 px-2'
              onClick={onRetry}
            >
              <IconRefresh className='size-3' aria-hidden /> Retry
            </Button>
          )}
        </span>
      )}
      <Button
        type='button'
        size='icon'
        variant='ghost'
        className='size-6 shrink-0'
        onClick={onDismiss}
      >
        <IconX className='size-3.5' aria-hidden />
        <span className='sr-only'>Dismiss {item.file.name}</span>
      </Button>
    </li>
  );
}

export function UploadTray({
  items,
  onRetry,
  onDismiss,
  onClearFinished,
  className
}: {
  items: UploadItem[];
  onRetry: (uploadId: string) => void;
  onDismiss: (uploadId: string) => void;
  onClearFinished: () => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  const active = items.filter(
    (i) => i.state.kind === 'waiting' || i.state.kind === 'uploading'
  ).length;
  const failed = items.filter((i) => i.state.kind === 'failed').length;
  const done = items.filter((i) => i.state.kind === 'done').length;

  return (
    <section
      aria-label='Uploads'
      className={cn('bg-card rounded-lg border p-3', className)}
    >
      <header className='flex items-center justify-between gap-2'>
        <p className='text-sm font-medium' aria-live='polite'>
          {active > 0
            ? `Uploading ${plural(active, 'file')}…`
            : failed > 0
              ? `${plural(failed, 'upload')} failed`
              : `Uploaded ${plural(done, 'file')}`}
        </p>
        {active === 0 && done > 0 && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={onClearFinished}
          >
            Clear finished
          </Button>
        )}
      </header>
      <ul className='mt-1 flex flex-col divide-y'>
        {items.map((item) => (
          <Row
            key={item.uploadId}
            item={item}
            onRetry={() => onRetry(item.uploadId)}
            onDismiss={() => onDismiss(item.uploadId)}
          />
        ))}
      </ul>
    </section>
  );
}
