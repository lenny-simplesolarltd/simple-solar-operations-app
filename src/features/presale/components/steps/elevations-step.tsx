'use client';

import { calcHypotenuse, jobHasObstructableSlopes } from '../../designer/calc';
import {
  addSlope,
  applyCalculatedSlope,
  confirmSlope,
  removeSlope,
  renameSlope,
  setShapeMode,
  setSlopeValue
} from '../../designer/mutations';
import {
  isBlank,
  toNum,
  type NumInput,
  type ShapeMode,
  type Slope,
  type SlopeNumericField
} from '../../designer/types';
import { fmt } from '../../lib/format';
import { stepBlocker } from '../../lib/steps';
import { type CustomerDraft } from '../../lib/validation';
import { Card } from '../ui/card';
import { BackButton, NavNote, NavRow, NextButton } from '../ui/nav-row';
import { ParamChip } from '../ui/param-chip';
import { TogglePair } from '../ui/toggle-pair';
import { type DesignStepProps } from './types';
import { cx } from '../ui/cx';

const SHAPE_OPTIONS: { value: ShapeMode; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'complex', label: 'Complex' },
  { value: 'calc', label: 'Slope Calculator' }
];

type SetField = (field: SlopeNumericField, value: NumInput) => void;

function SharedFields({ slope, set }: { slope: Slope; set: SetField }) {
  return (
    <>
      <ParamChip
        label='Pitch (°)'
        value={slope.pitchDeg}
        step={1}
        min={0}
        onValueChange={(v) => set('pitchDeg', v)}
      />
      <ParamChip
        label='Shading factor (%)'
        value={slope.shadingPct}
        step={1}
        min={0}
        onValueChange={(v) => set('shadingPct', v)}
      />
      <ParamChip
        label='Degrees from South (− east / + west)'
        value={slope.bearingDeg}
        step={1}
        min={-180}
        onValueChange={(v) => set('bearingDeg', v)}
      />
      <ParamChip
        label='Radiance (kWh/m²/yr)'
        value={slope.radiance}
        step={10}
        min={0}
        onValueChange={(v) => set('radiance', v)}
      />
    </>
  );
}

function ConfirmFooter({
  ready,
  confirmed,
  incompleteText,
  onConfirm
}: {
  ready: boolean;
  confirmed: boolean;
  incompleteText: string;
  onConfirm: () => void;
}) {
  if (!ready)
    return <div className='status-line incomplete'>{incompleteText}</div>;
  return (
    <div className='use-values-wrap'>
      {confirmed ? (
        <div className='confirmed-badge' role='status'>
          <svg
            className='confirmed-tick'
            viewBox='0 0 20 20'
            width='16'
            height='16'
            aria-hidden='true'
            focusable='false'
          >
            <path
              d='M4 10.5l4 4 8-9'
              fill='none'
              stroke='currentColor'
              strokeWidth='2.6'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
          <span>Values confirmed</span>
        </div>
      ) : (
        <button
          type='button'
          className='btn btn-primary use-values-btn'
          onClick={onConfirm}
        >
          Use these values
        </button>
      )}
    </div>
  );
}

function RectBody({
  slope,
  set,
  onConfirm
}: {
  slope: Slope;
  set: SetField;
  onConfirm: () => void;
}) {
  const x = toNum(slope.xM);
  const y = toNum(slope.yM);
  const ready = isFinite(x) && x > 0 && isFinite(y) && y > 0;
  return (
    <>
      <div className='roof-diagram-wrap'>
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size reference diagram; no optimisation needed */}
        <img
          className='roof-ref-diagram'
          src='/presale/diagram-rectangle.webp'
          width={760}
          height={495}
          alt='Diagram showing X along the eave and Y up the roof slope to the ridge'
        />
      </div>
      <p className='hint' style={{ margin: '0 0 10px' }}>
        X and Y match the diagram above.
      </p>
      <div className='param-chips'>
        <ParamChip
          label='X (m)'
          edge='x-field'
          value={slope.xM}
          step={0.1}
          min={0}
          onValueChange={(v) => set('xM', v)}
        />
        <ParamChip
          label='Y (m)'
          edge='y-field'
          value={slope.yM}
          step={0.1}
          min={0}
          onValueChange={(v) => set('yM', v)}
        />
        <SharedFields slope={slope} set={set} />
      </div>
      <ConfirmFooter
        ready={ready}
        confirmed={slope.confirmed}
        incompleteText='Enter X and Y above to continue.'
        onConfirm={onConfirm}
      />
    </>
  );
}

function ComplexBody({
  slope,
  set,
  onConfirm
}: {
  slope: Slope;
  set: SetField;
  onConfirm: () => void;
}) {
  const p7 = toNum(slope.maxPanelsP7);
  const mc = toNum(slope.maxPanelsMClass);
  const ready = (isFinite(p7) && p7 > 0) || (isFinite(mc) && mc > 0);
  // Only one of the two counts is needed, so each stops being required once
  // the other has a value.
  const eitherFilled =
    !isBlank(slope.maxPanelsP7) || !isBlank(slope.maxPanelsMClass);
  return (
    <>
      <p className='hint' style={{ margin: '0 0 10px' }}>
        For a roof face too irregular to model directly — type in the panel
        counts you’ve already worked out (e.g. from Open Solar). Complex
        elevations skip obstruction marking — these counts go straight to the
        Panels step.
      </p>
      <div className='param-chips'>
        <ParamChip
          label='Max panels — SunPower P7'
          value={slope.maxPanelsP7}
          step={1}
          min={0}
          required={!eitherFilled}
          onValueChange={(v) => set('maxPanelsP7', v)}
        />
        <ParamChip
          label='Max panels — SunPower M Class'
          value={slope.maxPanelsMClass}
          step={1}
          min={0}
          required={!eitherFilled}
          onValueChange={(v) => set('maxPanelsMClass', v)}
        />
        <SharedFields slope={slope} set={set} />
      </div>
      <ConfirmFooter
        ready={ready}
        confirmed={slope.confirmed}
        incompleteText='Enter a max panel count above to continue.'
        onConfirm={onConfirm}
      />
    </>
  );
}

