import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';

const FRESH_ACCOUNT_MS = 5 * 60 * 1000;

/**
 * Return point for Google sign-in (OAuth + PKCE).
 *
 * Access still comes ONLY from people + person_roles. If the Google account is
 * not active staff, the session is ended - and if Supabase created a brand-new
 * auth user just now for this unknown Google account, that user is removed, so
 * a stray Google sign-in never leaves a second or orphan account behind.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const to = (path: string) =>
    NextResponse.redirect(new URL(path, request.url));

  const code = searchParams.get('code');
  if (!code) return to('/auth/sign-in?notice=google-failed');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error('google callback: code exchange failed', error);
    return to('/auth/sign-in?notice=google-failed');
  }

  const { data: actor } = await supabase.rpc('current_actor');
  if (actor?.[0] && actor[0].roles.length > 0) return to('/dashboard');

  // Not active staff. End the session first.
  const user = data.user;
  await supabase.auth.signOut();

  const providers = (user.identities ?? []).map((i) => i.provider);
  const isFreshGoogleOnlyAccount =
    providers.length > 0 &&
    providers.every((p) => p === 'google') &&
    Date.now() - new Date(user.created_at).getTime() < FRESH_ACCOUNT_MS;

  if (isFreshGoogleOnlyAccount) {
    const admin = createAdminClient();
    const { data: linked } = await admin
      .from('people')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!linked) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteError)
        console.error(
          'google callback: could not remove orphan account',
          deleteError
        );
    }
  }

  return to('/auth/sign-in?notice=google-no-access');
}
