// Roof geometry and panel fit. Pure ports of the prototype's slopeGeometry,
// calcHypotenuse, fitFor, autoExcludedSet, netCountForSlope and
// panelHeadroomHint (prototype v0.12, L757-779, L930-1058).

import {
  HEADROOM_HINT_MAX_MM,
  OBSTRUCTION_MIN_MM,
  type PanelSpec
} from '../catalogue';
import {
  numOr0,
  slopePanelKey,
  toNum,
  type DesignState,
  type Obstruction,
  type Orientation,
  type Slope
} from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlopeGeometry {
  complete: boolean;
  widthMm: number;
  slopeMm: number;
}

export interface EdgeClearances {
  ridge: number;
  eave: number;
  verge: number;
}

export interface Fit {
  cols: number;
  rows: number;
  count: number;
  /** Panel size along the eave (mm). */
  alongW: number;
  /** Panel size up the slope (mm). */
  alongS: number;
  edge: EdgeClearances;
  gap: number;
  usableW: number;
  usableS: number;
  leftoverW: number;
  leftoverS: number;
  offsetW: number;
  offsetS: number;
  orientation: 'portrait' | 'landscape';
}

export interface NetCount {
  fit: Fit;
  net: number;
  /** Size of (auto ∪ manual) exclusions, clamped to the fit count. */
  excluded: number;
  autoExcluded: number[];
  manualExcluded: number[];
}

export interface HeadroomHint {
  mm: number;
  extra: number;
  slopeLabel: string;
  param: 'side clearance' | 'ridge or gutter clearance';
}

/** Strict overlap — rectangles that merely touch do not overlap. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/**
 * Only Rectangle mode has usable geometry: X is the eave width and Y is
 * already the sloped rafter length, so no trig is needed.
 */
export function slopeGeometry(slope: Slope): SlopeGeometry {
  if (slope.shapeMode === 'rect') {
    const x = toNum(slope.xM);
    const y = toNum(slope.yM);
    if (isFinite(x) && x > 0 && isFinite(y) && y > 0) {
      return { complete: true, widthMm: x * 1000, slopeMm: y * 1000 };
    }
  }
  return { complete: false, widthMm: 0, slopeMm: 0 };
}

export function jobHasObstructableSlopes(design: DesignState): boolean {
  return design.slopes.some((s) => slopeGeometry(s).complete);
}

/** Slope Calculator: hypotenuse = adjacent / cos(pitch). */
export function calcHypotenuse(slope: Slope): number | null {
  const adj = toNum(slope.calcAdjacentM);
  const pitch = toNum(slope.pitchDeg);
  if (!isFinite(adj) || adj <= 0 || !isFinite(pitch) || pitch <= 0) return null;
  if (pitch >= 90) return null;
  return adj / Math.cos((pitch * Math.PI) / 180);
}

