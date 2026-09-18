'use server';

import { getSiteUrl } from '@/lib/site-url';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import { createClient as createPlainClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { z } from 'zod';

export interface AuthFormState {
  error: string | null;
  notice?: string | null;
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1)
});

export async function signIn(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Enter your email and password.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'Incorrect email or password.' };

  redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
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
