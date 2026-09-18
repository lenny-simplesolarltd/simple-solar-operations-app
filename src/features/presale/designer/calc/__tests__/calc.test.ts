// Hand-worked expectations, each derived from the prototype's formula at the
// cited line of docs/ui-reference/ben-system-designer-prototype-v0.12.html.
// (parity.test.ts checks the same modules against the prototype's live code.)

import { describe, expect, it } from 'vitest';

import { PANELS, panelById } from '../../catalogue';
import { defaultDesignState, newSlope } from '../../types';
import {
  complexUsedCount,
  ensureComplexLayouts,
  resolveComplexLayout
} from '../complex';
import {
  autoExcludedIndices,
  calcHypotenuse,
  fitFor,
  netCountForSlope,
  obstructionFromDrag,
  panelHeadroomHint,
  rectsOverlap,
  slopeGeometry
} from '../geometry';
import { computePerformance } from '../performance';
import { computeExtras, computePricing, depositRows } from '../pricing';
import { computeSnapshot, layoutStats, panelOptions } from '../summary';
import {
  fixtureComplexOnly,
  fixtureKitchenSink,
  fixtureSimple
} from './fixtures';

const MCLASS = panelById('mclass-475')!;
const P7 = panelById('p7-510')!;

describe('panel fit (fitFor, L943-982)', () => {
  const d = fixtureSimple(); // 8.2 m x 5.4 m, gap 10, ridge 300, eave 200, verge 100
  const slope = d.slopes[0];
  const geom = slopeGeometry(slope);

  it('takes X as eave width and Y as rafter length, no trig (L766-779)', () => {
    expect(geom).toEqual({ complete: true, widthMm: 8200, slopeMm: 5400 });
  });

  it('portrait: floor(8010/1144) x floor(4910/1772) = 7 x 2', () => {
    const fit = fitFor(d, slope, geom, MCLASS, 'portrait');
    expect([fit.usableW, fit.usableS]).toEqual([8000, 4900]);
    expect([fit.cols, fit.rows, fit.count]).toEqual([7, 2, 14]);
  });

  it('landscape: floor(8010/1772) x floor(4910/1144) = 4 x 4, centred with the leftover halved', () => {
    const fit = fitFor(d, slope, geom, MCLASS, 'landscape');
    expect([fit.cols, fit.rows, fit.count]).toEqual([4, 4, 16]);
    expect(fit.leftoverW).toBeCloseTo(8000 - (4 * 1772 - 10), 9); // 922
    expect(fit.leftoverS).toBeCloseTo(4900 - (4 * 1144 - 10), 9); // 334
    expect(fit.offsetW).toBeCloseTo(461, 9);
    expect(fit.offsetS).toBeCloseTo(167, 9);
  });

  it('auto picks landscape only when strictly bigger; ties go to portrait', () => {
    expect(fitFor(d, slope, geom, MCLASS, 'auto').orientation).toBe(
      'landscape'
    );
    // 1.4 m x 2.3 m: exactly one panel either way round -> portrait.
    const tie = { ...d, slopes: [{ ...slope, xM: 2.3, yM: 2.5 }] };
    const tieFit = fitFor(
      tie,
      tie.slopes[0],
      slopeGeometry(tie.slopes[0]),
      MCLASS,
      'auto'
    );
    expect(
      fitFor(
        tie,
        tie.slopes[0],
        slopeGeometry(tie.slopes[0]),
        MCLASS,
        'portrait'
      ).count
    ).toBe(
      fitFor(
        tie,
        tie.slopes[0],
        slopeGeometry(tie.slopes[0]),
        MCLASS,
        'landscape'
      ).count
    );
    expect(tieFit.orientation).toBe('portrait');
  });

  it('shift bias: -1 hugs the left verge / ridge, +1 the right verge / eave', () => {
    const left = fitFor(
      d,
      { ...slope, shiftBias: -1, shiftBiasV: -1 },
      geom,
      MCLASS,
      'landscape'
    );
    const right = fitFor(
      d,
      { ...slope, shiftBias: 1, shiftBiasV: 1 },
      geom,
      MCLASS,
      'landscape'
    );
    expect([left.offsetW, left.offsetS]).toEqual([0, 0]);
    expect(right.offsetW).toBeCloseTo(922, 9);
    expect(right.offsetS).toBeCloseTo(334, 9);
  });

  it('fits nothing on a face smaller than its clearances', () => {
    const tiny = { ...d, slopes: [{ ...slope, xM: 0.15, yM: 0.4 }] };
    const fit = fitFor(
      tiny,
      tiny.slopes[0],
      slopeGeometry(tiny.slopes[0]),
      P7,
      'auto'
    );
    expect([fit.usableW, fit.usableS, fit.count]).toEqual([0, 0, 0]);
  });
});

