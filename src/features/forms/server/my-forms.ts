import 'server-only';

import { readOps } from '@/lib/backend/read';

// The forms this person may COMPLETE, which is a different question from the
// forms they may administer. Needing Forms administration in order to be shown
// the form you are expected to fill in was the whole problem; this read
// requires no forms.* permission at all.

export interface CompletableForm {
  formId: string;
  title: string;
  description: string | null;
  accessMode: 'Invitation' | 'Roles' | 'Workflow';
  revision: number;
  /** Where completing it actually happens — the owning workflow, never a generic endpoint. */
  route: {
    kind: 'programme' | 'direct';
    href: string;
    context: string;
    programmeName?: string;
  } | null;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

export async function listMyForms(): Promise<CompletableForm[]> {
  const result = await readOps<Json>('MY_FORMS');
  if (!result.ok) return [];
  const rows = Array.isArray((result.data ?? {}).forms)
    ? ((result.data as Json).forms as Json[])
    : [];
  return rows.map((raw) => {
    const route = raw.route as Json | null;
    return {
      formId: String(raw.form_id),
      title: str(raw.title) ?? 'Form',
      description: str(raw.description),
      accessMode: (str(raw.access_mode) ??
        'Invitation') as CompletableForm['accessMode'],
      revision: typeof raw.revision === 'number' ? raw.revision : 0,
      route: route
        ? {
            kind: route.kind === 'programme' ? 'programme' : 'direct',
            href: str(route.href) ?? '#',
            context: str(route.context) ?? '',
            programmeName: str(route.programme_name) ?? undefined
          }
        : null
    };
  });
}

/** Whether to offer the Forms area at all to somebody with no admin rights. */
export async function hasCompletableForms(): Promise<boolean> {
  return (await listMyForms()).length > 0;
}
