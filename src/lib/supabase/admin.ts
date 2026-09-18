import 'server-only';

import type { Database } from '@/types/database';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. SERVER ONLY - it bypasses RLS, so it is never created
 * from a NEXT_PUBLIC_* value and never imported by client code ('server-only'
 * makes that a build error). Callers must authorize the signed-in actor FIRST;
 * its only use is Supabase Auth administration (inviting staff).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set on the server');
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
