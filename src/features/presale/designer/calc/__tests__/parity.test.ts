// Parity: the ported calc modules against the prototype's own functions,
// executed straight out of the reference HTML (see artifact-harness.ts).

import { beforeAll, describe, expect, it } from 'vitest';

import * as catalogue from '../../catalogue';
import {
  defaultDesignState,
  newSlope,
  type DesignState,
  type Orientation
} from '../../types';
import { complexAddTargets } from '../complex';
import {
  autoExcludedIndices,
  calcHypotenuse,
  fitFor,
  netCountForSlope,
  panelHeadroomHint,
  slopeGeometry
} from '../geometry';
import { computePerformance } from '../performance';
import { computePricing } from '../pricing';
import { jobTotalsForPanel } from '../summary';
import {
  loadArtifact,
  toArtifactState,
  type Artifact
} from './artifact-harness';
import { FIXTURES } from './fixtures';

let artifact: Artifact;
beforeAll(() => {
  artifact = loadArtifact();
});

const ORIENTATIONS: Orientation[] = ['auto', 'portrait', 'landscape'];
const FIT_KEYS = [
  'cols',
  'rows',
  'count',
  'alongW',
  'alongS',
  'edge',
  'gap',
  'usableW',
  'usableS',
  'leftoverW',
  'leftoverS',
  'offsetW',
  'offsetS'
] as const;

function pick(obj: object, keys: readonly string[]): Record<string, unknown> {
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  keys.forEach((k) => {
    out[k] = src[k];
  });
  return out;
}

/** JSON round-trip, so both sides compare as plain data (NaN/undefined normalised the same way). */
function plain<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v));
}

function expectClose(actual: unknown, expected: unknown, path = ''): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    expect(
      Math.abs(actual - expected),
      `${path}: ${actual} vs ${expected}`
    ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
  } else if (expected && typeof expected === 'object') {
    Object.keys(expected).forEach((k) => {
      expectClose(
        (actual as Record<string, unknown>)[k],
        (expected as Record<string, unknown>)[k],
        `${path}.${k}`
      );
    });
  } else {
    expect(actual, path).toEqual(expected);
  }
}

describe('catalogue parity', () => {
  it('matches every constant in the prototype', () => {
    const c = artifact.constants;
    expect(catalogue.UPLIFT).toBe(c.UPLIFT);
    expect(plain(catalogue.PANELS)).toEqual(c.PANELS);
    expect(plain(catalogue.PANEL_PRICE_BY_FACE)).toEqual(c.PANEL_PRICE_BY_FACE);
    expect(plain(catalogue.ROOF_MATERIALS)).toEqual(c.ROOF_MATERIALS);
    expect(plain(catalogue.INVERTER_MODELS)).toEqual(c.INVERTER_MODELS);
    expect(plain(catalogue.INVERTER_CATEGORY_ORDER)).toEqual(
      c.INVERTER_CATEGORY_ORDER
    );
    // Battery dropdown order matters, so compare as ordered entries.
    expect(
      Object.keys(catalogue.STACKED_BATTERY).map((k) => [
        k,
        catalogue.STACKED_BATTERY[k]
      ])
    ).toEqual(c.STACKED_BATTERY);
    expect(plain(catalogue.EV_OPTIONS)).toEqual(c.EV_OPTIONS);
    expect(Object.keys(catalogue.EV_OPTIONS)).toEqual(
      Object.keys(c.EV_OPTIONS as object)
    );
    expect(plain(catalogue.DONGLE_OPTIONS)).toEqual(c.DONGLE_OPTIONS);
    expect(plain(catalogue.OFFGRID_OPTIONS)).toEqual(c.OFFGRID_OPTIONS);
    expect(plain(catalogue.BIRD_OPTIONS)).toEqual(c.BIRD_OPTIONS);
    expect(plain(catalogue.IBOOST_OPTIONS)).toEqual(c.IBOOST_OPTIONS);
    expect(plain(catalogue.IMMERSION_OPTIONS)).toEqual(c.IMMERSION_OPTIONS);
    expect(plain(catalogue.PVULTRA_OPTIONS)).toEqual(c.PVULTRA_OPTIONS);
    expect(Object.keys(catalogue.PVULTRA_OPTIONS)).toEqual(
      Object.keys(c.PVULTRA_OPTIONS as object)
    );
    expect(catalogue.OPTIMISER_PRICE).toBe(c.OPTIMISER_PRICE);
    expect(plain(catalogue.FINANCE_FEE)).toEqual(c.FINANCE_FEE);
    expect(catalogue.FIXED_FEE_1).toBe(c.FIXED_FEE_1);
    expect(catalogue.FIXED_FEE_2).toBe(c.FIXED_FEE_2);
    expect(plain(catalogue.DEPOSIT_SPLITS)).toEqual(c.DEPOSIT_SPLITS);
    expect(catalogue.ELECTRICITY_INFLATION_PCT).toBe(
      c.ELECTRICITY_INFLATION_PCT
    );
    expect(plain(catalogue.PANEL_DEGRADATION_PCT)).toEqual(
      c.PANEL_DEGRADATION_PCT
    );
    expect(catalogue.PERFORMANCE_RATIO).toBe(c.PERFORMANCE_RATIO);
    expect(plain(catalogue.ORDINAL_WORDS)).toEqual(c.ORDINAL_WORDS);
  });

  it('starts a new job from the same defaults', () => {
    const theirs = artifact.constants.defaultState as Record<string, unknown>;
    const mine = toArtifactState(defaultDesignState());
    expect(plain({ ...mine, page: 1, maxPage: 1 })).toEqual(theirs);
  });

  it('names elevations the same way', () => {
    [1, 2, 3, 10, 11, 14].forEach((n) => {
      expect(catalogue.ordinalElevationLabel(n)).toBe(artifact.ordinal(n));
    });
  });
});

