'use client';

import { useState } from 'react';

import { stepBlocker } from '../../lib/steps';
import {
  normalisePostcode,
  validateCustomer,
  type CustomerDraft,
  type CustomerField
} from '../../lib/validation';
import { type DesignState } from '../../designer/types';
import { Card } from '../ui/card';
import { NavNote, NavRow, NextButton } from '../ui/nav-row';
import { TextField } from '../ui/text-field';
import { type StepNav } from './types';

export interface CustomerStepProps {
  customer: CustomerDraft;
  design: DesignState;
  onChange: (patch: Partial<CustomerDraft>) => void;
  nav: StepNav;
  /** Field name the server rejected, if any (e.g. "postcode"). */
  errorField: string | null;
}

const SERVER_FIELD: Record<CustomerField, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  town: 'town',
  postcode: 'postcode',
  phone: 'phone',
  email: 'email'
};

export function CustomerStep({
  customer,
  design,
  onChange,
  nav,
  errorField
}: CustomerStepProps) {
  // Format errors (postcode, email) only show once the surveyor has left the
  // field; an empty required field is flagged from the start, as elsewhere.
  const [touched, setTouched] = useState<
    Partial<Record<CustomerField, boolean>>
  >({});
  const errors = validateCustomer(customer);
  const blocker = stepBlocker('customer', { customer, design });
  const hasContact = Boolean(customer.phone.trim() || customer.email.trim());

  const touch = (field: CustomerField) =>
    setTouched((t) => ({ ...t, [field]: true }));
  const errorFor = (field: CustomerField): string | null => {
    if (errorField === SERVER_FIELD[field])
      return errors[field] ?? 'Check this field.';
    if (!customer[field].trim()) return null;
    return touched[field] ? (errors[field] ?? null) : null;
  };

  return (
    <section aria-label='Customer'>
      <Card
        title='Customer'
        hint='Who the system is for and where it is going. A phone number or an email address is needed so the office can reach them.'
      >
        <div className='field-grid'>
          <TextField
            label='First name'
            required
            value={customer.firstName}
            autoComplete='off'
            autoCapitalize='words'
            maxLength={80}
            error={errorFor('firstName')}
            onChange={(v) => onChange({ firstName: v })}
          />
          <TextField
            label='Last name'
            required
            value={customer.lastName}
            autoComplete='off'
            autoCapitalize='words'
            maxLength={80}
            error={errorFor('lastName')}
            onChange={(v) => onChange({ lastName: v })}
          />
          <TextField
            className='span2'
            label='Address line 1'
            required
            value={customer.addressLine1}
            autoComplete='off'
            autoCapitalize='words'
            maxLength={120}
            error={errorFor('addressLine1')}
            onChange={(v) => onChange({ addressLine1: v })}
          />
          <TextField
            className='span2'
            label='Address line 2'
            value={customer.addressLine2}
            autoComplete='off'
            autoCapitalize='words'
            maxLength={120}
            error={errorFor('addressLine2')}
            onChange={(v) => onChange({ addressLine2: v })}
          />
          <TextField
            label='Town'
            required
            value={customer.town}
            autoComplete='off'
            autoCapitalize='words'
            maxLength={80}
            error={errorFor('town')}
            onChange={(v) => onChange({ town: v })}
          />
          <TextField
            label='Postcode'
            required
            value={customer.postcode}
            autoComplete='off'
            autoCapitalize='characters'
            maxLength={10}
            error={errorFor('postcode')}
            onChange={(v) => onChange({ postcode: v.toUpperCase() })}
            onBlur={() => {
              touch('postcode');
              const normalised = normalisePostcode(customer.postcode);
              if (normalised && normalised !== customer.postcode)
                onChange({ postcode: normalised });
            }}
          />
        </div>
      </Card>

      <Card title='Contact' hint='At least one of these is required.'>
        <div className='field-grid'>
          <TextField
            className='span2'
            label='Phone'
            type='tel'
            inputMode='tel'
            required={!hasContact}
            markRequired={!customer.email.trim()}
            value={customer.phone}
            autoComplete='off'
            maxLength={30}
            error={errorFor('phone')}
            onChange={(v) => onChange({ phone: v })}
            onBlur={() => onChange({ phone: customer.phone.trim() })}
          />
          <TextField
            className='span2'
            label='Email'
            type='email'
            inputMode='email'
            autoCapitalize='none'
            required={!hasContact}
            markRequired={!customer.phone.trim()}
            value={customer.email}
            autoComplete='off'
            maxLength={254}
            error={errorFor('email')}
            onChange={(v) => onChange({ email: v })}
            onBlur={() => {
              touch('email');
              onChange({ email: customer.email.trim().toLowerCase() });
            }}
          />
        </div>
      </Card>

      <NavRow>
        <NextButton
          disabled={blocker !== null}
          onClick={() => nav.go('parameters')}
        >
          Next: parameters →
        </NextButton>
      </NavRow>
      <NavNote message={blocker} />
    </section>
  );
}
