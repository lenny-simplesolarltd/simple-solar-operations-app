import 'server-only';

import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import type { ToolActor } from './registry';

/**
 * The assistant's actor is the signed-in staff member, resolved exactly as the
 * rest of the app resolves it: Supabase session -> current_actor() -> active
 * person -> active roles -> permissions. Nothing from the request body, the
 * page context or the model can influence it. Returns null when there is no
 * active staff session (signed out, or signed in without an active role).
 */
export async function resolveAssistantActor(): Promise<ToolActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const permissions = await getPermissions(user);
  return { user, permissions };
}
