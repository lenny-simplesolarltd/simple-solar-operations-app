// Presale designer catalogue — every product, price, fee and assumption the
// designer uses lives here and nowhere else. Ported verbatim from the
// System Designer prototype v0.12 (2026-09-16); bump CATALOGUE_VERSION on any
// change so submitted presales record which price list produced their numbers.

export const CATALOGUE_VERSION = 'artifact-v0.12-2026-09-16';
export const DESIGN_SCHEMA_VERSION = 1;

/** Margin multiplier on panels+mounting, inverter+battery, scaffold, labour. */
export const UPLIFT = 1.18;

export type PanelId = 'mclass-475' | 'p7-510';

export interface PanelSpec {
  id: PanelId;
  name: string;
  variant: string;
  widthM: number;
  heightM: number;
  wattage: number;
  tag?: string;
  warrantyYears: number;
}

export const PANELS: readonly PanelSpec[] = [
  {
    id: 'mclass-475',
    name: 'SunPower M Class',
    variant: '475 W',
    widthM: 1.134,
    heightM: 1.762,
    wattage: 475,
    tag: 'Advanced Performance',
    warrantyYears: 40
  },
  {
    id: 'p7-510',
    name: 'SunPower P7',
    variant: '510 W',
    widthM: 1.134,
    heightM: 1.996,
    wattage: 510,
    warrantyYears: 30
  }
];

/** £/panel by roof face (1-5). Face index = min(elevation index, 4). */
export const PANEL_PRICE_BY_FACE: Record<PanelId, readonly number[]> = {
  'p7-510': [110.5, 110.5, 120.5, 110.5, 110.5],
  'mclass-475': [160.5, 160.5, 175.5, 160.5, 160.5]
};

export interface RoofMaterial {
  name: string;
  /** Mounting £/panel. */
  price: number;
}

export const ROOF_MATERIALS: readonly RoofMaterial[] = [
  { name: 'Natural slate (rough)', price: 67.7 },
  { name: 'Man-made slate (smooth)', price: 52.32 },
  { name: 'Asbestos slate (normally pink)', price: 120 },
  { name: 'Concrete tile', price: 57.7 },
  { name: 'Small concrete tile (biscuit - small)', price: 67.7 },
  { name: 'Cement fibre corrugated (usually on barns)', price: 47.7 },
  { name: 'Asbestos corrugated', price: 120 },
  { name: 'Metal corrugated (rounded)', price: 47.7 },
  { name: 'Metal trapezoid roof (flat corrugated)', price: 47.7 },
  { name: 'Ground mount', price: 140 },
  { name: 'Rubber roof (normally flat)', price: 130 },
  { name: 'Fibre glass roof (normally flat)', price: 130 },
  { name: 'Felt roof (normally flat)', price: 130 },
  { name: 'GSE in-roof trays', price: 205 }
];

export const DEFAULT_ROOF_MATERIAL = 'Concrete tile';

export interface InverterModel {
  id: string;
  category: string;
  name: string;
  price: number;
  /** Only set where the sizing guide covers the model (FoxESS single-phase). */
  capacityKwp?: number;
}

const NB1 = 'No battery - single phase';
const NB3 = 'No battery - three phase';
const B1 = 'Battery - single phase';
const B3 = 'Battery - three phase';
const SIG = 'Sigenergy (all-in-one)';
const TESLA = 'Tesla';
const EVO = 'FoxESS Evo (all-in-one)';
const SPESS = 'Sunpower ESS';

