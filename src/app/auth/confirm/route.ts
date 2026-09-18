import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

const OTP_TYPES: EmailOtpType[] = ['invite', 'recovery', 'email', 'magiclink'];

// Landing point for invite and password-recovery emails. Verifying the token
// confirms the email address, which is what links the login to its person.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type
    });
    if (!error) {
      const next =
        type === 'invite' || type === 'recovery'
          ? '/auth/update-password'
          : '/dashboard';
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL('/auth/sign-in', request.url));
}
