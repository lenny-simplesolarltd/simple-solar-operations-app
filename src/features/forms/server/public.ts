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
  | 'not_found'
  /** Forms is switched off (release gate): nothing is shown or accepted. */
  | 'unavailable';

/** Where the person reading a view link would actually complete it. */
export interface CompletionRoute {
  kind: 'programme' | 'direct';
  href: string;
  context: string;
  programmeName?: string;
}

export interface PublicForm {
  state: PublicFormState;
  title?: string;
  description?: string | null;
  definition?: FormDefinition | null;
  submittedAt?: string | null;
  /**
   * The questions need an account, so the link shows them and does not ask
   * them. Anyone may read it; only a signed-in person with the work can
   * record it, and the database refuses a submission through this route.
   */
  viewOnly?: boolean;
  /** Null for a visitor with no account, and for staff without this work. */
  completionRoute?: CompletionRoute | null;
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
    view_only?: boolean;
    completion_route?: {
      kind?: string;
      href?: string;
      context?: string;
      programme_name?: string;
    } | null;
  };
  const route = d.completion_route;
  return {
    state: d.state,
    title: d.title,
    description: d.description,
    definition: d.definition,
    submittedAt: d.submitted_at,
    viewOnly: d.view_only === true,
    completionRoute:
      route && route.href
        ? {
            kind: route.kind === 'programme' ? 'programme' : 'direct',
            href: route.href,
            context: route.context ?? '',
            ...(route.programme_name
              ? { programmeName: route.programme_name }
              : {})
          }
        : null
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
