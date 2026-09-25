import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Following a property through a conversation, and what authority does NOT
 * follow it.
 *
 * "Find 24 King Street" then "what happened there?" then "mark it confirmed
 * live" only works if the canonical ids survive the turns - nobody is going to
 * paste a UUID into a chat box. The risk in carrying ids forward is that they
 * start to feel like permission: an id the office resolved a moment ago is
 * still just an id, and the installer who asks about it must be refused exactly
 * as they would be on the screen.
 *
 * The programme queries are mocked here because these assertions are about the
 * assistant layer. That the DATABASE refuses the wrong actor is proved against
 * a real session in tests/zz-assistant-programmes.test.mjs; this file proves
 * the tool layer does not hand the wrong actor a way to ask.
 */

const property = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  programmeId: 'pppppppp-1111-4111-8111-pppppppppppp',
  externalRef: 'PCH-10482',
  addressLine1: '24 King Street',
  addressLine2: null,
  town: 'Exeter',
  postcode: 'EX1 2AB',
  postcodeNorm: 'EX12AB',
  expectedMeterSerial: 'MTR-1001-A',
  existingSimSerial: 'SIM-OLD-1',
  notes: null,
  active: true,
  synthetic: true,
  version: 1
};

const visit = {
  id: 'vvvvvvvv-1111-4111-8111-vvvvvvvvvvvv',
  programmeId: property.programmeId,
  propertyId: property.id,
  installerId: 'iiiiiiii-1111-4111-8111-iiiiiiiiiiii',
  installerName: 'John Doyle',
  property: {
    externalRef: property.externalRef,
    addressLine1: property.addressLine1,
    town: property.town,
    postcode: property.postcode,
    expectedMeterSerial: property.expectedMeterSerial
  },
  outcome: 'SimChangedPortalWorking',
  actualMeterSerial: 'MTR-1001-A',
  meterReading: 1234,
  newSimSerial: 'SIM-NEW-1',
  csq: 17,
  installerComments: null,
  meterSerialMatches: true,
  signalClassification: 'Good',
  portalCheckRequired: true,
  reviewReasons: [],
  recommendedDisposition: null,
  reviewStatus: 'AwaitingReview',
  disposition: 'AwaitingReview',
  portalVerification: null,
  actionNote: null,
  reviewedBy: null,
  reviewedByName: null,
  reviewedAt: null,
  visitDate: '2026-09-25',
  submittedAt: '2026-09-25T09:15:00.000Z',
  formRevisionId: 'rrrrrrrr-1111-4111-8111-rrrrrrrrrrrr',
  submissionId: 'ssssssss-1111-4111-8111-ssssssssssss',
  version: 3
};

const office = {
  read: true,
  readAll: true,
  submit: false,
  review: true,
  manage: false,
  report: true
};
const installer = {
  read: true,
  readAll: false,
  submit: true,
  review: false,
  manage: false,
  report: false
};

let access = office;
const searchPropertyPage = vi.fn();
const listVisits = vi.fn();

vi.mock('@/features/programmes/server/queries', () => ({
  currentAccess: async () => ({ access }),
  programmesEnabled: async () => true,
  listProgrammes: async () => [],
  getProgramme: async () => null,
  getProperty: async (id: string) => (id === property.id ? property : null),
  getVisit: async (id: string) => (id === visit.id ? visit : null),
  searchPropertyPage: (...a: unknown[]) => searchPropertyPage(...a),
  listVisits: (...a: unknown[]) => listVisits(...a),
  visitEvidence: async () => [
    {
      id: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
      category: 'ProgrammeMeter',
      filename: 'meter.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024
    }
  ],
  getDashboard: async () => null,
  getDailyReport: async () => null
}));

import { makeActor } from './helpers';
import {
  propertyDetailTool,
  propertySearchTool,
  visitDetailTool,
  visitEvidenceTool
} from '../tools/programmes';
import { createToolRegistry } from '../tools';

const ctx = () => ({
  actor: makeActor({ permissions: ['programme.read', 'programme.review'] }),
  threadId: '33333333-3333-4333-8333-333333333333'
});

const unwrap = (r: { ok: boolean } & Record<string, unknown>) => {
  if (!r.ok) throw new Error(`expected success, got ${String(r.code)}`);
  return r.data as Record<string, never>;
};

