'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

/** Search box that commits to the URL after a short pause. */
export function SearchFilter({
  value,
  onCommit,
  placeholder,
  className
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  // Follow outside changes (back button, "Clear filters") without an effect.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  useEffect(() => {
    if (text.trim() === value) return;
    const t = setTimeout(() => onCommit(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text, value, onCommit]);
  return (
    <div className={cn('relative min-w-0', className)}>
      <IconSearch className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
      <Input
        type='search'
        aria-label={placeholder}
        placeholder={placeholder}
        className='pl-8'
        value={text}
        maxLength={120}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}

/** A compact select bound to one URL filter. `''` means "no filter". */
export function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel,
  className
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** When set, adds an "everything" choice mapped to ''. */
  allLabel?: string;
  className?: string;
}) {
  const ALL = '__all__';
  return (
    <Select
      value={value || (allLabel ? ALL : '')}
      onValueChange={(v) => onChange(v === ALL ? '' : v)}
    >
      <SelectTrigger
        aria-label={label}
        className={cn('w-full sm:w-44', className)}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Segmented links/buttons for a small set of views (tabs that live in the URL). */
export function SegmentedFilter({
  value,
  onChange,
  options,
  label
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; count?: number | null }[];
  label: string;
}) {
  return (
    <div
      role='tablist'
      aria-label={label}
      className='bg-muted inline-flex w-fit max-w-full overflow-x-auto rounded-lg p-1'
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type='button'
            role='tab'
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {o.label}
            {o.count != null && (
              <span className='text-muted-foreground ml-1.5 text-xs tabular-nums'>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
