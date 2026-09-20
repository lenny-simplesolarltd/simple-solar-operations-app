// The template map: every dynamic region in a master, bound to a canonical
// variable.
//
// Geometry lives in `regions.v1.json`, extracted from the master itself and
// re-derivable (`scripts/documents/extract-regions.py`). This file supplies
// what geometry cannot know: which variable fills the region, whether the
// document may be issued without it, and what to do when the value is longer
// than the space the master left for it.
//
// Nothing here invents a value. A binding names a registry id; if the registry
// cannot resolve it, a `required` binding stops generation with an actionable
// error and an `optional` one renders an agreed placeholder.

import type { DocumentType } from './types';

export type Overflow =
  /** Wrap onto extra lines, growing downward from the region's baseline. */
  | 'wrap'
  /** Reduce size toward `minSize`, then wrap, then fail. Never below minSize. */
  | 'shrink'
  /** Single line, cut with an ellipsis. Only for values where a tail is noise. */
  | 'truncate';

export interface Binding {
  /** Token name as it appears in the master: `{{fullname}}` -> `fullname`. */
  token: string;
  /** Registry id this region renders, e.g. `customer.full_name`. */
  variable: string;
  /**
   * A required region that does not resolve fails the whole document. This is
   * the brief's rule: no legally meaningful document with a blank where a
   * number belongs.
   */
  required: boolean;
  overflow: Overflow;
  /** Floor for `shrink`. Below this text stops being legible, so we fail instead. */
  minSize?: number;
  /** Cap for wrapped regions; exceeding it is an overflow failure. */
  maxLines?: number;
  /**
   * Right edge the value may not cross, in PDF points. The extracted bounds are
   * the *placeholder's* box, which is usually narrower than the space actually
   * available (a short `{{panel}}` sits in a wide table cell). Without this a
   * long panel name would be judged to overflow when it plainly fits.
   */
  limitX1?: number;
  /**
   * Left edge a RIGHT-aligned value may not cross, in PDF points. Same idea as
   * `limitX1` mirrored: the quotation's money column is right-aligned at
   * 521.2pt and a long total grows leftward into the cell, not rightward.
   */
  limitX0?: number;
  /**
   * Cover the literal character the master prints straight after the token.
   * Only used where the canonical value changes the unit: `{{roi}}%` becomes
   * "8.4 years", so the stray `%` has to go.
   */
  absorbSuffix?: boolean;
  /**
   * Cover the literal the master prints immediately BEFORE the token, because
   * the value already contains it. Used for the money column, where "£" is
   * static text and the number is right-aligned to the column edge: bound
   * together they stay a single unit no matter how large the figure gets.
   */
  absorbPrefix?: boolean;
  /**
   * Cover the trailing literal and redraw it immediately after the value.
   *
   * For a token set inside a sentence - "Dear {{firstname}}," - the comma is
   * the very next glyph, so the placeholder's own width is all the room the
   * value appears to have and any long name overflows. A flat PDF cannot
   * reflow the rest of the line, but the one glyph that follows can be lifted
   * and redrawn after the value, which is enough: the constraint becomes the
   * end of the line instead of the width of the placeholder.
   */
  reflowSuffix?: boolean;
  /** Rendered when an optional variable is absent. Never used when required. */
  fallback?: string;
  /** Why this binding is the way it is, where that is not obvious. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Quotation & Contract
// ---------------------------------------------------------------------------

const req = (
  token: string,
  variable: string,
  extra: Partial<Binding> = {}
): Binding => ({
  token,
  variable,
  required: true,
  overflow: 'shrink',
  minSize: 8,
  ...extra
});

const opt = (
  token: string,
  variable: string,
  fallback: string,
  extra: Partial<Binding> = {}
): Binding => ({
  token,
  variable,
  required: false,
  overflow: 'shrink',
  minSize: 8,
  fallback,
  ...extra
});

/**
 * Quantity cells on the goods/services table read "-" rather than "0" when an
 * extra was not sold: the master's own rows for un-purchased items are meant to
 * be visibly not-purchased, and a column of zeroes reads like a pricing error.
 */
const QTY_NONE = '-';

export const QUOTATION_BINDINGS: readonly Binding[] = [
  // --- Cover letter (p1) --------------------------------------------------
  req('fullname', 'customer.full_name'),
  req('firstname', 'customer.first_name', { reflowSuffix: true }),
  req('firstline', 'customer.address_line1'),
  req('city', 'customer.town'),
  req('postcode', 'customer.postcode'),
  req('date', 'document.issued_date'),
  req('ref', 'job.reference'),

  // --- Quotation table (p3) ----------------------------------------------
  req('fulladdress', 'customer.full_address', {
    overflow: 'wrap',
    maxLines: 3,
    note: 'Multi-line addresses are normal; the cell has room for three lines.'
  }),
  req('surveyor', 'sale.salesperson'),

  req('panel', 'system.panel_model'),
  req('panelq', 'system.panel_count'),
  req('inverter', 'system.inverter', {
    overflow: 'shrink',
    note: 'Several inverters are joined with " + " and can be long.'
  }),
  req('inverterq', 'system.inverter_count'),
  opt('battery', 'system.battery', 'None'),
  opt('batteryq', 'system.battery_count', QTY_NONE),
  opt('ev', 'extras.ev_charger', 'None'),
  opt('evq', 'extras.ev_charger_qty', QTY_NONE),
  opt('backup', 'extras.backup', 'None'),
  opt('offgridq', 'extras.backup_qty', QTY_NONE),
  opt('birdnettingq', 'extras.bird_netting_qty', QTY_NONE),
  opt('iboostq', 'extras.iboost_qty', QTY_NONE),
  opt('immersionq', 'extras.immersion_qty', QTY_NONE),
  opt('optimisersq', 'extras.optimisers_qty', QTY_NONE),
  // The money column prints a static "£" and right-aligns the number to the
  // column edge. Bound separately, a six-figure total grows leftward over its
  // own currency sign, so the "£" is absorbed and the value carries it.
  req('gt', 'price.goods_total', { absorbPrefix: true }),
  opt('scaffq', 'installation.scaffold_qty', QTY_NONE),
  req('st', 'price.services_total', { absorbPrefix: true }),
  req('gsst', 'price.goods_services_subtotal', { absorbPrefix: true }),
  req('totalcost', 'price.total', { absorbPrefix: true }),

  // Hard-printed in the master; editable fields in the app. See
  // extra-regions.json for why these exist at all.
  // These two keep the master's own "£": the literal region covers only the
  // digits, so the value is the plain amount.
  req('delivery_cost', 'price.delivery', {
    note: 'Master prints £600.00; design.pricing.deliveryWaste is editable.'
  }),
  req('vat_amount', 'price.vat', {
    note: 'Master prints £0; design.pricing.vat is editable.'
  }),

  // --- Warranties and payment schedule (p4) -------------------------------
  req('panel_warranty_years', 'system.panel_warranty_years', {
    note: 'Master prints 30 for all panels; M Class is 40.'
  }),
  req('25', 'price.deposit_stage1', { absorbPrefix: true }),
  req('35', 'price.deposit_stage2', { absorbPrefix: true }),
  req('40', 'price.deposit_stage3', { absorbPrefix: true }),

  // --- MCS performance estimate (p19-21) ----------------------------------
  // Gated as a whole: see MCS_SECTION below.
  req('capacity', 'system.system_kwp'),
  req('orientation', 'mcs.orientation_degrees'),
  req('inclination', 'mcs.inclination_degrees'),
  req('postcodezone', 'mcs.postcode_zone'),
  req('kk', 'mcs.kk'),
  req('sf', 'mcs.shade_factor'),
  req('output', 'mcs.annual_output_kwh'),
  req('archetype', 'mcs.occupancy_archetype'),
  req('consume', 'roi.annual_consumption_kwh'),
  req('selfconsume', 'mcs.self_consumed_kwh'),
  req('pvdep', 'mcs.self_sufficiency_pct'),
  opt('battkwh', 'system.battery_kwh', '0'),
  req('selfconsumeperc', 'roi.self_consumption_pct'),
  req('exportperc', 'roi.export_pct'),
  req('savingsyear1', 'roi.electricity_saving_year1', { absorbPrefix: true }),
  req('segyear1', 'roi.seg_income_year1', { absorbPrefix: true }),
  req('savings', 'roi.annual_saving_year1', { absorbPrefix: true }),
  req('totsavings', 'roi.total_saving_30yr', { absorbPrefix: true }),
  // NOT the same quantity as the ROI report's {{roi}}. This cell is labelled
  // "Return on investment in year 1" and prints a %, so it is the year-1 yield
  // the performance engine already computes. The ROI report's cover reads as a
  // payback period and is bound to `roi.payback_years`. Two tokens, one name,
  // two meanings - recorded here so nobody "fixes" one to match the other.
  req('roi', 'roi.yield_pct_year1')
];

/**
 * Pages 19-21 are a certifiable MCS MIS 3002 / MGD 003 estimate. Four of its
 * inputs have no source in the designer and the app's generation formula
 * (kWp x radiance x PR x shading) is not the declared MCS method (kWp x Kk x
 * SF). Until both are settled the section cannot be issued, so these pages are
 * dropped from the output rather than filled with plausible numbers.
 *
 * Flip to `true` only once `mcs.*` genuinely resolves - the renderer asserts it.
 */
export const MCS_SECTION = {
  pages: [19, 20, 21] as readonly number[],
  enabled: false,
  reason:
    'MCS performance estimate withheld: postcode zone, radiation (Kk), shade ' +
    'factor, occupancy archetype and array azimuth are not captured by the ' +
    'presale, and the implemented generation formula does not match the ' +
    'declared MCS method.'
} as const;

// ---------------------------------------------------------------------------
// ROI report
// ---------------------------------------------------------------------------

export const ROI_BINDINGS: readonly Binding[] = [
  // --- Cover (p1) ---------------------------------------------------------
  req('name', 'customer.first_name', { reflowSuffix: true }),
  req('ref', 'job.reference'),
  req('fullname', 'customer.full_name'),
  req('address', 'customer.full_address', {
    overflow: 'shrink',
    minSize: 20,
    note: 'One line on the cover disc; shrinks rather than wrapping into the photo.'
  }),
  opt('phone', 'customer.phone', 'Not provided'),
  opt('email', 'customer.email', 'Not provided'),
  req('date', 'document.issued_date'),
  req('surveyorname', 'sale.salesperson'),
  req('price', 'price.total_plain'),
  req('roi', 'roi.payback_years', { absorbSuffix: true }),

  // --- System summary (p4) ------------------------------------------------
  req('panelquantity', 'system.panel_count'),
  req('systemsize', 'system.system_kwp'),
  req('generation', 'roi.annual_generation_kwh'),
  req('annualsaving', 'roi.annual_saving_year1_plain'),
  req('annualsavings', 'roi.annual_saving_year1_plain'),
  req('totalsaving', 'roi.total_saving_30yr_plain'),
  req('inverter', 'system.inverter'),
  opt('battery', 'system.battery', 'None'),
  opt('batterysize', 'system.battery_kwh', '0'),
  req('annualusage', 'roi.annual_consumption_kwh'),
  req('priceperkw', 'price.per_kwp_plain'),
  req('segrate', 'roi.seg_rate'),

  // --- Contact (p15) ------------------------------------------------------
  // public.people holds no phone number, so the ROI's "surveyor contact" line
  // has NO source in the schema. It comes from the `documents.contact_phone`
  // setting, and when that is unset the line reads as not recorded rather than
  // carrying a number nobody chose. An absence is honest; an invented direct
  // line is not, and it is not worth failing a whole report over.
  opt('surveyorcontact', 'sale.salesperson_phone', '—'),
  req('surveyoremail', 'sale.salesperson_email')
];

// ---------------------------------------------------------------------------
// The numbered projection cells
// ---------------------------------------------------------------------------

/**
 * The master's numbered tokens are a row-indexed projection table. Rows are
 * ordinals, not years: 1-15 are years 1-15, then 16 -> year 20, 17 -> year 25,
 * 18 -> year 30. Verified against every row present on pages 7, 8 and 14.
 *
 *   pence per kW (no solar) : {{54 + n}}
 *   monthly bill (no solar) : {{3n - 1}}
 *   annual  bill (no solar) : {{3n}}
 *   with-solar triple       : {{3n + 98}}, {{3n + 99}}, {{3n + 100}}
 *                             = monthly, annual, cumulative saving
 */
export type ProjectionField =
  | 'pencePerKwh'
  | 'billNoSolarMonthly'
  | 'billNoSolarAnnual'
  | 'billWithSolarMonthly'
  | 'billWithSolarAnnual'
  | 'savingCumulative';

export interface ProjectionBinding {
  token: string;
  /** Row ordinal, 1-18. */
  n: number;
  field: ProjectionField;
}

/** Row ordinal -> the year it represents. */
export const PROJECTION_ROWS: readonly { n: number; year: number }[] = [
  ...Array.from({ length: 15 }, (_, i) => ({ n: i + 1, year: i + 1 })),
  { n: 16, year: 20 },
  { n: 17, year: 25 },
  { n: 18, year: 30 }
];

export function projectionBindings(): ProjectionBinding[] {
  const out: ProjectionBinding[] = [];
  for (const { n } of PROJECTION_ROWS) {
    out.push({ token: String(54 + n), n, field: 'pencePerKwh' });
    out.push({ token: String(3 * n - 1), n, field: 'billNoSolarMonthly' });
    out.push({ token: String(3 * n), n, field: 'billNoSolarAnnual' });
    out.push({ token: String(3 * n + 98), n, field: 'billWithSolarMonthly' });
    out.push({ token: String(3 * n + 99), n, field: 'billWithSolarAnnual' });
    out.push({ token: String(3 * n + 100), n, field: 'savingCumulative' });
  }
  return out;
}

/**
 * Scalars the master derives from the projection and prints outside the table.
 *
 * `74` is the master's own inconsistency: page 7 labels "Monthly electricity
 * bill in 30 years" `{{74}}` while page 14 labels the same quantity `{{53}}`.
 * `{{53}}` is the row-18 monthly figure, so page 14 is right and both are bound
 * to the same value - which is the only reading that makes the document
 * self-consistent. Flagged for the owner in the architecture note.
 */
export const PROJECTION_SCALARS: Readonly<Record<string, string>> = {
  '73': 'roi.total_spend_30yr_no_solar',
  '74': 'roi.monthly_bill_year30'
};

export function bindingsFor(documentType: DocumentType): readonly Binding[] {
  return documentType === 'QuotationContract'
    ? QUOTATION_BINDINGS
    : ROI_BINDINGS;
}
