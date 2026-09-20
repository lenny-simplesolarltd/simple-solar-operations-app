'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconBuildingArch,
  IconBolt,
  IconDots,
  IconRotateClockwise,
  IconTools,
  IconUserOff
} from '@tabler/icons-react';
import type { CalendarEvent, EventKind } from '../calendar/events';
import { KIND_LABEL, KIND_STYLE } from '../calendar/events';
import { canDrag } from '../calendar/moves';

const KIND_ICON: Record<EventKind, typeof IconTools> = {
  Roof: IconTools,
  Electrical: IconBolt,
  ReturnVisit: IconRotateClockwise,
  Other: IconDots,
  ScaffoldErect: IconBuildingArch,
  ScaffoldStrip: IconBuildingArch,
  ScaffoldStripForecast: IconBuildingArch
};

/** The legend that tells staff what the colours mean. */
export function KindLegend({ kinds }: { kinds: EventKind[] }) {
  return (
    <ul className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
      {kinds.map((kind) => {
        const Icon = KIND_ICON[kind];
        return (
          <li key={kind} className='flex items-center gap-1.5'>
            <span
              aria-hidden
              className={cn('size-3 rounded-sm border', KIND_STYLE[kind])}
            />
            <Icon className='size-3.5' aria-hidden />
            {KIND_LABEL[kind]}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One piece of work on one day.
 *
 * The chip is a button, not a link: clicking opens the detail panel, which is
 * where "Open job" then navigates from. Dragging is an enhancement on top -
 * every chip can be reached and acted on with the keyboard alone.
 */
export function EventChip({
  event,
  compact,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
  dragging
}: {
  event: CalendarEvent;
  compact?: boolean;
  selected?: boolean;
  onSelect: (event: CalendarEvent) => void;
  onDragStart?: (event: CalendarEvent) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
}) {
  const Icon = KIND_ICON[event.kind];
  const draggable = event.draggable && canDrag(event).ok && !!onDragStart;
  const unallocated = !!event.work && !event.work.allocated;
  const unacknowledged = !!event.scaffold && !event.scaffold.acknowledged;
  const who = event.work?.personName ?? event.scaffold?.company ?? null;

  return (
    <button
      type='button'
      draggable={draggable}
      onDragStart={(e) => {
        // The payload is the event id; the board holds the event itself.
        e.dataTransfer.setData('text/plain', event.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.(event);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onSelect(event)}
      aria-pressed={selected}
      title={`${KIND_LABEL[event.kind]} · ${event.jobRef ?? ''}${who ? ` · ${who}` : ''}`}
      className={cn(
        'w-full rounded border px-1.5 py-1 text-left text-[11px] leading-tight',
        'focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none',
        KIND_STYLE[event.kind],
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        selected && 'ring-ring ring-2',
        dragging && 'opacity-40'
      )}
    >
      <span className='flex items-center gap-1'>
        <Icon className='size-3 shrink-0' aria-hidden />
        <span className='truncate font-semibold'>
          {event.jobRef ?? event.jobDisplay ?? KIND_LABEL[event.kind]}
        </span>
        {unallocated && (
          <IconUserOff
            className='text-warning ml-auto size-3 shrink-0'
            aria-label='Nobody allocated'
          />
        )}
        {unacknowledged && (
          <IconAlertTriangle
            className='text-warning ml-auto size-3 shrink-0'
            aria-label='Not acknowledged by the scaffolder'
          />
        )}
      </span>
      {!compact && (
        <span className='block truncate opacity-80'>
          {event.jobDisplay ?? KIND_LABEL[event.kind]}
        </span>
      )}
      {!compact && who && (
        <span className='block truncate opacity-70'>{who}</span>
      )}
    </button>
  );
}

/** A denser one-line variant for the agenda and resource rows. */
export function EventLine({
  event,
  onSelect
}: {
  event: CalendarEvent;
  onSelect: (event: CalendarEvent) => void;
}) {
  const Icon = KIND_ICON[event.kind];
  return (
    <button
      type='button'
      onClick={() => onSelect(event)}
      className={cn(
        'flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs',
        'focus-visible:ring-ring hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none',
        KIND_STYLE[event.kind]
      )}
    >
      <Icon className='size-3.5 shrink-0' aria-hidden />
      <span className='truncate font-semibold'>{event.jobRef}</span>
      <span className='truncate opacity-80'>{event.jobDisplay}</span>
      <span className='ml-auto shrink-0 opacity-70'>
        {KIND_LABEL[event.kind]}
      </span>
      {event.work && !event.work.allocated && (
        <Badge variant='warning' className='shrink-0'>
          Unallocated
        </Badge>
      )}
    </button>
  );
}
