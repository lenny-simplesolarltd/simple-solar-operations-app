// Server-render smoke tests: every step renders from realistic state without
// throwing, and shows the strings, gates and banners it should. (No DOM
// library is installed, so interaction is covered at the reducer level in
// designer/__tests__/mutations.test.ts and lib/__tests__/submission.test.ts.)

import { type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type JobSoldResult } from '../../contract';
import { computePerformance, computePricing } from '../../designer/calc';
import {
  fixtureComplexOnly,
  fixtureKitchenSink,
  fixtureSimple,
  fixtureUnfinished
} from '../../designer/calc/__tests__/fixtures';
import { panelById } from '../../designer/catalogue';
import { selectPanel } from '../../designer/mutations';
import { defaultDesignState } from '../../designer/types';
import { createDraft } from '../../lib/draft';
import { resolveSale, type SalesContext } from '../../lib/submission';
import { emptyCustomer } from '../../lib/validation';
import { JobSoldScreen } from '../job-sold-screen';
import { CustomerStep } from '../steps/customer-step';
import { ElevationsStep } from '../steps/elevations-step';
import { LayoutStep } from '../steps/layout-step';
import { ObstructionsStep } from '../steps/obstructions-step';
import { PanelsStep } from '../steps/panels-step';
import { ParametersStep } from '../steps/parameters-step';
import { PerformanceStep } from '../steps/performance-step';
import { PriceStep } from '../steps/price-step';
import { SaleStep } from '../steps/sale-step';
import { Stepper } from '../stepper';

const nav = { go: () => {} };
const update = () => {};
const customer = emptyCustomer();

/** Markup with entities decoded, so assertions can use the on-screen text. */
function html(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<');
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('stepper', () => {
  it('renders all nine steps in one row, locking the ones not reached yet', () => {
    const out = html(
      <Stepper current='elevations' maxStep={3} onSelect={() => {}} />
    );
    expect(count(out, '<button')).toBe(9);
    expect(count(out, 'disabled=""')).toBe(5);
    expect(out).toContain('aria-current="step"');
    expect(out).toMatch(
      /class="step done reachable"[^>]*><span class="n">1<\/span>Customer/
    );
    expect(out).toMatch(
      /class="step current reachable"[^>]*><span class="n">3<\/span>Elevations/
    );
    expect(out).toMatch(/<span class="n">9<\/span>Sale & submit/);
  });
});

describe('customer step', () => {
  it('flags required fields and gates Next', () => {
    const out = html(
      <CustomerStep
        customer={customer}
        design={defaultDesignState()}
        onChange={() => {}}
        nav={nav}
        errorField={null}
      />
    );
    expect(count(out, 'required=""')).toBe(7); // 5 address/name fields + phone + email while both blank
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Next: parameters →/);
    expect(out).toContain('Fill in every highlighted field above to continue.');
  });

  it('highlights the field the server rejected', () => {
    const out = html(
      <CustomerStep
        customer={{ ...customer, postcode: 'LS1 4AP' }}
        design={defaultDesignState()}
        onChange={() => {}}
        nav={nav}
        errorField='postcode'
      />
    );
    expect(out).toContain('class="field-error"');
  });
});

