// The calendar's event model: one shape for everything the planner draws,
// derived from the authoritative reads. Pure, client-safe.
//
// The event types are exactly the schedulable things this system has. Work
// packages carry a trade (Roof, Electrical, ReturnVisit, Other) and scaffold
// bookings contribute three dated activities. There is no "Install", "Survey"
// or "Commissioning" event, because no such date exists in the schema - an
// install IS the roof and electrical packages.

import type { Day } from './range';
import { addDays, daysBetween, eachDay } from './range';
import type { PlannerRow, PlannerScaffold } from '../types';

export type EventKind =
  | 'Roof'
  | 'Electrical'
  | 'ReturnVisit'
  | 'Other'
  | 'ScaffoldErect'
  | 'ScaffoldStrip'
  | 'ScaffoldStripForecast';

export const WORK_KINDS: EventKind[] = [
  'Roof',
  'Electrical',
  'ReturnVisit',
  'Other'
];

export const SCAFFOLD_KINDS: EventKind[] = [
  'ScaffoldErect',
  'ScaffoldStrip',
  'ScaffoldStripForecast'
];

export const KIND_LABEL: Record<EventKind, string> = {
  Roof: 'Roof',
  Electrical: 'Electrical',
  ReturnVisit: 'Return visit',
  Other: 'Other work',
  ScaffoldErect: 'Scaffold up',
  ScaffoldStrip: 'Scaffold down',
  ScaffoldStripForecast: 'Scaffold down (forecast)'
};

/**
 * Tailwind classes per event type, from the existing design tokens. Work
 * packages are solid; scaffold is dashed, because scaffold is a supplier
 * commitment rather than our own crew's day.
 */
export const KIND_STYLE: Record<EventKind, string> = {
  Roof: 'bg-info-soft text-info border-info/30',
  Electrical: 'bg-warning-soft text-warning border-warning/30',
  ReturnVisit: 'bg-destructive/10 text-destructive border-destructive/30',
  Other: 'bg-muted text-muted-foreground border-border',
  ScaffoldErect: 'bg-success-soft text-success border-success/40 border-dashed',
  ScaffoldStrip: 'bg-success-soft text-success border-success/40 border-dashed',
  ScaffoldStripForecast:
    'bg-muted/60 text-muted-foreground border-border border-dashed'
};

export interface WorkDetail {
  workPackageId: string;
  workPackageVersion: number;
  status: string;
  allocationId: string | null;
  personId: string | null;
  personName: string | null;
  role: string | null;
  allocated: boolean;
  plannedStart: string;
  plannedEnd: string;
}

export interface ScaffoldDetail {
  scaffoldBookingId: string;
  company: string | null;
  status: string;
  acknowledged: boolean;
  confirmed: boolean;
  actualRecorded: boolean;
}

export interface CalendarEvent {
  /** Stable within a render; not a database id. */
  id: string;
  kind: EventKind;
  jobId: string;
  jobRef: string | null;
  jobDisplay: string | null;
  /** Inclusive calendar dates. Everything here is all-day. */
  start: Day;
  end: Day;
  /**
   * Whether this event can be dragged. Only an allocated work package can:
   * MOVE_WORK_PACKAGE moves a package and its allocation together, and
   * scaffold dates belong to the scaffold commands, never to a work-package
   * drag (see the scaffold rule in the planner docs).
   */
  draggable: boolean;
  work?: WorkDetail;
  scaffold?: ScaffoldDetail;
}

export const isScaffold = (e: CalendarEvent) => SCAFFOLD_KINDS.includes(e.kind);

/** A work package row becomes one event spanning its allocated dates. */
export function workEvent(row: PlannerRow): CalendarEvent {
  const kind = (
    WORK_KINDS.includes(row.trade as EventKind) ? row.trade : 'Other'
  ) as EventKind;
  return {
    id: `wp:${row.work_package_id}:${row.allocation_id ?? 'none'}`,
    kind,
    jobId: row.job_id,
    jobRef: row.job_ref,
    jobDisplay: row.job_display,
    start: row.start_at,
    end: row.end_at,
    // An unallocated package has no allocation to move, so it is opened and
    // allocated rather than dragged.
    draggable: row.allocated && row.allocation_id !== null,
    work: {
      workPackageId: row.work_package_id,
      workPackageVersion: row.work_package_version,
      status: row.work_package_status,
      allocationId: row.allocation_id,
      personId: row.person_id,
      personName: row.person_name,
      role: row.role,
      allocated: row.allocated,
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end
    }
  };
}

