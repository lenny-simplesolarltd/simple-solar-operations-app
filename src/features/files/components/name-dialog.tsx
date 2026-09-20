'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IconLoader2 } from '@tabler/icons-react';
import { useEffect, useId, useState } from 'react';
import { nameProblem } from '../names';

// Naming a folder or a document. The check here mirrors app.file_name_problem
// so a person is told before the round trip; the database applies the same
// rule and has the last word.

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue,
  onSubmit
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  onSubmit: (name: string) => Promise<void> | void;
}) {
  const id = useId();
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setTouched(false);
    }
  }, [open, initialValue]);

  const problem = nameProblem(value);
  const unchanged = value.trim() === initialValue.trim();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem || unchanged) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>

          <div className='flex flex-col gap-1.5 py-4'>
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              value={value}
              autoFocus
              maxLength={80}
              onChange={(event) => setValue(event.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !!problem}
              aria-describedby={
                touched && problem ? `${id}-problem` : undefined
              }
            />
            {touched && problem && (
              <p
                id={`${id}-problem`}
                role='alert'
                className='text-destructive text-xs'
              >
                {problem}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={busy || !!problem || unchanged}>
              {busy && (
                <IconLoader2 className='size-4 animate-spin' aria-hidden />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
