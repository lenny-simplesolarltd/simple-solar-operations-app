import {
  defaultDesignState,
  newSlope,
  type DesignState,
  type Slope
} from '../../types';

function slope(id: string, ordinal: number, patch: Partial<Slope>): Slope {
  return { ...newSlope(id, ordinal), ...patch };
}

/** A: one plain rectangle, all defaults, a single rated inverter. */
export function fixtureSimple(): DesignState {
  const d = defaultDesignState();
  d.slopes = [
    slope('s1', 1, {
      xM: 8.2,
      yM: 5.4,
      pitchDeg: 35,
      shadingPct: 5,
      bearingDeg: -10,
      radiance: 950,
      confirmed: true
    })
  ];
  d.selectedPanelId = 'mclass-475';
  d.pricing.inverterLines = [{ id: 'l1', modelId: 'fox-kh7', qty: 1 }];
  d.pricing.extras.acRunM = 12;
  d.performance.annualConsumptionKwh = 4000;
  return d;
}

/** B: three faces (rect + obstruction, complex with a layout, forced landscape), everything switched on. */
export function fixtureKitchenSink(): DesignState {
  const d = defaultDesignState();
  d.params = { gapMm: 20, ridgeMm: 250, eaveMm: 150, vergeMm: 120 };
  d.slopes = [
    slope('s1', 1, {
      xM: 9.35,
      yM: 6.1,
      pitchDeg: 30,
      shadingPct: 3,
      bearingDeg: 15,
      radiance: 1010,
      roofMaterial: 'Natural slate (rough)',
      shiftBias: -0.4,
      shiftBiasV: 0.62,
      confirmed: true
    }),
    slope('s2', 2, {
      shapeMode: 'complex',
      maxPanelsP7: 6,
      maxPanelsMClass: 7,
      pitchDeg: 40,
      shadingPct: 12,
      bearingDeg: 95,
      radiance: 870,
      roofMaterial: 'GSE in-roof trays',
      confirmed: true
    }),
    slope('s3', 3, {
      xM: 5.05,
      yM: 4.3,
      pitchDeg: 22,
      shadingPct: 0,
      bearingDeg: -80,
      radiance: 905,
      orientation: 'landscape',
      roofMaterial: 'Man-made slate (smooth)',
      confirmed: true
    })
  ];
  d.slopeSeq = 4;
  d.obstructions = {
    s1: [
      { id: 'o1', x: 2400, y: 900, w: 650, h: 800 },
      { id: 'o2', x: 7100, y: 4200, w: 300, h: 300 }
    ]
  };
  d.exclusions = {
    's1|p7-510': [0, 3, 999],
    's3|p7-510': [1],
    's1|mclass-475': [2]
  };
  d.complexLayouts = {
    's2|p7-510': {
      orientation: 'landscape',
      cells: [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
        { r: 1, c: 0 },
        { r: 1, c: 1 }
      ],
      customized: true
    }
  };
  d.selectedPanelId = 'p7-510';
  d.pricing.inverterLines = [
    { id: 'l1', modelId: 'tesla-pw3', qty: 1 },
    { id: 'l2', modelId: 'fox-h1-5.0', qty: 2 }
  ];
  d.pricing.lineSeq = 3;
  d.pricing.stackedBattery = 'FoxESS EP12 x 2';
  d.pricing.extras = {
    ev: 'Zappi (three phase)',
    dongle: 'No',
    offgrid: 'Tesla Gateway2 - Whole Home',
    birdproofing: 'Bird Mesh',
    iboost: 'eddi & harvi',
    immersion: 'Yes',
    pvultra: '75m',
    optimisers: 'Yes',
    optimiserCount: 9,
    acRunM: 17.5,
    auxiliaries: 245
  };
  d.pricing.finance = 'Yes';
  d.pricing.scaffoldM = 14;
  d.pricing.scaffoldLevels = 3;
  d.pricing.adjA = -350;
  d.pricing.adjB = 120;
  d.pricing.adjC = 49;
  d.performance = {
    tariffPence: 31.2,
    segRatePence: 15,
    selfConsumptionPct: 55,
    annualConsumptionKwh: 5200
  };
  return d;
}

/** C: complex-only job whose layout was never opened, no inverter lines, no scaffold, radiance missing. */
export function fixtureComplexOnly(): DesignState {
  const d = defaultDesignState();
  d.slopes = [
    slope('s1', 1, {
      shapeMode: 'complex',
      maxPanelsP7: 11,
      maxPanelsMClass: '',
      pitchDeg: 35,
      shadingPct: 0,
      bearingDeg: 0,
      radiance: '',
      confirmed: true
    })
  ];
  d.selectedPanelId = 'p7-510';
  d.pricing.inverterLines = [];
  d.pricing.scaffoldM = 0;
  d.pricing.extras.acRunM = 5;
  d.pricing.finance = 'Maybe';
  return d;
}

/** D: a big roof on the smallest rated inverter -> over-capacity; generation beats stated consumption. */
export function fixtureOverCapacity(): DesignState {
  const d = defaultDesignState();
  d.slopes = [
    slope('s1', 1, {
      xM: 12,
      yM: 7.5,
      pitchDeg: 30,
      shadingPct: 0,
      bearingDeg: 0,
      radiance: 1000,
      confirmed: true
    }),
    slope('s2', 2, {
      xM: 6,
      yM: 4,
      pitchDeg: 30,
      shadingPct: 8,
      bearingDeg: 180,
      radiance: 700,
      confirmed: true
    })
  ];
  d.slopeSeq = 3;
  d.selectedPanelId = 'mclass-475';
  d.pricing.inverterLines = [{ id: 'l1', modelId: 'fox-h1-3.0', qty: 2 }];
  d.pricing.extras.acRunM = 3;
  d.performance.annualConsumptionKwh = 2500;
  return d;
}

/** E: two inverter lines, one still blank; blank roof params; nothing fits on the second face. */
export function fixtureUnfinished(): DesignState {
  const d = defaultDesignState();
  d.params = { gapMm: '', ridgeMm: 300, eaveMm: '', vergeMm: 100 };
  d.slopes = [
    slope('s1', 1, {
      xM: 4.6,
      yM: 3.75,
      pitchDeg: 45,
      shadingPct: '',
      bearingDeg: 0,
      radiance: 880,
      orientation: 'portrait',
      confirmed: true
    }),
    slope('s2', 2, {
      xM: 1.2,
      yM: 1.5,
      pitchDeg: 45,
      shadingPct: 0,
      bearingDeg: 0,
      radiance: 880,
      confirmed: true
    }),
    slope('s3', 3, { shapeMode: 'calc', pitchDeg: 37, calcAdjacentM: 4.15 })
  ];
  d.slopeSeq = 4;
  d.selectedPanelId = 'p7-510';
  d.pricing.inverterLines = [
    { id: 'l1', modelId: 'fox-f5000', qty: 1 },
    { id: 'l2', modelId: '', qty: 1 }
  ];
  d.pricing.extras.acRunM = 5.5;
  return d;
}

export const FIXTURES: { name: string; build: () => DesignState }[] = [
  { name: 'A simple rectangle', build: fixtureSimple },
  { name: 'B kitchen sink', build: fixtureKitchenSink },
  { name: 'C complex only', build: fixtureComplexOnly },
  { name: 'D over capacity', build: fixtureOverCapacity },
  { name: 'E unfinished', build: fixtureUnfinished }
];
