import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '../auth-forms';
import { AuthShell } from '../auth-shell';

export const metadata: Metadata = {
  title: 'Reset password | Simple Solar Operations'
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title='Reset your password'
      description='We will email you a link. You choose the new password yourself.'
    >
      <div className='space-y-4'>
        <ForgotPasswordForm />
        <p className='text-center text-sm'>
          <Link
            className='text-muted-foreground hover:text-foreground underline underline-offset-4'
            href='/auth/sign-in'
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