export const INVERTER_MODELS: readonly InverterModel[] = [
  { id: 'fox-s2000', category: NB1, name: 'FoxESS S2000', price: 250 },
  { id: 'fox-s2500', category: NB1, name: 'FoxESS S2500', price: 310 },
  {
    id: 'fox-f3000',
    category: NB1,
    name: 'FoxESS F3000',
    price: 310,
    capacityKwp: 3
  },
  {
    id: 'fox-f3600',
    category: NB1,
    name: 'FoxESS F3600',
    price: 366,
    capacityKwp: 4
  },
  {
    id: 'fox-f5000',
    category: NB1,
    name: 'FoxESS F5000',
    price: 407,
    capacityKwp: 6
  },
  {
    id: 'fox-f6000',
    category: NB1,
    name: 'FoxESS F6000',
    price: 457,
    capacityKwp: 7
  },
  { id: 'fox-t6', category: NB3, name: 'FoxESS T-6', price: 670 },
  { id: 'fox-t8', category: NB3, name: 'FoxESS T-8', price: 715 },
  { id: 'fox-t10', category: NB3, name: 'FoxESS T-10', price: 785 },
  { id: 'fox-t12', category: NB3, name: 'FoxESS T-12', price: 840 },
  { id: 'fox-t15', category: NB3, name: 'FoxESS T-15', price: 900 },
  { id: 'fox-t20', category: NB3, name: 'FoxESS T-20', price: 1000 },
  { id: 'fox-t25', category: NB3, name: 'FoxESS T-25', price: 1075 },
  {
    id: 'fox-h1-3.0',
    category: B1,
    name: 'FoxESS H1-3.0-G2',
    price: 700,
    capacityKwp: 3
  },
  {
    id: 'fox-h1-3.7',
    category: B1,
    name: 'FoxESS H1-3.7-G2',
    price: 700,
    capacityKwp: 4
  },
  {
    id: 'fox-h1-5.0',
    category: B1,
    name: 'FoxESS H1-5.0-G2',
    price: 730,
    capacityKwp: 6
  },
  {
    id: 'fox-h1-6.0',
    category: B1,
    name: 'FoxESS H1-6.0-G2',
    price: 750,
    capacityKwp: 7
  },
  {
    id: 'fox-kh7',
    category: B1,
    name: 'FoxESS KH7',
    price: 980,
    capacityKwp: 8
  },
  {
    id: 'fox-kh8',
    category: B1,
    name: 'FoxESS KH8',
    price: 1025,
    capacityKwp: 9
  },
  {
    id: 'fox-kh9',
    category: B1,
    name: 'FoxESS KH9',
    price: 1045,
    capacityKwp: 10
  },
  {
    id: 'fox-kh10',
    category: B1,
    name: 'FoxESS KH10',
    price: 1100,
    capacityKwp: 14.99
  },
  { id: 'fox-h3-8', category: B3, name: 'FoxESS H3-8.0', price: 1770 },
  { id: 'fox-h3-10', category: B3, name: 'FoxESS H3-10.0', price: 1840 },
  { id: 'fox-h3-12', category: B3, name: 'FoxESS H3-12.0', price: 1900 },
  { id: 'fox-h3-p20', category: B3, name: 'FoxESS H3-PRO-20.0', price: 2400 },
  { id: 'fox-h3-p25', category: B3, name: 'FoxESS H3-PRO-25.0', price: 2800 },
  {
    id: 'sigen-3.6',
    category: SIG,
    name: 'Sigenergy Sigenstor 3.6kW',
    price: 850
  },
  {
    id: 'sigen-6.0',
    category: SIG,
    name: 'Sigenergy Sigenstor 6.0kW',
    price: 1021
  },
  {
    id: 'sigen-8.0',
    category: SIG,
    name: 'Sigenergy Sigenstor 8.0kW',
    price: 1451
  },
  {
    id: 'sigen-10.0',
    category: SIG,
    name: 'Sigenergy Sigenstor 10.0kW',
    price: 1571
  },
  {
    id: 'sigen-12.0',
    category: SIG,
    name: 'Sigenergy Sigenstor 12.0kW',
    price: 1621.5
  },
  { id: 'tesla-pw3', category: TESLA, name: 'Tesla Powerwall 3', price: 5200 },
  {
    id: 'tesla-pw3-exp',
    category: TESLA,
    name: 'Tesla Powerwall 3 with expansion pack',
    price: 9200
  },
  {
    id: 'foxevo-5',
    category: EVO,
    name: 'FoxESS Evo Series 5kW w/ 10.24kWh Battery',
    price: 3100
  },
  {
    id: 'foxevo-8',
    category: EVO,
    name: 'FoxESS Evo Series 8kW w/ 10.24kWh Battery',
    price: 3180
  },
  {
    id: 'foxevo-10',
    category: EVO,
    name: 'FoxESS Evo Series 10kW w/ 10.24kWh Battery',
    price: 3200
  },
  { id: 'sunpower-5', category: SPESS, name: 'Sunpower ESS 5kW', price: 1294 },
  { id: 'sunpower-6', category: SPESS, name: 'Sunpower ESS 6kW', price: 1311 },
  { id: 'sunpower-10', category: SPESS, name: 'Sunpower ESS 10kW', price: 1513 }
];

