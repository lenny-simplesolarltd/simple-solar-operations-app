import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// The Forms service is the shared domain layer; here it is replaced by a fake
// so the tests can see exactly what SimpleBot asks of it, and when.
const service = vi.hoisted(() => ({
  listForms: vi.fn(),
  getForm: vi.fn(),
  listInvitations: vi.fn(),
  getInvitation: vi.fn(),
  getResponse: vi.fn(),
  createForm: vi.fn(),
  editDraft: vi.fn(),
  publishForm: vi.fn(),
  setFormStatus: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  jobByRef: vi.fn(),
  listSurveyors: vi.fn()
}));
vi.mock('@/features/forms/server/service', () => service);

import type { FormDetail } from '@/features/forms/types';
import { resolvePendingAction } from '../confirm';
import { runAssistantTurn } from '../orchestrator';
import { resolveToolCall } from '../registry';
import { createToolRegistry } from '../tools';
import {
  collector,
  makeActor,
  makePendingActions,
  scriptedProvider,
  silentAudit,
  THREAD
} from './helpers';

const FORM_ID = '6d1f0b8a-1c2e-4c7a-9d8e-0a1b2c3d4e5f';
const registry = createToolRegistry();
const staff = (extra: string[] = []) =>
  makeActor({
    roles: ['Office'],
    permissions: [
      'forms.read',
      'forms.create',
      'forms.edit',
      'forms.publish',
      'forms.send',
      'forms.responses.read',
      ...extra
    ]
  });

const form = (over: Partial<FormDetail> = {}): FormDetail => ({
  id: FORM_ID,
  kind: 'form',
  title: 'Post-install feedback',
  description: null,
  status: 'draft',
  revision: 0,
  questionCount: 1,
  hasUnpublishedChanges: true,
  jobId: null,
  jobRef: null,
  sourceTemplateId: null,
  createdAt: '2026-09-19T09:00:00Z',
  updatedAt: '2026-09-19T09:00:00Z',
  version: 4,
  definition: {
    fields: [
      {
        id: 'rating',
        type: 'scale',
        label: 'Rating',
        required: true,
        min: 1,
        max: 10
      }
    ]
  },
  currentRevisionId: null,
  revisions: [],
  ...over
});

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

/** Runs one turn in which the model calls `tool` with `args`, and returns the proposal card. */
async function propose(tool: string, args: unknown, actor = staff()) {
  const pendingActions = makePendingActions();
  const out = collector();
  const { provider } = scriptedProvider([
    { toolCalls: [{ id: 'c1', name: tool, args }] },
    { text: 'I have prepared that for you to confirm.' }
  ]);
  await runAssistantTurn({
    actor,
    threadId: THREAD,
    message: 'please',
    transcript: [],
    provider,
    registry,
    pendingActions,
    audit: silentAudit().sink,
    emit: out.emit
  });
  return { out, pendingActions, proposal: out.ofType('proposal')[0] };
}

describe('Forms permissions reach SimpleBot', () => {
  it('offers no Forms tools to staff without forms permissions', () => {
    const names = registry
      .availableFor(makeActor({ roles: ['Installer'] }))
      .map((t) => t.name);
    expect(names.some((n) => n.includes('form'))).toBe(false);
  });

  it('refuses a Forms change the staff member may not make, before anything else', () => {
    const readOnly = makeActor({
      roles: ['Director'],
      permissions: ['forms.read', 'forms.responses.read']
    });
    for (const [tool, args] of [
      ['create_form', { title: 'x' }],
      [
        'edit_form_draft',
        { form_id: FORM_ID, operations: [{ op: 'set_title', title: 'y' }] }
      ],
      [
        'create_form_link',
        { form_id: FORM_ID, recipient: 'other', recipient_name: 'Bob' }
      ]
    ] as const) {
      expect(resolveToolCall(registry, readOnly, tool, args)).toMatchObject({
        ok: false,
        code: 'PERMISSION_DENIED'
      });
    }
    expect(resolveToolCall(registry, readOnly, 'list_forms', {})).toMatchObject(
      { ok: true }
    );
  });

  it('templates additionally need forms.templates.manage', async () => {
    const { out } = await propose('create_form', {
      kind: 'template',
      title: 'Standard feedback'
    });
    expect(out.ofType('proposal')).toHaveLength(0);
    expect(out.ofType('tool_result')[0].error?.code).toBe(
      'FORMS_PERMISSION_DENIED'
    );
  });
});

