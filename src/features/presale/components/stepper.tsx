'use client';

import { useEffect, useRef } from 'react';

import { STEP_KEYS, STEP_LABELS, type StepKey } from '../lib/steps';

/** What the list says about a step, beyond "you are here". */
export type StepStatus =
  | 'complete'
  | 'current'
  | 'attention'
  | 'skipped'
  | 'todo';

const STATUS_TEXT: Record<StepStatus, string> = {
  complete: 'Complete',
  current: 'In progress',
  attention: 'Needs attention',
  skipped: 'Not needed',
  todo: ''
};

export interface StepperProps {
  current: StepKey;
  /** Index of the furthest step unlocked so far. */
  maxStep: number;
  onSelect: (step: StepKey) => void;
  /** Per-step state from the wizard; without it steps are just done / current / locked. */
  statuses?: Partial<Record<StepKey, StepStatus>>;
}

/**
 * The nine steps as one navigable list. The workspace shows it as a vertical
 * rail on wide screens and inside the "All steps" sheet on narrow ones; the
 * current step is kept in view either way.
 */
export function Stepper({
  current,
  maxStep,
  onSelect,
  statuses
}: StepperProps) {
  const rowRef = useRef<HTMLElement>(null);
  const currentIndex = STEP_KEYS.indexOf(current);

  useEffect(() => {
    const row = rowRef.current;
    const pill = row?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!row || !pill || row.scrollWidth <= row.clientWidth) return;
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
        const status: StepStatus =
          statuses?.[key] ??
          (i === currentIndex
            ? 'current'
            : i < currentIndex
              ? 'complete'
              : 'todo');
        const stateText = reachable ? STATUS_TEXT[status] : 'Not reached yet';
        return (
          <button
            key={key}
            type='button'
            className={classes.join(' ')}
            disabled={!reachable}
            aria-current={i === currentIndex ? 'step' : undefined}
            data-status={status}
            onClick={() => onSelect(key)}
          >
            <span className='n'>{i + 1}</span>
            {STEP_LABELS[key]}
            {stateText ? <span className='step-state'>{stateText}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
