'use client';

import { ReadFailureState } from '@/components/read-failure';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ReadFailure } from '@/lib/backend/types';
import { IconInfoCircle } from '@tabler/icons-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition
} from 'react';
import { toast } from 'sonner';
import {
  readHistoricalCount,
  readPlannerWindow,
  readTeamPlanner
} from '../actions';
import type { CalendarEvent, PlannerFilters } from '../calendar/events';
import {
  HISTORICAL_KINDS,
  NO_FILTERS,
  SCAFFOLD_KINDS,
  WORK_KINDS,
  applyFilters,
  toEvents
} from '../calendar/events';
import type { Proposal } from '../calendar/moves';
import { proposeMove, proposeReassign } from '../calendar/moves';
import type { Day, ViewId } from '../calendar/range';
import {
  fetchWindow,
  isViewId,
  step as stepView,
  today as londonToday,
  windowFor
} from '../calendar/range';
import type { RecordMode, TeamPlannerRead, UnscheduledWork } from '../types';
import { AgendaList, CalendarGrid } from './calendar-grid';
import { KindLegend } from './event-chip';
import { JobPanel } from './job-panel';
import { MoveDialog } from './move-dialog';
import { PlannerToolbar } from './planner-toolbar';
import { ReassignDialog } from './reassign-dialog';
import { ScheduleDialog } from './schedule-dialog';
import { TeamGrid } from './team-grid';
import { UnscheduledPanel } from './unscheduled-panel';

const STORAGE_KEY = 'planner.view';
const RECORDS_KEY = 'planner.records';

/**
 * The planner opens on live work.
 *
 * It is an operational surface, so its default has to be the work people are
 * expected to do. History is one click away, and when a window holds no live
 * work the board says how much history is there rather than looking broken.
 */
const DEFAULT_RECORDS: RecordMode = 'live';

/**
 * The operations calendar.
 *
 * Reads are windowed to what is on screen (plus a week either side) and made
 * again whenever the view or the date changes, so the planner never holds the
 * whole schedule. Every mutation leaves through a confirmation dialog and a
 * canonical command - this component proposes, the database decides.
 */
