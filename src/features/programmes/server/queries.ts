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
  VisitFilters
} from '../types';

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
  property:programme_properties!programme_visits_property_id_fkey (
    external_ref, address_line1, town, postcode, expected_meter_serial
  ),
  installer:people!programme_visits_installer_id_fkey ( display_name ),
  reviewer:people!programme_visits_reviewed_by_fkey ( display_name )
`;

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
    external_ref: string;
    address_line1: string;
    town: string | null;
    postcode: string | null;
    expected_meter_serial: string | null;
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
      expectedMeterSerial: row.property?.expected_meter_serial ?? null
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
  synthetic: row.synthetic,
  notes: row.notes,
  version: row.version
});

const PROGRAMME_COLUMNS =
  'id, code, name, client_name, status, starts_on, ends_on, visit_form_id, ' +
  'signal_config, property_visibility, synthetic, notes, version';

/** Whether the module is switched on at all (FN-22). */
export async function programmesEnabled(): Promise<boolean> {
  const supabase = await programmeDb();
  const { data, error } = await supabase.rpc('programmes_enabled');
  if (error) return false;
  return data === true;
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
  const { data, error } = await supabase
    .from('programmes')
    .select(PROGRAMME_COLUMNS)
    .order('synthetic', { ascending: true })
    .order('name');
  if (error) throw new Error(`programmes: ${error.message}`);
  return (data as unknown as ProgrammeRow[]).map(toProgramme);
}

export async function getProgramme(
  programmeId: string
): Promise<ProgrammeSummary | null> {
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('programmes')
    .select(PROGRAMME_COLUMNS)
    .eq('id', programmeId)
    .maybeSingle();
  if (error) throw new Error(`programme: ${error.message}`);
  return data ? toProgramme(data as unknown as ProgrammeRow) : null;
}

const PROPERTY_COLUMNS =
  'id, programme_id, external_ref, address_line1, address_line2, town, postcode, ' +
  'expected_meter_serial, existing_sim_serial, notes, active, synthetic, version';

type PropertyRow = {
  id: string;
  programme_id: string;
  external_ref: string;
  address_line1: string;
  address_line2: string | null;
  town: string | null;
  postcode: string | null;
  expected_meter_serial: string | null;
  existing_sim_serial: string | null;
  notes: string | null;
  active: boolean;
  synthetic: boolean;
  version: number;
};

const toProperty = (r: PropertyRow): ProgrammeProperty => ({
  id: r.id,
  programmeId: r.programme_id,
  externalRef: r.external_ref,
  addressLine1: r.address_line1,
  addressLine2: r.address_line2,
  town: r.town,
  postcode: r.postcode,
  expectedMeterSerial: r.expected_meter_serial,
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
}

/**
 * Property search: one box, matched against the address, the postcode, the
 * client's reference and the expected meter serial - the four things a field
 * worker might have in front of them.
 */
export async function searchProperties(
  programmeId: string,
  search: PropertySearch = {}
): Promise<ProgrammeProperty[]> {
  const supabase = await programmeDb();
  const limit = Math.min(Math.max(search.limit ?? 25, 1), 200);
  let query = supabase
    .from('programme_properties')
    .select(PROPERTY_COLUMNS)
    .eq('programme_id', programmeId)
    .eq('active', true);

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

  const { data, error } = await query.order('external_ref').limit(limit);
  if (error) throw new Error(`properties: ${error.message}`);
  const mapped = (data as unknown as PropertyRow[]).map(toProperty);

  if (search.only !== 'outstanding') return mapped;
  const visited = await visitedPropertyIds(
    programmeId,
    mapped.map((p) => p.id)
  );
  return mapped.filter((p) => !visited.has(p.id));
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
  const { data, error } = await supabase
    .from('programme_properties')
    .select(PROPERTY_COLUMNS)
    .eq('id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`property: ${error.message}`);
  return data ? toProperty(data as unknown as PropertyRow) : null;
}

export interface VisitQuery extends VisitFilters {
  /** Drafts are on no board and in no list unless asked for. */
  includeDrafts?: boolean;
  limit?: number;
}

export async function listVisits(
  programmeId: string,
  filters: VisitQuery = {}
): Promise<ProgrammeVisit[]> {
  const supabase = await programmeDb();
  let query = supabase
    .from('programme_visits')
    .select(VISIT_COLUMNS)
    .eq('programme_id', programmeId);

  if (!filters.includeDrafts) query = query.neq('review_status', 'Draft');
  if (filters.from) query = query.gte('visit_date', filters.from);
  if (filters.to) query = query.lte('visit_date', filters.to);
  if (filters.installer_id)
    query = query.eq('installer_id', filters.installer_id);
  if (filters.outcome) query = query.eq('outcome', filters.outcome);
  if (filters.disposition) query = query.eq('disposition', filters.disposition);
  if (filters.review_status)
    query = query.eq('review_status', filters.review_status);
  if (filters.signal_classification)
    query = query.eq('signal_classification', filters.signal_classification);
  if (filters.portal_verification)
    query = query.eq('portal_verification', filters.portal_verification);

  const { data, error } = await query
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(Math.max(filters.limit ?? 500, 1), 5000));
  if (error) throw new Error(`visits: ${error.message}`);

  const visits = (data as unknown as VisitRow[]).map(toVisit);
  // Postcode is a property attribute, so it is filtered here rather than
  // pushed into a join the client cannot express.
  const area = (filters.postcode ?? '').replace(/\s/g, '').toUpperCase();
  return area
    ? visits.filter((v) =>
        (v.property.postcode ?? '')
          .replace(/\s/g, '')
          .toUpperCase()
          .startsWith(area)
      )
    : visits;
}

export async function getVisit(
  visitId: string
): Promise<ProgrammeVisit | null> {
  const supabase = await programmeDb();
  const { data, error } = await supabase
    .from('programme_visits')
    .select(VISIT_COLUMNS)
    .eq('id', visitId)
    .maybeSingle();
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

async function operationsRead<T>(
  readType: string,
  payload: Record<string, unknown>,
  filters?: VisitFilters
): Promise<T | null> {
  const supabase = await programmeDb();
  const { data, error } = await supabase.rpc('execute_operations_read', {
    p_request: {
      read_type: readType,
      payload,
      ...(filters && Object.keys(filters).length ? { filters } : {})
    }
  });
  if (error) {
    // A refusal (no programme.report, module off) is "nothing to show", not a crash.
    if (error.code === 'P0001') return null;
    throw new Error(`${readType}: ${error.message}`);
  }
  return (data as { data: T } | null)?.data ?? null;
}

export const getDashboard = (programmeId: string, filters?: VisitFilters) =>
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
