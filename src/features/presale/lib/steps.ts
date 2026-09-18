// The nine wizard steps and the rules that gate moving forward through them.

import { isBlank, type DesignState, type Slope } from '../designer/types';
import {
  customerIsValid,
  validateCustomer,
  type CustomerDraft
} from './validation';

export const STEP_KEYS = [
  'customer',
  'parameters',
  'elevations',
  'obstructions',
  'panels',
  'layout',
  'price',
  'performance',
  'sale'
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_LABELS: Record<StepKey, string> = {
  customer: 'Customer',
  parameters: 'Parameters',
  elevations: 'Elevations',
  obstructions: 'Obstructions',
  panels: 'Panels',
  layout: 'Layout',
  price: 'Price',
  performance: 'Performance',
  sale: 'Sale & submit'
};

export function stepIndex(step: StepKey): number {
  return STEP_KEYS.indexOf(step);
}

export const MSG_FILL_FIELDS =
  'Fill in every highlighted field above to continue.';
export const MSG_CONFIRM_ELEVATIONS =
  'Confirm every roof elevation with "Use these values" to continue.';

/** Every elevation must be a confirmed Rectangle or Complex one. */
export function allSlopesConfirmed(design: DesignState): boolean {
  return (
    design.slopes.length > 0 &&
    design.slopes.every(
      (s) =>
        (s.shapeMode === 'rect' || s.shapeMode === 'complex') && s.confirmed
    )
  );
}

/** True when a required field on this elevation's visible tab is blank. */
export function slopeHasBlankRequired(slope: Slope): boolean {
  if (slope.shapeMode === 'calc') {
    return isBlank(slope.pitchDeg) || isBlank(slope.calcAdjacentM);
  }
  const shared =
    isBlank(slope.pitchDeg) ||
    isBlank(slope.shadingPct) ||
    isBlank(slope.bearingDeg) ||
    isBlank(slope.radiance);
  if (slope.shapeMode === 'complex') {
    // Only one of the two max-panel counts is needed.
    return (
      shared || (isBlank(slope.maxPanelsP7) && isBlank(slope.maxPanelsMClass))
    );
  }
  return shared || isBlank(slope.xM) || isBlank(slope.yM);
}

export interface GateInput {
  customer: CustomerDraft;
  design: DesignState;
}

/** Why the surveyor cannot move forward from `step` yet, or null. */
export function stepBlocker(step: StepKey, input: GateInput): string | null {
  const { customer, design } = input;
  switch (step) {
    case 'customer': {
      if (customerIsValid(customer)) return null;
      const errors = validateCustomer(customer);
      const formatOnly =
        customer.firstName.trim() &&
        customer.lastName.trim() &&
        customer.addressLine1.trim() &&
        customer.town.trim() &&
        customer.postcode.trim() &&
        (customer.phone.trim() || customer.email.trim());
      if (formatOnly) return errors.postcode ?? errors.email ?? MSG_FILL_FIELDS;
      return MSG_FILL_FIELDS;
    }
    case 'parameters':
      return isBlank(design.pricing.extras.acRunM) ||
        isBlank(design.performance.annualConsumptionKwh)
        ? MSG_FILL_FIELDS
        : null;
    case 'elevations':
      if (!allSlopesConfirmed(design)) return MSG_CONFIRM_ELEVATIONS;
      return design.slopes.some(slopeHasBlankRequired) ? MSG_FILL_FIELDS : null;
    case 'panels':
      return design.selectedPanelId ? null : 'Choose a panel type to continue.';
    case 'price':
      return design.pricing.inverterLines.some((l) => !l.modelId)
        ? 'Select an inverter for every line to continue.'
        : null;
    default:
      return null;
  }
}

/**
 * The first step in [from, to) that blocks a forward move. Checking every step
 * in between (not just the current one) closes the prototype's loophole where
 * a stepper jump could leap over an unconfirmed elevation.
 */
export function firstBlocker(
  input: GateInput,
  from: StepKey,
  to: StepKey
): { step: StepKey; message: string } | null {
  for (let i = stepIndex(from); i < stepIndex(to); i++) {
    const step = STEP_KEYS[i];
    const message = stepBlocker(step, input);
    if (message) return { step, message };
  }
  return null;
}
