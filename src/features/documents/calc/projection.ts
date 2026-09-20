// The ROI 30-year projection.
//
// `designer/calc/performance.ts` computes year 1 and a closed-form 30-year
// total. The ROI master's pages 7, 8 and 14 are a per-year table, so the series
// itself has to exist. This module is that series and nothing else: it adds no
// new assumption, it expands the assumptions the performance engine already
// makes over time.
//
// It is deliberately a pure function of explicit inputs rather than of
// `DesignState`, so a stored snapshot can be replayed exactly.

import { PROJECTION_ROWS } from '../bindings';
import type { ProjectionRow } from '../types';

export interface ProjectionInputs {
  /** Year-1 generation, kWh. */
  annualGenerationKwh: number;
  /** Household consumption, kWh. Required: every "no solar" bill needs it. */
  annualConsumptionKwh: number;
  /** Import tariff, pence per kWh, year 1. */
  tariffPence: number;
  /** SEG export rate, pence per kWh, year 1. */
  segRatePence: number;
  /** Share of generation used on site, 0-100. */
  selfConsumptionPct: number;
  /** Annual electricity price inflation, percent. From settings, not a constant. */
  inflationPct: number;
  /** Annual panel output loss, percent. */
  degradationPct: number;
  /**
   * Whether the SEG rate rises with the import tariff.
   *
   * Unresolved business question, so it is an explicit input with a
   * conservative default rather than a silent assumption: a flat SEG rate
   * understates income slightly, which is the safe direction for a customer
   * projection.
   */
  segInflates: boolean;
}

/** Pounds, rounded to the penny, for money that will be printed. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The full table. Rows follow the master's ordinals (1-15, then years 20, 25,
 * 30), but cumulative savings are summed over EVERY year, not just the printed
 * ones - "total saving after 20 years" means twenty years of saving, not the
 * eight rows that happen to be shown.
 */
export function buildProjection(input: ProjectionInputs): ProjectionRow[] {
  const {
    annualGenerationKwh,
    annualConsumptionKwh,
    tariffPence,
    segRatePence,
    selfConsumptionPct,
    inflationPct,
    degradationPct,
    segInflates
  } = input;

  const inflation = 1 + inflationPct / 100;
  const decay = 1 - degradationPct / 100;
  const selfUse = selfConsumptionPct / 100;

  const wanted = new Map(PROJECTION_ROWS.map((r) => [r.year, r.n]));
  const maxYear = Math.max(...PROJECTION_ROWS.map((r) => r.year));

  const rows: ProjectionRow[] = [];
  let cumulative = 0;

  for (let year = 1; year <= maxYear; year++) {
    const escalation = Math.pow(inflation, year - 1);
    const pencePerKwh = tariffPence * escalation;
    const segPence = segInflates ? segRatePence * escalation : segRatePence;

    const generation = annualGenerationKwh * Math.pow(decay, year - 1);
    // Self-consumption cannot exceed what the household actually uses; without
    // this cap a large array on a small house "saves" more than the entire
    // bill and the with-solar column goes negative.
    const selfConsumed = Math.min(generation * selfUse, annualConsumptionKwh);
    const exported = generation - selfConsumed;

    const billNoSolarAnnual = (annualConsumptionKwh * pencePerKwh) / 100;
    const importSaving = (selfConsumed * pencePerKwh) / 100;
    const segIncome = (exported * segPence) / 100;

    const billWithSolarAnnual = billNoSolarAnnual - importSaving;
    const savingAnnual = importSaving + segIncome;
    cumulative += savingAnnual;

    const n = wanted.get(year);
    if (n == null) continue;

    rows.push({
      n,
      year,
      pencePerKwh: Math.round(pencePerKwh * 100) / 100,
      billNoSolarMonthly: money(billNoSolarAnnual / 12),
      billNoSolarAnnual: money(billNoSolarAnnual),
      billWithSolarMonthly: money(billWithSolarAnnual / 12),
      billWithSolarAnnual: money(billWithSolarAnnual),
      savingAnnual: money(savingAnnual),
      savingMonthly: money(savingAnnual / 12),
      savingCumulative: money(cumulative)
    });
  }

  return rows;
}

/** Total electricity spend with no solar, over the whole projection term. */
export function totalSpendNoSolar(input: ProjectionInputs): number {
  const { annualConsumptionKwh, tariffPence, inflationPct } = input;
  const maxYear = Math.max(...PROJECTION_ROWS.map((r) => r.year));
  let total = 0;
  for (let year = 1; year <= maxYear; year++) {
    total +=
      (annualConsumptionKwh *
        tariffPence *
        Math.pow(1 + inflationPct / 100, year - 1)) /
      100;
  }
  return money(total);
}

/**
 * Payback period, in years, to one decimal.
 *
 * The year in which cumulative saving overtakes the system cost, interpolated
 * within that year so the answer is not a step function. Returns null when the
 * system never pays back inside the term - which must be reported, never
 * rounded up to the last row.
 */
export function paybackYears(
  input: ProjectionInputs,
  systemCostPounds: number
): number | null {
  if (systemCostPounds <= 0) return null;

  const {
    annualGenerationKwh,
    annualConsumptionKwh,
    tariffPence,
    segRatePence,
    selfConsumptionPct,
    inflationPct,
    degradationPct,
    segInflates
  } = input;

  const maxYear = Math.max(...PROJECTION_ROWS.map((r) => r.year));
  let cumulative = 0;

  for (let year = 1; year <= maxYear; year++) {
    const escalation = Math.pow(1 + inflationPct / 100, year - 1);
    const pencePerKwh = tariffPence * escalation;
    const segPence = segInflates ? segRatePence * escalation : segRatePence;
    const generation =
      annualGenerationKwh * Math.pow(1 - degradationPct / 100, year - 1);
    const selfConsumed = Math.min(
      generation * (selfConsumptionPct / 100),
      annualConsumptionKwh
    );
    const saving =
      (selfConsumed * pencePerKwh) / 100 +
      ((generation - selfConsumed) * segPence) / 100;

    if (saving <= 0) continue;

    if (cumulative + saving >= systemCostPounds) {
      const fraction = (systemCostPounds - cumulative) / saving;
      return Math.round((year - 1 + fraction) * 10) / 10;
    }
    cumulative += saving;
  }

  return null;
}
