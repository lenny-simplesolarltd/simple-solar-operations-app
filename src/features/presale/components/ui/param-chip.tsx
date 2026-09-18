'use client';

import { useId } from 'react';

import { toNum, type NumInput } from '../../designer/types';
import { NumberInput } from './number-input';

export interface ParamChipProps {
  label: string;
  value: NumInput;
  onValueChange: (value: NumInput) => void;
  /** Amount the − / + buttons move by. */
  step: number;
  /** Floor for the − / + buttons (typing is not clamped). */
  min: number;
  /** Coloured left edge: X is red, Y is green. */
  edge?: 'x-field' | 'y-field';
  /** False when another field in the same group already satisfies the requirement. */
  required?: boolean;
}

/** Labelled number chip with big − / + buttons, sized for a thumb on a roof. */
export function ParamChip({
  label,
  value,
  onValueChange,
  step,
  min,
  edge,
  required = true
}: ParamChipProps) {
  const id = useId();

  const nudge = (dir: 1 | -1) => {
    const current = toNum(value);
    const base = isFinite(current) ? current : min;
    const next = Math.round((base + dir * step) * 10) / 10;
    onValueChange(next < min ? min : next);
  };

  return (
    <div className={`param-chip${edge ? ` ${edge}` : ''}`}>
      <label htmlFor={id}>
        <span>{label}</span>
        {/* step="any": the buttons own the step, so typed values such as 8.25
            are never flagged invalid by the browser's step-mismatch check. */}
        <NumberInput
          id={id}
          step='any'
          required={required}
          value={value}
          onValueChange={onValueChange}
        />
      </label>
      <div className='stepper-btns'>
        <button
          type='button'
          className='step-btn'
          aria-label={`Decrease ${label}`}
          onClick={() => nudge(-1)}
        >
          −
        </button>
        <button
          type='button'
          className='step-btn'
          aria-label={`Increase ${label}`}
          onClick={() => nudge(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
