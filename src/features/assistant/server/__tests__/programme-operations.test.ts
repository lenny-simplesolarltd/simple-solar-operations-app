import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// The programme reads and the programme server actions are the module's own
// domain layer; here they are fakes, so the tests can see exactly what the
// tools ask of them - in particular which command id and which expected
// version reach the canonical commands.
const queries = vi.hoisted(() => ({
  getVisit: vi.fn(),
  getProperty: vi.fn(),
  visitForm: vi.fn()
}));
vi.mock('@/features/programmes/server/queries', () => queries);

const actions = vi.hoisted(() => ({
  reviewVisitAction: vi.fn(),
  startVisitAction: vi.fn(),
  submitVisitAction: vi.fn()
}));
vi.mock('@/features/programmes/server/actions', () => actions);

import type {
  ProgrammeProperty,
  ProgrammeVisit
} from '@/features/programmes/types';
import type { MutationContext, ToolContext } from '../registry';
import {
  reviewVisitTool,
  submitVisitTool,
  visitSubmitStatusTool
} from '../tools/programme-operations';
import { makeActor, THREAD } from './helpers';

const VISIT_ID = 'a1b2c3d4-1111-4111-8111-111111111111';
const PROGRAMME_ID = 'a1b2c3d4-2222-4222-8222-222222222222';
const PROPERTY_ID = 'a1b2c3d4-3333-4333-8333-333333333333';
const FORM_ID = 'a1b2c3d4-4444-4444-8444-444444444444';
const REVISION_ID = 'a1b2c3d4-5555-4555-8555-555555555555';
const EVIDENCE_ID = 'a1b2c3d4-6666-4666-8666-666666666666';
const COMMAND_ID = 'a1b2c3d4-7777-4777-8777-777777777777';

const ctx = (): ToolContext => ({ actor: makeActor(), threadId: THREAD });
const mutationCtx = (expectedVersion: number | null = 4): MutationContext => ({
  ...ctx(),
  commandId: COMMAND_ID,
  expectedVersion,
  initiatedVia: 'assistant'
});

const visit = (over: Partial<ProgrammeVisit> = {}): ProgrammeVisit => ({
  id: VISIT_ID,
  programmeId: PROGRAMME_ID,
  propertyId: PROPERTY_ID,
  installerId: 'a1b2c3d4-8888-4888-8888-888888888888',
  installerName: 'Gary Field',
  property: {
    externalRef: 'PCH-00412',
    addressLine1: '12 Mill Lane',
    town: 'Barnard Castle',
    postcode: 'DL12 8AB',
    expectedMeterSerial: 'M123456',
    existingSimType: 'Velos',
    existingSimSerial: '8944502106211700645'
  },
  outcome: 'SimChangedPortalWorking',
  actualMeterSerial: 'M123456',
  meterReading: 1234,
  newSimSerial: 'SIM99',
  csq: 18,
  installerComments: null,
  meterSerialMatches: true,
  signalClassification: 'Good',
  portalCheckRequired: true,
  reviewReasons: [],
  recommendedDisposition: 'CompleteAndWorking',
  reviewStatus: 'AwaitingReview',
  disposition: 'AwaitingReview',
  portalVerification: null,
  actionNote: null,
  reviewedBy: null,
  reviewedByName: null,
  reviewedAt: null,
  visitDate: '2026-09-24',
  submittedAt: '2026-09-24T16:00:00Z',
  formRevisionId: REVISION_ID,
  submissionId: null,
  version: 4,
  ...over
});

const property = (
  over: Partial<ProgrammeProperty> = {}
): ProgrammeProperty => ({
  id: PROPERTY_ID,
  programmeId: PROGRAMME_ID,
  externalRef: 'PCH-00412',
  addressLine1: '12 Mill Lane',
  addressLine2: null,
  town: 'Barnard Castle',
  postcode: 'DL12 8AB',
  expectedMeterSerial: 'M123456',
  existingSimSerial: null,
  existingSimType: null,
  notes: null,
  active: true,
  synthetic: false,
  version: 2,
  ...over
});

/**
 * A visit form with a condition, deliberately not PCH's own: the meter
 * questions appear only when the SIM was actually changed. Nothing in the tools
 * knows these question ids.
 */