describe('proposals change nothing until confirmed', () => {
  it('create_form: prepare writes nothing; confirming runs one command with the action id', async () => {
    service.createForm.mockResolvedValue({
      ok: true,
      replayed: false,
      result: { form_id: FORM_ID, version: 1 }
    });
    service.getForm.mockResolvedValue(form());

    const { proposal, pendingActions, out } = await propose('create_form', {
      title: 'Post-install feedback',
      fields: [
        {
          type: 'scale',
          label: 'How would you rate the installation?',
          required: true,
          min: 1,
          max: 10
        },
        { type: 'yes_no', label: 'Was the installer tidy?', required: true },
        { type: 'long_text', label: 'Comments', required: false }
      ]
    });
    expect(proposal.action.changes.map((c) => c.to)).toEqual([
      'How would you rate the installation? — Rating scale, required',
      'Was the installer tidy? — Yes / No, required',
      'Comments — Long text'
    ]);
    expect(service.createForm).not.toHaveBeenCalled();
    // The model is told nothing has happened yet.
    const told = JSON.stringify(out.ofType('turn_end')[0].transcript);
    expect(told).toContain('AWAITING_HUMAN_CONFIRMATION');

    const confirm = () =>
      resolvePendingAction({
        actor: staff(),
        decision: 'confirm',
        token: proposal.action.token,
        registry,
        pendingActions,
        audit: silentAudit().sink
      });
    const first = await confirm();
    expect(first).toMatchObject({
      ok: true,
      decision: 'confirm',
      display: { kind: 'form' }
    });
    expect(service.createForm).toHaveBeenCalledTimes(1);
    const [input, commandId] = service.createForm.mock.calls[0];
    expect(commandId).toBe(proposal.action.actionId);
    expect(input.definition.fields.map((f: { id: string }) => f.id)).toEqual([
      'how_would_you_rate_the_install',
      'was_the_installer_tidy',
      'comments'
    ]);

    // Confirming again never runs it twice.
    expect(await confirm()).toMatchObject({
      ok: false,
      error: { code: 'ACTION_ALREADY_USED' }
    });
    expect(service.createForm).toHaveBeenCalledTimes(1);
  });

  it('cancelling runs nothing', async () => {
    const { proposal, pendingActions } = await propose('create_form', {
      title: 'Nope'
    });
    const cancelled = await resolvePendingAction({
      actor: staff(),
      decision: 'cancel',
      token: proposal.action.token,
      registry,
      pendingActions,
      audit: silentAudit().sink
    });
    expect(cancelled).toMatchObject({ ok: true, decision: 'cancel' });
    expect(service.createForm).not.toHaveBeenCalled();
  });

  it('a transport failure can be retried and replays the same command id (idempotent in the database)', async () => {
    service.getForm.mockResolvedValue(
      form({ status: 'published', revision: 1, hasUnpublishedChanges: false })
    );
    service.jobByRef.mockResolvedValue({ id: 'job-1', jobRef: 'SS-ABCD-1234' });
    service.createInvitation
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({
        ok: true,
        replayed: true,
        result: { invitation_id: 'inv-1', revision: 1, expires_at: null }
      });
    service.getInvitation.mockResolvedValue(null);

    const { proposal, pendingActions } = await propose('create_form_link', {
      form_id: FORM_ID,
      recipient: 'customer',
      job_ref: 'SS-ABCD-1234'
    });
    const confirm = () =>
      resolvePendingAction({
        actor: staff(),
        decision: 'confirm',
        token: proposal.action.token,
        registry,
        pendingActions,
        audit: silentAudit().sink
      });
    expect(await confirm()).toMatchObject({
      ok: false,
      error: { code: 'ACTION_FAILED', retryable: true }
    });
    expect(await confirm()).toMatchObject({ ok: true });
    const ids = service.createInvitation.mock.calls.map((c) => c[1]);
    expect(ids).toEqual([proposal.action.actionId, proposal.action.actionId]);
    // Same expiry both times, so the database recognises the replay.
    expect(service.createInvitation.mock.calls[0][0].expiresAt).toBe(
      service.createInvitation.mock.calls[1][0].expiresAt
    );
  });

  it('edit_form_draft re-reads the form now and saves against the version it proposed on', async () => {
    service.getForm.mockResolvedValue(form({ version: 7 }));
    service.editDraft.mockResolvedValue({
      ok: false,
      code: 'FORMS_STALE_VERSION',
      message: 'Someone else changed this form'
    });

    const { proposal, pendingActions } = await propose('edit_form_draft', {
      form_id: FORM_ID,
      operations: [
        { op: 'update_field', field_id: 'rating', changes: { required: false } }
      ]
    });
    expect(service.getForm).toHaveBeenCalledWith(FORM_ID);
    expect(proposal.action.changes[0]).toMatchObject({
      label: 'Change "Rating"'
    });

    const result = await resolvePendingAction({
      actor: staff(),
      decision: 'confirm',
      token: proposal.action.token,
      registry,
      pendingActions,
      audit: silentAudit().sink
    });
    expect(service.editDraft).toHaveBeenCalledWith(
      FORM_ID,
      expect.any(Array),
      proposal.action.actionId,
      7
    );
    // Someone saved in between: refused, not overwritten.
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'FORMS_STALE_VERSION' }
    });
  });

  it('refuses an edit that names a question the form does not have', async () => {
    service.getForm.mockResolvedValue(form());
    const { out } = await propose('edit_form_draft', {
      form_id: FORM_ID,
      operations: [{ op: 'remove_field', field_id: 'question_9' }]
    });
    expect(out.ofType('proposal')).toHaveLength(0);
    expect(out.ofType('tool_result')[0].error?.code).toBe(
      'FORMS_INVALID_DEFINITION'
    );
  });
});

