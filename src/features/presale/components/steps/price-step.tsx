'use client';

import {
  breakdownRows,
  depositRows,
  type BreakdownRow,
  type Pricing
} from '../../designer/calc';
import {
  BIRD_OPTIONS,
  DONGLE_OPTIONS,
  EV_OPTIONS,
  FINANCE_CHOICES,
  IBOOST_OPTIONS,
  IMMERSION_OPTIONS,
  OFFGRID_OPTIONS,
  OPTIMISER_PRICE,
  PVULTRA_OPTIONS,
  STACKED_BATTERY,
  inverterGroups,
  type FinanceChoice,
  type PriceOptions
} from '../../designer/catalogue';
import {
  addInverterLine,
  patchExtras,
  patchInverterLine,
  patchPricing,
  removeInverterLine
} from '../../designer/mutations';
import { type ExtrasSelectKey, type PricingState } from '../../designer/types';
import { fmt, money } from '../../lib/format';
import { stepBlocker } from '../../lib/steps';
import { type CustomerDraft } from '../../lib/validation';
import { InfoBanner, WarnBanner } from '../ui/banner';
import { Card, FieldLabel } from '../ui/card';
import { BackButton, NextButton, StepFooter } from '../ui/nav-row';
import { NumberInput } from '../ui/number-input';
import { StatStrip } from '../ui/stat-strip';
import { TotalsRow } from '../ui/totals-row';
import { type DesignStepProps } from './types';

const INVERTER_GROUPS = inverterGroups();

export const EXTRA_SELECTS: {
  key: ExtrasSelectKey;
  label: string;
  options: PriceOptions;
}[] = [
  { key: 'ev', label: 'EV charger', options: EV_OPTIONS },
  { key: 'dongle', label: '4G dongle', options: DONGLE_OPTIONS },
  { key: 'offgrid', label: 'Off-grid backup', options: OFFGRID_OPTIONS },
  { key: 'birdproofing', label: 'Bird proofing', options: BIRD_OPTIONS },
  { key: 'iboost', label: 'iBoost / diversion', options: IBOOST_OPTIONS },
  { key: 'immersion', label: 'Immersion timer', options: IMMERSION_OPTIONS },
  { key: 'pvultra', label: 'PV Ultra cable', options: PVULTRA_OPTIONS }
];

const ADJUSTMENTS: { key: 'adjA' | 'adjB' | 'adjC'; label: string }[] = [
  { key: 'adjA', label: 'Adjustment A (£)' },
  { key: 'adjB', label: 'Adjustment B (£)' },
  { key: 'adjC', label: 'Adjustment C (£)' }
];

/** Options with the price itemised next to each choice (when it has one). */
function PricedOptions({ options }: { options: PriceOptions }) {
  return (
    <>
      {Object.keys(options).map((key) => (
        <option key={key} value={key}>
          {key}
          {options[key] ? ` — £${options[key].toFixed(2)}` : ''}
        </option>
      ))}
    </>
  );
}

const rowValue = (row: BreakdownRow) =>
  `${row.negative ? '−' : ''}${money(row.amount)}`;

/**
 * The designer's own breakdown rows, folded for scanning: the lines that make
 * up a subtotal sit behind it and open on demand. Same rows, same order, same
 * amounts - only the disclosure is new.
 */
