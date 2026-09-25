import 'server-only';

import { readOps } from '@/lib/backend/read';

// Who may COMPLETE a form, as the form manager sees it. The FORM_ACCESS read
// requires forms.read, because this is administration - the opposite end of the
// same question MY_FORMS answers for the person filling the form in.

export type AccessMode = 'Invitation' | 'Roles' | 'Workflow';

export interface FormAccess {
  formId: string;
  mode: AccessMode;
  /** True when a programme points its visit form at this form: the programme decides. */
  workflowOwned: boolean;
  workflowName: string | null;
  roles: string[];
  allRoles: string[];
}

type Json = Record<string, unknown>;
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export async function getFormAccess(
  formId: string
): Promise<FormAccess | null> {
  const result = await readOps<Json>('FORM_ACCESS', { form_id: formId });
  if (!result.ok) return null;
  const data = result.data ?? {};
  const mode = data.access_mode;
  return {
    formId,
    mode:
      mode === 'Roles' || mode === 'Workflow' || mode === 'Invitation'
        ? mode
        : 'Invitation',
    workflowOwned: data.workflow_owned === true,
    workflowName:
      typeof data.workflow_name === 'string' ? data.workflow_name : null,
    roles: strings(data.roles),
    allRoles: strings(data.all_roles)
  };
}
