import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { getSessionState } from '@/lib/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signOut } from '../actions';
import { SignInForm } from '../auth-forms';

export const metadata: Metadata = {
  title: 'Sign in | Simple Solar Operations'
};

const NOTICES: Record<string, string> = {
  'link-expired':
    'That link has expired or was already used. Sign in, or reset your password.'
};

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const session = await getSessionState();
  if (session.status === 'signed-in') redirect('/dashboard');

  return (
    <div className='flex min-h-screen items-center justify-center p-4'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Simple Solar Operations</CardTitle>
          <CardDescription>
            {session.status === 'no-access'
              ? 'This account does not have access.'
              : 'Sign in with your work email.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {session.status === 'no-access' ? (
            <div className='space-y-4'>
              <p className='text-muted-foreground text-sm'>
                {session.email ?? 'This login'} is not linked to an active
                member of staff with a role. Ask an administrator to check your
                staff record.
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
                <p role='status' className='text-muted-foreground text-sm'>
                  {NOTICES[notice]}
                </p>
              )}
              <SignInForm />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