export function obstructionsFor(
  design: DesignState,
  slopeId: string
): Obstruction[] {
  return design.obstructions[slopeId] ?? [];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function fitFor(
  design: DesignState,
  slope: Slope,
  geom: SlopeGeometry,
  panel: PanelSpec,
  orientation: Orientation
): Fit {
  const verge = numOr0(design.params.vergeMm);
  const ridge = numOr0(design.params.ridgeMm);
  const eave = numOr0(design.params.eaveMm);
  const gap = numOr0(design.params.gapMm);
  const usableW = Math.max(0, geom.widthMm - 2 * verge);
  const usableS = Math.max(0, geom.slopeMm - ridge - eave);
  const pw = panel.widthM * 1000;
  const ph = panel.heightM * 1000;
  const edge: EdgeClearances = { ridge, eave, verge };
  const bias = clamp(slope.shiftBias || 0, -1, 1);
  const biasV = clamp(slope.shiftBiasV || 0, -1, 1);

  const orient = (
    alongW: number,
    alongS: number,
    name: 'portrait' | 'landscape'
  ): Fit => {
    const cols = Math.max(0, Math.floor((usableW + gap) / (alongW + gap)));
    const rows = Math.max(0, Math.floor((usableS + gap) / (alongS + gap)));
    const usedW = cols > 0 ? cols * (alongW + gap) - gap : 0;
    const usedS = rows > 0 ? rows * (alongS + gap) - gap : 0;
    const leftoverW = Math.max(0, usableW - usedW);
    const leftoverS = Math.max(0, usableS - usedS);
    return {
      cols,
      rows,
      count: cols * rows,
      alongW,
      alongS,
      edge,
      gap,
      usableW,
      usableS,
      leftoverW,
      leftoverS,
      offsetW: (leftoverW / 2) * (1 + bias),
      offsetS: (leftoverS / 2) * (1 + biasV),
      orientation: name
    };
  };

  const portrait = orient(pw, ph, 'portrait');
  const landscape = orient(ph, pw, 'landscape');
  if (orientation === 'portrait') return portrait;
  if (orientation === 'landscape') return landscape;

  // Auto: with obstructions marked, pick whichever orientation nets more real
  // panels; otherwise landscape only when strictly bigger (ties -> portrait).
  const obs = obstructionsFor(design, slope.id);
  if (obs.length) {
    const netP = portrait.count - autoExcluded(obs, portrait).length;
    const netL = landscape.count - autoExcluded(obs, landscape).length;
    if (netL !== netP) return netL > netP ? landscape : portrait;
  }
  return landscape.count > portrait.count ? landscape : portrait;
}

/** Top-left corner of the panel at `idx` (row-major), in roof mm. */
export function panelRect(fit: Fit, idx: number): Rect {
  const r = Math.floor(idx / fit.cols);
  const c = idx % fit.cols;
  return {
    x: fit.edge.verge + fit.offsetW + c * (fit.alongW + fit.gap),
    y: fit.edge.ridge + fit.offsetS + r * (fit.alongS + fit.gap),
    w: fit.alongW,
    h: fit.alongS
  };
}

function autoExcluded(obs: Obstruction[], fit: Fit): number[] {
  const out: number[] = [];
  if (!obs.length || fit.count <= 0) return out;
  for (let idx = 0; idx < fit.count; idx++) {
    const rect = panelRect(fit, idx);
    if (obs.some((o) => rectsOverlap(rect, o))) out.push(idx);
  }
  return out;
}

/** Indices of panels that overlap a marked obstruction (ascending). */
export function autoExcludedIndices(
  design: DesignState,
  slope: Slope,
  fit: Fit
): number[] {
  return autoExcluded(obstructionsFor(design, slope.id), fit);
}

export function netCountForSlope(
  design: DesignState,
  slope: Slope,
  geom: SlopeGeometry,
  panel: PanelSpec
): NetCount {
  const fit = fitFor(design, slope, geom, panel, slope.orientation || 'auto');
  const auto = autoExcludedIndices(design, slope, fit);
  const manual = design.exclusions[slopePanelKey(slope.id, panel.id)] ?? [];
  const union: Record<number, true> = {};
  auto.forEach((i) => {
    union[i] = true;
  });
  manual.forEach((i) => {
    if (i < fit.count) union[i] = true;
  });
  const excluded = Math.min(Object.keys(union).length, fit.count);
  return {
    fit,
    net: fit.count - excluded,
    excluded,
    autoExcluded: auto,
    manualExcluded: manual
  };
}

/** Smallest clearance trim (<=150mm) that would fit another row/column. */
export function panelHeadroomHint(
  design: DesignState,
  panel: PanelSpec
): HeadroomHint | null {
  const candidates: HeadroomHint[] = [];
  design.slopes.forEach((slope) => {
    const geom = slopeGeometry(slope);
    if (!geom.complete) return;
    const fit = fitFor(design, slope, geom, panel, slope.orientation || 'auto');
    if (fit.rows > 0) {
      const deficitW =
        (fit.cols + 1) * (fit.alongW + fit.gap) - fit.gap - fit.usableW;
      if (deficitW > 0) {
        const mm = Math.ceil(deficitW / 2);
        if (mm <= HEADROOM_HINT_MAX_MM) {
          candidates.push({
            mm,
            extra: fit.rows,
            slopeLabel: slope.label,
            param: 'side clearance'
          });
        }
      }
    }
    if (fit.cols > 0) {
      const deficitS =
        (fit.rows + 1) * (fit.alongS + fit.gap) - fit.gap - fit.usableS;
      if (deficitS > 0) {
        const mm = Math.ceil(deficitS);
        if (mm <= HEADROOM_HINT_MAX_MM) {
          candidates.push({
            mm,
            extra: fit.cols,
            slopeLabel: slope.label,
            param: 'ridge or gutter clearance'
          });
        }
      }
    }
  });
  if (!candidates.length) return null;
  // Stable sort by (mm asc, extra desc), matching Array.prototype.sort.
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.mm - b.c.mm || b.c.extra - a.c.extra || a.i - b.i)[0].c;
}

/**
 * Turns a dragged box (roof mm, any corner order) into an obstruction, clamped
 * to the roof face and rounded to whole mm. Null when too small to keep.
 */
export function obstructionFromDrag(
  geom: SlopeGeometry,
  a: { x: number; y: number },
  b: { x: number; y: number },
  id: string
): Obstruction | null {
  const ax = clamp(a.x, 0, geom.widthMm);
  const ay = clamp(a.y, 0, geom.slopeMm);
  const bx = clamp(b.x, 0, geom.widthMm);
  const by = clamp(b.y, 0, geom.slopeMm);
  const w = Math.abs(bx - ax);
  const h = Math.abs(by - ay);
  if (!(w > OBSTRUCTION_MIN_MM && h > OBSTRUCTION_MIN_MM)) return null;
  return {
    id,
    x: Math.round(Math.min(ax, bx)),
    y: Math.round(Math.min(ay, by)),
    w: Math.round(w),
    h: Math.round(h)
  };
}