describe('privacy', () => {
  it('the model never receives a recipient link or token', async () => {
    service.getForm.mockResolvedValue(
      form({ status: 'published', revision: 1, hasUnpublishedChanges: false })
    );
    service.jobByRef.mockResolvedValue({ id: 'job-1', jobRef: 'SS-ABCD-1234' });
    service.createInvitation.mockResolvedValue({
      ok: true,
      replayed: false,
      result: { invitation_id: 'inv-1', revision: 1, expires_at: null }
    });
    service.getInvitation.mockResolvedValue({
      id: 'inv-1',
      formId: FORM_ID,
      formTitle: 'Post-install feedback',
      revisionId: 'r1',
      revision: 1,
      recipientType: 'customer',
      recipientName: 'Jane Smith',
      jobId: 'job-1',
      jobRef: 'SS-ABCD-1234',
      status: 'ready',
      expiresAt: null,
      createdAt: '2026-09-19T09:00:00Z',
      submittedAt: null,
      submissionId: null,
      version: 1
    });
    const { proposal, pendingActions } = await propose('create_form_link', {
      form_id: FORM_ID,
      recipient: 'customer',
      job_ref: 'SS-ABCD-1234'
    });
    const result = await resolvePendingAction({
      actor: staff(),
      decision: 'confirm',
      token: proposal.action.token,
      registry,
      pendingActions,
      audit: silentAudit().sink
    });
    expect(result.ok).toBe(true);
    const everything = JSON.stringify(result);
    expect(everything).not.toMatch(/\/f\/|token|https?:\/\//i);
    expect(everything).toContain('inv-1');
  });

  it('response answers that are contact details are withheld from the model', async () => {
    service.getResponse.mockResolvedValue({
      id: 'sub-1',
      answers: {
        email: 'jane@example.test',
        phone: '07700900123',
        address: { line1: '1 High St', postcode: 'EX1 1AA' },
        rating: 9
      },
      submittedAt: '2026-09-19T10:00:00Z',
      revision: {
        id: 'r1',
        formId: FORM_ID,
        number: 1,
        title: 'Details',
        description: null,
        publishedAt: '2026-09-19T09:00:00Z',
        definition: {
          fields: [
            { id: 'email', type: 'email', label: 'Email' },
            { id: 'phone', type: 'phone', label: 'Phone' },
            { id: 'address', type: 'address', label: 'Address' },
            { id: 'rating', type: 'scale', label: 'Rating', min: 1, max: 10 }
          ]
        }
      },
      invitation: {
        id: 'inv-1',
        formId: FORM_ID,
        formTitle: 'Details',
        revisionId: 'r1',
        revision: 1,
        recipientType: 'customer',
        recipientName: 'Jane Smith',
        jobId: null,
        jobRef: null,
        status: 'submitted',
        expiresAt: null,
        createdAt: '2026-09-19T09:00:00Z',
        submittedAt: '2026-09-19T10:00:00Z',
        submissionId: 'sub-1',
        version: 1
      }
    });
    const resolved = resolveToolCall(registry, staff(), 'get_form_response', {
      submission_id: '7e1f0b8a-1c2e-4c7a-9d8e-0a1b2c3d4e5f'
    });
    if (!resolved.ok || resolved.tool.kind !== 'read')
      throw new Error('expected read tool');
    const result = await resolved.tool.execute(resolved.input, {
      actor: staff(),
      threadId: THREAD
    });
    const text = JSON.stringify(result.ok && result.data);
    expect(text).not.toContain('jane@example.test');
    expect(text).not.toContain('07700900123');
    expect(text).not.toContain('1 High St');
    expect(text).toContain('9');
  });
});

describe('Forms release gate', () => {
  it('while switched off, no Forms tool is offered or executable - even with every permission', () => {
    const off = createToolRegistry({ forms: false });
    const everything = staff(['forms.templates.manage']);
    expect(
      off.availableFor(everything).some((t) => t.name.includes('form'))
    ).toBe(false);
    for (const [tool, args] of [
      ['list_forms', {}],
      ['get_form', { form_id: FORM_ID }],
      ['create_form', { title: 'x' }],
      [
        'create_form_link',
        { form_id: FORM_ID, recipient: 'other', recipient_name: 'Bob' }
      ]
    ] as const) {
      expect(resolveToolCall(off, everything, tool, args)).toMatchObject({
        ok: false,
        code: 'TOOL_UNAVAILABLE'
      });
    }
    // The model is told they are planned, not available.
    expect(off.planned().map((t) => t.name)).toContain('create_form');
  });
  it('makes a link without asking who it is for', async () => {
    // "publish it and give me a link" should produce a link, not a question.
    // The table requires an "other" invitation to carry a label, so an
    // unattributed one is filed under a label that says exactly that.
    service.getForm.mockResolvedValue(
      form({ status: 'published', revision: 1, hasUnpublishedChanges: false })
    );
    service.createInvitation.mockResolvedValue({
      ok: true,
      result: { invitation_id: 'inv-default', revision: 1, expires_at: null }
    });
    service.getInvitation.mockResolvedValue(null);

    const { proposal, pendingActions } = await propose('create_form_link', {
      form_id: FORM_ID
    });
    // The card says who it is for before anything runs.
    expect(JSON.stringify(proposal.action.changes)).toContain('Not specified');

    const settled = await resolvePendingAction({
      actor: staff(),
      decision: 'confirm',
      token: proposal.action.token,
      registry,
      pendingActions,
      audit: silentAudit().sink
    });
    expect(settled).toMatchObject({ ok: true });

    const [args] = service.createInvitation.mock.calls.at(-1)!;
    expect(args).toMatchObject({
      recipientType: 'other',
      recipientLabel: 'Not specified',
      jobId: null,
      personId: null
    });
    // Default expiry is still applied rather than left open-ended.
    expect(args.expiresAt).not.toBeNull();
  });
});
