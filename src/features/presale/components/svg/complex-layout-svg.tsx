'use client';

import { type KeyboardEvent } from 'react';

import { complexAddTargets } from '../../designer/calc';
import { type PanelSpec } from '../../designer/catalogue';
import { type Cell, type ComplexLayout } from '../../designer/types';

export interface ComplexLayoutSvgProps {
  panel: PanelSpec;
  layout: ComplexLayout;
  maxCount: number;
  gapMm: number;
  onAdd: (cell: Cell) => void;
  onRemove: (cell: Cell) => void;
}

const NSS = 'non-scaling-stroke' as const;

function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };
}

/** Free-form cell layout for a Complex elevation: tap + to add, a panel to remove. */
export function ComplexLayoutSvg({
  panel,
  layout,
  maxCount,
  gapMm,
  onAdd,
  onRemove
}: ComplexLayoutSvgProps) {
  const landscape = layout.orientation === 'landscape';
  const cw = (landscape ? panel.heightM : panel.widthM) * 1000;
  const ch = (landscape ? panel.widthM : panel.heightM) * 1000;
  const gap = gapMm || 10;
  const atMax = layout.cells.length >= maxCount;
  const targets = atMax ? [] : complexAddTargets(layout);
  const all = layout.cells.concat(targets);
  if (!all.length) return null;

  const rows = all.map((c) => c.r);
  const cols = all.map((c) => c.c);
  const minR = Math.min.apply(null, rows);
  const maxR = Math.max.apply(null, rows);
  const minC = Math.min.apply(null, cols);
  const maxC = Math.max.apply(null, cols);
  const pad = gap;
  const cellX = (c: number) => (c - minC) * (cw + gap) + pad;
  const cellY = (r: number) => (r - minR) * (ch + gap) + pad;
  const vbW = (maxC - minC + 1) * (cw + gap) - gap + 2 * pad;
  const vbH = (maxR - minR + 1) * (ch + gap) - gap + 2 * pad;

  return (
    <div className='cx-grid-wrap'>
      <svg
        className='cx-layout-svg'
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio='xMidYMid meet'
        role='group'
        aria-label='Panel layout, tap a plus to add a panel or a panel to remove it'
      >
        {layout.cells.map((c, i) => (
          <rect
            key={`p${c.r},${c.c}`}
            className='cx-panel'
            x={cellX(c.c)}
            y={cellY(c.r)}
            width={cw}
            height={ch}
            vectorEffect={NSS}
            role='button'
            tabIndex={0}
            aria-label={`Remove panel ${i + 1}`}
            onClick={() => onRemove(c)}
            onKeyDown={onActivate(() => onRemove(c))}
          />
        ))}
        {targets.map((t) => {
          const x = cellX(t.c);
          const y = cellY(t.r);
          return (
            <g
              key={`a${t.r},${t.c}`}
              className='cx-add'
              role='button'
              tabIndex={0}
              aria-label={`Add a panel at row ${t.r - minR + 1}, column ${t.c - minC + 1}`}
              onClick={() => onAdd(t)}
              onKeyDown={onActivate(() => onAdd(t))}
            >
              <rect x={x} y={y} width={cw} height={ch} vectorEffect={NSS} />
              <line
                x1={x + cw * 0.3}
                y1={y + ch / 2}
                x2={x + cw * 0.7}
                y2={y + ch / 2}
                vectorEffect={NSS}
              />
              <line
                x1={x + cw / 2}
                y1={y + ch * 0.3}
                x2={x + cw / 2}
                y2={y + ch * 0.7}
                vectorEffect={NSS}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
