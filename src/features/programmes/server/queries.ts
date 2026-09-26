import 'server-only';

import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser, type AppUser } from '@/lib/auth';
import { programmeDb } from './db';
import type {
  DailyReport,
  Disposition,
  ImportRow,
  ImportSummary,
  ProgrammeDashboard,
  ProgrammeProperty,
  ProgrammeSummary,
  ProgrammeVisit,
  SignalConfig,
  VisitEvidence,
  VisitFilters,
  VisitListQuery,
  VisitPage,
  FormResponseReport,
  ReportSourceKind,
  ReportSubscriptions,
  ReportRun
} from '../types';

import { DEFAULT_IDENTITY_KEY } from '../types';

/**
 * Programme reads.
 *
 * Every row-level read here is a plain SELECT under RLS, so what comes back is
 * exactly what this person is allowed to see - an installer gets their own
 * visits and the properties their programme's policy allows, the office gets
 * everything - without any of these functions deciding it. The aggregates go
 * through public.execute_operations_read, which checks programme.report.
 *
 * Nothing here is ever the authority on a rule: it is the authority on nothing
 * at all. It reads.
 */

const VISIT_COLUMNS = `
  id, programme_id, property_id, installer_id,
  outcome, actual_meter_serial, meter_reading, new_sim_serial, csq, installer_comments,
  meter_serial_matches, signal_classification, portal_check_required, review_reasons,
  recommended_disposition, review_status, disposition, portal_verification, action_note,
  reviewed_by, reviewed_at, visit_date, submitted_at, form_revision_id, submission_id, version,
  property:programme_properties!programme_visits_property_id_fkey!inner (
    external_ref, address_line1, town, postcode, expected_meter_serial,
    existing_sim_type, existing_sim_serial
  ),
  installer:people!programme_visits_installer_id_fkey ( display_name ),
  reviewer:people!programme_visits_reviewed_by_fkey ( display_name )
`;

const VISIT_COLUMNS_BASE = VISIT_COLUMNS.replace(
  '\n    existing_sim_type,',
  '\n   '
);

type VisitRow = {
  id: string;
  programme_id: string;
  property_id: string;
  installer_id: string;
  outcome: string | null;
  actual_meter_serial: string | null;
  meter_reading: string | number | null;
  new_sim_serial: string | null;
  csq: number | null;
  installer_comments: string | null;
  meter_serial_matches: boolean | null;
  signal_classification: string | null;
  portal_check_required: boolean;
  review_reasons: string[] | null;
  recommended_disposition: string | null;
  review_status: string;
  disposition: string;
  portal_verification: string | null;
  action_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  visit_date: string | null;
  submitted_at: string | null;
  form_revision_id: string | null;
  submission_id: string | null;
  version: number;
  property: {
    external_ref: string | null;
    address_line1: string;
    town: string | null;
    postcode: string | null;
    expected_meter_serial: string | null;
    existing_sim_type?: string | null;
    existing_sim_serial: string | null;
  } | null;
  installer: { display_name: string | null } | null;
  reviewer: { display_name: string | null } | null;
};

