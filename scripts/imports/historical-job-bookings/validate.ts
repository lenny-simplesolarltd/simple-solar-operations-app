/**
 * Validation and the proposed database operations.
 *
 * Classification is driven by what the current schema actually enforces, not
 * by how complete a row looks. A row is only READY when every NOT NULL column
 * and every CHECK constraint on the tables it would touch can be satisfied
 * from the row itself, with no defaulting and no guessing.
 */

import type { Candidate } from './transform';
import { isUsablePerson } from './match';
import type { JobMatch } from './match';

export type Classification =
  | 'READY'
  | 'READY_WITH_WARNINGS'
  | 'OWNER_REVIEW_REQUIRED'
  | 'REJECTED';

export type Blocker = { code: string; message: string };

/**
 * A write the importer would perform. Descriptive only: nothing in this
 * codebase executes these, and the dry run asserts that.
 */
export type ProposedOperation = {
  table: string;
  action: 'insert' | 'link' | 'record';
  /** What makes the operation a no-op on a rerun. */
  idempotencyKey: string;
  summary: string;
};

export type Validated = {
  candidate: Candidate;
  jobMatch: JobMatch;
  classification: Classification;
  blockers: Blocker[];
  reviewReasons: string[];
  operations: ProposedOperation[];
};

/**
 * What genuinely cannot be represented, under the historical import model.
 *
 * The bar moved with migration 20260920150000. A historical job now carries
 * `record_class = 'HistoricalImport'`, under which `salesperson_id`,
 * `finance_route`, `original_gross_pence` and `current_contract_gross_pence`
 * may be null. An unknown is therefore recorded as unknown, not as a blocker
 * and not as an invented value. Those four are warnings below, never here.
 *
 * What remains blocking is what would make the record meaningless or unsafe:
 * a customer who cannot be identified at all, a sale with no date, or an
 * identity that would not survive a rerun.
 */
function hardBlockers(c: Candidate): Blocker[] {
  const out: Blocker[] = [];
  const add = (code: string, message: string) => out.push({ code, message });

  // customers: first_name, last_name, address_line1, town and postcode are
  // NOT NULL on a table the historical model did not relax, and nothing may be
  // invented to fill them. A job whose customer cannot be written cannot exist.
  //
  // These are only truly blocking when the row identifies nobody. A row that
  // names a household but is missing, say, a town is sent to review instead,
  // because a person can supply the town from the address they do have.
  const hasName = Boolean(c.customer.firstName || c.customer.lastName);
  const hasPlace = Boolean(c.customer.postcode || c.customer.addressLine1);
  const hasContact = Boolean(c.customer.email || c.customer.phone);

  if (!hasName && !hasPlace && !hasContact) {
    add(
      'CUSTOMER_UNIDENTIFIABLE',
      'the row carries no name, no address or postcode and no contact detail, so it identifies no customer and nothing may be invented to create one'
    );
  }
  if (!hasContact) {
    add(
      'CUSTOMER_CONTACT',
      'customers_contact_method requires an email or a phone number, and neither may be invented'
    );
  }

  // jobs.sold_at is NOT NULL for every record class: a job with no date cannot
  // be placed in history at all, and the date also fixes the work-date era.
  if (!c.job.soldAt) {
    add(
      'JOB_SOLD_AT',
      'jobs.sold_at is NOT NULL for every record class and no submission date could be read'
    );
  }

  // Without a stable key a rerun would either duplicate the row or lose it.
  if (!c.provenance.importKey) {
    add(
      'NO_IMPORT_IDENTITY',
      'the row has no stable import identity, so a rerun could not be made idempotent'
    );
  }

  return out;
}

/**
 * Customer fields that a person must supply before the row can be written,
 * because the `customers` table requires them and nothing may be invented.
 */
function customerGaps(c: Candidate): string[] {
  const gaps: string[] = [];
  if (!c.customer.firstName) gaps.push('first name');
  if (!c.customer.lastName) gaps.push('surname');
  if (!c.customer.addressLine1) gaps.push('street address');
  if (!c.customer.town) gaps.push('town');
  if (!c.customer.postcode) gaps.push('a valid postcode');
  return gaps;
}

/** Things a person must decide before the row can be trusted. */
function reviewReasons(c: Candidate, jobMatch: JobMatch): string[] {
  const out: string[] = [];

  if (jobMatch.kind === 'AMBIGUOUS') {
    out.push(
      `matches more than one existing job (${jobMatch.candidates.join(', ')})`
    );
  }
  if (jobMatch.kind === 'PROBABLE_EXISTING_JOB') {
    out.push(
      `probably already exists as ${jobMatch.jobRef}; confirm before linking or creating`
    );
  }

  // Staff ambiguity is deliberately NOT a review reason. The name is preserved
  // verbatim and linked to nobody, so the row is safe to import as it stands,
  // and "which Dave is this?" is one decision about an alias rather than 42
  // decisions about rows. The aliases are reported once each in the summary and
  // can be linked later without touching the job.

  const gaps = customerGaps(c);
  if (gaps.length > 0) {
    out.push(
      `the customer record needs ${gaps.join(', ')} before it can be written, and none may be invented`
    );
  }

  if (c.customer.generation === 'mixed') {
    out.push(
      'customer identity fields came from two different form generations'
    );
  }
  if (c.identity && c.identity.discriminated) {
    out.push(
      'this Submission ID is reused by a different customer; confirm the two records really are different jobs'
    );
  }
  // A value in a repurposed column is preserved and not imported, which is the
  // agreed handling; it is a warning on the row, not a decision to make before
  // importing it. The same holds for a form total that disagrees with its
  // parts, where the parts are authoritative.

  return out;
}

