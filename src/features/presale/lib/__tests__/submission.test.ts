import { describe, expect, it } from 'vitest';

import { computePricing } from '../../designer/calc';
import {
  fixtureKitchenSink,
  fixtureSimple
} from '../../designer/calc/__tests__/fixtures';
import { CATALOGUE_VERSION } from '../../designer/catalogue';
import { createDraft, reviveDraft, type PresaleDraft } from '../draft';
import { firstBlocker, MSG_CONFIRM_ELEVATIONS, stepBlocker } from '../steps';
import {
  buildSubmission,
  fieldLeaf,
  resolveSale,
  stepForServerField,
  type SalesContext
} from '../submission';

const SURVEYOR: SalesContext = {
  currentUserId: 'person-1',
  salespeople: [
    { id: 'person-1', displayName: 'Sam Surveyor' },
    { id: 'person-2', displayName: 'Pat Surveyor' }
  ],
  canSubmitOnBehalf: false
};
const OFFICE: SalesContext = {
  ...SURVEYOR,
  currentUserId: 'office-9',
  canSubmitOnBehalf: true
};

function completeDraft(): PresaleDraft {
  const draft = createDraft();
  draft.design = fixtureSimple();
  draft.customer = {
    firstName: ' Jo ',
    lastName: 'Bloggs',
    addressLine1: '1 High Street',
    addressLine2: ' ',
    town: 'Leeds',
    postcode: 'ls14ap',
    phone: '',
    email: ' Jo@Example.com '
  };
  draft.step = 'sale';
  draft.maxStep = 8;
  return draft;
}

describe('buildSubmission', () => {
  it('builds a normalised, fully-populated submission', () => {
    const draft = completeDraft();
    const built = buildSubmission(draft, SURVEYOR);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const s = built.submission;
    expect(s.customer).toEqual({
      first_name: 'Jo',
      last_name: 'Bloggs',
      address_line1: '1 High Street',
      address_line2: null,
      town: 'Leeds',
      postcode: 'LS1 4AP',
      phone: null,
      email: 'jo@example.com'
    });
    const pricing = computePricing(draft.design)!;
    expect(s.sale).toEqual({
      salesperson_id: 'person-1',
      lead_source: null,
      quote_reference: null,
      finance_route: 'Standard',
      agreed_price_pence: Math.round(pricing.total * 100)
    });
    expect(s.scope).toEqual({
      roof_required: true,
      electrical_required: true,
      scaffold_required: true,
      roof_notes: null,
      electrical_notes: null
    });
    expect(s.design_schema_version).toBe(1);
    expect(s.catalogue_version).toBe(CATALOGUE_VERSION);
    expect(s.design).toEqual(JSON.parse(JSON.stringify(draft.design)));
    expect(s.design).not.toBe(draft.design);
  });

  it('snapshots the Total card in order, as integer pence', () => {
    const draft = completeDraft();
    draft.design = fixtureKitchenSink();
    draft.sale.financeRoute = 'Phoenix';
    const built = buildSubmission(draft, SURVEYOR);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { computed } = built.submission;
    const pricing = computePricing(draft.design)!;
    expect(computed.price_breakdown.map((r) => r.key)).toEqual([
      'panels_mounting',
      'inverter_battery',
      'extras',
      'finance_admin_fee',
      'fixed_panels_hooks_rail',
      'equipment_subtotal',
      'scaffold',
      'labour',
      'fixed_admin_warranties',
      'installation_subtotal',
      'adjustments',
      'subtotal',
      'discount',
      'delivery_waste',
      'vat',
      'total'
    ]);
    computed.price_breakdown.forEach((row) => {
      expect(Number.isInteger(row.pence), row.key).toBe(true);
      expect(Object.is(row.pence, -0), row.key).toBe(false);
    });
    const byKey = (key: string) =>
      computed.price_breakdown.find((r) => r.key === key)!.pence;
    expect(byKey('total')).toBe(computed.computed_total_pence);
    expect(byKey('finance_admin_fee')).toBe(25000);
    expect(byKey('fixed_panels_hooks_rail')).toBe(35000);
    expect(byKey('fixed_admin_warranties')).toBe(48000);
    expect(byKey('adjustments')).toBe(-18100);
    expect(byKey('delivery_waste')).toBe(60000);
    expect(computed.computed_total_pence).toBe(Math.round(pricing.total * 100));
    expect(computed.net_panels).toBe(pricing.totalNetPanels);
    expect(computed.system_kwp).toBe(Math.round(pricing.totalKwp * 100) / 100);
    expect(byKey('labour')).toBe(Math.round(pricing.labourSubtotal * 100));
    expect(
      computed.price_breakdown.find((r) => r.key === 'labour')!.label
    ).toBe(`Labour (${pricing.labourDays} days)`);
  });

  it('sends the surveyor-overridden price, parsed to pence', () => {
    const draft = completeDraft();
    draft.sale.agreedPrice = '£11,999.99';
    const built = buildSubmission(draft, SURVEYOR);
    expect(built.ok && built.submission.sale.agreed_price_pence).toBe(1199999);
  });

  it.each(['', '0', '12.345', 'twelve grand'])(
    'refuses the agreed price %j',
    (agreedPrice) => {
      const draft = completeDraft();
      draft.sale.agreedPrice = agreedPrice;
      const built = buildSubmission(draft, SURVEYOR);
      expect(built.ok).toBe(false);
      if (!built.ok)
        expect(built.problem).toMatchObject({
          step: 'sale',
          field: 'agreed_price_pence'
        });
    }
  );

  it('makes the surveyor choose a finance route when the design uses finance', () => {
    const draft = completeDraft();
    draft.design.pricing.finance = 'Maybe';
    const built = buildSubmission(draft, SURVEYOR);
    expect(built.ok).toBe(false);
    if (!built.ok)
      expect(built.problem).toMatchObject({
        step: 'sale',
        field: 'finance_route'
      });
  });

  it('sends the surveyor back to the first unfinished step', () => {
    const draft = completeDraft();
    draft.design.slopes[0].confirmed = false;
    const built = buildSubmission(draft, SURVEYOR);
    expect(built.ok).toBe(false);
    if (!built.ok)
      expect(built.problem).toEqual({
        step: 'elevations',
        message: MSG_CONFIRM_ELEVATIONS
      });

    draft.customer.postcode = 'nope';
    const again = buildSubmission(draft, SURVEYOR);
    expect(!again.ok && again.problem.step).toBe('customer');
  });

  it('applies scope overrides', () => {
    const draft = completeDraft();
    draft.scope = {
      roofRequired: false,
      electricalRequired: false,
      scaffoldRequired: false,
      roofNotes: ' Fragile slate ',
      electricalNotes: ''
    };
    const built = buildSubmission(draft, SURVEYOR);
    expect(built.ok && built.submission.scope).toEqual({
      roof_required: false,
      electrical_required: false,
      scaffold_required: false,
      roof_notes: 'Fragile slate',
      electrical_notes: null
    });
  });
});

