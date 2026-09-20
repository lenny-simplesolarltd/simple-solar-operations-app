'use client';

import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconAlertCircle, IconLoader2 } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { readUnscheduled } from '../actions';
import { formatMedium } from '../calendar/range';
import type { UnscheduledWork } from '../types';

/**
 * Work that is ready to schedule and has no slot.
 *
 * "Ready" is the database's own predicate (PLANNER_UNSCHEDULED: an actionable
 * Live job, required work, no planned dates), not "every Live job". Dragging
 * one onto the calendar opens the allocate dialog for that day - a date alone
 * cannot schedule work, because PLAN_WORK_PACKAGE needs an installer too, and
 * that choice is where readiness is checked for the dates chosen.
 */
export function UnscheduledPanel({
  canPlan,
  onSchedule,
  onLoaded,
  refreshKey
}: {
  canPlan: boolean;
  onSchedule: (work: UnscheduledWork, day?: string) => void;
  /** Hands the loaded list up, so a drop on a day can resolve what was dragged. */
  onLoaded: (work: UnscheduledWork[]) => void;
  /** Changes whenever a command succeeded, so the list re-reads. */
  refreshKey: number;
}) {
  const [data, setData] = useState<{
    total: number;
    work: UnscheduledWork[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      const r = await readUnscheduled({ limit: 50 });
      if (r.ok) {
        setData({ total: r.data.total, work: r.data.work });
        setError(null);
        onLoaded(r.data.work);
      } else {
        setData(null);
        setError(r.error.message);
        onLoaded([]);
      }
    });
    // onLoaded is a stable callback from the board; re-reading is driven by
    // refreshKey alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <aside className='flex w-full flex-col gap-2 lg:w-72 lg:shrink-0'>
      <div className='flex items-baseline justify-between gap-2'>
        <h2 className='text-sm font-semibold'>Needs scheduling</h2>
        {data && data.total > data.work.length && (
          <span className='text-muted-foreground text-xs'>
            {data.work.length} of {data.total}
          </span>
        )}
      </div>

      {loading && !data && (
        <p className='text-muted-foreground flex items-center gap-2 text-sm'>
          <IconLoader2 className='size-4 animate-spin' /> Loading…
        </p>
      )}
      {error && <p className='text-destructive text-sm'>{error}</p>}
      {data && data.work.length === 0 && (
        <EmptyState
          title='Nothing waiting'
          description='Every piece of required work on an actionable job has dates.'
        />
      )}

      <ul className='flex max-h-[28rem] flex-col gap-2 overflow-y-auto lg:max-h-[calc(100vh-16rem)]'>
        {data?.work.map((w) => (
          <li
            key={w.work_package_id}
            draggable={canPlan}
            onDragStart={(e) => {
              e.dataTransfer.setData(
                'application/x-planner-unscheduled',
                w.work_package_id
              );
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className='bg-card flex flex-col gap-1 rounded-lg border p-2 text-xs'
          >
            <span className='flex items-center justify-between gap-2'>
              <Link
                href={`/dashboard/jobs/${w.job_id}`}
                className='font-mono font-semibold hover:underline'
              >
                {w.job_ref}
              </Link>
              <Badge variant='secondary'>{w.trade}</Badge>
            </span>
            <span className='truncate'>{w.job_display}</span>
            {(w.town || w.postcode) && (
              <span className='text-muted-foreground truncate'>
                {[w.town, w.postcode].filter(Boolean).join(' · ')}
              </span>
            )}
            {w.need_by_date && (
              <span className='text-muted-foreground'>
                Needed by {formatMedium(w.need_by_date)}
              </span>
            )}
            {w.scaffold?.erect_planned_at && (
              <span className='text-muted-foreground'>
                Scaffold up {formatMedium(w.scaffold.erect_planned_at)}
              </span>
            )}
            {w.open_issues > 0 && (
              <span className='text-warning flex items-center gap-1'>
                <IconAlertCircle className='size-3.5' />
                {w.open_issues} open issue{w.open_issues === 1 ? '' : 's'}
              </span>
            )}
            {canPlan && (
              <Button
                size='sm'
                variant='outline'
                className='mt-1 h-7'
                onClick={() => onSchedule(w)}
              >
                Schedule
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canPlan && data && data.work.length > 0 && (
        <p className='text-muted-foreground text-xs'>
          Drag one onto a day, or use Schedule. You will choose the installer
          before anything is booked.
        </p>
      )}
    </aside>
  );
}