export function scaffoldEvent(s: PlannerScaffold): CalendarEvent {
  const kind = `Scaffold${s.kind}` as EventKind;
  return {
    id: `sc:${s.scaffold_booking_id}:${s.kind}`,
    kind,
    jobId: s.job_id,
    jobRef: s.job_ref ?? null,
    jobDisplay: s.job_display ?? null,
    start: s.date,
    end: s.date,
    draggable: false,
    scaffold: {
      scaffoldBookingId: s.scaffold_booking_id,
      company: s.company,
      status: s.status,
      acknowledged: s.acknowledged,
      confirmed: s.confirmed,
      actualRecorded: s.actual_recorded
    }
  };
}

export function toEvents(data: {
  rows: PlannerRow[];
  scaffold: PlannerScaffold[];
}): CalendarEvent[] {
  return [...data.rows.map(workEvent), ...data.scaffold.map(scaffoldEvent)];
}

// -----------------------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------------------

export interface PlannerFilters {
  /** Customer name, job reference or postcode/town, matched case-insensitively. */
  query: string;
  /** Person ids; empty means everyone. */
  people: string[];
  kinds: EventKind[];
  /** Work package statuses; empty means all. */
  statuses: string[];
  /** Only work with nobody allocated. */
  unallocatedOnly: boolean;
  /** Only scaffold a supplier has not acknowledged. */
  scaffoldUnacknowledgedOnly: boolean;
}

export const NO_FILTERS: PlannerFilters = {
  query: '',
  people: [],
  kinds: [],
  statuses: [],
  unallocatedOnly: false,
  scaffoldUnacknowledgedOnly: false
};

export const filtersActive = (f: PlannerFilters) =>
  f.query.trim() !== '' ||
  f.people.length > 0 ||
  f.kinds.length > 0 ||
  f.statuses.length > 0 ||
  f.unallocatedOnly ||
  f.scaffoldUnacknowledgedOnly;

const haystack = (e: CalendarEvent) =>
  [
    e.jobRef,
    e.jobDisplay,
    e.work?.personName,
    e.scaffold?.company,
    KIND_LABEL[e.kind]
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export function matchesFilters(e: CalendarEvent, f: PlannerFilters): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !haystack(e).includes(q)) return false;
  if (f.kinds.length > 0 && !f.kinds.includes(e.kind)) return false;
  if (f.people.length > 0) {
    // A scaffold activity has no installer, so a person filter hides it.
    if (!e.work?.personId || !f.people.includes(e.work.personId)) return false;
  }
  if (f.statuses.length > 0) {
    if (!e.work || !f.statuses.includes(e.work.status)) return false;
  }
  if (f.unallocatedOnly && (isScaffold(e) || e.work?.allocated)) return false;
  if (f.scaffoldUnacknowledgedOnly) {
    if (!e.scaffold || e.scaffold.acknowledged) return false;
  }
  return true;
}

export const applyFilters = (
  events: CalendarEvent[],
  f: PlannerFilters
): CalendarEvent[] => events.filter((e) => matchesFilters(e, f));

// -----------------------------------------------------------------------------
// Laying events out on days
// -----------------------------------------------------------------------------

/** Events touching a given day, in a stable order. */
export function eventsOn(events: CalendarEvent[], day: Day): CalendarEvent[] {
  return events
    .filter((e) => e.start <= day && e.end >= day)
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        a.kind.localeCompare(b.kind) ||
        (a.jobRef ?? '').localeCompare(b.jobRef ?? '') ||
        a.id.localeCompare(b.id)
    );
}

/** Every day of a window mapped to the events touching it. */
export function byDay(
  events: CalendarEvent[],
  from: Day,
  to: Day
): Map<Day, CalendarEvent[]> {
  const map = new Map<Day, CalendarEvent[]>();
  for (const day of eachDay(from, to)) map.set(day, []);
  for (const e of events) {
    for (const day of eachDay(e.start, e.end)) {
      const bucket = map.get(day);
      if (bucket) bucket.push(e);
    }
  }
  map.forEach((list) => {
    list.sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        a.kind.localeCompare(b.kind) ||
        (a.jobRef ?? '').localeCompare(b.jobRef ?? '') ||
        a.id.localeCompare(b.id)
    );
  });
  return map;
}

/** The other scheduled events of the same job - §10's dependency view. */
export const siblingEvents = (events: CalendarEvent[], e: CalendarEvent) =>
  events
    .filter((x) => x.jobId === e.jobId && x.id !== e.id)
    .sort(
      (a, b) => a.start.localeCompare(b.start) || a.kind.localeCompare(b.kind)
    );

/** How many days an event covers, inclusive. */
export const eventLength = (e: CalendarEvent) =>
  daysBetween(e.start, e.end) + 1;

/**
 * Where an event would land if dropped on `day`: the whole event shifts, so a
 * three-day install dropped on Wednesday runs Wednesday to Friday.
 */
export function shiftTo(e: CalendarEvent, day: Day): { start: Day; end: Day } {
  return { start: day, end: addDays(day, daysBetween(e.start, e.end)) };
}
