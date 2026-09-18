'use client';

import { type Performance } from '../../designer/calc';
import {
  ELECTRICITY_INFLATION_PCT,
  PERFORMANCE_RATIO
} from '../../designer/catalogue';
import { fmt, money } from '../../lib/format';
import { WarnBanner } from '../ui/banner';
import { Card } from '../ui/card';
import { BackButton, NavRow, NextButton } from '../ui/nav-row';
import { StatStrip } from '../ui/stat-strip';
import { TotalsRow } from '../ui/totals-row';
import { type StepNav } from './types';

function PerformanceNote({ perf }: { perf: Performance | null }) {
  if (!perf)
    return <p className='hint'>Choose a panel type on the Panels tab first.</p>;
  if (perf.missingRadiance) {
    return (
      <WarnBanner>
        One or more elevations with panels have no Radiance value entered on the
        Elevations tab — their generation isn’t counted below, so this estimate
        is on the low side.
      </WarnBanner>
    );
  }
  if (perf.overConsumptionWarning) {
    return (
      <WarnBanner>
        Generation used in the property ({fmt(perf.generationUsedKwh, 0)} kWh)
        is more than the customer’s stated annual consumption (
        {fmt(perf.annualConsumptionKwh, 0)} kWh) — double-check the
        self-consumption % on the Parameters tab.
      </WarnBanner>
    );
  }
  return null;
}

export function PerformanceStep({
  perf,
  nav
}: {
  perf: Performance | null;
  nav: StepNav;
}) {
  const roi = perf && perf.roiPct != null ? `${fmt(perf.roiPct, 2)}%` : '—';
  return (
    <section aria-label='Performance'>
      <StatStrip
        tiles={[
          {
            label: 'Annual generation',
            value: perf ? `${fmt(perf.annualGenerationKwh, 0)} kWh` : '—'
          },
          {
            label: 'Year 1 income',
            value: perf ? money(perf.totalIncomeYear1) : '—'
          },
          { label: 'Year 1 ROI', value: roi, accent: true }
        ]}
      />
      <div style={{ marginBottom: 14 }}>
        <PerformanceNote perf={perf} />
      </div>

      <Card
        title='Performance estimate'
        hint='Uses each elevation’s Radiance figure (Elevations tab) plus the tariff, SEG rate and self-consumption assumptions (Parameters tab). Informational only — doesn’t affect the price.'
      >
        {perf ? (
          <>
            <TotalsRow
              label='Annual Generation from the Solar (kWh)'
              value={fmt(perf.annualGenerationKwh, 0)}
            />
            <TotalsRow
              label='Generation from the sun to be Used in the property (kWh)'
              value={fmt(perf.generationUsedKwh, 0)}
            />
            <TotalsRow
              label='Electricity Savings (£)'
              value={money(perf.electricitySavings)}
            />
            <TotalsRow
              label='Generation for Exporting (kWh)'
              value={fmt(perf.generationExportKwh, 0)}
            />
            <TotalsRow label='SEG Income (£)' value={money(perf.segIncome)} />
            <TotalsRow
              label='Total Income in year 1 (£)'
              value={money(perf.totalIncomeYear1)}
              emphasis='subtotal'
            />
            <TotalsRow
              label='Total Income over 30 Years (£)'
              value={money(perf.totalIncome30yr)}
            />
            <TotalsRow
              label='Year 1 ROI on Solar & Battery (%)'
              value={roi}
              emphasis='grand'
            />
            <p className='hint' style={{ margin: '12px 0 0' }}>
              Assumes {ELECTRICITY_INFLATION_PCT}%/year electricity price
              inflation and {fmt(perf.degradationPct, 2)}
              %/year panel degradation ({perf.panel.name} {perf.panel.variant}),
              performance ratio {PERFORMANCE_RATIO} for system losses.
            </p>
          </>
        ) : (
          <p className='hint'>
            Add panels (and Radiance figures on each elevation) to see a
            performance estimate.
          </p>
        )}
      </Card>

      <NavRow>
        <BackButton onClick={() => nav.go('price')}>← Back to price</BackButton>
        <NextButton onClick={() => nav.go('sale')}>
          Next: sale &amp; submit →
        </NextButton>
      </NavRow>
    </section>
  );
}
