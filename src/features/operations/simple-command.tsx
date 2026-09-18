'use client';

import { Button } from '@/components/ui/button';
import type { CommandRequest } from '@/lib/backend/types';
import { useState } from 'react';
import { CommandDialog } from './command-dialog';
import { NoteField, SelectField, TextField } from './fields';
import { useCommand } from './use-command';

export interface SimpleField {
  key: string;
  label: string;
  kind?: 'text' | 'date' | 'datetime-local' | 'note' | 'number' | 'select';
  required?: boolean;
  hint?: string;
  initial?: string;
  options?: { value: string; label: string }[];
}

/**
 * A button that opens a small form and runs one backend command. `payload`
 * turns the form values into the command payload (numbers stay numbers for
 * commands that insist on JSON numbers). The server validates everything; the
 * required marks only guide the person.
 */
export function SimpleCommand({
  label,
  icon,
  title,
  description,
  request,
  fields = [],
  payload,
  submitLabel,
  variant = 'outline',
  size = 'sm',
  disabled,
  disabledReason,
  children
}: {
  label: string;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  request: Omit<CommandRequest, 'command_id' | 'payload'>;
  fields?: SimpleField[];
  payload?: (values: Record<string, string>) => Record<string, unknown>;
  submitLabel?: string;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost';
  size?: 'sm' | 'default';
  disabled?: boolean;
  disabledReason?: string;
  children?: React.ReactNode;
}) {
  const initial = () =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? '']));
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const { run, pending, outcome, reset } = useCommand();
  const set = (k: string) => (v: string) =>
    setValues((prev) => ({ ...prev, [k]: v }));
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setValues(initial());
    }
  };
  const complete = fields.every((f) => !f.required || values[f.key]?.trim());

  const toPayload = () =>
    payload
      ? payload(values)
      : Object.fromEntries(
          fields
            .filter((f) => values[f.key]?.trim())
            .map((f) => [
              f.key,
              f.kind === 'number' ? Number(values[f.key]) : values[f.key].trim()
            ])
        );

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        title={disabledReason}
        onClick={() => setOpen(true)}
      >
        {icon}
        {label}
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={title}
        description={description}
        submitLabel={submitLabel ?? label}
        pending={pending}
        outcome={outcome}
        canSubmit={complete}
        onSubmit={() =>
          run({ ...request, payload: toPayload() }, (r) => r.ok && close(false))
        }
      >
        {children}
        {fields.map((f) =>
          f.kind === 'note' ? (
            <NoteField
              key={f.key}
              label={f.label}
              required={f.required}
              value={values[f.key]}
              onChange={set(f.key)}
            />
          ) : f.kind === 'select' ? (
            <SelectField
              key={f.key}
              label={f.label}
              required={f.required}
              value={values[f.key]}
              onChange={set(f.key)}
              options={f.options ?? []}
            />
          ) : (
            <TextField
              key={f.key}
              label={f.label}
              required={f.required}
              hint={f.hint}
              type={
                f.kind === 'date' || f.kind === 'datetime-local'
                  ? f.kind
                  : 'text'
              }
              inputMode={f.kind === 'number' ? 'decimal' : undefined}
              value={values[f.key]}
              onChange={set(f.key)}
            />
          )
        )}
      </CommandDialog>
    </>
  );
}
