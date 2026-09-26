import { describe, expect, it } from 'vitest';
import {
  addDays,
  isDue,
  isoWeekday,
  localNow,
  periodFor
} from '../report-period';

/**
 * The reporting period is the one number in this feature that cannot be
 * checked by looking at it. Every case below is a real British clock moment.
 */
describe('a UK day, not the server one', () => {
  it('reads the London date at an instant, through BST', () => {
    // 23:30 London on 25 Sep 2026 is 22:30 UTC: still the 25th here.
    expect(localNow(new Date('2026-09-25T22:30:00Z'))).toEqual({
      date: '2026-09-25',
      hour: 23
    });
  });

  it('and through GMT', () => {
    expect(localNow(new Date('2026-12-25T23:30:00Z'))).toEqual({
      date: '2026-12-25',
      hour: 23
    });
  });

  it('puts a late BST evening in the right day', () => {
    // 00:30 UTC on the 26th is 01:30 London, so the UK day has rolled over.
    expect(localNow(new Date('2026-09-25T23:30:00Z')).date).toBe('2026-09-26');
  });

  it('survives the spring forward (a 23-hour day)', () => {
    // BST begins 02:00 on 29 Mar 2026.
    expect(localNow(new Date('2026-03-29T00:30:00Z')).date).toBe('2026-03-29');
    expect(localNow(new Date('2026-03-29T01:30:00Z')).hour).toBe(2);
  });

  it('survives the autumn back (a 25-hour day)', () => {
    // GMT returns 02:00 on 25 Oct 2026.
    expect(localNow(new Date('2026-10-25T00:30:00Z')).hour).toBe(1);
    expect(localNow(new Date('2026-10-25T01:30:00Z')).hour).toBe(1);
  });
});

describe('a daily report covers the day that has finished', () => {
  it('reports yesterday, not today', () => {
    expect(periodFor('Daily', new Date('2026-09-26T06:10:00Z'))).toEqual({
      from: '2026-09-25',
      to: '2026-09-25'
    });
  });

  it('uses the UK day even when UTC disagrees', () => {
    // 00:10 UTC on the 26th is 01:10 BST on the 26th: yesterday is the 25th.
    expect(periodFor('Daily', new Date('2026-09-25T23:10:00Z')).to).toBe(
      '2026-09-25'
    );
    // 23:10 UTC on the 25th is 00:10 BST on the 26th - same answer.
    expect(periodFor('Daily', new Date('2026-09-25T22:10:00Z')).to).toBe(
      '2026-09-24'
    );
  });
});

describe('a weekly report covers a whole configured week', () => {
  it('is seven days and ends the day before the week restarts', () => {
    // Monday-start. 26 Sep 2026 is a Saturday.
    const week = periodFor('Weekly', new Date('2026-09-26T07:00:00Z'), {
      weekStartsOn: 1
    });
    expect(week).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(isoWeekday(week.from)).toBe(1);
    expect(isoWeekday(week.to)).toBe(7);
    expect(addDays(week.from, 6)).toBe(week.to);
  });

  it('honours a different week start rather than assuming Monday', () => {
    const week = periodFor('Weekly', new Date('2026-09-26T07:00:00Z'), {
      weekStartsOn: 7
    });
    expect(isoWeekday(week.from)).toBe(7);
    expect(isoWeekday(week.to)).toBe(6);
    expect(addDays(week.from, 6)).toBe(week.to);
  });

  it('never reports a week that has not finished', () => {
    const at = new Date('2026-09-26T07:00:00Z');
    const week = periodFor('Weekly', at, { weekStartsOn: 1 });
    expect(week.to < localNow(at).date).toBe(true);
  });
});

describe('the send hour is local', () => {
  it('is not due before it, and is due after', () => {
    // 05:30 UTC = 06:30 BST.
    expect(isDue(new Date('2026-09-26T05:30:00Z'), 7)).toBe(false);
    expect(isDue(new Date('2026-09-26T06:30:00Z'), 7)).toBe(true);
  });

  it('holds the same local hour across a DST change', () => {
    // 07:00 London both times, an hour apart in UTC.
    expect(isDue(new Date('2026-09-26T06:00:00Z'), 7)).toBe(true); // BST
    expect(isDue(new Date('2026-12-26T07:00:00Z'), 7)).toBe(true); // GMT
    expect(isDue(new Date('2026-12-26T06:00:00Z'), 7)).toBe(false);
  });
});