function toVisit(row: VisitRow): ProgrammeVisit {
  return {
    id: row.id,
    programmeId: row.programme_id,
    propertyId: row.property_id,
    installerId: row.installer_id,
    installerName: row.installer?.display_name ?? null,
    property: {
      externalRef: row.property?.external_ref ?? '',
      addressLine1: row.property?.address_line1 ?? '',
      town: row.property?.town ?? null,
      postcode: row.property?.postcode ?? null,
      expectedMeterSerial: row.property?.expected_meter_serial ?? null,
      existingSimType: row.property?.existing_sim_type ?? null,
      existingSimSerial: row.property?.existing_sim_serial ?? null
    },
    outcome: row.outcome as ProgrammeVisit['outcome'],
    actualMeterSerial: row.actual_meter_serial,
    meterReading: row.meter_reading === null ? null : Number(row.meter_reading),
    newSimSerial: row.new_sim_serial,
    csq: row.csq,
    installerComments: row.installer_comments,
    meterSerialMatches: row.meter_serial_matches,
    signalClassification:
      row.signal_classification as ProgrammeVisit['signalClassification'],
    portalCheckRequired: row.portal_check_required,
    reviewReasons: row.review_reasons ?? [],
    recommendedDisposition:
      row.recommended_disposition as ProgrammeVisit['recommendedDisposition'],
    reviewStatus: row.review_status as ProgrammeVisit['reviewStatus'],
    disposition: row.disposition as Disposition,
    portalVerification:
      row.portal_verification as ProgrammeVisit['portalVerification'],
    actionNote: row.action_note,
    reviewedBy: row.reviewed_by,
    reviewedByName: row.reviewer?.display_name ?? null,
    reviewedAt: row.reviewed_at,
    visitDate: row.visit_date,
    submittedAt: row.submitted_at,
    formRevisionId: row.form_revision_id,
    submissionId: row.submission_id,
    version: row.version
  };
}

type ProgrammeRow = {
  id: string;
  code: string;
  name: string;
  client_name: string | null;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  visit_form_id: string | null;
  signal_config: SignalConfig;
  property_visibility: string;
  import_identity_key?: string | null;
  synthetic: boolean;
  notes: string | null;
  version: number;
};

const toProgramme = (row: ProgrammeRow): ProgrammeSummary => ({
  id: row.id,
  code: row.code,
  name: row.name,
  clientName: row.client_name,
  status: row.status as ProgrammeSummary['status'],
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  visitFormId: row.visit_form_id,
  signalConfig: row.signal_config ?? {},
  propertyVisibility:
    row.property_visibility as ProgrammeSummary['propertyVisibility'],
  importIdentityKey: (row.import_identity_key ??
    DEFAULT_IDENTITY_KEY) as ProgrammeSummary['importIdentityKey'],
  synthetic: row.synthetic,
  notes: row.notes,
  version: row.version
});

const PROGRAMME_COLUMNS_BASE =
  'id, code, name, client_name, status, starts_on, ends_on, visit_form_id, ' +
  'signal_config, property_visibility, synthetic, notes, version';

const PROGRAMME_COLUMNS = `${PROGRAMME_COLUMNS_BASE}, import_identity_key`;

/**
 * Columns that exist only once 20260925170000 has run.
 *
 * Between deploying this code and running that migration, a read naming one of
 * them fails outright - and these reads are on the path of the board, the
 * review screen, the installer's property panel and SimpleBot. Rather than
 * take all of that down for the length of a deployment, a read that trips over
 * a missing column is retried without it: every programme is then on the
 * default identity and the SIM type reads as not recorded, which is exactly
 * the state the data is in before the migration anyway.
 */
const PENDING_COLUMNS = ['import_identity_key', 'existing_sim_type'];

const missingPendingColumn = (message: string) =>
  /does not exist/i.test(message) &&
  PENDING_COLUMNS.some((column) => message.includes(column));

/** Runs a select, and retries with the pre-migration column list if it must. */
async function selectWithFallback<
  R extends { data: unknown; error: { message: string } | null }
>(
  run: (columns: string) => PromiseLike<R>,
  columns: string,
  legacyColumns: string
) {
  let outcome = await run(columns);
  if (outcome.error && missingPendingColumn(outcome.error.message))
    outcome = await run(legacyColumns);
  return outcome;
}

/**
 * Whether the module is switched on at all (FN-22). Fails closed: an error, a
 * database without the function, or a caller with no request scope to read a
 * session from, all count as off.
 *
 * The try/catch matters because this is called while BUILDING things - the
 * dashboard layout's menu, and the assistant's tool registry - and a throw
 * there takes down the whole screen rather than hiding one module.
 */
