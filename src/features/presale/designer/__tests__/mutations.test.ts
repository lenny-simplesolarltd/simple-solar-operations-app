import { describe, expect, it } from 'vitest';

import { complexUsedCount } from '../calc';
import {
  fixtureComplexOnly,
  fixtureKitchenSink,
  fixtureSimple
} from '../calc/__tests__/fixtures';
import { panelById } from '../catalogue';
import {
  addInverterLine,
  addSlope,
  applyCalculatedSlope,
  confirmSlope,
  editComplexLayout,
  removeInverterLine,
  removeSlope,
  renameSlope,
  selectPanel,
  setShapeMode,
  setSlopeValue,
  toggleExclusion
} from '../mutations';
import { defaultDesignState } from '../types';

const P7 = panelById('p7-510')!;

describe('elevation confirmation', () => {
  it('is withdrawn by any measurement change — the path the − / + buttons share with typing', () => {
    const d = fixtureSimple();
    expect(d.slopes[0].confirmed).toBe(true);
    const next = setSlopeValue(d, 's1', 'xM', 8.3);
    expect(next.slopes[0]).toMatchObject({ xM: 8.3, confirmed: false });
    expect(d.slopes[0].confirmed).toBe(true); // input untouched
  });

  it('survives a rename, but not a tab switch', () => {
    const d = fixtureSimple();
    expect(renameSlope(d, 's1', 'Garage').slopes[0]).toMatchObject({
      label: 'Garage',
      confirmed: true
    });
    expect(setShapeMode(d, 's1', 'rect')).toEqual(d);
    expect(setShapeMode(d, 's1', 'complex').slopes[0]).toMatchObject({
      shapeMode: 'complex',
      confirmed: false
    });
  });

  it('"Use Calculated Value" writes Y to 2dp, returns to Rectangle, unconfirmed', () => {
    let d = defaultDesignState();
    d = setShapeMode(d, 's1', 'calc');
    d = setSlopeValue(d, 's1', 'pitchDeg', 30);
    d = setSlopeValue(d, 's1', 'calcAdjacentM', 4);
    d = applyCalculatedSlope(confirmSlope(d, 's1'), 's1');
    expect(d.slopes[0]).toMatchObject({
      yM: 4.62,
      shapeMode: 'rect',
      confirmed: false
    });
    const blank = setShapeMode(defaultDesignState(), 's1', 'calc');
    expect(applyCalculatedSlope(blank, 's1')).toEqual(blank);
  });
});

describe('elevations list', () => {
  it('names new elevations ordinally and carries pitch, orientation and material over', () => {
    let d = defaultDesignState();
    d = setSlopeValue(d, 's1', 'pitchDeg', 35);
    d.slopes[0].roofMaterial = 'Ground mount';
    d.slopes[0].orientation = 'landscape';
    d = addSlope(addSlope(d));
    expect(d.slopes.map((s) => [s.id, s.label])).toEqual([
      ['s1', 'Primary Elevation'],
      ['s2', 'Second Elevation'],
      ['s3', 'Third Elevation']
    ]);
    expect(d.slopes[2]).toMatchObject({
      pitchDeg: 35,
      roofMaterial: 'Ground mount',
      orientation: 'landscape',
      xM: '',
      confirmed: false
    });
    expect(d.slopeSeq).toBe(4);
  });

  it('never reuses an id, and removing an elevation takes its obstructions, exclusions and layouts with it', () => {
    const d = removeSlope(fixtureKitchenSink(), 's1');
    expect(d.slopes.map((s) => s.id)).toEqual(['s2', 's3']);
    expect(d.obstructions).toEqual({});
    expect(Object.keys(d.exclusions)).toEqual(['s3|p7-510']);
    expect(Object.keys(d.complexLayouts)).toEqual(['s2|p7-510']);
    expect(addSlope(d).slopes[2].id).toBe('s4');
  });
});

describe('layout edits', () => {
  it('toggles a tapped-out panel on and off', () => {
    const on = toggleExclusion(fixtureSimple(), 's1', 'mclass-475', 5);
    expect(on.exclusions['s1|mclass-475']).toEqual([5]);
    expect(
      toggleExclusion(on, 's1', 'mclass-475', 5).exclusions['s1|mclass-475']
    ).toEqual([]);
  });

  it('choosing a panel materialises its Complex layouts, as opening Layout did in the prototype', () => {
    const d = selectPanel(
      { ...fixtureComplexOnly(), selectedPanelId: null },
      'p7-510'
    );
    expect(d.selectedPanelId).toBe('p7-510');
    expect(d.complexLayouts['s1|p7-510'].cells).toHaveLength(2);
  });

  it('adds cells up to the max, always leaves one, and resets orientation only until customised', () => {
    let d = selectPanel(fixtureComplexOnly(), 'p7-510');
    d.slopes[0].maxPanelsP7 = 3;
    d = editComplexLayout(d, 's1', 'p7-510', {
      type: 'orientation',
      orientation: 'landscape'
    });
    expect(d.complexLayouts['s1|p7-510']).toEqual({
      orientation: 'landscape',
      cells: [
        { r: 0, c: 0 },
        { r: 0, c: 1 }
      ],
      customized: false
    });
    d = editComplexLayout(d, 's1', 'p7-510', {
      type: 'add',
      cell: { r: 1, c: 0 }
    });
    expect(complexUsedCount(d, d.slopes[0], P7)).toBe(3);
    // At max: a further add is refused.
    expect(
      editComplexLayout(d, 's1', 'p7-510', {
        type: 'add',
        cell: { r: 1, c: 1 }
      })
    ).toBe(d);
    d = editComplexLayout(d, 's1', 'p7-510', {
      type: 'orientation',
      orientation: 'portrait'
    });
    expect(d.complexLayouts['s1|p7-510'].cells).toHaveLength(3); // customised: cells kept
    d = editComplexLayout(d, 's1', 'p7-510', {
      type: 'remove',
      cell: { r: 0, c: 0 }
    });
    d = editComplexLayout(d, 's1', 'p7-510', {
      type: 'remove',
      cell: { r: 0, c: 1 }
    });
    expect(d.complexLayouts['s1|p7-510'].cells).toEqual([{ r: 1, c: 0 }]);
    // The last panel always stays.
    expect(
      editComplexLayout(d, 's1', 'p7-510', {
        type: 'remove',
        cell: { r: 1, c: 0 }
      })
    ).toBe(d);
  });

  it('refuses to add onto an occupied cell', () => {
    const d = selectPanel(fixtureComplexOnly(), 'p7-510');
    expect(
      editComplexLayout(d, 's1', 'p7-510', {
        type: 'add',
        cell: { r: 0, c: 0 }
      })
    ).toBe(d);
  });
});

describe('inverter lines', () => {
  it('adds blank lines with fresh ids and removes them', () => {
    let d = addInverterLine(addInverterLine(defaultDesignState()));
    expect(
      d.pricing.inverterLines.map((l) => [l.id, l.modelId, l.qty])
    ).toEqual([
      ['l1', '', 1],
      ['l2', '', 1],
      ['l3', '', 1]
    ]);
    d = addInverterLine(removeInverterLine(d, 'l3'));
    expect(d.pricing.inverterLines.map((l) => l.id)).toEqual([
      'l1',
      'l2',
      'l4'
    ]);
  });
});