function CalcBody({
  slope,
  set,
  onUse
}: {
  slope: Slope;
  set: SetField;
  onUse: () => void;
}) {
  const hyp = calcHypotenuse(slope);
  return (
    <>
      <div className='roof-diagram-wrap'>
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size reference diagram; no optimisation needed */}
        <img
          className='roof-ref-diagram'
          src='/presale/diagram-slope.webp'
          width={760}
          height={550}
          alt='Diagram showing the adjacent length X, pitch angle theta, and the hypotenuse of the roof slope'
        />
      </div>
      <p className='hint' style={{ margin: '0 0 10px' }}>
        A quick helper — work out the sloped rafter length from the pitch and
        the horizontal run, then send it straight to the Rectangle tab’s Y
        dimension.
      </p>
      <div className='param-chips'>
        <ParamChip
          label='Pitch (°) — θ'
          value={slope.pitchDeg}
          step={1}
          min={0}
          onValueChange={(v) => set('pitchDeg', v)}
        />
        <ParamChip
          label='Adjacent (m) — X'
          value={slope.calcAdjacentM}
          step={0.1}
          min={0}
          onValueChange={(v) => set('calcAdjacentM', v)}
        />
      </div>
      <div className='calc-result-wrap' aria-live='polite'>
        {hyp !== null ? (
          <div className='calc-result'>
            <div className='calc-result-label'>Calculated Roof Slope</div>
            <div className='calc-result-value display'>
              {fmt(hyp, 2)}
              <span className='unit'> m</span>
            </div>
            <button
              type='button'
              className='btn btn-primary use-calc-btn'
              onClick={onUse}
            >
              Use Calculated Value
            </button>
          </div>
        ) : (
          <div className='status-line incomplete'>
            Enter the pitch and the adjacent length to calculate the roof slope.
          </div>
        )}
      </div>
    </>
  );
}

export function ElevationsStep({
  design,
  update,
  nav,
  customer
}: DesignStepProps & { customer: CustomerDraft }) {
  const blocker = stepBlocker('elevations', { customer, design });
  const toObstructions = jobHasObstructableSlopes(design);

  return (
    <section aria-label='Elevations'>
      <Card
        title='Roof slopes'
        hint='Choose Rectangle, Complex, or Slope Calculator for each elevation, then confirm it with "Use these values" before moving on.'
      />
      <div className='slopes'>
        {design.slopes.map((slope) => {
          const set: SetField = (field, value) =>
            update((d) => setSlopeValue(d, slope.id, field, value));
          const confirm = () => update((d) => confirmSlope(d, slope.id));
          return (
            <article
              key={slope.id}
              className={cx(
                'slope-card',
                'card',
                slope.confirmed && 'confirmed'
              )}
            >
              <div className='slope-head'>
                <input
                  className='slope-label display'
                  type='text'
                  value={slope.label}
                  aria-label='Slope name'
                  maxLength={60}
                  onChange={(e) =>
                    update((d) => renameSlope(d, slope.id, e.target.value))
                  }
                />
                <button
                  type='button'
                  className='remove-btn'
                  onClick={() => update((d) => removeSlope(d, slope.id))}
                >
                  Remove
                </button>
              </div>
              <div className='slope-body'>
                <TogglePair
                  options={SHAPE_OPTIONS}
                  value={slope.shapeMode}
                  ariaLabel={`Shape for ${slope.label}`}
                  style={{ marginBottom: 12 }}
                  onChange={(mode) =>
                    update((d) => setShapeMode(d, slope.id, mode))
                  }
                />
                {slope.shapeMode === 'complex' ? (
                  <ComplexBody slope={slope} set={set} onConfirm={confirm} />
                ) : slope.shapeMode === 'calc' ? (
                  <CalcBody
                    slope={slope}
                    set={set}
                    onUse={() =>
                      update((d) => applyCalculatedSlope(d, slope.id))
                    }
                  />
                ) : (
                  <RectBody slope={slope} set={set} onConfirm={confirm} />
                )}
              </div>
            </article>
          );
        })}
      </div>
      <button
        type='button'
        className='add-btn'
        onClick={() => update(addSlope)}
      >
        + Add roof slope
      </button>
      <NavRow>
        <BackButton onClick={() => nav.go('parameters')} />
        <NextButton
          disabled={blocker !== null}
          onClick={() => nav.go(toObstructions ? 'obstructions' : 'panels')}
        >
          {toObstructions ? 'Next: obstructions →' : 'Next: panels →'}
        </NextButton>
      </NavRow>
      <NavNote message={blocker} />
    </section>
  );
}