export function TotalsBreakdown({ pricing }: { pricing: Pricing }) {
  const blocks: { head: BreakdownRow | null; lines: BreakdownRow[] }[] = [];
  let pending: BreakdownRow[] = [];
  for (const row of breakdownRows(pricing)) {
    if (row.emphasis === 'subtotal' && pending.length >= 2) {
      blocks.push({ head: row, lines: pending });
      pending = [];
    } else if (row.emphasis) {
      blocks.push({ head: null, lines: [...pending, row] });
      pending = [];
    } else {
      pending.push(row);
    }
  }
  if (pending.length) blocks.push({ head: null, lines: pending });

  return (
    <>
      {blocks.map((block) =>
        block.head ? (
          <details className='totals-group' key={block.head.key}>
            <summary>
              <TotalsRow
                label={block.head.label}
                value={rowValue(block.head)}
                emphasis='subtotal'
              />
            </summary>
            <div className='totals-lines'>
              {block.lines.map((row) => (
                <TotalsRow
                  key={row.key}
                  label={row.label}
                  value={rowValue(row)}
                />
              ))}
            </div>
          </details>
        ) : (
          block.lines.map((row) => (
            <TotalsRow
              key={row.key}
              label={row.label}
              value={rowValue(row)}
              emphasis={row.emphasis}
            />
          ))
        )
      )}
      <div className='deposit-table'>
        <div className='deposit-title'>Payment schedule</div>
        {depositRows(pricing.total).map((d) => (
          <TotalsRow key={d.label} label={d.label} value={money(d.amount)} />
        ))}
      </div>
    </>
  );
}

