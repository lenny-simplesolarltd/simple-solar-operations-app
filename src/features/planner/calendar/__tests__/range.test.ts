import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  eachDay,
  fetchWindow,
  formatWeekday,
  isWeekend,
  startOfWeek,
  step,
  today,
  weekRows,
  weekday,
  windowFor,
  windowTitle
} from '../range';

describe('day arithmetic', () => {
  it('adds and subtracts days across month and year ends', () => {
    expect(addDays('2026-09-20', 1)).toBe('2026-09-21');
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('does not drift across the British summer time boundaries', () => {
    // Clocks go forward 29 March 2026 and back 25 October 2026. A calendar
    // built on local midnight loses or repeats a day here.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(eachDay('2026-03-28', '2026-03-31')).toHaveLength(4);
    expect(eachDay('2026-10-24', '2026-10-27')).toHaveLength(4);
  });

  it('clamps month arithmetic instead of rolling over', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-09-20', 1)).toBe('2026-10-20');
  });

  it('counts days inclusively', () => {
    expect(daysBetween('2026-09-20', '2026-09-20')).toBe(0);
    expect(daysBetween('2026-09-20', '2026-09-23')).toBe(3);
    expect(eachDay('2026-09-20', '2026-09-23')).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23'
    ]);
  });
});

describe('weeks', () => {
  it('treats Monday as the start of the week', () => {
    // 2026-09-21 is a Monday.
    expect(weekday('2026-09-21')).toBe(0);
    expect(weekday('2026-09-27')).toBe(6);
    expect(startOfWeek('2026-09-27')).toBe('2026-09-21');
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21');
  });

  it('marks Saturday and Sunday as the weekend', () => {
    expect(isWeekend('2026-09-26')).toBe(true);
    expect(isWeekend('2026-09-27')).toBe(true);
    expect(isWeekend('2026-09-25')).toBe(false);
  });

  it('labels weekdays in Monday-first order', () => {
    const labels = eachDay('2026-09-21', '2026-09-27').map(formatWeekday);
    expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});

describe('view windows', () => {
  it('gives each view the range it draws', () => {
    expect(windowFor('day', '2026-09-23')).toEqual({
      from: '2026-09-23',
      to: '2026-09-23'
    });
    expect(windowFor('week', '2026-09-23')).toEqual({
      from: '2026-09-21',
      to: '2026-09-27'
    });
    expect(windowFor('3w', '2026-09-23')).toEqual({
      from: '2026-09-21',
      to: '2026-10-11'
    });
    expect(windowFor('6w', '2026-09-23')).toEqual({
      from: '2026-09-21',
      to: '2026-11-01'
    });
  });

  it('covers a month with whole weeks', () => {
    const w = windowFor('month', '2026-09-23');
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    expect(w.from).toBe('2026-08-31');
    expect(w.to).toBe('2026-10-04');
    const rows = weekRows(w.from, w.to);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.length === 7)).toBe(true);
  });

  it('always yields whole aligned weeks for the week grids', () => {
    for (const view of ['3w', '6w', 'month'] as const) {
      for (const anchor of ['2026-01-01', '2026-02-15', '2026-12-31']) {
        const { from, to } = windowFor(view, anchor);
        expect(weekday(from)).toBe(0);
        expect(weekday(to)).toBe(6);
        expect(weekRows(from, to).every((r) => r.length === 7)).toBe(true);
      }
    }
  });

  it('buffers reads by a week either side and stays well under the 186-day cap', () => {
    for (const view of ['day', 'week', '3w', '6w', 'month', 'team'] as const) {
      const f = fetchWindow(view, '2026-09-23');
      const w = windowFor(view, '2026-09-23');
      expect(f.from).toBe(addDays(w.from, -7));
      expect(f.to).toBe(addDays(w.to, 7));
      expect(daysBetween(f.from, f.to) + 1).toBeLessThanOrEqual(186);
    }
  });
});

describe('navigation', () => {
  it('steps by the unit the view shows', () => {
    expect(step('day', '2026-09-23', 1)).toBe('2026-09-24');
    expect(step('week', '2026-09-23', 1)).toBe('2026-09-30');
    expect(step('week', '2026-09-23', -1)).toBe('2026-09-16');
    expect(step('3w', '2026-09-23', 1)).toBe('2026-10-14');
    expect(step('6w', '2026-09-23', 1)).toBe('2026-11-04');
  });

  it('steps months without skipping a short month', () => {
    expect(step('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(step('month', '2026-03-15', -1)).toBe('2026-02-01');
    expect(step('month', '2026-12-10', 1)).toBe('2027-01-01');
  });

  it('round-trips forwards and back for the week views', () => {
    for (const view of ['day', 'week', '3w', '6w'] as const) {
      expect(step(view, step(view, '2026-09-23', 1), -1)).toBe('2026-09-23');
    }
  });
});

describe('titles', () => {
  it('describes what is on screen', () => {
    expect(windowTitle('day', '2026-09-23')).toBe(
      'Wednesday, 23 September 2026'
    );
    expect(windowTitle('month', '2026-09-23')).toBe('September 2026');
    expect(windowTitle('week', '2026-09-23')).toBe('21 Sept – 27 Sept 2026');
  });
});

describe('today', () => {
  it('reads the London date, which is what stored dates mean', () => {
    // 23:30 UTC on 30 June is already 1 July in London (BST, UTC+1).
    expect(today(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    // In winter London is UTC, so the same instant is still 30 December.
    expect(today(new Date('2026-12-30T23:30:00Z'))).toBe('2026-12-30');
  });
});
