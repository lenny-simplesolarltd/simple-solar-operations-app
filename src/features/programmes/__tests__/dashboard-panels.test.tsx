import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));

import {
  DeliveryPanel,
  NeedsActionPanel,
  ProgressPanel
} from '../components/dashboard-panels';
import type { ProgrammeDashboard } from '../types';

/**
 * What the overview says before any property has been imported.
 *
 * PCH is contracted for about 1,400 properties and none have arrived. The panel
 * read "Target 0" and "0 of 0 attended (0%)", which says the programme is
 * complete and its target is nothing - the opposite of the truth, and the first
 * thing anyone sees on the screen.
 */
const dashboard = (
  over: Partial<ProgrammeDashboard> = {}
): ProgrammeDashboard =>
  ({
    programme: {
      id: 'p1',
      code: 'PCH-SIM-2026',
      name: 'PCH',
      status: 'Active',
      client_name: 'PCH',
      starts_on: null,
      ends_on: null,
      signal_config: {},
      synthetic: false
    },
    target_property_count: 1400,
    delivery_start_date: null,
    delivery_end_date: null,
    today: '2026-09-25',
    total_properties: 0,
    attended: 0,
    completed_properties: 0,
    remaining: 0,
    visits_total: 0,
    visits_today: 0,
    sims_changed: 0,
    no_access: 0,
    meter_dead: 0,
    awaiting_review: 0,
    action_required: 0,
    meter_replacements_required: 0,
    no_access_rebook: 0,
    complete_and_working: 0,
    serial_mismatches: 0,
    portal_confirmed_live: 0,
    portal_not_live: 0,
    portal_unable_to_verify: 0,
    portal_outstanding: 0,
    csq_bands: { good: 0, advisory: 0, bad: 0 },
    by_day: [],
    by_installer: [],
    ...over
  }) as unknown as ProgrammeDashboard;

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('DeliveryPanel before anything is imported', () => {
  it('never says the target is zero', () => {
    const out = html(<DeliveryPanel data={dashboard()} importHref='/import' />);
    expect(out).toContain('Programme target');
    expect(out).toContain('1,400');
    expect(out).not.toMatch(/Target<\/dt><dd[^>]*>0</);
  });

  it('separates the target from what has actually arrived', () => {
    const out = html(<DeliveryPanel data={dashboard()} importHref='/import' />);
    expect(out).toContain('Properties imported');
    expect(out).toContain('0 / 1,400');
    expect(out).toContain('Awaiting import');
  });

  it('offers the one action that unblocks the programme', () => {
    const out = html(<DeliveryPanel data={dashboard()} importHref='/import' />);
    expect(out).toContain('Import PCH property list');
    expect(out).toContain('href="/import"');
  });

  it('does not offer importing to somebody who may not import', () => {
    const out = html(<DeliveryPanel data={dashboard()} importHref={null} />);
    expect(out).toContain('No properties imported yet');
    expect(out).not.toContain('Import PCH property list');
  });

  it('says nothing about a target that has not been agreed', () => {
    const out = html(
      <DeliveryPanel
        data={dashboard({ target_property_count: null })}
        importHref='/import'
      />
    );
    expect(out).toContain('Not recorded');
    expect(out).not.toContain('/ 0');
  });
});

describe('DeliveryPanel once properties exist', () => {
  const live = dashboard({
    total_properties: 1200,
    attended: 900,
    completed_properties: 700
  });

  it('shows imported against target, and both remainders', () => {
    const out = html(<DeliveryPanel data={live} importHref='/import' />);
    expect(out).toContain('1,200 / 1,400');
    expect(out).toContain('Remaining of imported');
    expect(out).toContain('Remaining against target');
    // 1,400 target - 700 completed
    expect(out).toContain('700');
  });

  it('refuses to derive a daily rate from a date nobody agreed', () => {
    const out = html(<DeliveryPanel data={live} importHref={null} />);
    expect(out).toContain('No delivery window has been recorded');
    expect(out).not.toMatch(/completions a day/);
  });
});

describe('ProgressPanel', () => {
  it('shows nothing rather than "0 of 0 attended"', () => {
    expect(html(<ProgressPanel data={dashboard()} />)).toBe('');
  });

  it('appears once there is something to be a proportion of', () => {
    const out = html(
      <ProgressPanel data={dashboard({ total_properties: 10, attended: 4 })} />
    );
    expect(out).toContain('4 of 10 properties attended');
  });
});

describe('NeedsActionPanel', () => {
  const stuck = dashboard({
    awaiting_review: 3,
    action_required: 7,
    meter_replacements_required: 2,
    no_access_rebook: 5,
    portal_outstanding: 4
  });

  it('gathers the work that is actually stuck', () => {
    const out = html(<NeedsActionPanel data={stuck} basePath='/prog' />);
    for (const label of [
      'Awaiting review',
      'Action required',
      'Meter replacements',
      'No access',
      'Portal checks outstanding'
    ])
      expect(out).toContain(label);
    expect(out).toContain('21 outstanding');
  });

  it('links each count to the visits it is counting', () => {
    const out = html(<NeedsActionPanel data={stuck} basePath='/prog' />);
    expect(out).toContain('/prog/visits?disposition=ActionRequired');
    expect(out).toContain('/prog/visits?disposition=MeterRequiresChanging');
    expect(out).toContain('/prog/visits?disposition=NoAccessRebook');
  });

  it('does not link a count the list cannot actually filter for', () => {
    const out = html(<NeedsActionPanel data={stuck} basePath='/prog' />);
    // "Portal check required but not yet answered" is not a URL filter, so it
    // must not pretend to be one.
    expect(out).not.toContain('portal=');
  });

  it('says so plainly when there is nothing outstanding', () => {
    const out = html(<NeedsActionPanel data={dashboard()} basePath='/prog' />);
    expect(out).toContain('Nothing outstanding');
  });
});