describe('resolveSale', () => {
  it('locks a surveyor to themselves whatever the draft says', () => {
    const draft = completeDraft();
    draft.sale.salespersonId = 'person-2';
    expect(resolveSale(draft, null, SURVEYOR).salespersonId).toBe('person-1');
  });

  it('lets the office pick, defaulting to nobody when they are not a salesperson', () => {
    const draft = completeDraft();
    expect(resolveSale(draft, null, OFFICE).salespersonId).toBe('');
    draft.sale.salespersonId = 'person-2';
    expect(resolveSale(draft, null, OFFICE).salespersonId).toBe('person-2');
    draft.sale.salespersonId = 'someone-who-left';
    expect(resolveSale(draft, null, OFFICE).salespersonId).toBe('');
    expect(
      resolveSale(draft, null, { ...OFFICE, currentUserId: 'person-1' })
        .salespersonId
    ).toBe('person-1');
  });

  it('pre-selects Standard only when the design has no finance', () => {
    const draft = completeDraft();
    expect(resolveSale(draft, null, SURVEYOR).financeRoute).toBe('Standard');
    draft.design.pricing.finance = 'Yes';
    expect(resolveSale(draft, null, SURVEYOR).financeRoute).toBeNull();
  });

  it('warns when the route and the design disagree, either way round', () => {
    const draft = completeDraft();
    draft.sale.financeRoute = 'Phoenix';
    expect(resolveSale(draft, null, SURVEYOR).financeMismatch).toMatch(
      /set to No/
    );
    draft.design.pricing.finance = 'Maybe';
    expect(resolveSale(draft, null, SURVEYOR).financeMismatch).toBeNull();
    draft.sale.financeRoute = 'Standard';
    expect(resolveSale(draft, null, SURVEYOR).financeMismatch).toMatch(
      /finance admin fee/
    );
  });

  it('follows the computed total until the surveyor types a price', () => {
    const draft = completeDraft();
    const pricing = computePricing(draft.design)!;
    const followed = resolveSale(draft, pricing, SURVEYOR);
    expect(followed.agreedPriceText).toBe(pricing.total.toFixed(2));
    expect(followed.agreedPricePence).toBe(followed.computedTotalPence);
    draft.sale.agreedPrice = '10000';
    expect(resolveSale(draft, pricing, SURVEYOR).agreedPricePence).toBe(
      1000000
    );
  });

  it('derives scope from the design', () => {
    const draft = completeDraft();
    draft.design.pricing.scaffoldM = 0;
    const r = resolveSale(draft, computePricing(draft.design), SURVEYOR);
    expect([r.roofRequired, r.electricalRequired, r.scaffoldRequired]).toEqual([
      true,
      true,
      false
    ]);
  });
});

