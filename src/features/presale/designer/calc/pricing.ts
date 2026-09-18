// Pricing. Pure port of the prototype's computeExtras / computePricing
// (prototype v0.12, L1061-1166). All rates come from the catalogue module.

import {
  AC_RUN_FREE_M,
  AC_RUN_PRICE_PER_M,
  BIRD_OPTIONS,
  DEPOSIT_SPLITS,
  DONGLE_OPTIONS,
  EV_OPTIONS,
  FINANCE_FEE,
  FIXED_FEE_1,
  FIXED_FEE_2,
  IBOOST_OPTIONS,
  IMMERSION_OPTIONS,
  INVERTER_BLOCK_BASE,
  INVERTER_PRICE_FACTOR,
  LABOUR_PANELS_PER_DAY,
  OFFGRID_OPTIONS,
  OPTIMISER_PRICE,
  PVULTRA_OPTIONS,
  SCAFFOLD_EXTRA_M,
  SCAFFOLD_RATE_PER_M,
  STACKED_BATTERY,
  UPLIFT,
  inverterModelById,
  mountingPriceFor,
  panelById,
  panelPriceForSlope,
  type PanelSpec
} from '../catalogue';
import { numOr0, type DesignState, type Slope } from '../types';
import { complexUsedCount } from './complex';
import { netCountForSlope, slopeGeometry } from './geometry';

export interface Pricing {
  panel: PanelSpec;
  totalNetPanels: number;
  totalKwp: number;
  slopesWithPanels: number;
  panelsMountingSubtotal: number;
  inverterSubtotal: number;
  totalCapacity: number;
  noInverterWarning: string | null;
  capacityWarning: string | null;
  capacityNote: string | null;
  extras: number;
  financeFee: number;
  fixedFee1: number;
  fixedFee2: number;
  scaffoldSubtotal: number;
  labourDays: number;
  labourSubtotal: number;
  equipmentSubtotal: number;
  installationSubtotal: number;
  adjustments: number;
  subtotal: number;
  deliveryWaste: number;
  discount: number;
  vat: number;
  total: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  amount: number;
  /** Subtotal rows are shown bold; the grand total gets the hero style. */
  emphasis?: 'subtotal' | 'grand';
  /** Shown as a deduction (−£). */
  negative?: boolean;
}

