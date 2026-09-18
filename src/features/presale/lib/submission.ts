// Turns a draft into the PresaleSubmission the backend expects, and resolves
// the Sale step's "pre-derived but editable" values.

import { type FinanceRoute, type PresaleSubmission } from '../contract';
import {
  computePricing,
  snapshotFromPricing,
  type Pricing
} from '../designer/calc';
import {
  CATALOGUE_VERSION,
  DESIGN_SCHEMA_VERSION
} from '../designer/catalogue';
import { numOr0 } from '../designer/types';
import { type PresaleDraft } from './draft';
import { firstBlocker, type StepKey } from './steps';
import {
  blankToNull,
  normaliseEmail,
  normalisePostcode,
  parsePriceToPence
} from './validation';

export interface SalesContext {
  currentUserId: string;
  salespeople: { id: string; displayName: string }[];
  canSubmitOnBehalf: boolean;
}

export interface ResolvedSale {
  salespersonId: string;
  financeRoute: FinanceRoute | null;
  agreedPriceText: string;
  agreedPricePence: number | null;
  computedTotalPence: number | null;
  roofRequired: boolean;
  electricalRequired: boolean;
  scaffoldRequired: boolean;
  /** Set when the finance route and the designer's "Using finance?" disagree. */
  financeMismatch: string | null;
}

export function resolveSale(
  draft: PresaleDraft,
  pricing: Pricing | null,
  ctx: SalesContext
): ResolvedSale {
  let salespersonId = ctx.currentUserId;
  if (ctx.canSubmitOnBehalf) {
    const listed = (id: string) => ctx.salespeople.some((p) => p.id === id);
    if (draft.sale.salespersonId && listed(draft.sale.salespersonId)) {
      salespersonId = draft.sale.salespersonId;
    } else {
      salespersonId = listed(ctx.currentUserId) ? ctx.currentUserId : '';
    }
  }

  const usingFinance = draft.design.pricing.finance;
  const financeRoute =
    draft.sale.financeRoute ?? (usingFinance === 'No' ? 'Standard' : null);
  let financeMismatch: string | null = null;
  if (financeRoute === 'Standard' && usingFinance !== 'No') {
    financeMismatch = `The design has "Using finance?" set to ${usingFinance}, so a finance admin fee is in the price — but the finance route here is "No finance". Change one of them so they agree.`;
  } else if (
    financeRoute &&
    financeRoute !== 'Standard' &&
    usingFinance === 'No'
  ) {
    financeMismatch =
      'A finance route is selected, but the design has "Using finance?" set to No, so no finance admin fee is in the price. Change one of them so they agree.';
  }

  const computedTotalPence = pricing
    ? snapshotFromPricing(pricing).computed_total_pence
    : null;
  const agreedPriceText =
    draft.sale.agreedPrice ?? (pricing ? pricing.total.toFixed(2) : '');

  return {
    salespersonId,
    financeRoute,
    agreedPriceText,
    agreedPricePence: parsePriceToPence(agreedPriceText),
    computedTotalPence,
    roofRequired:
      draft.scope.roofRequired ??
      (pricing ? pricing.totalNetPanels > 0 : false),
    electricalRequired: draft.scope.electricalRequired ?? true,
    scaffoldRequired:
      draft.scope.scaffoldRequired ??
      numOr0(draft.design.pricing.scaffoldM) > 0,
    financeMismatch
  };
}

export interface SubmissionProblem {
  step: StepKey;
  field?: string;
  message: string;
}

export type BuildResult =
  | { ok: true; submission: PresaleSubmission }
  | { ok: false; problem: SubmissionProblem };

export function buildSubmission(
  draft: PresaleDraft,
  ctx: SalesContext
): BuildResult {
  const blocked = firstBlocker(draft, 'customer', 'sale');
  if (blocked) {
    return {
      ok: false,
      problem: { step: blocked.step, message: blocked.message }
    };
  }
  const pricing = computePricing(draft.design);
  if (!pricing) {
    return {
      ok: false,
      problem: {
        step: 'panels',
        message: 'Choose a panel type before submitting.'
      }
    };
  }
  const sale = resolveSale(draft, pricing, ctx);
  const fail = (field: string, message: string): BuildResult => ({
    ok: false,
    problem: { step: 'sale', field, message }
  });
  if (!sale.salespersonId)
    return fail('salesperson_id', 'Choose the salesperson for this sale.');
  if (!sale.financeRoute)
    return fail('finance_route', 'Choose a finance route for this sale.');
  if (sale.agreedPricePence === null) {
    return fail(
      'agreed_price_pence',
      'Enter the agreed selling price as pounds and pence, e.g. 12450.00 — it must be more than zero.'
    );
  }

  const c = draft.customer;
  const postcode = normalisePostcode(c.postcode);
  const emailRaw = c.email.trim();
  const email = emailRaw ? normaliseEmail(emailRaw) : null;
  if (!postcode || (emailRaw && !email)) {
    // Unreachable past the customer gate above; kept so the types stay honest.
    return {
      ok: false,
      problem: { step: 'customer', message: 'Check the customer details.' }
    };
  }

  return {
    ok: true,
    submission: {
      customer: {
        first_name: c.firstName.trim(),
        last_name: c.lastName.trim(),
        address_line1: c.addressLine1.trim(),
        address_line2: blankToNull(c.addressLine2),
        town: c.town.trim(),
        postcode,
        phone: blankToNull(c.phone),
        email
      },
      sale: {
        salesperson_id: sale.salespersonId,
        lead_source: blankToNull(draft.sale.leadSource),
        quote_reference: blankToNull(draft.sale.quoteReference),
        finance_route: sale.financeRoute,
        agreed_price_pence: sale.agreedPricePence
      },
      scope: {
        roof_required: sale.roofRequired,
        electrical_required: sale.electricalRequired,
        scaffold_required: sale.scaffoldRequired,
        roof_notes: blankToNull(draft.scope.roofNotes),
        electrical_notes: blankToNull(draft.scope.electricalNotes)
      },
      design: JSON.parse(JSON.stringify(draft.design)) as Record<
        string,
        unknown
      >,
      design_schema_version: DESIGN_SCHEMA_VERSION,
      catalogue_version: CATALOGUE_VERSION,
      computed: snapshotFromPricing(pricing)
    }
  };
}

const CUSTOMER_FIELDS = [
  'first_name',
  'last_name',
  'address_line1',
  'address_line2',
  'town',
  'postcode',
  'phone',
  'email'
];

/** Which step owns a field name reported back by the server. */
export function stepForServerField(field: string): StepKey | null {
  const parts = field.toLowerCase().split('.');
  const group = parts.length > 1 ? parts[0] : '';
  const leaf = parts[parts.length - 1];
  if (group === 'customer' || CUSTOMER_FIELDS.indexOf(leaf) >= 0)
    return 'customer';
  if (group === 'design' || group === 'computed' || leaf === 'design')
    return 'price';
  if (group === 'sale' || group === 'scope') return 'sale';
  if (
    [
      'salesperson_id',
      'lead_source',
      'quote_reference',
      'finance_route',
      'agreed_price_pence',
      'roof_notes',
      'electrical_notes'
    ].indexOf(leaf) >= 0
  ) {
    return 'sale';
  }
  return null;
}

/** The last path segment, which is what the steps use to highlight a field. */
export function fieldLeaf(field: string | undefined | null): string | null {
  if (!field) return null;
  const parts = field.toLowerCase().split('.');
  return parts[parts.length - 1] || null;
}