describe('designer steps', () => {
  it('Parameters: prototype labels, defaults, and step names instead of page numbers', () => {
    const out = html(
      <ParametersStep
        design={defaultDesignState()}
        update={update}
        nav={nav}
        customer={customer}
      />
    );
    [
      'Gap between panels (mm)',
      'Ridge / top clearance (mm)',
      'Metres (minimum 8)',
      'Consumer unit → inverter (m)',
      'SEG export rate (p/kWh)'
    ].forEach((label) => expect(out).toContain(label));
    expect(out).toContain('value="27.49"');
    expect(out).toContain('Primary Elevation');
    expect(out).not.toMatch(/page \d/);
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Next: elevations →/);

    const none = html(
      <ParametersStep
        design={{ ...defaultDesignState(), slopes: [] }}
        update={update}
        nav={nav}
        customer={customer}
      />
    );
    expect(none).toContain('Add a roof slope on the Elevations step first.');
  });

  it('Parameters: warns under a 200mm ridge clearance', () => {
    const d = defaultDesignState();
    d.params.ridgeMm = 150;
    expect(
      html(
        <ParametersStep
          design={d}
          update={update}
          nav={nav}
          customer={customer}
        />
      )
    ).toContain('Below the usual 200mm minimum');
  });

  it('Elevations: three tabs, confirm states, labelled − / + buttons, dynamic Next', () => {
    const blank = html(
      <ElevationsStep
        design={defaultDesignState()}
        update={update}
        nav={nav}
        customer={customer}
      />
    );
    expect(blank).toContain('Enter X and Y above to continue.');
    expect(blank).toContain('aria-label="Decrease X (m)"');
    expect(blank).toContain('aria-label="Increase Radiance (kWh/m²/yr)"');
    expect(blank).toContain(
      'Confirm every roof elevation with "Use these values" to continue.'
    );
    expect(blank).toMatch(/disabled=""[^>]*>Next: panels →/);

    const confirmed = html(
      <ElevationsStep
        design={fixtureSimple()}
        update={update}
        nav={nav}
        customer={customer}
      />
    );
    expect(confirmed).toContain('Values confirmed');
    expect(confirmed).toContain('class="slope-card card confirmed"');
    expect(confirmed).toMatch(
      /<button type="button" class="btn btn-primary">Next: obstructions →/
    );

    const mixed = html(
      <ElevationsStep
        design={fixtureUnfinished()}
        update={update}
        nav={nav}
        customer={customer}
      />
    );
    expect(mixed).toContain('Calculated Roof Slope');
    expect(mixed).toContain('Use Calculated Value');
    expect(mixed).toContain('5.20'); // 4.15 / cos(37°)

    const complex = html(
      <ElevationsStep
        design={fixtureComplexOnly()}
        update={update}
        nav={nav}
        customer={customer}
      />
    );
    expect(complex).toContain('Max panels — SunPower M Class');
    expect(complex).toMatch(/>Next: panels →/);
  });

  it('Obstructions: drawings for rectangles, a plain note for Complex, and an accurate hint', () => {
    const out = html(
      <ObstructionsStep
        design={fixtureKitchenSink()}
        update={update}
        nav={nav}
      />
    );
    expect(count(out, 'class="grid-svg obstruction-svg"')).toBe(2);
    expect(out).toContain('Second Elevation — Obstructions Not Required');
    expect(out).toContain('Obstruction 1 — 650 × 800mm');
    expect(out).toContain('aria-label="Remove obstruction 2"');
    expect(out).toContain('9.35 m');
    expect(out).toContain('the Layout step shows them but cannot change them');
    expect(out).not.toContain('later from the layout page');
  });

  it('Panels: both cards, the BEST flag, the per-slope breakdown and trim hints', () => {
    const out = html(
      <PanelsStep
        design={fixtureKitchenSink()}
        nav={nav}
        onSelectPanel={() => {}}
      />
    );
    expect(out).toContain('SunPower M Class 475W - Advanced Performance');
    expect(out).toContain('(30 Years Warranty)');
    expect(out).toContain('1.134 m × 1.996 m');
    expect(count(out, ' best')).toBe(1);
    expect(out).toContain('Primary Elevation: ');
    expect(out).toContain('class="panel-card selected');
  });

  it('Layout: grids with hatched auto-exclusions, tapped-out panels, and the Complex cell builder', () => {
    const d = fixtureKitchenSink();
    const out = html(
      <LayoutStep
        design={d}
        update={update}
        nav={nav}
        panel={panelById('p7-510')!}
      />
    );
    expect(out).toContain('class="panel-rect auto-excluded"');
    expect(out).toContain('class="panel-rect excluded"');
    expect(out).toContain('Shift array ←→');
    expect(out).toContain('Panels in this layout');
    expect(out).toContain('4 / 6');
    expect(count(out, 'class="cx-panel"')).toBe(4);
    expect(count(out, 'class="cx-add"')).toBe(8);
    expect(out).toContain('Obstruction 2 — 300 × 300mm');
    expect(out).not.toContain('aria-label="Remove obstruction'); // read-only here
    expect(out).toContain('SunPower P7 510 W');
  });

  it('Layout: says so when nothing fits or no count was entered', () => {
    const d = selectPanel(fixtureUnfinished(), 'p7-510');
    const out = html(
      <LayoutStep
        design={d}
        update={update}
        nav={nav}
        panel={panelById('p7-510')!}
      />
    );
    expect(out).toContain(
      'Nothing fits with the current dimensions / clearances'
    );
    const complex = html(
      <LayoutStep
        design={fixtureComplexOnly()}
        update={update}
        nav={nav}
        panel={panelById('mclass-475')!}
      />
    );
    expect(complex).toContain('Enter a max panel count for SunPower M Class');
  });

  it('Price: grouped inverters, priced options, banners, the full breakdown and deposits', () => {
    const d = fixtureKitchenSink();
    const out = html(
      <PriceStep
        design={d}
        update={update}
        nav={nav}
        pricing={computePricing(d)}
        customer={customer}
      />
    );
    expect(out.indexOf('label="Battery - single phase"')).toBeLessThan(
      out.indexOf('label="Sigenergy (all-in-one)"')
    );
    expect(out).toContain('FoxESS KH10 — £1100.00 (max 14.99kWp)');
    expect(out).toContain('Zappi (three phase) — £1499.99');
    expect(out).toContain('Yes — £55.00 each');
    expect(out).toContain('Capacity check skipped');
    expect(out).toContain('Panels are selected on more than one roof face');
    expect(out).toContain('Panels, hooks & rail (fixed)');
    expect(out).toContain('−£0.00');
    expect(out).toContain('Balance on completion (40%)');
    expect(out).toMatch(
      /<button type="button" class="btn btn-primary">Next: performance →/
    );

    const unfinished = fixtureUnfinished();
    const gated = html(
      <PriceStep
        design={unfinished}
        update={update}
        nav={nav}
        pricing={computePricing(unfinished)}
        customer={customer}
      />
    );
    expect(gated).toContain('1 of 2 still say "Select inverter…"');
    expect(gated).toMatch(/disabled=""[^>]*>Next: performance →/);

    const noPanel = html(
      <PriceStep
        design={defaultDesignState()}
        update={update}
        nav={nav}
        pricing={null}
        customer={customer}
      />
    );
    expect(noPanel).toContain('Choose a panel type on the Panels step first.');
  });

  it('Performance: figures, assumptions footnote and warnings', () => {
    const out = html(
      <PerformanceStep perf={computePerformance(fixtureSimple())} nav={nav} />
    );
    expect(out).toContain('5,830');
    expect(out).toContain('Year 1 ROI on Solar & Battery (%)');
    expect(out).toContain(
      '0.25%/year panel degradation (SunPower M Class 475 W), performance ratio 0.85'
    );
    expect(out).toContain(
      'more than the customer’s stated annual consumption (4,000 kWh)'
    );
    expect(out).toContain('Next: sale & submit →');
    expect(
      html(
        <PerformanceStep
          perf={computePerformance(fixtureComplexOnly())}
          nav={nav}
        />
      )
    ).toContain('have no Radiance value entered');
    expect(html(<PerformanceStep perf={null} nav={nav} />)).toContain(
      'Choose a panel type on the Panels tab first.'
    );
  });
});

