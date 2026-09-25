// The shapes the Programmes screens read. Mirrors the columns of
// public.programmes / programme_properties / programme_visits; the database is
// the authority for every rule about them.

export const VISIT_OUTCOMES = [
  'TenantNotHome',
  'SimChangedPortalWorking',
  'SimChangedPortalNotWorking',
  'MeterDead'
] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

/**
 * Cards rendered per column, and per "Load more". The column header always
 * states the column's real size, which at programme scale is far larger.
 */
export const COLUMN_CARDS = 60;

/** The board's columns, in board order. */
export const DISPOSITIONS = [
  'AwaitingReview',
  'NoAccessRebook',
  'ActionRequired',
  'MeterRequiresChanging',
  'CompleteAndWorking'
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const PORTAL_VERIFICATIONS = [
  'ConfirmedLive',
  'NotLive',
  'UnableToVerify'
] as const;
export type PortalVerification = (typeof PORTAL_VERIFICATIONS)[number];

export type SignalClass = 'Good' | 'Advisory' | 'Bad';
/** Named so the URL layer can validate a review status like any other filter. */
export const REVIEW_STATUSES = ['Draft', 'AwaitingReview', 'Reviewed'] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface SignalConfig {
  metric?: string;
  min?: number;
  max?: number;
  good_min?: number;
  bad_max?: number;
  bad_max_inclusive?: boolean;
  /** true until the client confirms whether the bad/advisory boundary is inclusive. */
  boundary_unresolved?: boolean;
  boundary_question?: string;
}

export interface ProgrammeSummary {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  status: 'Planning' | 'Active' | 'Paused' | 'Closed';
  startsOn: string | null;
  endsOn: string | null;
  visitFormId: string | null;
  signalConfig: SignalConfig;
  propertyVisibility: 'Assigned' | 'AllInProgramme';
  /** Which canonical import field identifies a property in this programme's source data. */
  importIdentityKey: IdentityKey;
  synthetic: boolean;
  notes: string | null;
  version: number;
}

export interface ProgrammeProperty {
  id: string;
  programmeId: string;
  /** The client's own reference, when they issue one. Empty when they do not. */
  externalRef: string;
  addressLine1: string;
  addressLine2: string | null;
  town: string | null;
  postcode: string | null;
  expectedMeterSerial: string | null;
  /** Baseline from the client's register: what is fitted now, not what the visit found. */
  existingSimSerial: string | null;
  existingSimType: string | null;
  notes: string | null;
  active: boolean;
  synthetic: boolean;
  version: number;
}

export interface VisitEvidence {
  id: string;
  category: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

/** One visit, with the property and installer a reviewer needs to see beside it. */
export interface ProgrammeVisit {
  id: string;
  programmeId: string;
  propertyId: string;
  installerId: string;
  installerName: string | null;
  /** The client's baseline for this property: what their records say is there. */
  property: {
    externalRef: string;
    addressLine1: string;
    town: string | null;
    postcode: string | null;
    expectedMeterSerial: string | null;
    existingSimType: string | null;
    existingSimSerial: string | null;
  };
  outcome: VisitOutcome | null;
  actualMeterSerial: string | null;
  meterReading: number | null;
  newSimSerial: string | null;
  csq: number | null;
  installerComments: string | null;
  meterSerialMatches: boolean | null;
  signalClassification: SignalClass | null;
  portalCheckRequired: boolean;
  reviewReasons: string[];
  recommendedDisposition: Disposition | null;
  reviewStatus: ReviewStatus;
  disposition: Disposition;
  portalVerification: PortalVerification | null;
  actionNote: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  visitDate: string | null;
  submittedAt: string | null;
  formRevisionId: string | null;
  submissionId: string | null;
  version: number;
}

export interface ProgrammeDashboard {
  programme: {
    id: string;
    code: string;
    name: string;
    status: string;
    client_name: string | null;
    starts_on: string | null;
    ends_on: string | null;
    signal_config: SignalConfig;
    synthetic: boolean;
  };
  /** The programme's own recorded target and window; null when not agreed. */
  target_property_count: number | null;
  delivery_start_date: string | null;
  delivery_end_date: string | null;
  today: string;
  total_properties: number;
  attended: number;
  completed_properties: number;
  remaining: number;
  visits_total: number;
  visits_today: number;
  sims_changed: number;
  no_access: number;
  meter_dead: number;
  awaiting_review: number;
  action_required: number;
  meter_replacements_required: number;
  no_access_rebook: number;
  complete_and_working: number;
  serial_mismatches: number;
  portal_confirmed_live: number;
  portal_not_live: number;
  portal_unable_to_verify: number;
  portal_outstanding: number;
  csq_bands: {
    good: number;
    advisory: number;
    bad: number;
    not_recorded: number;
  };
  by_day: {
    date: string;
    visits: number;
    sims_changed: number;
    no_access: number;
    meter_dead: number;
  }[];
  by_installer: {
    installer_id: string;
    installer: string | null;
    visits: number;
    sims_changed: number;
    no_access: number;
  }[];
}

export interface DailyReport {
  programme: {
    id: string;
    code: string;
    name: string;
    client_name: string | null;
  };
  date: string;
  properties_attended: number;
  sims_swapped: number;
  no_access: number;
  meters_requiring_replacement: number;
  action_required: number;
  complete_and_live: number;
  awaiting_review: number;
  awaiting_portal_confirmation: number;
  portal_confirmed_live: number;
  portal_not_live: number;
  portal_unable_to_verify: number;
  serial_mismatches: number;
  visits: number;
  lines: {
    external_ref: string;
    address: string;
    postcode: string | null;
    installer: string | null;
    outcome: VisitOutcome;
    expected_meter_serial: string | null;
    actual_meter_serial: string | null;
    meter_serial_matches: boolean | null;
    meter_reading: number | null;
    new_sim_serial: string | null;
    csq: number | null;
    signal_classification: SignalClass | null;
    portal_verification: PortalVerification | null;
    disposition: Disposition;
    review_status: ReviewStatus;
    comments: string | null;
  }[];
}

/** A page of visits and the true total behind the same filters. */
export interface VisitPage {
  visits: ProgrammeVisit[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * The filters plus the page, as the URL carries them.
 *
 * Paging lives with the filters because a page number without its filters is
 * meaningless: "page 3" is only page 3 of a particular question.
 */
export interface VisitListQuery extends VisitFilters {
  /** One box: address, postcode, PCH id, meter serial, SIM serial. */
  query?: string;
  offset?: number;
  limit?: number;
}

/** The filters every programme read understands. Mirrors app.programme_visit_filter. */
export interface VisitFilters {
  from?: string;
  to?: string;
  installer_id?: string;
  outcome?: VisitOutcome;
  disposition?: Disposition;
  review_status?: ReviewStatus;
  signal_classification?: SignalClass;
  portal_verification?: PortalVerification;
  postcode?: string;
}

export interface ImportSummary {
  id: string;
  programmeId: string;
  filename: string;
  header: string[];
  rowCount: number;
  mapping: Record<string, number> | null;
  status: 'Draft' | 'Mapped' | 'Applied' | 'Discarded';
  validRows: number | null;
  invalidRows: number | null;
  createdCount: number | null;
  updatedCount: number | null;
  appliedAt: string | null;
  createdAt: string;
  version: number;
}

export interface ImportRow {
  rowIndex: number;
  cells: string[];
  mapped: Record<string, string | null> | null;
  problems: { field: string; problem: string }[];
  action: 'Create' | 'Update' | 'Skip' | 'Invalid' | null;
}

/** The canonical property fields an import can map a column onto. */
export const IMPORT_KEYS = [
  'external_ref',
  'address_line1',
  'address_line2',
  'town',
  'postcode',
  'expected_meter_serial',
  'existing_sim_serial',
  'existing_sim_type',
  'notes'
] as const;
export type ImportKey = (typeof IMPORT_KEYS)[number];

/**
 * The canonical field whose value identifies a property in a programme's source
 * data. Mirrors programmes.import_identity_key.
 */
export const IDENTITY_KEYS = ['external_ref', 'expected_meter_serial'] as const;
export type IdentityKey = (typeof IDENTITY_KEYS)[number];
export const DEFAULT_IDENTITY_KEY: IdentityKey = 'external_ref';

/**
 * What a file must carry before it can be imported into a programme: that
 * programme's identity field, and an address. Nothing else - a SIM serial or
 * type the client omitted is missing baseline data, not an unimportable
 * property, because the installer records what is actually on site.
 */
export const importKeyRequired = (
  identityKey: IdentityKey = DEFAULT_IDENTITY_KEY
): readonly ImportKey[] => [identityKey, 'address_line1'];