/**
 * The writes this row would produce. Historical rows never propose tasks,
 * calls, communications, outbox rows, invoice stages, payments or GHL work:
 * those are live obligations, and a finished job must not acquire them.
 */
function planOperations(c: Candidate, jobMatch: JobMatch): ProposedOperation[] {
  const key = c.provenance.intakeKey;
  const ops: ProposedOperation[] = [];

  ops.push({
    table: 'intake',
    action: 'insert',
    idempotencyKey: key,
    summary:
      'record the submission and its full raw payload; unique (form_id, submission_id) makes a rerun a no-op'
  });

  if (jobMatch.kind === 'ALREADY_IMPORTED') return ops;

  if (jobMatch.kind === 'EXACT_EXISTING_JOB') {
    ops.push({
      table: 'jobs',
      action: 'link',
      idempotencyKey: key,
      summary: `attach the intake row to existing job ${jobMatch.jobRef}; no job field is modified`
    });
    return ops;
  }

  if (jobMatch.kind !== 'NEW_HISTORICAL_JOB') return ops;

  ops.push(
    {
      table: 'customers',
      action: 'insert',
      idempotencyKey: key,
      summary: 'create the historical customer'
    },
    {
      table: 'jobs',
      action: 'insert',
      idempotencyKey: key,
      summary:
        "create the job with record_class = 'HistoricalImport', source_system set and archived_at set, " +
        'so it is non-actionable by class and builds no invoice stages'
    }
  );

  if (
    c.technical.systemKw !== null ||
    c.technical.roofNotes ||
    c.technical.mpan
  ) {
    ops.push({
      table: 'technical_details',
      action: 'insert',
      idempotencyKey: key,
      summary: 'record the historical system details'
    });
  }

  // Staff are recorded as historical facts, never as allocations. The original
  // text is kept whether or not it resolved; a person link is added only for an
  // unambiguous match, which the table's own CHECK also enforces.
  const staff = [
    ...(c.job.salesperson ? [c.job.salesperson] : []),
    ...c.people.installers,
    ...c.people.electricians
  ];
  if (staff.length > 0) {
    const linked = staff.filter(isUsablePerson).length;
    ops.push({
      table: 'historical_job_people',
      action: 'insert',
      idempotencyKey: `${key}:people`,
      summary: `${staff.length} historical staff name(s) preserved verbatim, ${linked} linked to a current person, 0 allocations`
    });
  }

  if (c.materials.length > 0) {
    ops.push({
      table: 'intake',
      action: 'record',
      idempotencyKey: `${key}:materials`,
      summary: `${c.materials.length} historical materials line(s) preserved in the intake payload; no live materials or order rows`
    });
  }
  if (c.scaffold.companyName || c.scaffold.erectDate) {
    ops.push({
      table: 'intake',
      action: 'record',
      idempotencyKey: `${key}:scaffold`,
      summary:
        'historical scaffold facts preserved in the intake payload; no scaffold_bookings row, so no live scaffold queue item'
    });
  }
  if (c.equipment.length > 0) {
    ops.push({
      table: 'intake',
      action: 'record',
      idempotencyKey: `${key}:equipment`,
      summary: `${c.equipment.length} historical equipment descriptor(s) preserved; no job_equipment row, which would need a live work package`
    });
  }

  return ops;
}

/** Tables a historical import must never write to. Asserted by the tests. */
export const FORBIDDEN_TABLES = [
  'tasks',
  'task_events',
  'calls',
  'communications',
  'communication_jobs',
  'outbox',
  'ghl_tasks',
  'invoice_stages',
  'payments',
  'accounting_events',
  'finance_plans',
  'orders',
  'order_lines',
  'deliveries',
  'stock_movements',
  'reservations',
  'acknowledgements',
  'calendar_links',
  'presales',
  'handover'
];

export function validate(c: Candidate, jobMatch: JobMatch): Validated {
  const blockers = hardBlockers(c);
  const reasons = reviewReasons(c, jobMatch);
  const operations = planOperations(c, jobMatch);

  let classification: Classification;
  if (blockers.length > 0) classification = 'REJECTED';
  else if (reasons.length > 0) classification = 'OWNER_REVIEW_REQUIRED';
  else if (c.warnings.length > 0) classification = 'READY_WITH_WARNINGS';
  else classification = 'READY';

  return {
    candidate: c,
    jobMatch,
    classification,
    blockers,
    reviewReasons: reasons,
    operations
  };
}
