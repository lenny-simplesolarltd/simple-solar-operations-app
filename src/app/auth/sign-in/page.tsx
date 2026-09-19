import { Button } from '@/components/ui/button';
import { getSessionState } from '@/lib/auth';
import { isGoogleSignInEnabled } from '@/lib/auth-providers';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signOut } from '../actions';
import { AuthShell } from '../auth-shell';
import { SignInForm } from '../auth-forms';

export const metadata: Metadata = {
  title: 'Sign in | Simple Solar Operations'
};

const NOTICES: Record<string, string> = {
  'link-expired':
    'That link has expired or was already used. Sign in, or reset your password.',
  'google-failed': 'Google sign-in did not complete. Try again.',
  'google-unavailable': 'Google sign-in is not available right now.',
  'google-no-access':
    'That Google account is not linked to an active member of staff. Use your work Google account, or sign in with your email and password.'
};

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const session = await getSessionState();
  if (session.status === 'signed-in') redirect('/dashboard');
  const googleEnabled = await isGoogleSignInEnabled();

  return (
    <AuthShell
      title={session.status === 'no-access' ? 'No access' : 'Sign in'}
      description={
        session.status === 'no-access'
          ? 'This account does not have access.'
          : 'Sign in with your work email.'
      }
    >
      {session.status === 'no-access' ? (
        <div className='space-y-4'>
          <p className='text-muted-foreground text-sm'>
            {session.email ?? 'This login'} is not linked to an active member of
            staff with a role. Ask an administrator to check your staff record.
          </p>
          <form action={signOut}>
            <Button type='submit' variant='outline' className='w-full'>
              Sign out
            </Button>
          </form>
        </div>
      ) : (
        <div className='space-y-4'>
          {notice && NOTICES[notice] && (
            <p
              role='status'
              className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'
            >
              {NOTICES[notice]}
            </p>
          )}
          <SignInForm googleEnabled={googleEnabled} />
        </div>
      )}
    </AuthShell>
  );
}
