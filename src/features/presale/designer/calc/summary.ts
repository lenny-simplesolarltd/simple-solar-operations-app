// Job-level roll-ups: per-panel totals for the Panels step, Layout stat strip,
// and the `computed` block snapshotted into a presale submission.

import { PANELS, panelById, type PanelSpec } from '../catalogue';
import { type DesignState } from '../types';
import { complexUsedCount } from './complex';
import {
  netCountForSlope,
  panelHeadroomHint,
  slopeGeometry,
  type HeadroomHint
} from './geometry';
import { breakdownRows, computePricing, type Pricing } from './pricing';

export interface JobTotals {
  totalCount: number;
  totalKwp: number;
  perSlope: { id: string; label: string; count: number }[];
}

export interface PanelOption {
  panel: PanelSpec;
  totals: JobTotals;
  best: boolean;
  selected: boolean;
  hint: HeadroomHint | null;
}

export interface LayoutStats {
  gross: number;
  excluded: number;
  net: number;
  kwp: number;
}

export interface ComputedSnapshot {
  system_kwp: number;
  net_panels: number;
  computed_total_pence: number;
  price_breakdown: { key: string; label: string; pence: number }[];
}

export function jobTotalsForPanel(
  design: DesignState,
  panel: PanelSpec
): JobTotals {
  let totalCount = 0;
  const perSlope: JobTotals['perSlope'] = [];
  design.slopes.forEach((slope) => {
    let count = 0;
    if (slope.shapeMode === 'complex') {
      count = complexUsedCount(design, slope, panel);
    } else {
      const geom = slopeGeometry(slope);
      if (geom.complete)
        count = netCountForSlope(design, slope, geom, panel).net;
    }
    totalCount += count;
    perSlope.push({ id: slope.id, label: slope.label, count });
  });
  return {
    totalCount,
    totalKwp: (totalCount * panel.wattage) / 1000,
    perSlope
  };
}

/** Panels step cards. Highest kWp is "best"; the first card wins ties. */
export function panelOptions(design: DesignState): PanelOption[] {
  const rows = PANELS.map((panel) => ({
    panel,
    totals: jobTotalsForPanel(design, panel)
  }));
  let bestId: string | null = null;
  let bestKwp = -Infinity;
  rows.forEach((row) => {
    if (row.totals.totalKwp > bestKwp) {
      bestKwp = row.totals.totalKwp;
      bestId = row.panel.id;
    }
  });
  return rows.map((row) => ({
    ...row,
    best: row.panel.id === bestId,
    selected: design.selectedPanelId === row.panel.id,
    hint: panelHeadroomHint(design, row.panel)
  }));
}

export function layoutStats(
  design: DesignState,
  panel: PanelSpec
): LayoutStats {
  let gross = 0;
  let excluded = 0;
  design.slopes.forEach((slope) => {
    if (slope.shapeMode === 'complex') {
      gross += complexUsedCount(design, slope, panel);
      return;
    }
    const geom = slopeGeometry(slope);
    if (!geom.complete) return;
    const r = netCountForSlope(design, slope, geom, panel);
    gross += r.fit.count;
    excluded += r.excluded;
  });
  const net = gross - excluded;
  return { gross, excluded, net, kwp: (net * panel.wattage) / 1000 };
}

export function toPence(pounds: number): number {
  const pence = Math.round(pounds * 100);
  return pence === 0 ? 0 : pence;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The `computed` block of a submission, from an already-computed pricing. */
export function snapshotFromPricing(pricing: Pricing): ComputedSnapshot {
  return {
    system_kwp: round2(pricing.totalKwp),
    net_panels: Math.round(pricing.totalNetPanels),
    computed_total_pence: toPence(pricing.total),
    price_breakdown: breakdownRows(pricing).map((row) => ({
      key: row.key,
      label: row.label,
      pence: toPence(row.negative ? -row.amount : row.amount)
    }))
  };
}

export function computeSnapshot(design: DesignState): ComputedSnapshot | null {
  const pricing = computePricing(design);
  return pricing ? snapshotFromPricing(pricing) : null;
}

export function selectedPanel(design: DesignState): PanelSpec | null {
  return panelById(design.selectedPanelId);
}
