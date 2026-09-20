'use client';

import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { CalendarEvent } from '../calendar/events';
import type { Day } from '../calendar/range';
import {
  eachDay,
  formatDayNumber,
  formatWeekday,
  isWeekend
} from '../calendar/range';
import type { Alloc, Leave, TeamPlannerRead } from '../types';

interface Person {
  person_id: string;
  display_name: string;
  role?: string;
  allocations: Alloc[];
  leave: Leave[];
}

const within = (day: Day, from: string, to: string | null) =>
  day >= from && day <= (to ?? from);

/**
 * The resource scheduler: people down the side, days across, and a drop target
 * in every cell.
 *
 * Dropping a piece of work on someone else's row proposes a reassignment;
 * dropping it on a different day in the same row proposes a move. Neither
 * commits - both open the confirmation, which runs the canonical command.
 *
 * Availability here is the canonical one (person_availability, via
 * RP_TEAM_PLANNER). The planner has no availability table of its own, and a
 * shaded leave cell is a statement about the same rows the commands check.
 */
export function TeamGrid({
  data,
  eventsByAllocation,
  canPlan,
  selectedId,
  onSelect,
  onReassign,
  onMove
}: {
  data: TeamPlannerRead;
  /** The calendar events, keyed by allocation id, so a cell can open the panel. */
  eventsByAllocation: Map<string, CalendarEvent>;
  canPlan: boolean;
  selectedId: string | null;
  onSelect: (event: CalendarEvent) => void;
  onReassign: (
    event: CalendarEvent,
    personId: string,
    personName: string,
    day: Day
  ) => void;
  onMove: (event: CalendarEvent, day: Day) => void;
}) {
  const [dragging, setDragging] = useState<CalendarEvent | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const days = eachDay(data.from, data.to);
  const holidays = new Set(data.holidays);

  const groups: { label: string; people: Person[] }[] = [
    ...data.teams.map((t) => ({
      label: `${t.name} · ${t.trade}`,
      people: t.members
    })),
    { label: 'Not in a team', people: data.unassigned_installers }
  ].filter((g) => g.people.length > 0);

  if (groups.length === 0) {
    return (
      <EmptyState
        title='No installers set up'
        description='Add installers and teams under Installer skills.'
      />
    );
  }

  const drop = (person: Person, day: Day) => {
    const event = dragging;
    setDragging(null);
    setOver(null);
    if (!event || !canPlan) return;
    if (event.work?.personId === person.person_id) {
      if (day !== event.start) onMove(event, day);
      return;
    }
    onReassign(event, person.person_id, person.display_name, day);
  };

  return (
    <div className='max-w-full overflow-x-auto rounded-lg border'>
      <table className='border-collapse'>
        <thead>
          <tr>
            <th className='bg-card sticky left-0 z-10 p-2 text-left text-xs'>
              Installer
            </th>
            {days.map((day) => (
              <th
                key={day}
                className={cn(
                  'text-muted-foreground min-w-20 border-l p-1 text-center text-[11px] font-medium',
                  (isWeekend(day) || holidays.has(day)) && 'bg-muted/60'
                )}
              >
                <span className='block'>{formatWeekday(day)}</span>
                <span className='block tabular-nums'>
                  {formatDayNumber(day)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.label}>
            <tr>
              <th
                colSpan={days.length + 1}
                className='bg-muted/50 sticky left-0 p-2 text-left text-xs font-semibold tracking-wide uppercase'
              >
                {g.label}
              </th>
            </tr>
            {g.people.map((person) => (
              <tr key={person.person_id} className='border-t'>
                <th
                  scope='row'
                  className='bg-card sticky left-0 z-10 min-w-40 p-2 text-left text-sm font-medium'
                >
                  {person.display_name}
                  {person.role && (
                    <span className='text-muted-foreground block text-xs font-normal'>
                      {person.role}
                    </span>
                  )}
                </th>
                {days.map((day) => {
                  const key = `${person.person_id}:${day}`;
                  const leave = person.leave.find((l) =>
                    within(day, l.from_date, l.to_date)
                  );
                  const work = person.allocations.filter((a) =>
                    within(day, a.start_at, a.end_at)
                  );
                  // Leave is canonical and blocks scheduling, so it is never a
                  // drop target: the command would refuse it as ON_LEAVE.
                  const droppable = canPlan && !!dragging && !leave;
                  return (
                    <td
                      key={day}
                      onDragOver={
                        droppable
                          ? (e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              setOver(key);
                            }
                          : undefined
                      }
                      onDragLeave={() => setOver((k) => (k === key ? null : k))}
                      onDrop={droppable ? () => drop(person, day) : undefined}
                      className={cn(
                        'h-14 min-w-20 border-l p-0.5 align-top text-[11px] leading-tight',
                        (isWeekend(day) || holidays.has(day)) && 'bg-muted/60',
                        leave && 'bg-warning-soft',
                        over === key &&
                          'bg-accent ring-primary ring-2 ring-inset',
                        dragging && leave && 'opacity-60'
                      )}
                      title={
                        leave
                          ? `${leave.type} - cannot be scheduled`
                          : undefined
                      }
                    >
                      {leave && (
                        <span className='text-warning block font-medium'>
                          {leave.type}
                        </span>
                      )}
                      {work.map((a) => {
                        const event = eventsByAllocation.get(a.allocation_id);
                        return (
                          <button
                            key={a.allocation_id}
                            type='button'
                            draggable={canPlan && !!event?.draggable}
                            onDragStart={
                              event
                                ? (e) => {
                                    e.dataTransfer.setData(
                                      'text/plain',
                                      event.id
                                    );
                                    e.dataTransfer.effectAllowed = 'move';
                                    setDragging(event);
                                  }
                                : undefined
                            }
                            onDragEnd={() => {
                              setDragging(null);
                              setOver(null);
                            }}
                            onClick={() => event && onSelect(event)}
                            disabled={!event}
                            className={cn(
                              'bg-info-soft text-info mb-0.5 block w-full truncate rounded px-1 text-left',
                              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                              canPlan && event?.draggable && 'cursor-grab',
                              selectedId === event?.id && 'ring-ring ring-2',
                              dragging?.id === event?.id && 'opacity-40'
                            )}
                            title={`${a.job_display ?? ''} · ${a.trade}`}
                          >
                            {a.trade.slice(0, 4)} {a.job_display ?? ''}
                          </button>
                        );
                      })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
