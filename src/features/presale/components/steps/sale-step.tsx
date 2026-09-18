'use client';

import { useId } from 'react';

import { type FinanceRoute } from '../../contract';
import { type Pricing } from '../../designer/calc';
import { inverterGroups } from '../../designer/catalogue';
import { isBlank } from '../../designer/types';
import { fmt, money, moneyFromPence } from '../../lib/format';
import { STEP_LABELS, type StepKey } from '../../lib/steps';
import {
  type PresaleDraft,
  type SaleDraft,
  type ScopeDraft
} from '../../lib/draft';
import {
  buildSubmission,
  type ResolvedSale,
  type SalesContext
} from '../../lib/submission';
import { InfoBanner, WarnBanner } from '../ui/banner';
import { Card } from '../ui/card';
import { BackButton, StepFooter } from '../ui/nav-row';
import { EXTRA_SELECTS } from './price-step';
import { TextField } from '../ui/text-field';
import { TogglePair } from '../ui/toggle-pair';
import { type StepNav } from './types';

const FINANCE_OPTIONS: { value: FinanceRoute; label: string }[] = [
  { value: 'Standard', label: 'No finance' },
  { value: 'Phoenix', label: 'Phoenix finance' },
  { value: 'OtherReview', label: 'Other finance' }
];

const YES_NO: { value: 'yes' | 'no'; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
];

export const FINANCE_ROUTE_LABELS: Record<FinanceRoute, string> = {
  Standard: 'No finance',
  Phoenix: 'Phoenix finance',
  OtherReview: 'Other finance'
};

export interface SaleStepProps {
  draft: PresaleDraft;
  pricing: Pricing | null;
  resolved: ResolvedSale;
  ctx: SalesContext;
  currentUserName: string;
  onSaleChange: (patch: Partial<SaleDraft>) => void;
  onScopeChange: (patch: Partial<ScopeDraft>) => void;
  onSubmit: () => void;
  submitting: boolean;
  /** Failure from the last submit attempt (local validation or the server). */
  error: string | null;
  errorField: string | null;
  nav: StepNav;
}

function ScopeToggle({
  label,
  value,
  onChange
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className='scope-row'>
      <span className='scope-label'>{label}</span>
      <TogglePair
        options={YES_NO}
        value={value ? 'yes' : 'no'}
        ariaLabel={label}
        onChange={(v) => onChange(v === 'yes')}
      />
    </div>
  );
}

function ReviewRow({ k, v }: { k: string; v: string }) {
  return (
    <div className='review-row'>
      <span className='k'>{k}</span>
      <span className='v'>{v}</span>
    </div>
  );
}

const INVERTER_NAMES = new Map(
  inverterGroups().flatMap((g) => g.models.map((m) => [m.id, m.name] as const))
);

