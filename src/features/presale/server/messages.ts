// Staff-facing wording for the codes raised by public.submit_presale().
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED:
    'Your session has ended. Sign in again to submit this sale.',
  PERMISSION_DENIED: 'Your account is not allowed to submit a sale.',
  INVALID_COMMAND_ID: 'This sale could not be identified. Start a new presale.',
  INVALID_FIELDS: 'The sale contains a value the system does not accept.',
  INVALID_POSTCODE: 'Enter a valid UK postcode.',
  INVALID_EMAIL: 'Enter a valid email address.',
  CONTACT_METHOD_REQUIRED:
    'Enter a phone number or an email address for the customer.',
  INVALID_FINANCE_ROUTE: 'Choose how the customer is paying.',
  INVALID_GROSS_AMOUNT:
    'Enter the agreed selling price - it must be more than zero.',
  REQUIRED_SALESPERSON_ID: 'Choose the salesperson.',
  SALESPERSON_MUST_BE_SELF: 'You can only submit a sale as yourself.',
  SALESPERSON_NOT_FOUND: 'The salesperson must be an active Surveyor.',
  COMMAND_ID_CONFLICT:
    'This sale was already submitted and has since been changed here. Check My presales before starting a new one.',
  COMMAND_IN_PROGRESS:
    'This sale is still being recorded. Try again in a moment.',
  TASK_ASSIGNMENT_CONFIG:
    'The sale was not recorded: a follow-up task has no available owner. Ask an administrator to check task assignments.',
  TASK_TEMPLATE_CONFIG:
    'The sale was not recorded: a required task template is switched off. Ask an administrator.',
  JOB_ID_COLLISION_EXHAUSTED:
    'A job reference could not be generated. Try again.'
};

const REQUIRED_LABELS: Record<string, string> = {
  FIRST_NAME: 'first name',
  LAST_NAME: 'last name',
  ADDRESS_LINE1: 'first line of the address',
  TOWN: 'town',
  POSTCODE: 'postcode',
  FINANCE_ROUTE: 'finance route',
  ROOF_REQUIRED: 'roof scope',
  ELECTRICAL_REQUIRED: 'electrical scope',
  SCAFFOLD_REQUIRED: 'scaffold scope'
};

export function messageFor(code: string): string {
  if (MESSAGES[code]) return MESSAGES[code];
  const required = code.match(/^REQUIRED_(.+)$/);
  if (required)
    return `Enter the ${REQUIRED_LABELS[required[1]] ?? 'missing value'}.`;
  if (code.startsWith('TOO_LONG_')) return 'One of the values is too long.';
  return 'The sale could not be recorded. Nothing was saved - try again.';
}
