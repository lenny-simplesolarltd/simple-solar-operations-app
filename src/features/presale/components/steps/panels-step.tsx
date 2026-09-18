'use client';

import { jobHasObstructableSlopes, panelOptions } from '../../designer/calc';
import { type PanelId } from '../../designer/catalogue';
import { fmt } from '../../lib/format';
import { Card } from '../ui/card';
import { BackButton, NavRow } from '../ui/nav-row';
import { type DesignStepProps } from './types';
import { cx } from '../ui/cx';

export function PanelsStep({
  design,
  nav,
  onSelectPanel
}: Omit<DesignStepProps, 'update'> & {
  onSelectPanel: (panelId: PanelId) => void;
}) {
  const options = panelOptions(design);
  return (
    <section aria-label='Panels'>
      <Card
        title='Choose panel type'
        hint='Totals across every slope, already net of any marked obstructions, using the parameters from earlier steps. Highest output is marked "best" — tap any card to see the layout.'
      />
      <div className='panel-cards'>
        {options.map(({ panel, totals, best, selected, hint }) => (
          <button
            key={panel.id}
            type='button'
            className={cx('panel-card', selected && 'selected', best && 'best')}
            aria-pressed={selected}
            onClick={() => onSelectPanel(panel.id)}
          >
            <div className='pc-top'>
              <span className='pc-name display'>
                {panel.name} {panel.wattage}W
                {panel.tag ? ` - ${panel.tag}` : ''}
              </span>
            </div>
            <div className='pc-warranty'>
              ({panel.warrantyYears} Years Warranty)
            </div>
            <div className='pc-dims'>
              {panel.widthM.toFixed(3)} m × {panel.heightM.toFixed(3)} m
            </div>
            <div className='pc-figures'>
              <div className='pc-figure'>
                <div className='fk'>Panels fit</div>
                <div className='fv num'>{totals.totalCount}</div>
              </div>
              <div className='pc-figure'>
                <div className='fk'>Total output</div>
                <div className='fv num'>{fmt(totals.totalKwp, 1)} kWp</div>
              </div>
            </div>
            {totals.perSlope.length > 1 ? (
              <div className='pc-breakdown'>
                {totals.perSlope
                  .map((s) => `${s.label}: ${s.count}`)
                  .join(' · ')}
              </div>
            ) : null}
            {hint ? (
              <div className='pc-hint'>
                Trim {hint.param} by {hint.mm}mm on {hint.slopeLabel} → +
                {hint.extra} panel
                {hint.extra > 1 ? 's' : ''} (
                {fmt((hint.extra * panel.wattage) / 1000, 1)} kWp)
              </div>
            ) : null}
          </button>
        ))}
      </div>
      <NavRow>
        {/* If Obstructions was skipped on the way here, Back skips it too. */}
        <BackButton
          onClick={() =>
            nav.go(
              jobHasObstructableSlopes(design) ? 'obstructions' : 'elevations'
            )
          }
        />
      </NavRow>
    </section>
  );
}
