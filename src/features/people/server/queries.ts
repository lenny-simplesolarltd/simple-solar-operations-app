import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

/**
 * Who holds each role.
 *
 * Choosing an audience by role means choosing people, and a role name alone
 * does not say who that is - "Installer" is nine names to somebody who knows
 * the team and none at all to somebody who does not. This answers the question
 * the form editor was asking a manager to answer from memory.
 *
 * Read under the signed-in person's own RLS, deliberately, not with elevated
 * credentials: office-class staff see the whole directory, and a field worker
 * sees only themselves. So this returns what that person may already look up on
 * the People screen and never more. It follows that the caller must cope with
 * an empty or partial answer rather than treating it as the truth about the
 * team.
 */
export interface RoleMember {
  id: string;
  name: string;
  email: string | null;
}

export type RoleMembers = Record<string, RoleMember[]>;

export async function listRoleMembers(): Promise<RoleMembers> {
  const supabase = await createDataClient();

  const [{ data: roles, error: rolesError }, { data: people, error }] =
    await Promise.all([
      supabase
        .from('person_roles')
        .select('person_id, role_code')
        .eq('active', true),
      supabase
        .from('people')
        .select('id, display_name, email')
        .eq('active', true)
    ]);
  // A directory this person cannot read is not an error worth breaking the
  // editor over: the roles still work, they just appear without faces.
  if (rolesError || error || !roles || !people) return {};

  const byId = new Map(people.map((p) => [p.id as string, p]));
  const members: RoleMembers = {};
  for (const row of roles) {
    const person = byId.get(row.person_id as string);
    if (!person) continue;
    const code = row.role_code as string;
    (members[code] ??= []).push({
      id: person.id as string,
      name: (person.display_name as string) ?? 'Unknown',
      email: (person.email as string) ?? null
    });
  }
  for (const list of Object.values(members))
    list.sort((a, b) => a.name.localeCompare(b.name));
  return members;
}