describe('obstructions (L757, L984-1000, L1713)', () => {
  it('overlap is strict — touching edges do not count', () => {
    expect(
      rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })
    ).toBe(false);
    expect(
      rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9.99, y: 0, w: 5, h: 5 })
    ).toBe(true);
  });

  it('auto-excludes exactly the panels an obstruction touches, and auto orientation nets it out', () => {
    const d = fixtureSimple();
    const slope = d.slopes[0];
    const geom = slopeGeometry(slope);
    // Landscape origin is (100+461, 300+167) = (561, 467); panel 0 spans x 561-2333, y 467-1601.
    d.obstructions = { s1: [{ id: 'o', x: 600, y: 500, w: 100, h: 100 }] };
    const fit = fitFor(d, slope, geom, MCLASS, 'landscape');
    expect(autoExcludedIndices(d, slope, fit)).toEqual([0]);
    // Straddling the 10mm gap between panels 0 and 1 (x 2333-2343) and rows 0 and 1 (y 1601-1611).
    d.obstructions = { s1: [{ id: 'o', x: 2300, y: 1590, w: 60, h: 40 }] };
    expect(autoExcludedIndices(d, slope, fit)).toEqual([0, 1, 4, 5]);
    // Auto now weighs net counts: landscape nets 16-4 = 12, but in portrait
    // (origin 101, 983; panels 1134 x 1762) the box only clips row 0, column 1,
    // so portrait nets 14-1 = 13 and wins despite the smaller raw grid.
    const r = netCountForSlope(d, slope, geom, MCLASS);
    expect(r.fit.orientation).toBe('portrait');
    expect([r.fit.count, r.excluded, r.net]).toEqual([14, 1, 13]);
  });

  it('counts a panel once when it is both tapped out and under an obstruction, ignoring stale indices (L1049-1058)', () => {
    const d = fixtureSimple();
    d.obstructions = { s1: [{ id: 'o', x: 600, y: 500, w: 100, h: 100 }] };
    d.exclusions = { 's1|mclass-475': [0, 7, 400] };
    const r = netCountForSlope(
      d,
      d.slopes[0],
      slopeGeometry(d.slopes[0]),
      MCLASS
    );
    expect([r.fit.count, r.excluded, r.net]).toEqual([16, 2, 14]);
  });

  it('keeps a drawn box only when both sides exceed 40mm, clamped and rounded to the roof', () => {
    const geom = { complete: true, widthMm: 8200, slopeMm: 5400 };
    expect(
      obstructionFromDrag(geom, { x: 100, y: 100 }, { x: 140, y: 400 }, 'a')
    ).toBeNull();
    expect(
      obstructionFromDrag(geom, { x: 100, y: 100 }, { x: 140.5, y: 400 }, 'a')
    ).not.toBeNull();
    expect(
      obstructionFromDrag(
        geom,
        { x: 8500.4, y: 5300.6 },
        { x: 7000.2, y: -50 },
        'b'
      )
    ).toEqual({
      id: 'b',
      x: 7000,
      y: 0,
      w: 1200,
      h: 5301
    });
  });
});

describe('slope calculator (calcHypotenuse, L930-935)', () => {
  const slope = (pitchDeg: number | '', calcAdjacentM: number | '') => ({
    ...newSlope('s', 1),
    pitchDeg,
    calcAdjacentM
  });
  it('hypotenuse = adjacent / cos(pitch)', () => {
    expect(calcHypotenuse(slope(30, 4))).toBeCloseTo(4.618802153517, 9);
    expect(calcHypotenuse(slope(45, 3.5))).toBeCloseTo(3.5 * Math.SQRT2, 9);
  });
  it('needs adjacent > 0 and 0 < pitch < 90', () => {
    [
      slope('', 4),
      slope(30, ''),
      slope(0, 4),
      slope(90, 4),
      slope(30, 0),
      slope(-5, 4)
    ].forEach((s) => {
      expect(calcHypotenuse(s)).toBeNull();
    });
  });
});

describe('headroom hint (panelHeadroomHint, L1002-1026)', () => {
  it('suggests the smallest trim of 150mm or less, per verge for width', () => {
    const d = defaultDesignState();
    // Portrait M Class needs 5*1144-10 = 5710 usable for 5 columns; give 5600 -> 110 short -> 55mm per verge.
    d.slopes = [
      { ...newSlope('s1', 1), xM: 5.8, yM: 2.4, orientation: 'portrait' }
    ];
    expect(panelHeadroomHint(d, MCLASS)).toEqual({
      mm: 55,
      extra: 1,
      slopeLabel: 'Primary Elevation',
      param: 'side clearance'
    });
  });
  it('says nothing when the next panel is more than 150mm away', () => {
    const d = defaultDesignState();
    d.slopes = [
      { ...newSlope('s1', 1), xM: 5.3, yM: 2.4, orientation: 'portrait' }
    ];
    expect(panelHeadroomHint(d, MCLASS)).toBeNull();
  });
});