describe('fit parity — roof size sweep', () => {
  it('matches fitFor + auto-exclusion for every size, panel, orientation and bias', () => {
    let compared = 0;
    const biases: [number, number][] = [
      [0, 0],
      [-1, 1],
      [0.38, -0.72]
    ];
    for (let x = 1.0; x <= 12.5; x += 0.83) {
      for (let y = 1.4; y <= 8.2; y += 0.57) {
        biases.forEach(([shiftBias, shiftBiasV], bi) => {
          const d: DesignState = defaultDesignState();
          d.slopes = [
            { ...newSlope('s1', 1), xM: x, yM: y, shiftBias, shiftBiasV }
          ];
          if (bi !== 0) {
            d.obstructions = {
              s1: [
                {
                  id: 'a',
                  x: x * 1000 * 0.3,
                  y: y * 1000 * 0.25,
                  w: 700,
                  h: 900
                },
                {
                  id: 'b',
                  x: x * 1000 * 0.72,
                  y: y * 1000 * 0.6,
                  w: 420,
                  h: 380
                }
              ]
            };
          }
          artifact.load(d);
          const slope = d.slopes[0];
          const geom = slopeGeometry(slope);
          catalogue.PANELS.forEach((panel) => {
            ORIENTATIONS.forEach((o) => {
              const theirs = artifact.fit('s1', panel.id, o);
              expect(theirs).not.toBeNull();
              const mine = fitFor(d, slope, geom, panel, o);
              expect(plain(pick(mine, FIT_KEYS))).toEqual(
                pick(theirs!.fit, FIT_KEYS)
              );
              expect(autoExcludedIndices(d, slope, mine)).toEqual(theirs!.auto);
              compared++;
            });
          });
        });
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });
});

describe.each(FIXTURES)('fixture parity — $name', ({ build }) => {
  it('matches per-slope net counts, job totals and headroom hints', () => {
    const d = build();
    artifact.load(d);
    catalogue.PANELS.forEach((panel) => {
      d.slopes.forEach((slope) => {
        const theirs = artifact.net(slope.id, panel.id);
        const geom = slopeGeometry(slope);
        if (!geom.complete) {
          expect(theirs).toBeNull();
          return;
        }
        const mine = netCountForSlope(d, slope, geom, panel);
        expect({
          net: mine.net,
          excluded: mine.excluded,
          cols: mine.fit.cols,
          rows: mine.fit.rows,
          count: mine.fit.count
        }).toEqual(theirs);
      });
      const totals = jobTotalsForPanel(d, panel);
      expect(
        plain({
          totalCount: totals.totalCount,
          totalKwp: totals.totalKwp,
          perSlope: totals.perSlope.map((s) => ({
            label: s.label,
            count: s.count
          }))
        })
      ).toEqual(artifact.totals(panel.id));
      expect(plain(panelHeadroomHint(d, panel))).toEqual(
        artifact.hint(panel.id)
      );
    });
    d.slopes.forEach((slope) => {
      expect(plain(calcHypotenuse(slope))).toEqual(artifact.hyp(slope.id));
    });
  });

  it('matches computePricing field for field', () => {
    const d = build();
    artifact.load(d);
    const theirs = artifact.pricing();
    const mine = plain(computePricing(d)) as Record<string, unknown>;
    expect(theirs).not.toBeNull();
    expectClose(mine, theirs, 'pricing');
  });

  it('matches computePerformance field for field', () => {
    const d = build();
    artifact.load(d);
    const theirs = artifact.performance();
    const mine = plain(computePerformance(d)) as Record<string, unknown>;
    expect(theirs).not.toBeNull();
    expectClose(mine, theirs, 'performance');
  });

  it('gives the same answers for every panel choice', () => {
    catalogue.PANELS.forEach((panel) => {
      const d = { ...build(), selectedPanelId: panel.id };
      artifact.load(d);
      expectClose(
        plain(computePricing(d)),
        artifact.pricing(),
        `pricing[${panel.id}]`
      );
      expectClose(
        plain(computePerformance(d)),
        artifact.performance(),
        `performance[${panel.id}]`
      );
    });
  });
});

describe('no panel selected', () => {
  it('prices nothing, like the prototype', () => {
    const d = defaultDesignState();
    artifact.load(d);
    expect(artifact.pricing()).toBeNull();
    expect(computePricing(d)).toBeNull();
    expect(computePerformance(d)).toBeNull();
  });
});

describe('complex layout parity', () => {
  it('offers the same add targets in the same order', () => {
    const layouts = [
      {
        orientation: 'portrait',
        cells: [
          { r: 0, c: 0 },
          { r: 1, c: 0 }
        ],
        customized: false
      },
      {
        orientation: 'landscape',
        cells: [
          { r: 0, c: 0 },
          { r: 0, c: 1 },
          { r: 1, c: 1 },
          { r: -1, c: 0 }
        ],
        customized: true
      },
      { orientation: 'portrait', cells: [{ r: 0, c: 0 }], customized: true }
    ] as const;
    layouts.forEach((layout) => {
      const mine = complexAddTargets({
        ...layout,
        cells: layout.cells.map((c) => ({ ...c }))
      });
      const theirs = artifact.addTargets(layout);
      // The prototype keys targets in an object, so its order is insertion order too.
      expect(mine).toEqual(theirs);
    });
  });
});
