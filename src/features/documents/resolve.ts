// Building the snapshot.
//
// This is the only place that reads canonical data. It turns a job, a customer,
// an immutable presale and today's settings into a `DocumentInput` - after
// which the renderer is a pure function of that object.
//
// Two rules it never breaks:
//   1. It does not invent values. Anything it cannot derive is reported as
//      missing, by name, and a required missing value stops generation.
//   2. It formats here, once. "£12,345.00" is what the customer was shown, so
//      it is the thing that gets frozen - not a number plus a hope that the
//      same formatter exists in a year.

import {
  DEPOSIT_SPLITS,
  FALLBACK_DEGRADATION_PCT,
  PANEL_DEGRADATION_PCT,
  PROJECTION_YEARS,
  inverterModelById,
  panelById
} from '../presale/designer/catalogue';
import { computePerformance } from '../presale/designer/calc/performance';
import { computePricing } from '../presale/designer/calc/pricing';
import type { DesignState } from '../presale/designer/types';
import {
  buildProjection,
  paybackYears,
  totalSpendNoSolar
} from './calc/projection';
import type { ProjectionInputs } from './calc/projection';
import { TEMPLATE_IDS, TEMPLATE_VERSIONS } from './render/regions';
import {
  GENERATION_ERRORS,
  GenerationError,
  type DocumentInput,
  type DocumentType
} from './types';

// ---------------------------------------------------------------------------
// Canonical inputs
// ---------------------------------------------------------------------------

