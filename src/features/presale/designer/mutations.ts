// Pure state transitions for the designer. Each returns a new DesignState.

import { panelById, type PanelId } from './catalogue';
import { calcHypotenuse } from './calc/geometry';
import {
  complexAddCell,
  complexRemoveCell,
  complexSetOrientation,
  ensureComplexLayouts,
  maxCountFor,
  resolveComplexLayout
} from './calc/complex';
import {
  newSlope,
  slopePanelKey,
  type Cell,
  type DesignState,
  type ExtrasState,
  type FixedOrientation,
  type InverterLine,
  type NumInput,
  type Obstruction,
  type PricingState,
  type ShapeMode,
  type Slope,
  type SlopeNumericField
} from './types';

function mapSlope(
  design: DesignState,
  slopeId: string,
  fn: (slope: Slope) => Slope
): DesignState {
  return {
    ...design,
    slopes: design.slopes.map((s) => (s.id === slopeId ? fn(s) : s))
  };
}

export function addSlope(design: DesignState): DesignState {
  const last = design.slopes[design.slopes.length - 1];
  const slope = newSlope(`s${design.slopeSeq}`, design.slopes.length + 1, last);
  return {
    ...design,
    slopes: [...design.slopes, slope],
    slopeSeq: design.slopeSeq + 1
  };
}

function withoutKeysFor<T>(
  record: Record<string, T>,
  slopeId: string
): Record<string, T> {
  const out: Record<string, T> = {};
  Object.keys(record).forEach((key) => {
    if (key === slopeId || key.indexOf(`${slopeId}|`) === 0) return;
    out[key] = record[key];
  });
  return out;
}

/** Removes an elevation and everything keyed to it (the prototype left orphans). */
export function removeSlope(design: DesignState, slopeId: string): DesignState {
  return {
    ...design,
    slopes: design.slopes.filter((s) => s.id !== slopeId),
    exclusions: withoutKeysFor(design.exclusions, slopeId),
    obstructions: withoutKeysFor(design.obstructions, slopeId),
    complexLayouts: withoutKeysFor(design.complexLayouts, slopeId)
  };
}

export function renameSlope(
  design: DesignState,
  slopeId: string,
  label: string
): DesignState {
  return mapSlope(design, slopeId, (s) => ({ ...s, label }));
}

/**
 * Any change to an elevation's measurements — typed or via the − / + buttons —
 * withdraws its "Values confirmed" tick, so it must be confirmed again.
 */
export function setSlopeValue(
  design: DesignState,
  slopeId: string,
  field: SlopeNumericField,
  value: NumInput
): DesignState {
  return mapSlope(design, slopeId, (s) => ({
    ...s,
    [field]: value,
    confirmed: false
  }));
}

/** Switching tab always clears the confirmation. */
export function setShapeMode(
  design: DesignState,
  slopeId: string,
  mode: ShapeMode
): DesignState {
  return mapSlope(design, slopeId, (s) =>
    s.shapeMode === mode ? s : { ...s, shapeMode: mode, confirmed: false }
  );
}

export function confirmSlope(
  design: DesignState,
  slopeId: string
): DesignState {
  return mapSlope(design, slopeId, (s) => ({ ...s, confirmed: true }));
}

/** Slope Calculator -> Rectangle's Y (2dp), back on the Rectangle tab, unconfirmed. */
export function applyCalculatedSlope(
  design: DesignState,
  slopeId: string
): DesignState {
  return mapSlope(design, slopeId, (s) => {
    const hyp = calcHypotenuse(s);
    if (hyp === null) return s;
    return {
      ...s,
      yM: Math.round(hyp * 100) / 100,
      shapeMode: 'rect',
      confirmed: false
    };
  });
}

export function patchSlope(
  design: DesignState,
  slopeId: string,
  patch: Partial<
    Pick<Slope, 'orientation' | 'roofMaterial' | 'shiftBias' | 'shiftBiasV'>
  >
): DesignState {
  return mapSlope(design, slopeId, (s) => ({ ...s, ...patch }));
}

export function addObstruction(
  design: DesignState,
  slopeId: string,
  obstruction: Obstruction
): DesignState {
  return {
    ...design,
    obstructions: {
      ...design.obstructions,
      [slopeId]: [...(design.obstructions[slopeId] ?? []), obstruction]
    }
  };
}

export function removeObstruction(
  design: DesignState,
  slopeId: string,
  obstructionId: string
): DesignState {
  return {
    ...design,
    obstructions: {
      ...design.obstructions,
      [slopeId]: (design.obstructions[slopeId] ?? []).filter(
        (o) => o.id !== obstructionId
      )
    }
  };
}

/** Selecting a panel also materialises its Complex layouts (as opening Layout did). */
export function selectPanel(
  design: DesignState,
  panelId: PanelId
): DesignState {
  const panel = panelById(panelId);
  const next = { ...design, selectedPanelId: panelId };
  return panel ? ensureComplexLayouts(next, panel) : next;
}

export function toggleExclusion(
  design: DesignState,
  slopeId: string,
  panelId: string,
  index: number
): DesignState {
  const key = slopePanelKey(slopeId, panelId);
  const current = design.exclusions[key] ?? [];
  const next =
    current.indexOf(index) >= 0
      ? current.filter((i) => i !== index)
      : [...current, index];
  return { ...design, exclusions: { ...design.exclusions, [key]: next } };
}

type ComplexEdit =
  | { type: 'add'; cell: Cell }
  | { type: 'remove'; cell: Cell }
  | { type: 'orientation'; orientation: FixedOrientation };

export function editComplexLayout(
  design: DesignState,
  slopeId: string,
  panelId: string,
  edit: ComplexEdit
): DesignState {
  const slope = design.slopes.find((s) => s.id === slopeId);
  const panel = panelById(panelId);
  if (!slope || !panel) return design;
  const layout = resolveComplexLayout(design, slope, panel);
  const next =
    edit.type === 'add'
      ? complexAddCell(layout, maxCountFor(slope, panel), edit.cell)
      : edit.type === 'remove'
        ? complexRemoveCell(layout, edit.cell)
        : complexSetOrientation(layout, edit.orientation);
  if (!next) return design;
  return {
    ...design,
    complexLayouts: {
      ...design.complexLayouts,
      [slopePanelKey(slopeId, panelId)]: next
    }
  };
}

export function patchPricing(
  design: DesignState,
  patch: Partial<PricingState>
): DesignState {
  return { ...design, pricing: { ...design.pricing, ...patch } };
}

export function patchExtras(
  design: DesignState,
  patch: Partial<ExtrasState>
): DesignState {
  return patchPricing(design, {
    extras: { ...design.pricing.extras, ...patch }
  });
}

export function addInverterLine(design: DesignState): DesignState {
  const line: InverterLine = {
    id: `l${design.pricing.lineSeq}`,
    modelId: '',
    qty: 1
  };
  return patchPricing(design, {
    inverterLines: [...design.pricing.inverterLines, line],
    lineSeq: design.pricing.lineSeq + 1
  });
}

export function patchInverterLine(
  design: DesignState,
  lineId: string,
  patch: Partial<Pick<InverterLine, 'modelId' | 'qty'>>
): DesignState {
  return patchPricing(design, {
    inverterLines: design.pricing.inverterLines.map((l) =>
      l.id === lineId ? { ...l, ...patch } : l
    )
  });
}

export function removeInverterLine(
  design: DesignState,
  lineId: string
): DesignState {
  return patchPricing(design, {
    inverterLines: design.pricing.inverterLines.filter((l) => l.id !== lineId)
  });
}
