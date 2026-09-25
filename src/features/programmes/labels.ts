// Staff-facing wording for the programme vocabulary. Safe to import anywhere.
//
// Refusals are worded by the database (app.result_error_catalogue), so nothing
// here duplicates them: these are the names of states, not of failures.

import type {
  Disposition,
  ImportKey,
  PortalVerification,
  SignalClass,
  VisitOutcome
} from './types';

export const OUTCOME_LABEL: Record<VisitOutcome, string> = {
  TenantNotHome: 'Tenant not home',
  SimChangedPortalWorking: 'SIM changed — portal working',
  SimChangedPortalNotWorking: 'SIM changed — portal not working',
  MeterDead: 'Meter dead'
};

/** Short forms, for table cells and board cards. */
export const OUTCOME_SHORT: Record<VisitOutcome, string> = {
  TenantNotHome: 'No access',
  SimChangedPortalWorking: 'SIM changed',
  SimChangedPortalNotWorking: 'SIM changed (portal off)',
  MeterDead: 'Meter dead'
};

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  AwaitingReview: 'Awaiting review',
  NoAccessRebook: 'No access — rebook',
  ActionRequired: 'Action required',
  MeterRequiresChanging: 'Meter requires changing',
  CompleteAndWorking: 'Complete & working'
};

export const DISPOSITION_HINT: Record<Disposition, string> = {
  AwaitingReview: 'Submitted by the installer, not yet checked by the office.',
  NoAccessRebook: 'Nobody in. Needs another appointment.',
  ActionRequired: 'Something needs doing before this property is finished.',
  MeterRequiresChanging: 'The meter itself has to be replaced.',
  CompleteAndWorking:
    'Confirmed live and reporting in the PCH portal. Nothing further to do.'
};

export const PORTAL_LABEL: Record<PortalVerification, string> = {
  ConfirmedLive: 'Confirmed live/reporting',
  NotLive: 'Not live/reporting',
  UnableToVerify: 'Unable to verify'
};

export const SIGNAL_LABEL: Record<SignalClass, string> = {
  Good: 'Good',
  Advisory: 'Advisory',
  Bad: 'Bad'
};

export const SIGNAL_HINT: Record<SignalClass, string> = {
  Good: 'Signal present. Still needs portal confirmation.',
  Advisory: 'Marginal. An antenna may be required.',
  Bad: 'Not working at this signal level.'
};

/** Why the office is being asked to look at a visit. */
export const REVIEW_REASON_LABEL: Record<string, string> = {
  MeterSerialMismatch:
    'The meter on site is not the one the client’s records name',
  MeterSerialNotComparable: 'No expected meter serial on record to compare',
  BadSignal: 'CSQ is in the bad band',
  AdvisorySignal: 'CSQ is in the advisory band — an antenna may be needed',
  MeterDead: 'The installer reported a dead meter',
  NoAccess: 'Nobody in',
  InstallerReportsPortalNotWorking:
    'The installer reported the portal not working',
  PortalVerificationRequired:
    'The office must confirm the meter is live in the PCH portal'
};

export const reviewReason = (code: string) => REVIEW_REASON_LABEL[code] ?? code;

export const IMPORT_KEY_LABEL: Record<ImportKey, string> = {
  external_ref: 'Property ID (the client’s reference)',
  address_line1: 'Address line 1',
  address_line2: 'Address line 2',
  town: 'Town',
  postcode: 'Postcode',
  expected_meter_serial: 'Expected meter serial',
  existing_sim_serial: 'Existing SIM serial',
  notes: 'Notes'
};

export const EVIDENCE_CATEGORY_LABEL: Record<string, string> = {
  MeterPhoto: 'Meter',
  SimSerialPhoto: 'SIM serial',
  CsqPhoto: 'CSQ',
  CallingCard: 'Calling card',
  ProgrammeOther: 'Other'
};

export const evidenceCategory = (code: string) =>
  EVIDENCE_CATEGORY_LABEL[code] ?? code;

/**
 * How the configured signal bands read, in words, including whether the
 * boundary is still unconfirmed. Shown wherever a CSQ band is explained, so
 * nobody has to guess what the system decided.
 */
export function signalBandsSentence(config: {
  good_min?: number;
  bad_max?: number;
  bad_max_inclusive?: boolean;
}) {
  const good = config.good_min ?? 14;
  const bad = config.bad_max ?? 4;
  const inclusive = config.bad_max_inclusive ?? true;
  return `Good is ${good} or above. Bad is ${inclusive ? `${bad} or below` : `below ${bad}`}. Anything between is advisory.`;
}

const ADDRESS_PARTS = ['addressLine1', 'town', 'postcode'] as const;

export function propertyAddress(property: {
  addressLine1: string;
  town?: string | null;
  postcode?: string | null;
}) {
  return ADDRESS_PARTS.map((k) => property[k])
    .filter(Boolean)
    .join(', ');
}
