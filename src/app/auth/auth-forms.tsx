'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useActionState } from 'react';
import { signIn, updatePassword, type AuthFormState } from './actions';

const initialState: AuthFormState = { error: null };

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role='alert' className='text-destructive text-sm'>
      {message}
    </p>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, initialState);

  return (
    <form action={action} className='space-y-4'>
      <div className='space-y-2'>
        <Label htmlFor='email'>Email</Label>
        <Input
          id='email'
          name='email'
          type='email'
          autoComplete='email'
          required
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='password'>Password</Label>
        <Input
          id='password'
          name='password'
          type='password'
          autoComplete='current-password'
          required
        />
      </div>
      <FormError message={state.error} />
      <Button type='submit' className='w-full' disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
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
