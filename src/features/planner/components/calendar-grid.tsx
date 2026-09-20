'use client';

import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { CalendarEvent } from '../calendar/events';
import { byDay } from '../calendar/events';
import type { Day, ViewId } from '../calendar/range';
import {
  eachDay,
  formatDayNumber,
  formatLong,
  formatWeekday,
  isWeekend,
  startOfMonth,
  weekRows
} from '../calendar/range';
import { EventChip, EventLine } from './event-chip';

interface GridProps {
  view: ViewId;
  from: Day;
  to: Day;
  events: CalendarEvent[];
  holidays: Set<Day>;
  today: Day;
  /** The month being shown, so a month grid can dim its neighbours' days. */
  anchor: Day;
  selectedId: string | null;
  onSelect: (event: CalendarEvent) => void;
  /** Absent when the user may not plan: the grid then has no drop targets. */
  onDrop?: (event: CalendarEvent, day: Day) => void;
  /** A piece of unscheduled work dragged in from the sidebar. */
  onDropUnscheduled?: (workPackageId: string, day: Day) => void;
}

/** The drag type the "Needs scheduling" sidebar puts on the drag payload. */
export const UNSCHEDULED_DRAG_TYPE = 'application/x-planner-unscheduled';

/** Shared day-cell chrome: weekend/holiday shading and the today marker. */
function dayClasses(
  day: Day,
  today: Day,
  holidays: Set<Day>,
  outside: boolean,
  isDropTarget: boolean
) {
  return cn(
    'flex flex-col gap-1 border-t border-l p-1 align-top',
    (isWeekend(day) || holidays.has(day)) && 'bg-muted/50',
    outside && 'opacity-45',
    day === today && 'bg-primary/5 ring-primary/40 ring-1 ring-inset',
    isDropTarget && 'bg-accent ring-primary ring-2 ring-inset'
  );
}

function DayHeader({
  day,
  today,
  holidays,
  showWeekday
}: {
  day: Day;
  today: Day;
  holidays: Set<Day>;
  showWeekday?: boolean;
}) {
  return (
    <span className='flex items-baseline gap-1 text-[11px]'>
      {showWeekday && (
        <span className='text-muted-foreground'>{formatWeekday(day)}</span>
      )}
      <span
        className={cn(
          'tabular-nums',
          day === today &&
            'bg-primary text-primary-foreground rounded px-1 font-semibold'
        )}
      >
        {formatDayNumber(day)}
      </span>
      {holidays.has(day) && (
        <span className='text-muted-foreground truncate'>Holiday</span>
      )}
    </span>
  );
}

/**
 * The calendar surface.
 *
 * Week grids (3 weeks, 6 weeks, month) are a seven-column table of whole
 * weeks. Day and Week are the same cells in a single row, with more room per
 * event. Both are all-day: no time axis exists, because no operational date
 * in this system carries a time.
 */
export function CalendarGrid({
  view,
  from,
  to,
  events,
  holidays,
  today,
  anchor,
  selectedId,
  onSelect,
  onDrop,
  onDropUnscheduled
}: GridProps) {
  const [dragging, setDragging] = useState<CalendarEvent | null>(null);
  const [over, setOver] = useState<Day | null>(null);
  const buckets = byDay(events, from, to);
  const month = startOfMonth(anchor).slice(0, 7);
  const accepts = !!onDrop || !!onDropUnscheduled;

  const isUnscheduledDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(UNSCHEDULED_DRAG_TYPE);

  const dropHandlers = (day: Day) =>
    accepts
      ? {
          onDragOver: (e: React.DragEvent) => {
            const unscheduled = isUnscheduledDrag(e);
            if (!dragging && !(unscheduled && onDropUnscheduled)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = unscheduled ? 'copy' : 'move';
            setOver(day);
          },
          onDragLeave: () => setOver((d) => (d === day ? null : d)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setOver(null);
            if (isUnscheduledDrag(e) && onDropUnscheduled) {
              const id = e.dataTransfer.getData(UNSCHEDULED_DRAG_TYPE);
              if (id) onDropUnscheduled(id, day);
              return;
            }
            const event = dragging;
            setDragging(null);
            if (event && onDrop) onDrop(event, day);
          }
        }
      : {};

  const chip = (event: CalendarEvent, compact: boolean) => (
    <EventChip
      key={event.id}
      event={event}
      compact={compact}
      selected={selectedId === event.id}
      onSelect={onSelect}
      dragging={dragging?.id === event.id}
      onDragStart={onDrop ? setDragging : undefined}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
    />
  );

  // -- Day: one column, everything in full ----------------------------------
  if (view === 'day') {
    const list = buckets.get(from) ?? [];
    return (
      <div
        className={cn(
          'rounded-lg border p-3',
          over === from && 'ring-primary ring-2'
        )}
        {...dropHandlers(from)}
      >
        <h2 className='mb-2 text-sm font-semibold'>
          {formatLong(from)}
          {holidays.has(from) && (
            <span className='text-muted-foreground font-normal'>
              {' '}
              · office holiday
            </span>
          )}
        </h2>
        {list.length === 0 ? (
          <p className='text-muted-foreground py-8 text-center text-sm'>
            Nothing scheduled on this day.
          </p>
        ) : (
          <ul className='flex flex-col gap-1.5'>
            {list.map((e) => (
              <li key={e.id}>{chip(e, false)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const rows = weekRows(from, to);
  const weekGrid = view !== 'week';

  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='grid grid-cols-7'>
        {rows[0].map((day) => (
          <div
            key={`head-${day}`}
            className='text-muted-foreground bg-muted/40 border-l p-1.5 text-center text-[11px] font-medium first:border-l-0'
          >
            {formatWeekday(day)}
          </div>
        ))}
      </div>
      <div className='grid grid-cols-7'>
        {rows.flat().map((day) => {
          const list = buckets.get(day) ?? [];
          const outside = view === 'month' && day.slice(0, 7) !== month;
          return (
            <div
              key={day}
              className={cn(
                dayClasses(day, today, holidays, outside, over === day),
                weekGrid ? 'min-h-24' : 'min-h-64'
              )}
              {...dropHandlers(day)}
            >
              <DayHeader day={day} today={today} holidays={holidays} />
              {list.map((e) => chip(e, weekGrid))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The narrow-screen view: an agenda of the days that actually have work.
 *
 * A six-week resource grid squeezed into a phone is unusable, so small screens
 * get a readable list instead - and every action stays reachable, because the
 * actions live in the detail panel, not in the drag.
 */
export function AgendaList({
  from,
  to,
  events,
  holidays,
  today,
  onSelect
}: {
  from: Day;
  to: Day;
  events: CalendarEvent[];
  holidays: Set<Day>;
  today: Day;
  onSelect: (event: CalendarEvent) => void;
}) {
  const buckets = byDay(events, from, to);
  const days = eachDay(from, to).filter(
    (d) => (buckets.get(d) ?? []).length > 0
  );
  if (days.length === 0) {
    return (
      <p className='text-muted-foreground rounded-lg border py-10 text-center text-sm'>
        Nothing scheduled in this window.
      </p>
    );
  }
  return (
    <ol className='flex flex-col gap-4'>
      {days.map((day) => (
        <li key={day} className='flex flex-col gap-1.5'>
          <h3
            className={cn(
              'text-xs font-semibold tracking-wide uppercase',
              day === today ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            {formatLong(day)}
            {day === today && ' · today'}
            {holidays.has(day) && ' · office holiday'}
          </h3>
          <ul className='flex flex-col gap-1'>
            {(buckets.get(day) ?? []).map((e) => (
              <li key={e.id}>
                <EventLine event={e} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
