'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useId } from 'react';

// Small labelled inputs for command forms. The server validates every value;
// `required` only marks the field for the user.

function FieldLabel({
  id,
  label,
  required
}: {
  id: string;
  label: string;
  required?: boolean;
}) {
  return (
    <Label htmlFor={id}>
      {label}
      {required && <span className='text-destructive'> *</span>}
    </Label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  required,
  type = 'text',
  hint,
  inputMode,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: 'text' | 'date' | 'datetime-local';
  hint?: string;
  inputMode?: 'decimal' | 'text';
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className='flex flex-col gap-1.5'>
      <FieldLabel id={id} label={label} required={required} />
      <Input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className='text-muted-foreground text-xs'>{hint}</p>}
    </div>
  );
}

export function NoteField({
  label,
  value,
  onChange,
  required
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className='flex flex-col gap-1.5'>
      <FieldLabel id={id} label={label} required={required} />
      <Textarea
        id={id}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function ChoiceField<T extends string>({
  label,
  value,
  onChange,
  options,
  required
}: {
  label: string;
  value: T | '';
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className='flex flex-col gap-1.5'>
      <FieldLabel id={id} label={label} required={required} />
      <RadioGroup
        id={id}
        value={value}
        onValueChange={(v) => onChange(v as T)}
        className='flex flex-wrap gap-x-5 gap-y-2'
      >
        {options.map((o) => (
          <label key={o.value} className='flex items-center gap-2 text-sm'>
            <RadioGroupItem value={o.value} />
            {o.label}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  required,
  placeholder = 'Choose…'
}: {
  label: string;
  value: T | '';
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  required?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className='flex flex-col gap-1.5'>
      <FieldLabel id={id} label={label} required={required} />
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className='w-full'>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** "2026-09-18T14:30" (local picker) -> ISO string, or undefined when blank. */
export function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
