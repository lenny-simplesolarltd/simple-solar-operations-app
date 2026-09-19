import { getSupabaseEnv } from '@/lib/supabase/env';
import {
  KEEP_SIGNED_IN_COOKIE,
  keepSignedIn,
  withPersistence
} from '@/lib/supabase/session-persistence';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Keeps the Supabase session cookie fresh and turns away signed-out visitors.
// Authorization is NOT decided here: pages resolve the actor through
// getCurrentUser() and the database enforces RLS.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();
  // Token refreshes must honour "Keep me signed in" too, or the session
  // would quietly become persistent on the next refresh.
  const keep = keepSignedIn(request.cookies.get(KEEP_SIGNED_IN_COOKIE)?.value);

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, withPersistence(options, keep))
        );
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Protected routes: no session, no page. (Pages still resolve the actor and
  // the database still enforces RLS - this is the outer gate, not the only one.)
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'
  ]
};
