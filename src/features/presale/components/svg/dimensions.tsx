import { cx } from '../ui/cx';

// Dimension lines for the roof drawings. Sizes scale with the roof (1/60 of the
// longer side) so labels read the same whatever the viewBox.

export interface DimMetrics {
  tick: number;
  fontMinor: number;
  fontMajor: number;
  /** Lane for the small per-side gap labels. */
  rowGapsY: number;
  colGapsX: number;
  /** Lane for the bold overall dimensions. */
  rowWidthY: number;
  colLengthX: number;
  minX: number;
  minY: number;
  vbW: number;
  vbH: number;
  /** Base unit, for sizing handles. */
  unit: number;
}

export function dimMetrics(widthMm: number, slopeMm: number): DimMetrics {
  const unit = Math.max(widthMm, slopeMm) / 60;
  const tick = unit;
  const laneGap = unit * 1.4;
  const fontMinor = unit * 1.7;
  const fontMajor = unit * 2.2;
  const rowGapsY = -(laneGap + tick);
  const rowWidthY = rowGapsY - (laneGap + tick + fontMajor * 1.3);
  const colGapsX = -(laneGap + tick);
  const colLengthX = colGapsX - (laneGap + tick + fontMajor * 1.3);
  const minX = colLengthX - fontMajor * 1.6;
  const minY = rowWidthY - fontMajor * 1.3;
  return {
    tick,
    fontMinor,
    fontMajor,
    rowGapsY,
    colGapsX,
    rowWidthY,
    colLengthX,
    minX,
    minY,
    vbW: widthMm - minX,
    vbH: slopeMm - minY,
    unit
  };
}

const NSS = 'non-scaling-stroke' as const;

interface DimProps {
  from: number;
  to: number;
  /** Where the extension lines start (the roof edge). */
  origin: number;
  /** The lane the dimension line sits in. */
  lane: number;
  label: string;
  major?: boolean;
  metrics: DimMetrics;
}

/** Horizontal dimension (along the eave), drawn above the roof. */
export function DimH({
  from,
  to,
  origin,
  lane,
  label,
  major,
  metrics
}: DimProps) {
  const half = metrics.tick / 2;
  const majorCls = major && 'dim-major';
  const fs = major ? metrics.fontMajor : metrics.fontMinor;
  return (
    <g>
      <line
        className='dim-ext'
        x1={from}
        y1={origin}
        x2={from}
        y2={lane}
        vectorEffect={NSS}
      />
      <line
        className='dim-ext'
        x1={to}
        y1={origin}
        x2={to}
        y2={lane}
        vectorEffect={NSS}
      />
      <line
        className={cx('dim-tick', majorCls)}
        x1={from}
        y1={lane - half}
        x2={from}
        y2={lane + half}
        vectorEffect={NSS}
      />
      <line
        className={cx('dim-tick', majorCls)}
        x1={to}
        y1={lane - half}
        x2={to}
        y2={lane + half}
        vectorEffect={NSS}
      />
      <line
        className={cx('dim-line', majorCls)}
        x1={from}
        y1={lane}
        x2={to}
        y2={lane}
        vectorEffect={NSS}
      />
      <text
        className={cx('dim-label', majorCls)}
        x={(from + to) / 2}
        y={lane - fs * 0.45}
        textAnchor='middle'
        fontSize={fs}
      >
        {label}
      </text>
    </g>
  );
}

/** Vertical dimension (up the slope), drawn to the left of the roof. */
export function DimV({
  from,
  to,
  origin,
  lane,
  label,
  major,
  metrics
}: DimProps) {
  const half = metrics.tick / 2;
  const majorCls = major && 'dim-major';
  const fs = major ? metrics.fontMajor : metrics.fontMinor;
  const midY = (from + to) / 2;
  const tx = lane - fs * 0.45;
  return (
    <g>
      <line
        className='dim-ext'
        x1={origin}
        y1={from}
        x2={lane}
        y2={from}
        vectorEffect={NSS}
      />
      <line
        className='dim-ext'
        x1={origin}
        y1={to}
        x2={lane}
        y2={to}
        vectorEffect={NSS}
      />
      <line
        className={cx('dim-tick', majorCls)}
        x1={lane - half}
        y1={from}
        x2={lane + half}
        y2={from}
        vectorEffect={NSS}
      />
      <line
        className={cx('dim-tick', majorCls)}
        x1={lane - half}
        y1={to}
        x2={lane + half}
        y2={to}
        vectorEffect={NSS}
      />
      <line
        className={cx('dim-line', majorCls)}
        x1={lane}
        y1={from}
        x2={lane}
        y2={to}
        vectorEffect={NSS}
      />
      <text
        className={cx('dim-label', majorCls)}
        x={tx}
        y={midY}
        textAnchor='middle'
        fontSize={fs}
        transform={`rotate(-90 ${tx} ${midY})`}
      >
        {label}
      </text>
    </g>
  );
}

export function metres(mm: number): string {
  return `${(mm / 1000).toFixed(2)} m`;
}
