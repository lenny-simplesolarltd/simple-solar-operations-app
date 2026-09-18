import { cx } from './cx';

export interface StatTile {
  label: string;
  value: string;
  accent?: boolean;
}

/** Sticky row of headline figures at the top of a step. */
export function StatStrip({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className={cx('stat-strip', tiles.length === 3 && 'three')}>
      {tiles.map((t) => (
        <div key={t.label} className={cx('stat-tile', t.accent && 'accent')}>
          <span className='stat-label'>{t.label}</span>
          <span className='stat-value num'>{t.value}</span>
        </div>
      ))}
    </div>
  );
}
