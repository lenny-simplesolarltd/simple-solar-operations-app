// Complex-elevation free-form cell layouts (prototype v0.12, L788-873).
// A Complex elevation has no roof outline: the surveyor types a max panel
// count and builds a layout of unit cells, one panel per cell.

import { type PanelSpec } from '../catalogue';
import {
  slopePanelKey,
  toNum,
  type Cell,
  type ComplexLayout,
  type DesignState,
  type FixedOrientation,
  type Slope
} from '../types';

export function maxCountFor(slope: Slope, panel: PanelSpec): number {
  const raw =
    panel.id === 'p7-510'
      ? slope.maxPanelsP7
      : panel.id === 'mclass-475'
        ? slope.maxPanelsMClass
        : '';
  return Math.max(0, Math.floor(toNum(raw)) || 0);
}

/** Landscape starts two-abreast; portrait starts stacked. */
export function defaultComplexCells(orientation: FixedOrientation): Cell[] {
  return orientation === 'landscape'
    ? [
        { r: 0, c: 0 },
        { r: 0, c: 1 }
      ]
    : [
        { r: 0, c: 0 },
        { r: 1, c: 0 }
      ];
}

function startingLayout(maxCount: number): ComplexLayout {
  const cells =
    maxCount >= 2
      ? defaultComplexCells('portrait')
      : maxCount === 1
        ? [{ r: 0, c: 0 }]
        : [];
  return { orientation: 'portrait', cells, customized: false };
}

/**
 * The stored layout for slope+panel (or the starting layout if none has been
 * stored yet), trimmed to the current max. Never mutates `design`.
 */
export function resolveComplexLayout(
  design: DesignState,
  slope: Slope,
  panel: PanelSpec
): ComplexLayout {
  const maxCount = maxCountFor(slope, panel);
  const stored = design.complexLayouts[slopePanelKey(slope.id, panel.id)];
  const layout = stored ?? startingLayout(maxCount);
  if (layout.cells.length > maxCount) {
    return { ...layout, cells: layout.cells.slice(0, maxCount) };
  }
  return layout;
}

/**
 * Materialises a layout for every Complex elevation with the given panel —
 * what the prototype does when the Layout step is opened. From then on the
 * laid-out count (not the raw max) is what is priced.
 */
export function ensureComplexLayouts(
  design: DesignState,
  panel: PanelSpec
): DesignState {
  let next: Record<string, ComplexLayout> | null = null;
  design.slopes.forEach((slope) => {
    if (slope.shapeMode !== 'complex') return;
    if (maxCountFor(slope, panel) <= 0) return;
    const key = slopePanelKey(slope.id, panel.id);
    const stored = design.complexLayouts[key];
    const resolved = resolveComplexLayout(design, slope, panel);
    if (stored === resolved) return;
    if (!next) next = { ...design.complexLayouts };
    next[key] = resolved;
  });
  return next ? { ...design, complexLayouts: next } : design;
}

/**
 * Count used for pricing/totals: whatever has been laid out, falling back to
 * the raw entered max for a slope+panel whose layout was never opened.
 */
export function complexUsedCount(
  design: DesignState,
  slope: Slope,
  panel: PanelSpec
): number {
  const maxCount = maxCountFor(slope, panel);
  if (maxCount <= 0) return 0;
  const layout = design.complexLayouts[slopePanelKey(slope.id, panel.id)];
  if (layout && layout.cells) return Math.min(layout.cells.length, maxCount);
  return maxCount;
}

function cellKey(cell: Cell): string {
  return `${cell.r},${cell.c}`;
}

/** Empty cells adjacent to the layout, in first-seen order. */
export function complexAddTargets(layout: ComplexLayout): Cell[] {
  const filled: Record<string, true> = {};
  layout.cells.forEach((c) => {
    filled[cellKey(c)] = true;
  });
  const seen: Record<string, true> = {};
  const targets: Cell[] = [];
  layout.cells.forEach((c) => {
    const neighbours: Cell[] = [
      { r: c.r - 1, c: c.c },
      { r: c.r + 1, c: c.c },
      { r: c.r, c: c.c - 1 },
      { r: c.r, c: c.c + 1 }
    ];
    neighbours.forEach((n) => {
      const k = cellKey(n);
      if (filled[k] || seen[k]) return;
      seen[k] = true;
      targets.push(n);
    });
  });
  return targets;
}

/** Returns the new layout, or null when the add is not allowed. */
export function complexAddCell(
  layout: ComplexLayout,
  maxCount: number,
  cell: Cell
): ComplexLayout | null {
  if (layout.cells.length >= maxCount) return null;
  if (layout.cells.some((c) => c.r === cell.r && c.c === cell.c)) return null;
  return {
    ...layout,
    cells: [...layout.cells, { r: cell.r, c: cell.c }],
    customized: true
  };
}

/** Returns the new layout, or null — at least one panel always remains. */
export function complexRemoveCell(
  layout: ComplexLayout,
  cell: Cell
): ComplexLayout | null {
  if (layout.cells.length <= 1) return null;
  return {
    ...layout,
    cells: layout.cells.filter((c) => !(c.r === cell.r && c.c === cell.c)),
    customized: true
  };
}

/** Switching orientation resets to the default pair until customised. */
export function complexSetOrientation(
  layout: ComplexLayout,
  orientation: FixedOrientation
): ComplexLayout {
  return {
    ...layout,
    orientation,
    cells: layout.customized ? layout.cells : defaultComplexCells(orientation)
  };
}