describe('sale step', () => {
  const people = [
    { id: 'p1', displayName: 'Sam Surveyor' },
    { id: 'p2', displayName: 'Pat Surveyor' }
  ];
  const render = (
    ctx: SalesContext,
    tweak?: (d: ReturnType<typeof createDraft>) => void,
    extra?: { submitting?: boolean; error?: string }
  ) => {
    const draft = createDraft();
    draft.design = fixtureSimple();
    draft.customer = {
      ...customer,
      firstName: 'Jo',
      lastName: 'Bloggs',
      addressLine1: '1 High St',
      town: 'Leeds',
      postcode: 'LS1 4AP',
      phone: '0113'
    };
    if (tweak) tweak(draft);
    const pricing = computePricing(draft.design);
    return html(
      <SaleStep
        draft={draft}
        pricing={pricing}
        resolved={resolveSale(draft, pricing, ctx)}
        ctx={ctx}
        currentUserName='Sam Surveyor'
        onSaleChange={() => {}}
        onScopeChange={() => {}}
        onSubmit={() => {}}
        submitting={extra?.submitting ?? false}
        error={extra?.error ?? null}
        errorField={null}
        nav={nav}
      />
    );
  };

  it('locks a surveyor to themselves, pre-fills the price and pre-selects No finance', () => {
    const out = render({
      currentUserId: 'p1',
      salespeople: people,
      canSubmitOnBehalf: false
    });
    expect(out).toContain('class="readonly-field"');
    expect(out).not.toContain('Select salesperson…');
    expect(out).toContain('value="11122.14"');
    expect(out).toMatch(/class="active" aria-pressed="true">No finance/);
    expect(out).toContain('Jo Bloggs');
    expect(out).toContain('7.60 kWp');
    expect(out).toContain('>Submit sale<');
  });

  it('gives the office a salesperson list', () => {
    const out = render({
      currentUserId: 'office',
      salespeople: people,
      canSubmitOnBehalf: true
    });
    expect(out).toContain('Select salesperson…');
    expect(out).toContain('Pat Surveyor');
  });

  it('leaves the route unset when the design uses finance, and warns on a mismatch or a changed price', () => {
    const ctx = {
      currentUserId: 'p1',
      salespeople: people,
      canSubmitOnBehalf: false
    };
    const unset = render(ctx, (d) => {
      d.design.pricing.finance = 'Yes';
    });
    expect(unset).toContain('toggle-pair three unset');
    expect(unset).not.toContain('aria-pressed="true">No finance');

    const mismatch = render(ctx, (d) => {
      d.design.pricing.finance = 'Yes';
      d.sale.financeRoute = 'Standard';
      d.sale.agreedPrice = '10,000';
    });
    expect(mismatch).toContain('a finance admin fee is in the price');
    expect(mismatch).toContain('below the designer’s total');
    expect(mismatch).toContain('£10,000.00');
  });

  it('shows the pending state and the last failure', () => {
    const ctx = {
      currentUserId: 'p1',
      salespeople: people,
      canSubmitOnBehalf: false
    };
    const out = render(ctx, undefined, {
      submitting: true,
      error: 'That quote reference is already in use.'
    });
    expect(out).toMatch(/disabled=""[^>]*>Submitting…/);
    expect(out).toContain('That quote reference is already in use.');
  });
});

