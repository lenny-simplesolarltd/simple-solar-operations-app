'use server';

import { getSiteUrl } from '@/lib/site-url';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { PREVIEW_COOKIE } from '@/lib/preview/config';
import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import {
  KEEP_SIGNED_IN_COOKIE,
  markerCookieOptions
} from '@/lib/supabase/session-persistence';
import { cookies } from 'next/headers';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { z } from 'zod';

export interface AuthFormState {
  error: string | null;
  notice?: string | null;
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
  remember: z.enum(['on']).optional()
});

/**
 * Staff-facing wording for Supabase Auth failures. "Incorrect email or password"
 * is reserved for genuinely wrong credentials, so a rate limit or an unreachable
 * Auth server is never misreported as a bad password.
 */
function signInErrorMessage(error: {
  code?: string;
  status?: number;
  message: string;
}) {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.';
    case 'email_not_confirmed':
      return 'This email address has not been confirmed yet. Use the link in your invite email.';
    case 'user_banned':
      return 'This account has been suspended. Ask an administrator.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many sign-in attempts. Wait a minute and try again.';
  }
  if (error.status === 429)
    return 'Too many sign-in attempts. Wait a minute and try again.';
  return 'Sign-in is unavailable right now (the authentication service could not be reached). Try again shortly.';
}

/** Records the "Keep me signed in" choice for this browser. */
async function rememberChoice(keep: boolean) {
  (await cookies()).set(
    KEEP_SIGNED_IN_COOKIE,
    keep ? '1' : '0',
    markerCookieOptions(keep, process.env.NODE_ENV === 'production')
  );
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Enter your email and password.' };

  const keep = parsed.data.remember === 'on';
  await rememberChoice(keep);
  const supabase = await createClient({ keep });
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password
  });
  if (error) {
    if (error.code !== 'invalid_credentials') {
      console.error('sign-in failed', {
        code: error.code,
        status: error.status,
        message: error.message
      });
    }
    return { error: signInErrorMessage(error) };
  }

  redirect('/dashboard');
}

/**
 * Google sign-in (Supabase OAuth, PKCE). Supabase links a Google identity to the
 * EXISTING account with the same verified email, so a person never gets a second
 * account; /auth/callback then refuses anyone who is not active staff.
 */
export async function signInWithGoogle(formData: FormData) {
  const keep = formData.get('remember') === 'on';
  await rememberChoice(keep);
  const supabase = await createClient({ keep });
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${await getSiteUrl()}/auth/callback`,
      queryParams: { prompt: 'select_account' }
    }
  });
  if (error || !data.url) {
    console.error('google sign-in could not start', error);
    redirect('/auth/sign-in?notice=google-unavailable');
  }
  redirect(data.url);
}

export async function signOut() {
  const cookieStore = await cookies();
  // Preview never outlives the session that started it.
  cookieStore.delete(PREVIEW_COOKIE);
  const supabase = await createClient();
  await supabase.auth.signOut();
  cookieStore.delete(KEEP_SIGNED_IN_COOKIE);
  redirect('/auth/sign-in');
}

const passwordSchema = z
  .object({
    password: z.string().min(10, 'Use at least 10 characters.'),
    confirm: z.string()
  })
  .refine((v) => v.password === v.confirm, 'The passwords do not match.');

export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const blocked = await previewWriteBlock();
  if (blocked) return { error: blocked };

  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password
  });
  if (error) return { error: error.message };

  redirect('/dashboard');
}

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email())
});

/**
 * Supabase's normal recovery flow: Supabase emails the link, the person sets
 * their own password on /auth/update-password. The reply is the same whether
 * or not the address has an account.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Enter your work email address.' };

  // Implicit flow, no stored session: the emailed link then works on any
  // device, not only the browser that asked for it.
  const { url, anonKey } = getSupabaseEnv();
  const supabase = createPlainClient(url, anonKey, {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false
    }
  });
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: `${await getSiteUrl()}/auth/confirm`
    }
  );
  if (error && error.status === 429) {
    return { error: 'Too many requests. Wait a few minutes and try again.' };
  }

  return {
    error: null,
    notice:
      'If that address has an account, a password reset link is on its way.'
  };
}