const FORM_FIELDS = [
  {
    id: 'property',
    type: 'entity',
    label: 'Property',
    required: true,
    entity: 'programme_property'
  },
  {
    id: 'outcome',
    type: 'single_choice',
    label: 'What happened',
    required: true,
    options: [
      { id: 'no_access', label: 'Nobody home' },
      { id: 'sim_changed', label: 'SIM changed' }
    ]
  },
  {
    id: 'meter_serial',
    type: 'short_text',
    label: 'Meter serial number',
    required: true,
    condition: { field: 'outcome', op: 'equals', value: 'sim_changed' }
  },
  {
    id: 'meter_photo',
    type: 'photo',
    label: 'Photograph of the meter',
    required: true,
    condition: { field: 'outcome', op: 'equals', value: 'sim_changed' }
  },
  { id: 'comments', type: 'long_text', label: 'Anything else' }
];

const openForm = () => ({
  state: 'open' as const,
  formId: FORM_ID,
  revisionId: REVISION_ID,
  revision: 3,
  title: 'Meter visit',
  description: null,
  definition: { fields: FORM_FIELDS },
  fieldMap: { property: 'property', evidence: { MeterPhoto: ['meter_photo'] } },
  signalConfig: {}
});

const succeeded = (result: Record<string, unknown>) => ({
  ok: true as const,
  outcome: { status: 'Succeeded', heading: 'DONE', message: 'Done.' },
  result,
  replayed: false
});

beforeEach(() => {
  vi.clearAllMocks();
  queries.getVisit.mockResolvedValue(visit());
  queries.getProperty.mockResolvedValue(property());
  queries.visitForm.mockResolvedValue(openForm());
  actions.reviewVisitAction.mockResolvedValue(
    succeeded({
      visit_id: VISIT_ID,
      disposition: 'CompleteAndWorking',
      review_status: 'Reviewed'
    })
  );
  actions.startVisitAction.mockResolvedValue(
    succeeded({ visit_id: VISIT_ID, version: 1, created: true })
  );
  actions.submitVisitAction.mockResolvedValue(
    succeeded({
      outcome: 'SimChangedPortalWorking',
      disposition: 'AwaitingReview'
    })
  );
});

describe('programme_review_visit: the portal rule', () => {
  it('refuses Complete & working when the portal has not been confirmed', async () => {
    const result = await reviewVisitTool.prepare(
      { visit_id: VISIT_ID, disposition: 'CompleteAndWorking' },
      ctx()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PROGRAMME_PORTAL_CONFIRMATION_REQUIRED');
    expect(result.message).toMatch(/portal confirmation is still required/i);
    expect(result.message).toMatch(/CSQ/);
    expect(actions.reviewVisitAction).not.toHaveBeenCalled();
  });

  it('refuses it even when the visit has a good CSQ and a matching serial', async () => {
    queries.getVisit.mockResolvedValue(
      visit({
        csq: 31,
        signalClassification: 'Good',
        portalVerification: 'UnableToVerify'
      })
    );
    const result = await reviewVisitTool.prepare(
      { visit_id: VISIT_ID, disposition: 'CompleteAndWorking' },
      ctx()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/portal/i);
  });

  it('prepares when ConfirmedLive is supplied with the review', async () => {
    const result = await reviewVisitTool.prepare(
      {
        visit_id: VISIT_ID,
        disposition: 'CompleteAndWorking',
        portal_verification: 'ConfirmedLive'
      },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.expectedVersion).toBe(4);
    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Portal result',
          to: 'Confirmed live/reporting'
        }),
        expect.objectContaining({ label: 'Installer', to: 'Gary Field' })
      ])
    );
    expect(result.preview.summary).toContain('PCH-00412');
  });

  it('prepares when the visit already carries ConfirmedLive', async () => {
    queries.getVisit.mockResolvedValue(
      visit({ portalVerification: 'ConfirmedLive' })
    );
    const result = await reviewVisitTool.prepare(
      { visit_id: VISIT_ID, disposition: 'CompleteAndWorking' },
      ctx()
    );
    expect(result.ok).toBe(true);
  });

  it('shows a serial mismatch to the reviewer', async () => {
    queries.getVisit.mockResolvedValue(
      visit({ actualMeterSerial: 'M999999', meterSerialMatches: false })
    );
    const result = await reviewVisitTool.prepare(
      { visit_id: VISIT_ID, disposition: 'ActionRequired' },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.preview)).toContain('M999999');
  });
});

