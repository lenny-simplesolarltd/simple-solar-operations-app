import type { OpsFlag, OpsPackage } from '@/lib/backend/models';

// Wording for JOB_OPERATIONS availability. The server decides; this only says
// which kind of "no" it is, so a switched-off release never reads as a
// permissions problem (and the other way round).

const STATE: Record<string, string> = {
  JOB_NOT_ACTIONABLE: 'The job is cancelled or archived.',
  JOB_ARCHIVED: 'The job is archived.',
  CANCELLATION_STARTED: 'Cancellation has already started.',
  STAGE_NOT_CANCELLED: 'Only a cancelled job can be reinstated.',
  COMMISSIONING_NOT_REQUIRED: 'This work package does not need commissioning.',
  WORK_PACKAGE_CANCELLED: 'This work package is cancelled.',
  INSTALLER_FORM_ACCEPTED:
    'An installer commissioning form is already accepted.',
  NORMAL_WORK_SUPPRESSED:
    'Paused while a cancellation or reopen review is open.',
  STAGE_NOT_ELIGIBLE: 'Only once the job is booked.',
  NO_ACTIVE_ALLOCATION: 'No installer is allocated yet.',
  ALREADY_RESOLVED: 'Already resolved.',
  RESOLVE_FIRST: 'Resolve the issue first.',
  ISSUE_CLOSED: 'The issue is closed.',
  ALREADY_COMPLETE: 'The job is already operationally complete.',
  COMPLETION_GATE_OPEN: 'Completion checks are outstanding.',
  CANCELLATION_NOT_ACTIVE: 'The job is not being cancelled.',
  NO_OPEN_CANCELLATION_TASKS: 'No cancellation tasks are open.',
  CANCELLATION_NOT_IN_PROGRESS: 'Only while the cancellation is in progress.',
  CONFIRMATION_OUTSTANDING:
    'Resolve the confirmation tasks (merchant, scaffold, calendar) first.',
  NO_REOPEN_REVIEW: 'No reopen review is open.',
  CANCELLATION_ACTIVE: 'The job is being cancelled.'
};

export function flagText(flag: OpsFlag | undefined): string | undefined {
  if (!flag || flag.available) return undefined;
  switch (flag.denied) {
    case 'MODE':
      return 'Switched off for this release. An administrator turns it on.';
    case 'ROLE':
      return 'Your role can’t do this.';
    case 'ACCESS':
      return 'You’re not assigned to this job.';
    default:
      return (flag.reason && STATE[flag.reason]) ?? 'Not available right now.';
  }
}

/** One line per completion-gate reason (app.s10_evaluate_operational_completion). */
export function gateReasonText(reason: string, packages: OpsPackage[]) {
  if (reason === 'REQUIRED_WORK_UNCONFIRMED')
    return 'Installer confirmation is missing for a required work package (INS01 call).';
  if (reason === 'CUSTOMER_NOT_HAPPY')
    return 'The customer happy call (INS04) is not recorded yet.';
  if (reason === 'BLOCKING_ISSUE_OPEN')
    return 'An issue that blocks completion is still open.';
  if (reason.startsWith('COMMISSIONING_NOT_ACCEPTED:')) {
    const wp = packages.find((p) => p.id === reason.split(':')[1]);
    return `Commissioning is not recorded for ${wp?.trade ?? 'a work package'}.`;
  }
  return reason;
}

export const CALL_TYPES = ['Customer', 'Installer', 'Supplier', 'Payment'].map(
  (v) => ({ value: v, label: v })
);

export const CALL_OUTCOMES = [
  { value: 'Complete', label: 'Spoke - done' },
  { value: 'NoAnswer', label: 'No answer' },
  { value: 'Confirmed', label: 'Confirmed' },
  { value: 'Unhappy', label: 'Unhappy' },
  { value: 'ReturnRequired', label: 'Return required' },
  { value: 'Other', label: 'Other' }
];
