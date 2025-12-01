import { createClient } from '@supabase/supabase-js';

/**
 * Creates a server-side Supabase client using the service role key.
 *
 * IMPORTANT: This should ONLY be used in API routes and server components.
 * Never import this in client components.
 *
 * Auth is handled by Clerk, not Supabase. Session persistence is disabled.
 */
export function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false
    },
    global: {
      headers: { 'X-Client-Info': 'qr-inventory-server' }
    }
  });
}