/** One titled block of the review, with a way back to the step that owns it. */
function ReviewSection({
  title,
  editStep,
  onEdit,
  children
}: {
  title: string;
  editStep?: StepKey;
  onEdit: (step: StepKey) => void;
  children: React.ReactNode;
}) {
  return (
    <div className='review-section'>
      <div className='review-head'>
        <h3>{title}</h3>
        {editStep ? (
          <button
            type='button'
            className='link-btn'
            aria-label={`Edit ${title.toLowerCase()} on the ${STEP_LABELS[editStep]} step`}
            onClick={() => onEdit(editStep)}
          >
            Edit
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SaleStep({
  draft,
  pricing,
  resolved,
  ctx,
  currentUserName,
  onSaleChange,
  onScopeChange,
  onSubmit,
  submitting,
  error,
  errorField,
  nav
}: SaleStepProps) {
  const salespersonId = useId();
  const roofNotesId = useId();
  const electricalNotesId = useId();
  const { customer, sale, scope } = draft;

  const priceTyped = resolved.agreedPriceText.trim() !== '';
  const priceInvalid = priceTyped && resolved.agreedPricePence === null;
  const priceDiffers =
    resolved.agreedPricePence !== null &&
    resolved.computedTotalPence !== null &&
    resolved.agreedPricePence !== resolved.computedTotalPence;
  const salespersonName =
    ctx.salespeople.find((p) => p.id === resolved.salespersonId)?.displayName ??
    (resolved.salespersonId === ctx.currentUserId ? currentUserName : '—');
  const customerName =
    `${customer.firstName} ${customer.lastName}`.trim() || '—';
  const address = [
    customer.addressLine1,
    customer.addressLine2,
    customer.town,
    customer.postcode
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');

  const { pricing: designPricing } = draft.design;
  const inverterText =
    designPricing.inverterLines
      .filter((l) => l.modelId)
      .map(
        (l) =>
          `${isBlank(l.qty) ? 0 : l.qty} × ${INVERTER_NAMES.get(l.modelId) ?? l.modelId}`
      )
      .join(', ') || '—';
  const chosenExtras = EXTRA_SELECTS.filter(
    (f) => designPricing.extras[f.key] && designPricing.extras[f.key] !== 'No'
  ).map((f) => `${f.label}: ${designPricing.extras[f.key]}`);
  if (designPricing.extras.optimisers === 'Yes')
    chosenExtras.push(
      `Optimisers: ${isBlank(designPricing.extras.optimiserCount) ? 0 : designPricing.extras.optimiserCount}`
    );
  const yesNo = (v: boolean) => (v ? 'Yes' : 'No');
  // The same check Submit runs, surfaced before the button is pressed.
  const built = buildSubmission(draft, ctx);
  const problem = built.ok ? null : built.problem;
  const differencePence =
    priceDiffers &&
    resolved.agreedPricePence !== null &&
    resolved.computedTotalPence !== null
      ? resolved.agreedPricePence - resolved.computedTotalPence
      : null;

  return (
    <section aria-label='Sale and submit' className='sale-step'>
      <div className='sale-cols'>
        <div className='sale-inputs'>
          <Card title='Sale'>
            <div className='field-grid'>
              {ctx.canSubmitOnBehalf ? (
                <label className='span2' htmlFor={salespersonId}>
                  <span>
                    Salesperson
                    <span className='req' aria-hidden='true'>
                      *
                    </span>
                  </span>
                  <select
                    id={salespersonId}
                    required
                    value={resolved.salespersonId}
                    className={
                      errorField === 'salesperson_id'
                        ? 'field-error'
                        : undefined
                    }
                    onChange={(e) =>
                      onSaleChange({ salespersonId: e.target.value })
                    }
                  >
                    <option value=''>Select salesperson…</option>
                    {ctx.salespeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className='span2'>
                  <div className='field-label'>Salesperson</div>
                  <div className='readonly-field' aria-readonly='true'>
                    {currentUserName}
                  </div>
                </div>
              )}
              <TextField
                label='Lead source'
                value={sale.leadSource}
                maxLength={120}
                autoComplete='off'
                error={
                  errorField === 'lead_source' ? 'Check this field.' : null
                }
                onChange={(v) => onSaleChange({ leadSource: v })}
              />
              <TextField
                label='Quote reference'
                value={sale.quoteReference}
                maxLength={120}
                autoComplete='off'
                error={
                  errorField === 'quote_reference' ? 'Check this field.' : null
                }
                onChange={(v) => onSaleChange({ quoteReference: v })}
              />
            </div>

            <div className='field-label' style={{ marginTop: 16 }}>
              Finance route
              <span className='req' aria-hidden='true'>
                *
              </span>
            </div>
            <TogglePair
              options={FINANCE_OPTIONS}
              value={resolved.financeRoute}
              ariaLabel='Finance route'
              flagUnset
              className={errorField === 'finance_route' ? 'unset' : undefined}
              onChange={(financeRoute) => onSaleChange({ financeRoute })}
            />
            {resolved.financeRoute === null ? (
              <p className='field-msg' style={{ marginTop: 6 }}>
                The design has “Using finance?” set to{' '}
                {draft.design.pricing.finance} — choose Phoenix or Other
                finance, or No finance if the customer has decided against it.
              </p>
            ) : null}
            {resolved.financeMismatch ? (
              <WarnBanner>{resolved.financeMismatch}</WarnBanner>
            ) : null}
          </Card>

          <Card
            title='Agreed price'
            hint='The designer’s calculated price and the price agreed with the customer are both recorded.'
          >
            <div className='price-row'>
              <TextField
                label='Agreed selling price (£)'
                required
                inputMode='decimal'
                autoComplete='off'
                value={resolved.agreedPriceText}
                error={
                  priceInvalid || errorField === 'agreed_price_pence'
                    ? 'Enter pounds and pence, e.g. 12450.00 — more than zero.'
                    : null
                }
                onChange={(v) => onSaleChange({ agreedPrice: v })}
              />
              <div className='price-side'>
                Calculated system price
                <strong>{pricing ? money(pricing.total) : '—'}</strong>
              </div>
            </div>
            {priceDiffers &&
            resolved.agreedPricePence !== null &&
            resolved.computedTotalPence !== null ? (
              <InfoBanner>
                The agreed price ({moneyFromPence(resolved.agreedPricePence)})
                is{' '}
                {moneyFromPence(
                  Math.abs(
                    resolved.agreedPricePence - resolved.computedTotalPence
                  )
                )}{' '}
                {resolved.agreedPricePence > resolved.computedTotalPence
                  ? 'above'
                  : 'below'}{' '}
                the designer’s total (
                {moneyFromPence(resolved.computedTotalPence)}
                ). Both are recorded.{' '}
                <button
                  type='button'
                  className='link-btn'
                  onClick={() => onSaleChange({ agreedPrice: null })}
                >
                  Use the designer total
                </button>
              </InfoBanner>
            ) : null}
          </Card>

          <Card
            title='Scope'
            hint='Worked out from the design — change anything that doesn’t match the job.'
          >
            <ScopeToggle
              label='Roof required'
              value={resolved.roofRequired}
              onChange={(v) => onScopeChange({ roofRequired: v })}
            />
            <ScopeToggle
              label='Electrical required'
              value={resolved.electricalRequired}
              onChange={(v) => onScopeChange({ electricalRequired: v })}
            />
            <ScopeToggle
              label='Scaffold required'
              value={resolved.scaffoldRequired}
              onChange={(v) => onScopeChange({ scaffoldRequired: v })}
            />
            <div className='field-grid' style={{ marginTop: 12 }}>
              <label className='span2' htmlFor={roofNotesId}>
                Roof notes
                <textarea
                  id={roofNotesId}
                  value={scope.roofNotes}
                  maxLength={2000}
                  className={
                    errorField === 'roof_notes' ? 'field-error' : undefined
                  }
                  onChange={(e) => onScopeChange({ roofNotes: e.target.value })}
                />
              </label>
              <label className='span2' htmlFor={electricalNotesId}>
                Electrical notes
                <textarea
                  id={electricalNotesId}
                  value={scope.electricalNotes}
                  maxLength={2000}
                  className={
                    errorField === 'electrical_notes'
                      ? 'field-error'
                      : undefined
                  }
                  onChange={(e) =>
                    onScopeChange({ electricalNotes: e.target.value })
                  }
                />
              </label>
            </div>
          </Card>
        </div>
        <div className='sale-review'>
          <Card title='Review'>
            <ReviewSection title='Customer' editStep='customer' onEdit={nav.go}>
              <ReviewRow k='Customer' v={customerName} />
              <ReviewRow k='Phone' v={customer.phone.trim() || '—'} />
              <ReviewRow k='Email' v={customer.email.trim() || '—'} />
            </ReviewSection>
            <ReviewSection
              title='Installation address'
              editStep='customer'
              onEdit={nav.go}
            >
              <ReviewRow k='Address' v={address || '—'} />
            </ReviewSection>
            <ReviewSection title='System' editStep='layout' onEdit={nav.go}>
              <ReviewRow
                k='Panel'
                v={
                  pricing
                    ? `${pricing.panel.name} ${pricing.panel.variant}`
                    : '—'
                }
              />
              <ReviewRow
                k='Net panels'
                v={pricing ? String(pricing.totalNetPanels) : '—'}
              />
              <ReviewRow
                k='System size'
                v={pricing ? `${fmt(pricing.totalKwp, 2)} kWp` : '—'}
              />
              <ReviewRow
                k='Elevations'
                v={draft.design.slopes.map((sl) => sl.label).join(', ') || '—'}
              />
            </ReviewSection>
            <ReviewSection
              title='Electrical & battery'
              editStep='price'
              onEdit={nav.go}
            >
              <ReviewRow k='Inverter' v={inverterText} />
              <ReviewRow
                k='Battery'
                v={designPricing.stackedBattery || 'None'}
              />
            </ReviewSection>
            <ReviewSection
              title='Scaffold & extras'
              editStep='price'
              onEdit={nav.go}
            >
              <ReviewRow
                k='Scaffold'
                v={
                  isBlank(designPricing.scaffoldM) ||
                  isBlank(designPricing.scaffoldLevels)
                    ? '—'
                    : `${designPricing.scaffoldM} m · ${designPricing.scaffoldLevels} levels`
                }
              />
              <ReviewRow
                k='Extras'
                v={chosenExtras.length ? chosenExtras.join(', ') : 'None'}
              />
            </ReviewSection>
            <ReviewSection title='Finance' onEdit={nav.go}>
              <ReviewRow
                k='Finance route'
                v={
                  resolved.financeRoute
                    ? FINANCE_ROUTE_LABELS[resolved.financeRoute]
                    : '—'
                }
              />
              <ReviewRow k='Salesperson' v={salespersonName} />
            </ReviewSection>
            <ReviewSection title='Pricing' editStep='price' onEdit={nav.go}>
              <ReviewRow
                k='Total system price'
                v={pricing ? money(pricing.total) : '—'}
              />
              <div className='review-row agreed'>
                <span className='k'>Agreed price</span>
                <span className='v'>
                  {resolved.agreedPricePence !== null
                    ? moneyFromPence(resolved.agreedPricePence)
                    : '—'}
                </span>
              </div>
              {differencePence !== null ? (
                <ReviewRow
                  k='Difference'
                  v={`${differencePence > 0 ? '+' : '−'}${moneyFromPence(Math.abs(differencePence))}`}
                />
              ) : null}
            </ReviewSection>
            <ReviewSection title='Scope' onEdit={nav.go}>
              <ReviewRow
                k='Roof / Electrical / Scaffold'
                v={`${yesNo(resolved.roofRequired)} / ${yesNo(resolved.electricalRequired)} / ${yesNo(resolved.scaffoldRequired)}`}
              />
            </ReviewSection>
            {scope.roofNotes.trim() || scope.electricalNotes.trim() ? (
              <ReviewSection title='Notes' onEdit={nav.go}>
                {scope.roofNotes.trim() ? (
                  <ReviewRow k='Roof' v={scope.roofNotes.trim()} />
                ) : null}
                {scope.electricalNotes.trim() ? (
                  <ReviewRow k='Electrical' v={scope.electricalNotes.trim()} />
                ) : null}
              </ReviewSection>
            ) : null}
          </Card>
        </div>
      </div>

      {problem ? (
        <div className='submit-check' role='status'>
          <strong>Before you can submit</strong>
          <span>{problem.message}</span>
          {problem.step !== 'sale' ? (
            <button
              type='button'
              className='link-btn'
              onClick={() => nav.go(problem.step)}
            >
              Go to {STEP_LABELS[problem.step]}
            </button>
          ) : null}
        </div>
      ) : null}

      {error && error !== problem?.message ? (
        <div style={{ marginBottom: 14 }}>
          <WarnBanner>{error}</WarnBanner>
        </div>
      ) : null}

      <div className='submit-panel'>
        <div className='submit-what'>
          <strong>
            {customerName} · {customer.postcode.trim() || '—'}
          </strong>
          <span>
            {pricing ? `${fmt(pricing.totalKwp, 2)} kWp` : '—'} ·{' '}
            {resolved.agreedPricePence !== null
              ? `${moneyFromPence(resolved.agreedPricePence)} agreed`
              : 'no agreed price yet'}{' '}
            ·{' '}
            {resolved.financeRoute
              ? FINANCE_ROUTE_LABELS[resolved.financeRoute]
              : 'finance route not chosen'}
          </span>
        </div>
        <p>
          Submitting records the sale, creates the job and hands its first tasks
          to the office. The presale cannot be edited afterwards.
        </p>
      </div>

      <StepFooter>
        <BackButton onClick={() => nav.go('performance')} />
        <button
          type='button'
          className='btn btn-primary btn-submit'
          disabled={submitting}
          aria-busy={submitting}
          onClick={onSubmit}
        >
          {submitting ? 'Submitting…' : 'Submit job sold'}
        </button>
      </StepFooter>
    </section>
  );
}
