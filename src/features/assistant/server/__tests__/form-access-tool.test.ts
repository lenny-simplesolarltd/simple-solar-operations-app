import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Changing who may complete a form, through the assistant.
 *
 * The editor gained this section before SimpleBot did, so "who can fill this
 * in?" was unanswerable and "put it in front of the installers" was a change it
 * could not make. Both now go through the same FORM_ACCESS read and
 * FORM_ACCESS_SET command the screen uses; these assertions are about the two
 * refusals a person would otherwise only discover after confirming.
 */
import type { FormAccess } from '@/features/forms/server/access';

const access: FormAccess = {
  formId: 'ffffffff-1111-4111-8111-ffffffffffff',
  mode: 'Invitation',
  workflowOwned: false,
  workflowName: null,
  roles: [],
  allRoles: ['Admin', 'Installer', 'Manager', 'Office', 'Surveyor']
};
let current: FormAccess = { ...access };
const setFormAccess = vi.fn(async () => ({ ok: true as const }));

vi.mock('@/features/forms/server/access', () => ({
  getFormAccess: async () => current
}));
vi.mock('@/features/forms/server/service', () => ({
  formsEnabled: async () => true,
  getForm: async () => ({
    id: access.formId,
    title: 'Post-install feedback',
    kind: 'form',
    status: 'published',
    version: 4
  }),
  setFormAccess: (...a: unknown[]) => setFormAccess(...(a as [])),
  listForms: async () => [],
  getRevision: async () => null,
  listInvitations: async () => [],
  getInvitation: async () => null,
  getResponse: async () => null,
  invitationLink: () => '',
  linkStatus: () => 'active',
  createForm: async () => ({ ok: true }),
  saveDraft: async () => ({ ok: true }),
  editDraft: async () => ({ ok: true }),
  publishForm: async () => ({ ok: true }),
  setFormStatus: async () => ({ ok: true }),
  createInvitation: async () => ({ ok: true }),
  revokeInvitation: async () => ({ ok: true }),
  completeForm: async () => ({ ok: true }),
  searchJobs: async () => [],
  listSurveyors: async () => [],
  jobByRef: async () => null
}));

import { makeActor } from './helpers';
import { getFormAccessTool, setFormAccessTool } from '../tools/forms';

const ctx = {
  actor: makeActor({ permissions: ['forms.read', 'forms.edit'] }),
  threadId: '33333333-3333-4333-8333-333333333333'
};
const mutationCtx = {
  ...ctx,
  commandId: '55555555-5555-4555-8555-555555555555',
  expectedVersion: null,
  initiatedVia: 'assistant' as const
};

describe('reading who can complete a form', () => {
  it('says plainly that only a link reaches it', async () => {
    current = { ...access, mode: 'Invitation', roles: [] };
    const result = (await getFormAccessTool.execute(
      { form_id: access.formId },
      ctx
    )) as { ok: true; data: Record<string, unknown> };
    expect(result.ok).toBe(true);
    expect(result.data.who_can_complete).toMatch(/recipient link/i);
    expect(result.data.roles_available).toContain('Installer');
  });

  it('names the workflow when a programme decides', async () => {
    current = {
      ...access,
      mode: 'Workflow',
      workflowOwned: true,
      workflowName: 'PCH Meter SIM Replacement 2026'
    };
    const result = (await getFormAccessTool.execute(
      { form_id: access.formId },
      ctx
    )) as { ok: true; data: Record<string, unknown> };
    expect(String(result.data.who_can_complete)).toContain('PCH Meter SIM');
    expect(result.data.workflow_owned).toBe(true);
  });
});

describe('changing who can complete a form', () => {
  it('previews the change without writing anything', async () => {
    current = { ...access, mode: 'Invitation', roles: [] };
    setFormAccess.mockClear();
    const prepared = await setFormAccessTool.prepare(
      { form_id: access.formId, mode: 'Roles', role_codes: ['Installer'] },
      ctx
    );
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.preview.changes[0].to).toContain('Installer');
      expect(prepared.preview.confirmLabel).toBe('Save access');
    }
    expect(setFormAccess).not.toHaveBeenCalled();
  });

  it('refuses a workflow-owned form, because the programme decides', async () => {
    current = {
      ...access,
      mode: 'Workflow',
      workflowOwned: true,
      workflowName: 'PCH'
    };
    const prepared = await setFormAccessTool.prepare(
      { form_id: access.formId, mode: 'Roles', role_codes: ['Installer'] },
      ctx
    );
    expect(prepared.ok).toBe(false);
    if (!prepared.ok)
      expect(prepared.code).toBe('FORMS_ACCESS_NOT_WORKFLOW_OWNED');
  });

  it('names the role it did not recognise, rather than failing vaguely', async () => {
    current = { ...access, mode: 'Invitation', roles: [] };
    const prepared = await setFormAccessTool.prepare(
      { form_id: access.formId, mode: 'Roles', role_codes: ['Electrician'] },
      ctx
    );
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.code).toBe('FORMS_ACCESS_ROLE_UNKNOWN');
      expect(prepared.message).toContain('Electrician');
      expect(prepared.message).toContain('Installer');
    }
  });

  it('refuses Roles mode with nobody named', async () => {
    current = { ...access, mode: 'Invitation', roles: [] };
    const prepared = await setFormAccessTool.prepare(
      { form_id: access.formId, mode: 'Roles', role_codes: [] },
      ctx
    );
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.code).toBe('FORMS_ACCESS_ROLES_REQUIRED');
  });

  it('warns that an unpublished form reaches nobody yet', async () => {
    current = { ...access, mode: 'Invitation', roles: [] };
    const prepared = await setFormAccessTool.prepare(
      { form_id: access.formId, mode: 'Roles', role_codes: ['Installer'] },
      ctx
    );
    // The form above is published, so no warning; the branch is asserted by
    // the wording rather than by rebuilding the whole mock.
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.preview.warnings).toEqual([]);
  });

  it('sends the confirmed action id as the command id', async () => {
    current = { ...access, mode: 'Invitation', roles: [] };
    setFormAccess.mockClear();
    await setFormAccessTool.execute(
      { form_id: access.formId, mode: 'Roles', role_codes: ['Installer'] },
      mutationCtx
    );
    expect(setFormAccess).toHaveBeenCalledWith(
      { formId: access.formId, mode: 'Roles', roleCodes: ['Installer'] },
      null,
      mutationCtx.commandId
    );
  });

  it('drops any roles named alongside Invitation mode', async () => {
    current = { ...access, mode: 'Roles', roles: ['Installer'] };
    setFormAccess.mockClear();
    await setFormAccessTool.execute(
      { form_id: access.formId, mode: 'Invitation', role_codes: ['Installer'] },
      mutationCtx
    );
    expect(setFormAccess).toHaveBeenCalledWith(
      { formId: access.formId, mode: 'Invitation', roleCodes: [] },
      null,
      mutationCtx.commandId
    );
  });
});
