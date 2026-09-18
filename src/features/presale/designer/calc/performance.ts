// Performance estimate. Pure port of the prototype's computePerformance
// (prototype v0.12, L1174-1235). Informational only — never affects price.

import {
  ELECTRICITY_INFLATION_PCT,
  FALLBACK_DEGRADATION_PCT,
  PANEL_DEGRADATION_PCT,
  PERFORMANCE_RATIO,
  PROJECTION_YEARS,
  type PanelSpec
} from '../catalogue';
import { toNum, type DesignState } from '../types';
import { computePricing, netPanelsForSlope } from './pricing';

export interface Performance {
  panel: PanelSpec;
  annualGenerationKwh: number;
  generationUsedKwh: number;
  generationExportKwh: number;
  electricitySavings: number;
  segIncome: number;
  totalIncomeYear1: number;
  totalIncome30yr: number;
  roiPct: number | null;
  systemCost: number;
  missingRadiance: boolean;
  anyGeneration: boolean;
  degradationPct: number;
  annualConsumptionKwh: number | null;
  overConsumptionWarning: boolean;
}

function finiteOr(n: number, fallback: number): number {
  return isFinite(n) ? n : fallback;
}

export function computePerformance(design: DesignState): Performance | null {
  const pricing = computePricing(design);
  if (!pricing) return null;
  const panel = pricing.panel;

  let annualGenerationKwh = 0;
  let missingRadiance = false;
  let anyGeneration = false;
  design.slopes.forEach((slope) => {
    const count = netPanelsForSlope(design, slope, panel);
    if (count <= 0) return;
    const radiance = toNum(slope.radiance);
    if (!isFinite(radiance) || radiance <= 0) {
      missingRadiance = true;
      return;
    }
    const shading = finiteOr(toNum(slope.shadingPct), 0);
    anyGeneration = true;
    const kwp = (count * panel.wattage) / 1000;
    annualGenerationKwh +=
      kwp * radiance * PERFORMANCE_RATIO * (1 - shading / 100);
  });

  const perf = design.performance;
  const selfConsumptionPct = finiteOr(toNum(perf.selfConsumptionPct), 0);
  const tariffPence = finiteOr(toNum(perf.tariffPence), 0);
  const segRatePence = finiteOr(toNum(perf.segRatePence), 0);
  const consumption = toNum(perf.annualConsumptionKwh);
  const annualConsumptionKwh = isFinite(consumption) ? consumption : null;

  const generationUsedKwh = annualGenerationKwh * (selfConsumptionPct / 100);
  const generationExportKwh = annualGenerationKwh - generationUsedKwh;
  const electricitySavings = generationUsedKwh * (tariffPence / 100);
  const segIncome = generationExportKwh * (segRatePence / 100);
  const totalIncomeYear1 = electricitySavings + segIncome;

  // Prices inflate and output degrades at flat annual rates, so each year's
  // income grows by a constant ratio r: a geometric series over the term.
  const degradationPct =
    PANEL_DEGRADATION_PCT[panel.id] != null
      ? PANEL_DEGRADATION_PCT[panel.id]
      : FALLBACK_DEGRADATION_PCT;
  const r = (1 - degradationPct / 100) * (1 + ELECTRICITY_INFLATION_PCT / 100);
  const totalIncome30yr =
    Math.abs(r - 1) < 1e-9
      ? totalIncomeYear1 * PROJECTION_YEARS
      : (totalIncomeYear1 * (Math.pow(r, PROJECTION_YEARS) - 1)) / (r - 1);

  const systemCost = pricing.total;
  const roiPct = systemCost > 0 ? (totalIncomeYear1 / systemCost) * 100 : null;
  const overConsumptionWarning =
    annualConsumptionKwh != null &&
    annualConsumptionKwh > 0 &&
    generationUsedKwh > annualConsumptionKwh + 1e-9;

  return {
    panel,
    annualGenerationKwh,
    generationUsedKwh,
    generationExportKwh,
    electricitySavings,
    segIncome,
    totalIncomeYear1,
    totalIncome30yr,
    roiPct,
    systemCost,
    missingRadiance,
    anyGeneration,
    degradationPct,
    annualConsumptionKwh,
    overConsumptionWarning
  };
}