function fmt2(n: number): string {
  return n.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Net panels on one elevation for the given panel (0 when not yet usable). */
export function netPanelsForSlope(
  design: DesignState,
  slope: Slope,
  panel: PanelSpec
): number {
  if (slope.shapeMode === 'complex') {
    return complexUsedCount(design, slope, panel);
  }
  const geom = slopeGeometry(slope);
  if (!geom.complete) return 0;
  return netCountForSlope(design, slope, geom, panel).net;
}

export function computeExtras(design: DesignState): number {
  const p = design.pricing.extras;
  let sum = 0;
  sum += EV_OPTIONS[p.ev] || 0;
  sum += DONGLE_OPTIONS[p.dongle] || 0;
  sum += OFFGRID_OPTIONS[p.offgrid] || 0;
  sum += BIRD_OPTIONS[p.birdproofing] || 0;
  sum += IBOOST_OPTIONS[p.iboost] || 0;
  sum += IMMERSION_OPTIONS[p.immersion] || 0;
  sum += PVULTRA_OPTIONS[p.pvultra] || 0;
  sum +=
    p.optimisers === 'Yes' ? numOr0(p.optimiserCount) * OPTIMISER_PRICE : 0;
  const acM = numOr0(p.acRunM);
  // The whole run is charged once it is over the free length.
  sum += acM > AC_RUN_FREE_M ? acM * AC_RUN_PRICE_PER_M : 0;
  sum += numOr0(p.auxiliaries);
  return sum;
}

export function computePricing(design: DesignState): Pricing | null {
  const panel = panelById(design.selectedPanelId);
  if (!panel) return null;

  let panelsMountingRaw = 0;
  let totalNetPanels = 0;
  let totalKwp = 0;
  let slopesWithPanels = 0;
  design.slopes.forEach((slope, idx) => {
    const net = netPanelsForSlope(design, slope, panel);
    if (net <= 0) return;
    slopesWithPanels++;
    totalNetPanels += net;
    totalKwp += (net * panel.wattage) / 1000;
    panelsMountingRaw +=
      (panelPriceForSlope(panel, idx) + mountingPriceFor(slope.roofMaterial)) *
      net;
  });
  const panelsMountingSubtotal = panelsMountingRaw * UPLIFT;

  let invRawSum = 0;
  let totalCapacity = 0;
  let capacityKnownForAll = true;
  let unselected = 0;
  const lines = design.pricing.inverterLines;
  lines.forEach((line) => {
    if (!line.modelId) {
      unselected++;
      return;
    }
    const model = inverterModelById(line.modelId);
    if (!model) return;
    const qty = Math.max(0, numOr0(line.qty));
    invRawSum += model.price * qty;
    if (model.capacityKwp != null) totalCapacity += model.capacityKwp * qty;
    else capacityKnownForAll = false;
  });
  const batteryPrice = STACKED_BATTERY[design.pricing.stackedBattery] || 0;
  const inverterSubtotal =
    (invRawSum * INVERTER_PRICE_FACTOR + batteryPrice + INVERTER_BLOCK_BASE) *
    UPLIFT;

  const extras = computeExtras(design);
  const financeFee = FINANCE_FEE[design.pricing.finance] || 0;
  const scaffoldM = numOr0(design.pricing.scaffoldM);
  const scaffoldLevels = numOr0(design.pricing.scaffoldLevels);
  const scaffoldSubtotal =
    scaffoldM === 0
      ? 0
      : (scaffoldM + SCAFFOLD_EXTRA_M) *
        SCAFFOLD_RATE_PER_M *
        scaffoldLevels *
        UPLIFT;
  const labourDays = Math.ceil(totalNetPanels / LABOUR_PANELS_PER_DAY + 1);
  const labourSubtotal = UPLIFT * labourDays * (design.pricing.labourRate || 0);

  const equipmentSubtotal =
    panelsMountingSubtotal +
    inverterSubtotal +
    extras +
    financeFee +
    FIXED_FEE_1;
  const installationSubtotal = scaffoldSubtotal + labourSubtotal + FIXED_FEE_2;
  const adjustments =
    numOr0(design.pricing.adjA) +
    numOr0(design.pricing.adjB) +
    numOr0(design.pricing.adjC);
  const subtotal = equipmentSubtotal + installationSubtotal + adjustments;
  const deliveryWaste = design.pricing.deliveryWaste || 0;
  const discount = design.pricing.discount || 0;
  const vat = design.pricing.vat || 0;
  const total = subtotal - discount + deliveryWaste + vat;

  // A blank line takes priority over the capacity check: with a line unset the
  // capacity total is incomplete, so no verdict is shown.
  let capacityWarning: string | null = null;
  let capacityNote: string | null = null;
  let noInverterWarning: string | null = null;
  if (lines.length === 0) {
    noInverterWarning =
      'No inverter added — add at least one to price this system.';
  } else if (unselected > 0) {
    noInverterWarning =
      lines.length > 1
        ? `Select an inverter for every line — ${unselected} of ${lines.length} still say "Select inverter…".`
        : 'Select an inverter to price this system.';
  } else if (capacityKnownForAll) {
    if (totalKwp > totalCapacity + 1e-9) {
      capacityWarning = `Selected inverter${lines.length > 1 ? 's total' : ''} ${fmt2(totalCapacity)}kWp — this system is ${fmt2(totalKwp)}kWp, over the rated limit.`;
    }
  } else {
    capacityNote =
      'Capacity check skipped — one or more selected models (Tesla / Sigenergy / Fox Evo / three-phase) don’t have a confirmed rating yet.';
  }

  return {
    panel,
    totalNetPanels,
    totalKwp,
    slopesWithPanels,
    panelsMountingSubtotal,
    inverterSubtotal,
    totalCapacity,
    noInverterWarning,
    capacityWarning,
    capacityNote,
    extras,
    financeFee,
    fixedFee1: FIXED_FEE_1,
    fixedFee2: FIXED_FEE_2,
    scaffoldSubtotal,
    labourDays,
    labourSubtotal,
    equipmentSubtotal,
    installationSubtotal,
    adjustments,
    subtotal,
    deliveryWaste,
    discount,
    vat,
    total
  };
}

/** The Total card's rows, in display order, with stable keys. */
export function breakdownRows(c: Pricing): BreakdownRow[] {
  const days = `${c.labourDays} day${c.labourDays !== 1 ? 's' : ''}`;
  return [
    {
      key: 'panels_mounting',
      label: 'Panels + mounting',
      amount: c.panelsMountingSubtotal
    },
    {
      key: 'inverter_battery',
      label: 'Inverter + battery',
      amount: c.inverterSubtotal
    },
    { key: 'extras', label: 'Extras', amount: c.extras },
    {
      key: 'finance_admin_fee',
      label: 'Finance admin fee',
      amount: c.financeFee
    },
    {
      key: 'fixed_panels_hooks_rail',
      label: 'Panels, hooks & rail (fixed)',
      amount: c.fixedFee1
    },
    {
      key: 'equipment_subtotal',
      label: 'Equipment subtotal',
      amount: c.equipmentSubtotal,
      emphasis: 'subtotal'
    },
    { key: 'scaffold', label: 'Scaffold', amount: c.scaffoldSubtotal },
    { key: 'labour', label: `Labour (${days})`, amount: c.labourSubtotal },
    {
      key: 'fixed_admin_warranties',
      label: 'Administration & warranties (fixed)',
      amount: c.fixedFee2
    },
    {
      key: 'installation_subtotal',
      label: 'Installation subtotal',
      amount: c.installationSubtotal,
      emphasis: 'subtotal'
    },
    { key: 'adjustments', label: 'Adjustments', amount: c.adjustments },
    {
      key: 'subtotal',
      label: 'Subtotal',
      amount: c.subtotal,
      emphasis: 'subtotal'
    },
    { key: 'discount', label: 'Discount', amount: c.discount, negative: true },
    {
      key: 'delivery_waste',
      label: 'Delivery and waste',
      amount: c.deliveryWaste
    },
    { key: 'vat', label: 'VAT', amount: c.vat },
    {
      key: 'total',
      label: 'Total system price',
      amount: c.total,
      emphasis: 'grand'
    }
  ];
}

export function depositRows(
  total: number
): { label: string; amount: number }[] {
  return DEPOSIT_SPLITS.map((d) => ({
    label: `${d.label} (${Math.round(d.pct * 100)}%)`,
    amount: total * d.pct
  }));
}
