'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// Finishes invite / recovery links that carry the session in the URL fragment
// (Supabase's default email templates). Nothing here chooses a password: the
// person is sent on to set their own.
export default function AuthCompletePage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    // Drop the tokens from the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname);

    async function finish(): Promise<string | null> {
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (!accessToken || !refreshToken) return null;
      const { error } = await createClient().auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error) return null;
      const type = params.get('type');
      return type === 'invite' || type === 'recovery'
        ? '/auth/update-password'
        : '/dashboard';
    }

    finish().then((next) => {
      if (!next) return setFailed(true);
      router.replace(next);
      router.refresh();
    });
  }, [router]);

  return (
    <div className='flex min-h-screen items-center justify-center p-4'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Simple Solar Operations</CardTitle>
          <CardDescription>
            {failed
              ? 'This link has expired or was already used.'
              : 'Signing you in…'}
          </CardDescription>
        </CardHeader>
        {failed && (
          <CardContent className='text-sm'>
            <p className='text-muted-foreground mb-3'>
              Invite and password links work once and expire. Ask for a new one,
              or reset your password.
            </p>
            <Link className='underline' href='/auth/forgot-password'>
              Reset my password
            </Link>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
