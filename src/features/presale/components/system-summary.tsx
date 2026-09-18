import { type Pricing } from '../designer/calc';
import { isBlank, type DesignState } from '../designer/types';
import { fmt, money, moneyFromPence } from '../lib/format';
import { type ResolvedSale } from '../lib/submission';

export interface SystemSummaryProps {
  design: DesignState;
  pricing: Pricing | null;
  resolved: ResolvedSale;
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className='sum-line'>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/**
 * "What system am I selling?" - a read-only view of the designer's own state
 * and the pricing it already computed. Nothing is calculated here.
 */
export function SystemSummary({
  design,
  pricing,
  resolved
}: SystemSummaryProps) {
  const { stackedBattery, scaffoldM, scaffoldLevels } = design.pricing;
  const inverters = design.pricing.inverterLines.filter((l) => l.modelId);
  const agreed = resolved.agreedPricePence;
  const agreedDiffers =
    agreed !== null &&
    resolved.computedTotalPence !== null &&
    agreed !== resolved.computedTotalPence;

  return (
    <section className='sys-summary' aria-label='System summary'>
      <h2 className='sys-title'>System</h2>
      {pricing ? (
        <>
          <div className='sys-hero'>
            <div>
              <span className='sys-big num'>{pricing.totalNetPanels}</span>
              <span className='sys-unit'>panels</span>
            </div>
            <div>
              <span className='sys-big num'>{fmt(pricing.totalKwp, 2)}</span>
              <span className='sys-unit'>kWp</span>
            </div>
          </div>
          <dl className='sum-lines'>
            <Line
              k='Panel'
              v={`${pricing.panel.name} ${pricing.panel.variant}`}
            />
            <Line
              k='Inverter'
              v={
                inverters.length
                  ? `${inverters.length} line${inverters.length > 1 ? 's' : ''} selected`
                  : 'Not chosen'
              }
            />
            <Line
              k='Battery'
              v={
                stackedBattery && stackedBattery !== 'None'
                  ? stackedBattery
                  : 'None'
              }
            />
            <Line
              k='Scaffold'
              v={
                isBlank(scaffoldM) || isBlank(scaffoldLevels)
                  ? '—'
                  : `${scaffoldM} m · ${scaffoldLevels} levels`
              }
            />
          </dl>
          <div className='sys-price'>
            <span className='sys-price-k'>Calculated price</span>
            <span className='sys-price-v num'>{money(pricing.total)}</span>
          </div>
          {agreedDiffers && agreed !== null ? (
            <div className='sys-price agreed'>
              <span className='sys-price-k'>Agreed price</span>
              <span className='sys-price-v num'>{moneyFromPence(agreed)}</span>
            </div>
          ) : null}
        </>
      ) : (
        <p className='sys-empty'>
          Panel count, system size and price appear here once the roof is
          measured and a panel is chosen.
        </p>
      )}
    </section>
  );
}