describe('pricing (computePricing, L1061-1166)', () => {
  it('prices fixture A by hand', () => {
    const c = computePricing(fixtureSimple())!;
    expect(c.totalNetPanels).toBe(16);
    expect(c.totalKwp).toBeCloseTo(7.6, 9);
    expect(c.panelsMountingSubtotal).toBeCloseTo(16 * (160.5 + 57.7) * 1.18, 9); // 4119.616
    expect(c.inverterSubtotal).toBeCloseTo((980 * 1.05 + 0 + 1300) * 1.18, 9); // 2748.22
    expect(c.extras).toBeCloseTo(85 + 12 * 8.5, 9); // dongle + whole 12 m AC run
    expect(c.scaffoldSubtotal).toBeCloseTo(566.4, 9); // ((8+2)*24)*2*1.18
    expect(c.labourDays).toBe(3); // ceil(16/12 + 1)
    expect(c.labourSubtotal).toBeCloseTo(1.18 * 3 * 585, 9); // 2070.90
    expect(c.equipmentSubtotal).toBeCloseTo(
      4119.616 + 2748.22 + 187 + 0 + 350,
      9
    );
    expect(c.installationSubtotal).toBeCloseTo(566.4 + 2070.9 + 480, 9);
    expect(c.total).toBeCloseTo(11122.136, 9);
    expect(depositRows(c.total).map((r) => r.label)).toEqual([
      'Due today (25%)',
      'One week before install (35%)',
      'Balance on completion (40%)'
    ]);
    expect(
      depositRows(c.total).reduce((sum, r) => sum + r.amount, 0)
    ).toBeCloseTo(c.total, 9);
    expect(c.capacityWarning).toBeNull(); // KH7 is rated 8 kWp
  });

  it('charges the whole AC run once it is over 5 m, nothing at 5 m or under (L1073)', () => {
    const d = fixtureSimple();
    d.pricing.extras.acRunM = 5;
    expect(computeExtras(d)).toBe(85);
    d.pricing.extras.acRunM = 5.5;
    expect(computeExtras(d)).toBeCloseTo(85 + 46.75, 9);
  });

  it('keeps the live form’s quirks: dongle "No" is £80, and £1,300 is added with no inverter at all', () => {
    const d = fixtureComplexOnly();
    d.pricing.extras.dongle = 'No';
    const c = computePricing(d)!;
    expect(c.extras).toBe(80);
    expect(c.inverterSubtotal).toBeCloseTo(1300 * 1.18, 9);
    expect(c.scaffoldSubtotal).toBe(0); // 0 m of scaffold
    expect(c.financeFee).toBe(125); // Maybe
    expect(c.noInverterWarning).toMatch(/^No inverter added/);
  });

  it('uses face 3 panel pricing on the third elevation and each face’s own roof material (L491-494, L628)', () => {
    const d = fixtureKitchenSink();
    const nets = d.slopes.map((s) => {
      const geom = slopeGeometry(s);
      return s.shapeMode === 'complex'
        ? complexUsedCount(d, s, P7)
        : netCountForSlope(d, s, geom, P7).net;
    });
    const expected =
      (nets[0] * (110.5 + 67.7) +
        nets[1] * (110.5 + 205) +
        nets[2] * (120.5 + 52.32)) *
      1.18;
    const c = computePricing(d)!;
    expect(nets[1]).toBe(4); // the laid-out cells, not the entered max of 6
    expect(c.panelsMountingSubtotal).toBeCloseTo(expected, 9);
    expect(c.slopesWithPanels).toBe(3);
    expect(c.capacityNote).toMatch(/^Capacity check skipped/); // a Tesla line has no rating
  });

  it('warns when the system is over the inverters’ total rating, with a 1e-9 tolerance', () => {
    const d = fixtureSimple(); // 7.60 kWp
    d.pricing.inverterLines = [
      { id: 'l1', modelId: 'fox-h1-3.7', qty: 1 },
      { id: 'l2', modelId: 'fox-f3000', qty: 1 }
    ];
    expect(computePricing(d)!.capacityWarning).toBe(
      'Selected inverters total 7.00kWp — this system is 7.60kWp, over the rated limit.'
    );
    d.pricing.inverterLines = [{ id: 'l1', modelId: 'fox-kh7', qty: 1 }];
    expect(computePricing(d)!.capacityWarning).toBeNull();
    d.pricing.inverterLines = [
      { id: 'l1', modelId: 'fox-kh7', qty: 1 },
      { id: 'l2', modelId: '', qty: 1 }
    ];
    expect(computePricing(d)!.noInverterWarning).toBe(
      'Select an inverter for every line — 1 of 2 still say "Select inverter…".'
    );
  });
});

