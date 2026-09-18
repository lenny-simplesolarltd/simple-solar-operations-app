'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthShell } from '../auth-shell';

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
    <AuthShell
      title={failed ? 'Link expired' : 'Signing you in…'}
      description={
        failed
          ? 'This link has expired or was already used.'
          : 'One moment while we finish signing you in.'
      }
    >
      {failed ? (
        <div className='text-sm'>
          <p className='text-muted-foreground mb-3'>
            Invite and password links work once and expire. Ask for a new one,
            or reset your password.
          </p>
          <Link
            className='underline underline-offset-4'
            href='/auth/forgot-password'
          >
            Reset my password
          </Link>
        </div>
      ) : (
        <div role='status' aria-live='polite' className='space-y-2'>
          <Skeleton className='h-9 w-full' />
          <Skeleton className='h-9 w-2/3' />
        </div>
      )}
    </AuthShell>
  );
}
