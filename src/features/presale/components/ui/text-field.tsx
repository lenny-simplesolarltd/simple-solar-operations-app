'use client';

import { useId, type HTMLInputTypeAttribute } from 'react';

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  type?: HTMLInputTypeAttribute;
  required?: boolean;
  /** Shown with an asterisk even when `required` is conditional. */
  markRequired?: boolean;
  error?: string | null;
  note?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'decimal';
  autoCapitalize?: 'none' | 'words' | 'characters';
  maxLength?: number;
  className?: string;
  placeholder?: string;
}

/** A labelled text box; shows the prototype's red treatment when `error` is set. */
export function TextField({
  label,
  value,
  onChange,
  onBlur,
  type = 'text',
  required,
  markRequired,
  error,
  note,
  autoComplete,
  inputMode,
  autoCapitalize,
  maxLength,
  className,
  placeholder
}: TextFieldProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <label htmlFor={id} className={className}>
      <span>
        {label}
        {required || markRequired ? (
          <span className='req' aria-hidden='true'>
            *
          </span>
        ) : null}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || note ? msgId : undefined}
        className={error ? 'field-error' : undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {error ? (
        <span id={msgId} className='field-msg'>
          {error}
        </span>
      ) : note ? (
        <span id={msgId} className='field-note'>
          {note}
        </span>
      ) : null}
    </label>
  );
}
