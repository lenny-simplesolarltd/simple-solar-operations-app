import { describe, expect, it } from 'vitest';
import type { PlannerRow, PlannerScaffold } from '../../types';
import {
  NO_FILTERS,
  applyFilters,
  byDay,
  eventLength,
  eventsOn,
  isScaffold,
  scaffoldEvent,
  shiftTo,
  siblingEvents,
  toEvents,
  workEvent
} from '../events';

const row = (over: Partial<PlannerRow> = {}): PlannerRow => ({
  job_id: 'job-1',
  job_ref: 'SS-SEXL-5961',
  job_display: 'Miss Parton',
  work_package_id: 'wp-1',
  trade: 'Roof',
  work_package_status: 'Scheduled',
  planned_start: '2026-09-21',
  planned_end: '2026-09-23',
  work_package_version: 4,
  allocation_id: 'alloc-1',
  person_id: 'person-1',
  person_name: 'John Doyle',
  role: 'Lead',
  allocated: true,
  start_at: '2026-09-21',
  end_at: '2026-09-23',
  ...over
});

const scaffold = (over: Partial<PlannerScaffold> = {}): PlannerScaffold => ({
  job_id: 'job-1',
  scaffold_booking_id: 'sb-1',
  company: 'Westcountry Scaffolding',
  kind: 'Erect',
  date: '2026-09-18',
  status: 'Confirmed',
  acknowledged: true,
  confirmed: true,
  actual_recorded: false,
  // PLANNER_WINDOW carries the job identity on scaffold rows, so a search for
  // the customer finds their scaffold as well as their install.
  job_ref: 'SS-SEXL-5961',
  job_display: 'Miss Parton',
  ...over
});

describe('work events', () => {
  it('carries the identity a card and a command both need', () => {
    const e = workEvent(row());
    expect(e.kind).toBe('Roof');
    expect(e.jobRef).toBe('SS-SEXL-5961');
    expect(e.start).toBe('2026-09-21');
    expect(e.end).toBe('2026-09-23');
    expect(e.work?.workPackageVersion).toBe(4);
    expect(e.work?.allocationId).toBe('alloc-1');
    expect(eventLength(e)).toBe(3);
  });

  it('maps an unknown trade to Other rather than inventing a type', () => {
    expect(workEvent(row({ trade: 'Plumbing' })).kind).toBe('Other');
    expect(workEvent(row({ trade: 'ReturnVisit' })).kind).toBe('ReturnVisit');
  });

  it('only makes allocated work draggable', () => {
    expect(workEvent(row()).draggable).toBe(true);
    expect(
      workEvent(row({ allocated: false, allocation_id: null })).draggable
    ).toBe(false);
  });

  it('spans the allocation dates, which may differ from the plan', () => {
    const e = workEvent(row({ start_at: '2026-09-22', end_at: '2026-09-22' }));
    expect(eventLength(e)).toBe(1);
    expect(e.work?.plannedStart).toBe('2026-09-21');
  });
});

describe('scaffold events', () => {
  it('is a single day and is never draggable', () => {
    const e = scaffoldEvent(scaffold());
    expect(e.kind).toBe('ScaffoldErect');
    expect(e.start).toBe(e.end);
    expect(e.draggable).toBe(false);
    expect(isScaffold(e)).toBe(true);
  });

  it('distinguishes a planned strip from a forecast one', () => {
    expect(scaffoldEvent(scaffold({ kind: 'Strip' })).kind).toBe(
      'ScaffoldStrip'
    );
    expect(scaffoldEvent(scaffold({ kind: 'StripForecast' })).kind).toBe(
      'ScaffoldStripForecast'
    );
  });
});

