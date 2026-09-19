'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Eye, EyeOff } from 'lucide-react';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  requestPasswordReset,
  signIn,
  signInWithGoogle,
  updatePassword,
  type AuthFormState
} from './actions';

const initialState: AuthFormState = { error: null };

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role='alert'
      className='bg-destructive-soft text-destructive rounded-md px-3 py-2 text-sm'
    >
      {message}
    </p>
  );
}

export function SignInForm({
  googleEnabled = false
}: {
  googleEnabled?: boolean;
}) {
  const [state, action, pending] = useActionState(signIn, initialState);
  // Controlled fields: React resets uncontrolled inputs after a form action, which
  // wiped what the person typed whenever sign-in failed.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);

  return (
    <div className='space-y-4'>
      <form action={action} className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='email'>Email</Label>
          <Input
            id='email'
            name='email'
            type='email'
            autoComplete='email'
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='password'>Password</Label>
          <div className='relative'>
            <Input
              id='password'
              name='password'
              type={showPassword ? 'text' : 'password'}
              autoComplete='current-password'
              autoCapitalize='none'
              autoCorrect='off'
              spellCheck={false}
              required
              className='pr-11'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type='button'
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls='password'
              className='text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md focus-visible:ring-2 focus-visible:outline-none'
            >
              {showPassword ? (
                <EyeOff className='size-4' />
              ) : (
                <Eye className='size-4' />
              )}
            </button>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <Checkbox
            id='remember'
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          {remember && <input type='hidden' name='remember' value='on' />}
          <Label htmlFor='remember' className='font-normal'>
            Keep me signed in
          </Label>
        </div>
        <FormError message={state.error} />
        <Button type='submit' className='w-full' disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className='text-center text-sm'>
          <Link
            className='text-muted-foreground hover:text-foreground underline underline-offset-4'
            href='/auth/forgot-password'
          >
            Forgot your password?
          </Link>
        </p>
      </form>

      {googleEnabled && (
        <>
          <div className='text-muted-foreground flex items-center gap-3 text-xs uppercase'>
            <span className='bg-border h-px flex-1' />
            or
            <span className='bg-border h-px flex-1' />
          </div>
          <form action={signInWithGoogle}>
            {remember && <input type='hidden' name='remember' value='on' />}
            <GoogleButton />
          </form>
        </>
      )}
    </div>
  );
}

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type='submit'
      variant='outline'
      className='w-full'
      disabled={pending}
    >
      <svg aria-hidden viewBox='0 0 24 24' className='size-4'>
        <path
          fill='#4285F4'
          d='M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z'
        />
        <path
          fill='#34A853'
          d='M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z'
        />
        <path
          fill='#FBBC05'
          d='M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z'
        />
        <path
          fill='#EA4335'
          d='M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z'
        />
      </svg>
      {pending ? 'Opening Google…' : 'Continue with Google'}
    </Button>
  );
}

export function UpdatePasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={action} className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='password'>New password</Label>
        <Input
          id='password'
          name='password'
          type='password'
          autoComplete='new-password'
          required
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='confirm'>Confirm password</Label>
        <Input
          id='confirm'
          name='confirm'
          type='password'
          autoComplete='new-password'
          required
        />
      </div>
      <FormError message={state.error} />
      <Button type='submit' className='w-full' disabled={pending}>
        {pending ? 'Saving…' : 'Set password'}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialState
  );

  if (state.notice) {
    return (
      <p
        role='status'
        className='bg-success-soft text-success rounded-md px-3 py-2 text-sm'
      >
        {state.notice}
      </p>
    );
  }

  return (
    <form action={action} className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='email'>Work email</Label>
        <Input
          id='email'
          name='email'
          type='email'
          autoComplete='email'
          required
        />
      </div>
      <FormError message={state.error} />
      <Button type='submit' className='w-full' disabled={pending}>
        {pending ? 'Sending…' : 'Email me a reset link'}
      </Button>
    </form>
  );
}
