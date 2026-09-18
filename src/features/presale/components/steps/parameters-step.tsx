'use client';

import { RIDGE_MIN_WARN_MM, ROOF_MATERIALS } from '../../designer/catalogue';
import {
  patchExtras,
  patchPricing,
  patchSlope
} from '../../designer/mutations';
import {
  toNum,
  type PerformanceInputs,
  type RoofParams
} from '../../designer/types';
import { stepBlocker } from '../../lib/steps';
import { type CustomerDraft } from '../../lib/validation';
import { Card, FieldLabel } from '../ui/card';
import { NavNote, NavRow, NextButton, BackButton } from '../ui/nav-row';
import { NumberInput } from '../ui/number-input';
import { type DesignStepProps } from './types';

const ROOF_FIELDS: { key: keyof RoofParams; label: string }[] = [
  { key: 'gapMm', label: 'Gap between panels (mm)' },
  { key: 'ridgeMm', label: 'Ridge / top clearance (mm)' },
  { key: 'eaveMm', label: 'Eave / gutter clearance (mm)' },
  { key: 'vergeMm', label: 'Verge / side clearance (mm)' }
];

const PERF_FIELDS: {
  key: keyof PerformanceInputs;
  label: string;
  step: string;
  max?: number;
  required?: boolean;
}[] = [
  { key: 'tariffPence', label: 'Electricity tariff (p/kWh)', step: '0.01' },
  { key: 'segRatePence', label: 'SEG export rate (p/kWh)', step: '0.01' },
  {
    key: 'selfConsumptionPct',
    label: 'Self-consumption (%)',
    step: '1',
    max: 100
  },
  {
    key: 'annualConsumptionKwh',
    label: 'Customer’s annual consumption (kWh)',
    step: 'any',
    required: true
  }
];

export function ParametersStep({
  design,
  update,
  nav,
  customer
}: DesignStepProps & { customer: CustomerDraft }) {
  const blocker = stepBlocker('parameters', { customer, design });
  const ridge = toNum(design.params.ridgeMm);
  const ridgeLow = (isFinite(ridge) ? ridge : 0) < RIDGE_MIN_WARN_MM;

  return (
    <section aria-label='Parameters'>
      <Card title='Roof parameters'>
        <div className='param-grid'>
          {ROOF_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <NumberInput
                step='1'
                value={design.params[f.key]}
                onValueChange={(v) =>
                  update((d) => ({ ...d, params: { ...d.params, [f.key]: v } }))
                }
              />
              {f.key === 'ridgeMm' && ridgeLow ? (
                <span className='param-warn'>
                  Below the usual {RIDGE_MIN_WARN_MM}mm minimum
                </span>
              ) : null}
            </label>
          ))}
        </div>
      </Card>

      <Card title='Job parameters'>
        <FieldLabel>Roof materials</FieldLabel>
        <div>
          {design.slopes.length === 0 ? (
            <p className='hint'>
              Add a roof slope on the Elevations step first.
            </p>
          ) : (
            design.slopes.map((slope) => (
              <div className='material-row' key={slope.id}>
                <label
                  className='material-label'
                  htmlFor={`presale-material-${slope.id}`}
                >
                  {slope.label}
                </label>
                <select
                  id={`presale-material-${slope.id}`}
                  value={slope.roofMaterial}
                  onChange={(e) =>
                    update((d) =>
                      patchSlope(d, slope.id, { roofMaterial: e.target.value })
                    )
                  }
                >
                  {ROOF_MATERIALS.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
        </div>

        <FieldLabel style={{ marginTop: 16 }}>Scaffold</FieldLabel>
        <div className='param-grid'>
          <label>
            Metres (minimum 8)
            <NumberInput
              min={0}
              step='1'
              value={design.pricing.scaffoldM}
              onValueChange={(v) =>
                update((d) => patchPricing(d, { scaffoldM: v }))
              }
            />
          </label>
          <label>
            Levels (minimum 2)
            <NumberInput
              min={0}
              step='1'
              value={design.pricing.scaffoldLevels}
              onValueChange={(v) =>
                update((d) => patchPricing(d, { scaffoldLevels: v }))
              }
            />
          </label>
        </div>

        <FieldLabel style={{ marginTop: 16 }}>AC run to inverter</FieldLabel>
        <div className='param-grid'>
          <label>
            Consumer unit → inverter (m)
            <NumberInput
              min={0}
              step='any'
              required
              value={design.pricing.extras.acRunM}
              onValueChange={(v) =>
                update((d) => patchExtras(d, { acRunM: v }))
              }
            />
          </label>
        </div>
      </Card>

      <Card
        title='Performance assumptions'
        hint='Feeds the Performance estimate (generation, savings, ROI) — defaults are sensible starting points, override per job if the customer’s own tariff, SEG rate or self-consumption differs.'
      >
        <div className='param-grid perf-grid'>
          {PERF_FIELDS.map((f) => (
            <label key={f.key}>
              <span className='lbl'>{f.label}</span>
              <NumberInput
                min={0}
                max={f.max}
                step={f.step}
                required={f.required}
                value={design.performance[f.key]}
                onValueChange={(v) =>
                  update((d) => ({
                    ...d,
                    performance: { ...d.performance, [f.key]: v }
                  }))
                }
              />
            </label>
          ))}
        </div>
      </Card>

      <NavRow>
        <BackButton onClick={() => nav.go('customer')} />
        <NextButton
          disabled={blocker !== null}
          onClick={() => nav.go('elevations')}
        >
          Next: elevations →
        </NextButton>
      </NavRow>
      <NavNote message={blocker} />
    </section>
  );
}
