import { cx } from './cx';

export function TotalsRow({
  label,
  value,
  emphasis
}: {
  label: string;
  value: string;
  emphasis?: 'subtotal' | 'grand';
}) {
  if (emphasis === 'subtotal') {
    return (
      <div className='totals-row'>
        <strong>{label}</strong>
        <strong className='num'>{value}</strong>
      </div>
    );
  }
  return (
    <div className={cx('totals-row', emphasis === 'grand' && 'grand')}>
      <span>{label}</span>
      <span className='num'>{value}</span>
    </div>
  );
}
