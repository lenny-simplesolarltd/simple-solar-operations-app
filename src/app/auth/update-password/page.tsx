import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { UpdatePasswordForm } from '../auth-forms';
import { AuthShell } from '../auth-shell';

export const metadata: Metadata = {
  title: 'Set password | Simple Solar Operations'
};

// Reached from an invite or password-recovery email, via /auth/confirm.
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  return (
    <AuthShell title='Set your password' description={user.email}>
      <UpdatePasswordForm />
    </AuthShell>
  );
}
