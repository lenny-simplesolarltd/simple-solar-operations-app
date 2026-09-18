'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { obstructionFromDrag, type SlopeGeometry } from '../../designer/calc';
import { type Obstruction } from '../../designer/types';
import { DimH, DimV, dimMetrics, metres } from './dimensions';
import { cx } from '../ui/cx';

export interface ObstructionSvgProps {
  geom: SlopeGeometry;
  clearances: { verge: number; ridge: number; eave: number };
  obstructions: Obstruction[];
  /** True while this elevation is armed for drawing a box. */
  marking: boolean;
  /** Called once per drag; null when the box was too small to keep. */
  onDrawn: (obstruction: Obstruction | null) => void;
  onDelete: (obstructionId: string) => void;
}

interface Point {
  x: number;
  y: number;
}

const NSS = 'non-scaling-stroke' as const;

/**
 * Roof outline for marking obstructions: drag to draw a box, with a crosshair
 * and a live readout measured from the bottom-left corner of the roof face.
 */
export function ObstructionSvg({
  geom,
  clearances,
  obstructions,
  marking,
  onDrawn,
  onDelete
}: ObstructionSvgProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [start, setStart] = useState<Point | null>(null);

  const W = geom.widthMm;
  const S = geom.slopeMm;
  const m = dimMetrics(W, S);
  const clearW = Math.max(0, W - 2 * clearances.verge);
  const clearS = Math.max(0, S - clearances.ridge - clearances.eave);
  const delR = m.unit * 1.3;

  const roofPoint = (e: PointerEvent<SVGSVGElement>): Point | null => {
    const svg = svgRef.current;
    const ctm = svg ? svg.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return {
      x: Math.max(0, Math.min(p.x, W)),
      y: Math.max(0, Math.min(p.y, S))
    };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!marking) return;
    if ((e.target as Element).closest('.obstruction-del')) return;
    const pt = roofPoint(e);
    if (!pt) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setStart(pt);
    setCursor(pt);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!marking) return;
    const pt = roofPoint(e);
    if (pt) setCursor(pt);
  };

  const finish = (e: PointerEvent<SVGSVGElement>, keep: boolean) => {
    if (!start) return;
    const end = roofPoint(e) ?? cursor ?? start;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setStart(null);
    setCursor(null);
    const id = `o${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    onDrawn(keep ? obstructionFromDrag(geom, start, end, id) : null);
  };

  const showCursor = marking && cursor !== null;
  const box =
    start && cursor
      ? {
          x: Math.min(start.x, cursor.x),
          y: Math.min(start.y, cursor.y),
          w: Math.abs(cursor.x - start.x),
          h: Math.abs(cursor.y - start.y)
        }
      : null;

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`${m.minX} ${m.minY} ${m.vbW} ${m.vbH}`}
        className={cx('grid-svg', 'obstruction-svg', marking && 'marking')}
        style={{ aspectRatio: `${m.vbW}/${m.vbH}` }}
        role='group'
        aria-label='Roof outline for marking obstructions'
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, true)}
        onPointerCancel={(e) => finish(e, false)}
        onPointerLeave={() => {
          if (!start) setCursor(null);
        }}
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
          x={clearances.verge}
          y={clearances.ridge}
          width={clearW}
          height={clearS}
          vectorEffect={NSS}
        />
        <DimH
          from={0}
          to={W}
          origin={0}
          lane={m.rowWidthY}
          label={metres(W)}
          major
          metrics={m}
        />
        <DimV
          from={0}
          to={S}
          origin={0}
          lane={m.colLengthX}
          label={metres(S)}
          major
          metrics={m}
        />
        {obstructions.map((o, i) => (
          <g key={o.id}>
            <rect
              className='obstruction-rect'
              x={o.x}
              y={o.y}
              width={o.w}
              height={o.h}
            />
            <g
              className='obstruction-del'
              transform={`translate(${o.x + o.w} ${o.y})`}
              role='button'
              tabIndex={0}
              aria-label={`Remove obstruction ${i + 1}`}
              onClick={() => onDelete(o.id)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onDelete(o.id);
                }
              }}
            >
              <circle r={delR} />
              <line
                x1={-delR * 0.5}
                y1={-delR * 0.5}
                x2={delR * 0.5}
                y2={delR * 0.5}
              />
              <line
                x1={-delR * 0.5}
                y1={delR * 0.5}
                x2={delR * 0.5}
                y2={-delR * 0.5}
              />
            </g>
          </g>
        ))}
        {box ? (
          <rect
            className='obstruction-rect obstruction-drag-preview'
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            vectorEffect={NSS}
          />
        ) : null}
        {showCursor && cursor ? (
          <>
            <line
              className='crosshair-line'
              x1={m.minX}
              y1={cursor.y}
              x2={W}
              y2={cursor.y}
              vectorEffect={NSS}
            />
            <line
              className='crosshair-line'
              x1={cursor.x}
              y1={m.minY}
              x2={cursor.x}
              y2={S}
              vectorEffect={NSS}
            />
          </>
        ) : null}
      </svg>
      {showCursor && cursor ? (
        <div className='coord-readout' aria-live='off'>
          From bottom-left corner: {Math.round(cursor.x)}mm across ·{' '}
          {Math.round(S - cursor.y)}mm up
          {box
            ? `  ·  Box: ${Math.round(box.w)}mm × ${Math.round(box.h)}mm`
            : ''}
        </div>
      ) : null}
    </>
  );
}
