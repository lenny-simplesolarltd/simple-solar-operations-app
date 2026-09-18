// Customer + sale field rules. The database function re-validates everything;
// these exist so the surveyor gets the answer before submitting.

export interface CustomerDraft {
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  postcode: string;
  phone: string;
  email: string;
}

export type CustomerField = keyof CustomerDraft;

export function emptyCustomer(): CustomerDraft {
  return {
    firstName: '',
    lastName: '',
    addressLine1: '',
    addressLine2: '',
    town: '',
    postcode: '',
    phone: '',
    email: ''
  };
}

// Outward: A9, A9A, A99, AA9, AA9A, AA99. Inward: 9AA. Plus the GIR 0AA special.
const UK_POSTCODE = /^(GIR0AA|[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Upper-cased with exactly one space before the inward code, or null if invalid. */
export function normalisePostcode(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  if (!UK_POSTCODE.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** Trimmed + lower-cased, or null if not a plausible address. */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

export type CustomerErrors = Partial<Record<CustomerField, string>>;

export function validateCustomer(c: CustomerDraft): CustomerErrors {
  const errors: CustomerErrors = {};
  if (!c.firstName.trim()) errors.firstName = 'Enter the first name.';
  if (!c.lastName.trim()) errors.lastName = 'Enter the last name.';
  if (!c.addressLine1.trim())
    errors.addressLine1 = 'Enter the first line of the address.';
  if (!c.town.trim()) errors.town = 'Enter the town.';
  if (!c.postcode.trim()) errors.postcode = 'Enter the postcode.';
  else if (!normalisePostcode(c.postcode))
    errors.postcode = 'Enter a valid UK postcode, e.g. SW1A 1AA.';
  const phone = c.phone.trim();
  const email = c.email.trim();
  if (email && !normaliseEmail(email))
    errors.email = 'Enter a valid email address.';
  if (!phone && !email) {
    errors.phone = 'Enter a phone number or an email address.';
    errors.email = errors.phone;
  }
  return errors;
}

export function customerIsValid(c: CustomerDraft): boolean {
  return Object.keys(validateCustomer(c)).length === 0;
}

const PRICE = /^\d+(\.\d{1,2})?$/;

/** Pence for a typed price ("£12,345.50" -> 1234550), or null if invalid / not > 0. */
export function parsePriceToPence(raw: string): number | null {
  const cleaned = raw.replace(/[£,\s]/g, '');
  if (!PRICE.test(cleaned)) return null;
  const pence = Math.round(parseFloat(cleaned) * 100);
  return pence > 0 ? pence : null;
}

export function blankToNull(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}