describe('performance (computePerformance, L1174-1235)', () => {
  it('works fixture A through by hand', () => {
    const p = computePerformance(fixtureSimple())!;
    const gen = 7.6 * 950 * 0.85 * (1 - 5 / 100); // 5830.15
    expect(p.annualGenerationKwh).toBeCloseTo(gen, 9);
    expect(p.generationUsedKwh).toBeCloseTo(gen * 0.7, 9);
    expect(p.generationExportKwh).toBeCloseTo(gen * 0.3, 9);
    expect(p.electricitySavings).toBeCloseTo(gen * 0.7 * 0.2749, 9);
    expect(p.segIncome).toBeCloseTo(gen * 0.3 * 0.12, 9);
    const year1 = gen * 0.7 * 0.2749 + gen * 0.3 * 0.12;
    const r = (1 - 0.25 / 100) * 1.05; // M Class degrades 0.25%/yr
    expect(p.totalIncome30yr).toBeCloseTo(
      (year1 * (Math.pow(r, 30) - 1)) / (r - 1),
      6
    );
    expect(p.roiPct).toBeCloseTo((year1 / 11122.136) * 100, 9);
    expect(p.overConsumptionWarning).toBe(true); // 4,081 kWh used > 4,000 kWh stated
  });

  it('gives P7 a 30-year multiplier of 61.84x — the figure observed on the live form (L608-615)', () => {
    const r = (1 - 0.4 / 100) * 1.05;
    expect((Math.pow(r, 30) - 1) / (r - 1)).toBeCloseTo(61.84, 2);
  });

  it('skips (and flags) elevations with no radiance instead of guessing', () => {
    const p = computePerformance(fixtureComplexOnly())!;
    expect(p.missingRadiance).toBe(true);
    expect(p.annualGenerationKwh).toBe(0);
    expect(p.roiPct).toBe(0);
  });
});

describe('complex layouts (L788-873)', () => {
  it('prices the entered max until Layout is opened, then the laid-out cells', () => {
    const d = fixtureComplexOnly();
    const slope = d.slopes[0];
    expect(complexUsedCount(d, slope, P7)).toBe(11);
    expect(complexUsedCount(d, slope, MCLASS)).toBe(0); // no M Class count entered
    const opened = ensureComplexLayouts(d, P7);
    expect(opened).not.toBe(d);
    expect(complexUsedCount(opened, slope, P7)).toBe(2); // starts as a stacked pair
    expect(ensureComplexLayouts(opened, P7)).toBe(opened); // idempotent
    expect(d.complexLayouts).toEqual({}); // never mutates
  });

  it('trims a layout when the max is later reduced', () => {
    const d = fixtureKitchenSink();
    d.slopes[1].maxPanelsP7 = 3;
    expect(resolveComplexLayout(d, d.slopes[1], P7).cells).toHaveLength(3);
    expect(complexUsedCount(d, d.slopes[1], P7)).toBe(3);
  });
});

describe('summaries', () => {
  it('marks the highest-kWp panel best, the first card winning ties', () => {
    const empty = panelOptions(defaultDesignState());
    expect(empty.map((o) => o.best)).toEqual([true, false]);
    const options = panelOptions(fixtureSimple());
    expect(options.map((o) => [o.panel.id, o.totals.totalCount])).toEqual([
      ['mclass-475', 16],
      ['p7-510', 14]
    ]);
    expect(options.map((o) => o.best)).toEqual([true, false]); // 7.60 kWp vs 7.14 kWp (P7 fits 7 x 2 portrait)
    expect(options.map((o) => o.selected)).toEqual([true, false]);
  });

  it('adds up the Layout stat strip', () => {
    const d = fixtureKitchenSink();
    const stats = layoutStats(d, P7);
    expect(stats.net).toBe(computePricing(d)!.totalNetPanels);
    expect(stats.gross - stats.excluded).toBe(stats.net);
    expect(stats.kwp).toBeCloseTo((stats.net * 510) / 1000, 9);
  });

  it('snapshots nothing without a panel', () => {
    expect(computeSnapshot(defaultDesignState())).toBeNull();
    expect(PANELS).toHaveLength(2);
  });
});
