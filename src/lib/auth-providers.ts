import 'server-only';

import { getSupabaseEnv } from './supabase/env';

/**
 * Whether Google sign-in is switched on in this Supabase project (Authentication
 * > Providers > Google). The button is only shown when it is, so staff never
 * meet a broken "Continue with Google".
 */
export async function isGoogleSignInEnabled(): Promise<boolean> {
  try {
    const { url, anonKey } = getSupabaseEnv();
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      next: { revalidate: 300 }
    });
    if (!res.ok) return false;
    const settings = (await res.json()) as { external?: { google?: boolean } };
    return settings.external?.google === true;
  } catch {
    return false;
  }
}