describe('programme_review_visit: the input the model may give', () => {
  it('rejects a disposition the model made up', () => {
    for (const disposition of [
      'Complete',
      'Done',
      'complete_and_working',
      ''
    ]) {
      expect(
        reviewVisitTool.inputSchema.safeParse({
          visit_id: VISIT_ID,
          disposition
        }).success
      ).toBe(false);
    }
  });

  it('rejects a portal verification the model made up', () => {
    expect(
      reviewVisitTool.inputSchema.safeParse({
        visit_id: VISIT_ID,
        disposition: 'CompleteAndWorking',
        portal_verification: 'LooksLive'
      }).success
    ).toBe(false);
  });

  it('accepts only the real enum values', () => {
    expect(
      reviewVisitTool.inputSchema.safeParse({
        visit_id: VISIT_ID,
        disposition: 'MeterRequiresChanging',
        portal_verification: 'NotLive'
      }).success
    ).toBe(true);
  });

  it('will not reopen a visit without being asked to', async () => {
    const result = await reviewVisitTool.prepare(
      { visit_id: VISIT_ID, disposition: 'AwaitingReview' },
      ctx()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PROGRAMME_REOPEN_REQUIRED');
  });

  it('refuses to review a draft the installer has not submitted', async () => {
    queries.getVisit.mockResolvedValue(visit({ reviewStatus: 'Draft' }));
    const result = await reviewVisitTool.prepare(
      { visit_id: VISIT_ID, disposition: 'ActionRequired' },
      ctx()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PROGRAMME_VISIT_NOT_SUBMITTED');
  });
});

describe('programme_review_visit: execute', () => {
  it('passes the confirmed action’s command id and expected version to the command', async () => {
    const result = await reviewVisitTool.execute(
      {
        visit_id: VISIT_ID,
        disposition: 'CompleteAndWorking',
        portal_verification: 'ConfirmedLive',
        note: ' checked the portal '
      },
      mutationCtx(4)
    );
    expect(result.ok).toBe(true);
    expect(actions.reviewVisitAction).toHaveBeenCalledTimes(1);
    const [payload, commandId] = actions.reviewVisitAction.mock.calls[0];
    expect(commandId).toBe(COMMAND_ID);
    expect(payload).toMatchObject({
      visitId: VISIT_ID,
      programmeId: PROGRAMME_ID,
      disposition: 'CompleteAndWorking',
      portalVerification: 'ConfirmedLive',
      actionNote: 'checked the portal',
      expectedVersion: 4
    });
  });

  it('refuses at execute too, so a portal result cleared since the proposal cannot slip through', async () => {
    const result = await reviewVisitTool.execute(
      { visit_id: VISIT_ID, disposition: 'CompleteAndWorking' },
      mutationCtx(4)
    );
    expect(result.ok).toBe(false);
    expect(actions.reviewVisitAction).not.toHaveBeenCalled();
  });

  it('reports the command’s own refusal rather than inventing one', async () => {
    actions.reviewVisitAction.mockResolvedValue({
      ok: false,
      outcome: {
        status: 'Failed',
        heading: 'OUT OF DATE',
        message: 'Somebody else reviewed this visit.',
        code: 'PROGRAMME_STALE_VERSION'
      }
    });
    const result = await reviewVisitTool.execute(
      { visit_id: VISIT_ID, disposition: 'ActionRequired' },
      mutationCtx(4)
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'PROGRAMME_STALE_VERSION',
      message: 'Somebody else reviewed this visit.'
    });
  });
});

describe('programme_visit_submit_status', () => {
  it('reports what the active revision still needs, evidence included', async () => {
    const result = await visitSubmitStatusTool.execute(
      {
        programme_id: PROGRAMME_ID,
        property_id: PROPERTY_ID,
        answers: { property: PROPERTY_ID, outcome: 'sim_changed' }
      },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      missing_required: { id: string; label: string; evidence: boolean }[];
      ready_to_submit: boolean;
    };
    expect(data.missing_required.map((q) => q.id).sort()).toEqual([
      'meter_photo',
      'meter_serial'
    ]);
    expect(
      data.missing_required.find((q) => q.id === 'meter_photo')?.evidence
    ).toBe(true);
    expect(data.ready_to_submit).toBe(false);
  });

  it('does not report a question the form’s conditions hide', async () => {
    const result = await visitSubmitStatusTool.execute(
      {
        programme_id: PROGRAMME_ID,
        property_id: PROPERTY_ID,
        answers: { property: PROPERTY_ID, outcome: 'no_access' }
      },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      missing_required: { id: string }[];
      questions: { id: string }[];
      ready_to_submit: boolean;
    };
    expect(data.missing_required).toEqual([]);
    expect(data.questions.map((q) => q.id)).not.toContain('meter_serial');
    expect(data.questions.map((q) => q.id)).not.toContain('meter_photo');
    expect(data.ready_to_submit).toBe(true);
  });

  it('reads the programme from the draft when only a visit id is given', async () => {
    queries.getVisit.mockResolvedValue(visit({ reviewStatus: 'Draft' }));
    const result = await visitSubmitStatusTool.execute(
      { visit_id: VISIT_ID },
      ctx()
    );
    expect(result.ok).toBe(true);
    expect(queries.visitForm).toHaveBeenCalledWith(PROGRAMME_ID);
  });

  it('says when the programme has no published visit form', async () => {
    queries.visitForm.mockResolvedValue({ state: 'unavailable' });
    const result = await visitSubmitStatusTool.execute(
      { programme_id: PROGRAMME_ID },
      ctx()
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'PROGRAMME_FORM_UNAVAILABLE'
    });
  });
});

