import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The panel's review controls use the router; this test is about what a
// reviewer READS, so the router is stubbed rather than exercised.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} })
}));

import { ReviewPanel } from '../components/review-panel';
import type { ProgrammeVisit } from '../types';

/**
 * The client's register and the installer's eyes are two different claims about
 * one meter cupboard. A reviewer deciding whether the right meter was found has
 * to be able to tell which is which, so these assert the labelling, not just
 * that the values appear somewhere on the page.
 */
const visit = (over: Partial<ProgrammeVisit> = {}): ProgrammeVisit =>
  ({
    id: 'c0ffee00-0000-4000-8000-000000000001',
    programmeId: 'c0ffee00-0000-4000-8000-000000000002',
    propertyId: 'c0ffee00-0000-4000-8000-000000000003',
    installerId: 'c0ffee00-0000-4000-8000-000000000004',
    installerName: 'Gary Field',
    property: {
      externalRef: '',
      addressLine1: '14 King Street',
      town: 'Plymouth',
      postcode: 'PL1 1AA',
      expectedMeterSerial: 'EML1409032559',
      existingSimType: 'Velos',
      existingSimSerial: '8944502106211700645'
    },
    actualMeterSerial: 'EML9999999999',
    meterReading: 1234,
    newSimSerial: '8988228066620375076',
    csq: 18,
    signalClassification: 'Good',
    meterSerialMatches: false,
    outcome: 'SimChangedPortalWorking',
    installerComments: null,
    reviewReasons: [],
    reviewStatus: 'AwaitingReview',
    disposition: 'AwaitingReview',
    portalVerification: null,
    portalCheckRequired: true,
    recommendedDisposition: null,
    actionNote: null,
    reviewedBy: null,
    reviewerName: null,
    reviewedAt: null,
    visitDate: '2026-09-25',
    submittedAt: null,
    formRevisionId: null,
    submissionId: null,
    synthetic: false,
    version: 1,
    ...over
  }) as unknown as ProgrammeVisit;

const panel = (v: ProgrammeVisit) =>
  renderToStaticMarkup(
    <ReviewPanel visit={v} evidence={[]} signalConfig={{}} canReview={false} />
  );

describe('the review screen keeps PCH baseline apart from what was found', () => {
  it('names the client as the source of the baseline', () => {
    const html = panel(visit());
    expect(html).toContain('what PCH gave us');
    expect(html).toContain('What the installer found');
  });

  it('shows the SIM the register listed and the SIM that was fitted, separately', () => {
    const html = panel(visit());
    expect(html).toContain('Existing SIM type');
    expect(html).toContain('Velos');
    expect(html).toContain('8944502106211700645');
    expect(html).toContain('New SIM serial');
    expect(html).toContain('8988228066620375076');
  });

  it('hides the client reference entirely when they never issued one', () => {
    expect(panel(visit())).not.toContain('PCH property ID');
  });

  it('shows it when they did', () => {
    const html = panel(
      visit({ property: { ...visit().property, externalRef: 'PCH-0142' } })
    );
    expect(html).toContain('PCH property ID');
    expect(html).toContain('PCH-0142');
  });

  it('says a value the register did not carry is not recorded, not blank', () => {
    const html = panel(
      visit({
        property: {
          ...visit().property,
          existingSimType: null,
          existingSimSerial: null
        }
      })
    );
    expect(html).toContain('Not recorded');
  });
});
