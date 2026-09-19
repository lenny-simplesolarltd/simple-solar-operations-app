import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Answers, FormDefinition } from '../definition';
import { formsMessage } from '../errors';
import { TOKEN_PATTERN } from './tokens';

/**
 * The recipient side. Recipients have no account: these call the two
 * SECURITY DEFINER entry points with the raw token (as the anon role, or as
 * whoever happens to be signed in), and the database hashes it, checks the
 * link's state and validates every answer against the revision the link was
 * made for. No service-role key is involved.
 */

export type PublicFormState =
  | 'open'
  | 'submitted'
  | 'revoked'
  | 'expired'
  | 'closed'
  | 'not_found';

export interface PublicForm {
  state: PublicFormState;
  title?: string;
  description?: string | null;
  definition?: FormDefinition | null;
  submittedAt?: string | null;
}

export async function openPublicForm(token: string): Promise<PublicForm> {
  if (!TOKEN_PATTERN.test(token)) return { state: 'not_found' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('forms_public_open', {
    p_token: token
  });
  if (error) throw new Error(`forms_public_open: ${error.message}`);
  const d = data as {
    state: PublicFormState;
    title?: string;
    description?: string | null;
    definition?: FormDefinition | null;
    submitted_at?: string | null;
  };
  return {
    state: d.state,
    title: d.title,
    description: d.description,
    definition: d.definition,
    submittedAt: d.submitted_at
  };
}

export type SubmitOutcome =
  | { ok: true; state: 'submitted' }
  | { ok: false; state: PublicFormState; message: string; field?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitPublicForm(
  token: string,
  submissionId: string,
  answers: Answers
): Promise<SubmitOutcome> {
  if (!TOKEN_PATTERN.test(token) || !UUID.test(submissionId)) {
    return {
      ok: false,
      state: 'not_found',
      message: 'This link is not valid.'
    };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('forms_public_submit', {
    p_token: token,
    p_submission_id: submissionId,
    p_answers: answers as never
  });
  if (error) {
    if (error.code !== 'P0001') {
      // eslint-disable-next-line no-console -- server-side diagnostics; the recipient gets safe wording
      console.error('forms_public_submit failed', error.code);
      return {
        ok: false,
        state: 'open',
        message: 'Your answers could not be sent. Please try again.'
      };
    }
    const code = error.message.split(':')[0].trim();
    let field: string | undefined;
    try {
      field = error.details ? JSON.parse(error.details)?.field : undefined;
    } catch {
      field = undefined;
    }
    return { ok: false, state: 'open', message: formsMessage(code), field };
  }
  const d = data as { ok: boolean; state: PublicFormState };
  if (d.ok) return { ok: true, state: 'submitted' };
  return {
    ok: false,
    state: d.state,
    message:
      d.state === 'submitted'
        ? 'A response has already been sent from this link.'
        : 'This link can no longer be used.'
  };
}