/** Dropdown group order — "Battery - single phase" leads (most used). */
export const INVERTER_CATEGORY_ORDER: readonly string[] = [
  B1,
  SIG,
  TESLA,
  EVO,
  SPESS,
  NB1,
  NB3,
  B3
];

/** Multiplier on the summed inverter list prices. */
export const INVERTER_PRICE_FACTOR = 1.05;
/** Flat amount added to the inverter + battery block (even with no inverter). */
export const INVERTER_BLOCK_BASE = 1300;

export type PriceOptions = Readonly<Record<string, number>>;

export const STACKED_BATTERY: PriceOptions = {
  None: 0,
  'FoxESS EP6': 1120,
  'FoxESS EP6 x 2': 2400,
  'FoxESS EP6 x 3': 3520,
  'FoxESS EP6 x 4': 4640,
  'FoxESS EP12': 1880,
  'FoxESS EP12 x 2': 3900,
  'FoxESS EP12 x 3': 5780,
  'FoxESS EP12 x 4': 7660,
  'Sigenergy Sigenstor 10 kWh': 2180,
  'Sigenergy Sigenstor 10 kWh x 2': 4360,
  'Sigenergy Sigenstor 10 kWh x 3': 6540,
  'Sigenergy Sigenstor 10 kWh x 4': 8720,
  'Sigenergy Sigenstor 10 kWh x 5': 10900,
  'Tesla Powerwall 3 (13.5kWh)': 0,
  'Tesla Powerwall 3 & expansion pack (27kWh)': 0,
  'Tesla Powerwall 3 & 2 expansion packs (40.5kWh)': 4000,
  'Tesla Powerwall 3 & 3 expansion packs (54kWh)': 8000,
  'Sunpower ESS 5kW': 838,
  'Sunpower ESS 5kW x 2': 1676,
  'Sunpower ESS 5kW x 3': 2514,
  'Sunpower ESS 5kW x 4': 3352
};

export const EV_OPTIONS: PriceOptions = {
  No: 0,
  'Fox (single phase)': 899.99,
  'Ohme (single phase)': 899.99,
  'Zappi (three phase)': 1499.99,
  Hypervolt: 1099.99,
  'Tesla Gen 3': 899.99
};
/** "No" still carries a charge in the live pricing form — kept as-is. */
export const DONGLE_OPTIONS: PriceOptions = { No: 80, Yes: 85 };
export const OFFGRID_OPTIONS: PriceOptions = {
  No: 0,
  'FoxESS Gateway - Whole Home': 1280,
  'Tesla Gateway2 - Whole Home': 1750,
  'SigEnergy - Homepro': 1435
};
export const BIRD_OPTIONS: PriceOptions = { No: 0, 'Bird Mesh': 350 };
export const IBOOST_OPTIONS: PriceOptions = {
  No: 0,
  iBoost: 499.99,
  'eddi & harvi': 799.99
};
export const IMMERSION_OPTIONS: PriceOptions = { No: 0, Yes: 85 };
export const PVULTRA_OPTIONS: PriceOptions = {
  No: 0,
  '25m': 250.19,
  '50m': 500.38,
  '75m': 750.56,
  '100m': 960.75
};
export const OPTIMISER_PRICE = 55;

/** AC run: the whole run is charged at this £/m once it exceeds the free length. */
export const AC_RUN_FREE_M = 5;
export const AC_RUN_PRICE_PER_M = 8.5;

