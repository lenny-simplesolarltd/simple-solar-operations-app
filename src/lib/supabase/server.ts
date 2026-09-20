import type { Database } from '@/types/database';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseEnv } from './env';
import {
  KEEP_SIGNED_IN_COOKIE,
  keepSignedIn,
  withPersistence
} from './session-persistence';

/**
 * Supabase client for server components, server actions and route handlers.
 * It carries the signed-in user's session, so every query runs under RLS as
 * that user. There is deliberately no service-role client here.
 *
 * `keep` overrides the stored "Keep me signed in" choice (used by sign-in,
 * where the choice is being made in the same request).
 */
export async function createClient(
  options: { keep?: boolean; headers?: Record<string, string> } = {}
) {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();
  const keep =
    options.keep ?? keepSignedIn(cookieStore.get(KEEP_SIGNED_IN_COOKIE)?.value);

  return createServerClient<Database>(url, anonKey, {
    // Extra request headers are used by hosted developer preview only, to carry
    // a server-signed proof the database authenticates for itself. The session
    // (and therefore auth.uid()) remains the real signed-in user's.
    global: options.headers ? { headers: options.headers } : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
            cookieStore.set(name, value, withPersistence(cookieOptions, keep))
          );
        } catch {
          // Called from a server component, where cookies are read-only.
          // The proxy refreshes the session, so this is safe to ignore.
        }
      }
    }
  });
}
