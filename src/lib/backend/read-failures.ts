import type { ReadFailureKind } from './types';

// How a refusal code from the read functions is shown to staff. Pure, so the
// wording can be tested without a database.

const FORBIDDEN = new Set([
  'R1A_ROLE_DENIED',
  'R1A_JOB_ACCESS_DENIED',
  'R1A_TASK_ACCESS_DENIED',
  'R1A_AUTHENTICATED_EMAIL_REQUIRED',
  'R1A_UNKNOWN_OR_DUPLICATE_ACTOR',
  'R1A_INACTIVE_ACTOR',
  'R1A_NO_ACTIVE_ROLE'
]);

// The release gate. The function behind the screen is switched off (or has no
// release mode configured) for EVERYONE, whatever their role. The gate stays
// the backend's decision: this only changes what the refusal is called.
const RELEASE_GATE = new Set(['R1A_MODE_DENIED', 'R1A_MODE_MISSING']);

export function classifyReadFailure(code: string): ReadFailureKind {
  if (RELEASE_GATE.has(code)) return 'not_enabled';
  if (FORBIDDEN.has(code) || /_DENIED$/.test(code)) return 'forbidden';
  if (/_NOT_FOUND$/.test(code)) return 'not_found';
  if (/INVALID|REQUIRED|_DATE_INVALID$/.test(code)) return 'invalid';
  return 'error';
}

export const READ_FAILURE_MESSAGES: Record<ReadFailureKind, string> = {
  forbidden: 'You don’t have access to this.',
  not_enabled:
    'This part of the system is switched off at the moment. Nothing is wrong with your account: it will work here once it has been switched on.',
  not_found: 'That record could not be found.',
  invalid: 'Some of the filters are not valid.',
  error: 'Something went wrong loading this. Try again.',
  unavailable:
    'This screen needs a backend update that has not been deployed to this database yet.'
};
