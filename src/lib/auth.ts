import type { RoleCode } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';
import { cache } from 'react';

/**
 * The single place the app asks "who is signed in?".
 *
 * Identity derives from the Supabase session (auth.uid()), which the database
 * maps to a person and their active roles. Nothing here trusts a
 * client-supplied identity, and the result fails closed: a session that does
 * not map to an active person with at least one active role is not a user.
 */
export interface AppUser {
  /** people.id - the id used for all attribution. */
  id: string;
  email: string;
  fullName: string | null;
  roles: RoleCode[];
  imageUrl?: string;
}

export type SessionState =
  | { status: 'signed-out' }
  /** Authenticated, but not an active person with an active role. */
  | { status: 'no-access'; email: string | null }
  | { status: 'signed-in'; user: AppUser };

export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();

  const {
    data: { user: authUser }
  } = await supabase.auth.getUser();
  if (!authUser) return { status: 'signed-out' };

  const { data, error } = await supabase.rpc('current_actor');
  if (error) throw new Error(`current_actor failed: ${error.message}`);

  const actor = data?.[0];
  if (!actor || actor.roles.length === 0) {
    return { status: 'no-access', email: authUser.email ?? null };
  }

  return {
    status: 'signed-in',
    user: {
      id: actor.person_id,
      email: actor.email ?? authUser.email ?? '',
      fullName: actor.display_name,
      roles: actor.roles as RoleCode[]
    }
  };
});

export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await getSessionState();
  return session.status === 'signed-in' ? session.user : null;
}