export type FinanceChoice = 'No' | 'Yes' | 'Maybe';
export const FINANCE_CHOICES: readonly FinanceChoice[] = ['No', 'Yes', 'Maybe'];
export const FINANCE_FEE: Readonly<Record<FinanceChoice, number>> = {
  No: 0,
  Yes: 250,
  Maybe: 125
};

/** "Panels, hooks & rail (fixed)". */
export const FIXED_FEE_1 = 350;
/** "Administration & warranties (fixed)". */
export const FIXED_FEE_2 = 480;

export const DEPOSIT_SPLITS: readonly { label: string; pct: number }[] = [
  { label: 'Due today', pct: 0.25 },
  { label: 'One week before install', pct: 0.35 },
  { label: 'Balance on completion', pct: 0.4 }
];

// Scaffold: ((metres + SCAFFOLD_EXTRA_M) * SCAFFOLD_RATE_PER_M) * levels * UPLIFT
export const SCAFFOLD_EXTRA_M = 2;
export const SCAFFOLD_RATE_PER_M = 24;
export const DEFAULT_SCAFFOLD_M = 8;
export const DEFAULT_SCAFFOLD_LEVELS = 2;

// Labour: ceil(net panels / LABOUR_PANELS_PER_DAY + 1) days at the day rate.
export const LABOUR_PANELS_PER_DAY = 12;
export const DEFAULT_LABOUR_RATE = 585;
export const DEFAULT_DELIVERY_WASTE = 600;
export const DEFAULT_DISCOUNT = 0;
export const DEFAULT_VAT = 0;

// Roof fit defaults (mm).
export const DEFAULT_ROOF_PARAMS = {
  gapMm: 10,
  ridgeMm: 300,
  eaveMm: 200,
  vergeMm: 100
} as const;
export const RIDGE_MIN_WARN_MM = 200;
/** A drawn obstruction is kept only when both sides exceed this (mm). */
export const OBSTRUCTION_MIN_MM = 40;
/** Largest clearance trim (mm) the Panels step will suggest. */
export const HEADROOM_HINT_MAX_MM = 150;

// Performance estimate assumptions.
export const DEFAULT_PERFORMANCE = {
  tariffPence: 27.49,
  segRatePence: 12,
  selfConsumptionPct: 70
} as const;
export const ELECTRICITY_INFLATION_PCT = 5;
export const PANEL_DEGRADATION_PCT: Readonly<Record<PanelId, number>> = {
  'p7-510': 0.4,
  'mclass-475': 0.25
};
export const FALLBACK_DEGRADATION_PCT = 0.5;
export const PERFORMANCE_RATIO = 0.85;
export const PROJECTION_YEARS = 30;

export const ORDINAL_WORDS: readonly string[] = [
  'Primary',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth'
];

export function panelById(id: string | null | undefined): PanelSpec | null {
  return PANELS.find((p) => p.id === id) ?? null;
}

export function inverterModelById(id: string): InverterModel | null {
  return INVERTER_MODELS.find((m) => m.id === id) ?? null;
}

export function mountingPriceFor(material: string): number {
  return ROOF_MATERIALS.find((m) => m.name === material)?.price ?? 0;
}

export function panelPriceForSlope(
  panel: PanelSpec,
  slopeIndex: number
): number {
  const prices = PANEL_PRICE_BY_FACE[panel.id];
  return prices ? prices[Math.min(slopeIndex, 4)] : 0;
}

export function ordinalElevationLabel(n: number): string {
  return `${ORDINAL_WORDS[n - 1] ?? `${n}th`} Elevation`;
}

/** Inverter models grouped for the dropdown, in display order. */
export function inverterGroups(): {
  category: string;
  models: InverterModel[];
}[] {
  const byCat = new Map<string, InverterModel[]>();
  INVERTER_MODELS.forEach((m) => {
    const list = byCat.get(m.category);
    if (list) list.push(m);
    else byCat.set(m.category, [m]);
  });
  const order = INVERTER_CATEGORY_ORDER.filter((c) => byCat.has(c));
  Array.from(byCat.keys()).forEach((c) => {
    if (order.indexOf(c) === -1) order.push(c);
  });
  return order.map((category) => ({
    category,
    models: byCat.get(category) ?? []
  }));
}