export interface DocumentSource {
  job: {
    id: string;
    reference: string;
    /** HistoricalImport jobs are read-only and never generate documents. */
    isHistoricalImport: boolean;
  };
  customer: {
    firstName: string;
    lastName: string;
    addressLine1: string;
    addressLine2: string | null;
    town: string;
    postcode: string;
    email: string | null;
    phone: string | null;
  };
  salesperson: {
    displayName: string;
    email: string | null;
    phone: string | null;
  };
  presale: {
    id: string;
    submittedAt: string;
    design: DesignState;
    designSchemaVersion: number;
    catalogueVersion: string;
    systemKwp: number;
    netPanels: number;
    agreedPricePence: number;
  };
  settings: {
    /**
     * Electricity price inflation, percent. A setting rather than a constant:
     * the masters print 7% as a customer-facing assumption and the performance
     * engine used 5%, so the rate is configured, captured per revision, and
     * rendered from the snapshot.
     */
    electricityInflationPct: number;
    /** Whether the SEG export rate escalates with the import tariff. */
    segInflates: boolean;
  };
  generatedAt: Date;
  generatedByPersonId: string | null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const gbp = (n: number): string =>
  `£${n.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const plain = (n: number): string =>
  n.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

const whole = (n: number): string => Math.round(n).toLocaleString('en-GB');

const dec = (n: number, places = 2): string =>
  n.toLocaleString('en-GB', {
    minimumFractionDigits: places,
    maximumFractionDigits: places
  });

/** "20 September 2026" - the form the masters use. */
const longDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

/** Quantities read "-" when nothing was sold; see the bindings for why. */
function qty(n: number): string | null {
  return n > 0 ? String(n) : null;
}

function inverterSummary(design: DesignState): {
  label: string | null;
  count: number;
} {
  const lines = design.pricing.inverterLines.filter((l) => l.modelId);
  if (!lines.length) return { label: null, count: 0 };
  const names = lines.map((l) => {
    const model = inverterModelById(l.modelId!);
    return model ? model.name : null;
  });
  if (names.some((n) => n == null)) return { label: null, count: 0 };
  const count = lines.reduce(
    (sum, l) => sum + Math.max(0, Number(l.qty) || 0),
    0
  );
  return { label: Array.from(new Set(names as string[])).join(' + '), count };
}

/**
 * Battery capacity in kWh, parsed from the catalogue's option label.
 *
 * The catalogue keys batteries by display name ("FoxESS EP12 x 2"), not by a
 * capacity field, so the kWh has to be read back out of the name. Where the
 * name does not state a capacity - every FoxESS EP option - this returns null
 * and the battery-size regions report as missing rather than guessing.
 */
function batteryKwh(label: string): number | null {
  if (label === 'None') return 0;
  const direct = label.match(/(\d+(?:\.\d+)?)\s*kWh/i);
  const multiplier = label.match(/x\s*(\d+)\s*$/i);
  if (direct) {
    const base = parseFloat(direct[1]);
    return multiplier ? base * parseInt(multiplier[1], 10) : base;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

export interface ResolveResult {
  input: DocumentInput;
  /** Optional variables that did not resolve. Recorded, never fatal. */
  absent: string[];
}

export function resolveDocument(
  documentType: DocumentType,
  source: DocumentSource,
  masterSha256: string
): ResolveResult {
  const { job, customer, salesperson, presale, settings } = source;

  if (job.isHistoricalImport) {
    throw new GenerationError(
      GENERATION_ERRORS.HISTORICAL_IMPORT,
      'This is an imported historical job. It has no presale of record, so no ' +
        'customer document can be generated for it.'
    );
  }

  const design = presale.design;
  const pricing = computePricing(design);
  if (!pricing) {
    throw new GenerationError(
      GENERATION_ERRORS.INCOMPLETE_DESIGN,
      'The presale design does not price: no panel is selected.'
    );
  }

  // The gate the brief asked for. A presale can be submitted with a real
  // agreed price and a zero system - `presales.system_kwp` only checks >= 0,
  // and net panels fall to zero whenever a slope's geometry is incomplete.
  // That state must never reach a customer as a contract.
  if (presale.systemKwp <= 0 || presale.netPanels <= 0) {
    throw new GenerationError(
      GENERATION_ERRORS.INCOMPLETE_DESIGN,
      `This presale records ${presale.systemKwp.toFixed(2)} kWp and ` +
        `${presale.netPanels} panels. A quotation, contract or ROI cannot be ` +
        'issued for a system with no panels, whatever price was agreed. ' +
        'Complete the roof design and resubmit.'
    );
  }

  const performance = computePerformance(design);
  const panel = panelById(design.selectedPanelId);

  const absent: string[] = [];
  const v: Record<string, string> = {};
  const set = (key: string, text: string | null) => {
    if (text == null || text === '') absent.push(key);
    else v[key] = text;
  };

  // --- customer ------------------------------------------------------------
  const fullName = `${customer.firstName} ${customer.lastName}`.trim();
  const addressParts = [
    customer.addressLine1,
    customer.addressLine2,
    customer.town,
    customer.postcode
  ].filter((p): p is string => Boolean(p && p.trim()));

  set('customer.full_name', fullName);
  set('customer.first_name', customer.firstName);
  set('customer.address_line1', customer.addressLine1);
  set('customer.town', customer.town);
  set('customer.postcode', customer.postcode);
  set('customer.full_address', addressParts.join(', '));
  set('customer.email', customer.email);
  set('customer.phone', customer.phone);

  // --- job / document ------------------------------------------------------
  set('job.reference', job.reference);
  set('document.issued_date', longDate(source.generatedAt));
  set('sale.salesperson', salesperson.displayName);
  set('sale.salesperson_email', salesperson.email);
  set('sale.salesperson_phone', salesperson.phone);

  // --- system --------------------------------------------------------------
  const inverter = inverterSummary(design);
  const battery = design.pricing.stackedBattery;
  const batteryCapacity = batteryKwh(battery);

  set('system.panel_model', panel ? `${panel.name} ${panel.variant}` : null);
  set('system.panel_count', String(presale.netPanels));
  set('system.system_kwp', dec(presale.systemKwp, 2));
  set(
    'system.panel_warranty_years',
    panel ? String(panel.warrantyYears) : null
  );
  set('system.inverter', inverter.label);
  set(
    'system.inverter_count',
    inverter.count > 0 ? String(inverter.count) : null
  );
  set('system.battery', battery === 'None' ? null : battery);
  set('system.battery_count', battery === 'None' ? null : '1');
  set(
    'system.battery_kwh',
    battery === 'None'
      ? '0'
      : batteryCapacity != null
        ? dec(batteryCapacity, 1)
        : null
  );

  // --- extras --------------------------------------------------------------
  const extras = design.pricing.extras;
  set('extras.ev_charger', extras.ev === 'No' ? null : extras.ev);
  set('extras.ev_charger_qty', extras.ev === 'No' ? null : '1');
  set('extras.backup', extras.offgrid === 'No' ? null : extras.offgrid);
  set('extras.backup_qty', extras.offgrid === 'No' ? null : '1');
  set('extras.bird_netting_qty', extras.birdproofing === 'No' ? null : '1');
  set('extras.iboost_qty', extras.iboost === 'No' ? null : '1');
  set('extras.immersion_qty', extras.immersion === 'No' ? null : '1');
  set(
    'extras.optimisers_qty',
    extras.optimisers === 'Yes' ? qty(Number(extras.optimiserCount) || 0) : null
  );
  set('installation.scaffold_qty', pricing.scaffoldSubtotal > 0 ? '1' : null);

  // --- price ---------------------------------------------------------------
  // The master has a Goods Total, a Services Total and a Sub Total, but no row
  // for adjustments or a discount. Rather than print three figures that do not
  // add up, both are folded into the services line so the arithmetic a customer
  // can check is always right. Whether a discount should instead be shown on
  // its own row is an open business decision, recorded in the architecture note.
  const goods = pricing.equipmentSubtotal;
  const services =
    pricing.installationSubtotal + pricing.adjustments - pricing.discount;
  const subtotal = goods + services;
  const agreed = presale.agreedPricePence / 100;

  set('price.goods_total', gbp(goods));
  set('price.services_total', gbp(services));
  set('price.goods_services_subtotal', gbp(subtotal));
  // The literal regions cover the whole "£600.00" / "£0" run, so these carry
  // their own currency sign.
  set('price.delivery', gbp(pricing.deliveryWaste));
  set('price.vat', gbp(pricing.vat));
  set('price.total', gbp(agreed));
  set('price.total_plain', plain(agreed));
  set('price.per_kwp_plain', plain(agreed / presale.systemKwp));

  DEPOSIT_SPLITS.forEach((split, i) => {
    set(`price.deposit_stage${i + 1}`, gbp(agreed * split.pct));
  });

  // --- ROI -----------------------------------------------------------------
  const consumption = performance?.annualConsumptionKwh ?? null;
  const generation = performance?.annualGenerationKwh ?? 0;

  if (documentType === 'ROI') {
    if (!performance || !performance.anyGeneration || generation <= 0) {
      throw new GenerationError(
        GENERATION_ERRORS.MISSING_GENERATION_FORECAST,
        'Missing annual generation forecast: no elevation has a usable ' +
          'radiance figure, so the ROI has nothing to project from.'
      );
    }
    if (consumption == null || consumption <= 0) {
      throw new GenerationError(
        GENERATION_ERRORS.MISSING_CONSUMPTION,
        "Missing the household's annual electricity consumption. Every " +
          '"without solar" figure in the ROI report is derived from it, so the ' +
          'report cannot be produced without it.'
      );
    }
  }

  let projection: DocumentInput['projection'] = [];

  if (performance && consumption != null && consumption > 0 && generation > 0) {
    const degradation =
      panel && PANEL_DEGRADATION_PCT[panel.id] != null
        ? PANEL_DEGRADATION_PCT[panel.id]
        : FALLBACK_DEGRADATION_PCT;

    const inputs: ProjectionInputs = {
      annualGenerationKwh: generation,
      annualConsumptionKwh: consumption,
      tariffPence: Number(design.performance.tariffPence) || 0,
      segRatePence: Number(design.performance.segRatePence) || 0,
      selfConsumptionPct: Number(design.performance.selfConsumptionPct) || 0,
      inflationPct: settings.electricityInflationPct,
      degradationPct: degradation,
      segInflates: settings.segInflates
    };

    projection = buildProjection(inputs);
    const payback = paybackYears(inputs, agreed);
    const last = projection[projection.length - 1];

    set('roi.annual_generation_kwh', whole(generation));
    set('roi.annual_consumption_kwh', whole(consumption));
    set(
      'roi.self_consumption_pct',
      whole(Number(design.performance.selfConsumptionPct))
    );
    set(
      'roi.export_pct',
      whole(100 - (Number(design.performance.selfConsumptionPct) || 0))
    );
    set('roi.seg_rate', dec(Number(design.performance.segRatePence) || 0, 2));
    set('roi.electricity_saving_year1', gbp(performance.electricitySavings));
    set('roi.seg_income_year1', gbp(performance.segIncome));
    set('roi.annual_saving_year1', gbp(performance.totalIncomeYear1));
    set('roi.annual_saving_year1_plain', plain(performance.totalIncomeYear1));
    set('roi.total_saving_30yr', gbp(last ? last.savingCumulative : 0));
    set('roi.total_saving_30yr_plain', plain(last ? last.savingCumulative : 0));
    set('roi.total_spend_30yr_no_solar', plain(totalSpendNoSolar(inputs)));
    set('roi.monthly_bill_year30', plain(last ? last.billNoSolarMonthly : 0));
    set(
      'roi.yield_pct_year1',
      performance.roiPct != null ? dec(performance.roiPct, 1) : null
    );
    // Payback is the agreed meaning of the ROI report's headline figure. A
    // system that never pays back inside the term says so; it is not rounded
    // up to the last row of the table.
    set(
      'roi.payback_years',
      payback != null
        ? `${dec(payback, 1)} years`
        : `over ${PROJECTION_YEARS} years`
    );
  }

  const input: DocumentInput = {
    snapshotVersion: 1,
    documentType,
    templateId: TEMPLATE_IDS[documentType],
    templateVersion: TEMPLATE_VERSIONS[documentType],
    masterSha256,
    variables: v,
    projection,
    provenance: {
      jobId: job.id,
      jobReference: job.reference,
      presaleId: presale.id,
      presaleSubmittedAt: presale.submittedAt,
      designSchemaVersion: presale.designSchemaVersion,
      catalogueVersion: presale.catalogueVersion,
      electricityInflationPct: settings.electricityInflationPct,
      generatedAt: source.generatedAt.toISOString(),
      generatedByPersonId: source.generatedByPersonId
    }
  };

  return { input, absent };
}
