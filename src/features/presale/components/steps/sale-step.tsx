'use client';

import { useId } from 'react';

import { type FinanceRoute } from '../../contract';
import { type Pricing } from '../../designer/calc';
import { fmt, money, moneyFromPence } from '../../lib/format';
import {
  type PresaleDraft,
  type SaleDraft,
  type ScopeDraft
} from '../../lib/draft';
import { type ResolvedSale, type SalesContext } from '../../lib/submission';
import { InfoBanner, WarnBanner } from '../ui/banner';
import { Card } from '../ui/card';
import { BackButton, NavRow } from '../ui/nav-row';
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

  return (
    <section aria-label='Sale and submit'>
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
                  errorField === 'salesperson_id' ? 'field-error' : undefined
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
            error={errorField === 'lead_source' ? 'Check this field.' : null}
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
            {draft.design.pricing.finance} — choose Phoenix or Other finance, or
            No finance if the customer has decided against it.
          </p>
        ) : null}
        {resolved.financeMismatch ? (
          <WarnBanner>{resolved.financeMismatch}</WarnBanner>
        ) : null}
      </Card>

      <Card title='Agreed price'>
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
            Designer total
            <strong>{pricing ? money(pricing.total) : '—'}</strong>
          </div>
        </div>
        {priceDiffers &&
        resolved.agreedPricePence !== null &&
        resolved.computedTotalPence !== null ? (
          <InfoBanner>
            The agreed price ({moneyFromPence(resolved.agreedPricePence)}) is{' '}
            {moneyFromPence(
              Math.abs(resolved.agreedPricePence - resolved.computedTotalPence)
            )}{' '}
            {resolved.agreedPricePence > resolved.computedTotalPence
              ? 'above'
              : 'below'}{' '}
            the designer’s total ({moneyFromPence(resolved.computedTotalPence)}
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
                errorField === 'electrical_notes' ? 'field-error' : undefined
              }
              onChange={(e) =>
                onScopeChange({ electricalNotes: e.target.value })
              }
            />
          </label>
        </div>
      </Card>

      <Card title='Review'>
        <ReviewRow k='Customer' v={customerName} />
        <ReviewRow k='Address' v={address || '—'} />
        <ReviewRow
          k='System size'
          v={pricing ? `${fmt(pricing.totalKwp, 2)} kWp` : '—'}
        />
        <ReviewRow
          k='Net panels'
          v={pricing ? String(pricing.totalNetPanels) : '—'}
        />
        <ReviewRow
          k='Panel'
          v={pricing ? `${pricing.panel.name} ${pricing.panel.variant}` : '—'}
        />
        <ReviewRow
          k='Total system price'
          v={pricing ? money(pricing.total) : '—'}
        />
        <ReviewRow
          k='Agreed price'
          v={
            resolved.agreedPricePence !== null
              ? moneyFromPence(resolved.agreedPricePence)
              : '—'
          }
        />
        <ReviewRow
          k='Finance route'
          v={
            resolved.financeRoute
              ? FINANCE_ROUTE_LABELS[resolved.financeRoute]
              : '—'
          }
        />
        <ReviewRow k='Salesperson' v={salespersonName} />
      </Card>

      {error ? (
        <div style={{ marginBottom: 14 }}>
          <WarnBanner>{error}</WarnBanner>
        </div>
      ) : null}

      <NavRow>
        <BackButton onClick={() => nav.go('performance')} />
        <button
          type='button'
          className='btn btn-primary'
          disabled={submitting}
          aria-busy={submitting}
          onClick={onSubmit}
        >
          {submitting ? 'Submitting…' : 'Submit sale'}
        </button>
      </NavRow>
    </section>
  );
}