describe('gating', () => {
  it('closes the stepper loophole: a jump cannot leap an unconfirmed elevation', () => {
    const draft = completeDraft();
    expect(firstBlocker(draft, 'parameters', 'sale')).toBeNull();
    draft.design.slopes[0].confirmed = false;
    expect(firstBlocker(draft, 'parameters', 'sale')).toEqual({
      step: 'elevations',
      message: MSG_CONFIRM_ELEVATIONS
    });
    expect(firstBlocker(draft, 'parameters', 'elevations')).toBeNull();
    expect(firstBlocker(draft, 'sale', 'customer')).toBeNull();
  });

  it('blocks an elevation left on the Slope Calculator tab, and blank required fields', () => {
    const draft = completeDraft();
    draft.design.slopes[0].shapeMode = 'calc';
    expect(stepBlocker('elevations', draft)).toBe(MSG_CONFIRM_ELEVATIONS);
    draft.design.slopes[0].shapeMode = 'rect';
    draft.design.slopes[0].radiance = '';
    expect(stepBlocker('elevations', draft)).toMatch(/highlighted/);
    draft.design.slopes = [];
    expect(stepBlocker('elevations', draft)).toBe(MSG_CONFIRM_ELEVATIONS);
  });

  it('needs only one Complex max-panel count', () => {
    const draft = completeDraft();
    Object.assign(draft.design.slopes[0], {
      shapeMode: 'complex',
      maxPanelsP7: '',
      maxPanelsMClass: 9
    });
    expect(stepBlocker('elevations', draft)).toBeNull();
    draft.design.slopes[0].maxPanelsMClass = '';
    expect(stepBlocker('elevations', draft)).toMatch(/highlighted/);
  });

  it('gates Parameters on the AC run and annual consumption, Price on every inverter line', () => {
    const draft = completeDraft();
    draft.design.pricing.extras.acRunM = '';
    expect(stepBlocker('parameters', draft)).not.toBeNull();
    draft.design.pricing.extras.acRunM = 0;
    expect(stepBlocker('parameters', draft)).toBeNull();
    draft.design.pricing.inverterLines.push({ id: 'l9', modelId: '', qty: 1 });
    expect(stepBlocker('price', draft)).not.toBeNull();
    draft.design.pricing.inverterLines = [];
    expect(stepBlocker('price', draft)).toBeNull();
  });
});

describe('server field routing', () => {
  it.each([
    ['customer.postcode', 'customer', 'postcode'],
    ['postcode', 'customer', 'postcode'],
    ['sale.agreed_price_pence', 'sale', 'agreed_price_pence'],
    ['finance_route', 'sale', 'finance_route'],
    ['scope.roof_notes', 'sale', 'roof_notes'],
    ['computed.computed_total_pence', 'price', 'computed_total_pence'],
    ['design', 'price', 'design']
  ])('%s -> %s step', (field, step, leaf) => {
    expect(stepForServerField(field)).toBe(step);
    expect(fieldLeaf(field)).toBe(leaf);
  });
  it('shrugs at unknown fields', () => {
    expect(stepForServerField('mystery')).toBeNull();
    expect(fieldLeaf(undefined)).toBeNull();
  });
});

describe('drafts', () => {
  it('mints a UUID command id per draft', () => {
    const a = createDraft();
    const b = createDraft();
    expect(a.commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(a.commandId).not.toBe(b.commandId);
  });

  it('round-trips through JSON keeping the command id', () => {
    const draft = completeDraft();
    const revived = reviveDraft(JSON.parse(JSON.stringify(draft)));
    expect(revived).toEqual(draft);
  });

  it('backfills fields a stored draft is missing, and rejects junk', () => {
    const stored = JSON.parse(JSON.stringify(completeDraft()));
    delete stored.design.pricing.extras.pvultra;
    delete stored.design.complexLayouts;
    delete stored.scope;
    stored.maxStep = 99;
    const revived = reviveDraft(stored)!;
    expect(revived.design.pricing.extras.pvultra).toBe('No');
    expect(revived.design.complexLayouts).toEqual({});
    expect(revived.scope.roofRequired).toBeNull();
    expect(revived.maxStep).toBe(8);
    expect(reviveDraft(null)).toBeNull();
    expect(reviveDraft({ version: 1 })).toBeNull();
    expect(reviveDraft({ ...stored, version: 2 })).toBeNull();
    expect(reviveDraft({ ...stored, commandId: '' })).toBeNull();
  });
});
