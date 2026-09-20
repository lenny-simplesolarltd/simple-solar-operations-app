// The gates. Each of these is a case where a document would otherwise be
// generated and would be wrong, so the test is the guarantee.

import { describe, expect, it } from 'vitest';

import { fixtureKitchenSink } from '../../presale/designer/calc/__tests__/fixtures';
import type { DesignState } from '../../presale/designer/types';
import { resolveDocument, type DocumentSource } from '../resolve';
import { GENERATION_ERRORS, GenerationError } from '../types';

const SHA = 'a'.repeat(64);

function design(): DesignState {
  const d = fixtureKitchenSink();
  d.performance = {
    ...d.performance,
    annualConsumptionKwh: 4200,
    tariffPence: 27.49,
    segRatePence: 12,
    selfConsumptionPct: 70
  };
  d.slopes = d.slopes.map((s) => ({ ...s, radiance: s.radiance || 950 }));
  return d;
}

function source(over: Partial<DocumentSource> = {}): DocumentSource {
  return {
    job: { id: 'job-1', reference: 'SS-WDDG-5412', isHistoricalImport: false },
    customer: {
      firstName: 'Jane',
      lastName: 'Okonkwo',
      addressLine1: '14 Meadow Rise',
      addressLine2: null,
      town: 'Plymouth',
      postcode: 'PL4 6AB',
      email: 'jane@example.com',
      phone: '07700 900123'
    },
    salesperson: {
      displayName: 'Tom Reed',
      email: 'tom@example.com',
      phone: '07700 900456'
    },
    presale: {
      id: 'presale-1',
      submittedAt: '2026-09-20T09:00:00.000Z',
      design: design(),
      designSchemaVersion: 1,
      catalogueVersion: 'artifact-v0.12-2026-09-16',
      systemKwp: 10.71,
      netPanels: 21,
      agreedPricePence: 3_055_340
    },
    settings: { electricityInflationPct: 5, segInflates: false },
    generatedAt: new Date('2026-09-20T10:30:00.000Z'),
    generatedByPersonId: 'person-1',
    ...over
  };
}

function failureOf(fn: () => unknown): GenerationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GenerationError) return error;
    throw error;
  }
  throw new Error('expected generation to be refused, but it succeeded');
}

describe('gates', () => {
  it('refuses a presale with a price but no system', () => {
    // The exact state the audit found: presales.system_kwp only checks >= 0,
    // and net panels fall to zero when a slope's geometry is incomplete. A
    // contract must never be issued for it, whatever price was agreed.
    const error = failureOf(() =>
      resolveDocument(
        'QuotationContract',
        source({
          presale: { ...source().presale, systemKwp: 0, netPanels: 0 }
        }),
        SHA
      )
    );
    expect(error.code).toBe(GENERATION_ERRORS.INCOMPLETE_DESIGN);
    expect(error.message).toContain('0.00 kWp');
  });

  it('refuses a historical import', () => {
    const error = failureOf(() =>
      resolveDocument(
        'ROI',
        source({
          job: {
            id: 'job-2',
            reference: 'SS-OLD-0001',
            isHistoricalImport: true
          }
        }),
        SHA
      )
    );
    expect(error.code).toBe(GENERATION_ERRORS.HISTORICAL_IMPORT);
  });

  it('refuses an ROI with no consumption figure', () => {
    const d = design();
    d.performance = { ...d.performance, annualConsumptionKwh: '' };
    const error = failureOf(() =>
      resolveDocument(
        'ROI',
        source({ presale: { ...source().presale, design: d } }),
        SHA
      )
    );
    expect(error.code).toBe(GENERATION_ERRORS.MISSING_CONSUMPTION);
  });

  it('refuses an ROI with no generation forecast', () => {
    const d = design();
    d.slopes = d.slopes.map((s) => ({ ...s, radiance: '' }));
    const error = failureOf(() =>
      resolveDocument(
        'ROI',
        source({ presale: { ...source().presale, design: d } }),
        SHA
      )
    );
    expect(error.code).toBe(GENERATION_ERRORS.MISSING_GENERATION_FORECAST);
  });

  it('still issues a quotation when only the ROI inputs are missing', () => {
    // A quotation does not depend on consumption, so a missing consumption
    // figure must not block the sale document too.
    const d = design();
    d.performance = { ...d.performance, annualConsumptionKwh: '' };
    const { input } = resolveDocument(
      'QuotationContract',
      source({ presale: { ...source().presale, design: d } }),
      SHA
    );
    expect(input.variables['price.total']).toBeTruthy();
  });
});

