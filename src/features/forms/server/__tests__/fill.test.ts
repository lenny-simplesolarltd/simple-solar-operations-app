import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Completing a form you have been asked to complete.
 *
 * What went wrong: Forms had permissions for ADMINISTERING forms
 * (forms.read/create/edit/publish/responses.read) and none at all for filling
 * one in, so the screens gated on forms.read - and an installer sent to complete
 * a form was redirected away from it. 20260925100000 made eligibility a property
 * of the form itself, and /dashboard/forms/<id>/fill is the surface that has to
 * honour that without reintroducing a permission gate.
 *
 * These assertions pin down the three things that must stay true:
 *   - a person with no forms.* permission can open a form the form entitles them
 *     to complete;
 *   - a person the form does not entitle cannot, and is told nothing about it;
 *   - neither opening nor submitting consults an app-side permission set: the
 *     database is the authority, and it is asked again on the way in.
 *
 * getPermissions and getCurrentUser are mocked to THROW: any reintroduced
 * permission check fails these tests rather than passing quietly.
 */

vi.mock('@/features/presale/server/queries', () => ({
  getPermissions: () => {
    throw new Error('completing a form must not consult forms.* permissions');
  }
}));
vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => {
    throw new Error('completing a form must not resolve an actor in the app');
  }
}));
vi.mock('@/lib/preview/guard', () => ({ previewWriteBlock: async () => null }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Rpc = { fn: string; request: Record<string, unknown> };
const calls: Rpc[] = [];
let reply: { data: unknown; error: unknown } = { data: null, error: null };

const client = {
  rpc: (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, request: args.p_request as Record<string, unknown> });
    return Promise.resolve(reply);
  }
};

vi.mock('@/lib/supabase/data', () => ({
  createDataClient: async () => client
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }));

import { getFormToComplete } from '../fill';
import { completeForm } from '../service';

const FORM = '11111111-1111-1111-1111-111111111111';
const REVISION = '22222222-2222-2222-2222-222222222222';
const SUBMISSION = '33333333-3333-3333-3333-333333333333';
const COMMAND = '44444444-4444-4444-4444-444444444444';

const entitled = {
  data: {
    ok: true,
    read_type: 'FORM_TO_COMPLETE',
    data: {
      form_id: FORM,
      revision_id: REVISION,
      revision: 3,
      title: 'Weekly van check',
      description: 'Before you set off.',
      definition: {
        fields: [{ id: 'mileage', type: 'number', label: 'Mileage' }]
      }
    }
  },
  error: null
};

/** How the database refuses: a P0001 whose message starts with the code. */
const refusal = (code: string) => ({
  data: null,
  error: { code: 'P0001', message: `${code}: refused`, details: null }
});

beforeEach(() => {
  calls.length = 0;
  reply = { data: null, error: null };
});

describe('opening a form to complete', () => {
  it('opens for a person with no forms.* permission at all', async () => {
    reply = entitled;
    const result = await getFormToComplete(FORM);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.form.revisionId).toBe(REVISION);
    expect(result.form.definition.fields).toHaveLength(1);
    // The one question asked, asked of the database.
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('execute_operations_read');
    expect(calls[0].request).toEqual({
      read_type: 'FORM_TO_COMPLETE',
      form_id: FORM
    });
  });

  it('refuses a person the form does not entitle, without saying why', async () => {
    reply = refusal('FORMS_COMPLETION_DENIED');
    const result = await getFormToComplete(FORM);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 'denied' is all the page is told, so it can only show "not found". Which
    // of not-entitled, not-published or workflow-owned it was would describe
    // forms this person cannot see.
    expect(result.reason).toBe('denied');
  });

  it('does not show a form whose revision arrived without a definition', async () => {
    reply = {
      data: { ok: true, data: { form_id: FORM, revision_id: REVISION } },
      error: null
    };
    const result = await getFormToComplete(FORM);
    expect(result).toEqual({ ok: false, reason: 'denied' });
  });

  it('reports a backend that has not been updated, rather than an empty form', async () => {
    reply = {
      data: null,
      error: { code: 'PGRST202', message: 'not found', details: null }
    };
    const result = await getFormToComplete(FORM);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unavailable');
  });
});

describe('submitting a completed form', () => {
  const input = {
    formId: FORM,
    revisionId: REVISION,
    submissionId: SUBMISSION,
    answers: { mileage: 41_200 }
  };

  it('goes through the FORM_COMPLETE command, with the revision that was on screen', async () => {
    reply = {
      data: { result: { submission_id: SUBMISSION }, replayed: false },
      error: null
    };
    const outcome = await completeForm(input, COMMAND);

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('execute_command');
    expect(calls[0].request).toEqual({
      command_id: COMMAND,
      command_type: 'FORM_COMPLETE',
      payload: {
        form_id: FORM,
        // The revision the person answered, not whichever is current when they
        // press Submit.
        revision_id: REVISION,
        submission_id: SUBMISSION,
        answers: { mileage: 41_200 }
      }
    });
    // No forms.* permission is claimed, sent or checked anywhere in the payload.
    expect(JSON.stringify(calls[0].request)).not.toMatch(/forms\./);
  });

  it('shows the database refusal when entitlement has gone since the page loaded', async () => {
    reply = refusal('FORMS_COMPLETION_DENIED');
    const outcome = await completeForm(input, COMMAND);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe('FORMS_COMPLETION_DENIED');
    expect(outcome.message).toContain('not one you can complete here');
  });
});

describe('the fill page itself', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/app/dashboard/forms/[id]/fill/page.tsx'),
    'utf8'
  );

  it('gates on nothing but the form, never on a forms.* permission', () => {
    // The redirect this page exists to remove. If a permission check is ever
    // added here, the person the form was assigned to loses it again.
    expect(source).not.toContain('getPermissions');
    expect(source).not.toContain('permissions.has');
    for (const permission of [
      'forms.read',
      'forms.edit',
      'forms.publish',
      'forms.create',
      'forms.responses.read'
    ]) {
      expect(
        source,
        `${permission} must not gate completing a form`
      ).not.toContain(permission);
    }
  });

  it('renders the shared FormRenderer, not a second rendering of a form', () => {
    expect(source).toContain('<FillForm');
    const component = readFileSync(
      join(process.cwd(), 'src/features/forms/components/fill-form.tsx'),
      'utf8'
    );
    // The same component the recipient and the preview get. A second renderer
    // would drift from it question type by question type.
    expect(component).toContain(
      "import { FormRenderer } from './form-renderer'"
    );
    expect(component).toContain('<FormRenderer');
  });
});
