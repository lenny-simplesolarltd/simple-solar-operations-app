'use client';

import { type CSSProperties } from 'react';

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

export interface TogglePairProps<T extends string> {
  options: readonly ToggleOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Red-edged while no option is chosen. */
  flagUnset?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Segmented control; the active segment is filled amber. */
export function TogglePair<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  flagUnset,
  className,
  style
}: TogglePairProps<T>) {
  const classes = ['toggle-pair'];
  if (options.length >= 3) classes.push('three');
  if (flagUnset && value === null) classes.push('unset');
  if (className) classes.push(className);
  return (
    <div
      className={classes.join(' ')}
      role='group'
      aria-label={ariaLabel}
      style={style}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type='button'
          className={o.value === value ? 'active' : undefined}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
