'use client';

import { type InputHTMLAttributes } from 'react';

import { type NumInput } from '../../designer/types';

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
>;

export interface NumberInputProps extends NativeProps {
  value: NumInput;
  onValueChange: (value: NumInput) => void;
}

/** A number box bound to a NumInput: a finite number, or '' while blank. */
export function NumberInput({
  value,
  onValueChange,
  inputMode = 'decimal',
  ...rest
}: NumberInputProps) {
  return (
    <input
      {...rest}
      type='number'
      inputMode={inputMode}
      value={value}
      onChange={(e) => {
        const n = e.target.value === '' ? NaN : parseFloat(e.target.value);
        onValueChange(isFinite(n) ? n : '');
      }}
    />
  );
}
