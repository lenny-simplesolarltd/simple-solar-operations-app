import {
  DEFAULT_DELIVERY_WASTE,
  DEFAULT_DISCOUNT,
  DEFAULT_LABOUR_RATE,
  DEFAULT_PERFORMANCE,
  DEFAULT_ROOF_MATERIAL,
  DEFAULT_ROOF_PARAMS,
  DEFAULT_SCAFFOLD_LEVELS,
  DEFAULT_SCAFFOLD_M,
  DEFAULT_VAT,
  ordinalElevationLabel,
  type FinanceChoice,
  type PanelId
} from './catalogue';

/** A numeric input's value: a finite number, or '' while the box is blank. */
export type NumInput = number | '';

export type ShapeMode = 'rect' | 'complex' | 'calc';
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type FixedOrientation = 'portrait' | 'landscape';

export interface Slope {
  id: string;
  label: string;
  orientation: Orientation;
  roofMaterial: string;
  /** -1 hugs the left verge, 0 centred, +1 hugs the right verge. */
  shiftBias: number;
  /** -1 hugs the ridge, 0 centred, +1 hugs the eave. */
  shiftBiasV: number;
  shapeMode: ShapeMode;
  confirmed: boolean;
  /** Eave width (m). */
  xM: NumInput;
  /** Sloped rafter length, eave to ridge (m). */
  yM: NumInput;
  pitchDeg: NumInput;
  shadingPct: NumInput;
  bearingDeg: NumInput;
  radiance: NumInput;
  maxPanelsP7: NumInput;
  maxPanelsMClass: NumInput;
  calcAdjacentM: NumInput;
}

export type SlopeNumericField =
  | 'xM'
  | 'yM'
  | 'pitchDeg'
  | 'shadingPct'
  | 'bearingDeg'
  | 'radiance'
  | 'maxPanelsP7'
  | 'maxPanelsMClass'
  | 'calcAdjacentM';

export interface RoofParams {
  gapMm: NumInput;
  ridgeMm: NumInput;
  eaveMm: NumInput;
  vergeMm: NumInput;
}

export interface PerformanceInputs {
  tariffPence: NumInput;
  segRatePence: NumInput;
  selfConsumptionPct: NumInput;
  annualConsumptionKwh: NumInput;
}

/** mm, origin top-left of the roof face (ridge / left verge). */
export interface Obstruction {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cell {
  r: number;
  c: number;
}

export interface ComplexLayout {
  orientation: FixedOrientation;
  cells: Cell[];
  customized: boolean;
}

export interface InverterLine {
  id: string;
  modelId: string;
  qty: NumInput;
}

export interface ExtrasState {
  ev: string;
  dongle: string;
  offgrid: string;
  birdproofing: string;
  iboost: string;
  immersion: string;
  pvultra: string;
  optimisers: 'No' | 'Yes';
  optimiserCount: NumInput;
  acRunM: NumInput;
  auxiliaries: NumInput;
}

export type ExtrasSelectKey =
  | 'ev'
  | 'dongle'
  | 'offgrid'
  | 'birdproofing'
  | 'iboost'
  | 'immersion'
  | 'pvultra';

export interface PricingState {
  inverterLines: InverterLine[];
  lineSeq: number;
  stackedBattery: string;
  extras: ExtrasState;
  finance: FinanceChoice;
  scaffoldM: NumInput;
  scaffoldLevels: NumInput;
  labourRate: number;
  adjA: NumInput;
  adjB: NumInput;
  adjC: NumInput;
  deliveryWaste: number;
  discount: number;
  vat: number;
}

/** The whole designer state. JSON-serialisable; submitted as `design`. */
export interface DesignState {
  slopes: Slope[];
  params: RoofParams;
  performance: PerformanceInputs;
  selectedPanelId: PanelId | null;
  /** Manual tap-outs, keyed `${slopeId}|${panelId}` -> panel indices. */
  exclusions: Record<string, number[]>;
  /** Keyed by slope id. */
  obstructions: Record<string, Obstruction[]>;
  /** Keyed `${slopeId}|${panelId}`. */
  complexLayouts: Record<string, ComplexLayout>;
  slopeSeq: number;
  pricing: PricingState;
}

export function slopePanelKey(slopeId: string, panelId: string): string {
  return `${slopeId}|${panelId}`;
}

export function newSlope(id: string, ordinal: number, from?: Slope): Slope {
  return {
    id,
    label: ordinalElevationLabel(ordinal),
    orientation: from ? from.orientation : 'auto',
    roofMaterial: from ? from.roofMaterial : DEFAULT_ROOF_MATERIAL,
    shiftBias: 0,
    shiftBiasV: 0,
    shapeMode: 'rect',
    confirmed: false,
    xM: '',
    yM: '',
    pitchDeg: from ? from.pitchDeg : '',
    shadingPct: '',
    bearingDeg: '',
    radiance: '',
    maxPanelsP7: '',
    maxPanelsMClass: '',
    calcAdjacentM: ''
  };
}

export function defaultPricing(): PricingState {
  return {
    inverterLines: [{ id: 'l1', modelId: '', qty: 1 }],
    lineSeq: 2,
    stackedBattery: 'None',
    extras: {
      ev: 'No',
      dongle: 'Yes',
      offgrid: 'No',
      birdproofing: 'No',
      iboost: 'No',
      immersion: 'No',
      pvultra: 'No',
      optimisers: 'No',
      optimiserCount: 0,
      acRunM: '',
      auxiliaries: 0
    },
    finance: 'No',
    scaffoldM: DEFAULT_SCAFFOLD_M,
    scaffoldLevels: DEFAULT_SCAFFOLD_LEVELS,
    labourRate: DEFAULT_LABOUR_RATE,
    adjA: 0,
    adjB: 0,
    adjC: 0,
    deliveryWaste: DEFAULT_DELIVERY_WASTE,
    discount: DEFAULT_DISCOUNT,
    vat: DEFAULT_VAT
  };
}

export function defaultDesignState(): DesignState {
  return {
    slopes: [newSlope('s1', 1)],
    params: { ...DEFAULT_ROOF_PARAMS },
    performance: { ...DEFAULT_PERFORMANCE, annualConsumptionKwh: '' },
    selectedPanelId: null,
    exclusions: {},
    obstructions: {},
    complexLayouts: {},
    slopeSeq: 2,
    pricing: defaultPricing()
  };
}

/** parseFloat semantics over a NumInput: NaN when blank. */
export function toNum(v: NumInput | null | undefined): number {
  if (v === '' || v === null || v === undefined) return NaN;
  return typeof v === 'number' ? v : parseFloat(String(v));
}

/** `parseFloat(v) || 0`. */
export function numOr0(v: NumInput | null | undefined): number {
  const n = toNum(v);
  return isFinite(n) ? n : 0;
}

export function isBlank(v: NumInput | null | undefined): boolean {
  return !isFinite(toNum(v));
}
