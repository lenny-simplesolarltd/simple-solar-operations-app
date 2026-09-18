import { describe, expect, it } from 'vitest';

import {
  customerIsValid,
  emptyCustomer,
  normaliseEmail,
  normalisePostcode,
  parsePriceToPence,
  validateCustomer
} from '../validation';

describe('normalisePostcode', () => {
  it.each([
    ['sw1a1aa', 'SW1A 1AA'],
    [' m1  1ae ', 'M1 1AE'],
    ['B338TH', 'B33 8TH'],
    ['cr2 6xh', 'CR2 6XH'],
    ['DN55 1PT', 'DN55 1PT'],
    ['w1a0ax', 'W1A 0AX'],
    ['EC1A 1BB', 'EC1A 1BB'],
    ['gir 0aa', 'GIR 0AA'],
    ['S W 1 A 1 A A', 'SW1A 1AA']
  ])('%s -> %s', (raw, expected) => {
    expect(normalisePostcode(raw)).toBe(expected);
  });

  it.each([
    '',
    'SW1A',
    '12345',
    'SW1A 1A',
    'SW1A 1AAA',
    'AAA1 1AA',
    'S!1A 1AA',
    '1SW 1AA'
  ])('rejects %s', (raw) => {
    expect(normalisePostcode(raw)).toBeNull();
  });
});

describe('normaliseEmail', () => {
  it('trims and lower-cases', () => {
    expect(normaliseEmail('  Jo.Bloggs@Example.CO.UK ')).toBe(
      'jo.bloggs@example.co.uk'
    );
  });
  it.each([
    'jo',
    'jo@',
    'jo@example',
    '@example.com',
    'jo bloggs@example.com',
    'jo@exa mple.com'
  ])('rejects %s', (raw) => {
    expect(normaliseEmail(raw)).toBeNull();
  });
});

describe('validateCustomer', () => {
  const valid = {
    ...emptyCustomer(),
    firstName: 'Jo',
    lastName: 'Bloggs',
    addressLine1: '1 High Street',
    town: 'Leeds',
    postcode: 'LS1 4AP',
    phone: '07123 456789'
  };

  it('accepts a complete customer with only a phone', () => {
    expect(validateCustomer(valid)).toEqual({});
    expect(customerIsValid(valid)).toBe(true);
  });

  it('accepts only an email', () => {
    expect(
      customerIsValid({ ...valid, phone: '', email: 'jo@example.com' })
    ).toBe(true);
  });

  it('needs a phone or an email', () => {
    const errors = validateCustomer({ ...valid, phone: '  ' });
    expect(errors.phone).toBeDefined();
    expect(errors.email).toBeDefined();
  });

  it('flags each blank required field, treating whitespace as blank', () => {
    const errors = validateCustomer({ ...emptyCustomer(), firstName: '   ' });
    expect(Object.keys(errors).sort()).toEqual(
      [
        'addressLine1',
        'email',
        'firstName',
        'lastName',
        'phone',
        'postcode',
        'town'
      ].sort()
    );
  });

  it('flags a malformed postcode and email, and leaves address line 2 optional', () => {
    const errors = validateCustomer({
      ...valid,
      postcode: 'LS1',
      email: 'nope'
    });
    expect(Object.keys(errors).sort()).toEqual(['email', 'postcode']);
  });
});

describe('parsePriceToPence', () => {
  it.each([
    ['12450', 1245000],
    ['12450.5', 1245050],
    ['12450.50', 1245050],
    ['£12,450.50', 1245050],
    [' £ 9 876.01 ', 987601],
    ['0.01', 1],
    ['19.99', 1999],
    ['1.15', 115],
    ['4.35', 435]
  ])('%s -> %d', (raw, pence) => {
    expect(parsePriceToPence(raw)).toBe(pence);
  });

  it.each([
    '',
    '0',
    '0.00',
    '-5',
    '12.345',
    '12.',
    '.50',
    'abc',
    '1e3',
    '12,450.5.0',
    '£'
  ])('rejects %s', (raw) => {
    expect(parsePriceToPence(raw)).toBeNull();
  });
});
