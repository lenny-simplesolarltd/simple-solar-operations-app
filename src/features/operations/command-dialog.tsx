'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import type { CommandOutcome } from '@/lib/backend/types';
import { IconLoader2 } from '@tabler/icons-react';

/** The server's refusal, worded by the database catalogue. */
export function OutcomeAlert({ outcome }: { outcome: CommandOutcome }) {
  return (
    <Alert
      variant={outcome.status === 'ActionRequired' ? 'default' : 'destructive'}
    >
      <AlertTitle>{outcome.heading}</AlertTitle>
      <AlertDescription>
        {outcome.message}
        {outcome.detail && (
          <span className='block text-xs opacity-80'>{outcome.detail}</span>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Dialog chrome shared by every command form: the form, the server's answer
 * when it refuses, and one submit button. It never decides whether the action
 * is allowed - the button is only offered when the read model says so, and
 * the command re-checks everything.
 */
export function CommandDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  pending,
  outcome,
  canSubmit = true,
  onSubmit,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  outcome: CommandOutcome | null;
  canSubmit?: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending && canSubmit) onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          {children}
          {outcome && <OutcomeAlert outcome={outcome} />}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={pending || !canSubmit}>
              {pending && <IconLoader2 className='size-4 animate-spin' />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
