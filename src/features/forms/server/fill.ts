import 'server-only';

import { readOps } from '@/lib/backend/read';
import type { FormDefinition } from '../definition';

// The reading half of completing a form in the app.
//
// Eligibility is asked of the database and nowhere else: app.read_form_to_complete
// returns the questions only when app.form_completion_route already says this
// person may complete this form directly. There is no forms.read check here on
// purpose - a filler is not an administrator, and gating the page on forms.read
// is exactly what made an installer unable to reach the form they were sent to
// fill in.

export interface FormToComplete {
  formId: string;
  /** The revision on screen, so the submission records what was actually answered. */
  revisionId: string;
  revision: number;
  title: string;
  description: string | null;
  definition: FormDefinition;
}

export type FormToCompleteResult =
  | { ok: true; form: FormToComplete }
  /**
   * Not entitled, not published, or owned by a workflow - the database does not
   * distinguish them, so neither does this. The caller shows "not found".
   */
  | { ok: false; reason: 'denied' }
  /** Something else went wrong; `message` is the read boundary's own wording. */
  | { ok: false; reason: 'unavailable'; message: string };

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

const EMPTY: FormDefinition = { fields: [] };

export async function getFormToComplete(
  formId: string
): Promise<FormToCompleteResult> {
  const result = await readOps<Json>('FORM_TO_COMPLETE', { form_id: formId });
  if (!result.ok) {
    // A role the registry does not list, and the form's own refusal, both land
    // here as a refusal. Neither is a fault to report in detail.
    if (result.error.kind === 'forbidden' || result.error.kind === 'not_found')
      return { ok: false, reason: 'denied' };
    return { ok: false, reason: 'unavailable', message: result.error.message };
  }
  const data = result.data ?? {};
  const revisionId = str(data.revision_id);
  const definition = data.definition as FormDefinition | null;
  if (!revisionId || !definition || !Array.isArray(definition.fields)) {
    // A published form always has a revision with a definition. If one arrives
    // without, showing an empty form that cannot be submitted would be worse
    // than saying the form could not be opened.
    return { ok: false, reason: 'denied' };
  }
  return {
    ok: true,
    form: {
      formId: str(data.form_id) ?? formId,
      revisionId,
      revision: typeof data.revision === 'number' ? data.revision : 0,
      title: str(data.title) ?? 'Form',
      description: str(data.description),
      definition: definition ?? EMPTY
    }
  };
}