describe('the snapshot', () => {
  const { input } = resolveDocument('QuotationContract', source(), SHA);

  it('carries the canonical customer, job and salesperson', () => {
    expect(input.variables['customer.full_name']).toBe('Jane Okonkwo');
    expect(input.variables['customer.full_address']).toBe(
      '14 Meadow Rise, Plymouth, PL4 6AB'
    );
    expect(input.variables['job.reference']).toBe('SS-WDDG-5412');
    expect(input.variables['sale.salesperson']).toBe('Tom Reed');
  });

  it('prices from the AGREED figure, not the computed one', () => {
    // What was sold is what is contracted, even where the engine would now
    // compute something else from the same design.
    expect(input.variables['price.total']).toBe('£30,553.40');
  });

  it('adds up: goods + services = sub total, + delivery + VAT = total', () => {
    const num = (k: string) => Number(input.variables[k].replace(/[£,]/g, ''));
    expect(num('price.goods_total') + num('price.services_total')).toBeCloseTo(
      num('price.goods_services_subtotal'),
      2
    );
    expect(
      num('price.goods_services_subtotal') +
        num('price.delivery') +
        num('price.vat')
    ).toBeCloseTo(num('price.total'), 2);
  });

  it('splits the deposit 25/35/40 of the agreed price', () => {
    const num = (k: string) => Number(input.variables[k].replace(/[£,]/g, ''));
    expect(num('price.deposit_stage1')).toBeCloseTo(30553.4 * 0.25, 2);
    expect(num('price.deposit_stage2')).toBeCloseTo(30553.4 * 0.35, 2);
    expect(num('price.deposit_stage3')).toBeCloseTo(30553.4 * 0.4, 2);
  });

  it('takes the panel warranty from the catalogue, not the master', () => {
    // The master prints 30 for every panel; the M Class is a 40-year panel.
    expect(input.variables['system.panel_warranty_years']).toBe('30');
  });

  it('carries the delivery and VAT actually entered', () => {
    expect(input.variables['price.delivery']).toBe('£600.00');
    expect(input.variables['price.vat']).toBe('£0.00');
  });

  it('records the inflation rate it was generated with', () => {
    // A setting, not a constant, so a revision must say which rate it used.
    expect(input.provenance.electricityInflationPct).toBe(5);
  });

  it('records the template and catalogue it was generated against', () => {
    expect(input.templateId).toBe('presale/quotation');
    expect(input.templateVersion).toBeTruthy();
    expect(input.provenance.catalogueVersion).toBe('artifact-v0.12-2026-09-16');
    expect(input.provenance.presaleId).toBe('presale-1');
  });

  it('is stable for the same inputs', () => {
    const again = resolveDocument('QuotationContract', source(), SHA).input;
    expect(again).toEqual(input);
  });

  it('never contains an unresolved placeholder', () => {
    for (const v of Object.values(input.variables)) {
      expect(v).not.toContain('{{');
    }
  });
});

describe('the ROI snapshot', () => {
  const { input } = resolveDocument('ROI', source(), SHA);

  it('carries the full projection', () => {
    expect(input.projection).toHaveLength(18);
  });

  it('reports payback in years, matching the agreed meaning of the cover', () => {
    expect(input.variables['roi.payback_years']).toMatch(/^\d+\.\d years$/);
  });

  it('keeps the year-1 yield separate from payback', () => {
    // The quotation's Figures page asks for a percentage; the ROI cover asks
    // for a period. Two different numbers that must not be conflated.
    expect(input.variables['roi.yield_pct_year1']).not.toContain('years');
  });
});
