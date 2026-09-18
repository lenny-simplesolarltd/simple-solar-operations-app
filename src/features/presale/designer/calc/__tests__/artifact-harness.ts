// Loads the prototype's own pure functions out of the reference HTML and runs
// them in an isolated node:vm context, so the ported calc modules can be
// compared against the artifact directly rather than against hand-copied
// expectations. The HTML is treated strictly as data: only the span between
// two known markers (catalogue, state, geometry, pricing, performance — no
// DOM wiring) is evaluated, in a context with no globals.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { numOr0, type DesignState } from '../../types';

const HTML_PATH = path.resolve(
  __dirname,
  '../../../../../../docs/ui-reference/ben-system-designer-prototype-v0.12.html'
);
const START_MARKER = "var STORE_KEY = 'rafterRidge.v3';";
const END_MARKER = '// ---------- SVG ----------';

const EXPORTS = `
  return {
    setState: function(json){ state = JSON.parse(json); },
    constants: function(){ return JSON.stringify({
      UPLIFT: UPLIFT, PANELS: PANELS, PANEL_PRICE_BY_FACE: PANEL_PRICE_BY_FACE,
      ROOF_MATERIALS: ROOF_MATERIALS, INVERTER_MODELS: INVERTER_MODELS,
      INVERTER_CATEGORY_ORDER: INVERTER_CATEGORY_ORDER,
      STACKED_BATTERY: Object.keys(STACKED_BATTERY).map(function(k){ return [k, STACKED_BATTERY[k]]; }),
      EV_OPTIONS: EV_OPTIONS, DONGLE_OPTIONS: DONGLE_OPTIONS, OFFGRID_OPTIONS: OFFGRID_OPTIONS,
      BIRD_OPTIONS: BIRD_OPTIONS, IBOOST_OPTIONS: IBOOST_OPTIONS, IMMERSION_OPTIONS: IMMERSION_OPTIONS,
      PVULTRA_OPTIONS: PVULTRA_OPTIONS, OPTIMISER_PRICE: OPTIMISER_PRICE, FINANCE_FEE: FINANCE_FEE,
      FIXED_FEE_1: FIXED_FEE_1, FIXED_FEE_2: FIXED_FEE_2, DEPOSIT_SPLITS: DEPOSIT_SPLITS,
      ELECTRICITY_INFLATION_PCT: ELECTRICITY_INFLATION_PCT, PANEL_DEGRADATION_PCT: PANEL_DEGRADATION_PCT,
      PERFORMANCE_RATIO: PERFORMANCE_RATIO, ORDINAL_WORDS: ORDINAL_WORDS,
      defaultState: defaultState()
    }); },
    fit: function(slopeId, panelId, orientation){
      var slope = state.slopes.filter(function(s){ return s.id===slopeId; })[0];
      var geom = slopeGeometry(slope);
      if (!geom.complete) return 'null';
      var fit = fitFor(slope, geom, panelById(panelId), orientation);
      return JSON.stringify({ fit: fit, auto: Array.from(autoExcludedSet(slope, fit)) });
    },
    net: function(slopeId, panelId){
      var slope = state.slopes.filter(function(s){ return s.id===slopeId; })[0];
      var geom = slopeGeometry(slope);
      if (!geom.complete) return 'null';
      var r = netCountForSlope(slope, geom, panelById(panelId));
      return JSON.stringify({ net: r.net, excluded: r.exClamped, cols: r.fit.cols, rows: r.fit.rows, count: r.fit.count });
    },
    hint: function(panelId){ return JSON.stringify(panelHeadroomHint(panelById(panelId))); },
    totals: function(panelId){ return JSON.stringify(jobTotalsForPanel(panelById(panelId))); },
    hyp: function(slopeId){
      var slope = state.slopes.filter(function(s){ return s.id===slopeId; })[0];
      return JSON.stringify(calcHypotenuse(slope));
    },
    pricing: function(){ return JSON.stringify(computePricing()); },
    performance: function(){ return JSON.stringify(computePerformance()); },
    addTargets: function(layoutJson){ return JSON.stringify(complexLayoutAddTargets(JSON.parse(layoutJson))); },
    ordinal: function(n){ return ordinalElevationLabel(n); }
  };
`;

interface RawArtifact {
  setState(json: string): void;
  constants(): string;
  fit(slopeId: string, panelId: string, orientation: string): string;
  net(slopeId: string, panelId: string): string;
  hint(panelId: string): string;
  totals(panelId: string): string;
  hyp(slopeId: string): string;
  pricing(): string;
  performance(): string;
  addTargets(layoutJson: string): string;
  ordinal(n: number): string;
}

export interface ArtifactFit {
  fit: Record<string, unknown>;
  auto: number[];
}

export interface Artifact {
  constants: Record<string, unknown>;
  load(design: DesignState): void;
  fit(
    slopeId: string,
    panelId: string,
    orientation: string
  ): ArtifactFit | null;
  net(slopeId: string, panelId: string): Record<string, number> | null;
  hint(panelId: string): Record<string, unknown> | null;
  totals(panelId: string): Record<string, unknown>;
  hyp(slopeId: string): number | null;
  pricing(): Record<string, unknown> | null;
  performance(): Record<string, unknown> | null;
  addTargets(layout: unknown): { r: number; c: number }[];
  ordinal(n: number): string;
}

/**
 * The artifact keeps roof params as numbers (blank -> 0) and does arithmetic
 * on them directly; everything else it runs through parseFloat itself.
 */
export function toArtifactState(design: DesignState): Record<string, unknown> {
  return {
    ...design,
    page: 1,
    maxPage: 7,
    params: {
      gapMm: numOr0(design.params.gapMm),
      ridgeMm: numOr0(design.params.ridgeMm),
      eaveMm: numOr0(design.params.eaveMm),
      vergeMm: numOr0(design.params.vergeMm)
    }
  };
}

export function loadArtifact(): Artifact {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      'Prototype markers not found — has the reference HTML changed?'
    );
  }
  const source = `(function(){ "use strict";\n${html.slice(start, end)}\n${EXPORTS}\n})()`;
  const raw = vm.runInNewContext(source, Object.create(null), {
    timeout: 5000
  }) as RawArtifact;
  const parse = <T>(json: string): T => JSON.parse(json) as T;
  return {
    constants: parse<Record<string, unknown>>(raw.constants()),
    load: (design) => raw.setState(JSON.stringify(toArtifactState(design))),
    fit: (s, p, o) => parse<ArtifactFit | null>(raw.fit(s, p, o)),
    net: (s, p) => parse<Record<string, number> | null>(raw.net(s, p)),
    hint: (p) => parse<Record<string, unknown> | null>(raw.hint(p)),
    totals: (p) => parse<Record<string, unknown>>(raw.totals(p)),
    hyp: (s) => parse<number | null>(raw.hyp(s)),
    pricing: () => parse<Record<string, unknown> | null>(raw.pricing()),
    performance: () => parse<Record<string, unknown> | null>(raw.performance()),
    addTargets: (layout) =>
      parse<{ r: number; c: number }[]>(raw.addTargets(JSON.stringify(layout))),
    ordinal: (n) => raw.ordinal(n)
  };
}
