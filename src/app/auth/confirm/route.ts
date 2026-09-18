import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

const OTP_TYPES: EmailOtpType[] = [
  'invite',
  'recovery',
  'email',
  'magiclink',
  'signup'
];
const SETS_PASSWORD: EmailOtpType[] = ['invite', 'recovery'];

// Landing point for every Supabase Auth email (invite, password recovery).
// Verifying the link proves the mailbox, which is what links a login to its
// person. Three link shapes are supported:
//   ?token_hash=&type=   recommended email templates (works on any device)
//   ?code=               PKCE links opened in the browser that requested them
//   #access_token=...    Supabase's default templates - the fragment never
//                        reaches the server, so /auth/complete finishes it.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const to = (path: string) =>
    NextResponse.redirect(new URL(path, request.url));

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type
    });
    if (error) return to('/auth/sign-in?notice=link-expired');
    return to(
      SETS_PASSWORD.includes(type) ? '/auth/update-password' : '/dashboard'
    );
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return to('/auth/sign-in?notice=link-expired');
    return to('/auth/update-password');
  }

  if (searchParams.get('error')) return to('/auth/sign-in?notice=link-expired');

  // A redirect keeps the URL fragment, so the client page can read the tokens.
  return to('/auth/complete');
}