export async function programmesEnabled(): Promise<boolean> {
  try {
    const supabase = await programmeDb();
    const { data, error } = await supabase.rpc('programmes_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}

/** What this person may do with programmes. Capabilities, never role names. */
export interface ProgrammeAccess {
  read: boolean;
  readAll: boolean;
  submit: boolean;
  review: boolean;
  manage: boolean;
  report: boolean;
}

export async function programmeAccess(user: AppUser): Promise<ProgrammeAccess> {
  const permissions = await getPermissions(user);
  const has = (code: string) => permissions.has(code);
  return {
    read: has('programme.read'),
    readAll: has('programme.read.all'),
    submit: has('programme.visit.submit'),
    review: has('programme.review'),
    manage: has('programme.manage'),
    report: has('programme.report')
  };
}

export async function currentAccess() {
  const user = await getCurrentUser();
  if (!user) return null;
  return { user, access: await programmeAccess(user) };
}

export async function listProgrammes(): Promise<ProgrammeSummary[]> {
  const supabase = await programmeDb();
  const query = (columns: string) =>
    supabase
      .from('programmes')
      .select(columns)
      .order('synthetic', { ascending: true })
      .order('name');
  const { data, error } = await selectWithFallback(
    query,
    PROGRAMME_COLUMNS,
    PROGRAMME_COLUMNS_BASE
  );
  if (error) throw new Error(`programmes: ${error.message}`);
  return (data as unknown as ProgrammeRow[]).map(toProgramme);
}

export async function getProgramme(
  programmeId: string
): Promise<ProgrammeSummary | null> {
  const supabase = await programmeDb();
  const query = (columns: string) =>
    supabase
      .from('programmes')
      .select(columns)
      .eq('id', programmeId)
      .maybeSingle();
  const { data, error } = await selectWithFallback(
    query,
    PROGRAMME_COLUMNS,
    PROGRAMME_COLUMNS_BASE
  );
  if (error) throw new Error(`programme: ${error.message}`);
  return data ? toProgramme(data as unknown as ProgrammeRow) : null;
}

const PROPERTY_COLUMNS =
  'id, programme_id, external_ref, address_line1, address_line2, town, postcode, ' +
  'expected_meter_serial, existing_sim_serial, existing_sim_type, notes, active, synthetic, version';

const PROPERTY_COLUMNS_BASE = PROPERTY_COLUMNS.replace(
  ', existing_sim_type',
  ''
);

type PropertyRow = {
  id: string;
  programme_id: string;
  external_ref: string | null;
  address_line1: string;
  address_line2: string | null;
  town: string | null;
  postcode: string | null;
  expected_meter_serial: string | null;
  existing_sim_serial: string | null;
  existing_sim_type?: string | null;
  notes: string | null;
  active: boolean;
  synthetic: boolean;
  version: number;
};

const toProperty = (r: PropertyRow): ProgrammeProperty => ({
  id: r.id,
  programmeId: r.programme_id,
  externalRef: r.external_ref ?? '',
  addressLine1: r.address_line1,
  addressLine2: r.address_line2,
  town: r.town,
  postcode: r.postcode,
  expectedMeterSerial: r.expected_meter_serial,
  existingSimType: r.existing_sim_type ?? null,
  existingSimSerial: r.existing_sim_serial,
  notes: r.notes,
  active: r.active,
  synthetic: r.synthetic,
  version: r.version
});

export interface PropertySearch {
  query?: string;
  /** 'outstanding' hides properties that already have a submitted visit. */
  only?: 'all' | 'outstanding';
  limit?: number;
  offset?: number;
}

/** A page of properties and the true total behind the same search. */
export interface PropertyPage {
  properties: ProgrammeProperty[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * Property search: one box, matched against the address, the postcode, the
 * client's reference and the expected meter serial - the four things a field
 * worker might have in front of them.
 *
 * "Outstanding" is decided by the database, not afterwards. It used to fetch a
 * page and then drop the visited ones from it in JavaScript, which meant a
 * search for outstanding EX1 properties looked only at the first page of EX1
 * properties, returned fewer than it found, and could never say how many there
 * really were. The anti-join below asks the question properly: properties with
 * no visit that has left Draft - the same definition visitedPropertyIds uses,
 * so the list and the count cannot drift from the rest of the screen.
 */
export async function searchPropertyPage(
  programmeId: string,
  search: PropertySearch = {}
): Promise<PropertyPage> {
  const supabase = await programmeDb();
  const limit = Math.min(Math.max(search.limit ?? 25, 1), 200);
  const offset = Math.max(search.offset ?? 0, 0);
  const outstanding = search.only === 'outstanding';

  const build = (columns: string) => {
    let query = supabase
      .from('programme_properties')
      .select(
        outstanding
          ? `${columns}, visits:programme_visits!programme_visits_property_id_fkey!left(id)`
          : columns,
        { count: 'exact' }
      )
      .eq('programme_id', programmeId)
      .eq('active', true);

    if (outstanding) {
      // A draft is on no board and in no count, so it does not make a property
      // visited. Filtering the embedded rows first and then requiring none to
      // remain is the anti-join.
      query = query.neq('visits.review_status', 'Draft').is('visits', null);
    }

    const text = (search.query ?? '').trim();
    if (text) {
      // A postcode or a serial is recognised however it was typed; the address and
      // the reference match on any part.
      const loose = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const like = text.replace(/[%_,]/g, ' ');
      const clauses = [
        `address_line1.ilike.%${like}%`,
        `address_line2.ilike.%${like}%`,
        `town.ilike.%${like}%`,
        `external_ref.ilike.%${like}%`
      ];
      if (loose) {
        clauses.push(`postcode_norm.like.${loose}%`);
        clauses.push(`expected_serial_norm.like.%${loose}%`);
      }
      query = query.or(clauses.join(','));
    }

    // external_ref is optional now, so it cannot be the only ordering: a
    // programme keyed by meter has none at all and the page order would be
    // whatever the planner felt like. Address is always present.
    return query
      .order('external_ref', { nullsFirst: false })
      .order('address_line1')
      .range(offset, offset + limit - 1);
  };

  const { data, error, count } = await selectWithFallback(
    build,
    PROPERTY_COLUMNS,
    PROPERTY_COLUMNS_BASE
  );
  if (error) throw new Error(`properties: ${error.message}`);

  return {
    properties: (data as unknown as PropertyRow[]).map(toProperty),
    total: count ?? 0,
    offset,
    limit
  };
}

/** The properties alone, for callers that do not show a total. */
export async function searchProperties(
  programmeId: string,
  search: PropertySearch = {}
): Promise<ProgrammeProperty[]> {
  return (await searchPropertyPage(programmeId, search)).properties;
}

/** Which of these properties already have a submitted visit. */
export async function visitedPropertyIds(
  programmeId: string,
  propertyIds: string[]
): Promise<Set<string>> {
  if (propertyIds.length === 0) return new Set();
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('programme_visits')
    .select('property_id')
    .eq('programme_id', programmeId)
    .neq('review_status', 'Draft')
    .in('property_id', propertyIds);
  if (error) throw new Error(`visited: ${error.message}`);
  return new Set((data ?? []).map((r) => r.property_id as string));
}

export async function getProperty(
  propertyId: string
): Promise<ProgrammeProperty | null> {
  const supabase = await programmeDb();
  const { data, error } = await selectWithFallback(
    (columns) =>
      supabase
        .from('programme_properties')
        .select(columns)
        .eq('id', propertyId)
        .maybeSingle(),
    PROPERTY_COLUMNS,
    PROPERTY_COLUMNS_BASE
  );
  if (error) throw new Error(`property: ${error.message}`);
  return data ? toProperty(data as unknown as PropertyRow) : null;
}

export interface VisitQuery extends VisitListQuery {
  /** Drafts are on no board and in no list unless asked for. */
  includeDrafts?: boolean;
  /** The review queue is worked oldest first; everything else is newest first. */
  order?: 'newest' | 'oldest';
}

/**
 * A page of visits, with the TRUE total behind it.
 *
 * The previous version took the first 500 rows and returned them as if they
 * were everything: at 1,400 properties and 150-200 visits a day, a board could
 * quietly omit most of the programme and the page would say "500 visits" with
 * complete confidence. Every filter is now applied in the database, including
 * the property ones (hence the !inner join above), so the count that comes
 * back describes the same set as the rows.
 */
export async function listVisits(
  programmeId: string,
  filters: VisitQuery = {}
): Promise<VisitPage> {
  const supabase = await programmeDb();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const build = (columns: string) => {
    let query = supabase
      .from('programme_visits')
      .select(columns, { count: 'exact' })
      .eq('programme_id', programmeId);

    if (!filters.includeDrafts) query = query.neq('review_status', 'Draft');
    if (filters.from) query = query.gte('visit_date', filters.from);
    if (filters.to) query = query.lte('visit_date', filters.to);
    if (filters.installer_id)
      query = query.eq('installer_id', filters.installer_id);
    if (filters.outcome) query = query.eq('outcome', filters.outcome);
    if (filters.disposition)
      query = query.eq('disposition', filters.disposition);
    if (filters.review_status)
      query = query.eq('review_status', filters.review_status);
    if (filters.signal_classification)
      query = query.eq('signal_classification', filters.signal_classification);
    if (filters.portal_verification)
      query = query.eq('portal_verification', filters.portal_verification);

    // Postcode area: a prefix on the property's normalised postcode, in the
    // database rather than on the rows that happened to come back.
    const area = (filters.postcode ?? '').replace(/\s/g, '').toUpperCase();
    if (area) query = query.like('property.postcode_norm', `${area}%`);

    // One search box across the things Office actually knows: an address, a
    // postcode, a PCH property id, a meter serial, a SIM serial. They live on two
    // tables, and a PostgREST logic tree cannot span an embedded resource, so the
    // searchable text is maintained on the visit by trigger - see
    // 20260925110000_programme_visit_search.sql. One filter, so it composes with
    // every other filter and the count still describes the rows.
    const text = (filters.query ?? '').trim().toLowerCase();
    if (text) {
      // Wildcards typed into the box are not wildcards, and runs of whitespace
      // collapse because the stored text is single-spaced.
      const safe = text
        .replace(/[%_\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (safe) query = query.ilike('search_text', `%${safe}%`);
    }

    const oldestFirst = filters.order === 'oldest';
    return query
      .order('submitted_at', { ascending: oldestFirst, nullsFirst: false })
      .range(offset, offset + limit - 1);
  };

  const { data, error, count } = await selectWithFallback(
    build,
    VISIT_COLUMNS,
    VISIT_COLUMNS_BASE
  );
  if (error) throw new Error(`visits: ${error.message}`);

  return {
    visits: (data as unknown as VisitRow[]).map(toVisit),
    total: count ?? 0,
    offset,
    limit
  };
}

/** Every visit matching the filters, for exports. Paged so nothing is lost. */
export async function listAllVisits(
  programmeId: string,
  filters: VisitQuery = {},
  cap = 10000
): Promise<ProgrammeVisit[]> {
  const out: ProgrammeVisit[] = [];
  const limit = 500;
  for (let offset = 0; offset < cap; offset += limit) {
    const page = await listVisits(programmeId, { ...filters, limit, offset });
    out.push(...page.visits);
    if (out.length >= page.total || page.visits.length === 0) break;
  }
  return out;
}

export async function getVisit(
  visitId: string
): Promise<ProgrammeVisit | null> {
  const supabase = await programmeDb();
  const { data, error } = await selectWithFallback(
    (columns) =>
      supabase
        .from('programme_visits')
        .select(columns)
        .eq('id', visitId)
        .maybeSingle(),
    VISIT_COLUMNS,
    VISIT_COLUMNS_BASE
  );
  if (error) throw new Error(`visit: ${error.message}`);
  return data ? toVisit(data as unknown as VisitRow) : null;
}

/**
 * The evidence of one visit, as this person may see it. Canonical evidence rows:
 * the images are served by the existing /api/evidence/<id> route, which mints a
 * 60-second signed URL under this person's own session.
 */
export async function visitEvidence(visitId: string): Promise<VisitEvidence[]> {
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('evidence')
    .select('id, category, filename, original_filename, mime_type, size_bytes')
    .eq('programme_visit_id', visitId)
    .eq('upload_status', 'Uploaded')
    .is('trashed_at', null)
    .order('category');
  if (error) throw new Error(`visit evidence: ${error.message}`);
  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      id: row.id as string,
      category: row.category as string,
      filename:
        (row.original_filename as string) ?? (row.filename as string) ?? 'File',
      mimeType: (row.mime_type as string) ?? null,
      sizeBytes: (row.size_bytes as number) ?? null
    };
  });
}

/** Evidence for many visits at once, keyed by visit, for the board and the list. */
export async function evidenceByVisit(
  visitIds: string[]
): Promise<Map<string, VisitEvidence[]>> {
  const out = new Map<string, VisitEvidence[]>();
  if (visitIds.length === 0) return out;
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('evidence')
    .select(
      'id, programme_visit_id, category, filename, original_filename, mime_type, size_bytes'
    )
    .in('programme_visit_id', visitIds)
    .eq('upload_status', 'Uploaded')
    .is('trashed_at', null)
    .order('category');
  if (error) throw new Error(`evidence: ${error.message}`);
  for (const r of data ?? []) {
    const row = r as unknown as Record<string, unknown>;
    const key = row.programme_visit_id as string;
    const list = out.get(key) ?? [];
    list.push({
      id: row.id as string,
      category: row.category as string,
      filename:
        (row.original_filename as string) ?? (row.filename as string) ?? 'File',
      mimeType: (row.mime_type as string) ?? null,
      sizeBytes: (row.size_bytes as number) ?? null
    });
    out.set(key, list);
  }
  return out;
}

/** The people who have recorded a visit in this programme, for the filters. */
export async function listInstallers(
  programmeId: string
): Promise<{ id: string; name: string }[]> {
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('programme_assignments')
    .select(
      'person_id, people!programme_assignments_person_id_fkey(display_name, active)'
    )
    .eq('programme_id', programmeId)
    .eq('active', true);
  if (error) throw new Error(`installers: ${error.message}`);
  return (data ?? [])
    .map((r) => {
      const row = r as unknown as {
        person_id: string;
        people: { display_name: string | null; active: boolean } | null;
      };
      return {
        id: row.person_id,
        name: row.people?.display_name ?? 'Unknown',
        active: row.people?.active ?? false
      };
    })
    .filter((p) => p.active)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The filter keys app.programme_visit_filter will accept.
 *
 * It refuses an unrecognised key outright, and the refusal arrives as a plain
 * P0001 that reads exactly like "you may not see this" - which is how the
 * overview came to say "You do not have access to this programme's reporting" to
 * somebody who had every permission, purely because the URL layer had started
 * carrying a page number. Paging and free-text search belong to the row queries,
 * not to the aggregate reads, so they are dropped here rather than relied upon
 * never to be passed.
 */
const READ_FILTER_KEYS = [
  'from',
  'to',
  'installer_id',
  'outcome',
  'disposition',
  'review_status',
  'signal_classification',
  'portal_verification',
  'postcode'
] as const;

export function readFilters(
  filters: VisitListQuery | VisitFilters
): VisitFilters {
  const out: Record<string, unknown> = {};
  for (const key of READ_FILTER_KEYS) {
    const value = (filters as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out as VisitFilters;
}

async function operationsRead<T>(
  readType: string,
  payload: Record<string, unknown>,
  filters?: VisitListQuery | VisitFilters
): Promise<T | null> {
  const supabase = await programmeDb();
  const safe = filters ? readFilters(filters) : {};
  const { data, error } = await supabase.rpc('execute_operations_read', {
    p_request: {
      read_type: readType,
      payload,
      ...(Object.keys(safe).length ? { filters: safe } : {})
    }
  });
  if (error) {
    // A refusal (no programme.report, module off) is "nothing to show", not a crash.
    if (error.code === 'P0001') return null;
    throw new Error(`${readType}: ${error.message}`);
  }
  return (data as { data: T } | null)?.data ?? null;
}

export const getDashboard = (
  programmeId: string,
  filters?: VisitListQuery | VisitFilters
) =>
  operationsRead<ProgrammeDashboard>(
    'PROGRAMME_DASHBOARD',
    { programme_id: programmeId },
    filters
  );

export const getDailyReport = (programmeId: string, date?: string) =>
  operationsRead<DailyReport>('PROGRAMME_DAILY_REPORT', {
    programme_id: programmeId,
    ...(date ? { date } : {})
  });

// -- Imports ---------------------------------------------------------------------

const toImport = (row: Record<string, unknown>): ImportSummary => ({
  id: row.id as string,
  programmeId: row.programme_id as string,
  filename: row.filename as string,
  header: (row.header as string[]) ?? [],
  rowCount: (row.row_count as number) ?? 0,
  mapping: (row.mapping as Record<string, number>) ?? null,
  status: row.status as ImportSummary['status'],
  validRows: (row.valid_rows as number) ?? null,
  invalidRows: (row.invalid_rows as number) ?? null,
  createdCount: (row.created_count as number) ?? null,
  updatedCount: (row.updated_count as number) ?? null,
  appliedAt: (row.applied_at as string) ?? null,
  createdAt: row.created_at as string,
  version: row.version as number
});

const IMPORT_COLUMNS =
  'id, programme_id, filename, header, row_count, mapping, status, valid_rows, ' +
  'invalid_rows, created_count, updated_count, applied_at, created_at, version';

export async function listImports(
  programmeId: string
): Promise<ImportSummary[]> {
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('programme_imports')
    .select(IMPORT_COLUMNS)
    .eq('programme_id', programmeId)
    .neq('status', 'Discarded')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw new Error(`imports: ${error.message}`);
  return (data ?? []).map((r) =>
    toImport(r as unknown as Record<string, unknown>)
  );
}

export async function getImport(
  importId: string
): Promise<ImportSummary | null> {
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('programme_imports')
    .select(IMPORT_COLUMNS)
    .eq('id', importId)
    .maybeSingle();
  if (error) throw new Error(`import: ${error.message}`);
  return data ? toImport(data as unknown as Record<string, unknown>) : null;
}

/**
 * The staged rows, as the database judged them. The preview shows these, so what
 * a person approves is what will actually happen - the browser does not compute
 * a second opinion.
 */
export async function importRows(
  importId: string,
  options: { invalidOnly?: boolean; limit?: number } = {}
): Promise<ImportRow[]> {
  const supabase = await programmeDb();
  let query = supabase
    .from('programme_import_rows')
    .select('row_index, cells, mapped, problems, action')
    .eq('import_id', importId);
  if (options.invalidOnly) query = query.eq('action', 'Invalid');
  const { data, error } = await query
    .order('row_index')
    .limit(Math.min(Math.max(options.limit ?? 50, 1), 2000));
  if (error) throw new Error(`import rows: ${error.message}`);
  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      rowIndex: row.row_index as number,
      cells: (row.cells as string[]) ?? [],
      mapped: (row.mapped as Record<string, string | null>) ?? null,
      problems: (row.problems as { field: string; problem: string }[]) ?? [],
      action: (row.action as ImportRow['action']) ?? null
    };
  });
}

/** The published visit form, served by the programme rather than by Forms. */
export async function visitForm(programmeId: string): Promise<
  | {
      state: 'open';
      formId: string;
      revisionId: string;
      revision: number;
      title: string;
      description: string | null;
      definition: { fields: unknown[] };
      /** Which question carries which canonical value. Programme configuration. */
      fieldMap: Record<string, unknown>;
      signalConfig: SignalConfig;
    }
  | { state: 'unavailable' }
  | { state: 'error'; message: string }
> {
  const supabase = await programmeDb();
  const { data, error } = await supabase.rpc('programme_visit_form', {
    p_programme_id: programmeId
  });
  if (error) return { state: 'error', message: error.message };
  const row = data as Record<string, unknown> | null;
  if (!row || row.state !== 'open') return { state: 'unavailable' };
  return {
    state: 'open',
    formId: row.form_id as string,
    revisionId: row.revision_id as string,
    revision: row.revision as number,
    title: row.title as string,
    description: (row.description as string) ?? null,
    definition: row.definition as { fields: unknown[] },
    fieldMap: (row.field_map as Record<string, unknown>) ?? {},
    signalConfig: (row.signal_config as SignalConfig) ?? {}
  };
}

// -- Scheduled reports -----------------------------------------------------------

/**
 * A form's responses over a period: counts and the fact of each one.
 *
 * Never the answers. A form can ask anything, and a standing subscription is
 * not a decision about one form's contents - whoever reads the report opens the
 * response in the app, where the permissions still apply.
 */
export const getFormResponseReport = (
  formId: string,
  period?: { from?: string; to?: string }
) =>
  operationsRead<FormResponseReport>('FORM_RESPONSE_REPORT', {
    form_id: formId,
    ...(period?.from ? { from: period.from } : {}),
    ...(period?.to ? { to: period.to } : {})
  });

export const getWeeklyReport = (
  programmeId: string,
  period?: { from?: string; to?: string }
) =>
  operationsRead<DailyReport>('PROGRAMME_WEEKLY_REPORT', {
    programme_id: programmeId,
    ...(period?.from ? { from: period.from } : {}),
    ...(period?.to ? { to: period.to } : {})
  });

type SubscriptionRow = {
  id: string;
  source_kind: string;
  source_id: string;
  report_type: string;
  enabled: boolean;
  timezone: string;
  send_hour: number;
  week_starts_on: number;
  recipients: { name?: string | null; email: string }[];
  last_period_end: string | null;
  version: number;
};

type RunRow = {
  id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  status: string;
  detail: string | null;
  manual: boolean;
  created_at: string;
  communication_status: string | null;
  outbox_status: string | null;
  outbox_attempts: number | null;
  delivery_detail: string | null;
  sent_at: string | null;
  summary: Record<string, unknown>;
};

/** What is scheduled for one source, and what has run. */
export async function getReportSubscriptions(
  sourceKind: ReportSourceKind,
  sourceId: string
): Promise<ReportSubscriptions | null> {
  const result = await operationsRead<{
    subscriptions: SubscriptionRow[];
    runs: RunRow[];
  }>('REPORT_SUBSCRIPTIONS', {
    source_kind: sourceKind,
    source_id: sourceId
  });
  if (!result) return null;
  return {
    subscriptions: (result.subscriptions ?? []).map((row) => ({
      id: row.id,
      sourceKind: row.source_kind as ReportSourceKind,
      sourceId: row.source_id,
      reportType: row.report_type as 'Daily' | 'Weekly',
      enabled: row.enabled,
      timezone: row.timezone,
      sendHour: row.send_hour,
      weekStartsOn: row.week_starts_on,
      recipients: (row.recipients ?? []).map((r) => ({
        name: r.name ?? null,
        email: r.email
      })),
      lastPeriodEnd: row.last_period_end,
      version: row.version
    })),
    runs: (result.runs ?? []).map((row) => ({
      id: row.id,
      reportType: row.report_type as 'Daily' | 'Weekly',
      periodStart: row.period_start,
      periodEnd: row.period_end,
      status: row.status as ReportRun['status'],
      detail: row.detail,
      manual: row.manual,
      createdAt: row.created_at,
      communicationStatus: row.communication_status,
      outboxStatus: row.outbox_status ?? null,
      outboxAttempts: row.outbox_attempts ?? null,
      deliveryDetail: row.delivery_detail ?? null,
      sentAt: row.sent_at ?? null,
      summary: row.summary ?? {}
    }))
  };
}
