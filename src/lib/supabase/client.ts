import type { Database } from '@/types/database';
import { createBrowserClient } from '@supabase/ssr';

/** Browser client. Uses the public anon key; the session lives in cookies shared with the server. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
