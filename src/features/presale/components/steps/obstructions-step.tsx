'use client';

import { useState } from 'react';

import { obstructionsFor, slopeGeometry } from '../../designer/calc';
import { addObstruction, removeObstruction } from '../../designer/mutations';
import { numOr0, type Obstruction } from '../../designer/types';
import { ObstructionSvg } from '../svg/obstruction-svg';
import { Card } from '../ui/card';
import { BackButton, NextButton, StepFooter } from '../ui/nav-row';
import { type DesignStepProps } from './types';
import { cx } from '../ui/cx';

export function ObstructionList({
  obstructions,
  onRemove
}: {
  obstructions: Obstruction[];
  /** Omit for a read-only list. */
  onRemove?: (id: string) => void;
}) {
  if (!obstructions.length) return null;
  return (
    <div className='obstruction-list'>
      {obstructions.map((o, i) => (
        <div className='obstruction-list-row' key={o.id}>
          <span>
            Obstruction {i + 1} — {Math.round(o.w)} × {Math.round(o.h)}mm
          </span>
          {onRemove ? (
            <button
              type='button'
              className='remove-btn'
              aria-label={`Remove obstruction ${i + 1}`}
              onClick={() => onRemove(o.id)}
            >
              Remove
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ObstructionsStep({ design, update, nav }: DesignStepProps) {
  // Which elevation is armed for drawing. Local on purpose: leaving the step
  // unmounts it, so marking mode can never stay active anywhere else.
  const [markingSlopeId, setMarkingSlopeId] = useState<string | null>(null);
  const clearances = {
    verge: numOr0(design.params.vergeMm),
    ridge: numOr0(design.params.ridgeMm),
    eave: numOr0(design.params.eaveMm)
  };

  return (
    <section aria-label='Obstructions'>
      <Card
        title='Mark obstructions'
        hint='Chimneys, vents, hips — anything that blocks a panel. Mark them now so the panel fit and price already account for them. Nothing to mark? Just continue. Obstructions are only added or removed here — the Layout step shows them but cannot change them.'
      />
      <div>
        {design.slopes.length === 0 ? (
          <p className='hint'>
            Add and confirm at least one roof elevation first.
          </p>
        ) : null}
        {design.slopes.map((slope) => {
          const geom = slopeGeometry(slope);
          if (!geom.complete) {
            return (
              <article
                key={slope.id}
                className='result-card obstruction-card obstruction-na card'
              >
                <div className='result-head'>
                  <h3 className='display'>
                    {slope.label} — Obstructions Not Required
                  </h3>
                </div>
                <div className='result-body'>
                  <p className='hint' style={{ margin: 0 }}>
                    {slope.shapeMode === 'complex'
                      ? 'This elevation uses Complex layout, so there’s no roof outline to mark an obstruction on.'
                      : 'Finish this slope’s measurements on the Elevations step first.'}
                  </p>
                </div>
              </article>
            );
          }
          const marking = markingSlopeId === slope.id;
          const list = obstructionsFor(design, slope.id);
          const remove = (id: string) =>
            update((d) => removeObstruction(d, slope.id, id));
          return (
            <article
              key={slope.id}
              className='result-card obstruction-card card'
            >
              <div className='result-head'>
                <h3 className='display'>
                  {slope.label}
                  <span className='head-meta'>
                    {list.length
                      ? `${list.length} obstruction${list.length > 1 ? 's' : ''} marked`
                      : 'None marked'}
                  </span>
                </h3>
                <button
                  type='button'
                  className={cx('obs-btn', marking && 'active')}
                  aria-pressed={marking}
                  onClick={() => setMarkingSlopeId(marking ? null : slope.id)}
                >
                  {marking ? 'Cancel marking' : '+ Add obstruction'}
                </button>
              </div>
              <div className='result-body'>
                <div className={cx('grid-wrap', marking && 'is-marking')}>
                  {marking ? (
                    <p className='grid-hint obs-hint' role='status'>
                      Drawing on {slope.label}: drag a box where the obstruction
                      sits, measured from the bottom-left corner of this roof
                      face. Release to set it.
                    </p>
                  ) : null}
                  <ObstructionSvg
                    geom={geom}
                    clearances={clearances}
                    obstructions={list}
                    marking={marking}
                    onDrawn={(o) => {
                      if (o) update((d) => addObstruction(d, slope.id, o));
                      setMarkingSlopeId(null);
                    }}
                    onDelete={remove}
                  />
                  <p className='grid-hint'>
                    Ridge at top, gutter at bottom. The dashed line is the
                    usable area once clearances are applied.
                  </p>
                </div>
                <ObstructionList obstructions={list} onRemove={remove} />
              </div>
            </article>
          );
        })}
      </div>
      <StepFooter>
        <BackButton onClick={() => nav.go('elevations')} />
        <NextButton onClick={() => nav.go('panels')}>Next: panels →</NextButton>
      </StepFooter>
    </section>
  );
}