describe('laying out days', () => {
  const events = toEvents({
    rows: [
      row(),
      row({
        work_package_id: 'wp-2',
        trade: 'Electrical',
        allocation_id: 'alloc-2',
        person_id: 'person-2',
        person_name: 'Dan Avery',
        start_at: '2026-09-24',
        end_at: '2026-09-24'
      })
    ],
    scaffold: [scaffold()]
  });

  it('puts a multi-day event on every day it covers', () => {
    expect(eventsOn(events, '2026-09-21')).toHaveLength(1);
    expect(eventsOn(events, '2026-09-22')).toHaveLength(1);
    expect(eventsOn(events, '2026-09-23')).toHaveLength(1);
    expect(eventsOn(events, '2026-09-24').map((e) => e.kind)).toEqual([
      'Electrical'
    ]);
  });

  it('buckets a whole window, including empty days', () => {
    const map = byDay(events, '2026-09-18', '2026-09-24');
    expect(map.size).toBe(7);
    expect(map.get('2026-09-18')?.map((e) => e.kind)).toEqual([
      'ScaffoldErect'
    ]);
    expect(map.get('2026-09-19')).toEqual([]);
    expect(map.get('2026-09-22')).toHaveLength(1);
  });

  it('ignores the part of an event that falls outside the window', () => {
    const map = byDay(events, '2026-09-22', '2026-09-22');
    expect(map.size).toBe(1);
    expect(map.get('2026-09-22')).toHaveLength(1);
  });

  it('finds the other scheduled work on the same job', () => {
    const roof = events.find((e) => e.kind === 'Roof')!;
    expect(siblingEvents(events, roof).map((e) => e.kind)).toEqual([
      'ScaffoldErect',
      'Electrical'
    ]);
  });
});

describe('shifting an event', () => {
  it('keeps the length and moves the whole span', () => {
    const e = workEvent(row());
    expect(shiftTo(e, '2026-09-23')).toEqual({
      start: '2026-09-23',
      end: '2026-09-25'
    });
  });

  it('shifts a single day to a single day', () => {
    const e = workEvent(row({ start_at: '2026-09-21', end_at: '2026-09-21' }));
    expect(shiftTo(e, '2026-10-01')).toEqual({
      start: '2026-10-01',
      end: '2026-10-01'
    });
  });
});

describe('filters', () => {
  const events = toEvents({
    rows: [
      row(),
      row({
        work_package_id: 'wp-2',
        job_id: 'job-2',
        job_ref: 'SS-ABCD-1111',
        job_display: 'Mr Smith',
        trade: 'Electrical',
        work_package_status: 'Unscheduled',
        allocation_id: null,
        person_id: null,
        person_name: null,
        allocated: false
      })
    ],
    scaffold: [scaffold({ acknowledged: false })]
  });

  it('returns everything when nothing is set', () => {
    expect(applyFilters(events, NO_FILTERS)).toHaveLength(3);
  });

  it('searches the job reference, customer and installer', () => {
    const q = (query: string) =>
      applyFilters(events, { ...NO_FILTERS, query }).map((e) => e.id);
    expect(q('parton')).toHaveLength(2); // the roof work and its scaffold
    expect(q('SS-ABCD')).toHaveLength(1);
    expect(q('john doyle')).toHaveLength(1);
    expect(q('nobody at all')).toHaveLength(0);
  });

  it('filters by event type', () => {
    expect(
      applyFilters(events, { ...NO_FILTERS, kinds: ['Roof'] })
    ).toHaveLength(1);
    expect(
      applyFilters(events, { ...NO_FILTERS, kinds: ['ScaffoldErect'] })
    ).toHaveLength(1);
  });

  it('hides scaffold when filtering by installer, since it has none', () => {
    const filtered = applyFilters(events, {
      ...NO_FILTERS,
      people: ['person-1']
    });
    expect(filtered.map((e) => e.kind)).toEqual(['Roof']);
  });

  it('finds work with nobody allocated', () => {
    const filtered = applyFilters(events, {
      ...NO_FILTERS,
      unallocatedOnly: true
    });
    expect(filtered.map((e) => e.jobRef)).toEqual(['SS-ABCD-1111']);
  });

  it('finds scaffold the supplier has not acknowledged', () => {
    const filtered = applyFilters(events, {
      ...NO_FILTERS,
      scaffoldUnacknowledgedOnly: true
    });
    expect(filtered.map((e) => e.kind)).toEqual(['ScaffoldErect']);
  });

  it('combines filters', () => {
    expect(
      applyFilters(events, {
        ...NO_FILTERS,
        query: 'parton',
        kinds: ['Roof']
      })
    ).toHaveLength(1);
    expect(
      applyFilters(events, {
        ...NO_FILTERS,
        query: 'smith',
        kinds: ['Roof']
      })
    ).toHaveLength(0);
  });
});