describe('job sold screen', () => {
  const result: JobSoldResult = {
    job_id: 'j1',
    job_ref: 'SS-ABCD-1234',
    customer_id: 'c1',
    presale_id: 'ps1',
    workflow_stage: 'Sold',
    replay: false,
    customer: { display_name: 'Jo Bloggs', postcode: 'LS1 4AP' },
    tasks: [
      {
        code: 'T-020',
        title: 'Book survey',
        owner_name: 'Alex',
        backup_name: null,
        due_at: null,
        priority: 2
      },
      {
        code: 'T-010',
        title: 'Send welcome pack',
        owner_name: 'Robin',
        backup_name: 'Kim',
        due_at: '2026-01-15T09:30:00Z',
        priority: 1
      },
      {
        code: 'T-030',
        title: 'DNO application',
        owner_name: 'Robin',
        backup_name: null,
        due_at: '2026-07-01T16:00:00Z',
        priority: 3
      }
    ]
  };

  it('shows the reference, the customer and each task with owner, backup and UK-local due time', () => {
    const out = html(
      <JobSoldScreen result={result} onStartAnother={() => {}} />
    );
    expect(out).toContain('<h1>JOB SOLD</h1>');
    expect(out).toContain('SS-ABCD-1234');
    expect(out).toContain('Jo Bloggs · LS1 4AP');
    expect(out.indexOf('T-010')).toBeLessThan(out.indexOf('T-020'));
    expect(out).toContain('Owner: Robin (backup: Kim)');
    expect(out).toContain('Owner: Alex<');
    expect(out).toContain('No due date');
    expect(out).toMatch(/Thu,? 15 Jan 2026,? 09:30/); // GMT
    expect(out).toMatch(/Wed,? 1 Jul 2026,? 17:00/); // BST: 16:00Z is 17:00 in London
    expect(out).toContain('href="/dashboard/presales"');
    expect(out).toContain('Start another presale');
    expect(out).not.toContain('already been recorded');
  });

  it('notes a replayed sale', () => {
    const out = html(
      <JobSoldScreen
        result={{ ...result, replay: true }}
        onStartAnother={() => {}}
      />
    );
    expect(out).toContain(
      'This sale had already been recorded — showing the original result.'
    );
  });
});
