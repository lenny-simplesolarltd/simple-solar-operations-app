import 'server-only';

import { getSessionState } from '@/lib/auth';
import { getPreviewRuntime, mayStartPreview } from '@/lib/preview/config';
import { createClient } from '@/lib/supabase/server';

export interface PreviewTarget {
  id: string;
  name: string;
  roles: string[];
}

/** Null unless this runtime AND this real user may preview. Read as the REAL user, never as the target. */
export async function getPreviewTargets(): Promise<PreviewTarget[] | null> {
  const session = await getSessionState();
  if (session.status !== 'signed-in') return null;
  if (!mayStartPreview(getPreviewRuntime(), session.user)) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from('people')
    .select(
      'id, display_name, active, person_roles!person_roles_person_id_fkey(role_code, active)'
    )
    .eq('active', true)
    .order('display_name');
  return (data ?? [])
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      roles: p.person_roles
        .filter((r) => r.active)
        .map((r) => r.role_code)
        .sort()
    }))
    .filter((p) => p.roles.length > 0 && p.id !== session.user.id);
}
