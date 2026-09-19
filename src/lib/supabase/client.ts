import type { Database } from '@/types/database';
import { createBrowserClient } from '@supabase/ssr';
import {
  KEEP_SIGNED_IN_COOKIE,
  keepSignedIn,
  withPersistence
} from './session-persistence';

function readCookies() {
  if (typeof document === 'undefined') return [];
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=');
      return {
        name: decodeURIComponent(part.slice(0, i)),
        value: decodeURIComponent(part.slice(i + 1))
      };
    });
}

/**
 * Browser client. Uses the public anon key; the session lives in cookies shared
 * with the server. Cookie writes honour "Keep me signed in" like the server's.
 * (The marker itself is HttpOnly, so the browser cannot read it: a missing
 * marker is treated as "keep", and the server re-applies the choice on the next
 * request/refresh.)
 */
export function createClient() {
  const keep = keepSignedIn(
    readCookies().find((c) => c.name === KEEP_SIGNED_IN_COOKIE)?.value
  );
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: readCookies,
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            const o = withPersistence(options, keep) ?? {};
            const parts = [
              `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
              `Path=${o.path ?? '/'}`,
              `SameSite=${o.sameSite ?? 'Lax'}`
            ];
            if (typeof o.maxAge === 'number') parts.push(`Max-Age=${o.maxAge}`);
            if (o.domain) parts.push(`Domain=${o.domain}`);
            if (o.secure) parts.push('Secure');
            document.cookie = parts.join('; ');
          }
        }
      }
    }
  );
}