describe('programme_visit_submit', () => {
  const answers = {
    property: PROPERTY_ID,
    outcome: 'sim_changed',
    meter_serial: 'M123456',
    meter_photo: [EVIDENCE_ID]
  };

  it('refuses with the specific questions that are missing', async () => {
    const result = await submitVisitTool.prepare(
      {
        programme_id: PROGRAMME_ID,
        property_id: PROPERTY_ID,
        answers: { property: PROPERTY_ID, outcome: 'sim_changed' }
      },
      ctx()
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PROGRAMME_ANSWERS_INCOMPLETE');
    expect(result.message).toContain('meter_serial (Meter serial number)');
    expect(result.message).toContain('meter_photo (Photograph of the meter)');
    expect(result.message).toMatch(/photograph/i);
    expect(actions.startVisitAction).not.toHaveBeenCalled();
  });

  it('does not ask for a question the conditions hide', async () => {
    const result = await submitVisitTool.prepare(
      {
        programme_id: PROGRAMME_ID,
        property_id: PROPERTY_ID,
        answers: { property: PROPERTY_ID, outcome: 'no_access' }
      },
      ctx()
    );
    expect(result.ok).toBe(true);
  });

  it('prepares a complete visit and writes nothing', async () => {
    const result = await submitVisitTool.prepare(
      { programme_id: PROGRAMME_ID, property_id: PROPERTY_ID, answers },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Form',
          to: 'Meter visit (version 3)'
        }),
        expect.objectContaining({
          label: 'Photographs',
          to: expect.stringContaining('1')
        })
      ])
    );
    expect(actions.startVisitAction).not.toHaveBeenCalled();
    expect(actions.submitVisitAction).not.toHaveBeenCalled();
  });

  it('refuses an answer naming a different property from the one visited', async () => {
    const result = await submitVisitTool.prepare(
      {
        programme_id: PROGRAMME_ID,
        property_id: PROPERTY_ID,
        answers: { ...answers, property: VISIT_ID }
      },
      ctx()
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'PROGRAMME_PROPERTY_MISMATCH'
    });
  });

  it('starts the draft, then submits with the confirmed action’s command id', async () => {
    const result = await submitVisitTool.execute(
      { programme_id: PROGRAMME_ID, property_id: PROPERTY_ID, answers },
      mutationCtx(null)
    );
    expect(result.ok).toBe(true);

    const [startPayload, startCommandId] =
      actions.startVisitAction.mock.calls[0];
    expect(startPayload).toMatchObject({
      programmeId: PROGRAMME_ID,
      propertyId: PROPERTY_ID
    });
    // A second command id, derived from the first rather than random, so a
    // retry replays the same START instead of opening a second draft.
    expect(startCommandId).not.toBe(COMMAND_ID);
    expect(startCommandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    const [submitPayload, submitCommandId] =
      actions.submitVisitAction.mock.calls[0];
    expect(submitCommandId).toBe(COMMAND_ID);
    expect(submitPayload).toMatchObject({
      visitId: VISIT_ID,
      programmeId: PROGRAMME_ID,
      formId: FORM_ID,
      revisionId: REVISION_ID,
      // No draft existed at proposal time, so the version the START reported is used.
      expectedVersion: 1,
      answers
    });
  });

  it('passes the proposal’s expected version when a draft was already open', async () => {
    queries.getVisit.mockResolvedValue(
      visit({ reviewStatus: 'Draft', version: 6 })
    );
    actions.startVisitAction.mockResolvedValue(
      succeeded({ visit_id: VISIT_ID, version: 6, created: false })
    );
    await submitVisitTool.execute(
      {
        programme_id: PROGRAMME_ID,
        property_id: PROPERTY_ID,
        answers,
        visit_id: VISIT_ID
      },
      mutationCtx(6)
    );
    expect(actions.submitVisitAction.mock.calls[0][0]).toMatchObject({
      expectedVersion: 6
    });
  });

  it('is the same derived ids on a retry, so nothing is recorded twice', async () => {
    await submitVisitTool.execute(
      { programme_id: PROGRAMME_ID, property_id: PROPERTY_ID, answers },
      mutationCtx(null)
    );
    const firstStart = actions.startVisitAction.mock.calls[0];
    const firstSubmit = actions.submitVisitAction.mock.calls[0][0];
    await submitVisitTool.execute(
      { programme_id: PROGRAMME_ID, property_id: PROPERTY_ID, answers },
      mutationCtx(null)
    );
    expect(actions.startVisitAction.mock.calls[1][0].visitId).toBe(
      firstStart[0].visitId
    );
    expect(actions.startVisitAction.mock.calls[1][1]).toBe(firstStart[1]);
    expect(actions.submitVisitAction.mock.calls[1][0].submissionId).toBe(
      firstSubmit.submissionId
    );
  });

  it('refuses a visit that has already been submitted', async () => {
    queries.getVisit.mockResolvedValue(
      visit({ reviewStatus: 'AwaitingReview' })
    );
    const result = await submitVisitTool.prepare(
      {
        programme_id: PROGRAMME_ID,
        property_id: PROPERTY_ID,
        answers,
        visit_id: VISIT_ID
      },
      ctx()
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'PROGRAMME_VISIT_ALREADY_SUBMITTED'
    });
  });

  it('stops before the command when the property is withdrawn', async () => {
    queries.getProperty.mockResolvedValue(property({ active: false }));
    const result = await submitVisitTool.execute(
      { programme_id: PROGRAMME_ID, property_id: PROPERTY_ID, answers },
      mutationCtx(null)
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'PROGRAMME_PROPERTY_WITHDRAWN'
    });
    expect(actions.startVisitAction).not.toHaveBeenCalled();
  });
});

