'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { getBatches } from '@/features/tasks/server/batch';
import type { BatchRow } from '@/lib/backend/models';
import { IconActivity, IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BATCH_LABEL, BatchProgressLine } from './batch-progress';

/**
 * "Processing 3" in the header.
 *
 * It reads the authoritative BATCHES list rather than keeping a client-side
 * record of what this tab started, so it is right after a navigation, after a
 * reload, and for work the person started somewhere else (SimpleBot, another
 * tab). It polls quickly only while something is actually running.
 */

const ACTIVE_MS = 2000;
const IDLE_MS = 60000;

export function ProcessingIndicator() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    const poll = async () => {
      const result = await getBatches({ limit: 8 });
      if (!live) return;
      const rows = result.ok ? result.data.batches : [];
      setBatches(rows);
      const active = rows.some(
        (b) => b.status === 'Queued' || b.status === 'Processing'
      );
      timer.current = setTimeout(poll, active ? ACTIVE_MS : IDLE_MS);
    };
    void poll();
    // A batch submitted on this page: start watching straight away rather than
    // waiting out the idle interval.
    const onStarted = () => {
      if (timer.current) clearTimeout(timer.current);
      void poll();
    };
    window.addEventListener('ss:batch-started', onStarted);
    return () => {
      live = false;
      window.removeEventListener('ss:batch-started', onStarted);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const active = batches.filter(
    (b) => b.status === 'Queued' || b.status === 'Processing'
  );
  const attention = batches.filter(
    (b) =>
      b.status === 'CompletedWithErrors' &&
      b.progress.needs_review + b.progress.failed > 0
  );

  // Nothing running and nothing waiting on a person: stay out of the way.
  if (active.length === 0 && attention.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='gap-2'
          aria-label={
            active.length > 0
              ? `${active.length} operations processing`
              : `${attention.length} operations need attention`
          }
        >
          {active.length > 0 ? (
            <>
              <span
                className='border-muted-foreground/40 border-t-primary size-3.5 animate-spin rounded-full border-2'
                aria-hidden
              />
              <span className='hidden sm:inline'>
                Processing {active.length}
              </span>
            </>
          ) : (
            <>
              <IconActivity className='text-warning size-4' />
              <span className='hidden sm:inline'>
                {attention.length} need attention
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-0'>
        <p className='border-b px-3 py-2 text-sm font-medium'>
          Recent operations
        </p>
        <ul className='max-h-80 overflow-y-auto'>
          {batches.slice(0, 6).map((b) => (
            <li key={b.batch_id} className='border-b px-3 py-2 last:border-0'>
              <Link
                href={`/dashboard/operations?batch=${b.batch_id}`}
                className='block'
                onClick={() => setOpen(false)}
              >
                <span className='flex items-center justify-between gap-2'>
                  <span className='truncate text-sm'>
                    {BATCH_LABEL[b.operation] ?? b.operation}
                  </span>
                  {b.source === 'simplebot' && (
                    <Badge variant='outline' className='shrink-0 text-xs'>
                      SimpleBot
                    </Badge>
                  )}
                </span>
                <BatchProgressLine batch={b} />
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href='/dashboard/operations'
          className='hover:bg-muted flex items-center justify-between px-3 py-2 text-sm'
          onClick={() => setOpen(false)}
        >
          All operations
          <IconArrowRight className='size-4' />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
