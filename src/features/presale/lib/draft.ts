// The autosaved presale draft. One per person, in localStorage; the commandId
// minted with it is the idempotency key for the eventual submit and only
// changes when the draft is discarded or successfully submitted.

import { type FinanceRoute } from '../contract';
import {
  defaultDesignState,
  defaultPricing,
  type DesignState
} from '../designer/types';
import { STEP_KEYS, type StepKey } from './steps';
import { emptyCustomer, type CustomerDraft } from './validation';

export const DRAFT_VERSION = 1;
const KEY_PREFIX = 'ss.presale.draft.v1.';

export interface SaleDraft {
  salespersonId: string;
  leadSource: string;
  quoteReference: string;
  /** null = not chosen yet (pre-selects Standard when no finance is in the design). */
  financeRoute: FinanceRoute | null;
  /** null = follow the designer's computed total. */
  agreedPrice: string | null;
}

export interface ScopeDraft {
  /** null = follow the value derived from the design. */
  roofRequired: boolean | null;
  electricalRequired: boolean | null;
  scaffoldRequired: boolean | null;
  roofNotes: string;
  electricalNotes: string;
}

export interface PresaleDraft {
  version: number;
  commandId: string;
  step: StepKey;
  /** High-water mark: index into STEP_KEYS of the furthest step reached. */
  maxStep: number;
  customer: CustomerDraft;
  sale: SaleDraft;
  scope: ScopeDraft;
  design: DesignState;
}

export function draftKey(personId: string): string {
  return `${KEY_PREFIX}${personId}`;
}

export function newCommandId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // randomUUID needs a secure context; build a v4 UUID by hand otherwise.
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  b.forEach((v) => hex.push((v + 0x100).toString(16).slice(1)));
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createDraft(): PresaleDraft {
  return {
    version: DRAFT_VERSION,
    commandId: newCommandId(),
    step: 'customer',
    maxStep: 0,
    customer: emptyCustomer(),
    sale: {
      salespersonId: '',
      leadSource: '',
      quoteReference: '',
      financeRoute: null,
      agreedPrice: null
    },
    scope: {
      roofRequired: null,
      electricalRequired: null,
      scaffoldRequired: null,
      roofNotes: '',
      electricalNotes: ''
    },
    design: defaultDesignState()
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Rebuilds a draft from stored JSON over fresh defaults; null if unusable. */
export function reviveDraft(raw: unknown): PresaleDraft | null {
  if (!isObject(raw) || raw.version !== DRAFT_VERSION) return null;
  if (typeof raw.commandId !== 'string' || !raw.commandId) return null;
  const design = raw.design;
  if (!isObject(design) || !Array.isArray(design.slopes)) return null;
  if (!isObject(design.params) || !isObject(design.pricing)) return null;

  const base = createDraft();
  const baseDesign = base.design;
  const storedPricing = design.pricing as Partial<DesignState['pricing']>;
  const pricingDefaults = defaultPricing();
  const merged: DesignState = {
    ...baseDesign,
    ...(design as Partial<DesignState>),
    performance: {
      ...baseDesign.performance,
      ...(isObject(design.performance) ? design.performance : {})
    },
    pricing: {
      ...pricingDefaults,
      ...storedPricing,
      extras: { ...pricingDefaults.extras, ...(storedPricing.extras ?? {}) },
      inverterLines: Array.isArray(storedPricing.inverterLines)
        ? storedPricing.inverterLines
        : pricingDefaults.inverterLines
    },
    exclusions: isObject(design.exclusions)
      ? (design.exclusions as DesignState['exclusions'])
      : {},
    obstructions: isObject(design.obstructions)
      ? (design.obstructions as DesignState['obstructions'])
      : {},
    complexLayouts: isObject(design.complexLayouts)
      ? (design.complexLayouts as DesignState['complexLayouts'])
      : {}
  };

  const step =
    STEP_KEYS.indexOf(raw.step as StepKey) >= 0
      ? (raw.step as StepKey)
      : 'customer';
  const maxStepRaw =
    typeof raw.maxStep === 'number' ? Math.floor(raw.maxStep) : 0;
  const maxStep = Math.max(
    STEP_KEYS.indexOf(step),
    Math.min(STEP_KEYS.length - 1, Math.max(0, maxStepRaw))
  );

  return {
    version: DRAFT_VERSION,
    commandId: raw.commandId,
    step,
    maxStep,
    customer: {
      ...base.customer,
      ...(isObject(raw.customer) ? raw.customer : {})
    },
    sale: { ...base.sale, ...(isObject(raw.sale) ? raw.sale : {}) },
    scope: { ...base.scope, ...(isObject(raw.scope) ? raw.scope : {}) },
    design: merged
  };
}

export function loadDraft(personId: string): PresaleDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(personId));
    return raw ? reviveDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveDraft(personId: string, draft: PresaleDraft): void {
  try {
    window.localStorage.setItem(draftKey(personId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the draft simply lives for this page only.
  }
}

export function clearDraft(personId: string): void {
  try {
    window.localStorage.removeItem(draftKey(personId));
  } catch {
    // Nothing to clear.
  }
}