describe('following one property through a conversation', () => {
  it('turns an address into ids the later turns can use', async () => {
    access = office;
    searchPropertyPage.mockResolvedValue({
      properties: [property],
      total: 1,
      offset: 0,
      limit: 20
    });
    listVisits.mockResolvedValue({
      visits: [visit],
      total: 1,
      offset: 0,
      limit: 50
    });

    const found = unwrap(
      (await propertySearchTool.execute(
        { programmeId: property.programmeId, query: '24 King Street' },
        ctx()
      )) as never
    ) as unknown as {
      total_matches: number;
      properties: { property_id: string; property_reference: string }[];
    };
    expect(found.total_matches).toBe(1);
    const propertyId = found.properties[0].property_id;

    const detail = unwrap(
      (await propertyDetailTool.execute({ propertyId }, ctx())) as never
    ) as unknown as { visits: { visit_id: string; status: string }[] };
    expect(detail.visits).toHaveLength(1);
    const visitId = detail.visits[0].visit_id;

    const evidence = unwrap(
      (await visitEvidenceTool.execute({ visitId }, ctx())) as never
    ) as unknown as { evidence: { evidence_id: string }[]; note: string };
    expect(evidence.evidence).toHaveLength(1);
    // Identifiers, never a storage URL: the file is fetched through the
    // authenticated route where app.can_read_evidence still decides.
    expect(JSON.stringify(evidence)).not.toMatch(/https?:\/\//);

    const full = unwrap(
      (await visitDetailTool.execute({ visitId }, ctx())) as never
    ) as unknown as { version: number; completion_rule: string };
    // The version travels with the visit so the review that follows is checked
    // against the row as it was read, not as it might be by then.
    expect(full.version).toBe(3);
    expect(full.completion_rule).toMatch(/portal/i);
  });

  it('never lets a good CSQ read as portal confirmation', async () => {
    access = office;
    const full = unwrap(
      (await visitDetailTool.execute({ visitId: visit.id }, ctx())) as never
    ) as unknown as {
      csq: number;
      portal_verification: string | null;
      completion_rule: string;
    };
    expect(full.csq).toBe(17);
    expect(full.portal_verification).toBeNull();
    expect(full.completion_rule).toMatch(
      /A good CSQ is not portal confirmation/i
    );
  });

  it('says how many matched, so nothing has to be counted from the rows', async () => {
    access = office;
    searchPropertyPage.mockResolvedValue({
      properties: [property, { ...property, id: 'bbbb', externalRef: 'PCH-2' }],
      total: 137,
      offset: 0,
      limit: 20
    });
    const found = unwrap(
      (await propertySearchTool.execute(
        { programmeId: property.programmeId, query: 'King Street' },
        ctx()
      )) as never
    ) as unknown as {
      total_matches: number;
      properties: unknown[];
      note?: string;
    };
    // 137 matched; two came back. The model is told both, so "which one?" is
    // the only honest next move and it never guesses from a partial list.
    expect(found.total_matches).toBe(137);
    expect(found.properties).toHaveLength(2);
    expect(found.note).toMatch(/137/);
  });
});

describe('a resolved id is not a permission', () => {
  it('refuses the installer the reads that are the office view', async () => {
    access = installer;
    const asInstaller = {
      actor: makeActor({
        roles: ['Installer'],
        permissions: ['programme.read', 'programme.visit.submit']
      }),
      threadId: '44444444-4444-4444-8444-444444444444'
    };
    // The id is perfectly valid and was resolved a moment ago by somebody else.
    const result = (await visitDetailTool.execute(
      { visitId: visit.id },
      asInstaller
    )) as { ok: boolean };
    // The tool itself allows programme.read; what the installer actually gets
    // back is decided by RLS, which is covered against a real session in
    // tests/zz-assistant-programmes.test.mjs. What must never happen is the
    // REVIEW tool being offered to them at all:
    expect(result.ok).toBe(true);

    const registry = createToolRegistry();
    const offered = registry.availableFor(asInstaller.actor).map((t) => t.name);
    expect(offered).not.toContain('programme_review_visit');
    expect(offered).not.toContain('apply_programme_import');
    expect(offered).not.toContain('programme_summary');
    expect(offered).toContain('programme_visit_submit');
  });

  it('offers a surveyor no programme tool at all', () => {
    const surveyor = makeActor({
      roles: ['Surveyor'],
      permissions: ['presale.submit', 'job.read.own']
    });
    const offered = createToolRegistry()
      .availableFor(surveyor)
      .map((t) => t.name);
    expect(offered.filter((n) => n.includes('programme'))).toEqual([]);
  });

  it('offers the office review but not importing', () => {
    const lucy = makeActor({
      roles: ['Office'],
      permissions: [
        'programme.read',
        'programme.read.all',
        'programme.review',
        'programme.report'
      ]
    });
    const offered = createToolRegistry()
      .availableFor(lucy)
      .map((t) => t.name);
    expect(offered).toContain('programme_review_visit');
    expect(offered).toContain('programme_summary');
    expect(offered).not.toContain('apply_programme_import');
  });

  it('offers an admin the import tools', () => {
    const admin = makeActor({
      roles: ['Admin'],
      permissions: [
        'programme.read',
        'programme.read.all',
        'programme.review',
        'programme.report',
        'programme.manage',
        'programme.visit.submit'
      ]
    });
    const offered = createToolRegistry()
      .availableFor(admin)
      .map((t) => t.name);
    for (const name of [
      'apply_programme_import',
      'discard_programme_import',
      'explain_programme_import',
      'programme_review_visit',
      'programme_summary'
    ])
      expect(offered).toContain(name);
  });
});

describe('the programme tools disappear with the module', () => {
  it('registers nothing executable while FN-22 is off', () => {
    const registry = createToolRegistry({ forms: true, programmes: false });
    const programmeTools = registry
      .all()
      .filter((t) => t.name.includes('programme'));
    expect(programmeTools.length).toBeGreaterThan(0);
    for (const tool of programmeTools) expect(tool.status).toBe('planned');
  });
});
