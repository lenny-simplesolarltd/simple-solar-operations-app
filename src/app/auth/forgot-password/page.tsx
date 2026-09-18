import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ForgotPasswordForm } from '../auth-forms';

export const metadata: Metadata = {
  title: 'Reset password | Simple Solar Operations'
};

export default function ForgotPasswordPage() {
  return (
    <div className='flex min-h-screen items-center justify-center p-4'>
      <Card className='w-full max-w-md'>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            We will email you a link. You choose the new password yourself.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <ForgotPasswordForm />
          <p className='text-center text-sm'>
            <Link
              className='text-muted-foreground underline'
              href='/auth/sign-in'
            >
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
