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
  /**
   * Present only in "View as user" developer preview: this AppUser is the
   * EFFECTIVE (previewed) person and `preview` names the REAL signed-in one.
   */
  preview?: { realPersonId: string; realName: string; realEmail: string };
}

export type SessionState =
  | { status: 'signed-out' }
  /** Authenticated, but not an active person with an active role. */
  | { status: 'no-access'; email: string | null }
  | { status: 'signed-in'; user: AppUser; authUserId: string };

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
    authUserId: authUser.id,
    user: {
      id: actor.person_id,
      email: actor.email ?? authUser.email ?? '',
      fullName: actor.display_name,
      roles: actor.roles as RoleCode[]
    }
  };
});

/** The REAL authenticated person. Use for security decisions, audit and anything that writes. */
export async function getAuthenticatedUser(): Promise<AppUser | null> {
  const session = await getSessionState();
  return session.status === 'signed-in' ? session.user : null;
}

/**
 * The EFFECTIVE person for presentation and read authorization: normally the
 * authenticated user; in developer preview, the previewed person - whose
 * identity and roles are read back FROM THE DATABASE through the preview token,
 * never taken from the browser. If the database does not confirm the target
 * (hook not installed, target inactive/unknown), preview silently does not apply.
 */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const real = await getAuthenticatedUser();
  if (!real) return null;

  const { getActivePreview } = await import('@/lib/preview/context');
  const preview = await getActivePreview();
  if (!preview) return real;

  const { createDataReadClient } = await import('@/lib/supabase/data');
  const client = await createDataReadClient(preview);
  const { data } = await client.rpc('current_actor');
  const target = data?.[0];
  if (
    !target ||
    target.person_id !== preview.targetPersonId ||
    target.roles.length === 0
  ) {
    return real;
  }
  return {
    id: target.person_id,
    email: target.email ?? '',
    fullName: target.display_name,
    roles: target.roles as RoleCode[],
    preview: {
      realPersonId: real.id,
      realName: real.fullName ?? real.email,
      realEmail: real.email
    }
  };
});
