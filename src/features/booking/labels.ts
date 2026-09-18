// Staff wording for booking gate names and intake review reasons returned by
// the backend. Unknown codes fall back to the code itself. Client-safe.

const GATES: Record<string, string> = {
  sold_linked: 'Sale recorded',
  sold_booking_linked: 'Booking form received',
  sold_booking_match: 'Booking matches the sale',
  finance_route_valid: 'Payment route set',
  signed_contract_evidence: 'Signed contract on file',
  contract_status: 'Signed contract on file',
  customer_exists: 'Customer linked',
  customer_details_complete: 'Customer address complete',
  customer_value_verified: 'Customer and value verified',
  deposit_confirmed: 'Deposit in the bank',
  deposit_confirmation_evidence: 'Deposit in the bank',
  finance_agreement_evidence: 'Finance agreement on file',
  gross_amount_present: 'Contract value recorded',
  PRE01_satisfied: 'Deposit invoice sent (PRE01)',
  PRE02_satisfied: 'Contract signed (PRE02)',
  PRE03_satisfied: 'Deposit checked (PRE03)',
  PRE04_satisfied: 'Details verified (PRE04)',
  PRE05_satisfied: 'Finance agreed (PRE05)'
};

export function gateLabel(name: string): string {
  if (GATES[name]) return GATES[name];
  const task = /^task_([A-Z0-9-]+)$/.exec(name);
  if (task) return `Task ${task[1]} done`;
  return name.replace(/_/g, ' ');
}

const REASONS: Record<string, string> = {
  CUSTOMER_MISMATCH: 'Customer details differ from the sale',
  AMOUNT_MISMATCH: 'Price differs from the contract value',
  SCAFFOLD_NOT_REQUIRED: 'Scaffold details given but the job has no scaffold',
  SCAFFOLD_COMPANY_UNRESOLVED: 'Scaffolder not recognised',
  MERCHANT_UNRESOLVED: 'Merchant not recognised',
  INSTALLER_NOT_FOUND: 'Installer not found',
  INSTALLER_AMBIGUOUS: 'Installer name matches more than one person',
  PRODUCT_ID_NEED_APPROVAL: 'Product needs mapping',
  NOTE: 'Note'
};

export const reasonLabel = (code: string) =>
  REASONS[code] ?? code.replace(/_/g, ' ').toLowerCase();

const FIELDS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  address_line1: 'Street address',
  town: 'Town',
  postcode: 'Postcode',
  phone: 'Phone',
  email: 'Email'
};

export const fieldLabel = (field: string) => FIELDS[field] ?? field;