describe('the tools reach the database only through the existing domain layer', () => {
  const source = readFileSync(
    join(__dirname, '..', 'tools', 'programme-operations.ts'),
    'utf8'
  );

  it('imports no database client of its own', () => {
    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/from '@\/features\/programmes\/server\/db'/);
    // The commands are named in `enforcedBy`, but never called here: every
    // write goes through the programme server action the screens call.
    expect(source).not.toMatch(/from '@\/lib\/backend\/command';/);
    expect(source).not.toMatch(/\brunCommand\(/);
  });

  it('imports only the domain modules it is an adapter over', () => {
    // The trailing semicolon keeps prose inside the module's own strings out of
    // the list: only a real import statement ends that way.
    const imported = (source.match(/from '[^']+';/g) ?? []).map((line) =>
      line.slice("from '".length, -2)
    );
    expect(new Set(imported)).toEqual(
      new Set([
        '@/features/forms/definition',
        '@/features/programmes/labels',
        '@/features/programmes/server/actions',
        '@/features/programmes/server/queries',
        '@/features/programmes/serial',
        '@/features/programmes/types',
        'node:crypto',
        'zod',
        '../registry'
      ])
    );
  });

  it('names the canonical commands it is answerable to', () => {
    expect(reviewVisitTool.authorization.enforcedBy).toContain(
      'PROGRAMME_VISIT_REVIEW'
    );
    expect(reviewVisitTool.authorization.permissions).toEqual([
      'programme.review'
    ]);
    expect(submitVisitTool.authorization.enforcedBy).toContain(
      'PROGRAMME_VISIT_START'
    );
    expect(submitVisitTool.authorization.enforcedBy).toContain(
      'PROGRAMME_VISIT_SUBMIT'
    );
    expect(submitVisitTool.authorization.permissions).toEqual([
      'programme.visit.submit'
    ]);
    // An installer holds programme.visit.submit and not programme.review, so
    // the review tool is not offered to them at all; a surveyor holds neither.
    expect(reviewVisitTool.authorization.permissions).not.toContain(
      'programme.visit.submit'
    );
  });
});