export function PlannerBoard({
  canPlan,
  initialView,
  initialAnchor
}: {
  canPlan: boolean;
  initialView: ViewId;
  initialAnchor: Day;
}) {
  const [view, setView] = useState<ViewId>(initialView);
  const [anchor, setAnchor] = useState<Day>(initialAnchor);
  const [filters, setFilters] = useState<PlannerFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [reassigning, setReassigning] = useState<CalendarEvent | null>(null);
  const [scheduling, setScheduling] = useState<{
    work: UnscheduledWork;
    day: Day | null;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [records, setRecords] = useState<RecordMode>(DEFAULT_RECORDS);
  const [historicalHere, setHistoricalHere] = useState<number | null>(null);
  const [unscheduled, setUnscheduled] = useState<UnscheduledWork[]>([]);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [holidays, setHolidays] = useState<Set<Day>>(new Set());
  const [team, setTeam] = useState<TeamPlannerRead | null>(null);
  const [failure, setFailure] = useState<ReadFailure | null>(null);
  const [loading, startLoading] = useTransition();

  const today = londonToday();
  const visible = windowFor(view, anchor);

  // Remember the view between visits: the planner is a place staff return to
  // several times a day, and it should open where they left it.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && isViewId(saved)) setView(saved);
      const savedRecords = window.localStorage.getItem(RECORDS_KEY);
      if (
        savedRecords === 'live' ||
        savedRecords === 'historical' ||
        savedRecords === 'both'
      ) {
        setRecords(savedRecords);
      }
    } catch {
      // Private window or blocked storage: the defaults are fine.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, view);
      window.localStorage.setItem(RECORDS_KEY, records);
    } catch {
      // Not worth telling anyone about.
    }
  }, [view, records]);

  // One read per visible window. Changing view or date re-reads exactly the
  // new range; nothing accumulates.
  useEffect(() => {
    const range = fetchWindow(view, anchor);
    startLoading(async () => {
      const [window, teamRead, count] = await Promise.all([
        readPlannerWindow({ ...range, records }),
        view === 'team'
          ? readTeamPlanner({ start: visible.from, weeks: 1 })
          : Promise.resolve(null),
        // Only worth asking when history is not already on screen.
        records === 'live' ? readHistoricalCount(range) : Promise.resolve(null)
      ]);
      if (!window.ok) {
        setFailure(window.error);
        setEvents([]);
        return;
      }
      setFailure(null);
      setEvents(toEvents(window.data));
      setHolidays(new Set(window.data.holidays));
      setTeam(teamRead && teamRead.ok ? teamRead.data : null);
      setHistoricalHere(count && count.ok ? count.data.events : null);
    });
    // visible.from is derived from view+anchor, so it is not a separate input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor, refreshKey, records]);

  const shown = useMemo(() => applyFilters(events, filters), [events, filters]);

  /** Allocation id -> event, so a resource cell can open the same panel. */
  const byAllocation = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const e of shown) {
      if (e.work?.allocationId) map.set(e.work.allocationId, e);
    }
    return map;
  }, [shown]);

  /** Installers currently on screen, for the filter list. */
  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) {
      if (e.work?.personId && e.work.personName) {
        map.set(e.work.personId, e.work.personName);
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [events]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  /**
   * A drop. It never writes: it produces a proposal, or it says why there is
   * no proposal to make and the event stays exactly where it was.
   */
  const handleDrop = useCallback((event: CalendarEvent, day: Day) => {
    const r = proposeMove(event, day);
    if (!r.ok) {
      toast.warning(r.reason);
      return;
    }
    setProposal(r.proposal);
  }, []);

  const handleReassign = useCallback(
    (event: CalendarEvent, personId: string, personName: string, day: Day) => {
      const r = proposeReassign(event, personId, personName, day);
      if (!r.ok) {
        toast.warning(r.reason);
        return;
      }
      setProposal(r.proposal);
    },
    []
  );

  const legend = [
    ...(records === 'historical' ? [] : WORK_KINDS),
    ...(view === 'team' || records === 'historical' ? [] : SCAFFOLD_KINDS),
    ...(records === 'live' ? [] : HISTORICAL_KINDS)
  ];

  return (
    <div className='flex flex-col gap-4'>
      <PlannerToolbar
        view={view}
        anchor={anchor}
        filters={filters}
        people={people}
        records={records}
        onRecords={setRecords}
        onView={setView}
        onAnchor={setAnchor}
        onToday={() => setAnchor(today)}
        onStep={(d) => setAnchor(stepView(view, anchor, d))}
        onFilters={setFilters}
      />

      {!canPlan && (
        <Alert>
          <IconInfoCircle />
          <AlertTitle>Read only</AlertTitle>
          <AlertDescription>
            You can see the schedule but not change it. Moving and allocating
            work is done by the office.
          </AlertDescription>
        </Alert>
      )}

      <div className='flex flex-col gap-4 lg:flex-row'>
        <div className='flex min-w-0 flex-1 flex-col gap-3'>
          {failure ? (
            <ReadFailureState failure={failure} />
          ) : loading && events.length === 0 ? (
            <Skeleton className='h-96 w-full rounded-lg' />
          ) : view === 'team' ? (
            team ? (
              <TeamGrid
                data={team}
                eventsByAllocation={byAllocation}
                canPlan={canPlan}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                onReassign={handleReassign}
                onMove={handleDrop}
              />
            ) : (
              <Skeleton className='h-96 w-full rounded-lg' />
            )
          ) : (
            <>
              {/* Desktop: the board. Narrow screens: the agenda. */}
              <div className='hidden md:block'>
                <CalendarGrid
                  view={view}
                  from={visible.from}
                  to={visible.to}
                  events={shown}
                  holidays={holidays}
                  today={today}
                  anchor={anchor}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelected}
                  onDrop={canPlan ? handleDrop : undefined}
                  onDropUnscheduled={
                    canPlan
                      ? (workPackageId, day) => {
                          const work = unscheduled.find(
                            (w) => w.work_package_id === workPackageId
                          );
                          if (work) setScheduling({ work, day });
                        }
                      : undefined
                  }
                />
              </div>
              <div className='md:hidden'>
                <AgendaList
                  from={visible.from}
                  to={visible.to}
                  events={shown}
                  holidays={holidays}
                  today={today}
                  onSelect={setSelected}
                />
              </div>
            </>
          )}

          {/*
            An operational window with nothing in it is a normal state, but it
            looks broken when 277 imported records sit just out of view. Say
            what is actually there, and offer it.
          */}
          {records === 'live' &&
            !loading &&
            shown.length === 0 &&
            historicalHere !== null &&
            historicalHere > 0 && (
              <Alert>
                <IconInfoCircle />
                <AlertTitle>No current work in this window</AlertTitle>
                <AlertDescription className='flex flex-wrap items-center gap-2'>
                  <span>
                    {historicalHere} historical record
                    {historicalHere === 1 ? '' : 's'} from the old booking form
                    {historicalHere === 1 ? ' has a date' : ' have dates'} here.
                    They are read-only and cannot be scheduled.
                  </span>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setRecords('both')}
                  >
                    Show them
                  </Button>
                </AlertDescription>
              </Alert>
            )}

          <div className='flex flex-wrap items-center justify-between gap-2'>
            <KindLegend kinds={legend} />
            {loading && (
              <span className='text-muted-foreground text-xs'>Updating…</span>
            )}
          </div>
        </div>

        {canPlan && (
          <UnscheduledPanel
            canPlan={canPlan}
            refreshKey={refreshKey}
            onLoaded={setUnscheduled}
            onSchedule={(work, day) =>
              setScheduling({ work, day: day ?? null })
            }
          />
        )}
      </div>

      <JobPanel
        event={selected}
        allEvents={events}
        canPlan={canPlan}
        onClose={() => setSelected(null)}
        onMove={(event) => {
          // The keyboard equivalent of a drag: open the same dialog with the
          // dates unchanged, for the user to edit.
          setProposal({
            kind: 'move',
            event,
            from: { start: event.start, end: event.end },
            to: { start: event.start, end: event.end }
          });
          setSelected(null);
        }}
        onReassign={(event) => {
          // The keyboard equivalent of dragging onto another resource row:
          // the person is chosen from the readiness read instead of by where
          // the pointer landed.
          setReassigning(event);
          setSelected(null);
        }}
      />

      <ReassignDialog
        event={reassigning}
        onClose={() => setReassigning(null)}
        onDone={refresh}
      />

      <MoveDialog
        proposal={proposal}
        onClose={() => setProposal(null)}
        onDone={refresh}
      />

      <ScheduleDialog
        work={scheduling?.work ?? null}
        day={scheduling?.day ?? null}
        onClose={() => setScheduling(null)}
        onDone={refresh}
      />
    </div>
  );
}