export function PriceStep({
  design,
  update,
  nav,
  pricing,
  customer
}: DesignStepProps & { pricing: Pricing | null; customer: CustomerDraft }) {
  const p: PricingState = design.pricing;
  const blocker = stepBlocker('price', { customer, design });

  return (
    <section aria-label='Price' className='price-step'>
      <StatStrip
        tiles={[
          {
            label: 'System size',
            value: pricing ? `${fmt(pricing.totalKwp, 2)} kWp` : '—'
          },
          {
            label: 'Net panels',
            value: pricing ? String(pricing.totalNetPanels) : '—'
          },
          {
            label: 'Total price',
            value: pricing ? money(pricing.total) : '—',
            accent: Boolean(pricing)
          }
        ]}
      />
      {pricing && pricing.slopesWithPanels > 1 ? (
        <div style={{ marginBottom: 14 }}>
          <InfoBanner>
            Panels are selected on more than one roof face — check your
            scaffold/access figures cover every face in use.
          </InfoBanner>
        </div>
      ) : null}

      <div className='price-cols'>
        <div className='price-config'>
          <Card
            title='Inverter & battery'
            hint='Add one line per inverter unit — mixed models are fine for split-inverter jobs. Simple Solar System Designer never picks one for you, only warns if the total is over the rated limit.'
          >
            <FieldLabel>Inverter</FieldLabel>
            <div>
              {p.inverterLines.map((line, i) => (
                <div className='inv-line' key={line.id}>
                  <select
                    required
                    value={line.modelId}
                    aria-label={`Inverter model, line ${i + 1}`}
                    onChange={(e) =>
                      update((d) =>
                        patchInverterLine(d, line.id, {
                          modelId: e.target.value
                        })
                      )
                    }
                  >
                    <option value=''>Select inverter…</option>
                    {INVERTER_GROUPS.map((group) => (
                      <optgroup key={group.category} label={group.category}>
                        {group.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — £{m.price.toFixed(2)}
                            {m.capacityKwp != null
                              ? ` (max ${m.capacityKwp}kWp)`
                              : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <NumberInput
                    min={0}
                    step='1'
                    inputMode='numeric'
                    value={line.qty}
                    aria-label={`Quantity, line ${i + 1}`}
                    onValueChange={(qty) =>
                      update((d) => patchInverterLine(d, line.id, { qty }))
                    }
                  />
                  <button
                    type='button'
                    className='remove-btn'
                    aria-label={`Remove inverter line ${i + 1}`}
                    onClick={() =>
                      update((d) => removeInverterLine(d, line.id))
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type='button'
              className='add-btn'
              style={{ marginBottom: 14 }}
              onClick={() => update(addInverterLine)}
            >
              + Add inverter
            </button>
            <FieldLabel>
              <label htmlFor='presale-battery' style={{ display: 'inline' }}>
                Battery
              </label>
            </FieldLabel>
            <select
              id='presale-battery'
              value={p.stackedBattery}
              onChange={(e) =>
                update((d) =>
                  patchPricing(d, { stackedBattery: e.target.value })
                )
              }
            >
              <PricedOptions options={STACKED_BATTERY} />
            </select>
            {pricing?.noInverterWarning ? (
              <WarnBanner>{pricing.noInverterWarning}</WarnBanner>
            ) : pricing?.capacityWarning ? (
              <WarnBanner>{pricing.capacityWarning}</WarnBanner>
            ) : pricing?.capacityNote ? (
              <InfoBanner>{pricing.capacityNote}</InfoBanner>
            ) : null}
          </Card>

          <Card
            title='Extras'
            hint='Prices shown next to each option, same as the inverter list above.'
          >
            <div className='param-grid'>
              {EXTRA_SELECTS.map((f) => (
                <label key={f.key}>
                  {f.label}
                  <select
                    value={p.extras[f.key]}
                    onChange={(e) =>
                      update((d) => patchExtras(d, { [f.key]: e.target.value }))
                    }
                  >
                    <PricedOptions options={f.options} />
                  </select>
                </label>
              ))}
              <label>
                Optimisers?
                <select
                  value={p.extras.optimisers}
                  onChange={(e) =>
                    update((d) =>
                      patchExtras(d, {
                        optimisers: e.target.value === 'Yes' ? 'Yes' : 'No'
                      })
                    )
                  }
                >
                  <option value='No'>No</option>
                  <option value='Yes'>
                    Yes — £{OPTIMISER_PRICE.toFixed(2)} each
                  </option>
                </select>
              </label>
              <label>
                Number of optimisers
                <NumberInput
                  min={0}
                  step='1'
                  inputMode='numeric'
                  value={p.extras.optimiserCount}
                  onValueChange={(optimiserCount) =>
                    update((d) => patchExtras(d, { optimiserCount }))
                  }
                />
              </label>
              <label className='span2'>
                Auxiliaries, manual (£)
                <NumberInput
                  min={0}
                  step='1'
                  value={p.extras.auxiliaries}
                  onValueChange={(auxiliaries) =>
                    update((d) => patchExtras(d, { auxiliaries }))
                  }
                />
              </label>
            </div>
          </Card>

          <Card title='Adjustments'>
            <div className='param-grid'>
              {ADJUSTMENTS.map((a) => (
                <label key={a.key}>
                  {a.label}
                  <NumberInput
                    step='1'
                    value={p[a.key]}
                    onValueChange={(v) =>
                      update((d) => patchPricing(d, { [a.key]: v }))
                    }
                  />
                </label>
              ))}
              <label>
                Using finance?
                <select
                  value={p.finance}
                  onChange={(e) =>
                    update((d) =>
                      patchPricing(d, {
                        finance: e.target.value as FinanceChoice
                      })
                    )
                  }
                >
                  {FINANCE_CHOICES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
          </Card>
        </div>
        <div className='price-total'>
          <Card
            title='Calculated system price'
            hint='Worked out by the designer from the choices on this page. The price agreed with the customer is entered on the final step.'
          >
            {pricing ? (
              <TotalsBreakdown pricing={pricing} />
            ) : (
              <p className='hint'>
                Choose a panel type on the Panels step first.
              </p>
            )}
            <p className='hint totals-foot'>
              Labour, delivery/waste, discount and VAT are worked out
              automatically. Head office adds any non-standard labour or
              delivery cost via Auxiliaries.
            </p>
          </Card>
        </div>
      </div>

      <StepFooter note={blocker}>
        <BackButton onClick={() => nav.go('layout')}>
          ← Back to layout
        </BackButton>
        <NextButton
          disabled={blocker !== null}
          onClick={() => nav.go('performance')}
        >
          Next: performance →
        </NextButton>
      </StepFooter>
    </section>
  );
}
