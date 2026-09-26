import { describe, expect, it } from 'vitest';
import { renderProgrammeReport } from '../report-email';
import type { DailyReport } from '../types';

/**
 * What must be true of a report that leaves the building: it says what the
 * canonical report said, it does not quietly equate attended with complete,
 * and it carries nothing about the people who live there.
 */
const line = (over: Partial<DailyReport['lines'][number]> = {}) =>
  ({
    external_ref: '',
    address: '9 Northampton Close, Plymouth',
    postcode: 'PL5 4JT',
    installer: 'Gary Field',
    outcome: 'SimChangedPortalWorking',
    expected_meter_serial: 'EML1409032559',
    actual_meter_serial: 'EML1409032559',
    meter_serial_matches: true,
    meter_reading: 32992,
    new_sim_serial: '8988228066620375076',
    csq: 18,
    signal_classification: 'Good',
    portal_verification: 'ConfirmedLive',
    disposition: 'CompleteAndWorking',
    review_status: 'Reviewed',
    comments: null,
    ...over
  }) as DailyReport['lines'][number];

const report = (over: Partial<DailyReport> = {}): DailyReport =>
  ({
    programme: {
      id: 'p',
      code: 'PCH-SIM-2026',
      name: 'PCH Meter SIM Replacement 2026',
      client_name: 'PCH'
    },
    date: '2026-09-25',
    properties_attended: 3,
    visits: 3,
    sims_swapped: 2,
    no_access: 1,
    meters_requiring_replacement: 0,
    action_required: 0,
    complete_and_live: 1,
    awaiting_review: 2,
    awaiting_portal_confirmation: 1,
    portal_confirmed_live: 1,
    portal_not_live: 0,
    portal_unable_to_verify: 0,
    serial_mismatches: 0,
    lines: [line()],
    ...over
  }) as DailyReport;

const progress = {
  target: 1400,
  properties: 1468,
  attended: 120,
  complete_and_live: 96
};

const render = (
  over: Partial<Parameters<typeof renderProgrammeReport>[0]> = {}
) =>
  renderProgrammeReport({
    reportType: 'Daily',
    report: report(),
    progress,
    programmeUrl: 'https://app.example.com/dashboard/operations/programmes/p',
    ...over
  });

describe('the report says where the programme stands', () => {
  it('states progress against the target without inventing one', () => {
    const out = render();
    expect(out.html).toContain('96 of 1,400 complete and live');
    expect(out.text).toContain('96 of 1,400 complete and live');
    expect(out.html).toContain('1,468 properties in the imported workload');
  });

  it('omits the target rather than guessing when there is none', () => {
    const out = render({ progress: { ...progress, target: null } });
    expect(out.text).toContain('96 complete and live');
    expect(out.text).not.toContain(' of ');
  });
});

describe('attended is never the same number as complete', () => {
  it('reports both, separately', () => {
    const out = render();
    expect(out.text).toContain('Properties attended: 3');
    expect(out.text).toContain('Complete & working: 1');
  });

  it('shows every outcome category the office distinguishes', () => {
    const out = render();
    for (const label of [
      'SIMs changed',
      'No access',
      'Action required',
      'Meter requires changing',
      'Complete & working',
      'Portal confirmed live'
    ])
      expect(out.text).toContain(label);
  });

  it('says so in as many words', () => {
    expect(render().text.toLowerCase()).toContain(
      'attended does not mean complete'
    );
  });
});

describe('what must never leave', () => {
  it('carries no evidence link or storage path', () => {
    const out = render();
    for (const forbidden of ['storage/v1', 'evidence', 'signed', 'token='])
      expect(out.html.toLowerCase()).not.toContain(forbidden);
  });

  it('carries only the one app link it was given', () => {
    const out = render();
    const links = out.html.match(/https?:\/\/[^"']+/g) ?? [];
    expect(links).toEqual([
      'https://app.example.com/dashboard/operations/programmes/p'
    ]);
  });

  it('escapes anything that came from a person typing', () => {
    const out = render({
      report: report({
        lines: [line({ address: '<script>alert(1)</script> Mill Lane' })]
      })
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});

describe('the shapes a real day takes', () => {
  it('says plainly when nothing happened', () => {
    const out = render({
      report: report({
        properties_attended: 0,
        visits: 0,
        sims_swapped: 0,
        no_access: 0,
        complete_and_live: 0,
        awaiting_review: 0,
        portal_confirmed_live: 0,
        lines: []
      })
    });
    expect(out.text).toContain('No visits were recorded in this period.');
    expect(out.html).toContain('No visits were recorded in this period.');
  });

  it('renders a 200-visit day without losing a row', () => {
    const lines = Array.from({ length: 200 }, (_, i) =>
      line({ address: `${i + 1} Test Street` })
    );
    const out = render({
      report: report({ properties_attended: 200, visits: 200, lines })
    });
    expect(out.text).toContain('PROPERTIES ATTENDED (200)');
    expect(out.html).toContain('Properties attended (200)');
    expect(out.text).toContain('200 Test Street');
  });

  it('flags a serial mismatch where the canonical report found one', () => {
    const out = render({
      report: report({
        serial_mismatches: 1,
        lines: [
          line({ actual_meter_serial: 'EML9999', meter_serial_matches: false })
        ]
      })
    });
    expect(out.html).toContain('serial mismatch');
    expect(out.text).toContain('(serial mismatch)');
  });

  it('shows a no-access visit as attended but not complete', () => {
    const out = render({
      report: report({
        properties_attended: 1,
        no_access: 1,
        complete_and_live: 0,
        lines: [
          line({
            outcome: 'TenantNotHome',
            disposition: 'NoAccessRebook',
            actual_meter_serial: null,
            csq: null,
            portal_verification: null
          })
        ]
      })
    });
    expect(out.text).toContain('Properties attended: 1');
    expect(out.text).toContain('Complete & working: 0');
  });
});

describe('the weekly report is the same report over a range', () => {
  it('names the period and keeps every metric', () => {
    const out = render({
      reportType: 'Weekly',
      report: report({ from: '2026-09-14', to: '2026-09-20' })
    });
    expect(out.subject).toContain('weekly report');
    expect(out.subject).toContain('Mon 14 Sep 2026 to Sun 20 Sep 2026');
    expect(out.text).toContain("THAT WEEK'S ACTIVITY");
    expect(out.text).toContain('SIMs changed: 2');
  });
});
