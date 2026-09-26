import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The sequence staff actually ask for: change a published form, publish the
 * change, and get a link to send to somebody.
 *
 * Each tool is tested on its own elsewhere. What is tested here is the CHAIN,
 * because that is where the version handling has to hold: every one of these
 * is a separate proposal, confirmed separately, and each confirmation moves
 * the form's row version. A proposal prepared before an earlier one was
 * confirmed is quoting a version that no longer exists, and must be refused
 * rather than publishing a definition nobody looked at.
 *
 * Only the Forms service is faked - the registry, the orchestrator, the
 * proposal, the confirmation and the version each tool quotes back are all the
 * real ones. The fake keeps state, so the versions move the way the database
 * moves them and a tool that ignored one would fail here.
 */

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
vi.mock('@/features/forms/server/access', () => ({
  getFormAccess: vi.fn()
}));

import type { FormDetail } from '@/features/forms/types';
import { resolvePendingAction } from '../confirm';
import { runAssistantTurn } from '../orchestrator';
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
const INVITATION_ID = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const registry = createToolRegistry();

/** Admin, Manager and Office hold all three; a Director holds forms.read only. */
const office = () =>
  makeActor({
    roles: ['Office'],
    permissions: [
      'forms.read',
      'forms.create',
      'forms.edit',
      'forms.publish',
      'forms.send',
      'forms.responses.read'
    ]
  });
const director = () =>
  makeActor({
    roles: ['Director'],
    permissions: ['forms.read', 'forms.responses.read']
  });

// -- A form that behaves like the row does ------------------------------------

/**
 * The published form staff are changing: version 1 is out with recipients, and
 * nothing has been edited since.
 */
function liveForm(): FormDetail {
  return {
    id: FORM_ID,
    kind: 'form',
    title: 'Post-install feedback',
    description: null,
    status: 'published',
    revision: 1,
    questionCount: 1,
    hasUnpublishedChanges: false,
    jobId: null,
    jobRef: null,
    sourceTemplateId: null,
    createdAt: '2026-09-19T09:00:00Z',
    updatedAt: '2026-09-19T09:00:00Z',
    version: 7,
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
    currentRevisionId: 'rev-1',
    // A rating question: nothing a recipient could not answer without an
    // account, so this form really is sendable as a link.
    linkable: true,
    revisions: []
  };
}

let state: FormDetail;

/**
 * The fake service, keeping the state the database keeps. Editing bumps the
 * row version and raises the unpublished flag; publishing mints the next
 * revision and lowers it. Both refuse a stale expected version, as the
 * commands do.
 */
function wireService() {
  service.getForm.mockImplementation(async () => structuredClone(state));

  service.editDraft.mockImplementation(
    async (
      _formId: string,
      _operations: unknown[],
      _commandId: string,
      expectedVersion: number | null
    ) => {
      if (expectedVersion !== state.version)
        return {
          ok: false,
          code: 'FORMS_STALE_VERSION',
          message: 'Someone else changed this form. Read it again.'
        };
      state = {
        ...state,
        version: state.version + 1,
        hasUnpublishedChanges: true,
        definition: {
          fields: [
            ...state.definition.fields,
            {
              id: 'comments',
              type: 'long_text',
              label: 'Comments',
              required: false
            }
          ]
        },
        questionCount: state.questionCount + 1
      };
      return { ok: true, replayed: false, result: { version: state.version } };
    }
  );

  service.publishForm.mockImplementation(
    async (_formId: string, expectedVersion: number, _commandId: string) => {
      if (expectedVersion !== state.version)
        return {
          ok: false,
          code: 'FORMS_STALE_VERSION',
          message: 'Someone else changed this form. Read it again.'
        };
      state = {
        ...state,
        version: state.version + 1,
        revision: state.revision + 1,
        hasUnpublishedChanges: false,
        status: 'published',
        currentRevisionId: `rev-${state.revision + 1}`
      };
      return {
        ok: true,
        replayed: false,
        result: { revision: state.revision, version: state.version }
      };
    }
  );

  service.createInvitation.mockImplementation(async () => ({
    ok: true,
    replayed: false,
    result: {
      invitation_id: INVITATION_ID,
      revision: state.revision,
      expires_at: '2026-10-26T22:59:59Z'
    }
  }));

  service.getInvitation.mockImplementation(async () => ({
    id: INVITATION_ID,
    formId: FORM_ID,
    formTitle: state.title,
    recipientType: 'other',
    recipientName: 'Not specified',
    jobRef: null,
    revision: state.revision,
    status: 'ready',
    expiresAt: '2026-10-26T22:59:59Z',
    submissionId: null
  }));
}

