// The ROI projection. These are the numbers a customer makes a thirty-year
// financial decision on, so the arithmetic is pinned rather than trusted.

import { describe, expect, it } from 'vitest';

import {
  buildProjection,
  paybackYears,
  totalSpendNoSolar,
  type ProjectionInputs
} from '../calc/projection';

const base: ProjectionInputs = {
  annualGenerationKwh: 4000,
  annualConsumptionKwh: 4000,
  tariffPence: 30,
  segRatePence: 12,
  selfConsumptionPct: 50,
  inflationPct: 5,
  degradationPct: 0.5,
  segInflates: false
};

describe('buildProjection', () => {
  const rows = buildProjection(base);

  it('returns the master’s eighteen rows', () => {
    expect(rows).toHaveLength(18);
    expect(rows.map((r) => r.year).slice(-3)).toEqual([20, 25, 30]);
  });

  it('starts year 1 at the quoted tariff, uninflated', () => {
    expect(rows[0].pencePerKwh).toBe(30);
    // 4000 kWh at 30p = £1,200
    expect(rows[0].billNoSolarAnnual).toBe(1200);
    expect(rows[0].billNoSolarMonthly).toBe(100);
  });

  it('inflates the unit price geometrically', () => {
    // Year 10 = 30p x 1.05^9
    expect(rows[9].pencePerKwh).toBeCloseTo(30 * Math.pow(1.05, 9), 2);
  });

  it('accumulates savings over every year, not just the printed rows', () => {
    // The year-20 row must include years 16-19, which the table never shows.
    const yearTwenty = rows.find((r) => r.year === 20)!;
    const yearFifteen = rows.find((r) => r.year === 15)!;
    const naive = yearFifteen.savingCumulative + yearTwenty.savingAnnual;
    expect(yearTwenty.savingCumulative).toBeGreaterThan(naive);
  });

  it('never lets the with-solar bill exceed the without-solar bill', () => {
    for (const r of rows) {
      expect(r.billWithSolarAnnual).toBeLessThanOrEqual(r.billNoSolarAnnual);
    }
  });

  it('caps self-consumption at what the household actually uses', () => {
    // A huge array on a tiny house must not "save" more than the entire bill.
    const oversized = buildProjection({
      ...base,
      annualGenerationKwh: 40000,
      annualConsumptionKwh: 1000,
      selfConsumptionPct: 100
    });
    for (const r of oversized) {
      expect(r.billWithSolarAnnual).toBeGreaterThanOrEqual(0);
    }
  });

  it('holds the SEG rate flat unless told to inflate it', () => {
    const inflating = buildProjection({ ...base, segInflates: true });
    const flat = buildProjection(base);
    // Same year-1 saving either way; divergence only afterwards.
    expect(inflating[0].savingAnnual).toBeCloseTo(flat[0].savingAnnual, 2);
    expect(inflating[17].savingAnnual).toBeGreaterThan(flat[17].savingAnnual);
  });

  it('is deterministic', () => {
    expect(buildProjection(base)).toEqual(buildProjection(base));
  });
});

describe('totalSpendNoSolar', () => {
  it('sums thirty inflating years', () => {
    const expected = Array.from(
      { length: 30 },
      (_, i) => (4000 * 30 * Math.pow(1.05, i)) / 100
    ).reduce((a, b) => a + b, 0);
    expect(totalSpendNoSolar(base)).toBeCloseTo(expected, 1);
  });
});

describe('paybackYears', () => {
  it('interpolates within the year the system pays for itself', () => {
    const payback = paybackYears(base, 10000)!;
    expect(payback).toBeGreaterThan(0);
    expect(payback).toBeLessThan(30);
    // Not a whole number of years: the answer is interpolated, not a step.
    expect(payback % 1).not.toBe(0);
  });

  it('returns null when the system never pays back in the term', () => {
    expect(paybackYears(base, 10_000_000)).toBeNull();
  });

  it('returns null for a zero cost rather than dividing by it', () => {
    expect(paybackYears(base, 0)).toBeNull();
  });

  it('pays back sooner as the system gets cheaper', () => {
    const cheap = paybackYears(base, 5000)!;
    const dear = paybackYears(base, 15000)!;
    expect(cheap).toBeLessThan(dear);
  });

  it('agrees with the cumulative column it is derived from', () => {
    const cost = 12000;
    const payback = paybackYears(base, cost)!;
    const rows = buildProjection(base);
    const before = rows.filter((r) => r.year <= Math.floor(payback));
    const after = rows.find((r) => r.year >= Math.ceil(payback));
    if (before.length) {
      expect(before[before.length - 1].savingCumulative).toBeLessThanOrEqual(
        cost
      );
    }
    if (after)
      expect(after.savingCumulative).toBeGreaterThanOrEqual(cost * 0.9);
  });
});
