import { describe, expect, it } from 'vitest';
import type { HistoricalEvent } from '../../types';
import {
  HISTORICAL_KINDS,
  NO_FILTERS,
  applyFilters,
  byDay,
  historicalEvent,
  isHistorical,
  toEvents
} from '../events';
import { DRAG_REFUSAL, canDrag, proposeMove, proposeReassign } from '../moves';

const hist = (over: Partial<HistoricalEvent> = {}): HistoricalEvent => ({
  job_id: 'hjob-1',
  job_ref: 'SS-HCGH-1669',
  job_display: 'Weaver PL9 7NX',
  kind: 'Roof',
  event_date: '2025-02-27',
  read_only: true,
  record_class: 'HistoricalImport',
  town: 'Plymouth',
  postcode: 'PL9 7NX',
  source_field: 'Date Roofer',
  source_system: 'historical-job-booking-form',
  source_reference: 'batch-1:sub-9',
  scaffold_company: null,
  people: [],
  ...over
});

describe('a historical event', () => {
  it('is a single read-only day with no operational entity behind it', () => {
    const e = historicalEvent(hist());
    expect(e.kind).toBe('HistoricalRoof');
    expect(e.start).toBe('2025-02-27');
    expect(e.end).toBe('2025-02-27');
    expect(e.draggable).toBe(false);
    expect(isHistorical(e)).toBe(true);
    // The three things every scheduling command needs are all absent.
    expect(e.work).toBeUndefined();
    expect(e.scaffold).toBeUndefined();
  });

  it('maps each preserved date to its own kind', () => {
    expect(historicalEvent(hist({ kind: 'Roof' })).kind).toBe('HistoricalRoof');
    expect(historicalEvent(hist({ kind: 'Electrical' })).kind).toBe(
      'HistoricalElectrical'
    );
    expect(historicalEvent(hist({ kind: 'ScaffoldErect' })).kind).toBe(
      'HistoricalScaffoldErect'
    );
  });

  it('keeps the provenance the panel shows', () => {
    const e = historicalEvent(hist());
    expect(e.historical?.sourceField).toBe('Date Roofer');
    expect(e.historical?.sourceSystem).toBe('historical-job-booking-form');
  });

  it('never claims which current person an ambiguous name meant', () => {
    const e = historicalEvent(
      hist({
        people: [
          {
            role: 'Installer',
            source_value: 'Dave',
            match_kind: 'Ambiguous',
            person_id: null,
            display_name: null,
            linked: false
          },
          {
            role: 'Electrician',
            source_value: 'Casey Lakey',
            match_kind: 'SafeNormalisedMatch',
            person_id: 'person-casey',
            display_name: 'Casey Lakey',
            linked: true
          }
        ]
      })
    );
    const [ambiguous, linked] = e.historical!.people;
    expect(ambiguous.linked).toBe(false);
    expect(ambiguous.personId).toBeNull();
    expect(ambiguous.sourceValue).toBe('Dave');
    expect(linked.linked).toBe(true);
    expect(linked.personId).toBe('person-casey');
  });
});

describe('historical events can never be moved', () => {
  const e = historicalEvent(hist());

  it('cannot start a drag', () => {
    expect(canDrag(e)).toEqual({ ok: false, reason: DRAG_REFUSAL.HISTORICAL });
  });

  it('cannot produce a move proposal', () => {
    expect(proposeMove(e, '2026-01-05')).toEqual({
      ok: false,
      reason: DRAG_REFUSAL.HISTORICAL
    });
  });

  it('cannot produce a reassignment proposal', () => {
    expect(proposeReassign(e, 'person-2', 'Dan Avery', '2026-01-05')).toEqual({
      ok: false,
      reason: DRAG_REFUSAL.HISTORICAL
    });
  });

  it('is refused for every historical kind', () => {
    for (const kind of ['Roof', 'Electrical', 'ScaffoldErect'] as const) {
      const ev = historicalEvent(hist({ kind }));
      expect(HISTORICAL_KINDS).toContain(ev.kind);
      expect(canDrag(ev).ok).toBe(false);
    }
  });
});

describe('historical events on the calendar', () => {
  const events = toEvents({
    rows: [],
    scaffold: [],
    historical: [
      hist(),
      hist({
        job_id: 'hjob-2',
        job_ref: 'SS-HEDA-5521',
        job_display: 'Hart EX39 6AT',
        kind: 'Electrical',
        event_date: '2025-03-18',
        town: 'Hartland',
        postcode: 'EX39 6AT',
        source_reference: 'batch-1:sub-22'
      })
    ]
  });

  it('lands on the day it was recorded', () => {
    const map = byDay(events, '2025-02-26', '2025-03-18');
    expect(map.get('2025-02-27')).toHaveLength(1);
    expect(map.get('2025-03-18')).toHaveLength(1);
    expect(map.get('2025-02-26')).toEqual([]);
  });

  it('is searchable by town, postcode and previous-system reference', () => {
    const q = (query: string) =>
      applyFilters(events, { ...NO_FILTERS, query }).length;
    expect(q('plymouth')).toBe(1);
    expect(q('EX39')).toBe(1);
    expect(q('batch-1:sub-9')).toBe(1);
    expect(q('SS-HEDA')).toBe(1);
  });

  it('is searchable by the staff name the old form recorded', () => {
    const withPerson = toEvents({
      rows: [],
      scaffold: [],
      historical: [
        hist({
          people: [
            {
              role: 'Installer',
              source_value: 'Lewis',
              match_kind: 'NoMatch',
              person_id: null,
              display_name: null,
              linked: false
            }
          ]
        })
      ]
    });
    expect(
      applyFilters(withPerson, { ...NO_FILTERS, query: 'lewis' })
    ).toHaveLength(1);
  });

  it('can be filtered to historical work types alone', () => {
    expect(
      applyFilters(events, { ...NO_FILTERS, kinds: ['HistoricalRoof'] })
    ).toHaveLength(1);
  });

  it('never counts as unallocated work needing attention', () => {
    // "Nobody allocated" is a prompt to act. A historical record is not.
    expect(
      applyFilters(events, { ...NO_FILTERS, unallocatedOnly: true })
    ).toHaveLength(0);
  });
});
