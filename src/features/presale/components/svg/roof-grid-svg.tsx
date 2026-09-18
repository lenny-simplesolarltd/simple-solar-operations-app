'use client';

import { type KeyboardEvent } from 'react';

import { panelRect, type Fit, type SlopeGeometry } from '../../designer/calc';
import { type Obstruction } from '../../designer/types';
import { DimH, DimV, dimMetrics, metres } from './dimensions';
import { cx } from '../ui/cx';

export interface RoofGridSvgProps {
  geom: SlopeGeometry;
  fit: Fit;
  autoExcluded: number[];
  manualExcluded: number[];
  obstructions: Obstruction[];
  onTogglePanel: (index: number) => void;
}

const NSS = 'non-scaling-stroke' as const;

function activate(e: KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

/** The Layout step's drawing: roof, clearances, panel grid, gaps, obstructions. */
export function RoofGridSvg({
  geom,
  fit,
  autoExcluded,
  manualExcluded,
  obstructions,
  onTogglePanel
}: RoofGridSvgProps) {
  const W = geom.widthMm;
  const S = geom.slopeMm;
  const m = dimMetrics(W, S);

  const baseX = fit.edge.verge + fit.offsetW;
  const baseY = fit.edge.ridge + fit.offsetS;
  const usedW = fit.cols > 0 ? fit.cols * (fit.alongW + fit.gap) - fit.gap : 0;
  const usedS = fit.rows > 0 ? fit.rows * (fit.alongS + fit.gap) - fit.gap : 0;
  const rightGapX = baseX + usedW;
  const bottomGapY = baseY + usedS;
  const clearW = Math.max(0, W - 2 * fit.edge.verge);
  const clearS = Math.max(0, S - fit.edge.ridge - fit.edge.eave);

  const panels = [];
  for (let idx = 0; idx < fit.count; idx++) {
    const rect = panelRect(fit, idx);
    const isAuto = autoExcluded.indexOf(idx) >= 0;
    const isEx = !isAuto && manualExcluded.indexOf(idx) >= 0;
    const cls = cx('panel-rect', isAuto ? 'auto-excluded' : isEx && 'excluded');
    const row = Math.floor(idx / fit.cols) + 1;
    const col = (idx % fit.cols) + 1;
    const name = `Panel row ${row}, column ${col}`;
    panels.push(
      isAuto ? (
        <rect
          key={idx}
          className={cls}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          vectorEffect={NSS}
          aria-label={`${name} — overlaps an obstruction`}
        />
      ) : (
        <rect
          key={idx}
          className={cls}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          vectorEffect={NSS}
          role='button'
          tabIndex={0}
          aria-pressed={isEx}
          aria-label={`${name}${isEx ? ' — excluded' : ''}`}
          onClick={() => onTogglePanel(idx)}
          onKeyDown={(e) => activate(e, () => onTogglePanel(idx))}
        />
      )
    );
  }

  return (
    <svg
      viewBox={`${m.minX} ${m.minY} ${m.vbW} ${m.vbH}`}
      className='grid-svg'
      style={{ aspectRatio: `${m.vbW}/${m.vbH}` }}
      role='group'
      aria-label='Panel layout with dimensions, tap a panel to exclude it'
    >
      <rect
        className='roof-outline'
        x={0}
        y={0}
        width={W}
        height={S}
        vectorEffect={NSS}
      />
      <rect
        className='clearance-outline'
        x={fit.edge.verge}
        y={fit.edge.ridge}
        width={clearW}
        height={clearS}
        vectorEffect={NSS}
      />
      {panels}
      {fit.cols > 0 ? (
        <>
          <DimH
            from={0}
            to={baseX}
            origin={0}
            lane={m.rowGapsY}
            label={`${Math.round(baseX)}mm`}
            metrics={m}
          />
          <DimH
            from={rightGapX}
            to={W}
            origin={0}
            lane={m.rowGapsY}
            label={`${Math.round(W - rightGapX)}mm`}
            metrics={m}
          />
        </>
      ) : null}
      <DimH
        from={0}
        to={W}
        origin={0}
        lane={m.rowWidthY}
        label={metres(W)}
        major
        metrics={m}
      />
      {fit.rows > 0 ? (
        <>
          <DimV
            from={0}
            to={baseY}
            origin={0}
            lane={m.colGapsX}
            label={`${Math.round(baseY)}mm`}
            metrics={m}
          />
          <DimV
            from={bottomGapY}
            to={S}
            origin={0}
            lane={m.colGapsX}
            label={`${Math.round(S - bottomGapY)}mm`}
            metrics={m}
          />
        </>
      ) : null}
      <DimV
        from={0}
        to={S}
        origin={0}
        lane={m.colLengthX}
        label={metres(S)}
        major
        metrics={m}
      />
      {obstructions.map((o) => (
        <rect
          key={o.id}
          className='obstruction-rect'
          x={o.x}
          y={o.y}
          width={o.w}
          height={o.h}
          pointerEvents='none'
        />
      ))}
    </svg>
  );
}