/** One turn in which the model calls `tool`, returning the proposal card. */
async function propose(tool: string, args: unknown, actor = office()) {
  const pendingActions = makePendingActions();
  const out = collector();
  const { provider } = scriptedProvider([
    { toolCalls: [{ id: 'c1', name: tool, args }] },
    { text: 'Ready for you to confirm.' }
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

const confirm = (
  proposal: { action: { token: string; actionId: string } },
  pendingActions: ReturnType<typeof makePendingActions>,
  actor = office()
) =>
  resolvePendingAction({
    actor,
    decision: 'confirm',
    token: proposal.action.token,
    registry,
    pendingActions,
    audit: silentAudit().sink
  });

const ADD_COMMENTS = {
  form_id: FORM_ID,
  operations: [
    {
      op: 'add_field' as const,
      field: { type: 'long_text', label: 'Comments', required: false }
    }
  ]
};

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  state = liveForm();
  wireService();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('edit, publish, then link - the whole sequence', () => {
  it('changes a published form, publishes it as the next version, and makes a link on that version', async () => {
    // 1. Edit the draft of a form that is already published.
    const edit = await propose('edit_form_draft', ADD_COMMENTS);
    expect(edit.proposal.action.changes).toContainEqual({
      label: 'Add question',
      to: 'Comments — Long text'
    });
    // The card tells them the live version is untouched until they publish.
    expect(edit.proposal.action.summary).toMatch(
      /Version 1 and any links already created stay exactly as they are/
    );
    expect(service.editDraft).not.toHaveBeenCalled();

    expect(await confirm(edit.proposal, edit.pendingActions)).toMatchObject({
      ok: true,
      decision: 'confirm'
    });
    expect(service.editDraft).toHaveBeenCalledWith(
      FORM_ID,
      expect.any(Array),
      edit.proposal.action.actionId,
      7
    );
    // The row moved, the live revision did not.
    expect(state).toMatchObject({
      version: 8,
      revision: 1,
      hasUnpublishedChanges: true
    });

    // 2. Publish. The proposal is prepared AFTER the edit was confirmed, so it
    //    quotes version 8.
    const publish = await propose('publish_form', { form_id: FORM_ID });
    expect(publish.proposal.action.title).toBe(
      'Publish "Post-install feedback" as version 2'
    );
    expect(publish.proposal.action.changes).toEqual([
      { label: 'Published version', from: 'v1', to: 'v2' }
    ]);
    expect(publish.proposal.action.warnings).toEqual([
      'Links already created keep version 1.'
    ]);

    const published = await confirm(publish.proposal, publish.pendingActions);
    expect(service.publishForm).toHaveBeenCalledWith(
      FORM_ID,
      8,
      publish.proposal.action.actionId
    );
    expect(published).toMatchObject({ ok: true, display: { kind: 'form' } });
    expect(state).toMatchObject({
      revision: 2,
      hasUnpublishedChanges: false
    });

    // 3. A link for whoever they like: no recipient named, so it is
    //    unattributed and they share it themselves.
    const link = await propose('create_form_link', { form_id: FORM_ID });
    expect(link.proposal.action.changes).toEqual([
      { label: 'Form', to: 'Post-install feedback (version 2)' },
      { label: 'Recipient', to: 'Not specified' },
      { label: 'Expires', to: 'After 30 days' },
      {
        label: 'Delivery',
        to: 'Copy the link from the card and send it yourself'
      }
    ]);
    // The new version is live, so there is no "unpublished changes" caveat.
    expect(link.proposal.action.warnings).toEqual([]);

    const made = await confirm(link.proposal, link.pendingActions);
    expect(made).toMatchObject({ ok: true, display: { kind: 'form_links' } });
    const [invitation, commandId] = service.createInvitation.mock.calls[0];
    expect(invitation).toMatchObject({
      formId: FORM_ID,
      recipientType: 'other',
      recipientLabel: 'Not specified',
      jobId: null,
      personId: null
    });
    expect(commandId).toBe(link.proposal.action.actionId);

    // The link itself never reaches the model or the transcript: the card
    // carries an invitation id, and the browser fetches the URL when pressed.
    const everythingSaid = JSON.stringify(made);
    expect(everythingSaid).not.toMatch(/\/f\//);
    expect(everythingSaid).not.toMatch(/token/i);
  });

  it('will not publish on a version that moved while the proposal sat there', async () => {
    // A publish cannot even be PROPOSED until there is something to publish,
    // which closes most of this window on its own.
    const nothingYet = await propose('publish_form', { form_id: FORM_ID });
    expect(nothingYet.proposal).toBeUndefined();
    expect(nothingYet.out.ofType('tool_result')[0].error?.code).toBe(
      'FORMS_NO_CHANGES'
    );

    // The window that is left: one edit confirmed, a publish proposed on that
    // version, then a SECOND edit confirmed before anyone pressed Confirm.
    const first = await propose('edit_form_draft', ADD_COMMENTS);
    await confirm(first.proposal, first.pendingActions);
    expect(state.version).toBe(8);

    const publish = await propose('publish_form', { form_id: FORM_ID });
    expect(publish.proposal).toBeDefined();

    const second = await propose('edit_form_draft', {
      form_id: FORM_ID,
      operations: [
        {
          op: 'add_field' as const,
          field: { type: 'short_text', label: 'Installer name' }
        }
      ]
    });
    await confirm(second.proposal, second.pendingActions);
    expect(state.version).toBe(9);

    const result = await confirm(publish.proposal, publish.pendingActions);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'FORMS_STALE_VERSION' }
    });
    // Refused rather than publishing a definition nobody looked at: the form
    // is still on version 1.
    expect(state.revision).toBe(1);
  });

  it('refuses to publish a form that has nothing new in it', async () => {
    const { out } = await propose('publish_form', { form_id: FORM_ID });
    expect(out.ofType('tool_result')[0].error?.code).toBe('FORMS_NO_CHANGES');
    expect(service.publishForm).not.toHaveBeenCalled();
  });

  it('will not link to a form whose draft has never been published', async () => {
    state = {
      ...liveForm(),
      status: 'draft',
      revision: 0,
      currentRevisionId: null,
      hasUnpublishedChanges: true
    };
    const { out } = await propose('create_form_link', { form_id: FORM_ID });
    expect(out.ofType('tool_result')[0].error?.code).toBe(
      'FORMS_NOT_PUBLISHED'
    );
    expect(service.createInvitation).not.toHaveBeenCalled();
  });

  it('warns on the card when a link would use an older version than the draft', async () => {
    state = { ...liveForm(), hasUnpublishedChanges: true };
    const { proposal } = await propose('create_form_link', {
      form_id: FORM_ID
    });
    expect(proposal.action.warnings).toEqual([
      'The draft has unpublished changes; this link uses the published version.'
    ]);
  });

  it('will not offer a link for a form that needs a signed-in person', async () => {
    // A published form carrying a photo or lookup question can be completed in
    // the app but never by a recipient on a link. Refused at prepare, so
    // nobody is asked to confirm something that can only fail.
    state = { ...liveForm(), linkable: false };
    const { out } = await propose('create_form_link', { form_id: FORM_ID });
    expect(out.ofType('tool_result')[0].error?.code).toBe('FORMS_NOT_LINKABLE');
    expect(service.createInvitation).not.toHaveBeenCalled();
  });

  it('ties a link to a customer only when the staff member says so', async () => {
    service.jobByRef.mockResolvedValue({
      id: 'job-1',
      jobRef: 'SS-ABCD-1234'
    });
    const { proposal } = await propose('create_form_link', {
      form_id: FORM_ID,
      recipient: 'customer',
      job_ref: 'SS-ABCD-1234'
    });
    expect(proposal.action.changes).toContainEqual({
      label: 'Recipient',
      to: 'Customer on SS-ABCD-1234'
    });
  });

  it('offers a Director none of the three: they may read forms, not run them', () => {
    const offered = registry.availableFor(director()).map((t) => t.name);
    expect(offered).toContain('get_form');
    for (const name of ['edit_form_draft', 'publish_form', 'create_form_link'])
      expect(offered, name).not.toContain(name);
  });

  it('offers all three to the office', () => {
    const offered = registry.availableFor(office()).map((t) => t.name);
    for (const name of ['edit_form_draft', 'publish_form', 'create_form_link'])
      expect(offered, name).toContain(name);
  });
});
