'use client';

import { useEffect, useRef } from 'react';

import { STEP_KEYS, STEP_LABELS, type StepKey } from '../lib/steps';

export interface StepperProps {
  current: StepKey;
  /** Index of the furthest step unlocked so far. */
  maxStep: number;
  onSelect: (step: StepKey) => void;
}

/** One scrollable row of numbered pills; the current step is kept in view. */
export function Stepper({ current, maxStep, onSelect }: StepperProps) {
  const rowRef = useRef<HTMLElement>(null);
  const currentIndex = STEP_KEYS.indexOf(current);

  useEffect(() => {
    const row = rowRef.current;
    const pill = row?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!row || !pill) return;
    const target =
      pill.offsetLeft -
      row.offsetLeft -
      (row.clientWidth - pill.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, target) });
  }, [current]);

  return (
    <nav className='stepper' aria-label='Progress' ref={rowRef}>
      {STEP_KEYS.map((key, i) => {
        const reachable = i <= maxStep;
        const classes = ['step'];
        if (i === currentIndex) classes.push('current');
        else if (i < currentIndex) classes.push('done');
        if (reachable) classes.push('reachable');
        return (
          <button
            key={key}
            type='button'
            className={classes.join(' ')}
            disabled={!reachable}
            aria-current={i === currentIndex ? 'step' : undefined}
            onClick={() => onSelect(key)}
          >
            <span className='n'>{i + 1}</span>
            {STEP_LABELS[key]}
          </button>
        );
      })}
    </nav>
  );
}
