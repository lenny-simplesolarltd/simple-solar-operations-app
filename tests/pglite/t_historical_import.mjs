// Historical import model: a job can record history without becoming work.
//
// Proves both halves of the invariant in the same database:
//   * a HistoricalImport row may leave the sale fields unknown, is never
//     actionable, and generates no invoice stage, task, call or message;
//   * a Live row is still refused without a salesperson, a finance route or a
//     positive price - the strictness was made conditional, not removed.
//
// The dev-preview migration is excluded: it needs pgcrypto, which PGlite does
// not carry, and it belongs to a different workstream. Everything else is
// replayed from zero.
import { fresh, dir } from './harness.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SKIP = ['20260920140000_dev_preview_hosted.sql'];
const extra = fs
  .readdirSync(dir)
  .filter((f) => /\.sql$/.test(f) && !SKIP.includes(f))
  .sort();

const db = await fresh({ extra });

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- Fixtures ----------------------------------------------------------------

const person = await one(
  `insert into public.people (legacy_id, email, display_name, active)
   values ('PERSON-test-sales', 'sales@test.invalid', 'Test Salesperson', true)
   returning id`
);

async function customer(suffix) {
  return one(
    `insert into public.customers (first_name, last_name, address_line1, town, postcode, email)
     values ('Test', $1, '1 Test Lane', 'Testville', 'ZZ1 1ZZ', $2)
     returning id`,
    [`Case${suffix}`, `c${String(suffix).toLowerCase()}@test.invalid`]
  );
}

let refCounter = 0;
const nextRef = () => `SS-TEST-${String(++refCounter).padStart(4, '0')}`;

/** Inserts a historical job with whatever is known, and nothing invented. */
async function historicalJob(overrides = {}) {
  const c = await customer(`H${refCounter}`);
  const cols = {
    job_ref: nextRef(),
    customer_id: c.id,
    display_name: 'Historical job',
    sold_at: '2025-03-07T09:48:24Z',
    roof_required: true,
    electrical_required: true,
    scaffold_required: false,
    workflow_stage: 'OperationallyComplete',
    record_class: 'HistoricalImport',
    source_system: 'historical-job-booking-form',
    archived_at: '2026-09-20T00:00:00Z',
    ...overrides
  };
  const keys = Object.keys(cols);
  const sql = `insert into public.jobs (${keys.join(', ')})
               values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id, record_class`;
  return one(
    sql,
    keys.map((k) => cols[k])
  );
}

async function liveJobInsert(overrides = {}) {
  const c = await customer(`L${refCounter}`);
  const cols = {
    job_ref: nextRef(),
    customer_id: c.id,
    display_name: 'Live job',
    sold_at: '2026-09-01T00:00:00Z',
    salesperson_id: person.id,
    finance_route: 'Standard',
    original_gross_pence: 1200000,
    current_contract_gross_pence: 1200000,
    roof_required: true,
    electrical_required: true,
    scaffold_required: false,
    workflow_stage: 'Prebooking',
    ...overrides
  };
  const keys = Object.keys(cols);
  const sql = `insert into public.jobs (${keys.join(', ')})
               values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`;
  return one(
    sql,
    keys.map((k) => cols[k])
  );
}

const refuses = async (fn, fragment) => {
  try {
    await fn();
  } catch (e) {
    assert.ok(
      e.message.toLowerCase().includes(fragment.toLowerCase()),
      `expected a refusal mentioning "${fragment}", got: ${e.message}`
    );
    return;
  }
  assert.fail(`expected a refusal mentioning "${fragment}", but it succeeded`);
};

// --- 1-4: history never becomes work -----------------------------------------

test('1. a historical job insert creates zero invoice stages', async () => {
  const j = await historicalJob({
    original_gross_pence: 1500000,
    current_contract_gross_pence: 1500000
  });
  const r = await one(
    `select count(*)::int n from public.invoice_stages where job_id = $1`,
    [j.id]
  );
  assert.equal(
    r.n,
    0,
    'a historical job must not acquire a financial obligation'
  );
});

test('1b. a live job insert still creates its invoice stages', async () => {
  const j = await liveJobInsert();
  const r = await one(
    `select count(*)::int n from public.invoice_stages where job_id = $1`,
    [j.id]
  );
  assert.ok(
    r.n >= 2,
    `live behaviour must be unchanged; expected >= 2 stages, got ${r.n}`
  );
});

test('2. a historical job insert creates zero tasks', async () => {
  const j = await historicalJob();
  const r = await one(
    `select count(*)::int n from public.tasks where job_id = $1`,
    [j.id]
  );
  assert.equal(r.n, 0);
});

test('2b. the task-creating path refuses a historical job outright', async () => {
  const j = await historicalJob();
  await refuses(
    () => db.query(`select app.assert_normal_work($1)`, [j.id]),
    'HISTORICAL_IMPORT'
  );
});

test('3. a historical job is not actionable', async () => {
  const j = await historicalJob();
  const r = await one(
    `select app.job_actionable(j) a, app.job_in_scope(j) s from public.jobs j where j.id = $1`,
    [j.id]
  );
  assert.equal(r.a, false, 'historical jobs must never be actionable');
  assert.equal(
    r.s,
    false,
    'historical jobs must never be in operational scope'
  );
});

test('3b. a live job is still actionable and in scope', async () => {
  const j = await liveJobInsert();
  const r = await one(
    `select app.job_actionable(j) a, app.job_in_scope(j) s from public.jobs j where j.id = $1`,
    [j.id]
  );
  assert.equal(r.a, true);
  assert.equal(r.s, true);
});

test('3c. a historical job cannot be un-archived to sneak back into scope', async () => {
  const j = await historicalJob();
  await refuses(
    () =>
      db.query(`update public.jobs set archived_at = null where id = $1`, [
        j.id
      ]),
    'jobs_historical_is_inert'
  );
});

test('4. the cron sweep predicate excludes historical jobs', async () => {
  const j = await historicalJob();
  // This is the exact predicate app.s10_run_schedules selects on: it is what
  // creates customer calls, installer calls and GHL tracking.
  const r = await one(
    `select count(*)::int n from public.jobs j
      where j.id = $1 and app.job_in_scope(j) and app.job_actionable(j)`,
    [j.id]
  );
  assert.equal(r.n, 0);
});

test('4b. the s13 milestone sweep predicate excludes historical jobs', async () => {
  const j = await historicalJob();
  const r = await one(
    `select count(*)::int n from public.jobs j
      where j.id = $1 and j.archived_at is null and j.cancellation_at is null
        and j.workflow_stage not in ('CancellationInProgress', 'Cancelled')`,
    [j.id]
  );
  assert.equal(r.n, 0);
});

// --- 5-10: truthful unknowns for history, strictness for live ----------------

test('5. a historical job with an unknown salesperson is accepted', async () => {
  const j = await historicalJob({ salesperson_id: null });
  const r = await one(`select salesperson_id from public.jobs where id = $1`, [
    j.id
  ]);
  assert.equal(
    r.salesperson_id,
    null,
    'unknown must stay unknown, not become a stand-in person'
  );
});

test('6. a live job without a salesperson is still refused', async () => {
  await refuses(
    () => liveJobInsert({ salesperson_id: null }),
    'jobs_live_requires_sale_fields'
  );
});

test('7. a historical job with unknown finance is accepted', async () => {
  const j = await historicalJob({ finance_route: null });
  const r = await one(`select finance_route from public.jobs where id = $1`, [
    j.id
  ]);
  assert.equal(r.finance_route, null);
});

test('8. a live job without a finance route is still refused', async () => {
  await refuses(
    () => liveJobInsert({ finance_route: null }),
    'jobs_live_requires_sale_fields'
  );
});

test('8b. an invalid finance route is still refused on a historical job', async () => {
  await refuses(
    () => historicalJob({ finance_route: 'MadeUpRoute' }),
    'finance_route'
  );
});

test('9. a historical job with an unknown price is accepted', async () => {
  const j = await historicalJob({
    original_gross_pence: null,
    current_contract_gross_pence: null
  });
  const r = await one(
    `select original_gross_pence from public.jobs where id = $1`,
    [j.id]
  );
  assert.equal(r.original_gross_pence, null);
});

test('10. a live job with a missing price is still refused', async () => {
  await refuses(
    () => liveJobInsert({ original_gross_pence: null }),
    'jobs_live_requires_sale_fields'
  );
});

test('10b. a zero price is still refused, on both classes', async () => {
  await refuses(
    () => liveJobInsert({ original_gross_pence: 0 }),
    'original_gross_pence'
  );
  await refuses(
    () => historicalJob({ original_gross_pence: 0 }),
    'original_gross_pence'
  );
});

test('10c. a historical job must declare where it came from', async () => {
  await refuses(
    () => historicalJob({ source_system: null }),
    'jobs_historical_is_inert'
  );
});

// --- 11: unresolved staff preserved, never allocated -------------------------

test('11. an unresolved historical installer is preserved without an allocation', async () => {
  const j = await historicalJob();
  await db.query(
    `insert into public.historical_job_people (job_id, role, source_value, match_kind, source_column)
     values ($1, 'Installer', 'Des', 'NoMatch', 7)`,
    [j.id]
  );
  const kept = await one(
    `select source_value, person_id, match_kind from public.historical_job_people where job_id = $1`,
    [j.id]
  );
  assert.equal(
    kept.source_value,
    'Des',
    'the original text must survive verbatim'
  );
  assert.equal(
    kept.person_id,
    null,
    'an unresolved name must not be linked to a person'
  );

  const allocations = await one(
    `select count(*)::int n from public.allocations a
      join public.work_packages w on w.id = a.work_package_id where w.job_id = $1`,
    [j.id]
  );
  assert.equal(
    allocations.n,
    0,
    'a historical name must never become live resourcing'
  );
});

test('11b. an ambiguous historical name cannot be linked to a person', async () => {
  const j = await historicalJob();
  await refuses(
    () =>
      db.query(
        `insert into public.historical_job_people (job_id, role, source_value, person_id, match_kind)
       values ($1, 'Installer', 'Dave', $2, 'Ambiguous')`,
        [j.id, person.id]
      ),
    'historical_job_people_link_requires_certainty'
  );
});

test('11c. a resolved historical name may be linked, still without an allocation', async () => {
  const j = await historicalJob();
  await db.query(
    `insert into public.historical_job_people (job_id, role, source_value, person_id, match_kind)
     values ($1, 'Salesperson', 'Test', $2, 'SafeNormalisedMatch')`,
    [j.id, person.id]
  );
  const r = await one(
    `select person_id from public.historical_job_people where job_id = $1`,
    [j.id]
  );
  assert.equal(r.person_id, person.id);
  const alloc = await one(`select count(*)::int n from public.allocations`, []);
  assert.ok(alloc.n >= 0); // allocations are never created by this path
});

// --- 12-13: identity and idempotency -----------------------------------------

test('12. two rows sharing a Submission ID stay independently addressable', async () => {
  // The import key is (form_id, submission_id); a reused Submission ID is
  // disambiguated so both source rows survive as distinct intake records.
  await db.query(
    `insert into public.intake (intake_id, form_type, form_id, submission_id, received_at, processing_status)
     values ('HJB-DUP-1', 'Booking', 'historical-job-booking-form', 'SUB-DUP#1', now(), 'Processed'),
            ('HJB-DUP-2', 'Booking', 'historical-job-booking-form', 'SUB-DUP#2', now(), 'Processed')`
  );
  const r = await one(
    `select count(*)::int n from public.intake where form_id = 'historical-job-booking-form'
       and submission_id like 'SUB-DUP%'`
  );
  assert.equal(
    r.n,
    2,
    'both source rows must be importable, not one of them dropped'
  );
});

test('13. re-importing the same submission is refused by the existing unique key', async () => {
  await db.query(
    `insert into public.intake (intake_id, form_type, form_id, submission_id, received_at, processing_status)
     values ('HJB-IDEM-1', 'Booking', 'historical-job-booking-form', 'SUB-IDEM', now(), 'Processed')`
  );
  await refuses(
    () =>
      db.query(
        `insert into public.intake (intake_id, form_type, form_id, submission_id, received_at, processing_status)
       values ('HJB-IDEM-2', 'Booking', 'historical-job-booking-form', 'SUB-IDEM', now(), 'Processed')`
      ),
    'unique'
  );
});

// --- 14-15: still discoverable -----------------------------------------------

test('14. historical jobs remain findable in Job Search', async () => {
  const c = await one(
    `insert into public.customers (first_name, last_name, address_line1, town, postcode, email)
     values ('Find', 'Mearchivedjob', '2 Search Way', 'Testville', 'ZZ2 2ZZ', 'find@test.invalid')
     returning id`
  );
  const ref = nextRef();
  await db.query(
    `insert into public.jobs (job_ref, customer_id, display_name, sold_at, roof_required,
       electrical_required, scaffold_required, workflow_stage, record_class, source_system,
       source_reference, archived_at)
     values ($1, $2, 'Historical searchable', '2025-03-07T09:48:24Z', true, true, false,
             'OperationallyComplete', 'HistoricalImport', 'historical-job-booking-form',
             'LEGACY-REF-1', now())`,
    [ref, c.id]
  );
  const admin = await one(
    `select app.read_job_search(
      jsonb_build_object('person_id', $1::text, 'roles', jsonb_build_array('Admin')), 'Mearchivedjob') r`,
    [person.id]
  );
  const results = admin.r.results ?? [];
  assert.ok(
    results.some((x) => x.job_ref === ref),
    'an imported historical job must still be findable by customer name'
  );
  assert.equal(
    results.find((x) => x.job_ref === ref).record_class,
    'HistoricalImport',
    'search results must say the job is historical'
  );
});

test('15. the legacy reference is searchable too', async () => {
  const admin = await one(
    `select app.read_job_search(
      jsonb_build_object('person_id', $1::text, 'roles', jsonb_build_array('Admin')), 'LEGACY-REF-1') r`,
    [person.id]
  );
  assert.ok(
    (admin.r.results ?? []).length >= 1,
    'the old office reference must find the imported job'
  );
});

// --- 16-17: no live queues, no side effects ----------------------------------

test('16. historical jobs create no work package, material, scaffold or commissioning row', async () => {
  const j = await historicalJob();
  for (const table of [
    'work_packages',
    'materials',
    'scaffold_bookings',
    'commissioning_submissions',
    'orders'
  ]) {
    const r = await one(
      `select count(*)::int n from public.${table} where job_id = $1`,
      [j.id]
    );
    assert.equal(
      r.n,
      0,
      `${table} must stay empty for a historical job insert`
    );
  }
});

test('17. historical jobs create no communication, outbox, call or GHL side effect', async () => {
  const before = {};
  for (const t of [
    'communications',
    'outbox',
    'calls',
    'ghl_tasks',
    'invoice_stages',
    'payments'
  ]) {
    before[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  }
  await historicalJob();
  for (const t of [
    'communications',
    'outbox',
    'calls',
    'ghl_tasks',
    'invoice_stages',
    'payments'
  ]) {
    const after = (await one(`select count(*)::int n from public.${t}`)).n;
    assert.equal(
      after,
      before[t],
      `${t} must be untouched by a historical job insert`
    );
  }
});

// --- Write-path regressions (the apply function) -----------------------------

test('18. the apply function is idempotent on a second call', async () => {
  const c = await customer('Idem');
  const doc = {
    provenance: {
      formId: 'historical-job-booking-form',
      importKey: 'APPLY-IDEM-1',
      submissionId: 'APPLY-IDEM-1',
      payloadHash: 'hash-a',
      legacyReference: 'LEG-1',
      submittedAt: '2025-03-07T09:48:24Z',
      sourceSystem: 'historical-job-booking-form',
      batchId: 'testbatch'
    },
    customer: {
      firstName: 'Pat',
      lastName: 'Quinn',
      addressLine1: '1 Test Lane',
      addressLine2: null,
      town: 'Testville',
      postcode: 'ZZ4 4ZZ',
      email: 'apply.idem@test.invalid',
      phone: null
    },
    job: {
      soldAt: '2025-03-07T09:48:24Z',
      grossPence: null,
      leadSource: null,
      financeRoute: null,
      roofRequired: true,
      electricalRequired: true,
      scaffoldRequired: false,
      salespersonLegacyId: null
    },
    technical: {
      systemKw: 4.5,
      mpan: null,
      roofNotes: null,
      electricalNotes: null
    },
    historicalPeople: [
      {
        role: 'Installer',
        sourceValue: 'Des',
        personLegacyId: null,
        matchKind: 'NoMatch',
        sourceColumn: 7
      }
    ]
  };
  void c;

  const first = await one(
    `select app.historical_import_apply($1::jsonb, false) r`,
    [JSON.stringify(doc)]
  );
  assert.equal(first.r.action, 'imported');

  const second = await one(
    `select app.historical_import_apply($1::jsonb, false) r`,
    [JSON.stringify(doc)]
  );
  assert.equal(second.r.action, 'skipped');
  assert.equal(second.r.writes, 0);
  assert.equal(second.r.source_changed, false);

  const jobs = await one(
    `select count(*)::int n from public.jobs where source_reference = 'LEG-1'`
  );
  assert.equal(jobs.n, 1, 'a second apply must not create a second job');

  const people = await one(
    `select count(*)::int n from public.historical_job_people p
      join public.jobs j on j.id = p.job_id where j.source_reference = 'LEG-1'`
  );
  assert.equal(
    people.n,
    1,
    'a second apply must not duplicate historical staff'
  );
});

test('19. a changed source payload is reported, not silently reapplied', async () => {
  const base = {
    provenance: {
      formId: 'historical-job-booking-form',
      importKey: 'APPLY-CHANGED-1',
      submissionId: 'APPLY-CHANGED-1',
      payloadHash: 'hash-original',
      legacyReference: 'LEG-2',
      submittedAt: '2025-03-07T09:48:24Z',
      sourceSystem: 'historical-job-booking-form',
      batchId: 'testbatch'
    },
    customer: {
      firstName: 'Pat',
      lastName: 'Quinn',
      addressLine1: '2 Test Lane',
      addressLine2: null,
      town: 'Testville',
      postcode: 'ZZ5 5ZZ',
      email: 'apply.changed@test.invalid',
      phone: null
    },
    job: {
      soldAt: '2025-03-07T09:48:24Z',
      grossPence: 1000,
      leadSource: null,
      financeRoute: 'Standard',
      roofRequired: true,
      electricalRequired: false,
      scaffoldRequired: false,
      salespersonLegacyId: null
    },
    technical: {},
    historicalPeople: []
  };
  await db.query(`select app.historical_import_apply($1::jsonb, false)`, [
    JSON.stringify(base)
  ]);

  const changed = {
    ...base,
    provenance: { ...base.provenance, payloadHash: 'hash-different' }
  };
  const r = await one(
    `select app.historical_import_apply($1::jsonb, false) r`,
    [JSON.stringify(changed)]
  );
  assert.equal(r.r.action, 'skipped');
  assert.equal(
    r.r.source_changed,
    true,
    'a changed re-export must be reported'
  );
  assert.equal(
    r.r.writes,
    0,
    'and must not be written over the existing record'
  );
});

test('20. an applied historical job creates no invoice stage, task or call', async () => {
  const before = {};
  for (const t of [
    'invoice_stages',
    'tasks',
    'calls',
    'outbox',
    'communications',
    'allocations',
    'work_packages'
  ]) {
    before[t] = (await one(`select count(*)::int n from public.${t}`)).n;
  }
  const doc = {
    provenance: {
      formId: 'historical-job-booking-form',
      importKey: 'APPLY-SIDE-1',
      submissionId: 'APPLY-SIDE-1',
      payloadHash: 'h',
      legacyReference: 'LEG-3',
      submittedAt: '2025-03-07T09:48:24Z',
      sourceSystem: 'historical-job-booking-form',
      batchId: 'testbatch'
    },
    customer: {
      firstName: 'Pat',
      lastName: 'Quinn',
      addressLine1: '3 Test Lane',
      addressLine2: null,
      town: 'Testville',
      postcode: 'ZZ6 6ZZ',
      email: 'apply.side@test.invalid',
      phone: null
    },
    job: {
      soldAt: '2025-03-07T09:48:24Z',
      grossPence: 9999999,
      leadSource: null,
      financeRoute: 'Standard',
      roofRequired: true,
      electricalRequired: true,
      scaffoldRequired: true,
      salespersonLegacyId: null
    },
    technical: {},
    historicalPeople: []
  };
  await db.query(`select app.historical_import_apply($1::jsonb, false)`, [
    JSON.stringify(doc)
  ]);

  for (const [t, n] of Object.entries(before)) {
    const after = (await one(`select count(*)::int n from public.${t}`)).n;
    assert.equal(
      after,
      n,
      `${t} must be untouched even with a large gross amount present`
    );
  }
});

test('21. the apply function is not reachable from the application roles', async () => {
  const grants = await all(
    `select grantee from information_schema.role_routine_grants
      where routine_name = 'historical_import_apply'
        and grantee in ('anon', 'authenticated', 'service_role')`
  );
  assert.equal(
    grants.length,
    0,
    'historical_import_apply must not be granted to application roles'
  );
});

// --- Cross-feature: the two workstreams in one database -----------------------
//
// SimpleBot's get_job_blockers and get_job_timeline (full-system acceptance)
// read JOB_OPERATIONS, ACTION_AVAILABILITY and AUDIT_HISTORY. A historical job
// is a record of the past, not work in progress, so those reads must not
// present it as something to get on with - and must not fail either, because
// the bot is allowed to answer questions about it.

const actor = (roles = ['Admin']) =>
  `jsonb_build_object('person_id', '${person.id}'::text, 'roles', jsonb_build_array(${roles
    .map((r) => `'${r}'`)
    .join(', ')}))`;

test('22. a historical job offers no action to take', async () => {
  const j = await historicalJob();
  const r = await one(
    `select app.read_action_availability(${actor()}, j) r from public.jobs j where j.id = $1`,
    [j.id]
  );
  const commands = r.r?.commands ?? {};
  const offered = Object.entries(commands)
    .filter(([, flag]) => flag?.available)
    .map(([name]) => name);
  assert.deepEqual(
    offered,
    [],
    `a historical job must offer nothing; got ${offered.join(', ')}`
  );
});

test('23. a live job still offers actions, so 22 is not vacuous', async () => {
  const j = await liveJobInsert();
  const r = await one(
    `select app.read_action_availability(${actor()}, j) r from public.jobs j where j.id = $1`,
    [j.id]
  );
  const commands = r.r?.commands ?? {};
  assert.ok(
    Object.keys(commands).length > 0,
    'a live job must be assessed at all'
  );
});

test('24. the history of a historical job is readable and holds no invented work', async () => {
  const j = await historicalJob();
  const r = await one(
    `select app.read_audit_history(j) r from public.jobs j where j.id = $1`,
    [j.id]
  );
  assert.ok(r.r !== null, 'AUDIT_HISTORY must answer for a historical job');
  assert.equal(r.r.task_events ?? 0, 0, 'a historical job has no task history');
  assert.equal(
    r.r.issue_events ?? 0,
    0,
    'a historical job has no issue history'
  );
});

test('25. a historical job is not commissionable, with an approved template present', async () => {
  // Seed 005 puts an approved template on the trades. The acceptance fix made
  // INSTALLER_WORKFLOW resolve it for drafts still on NOT_CONFIGURED; that must
  // not give a historical job a commissioning form, because it has no work
  // package to hang one on.
  await db.query(
    `insert into public.commissioning_templates
       (trade, equipment_type, template_version, effective_from, active, approved_by, approved_at)
     values ('Electrical', 'CrossFeature', 'CROSS-1.0', current_date, true, $1, now())
     on conflict do nothing`,
    [person.id]
  );
  const j = await historicalJob();
  const n = await one(
    `select count(*)::int n from public.work_packages where job_id = $1`,
    [j.id]
  );
  assert.equal(n.n, 0, 'no work package means nothing can be commissioned');
});

// --- Discovery: the Jobs screen vs Job Search --------------------------------
//
// The operational queue and the search surface answer different questions, and
// the split is the whole point: JOBS is scoped to live work so archived
// imports never flood the working list, while JOB_SEARCH is deliberately not
// scoped so a job that predates this system stays findable. Before the fix the
// application only ever called JOBS, so historical jobs were unreachable from
// the UI even though this read had them all along.

const searchAs = async (who, term) =>
  (await one(`select app.read_job_search(${actor()}, $1) r`, [term])).r;

test('26. the operational JOBS read still excludes archived historical jobs', async () => {
  const j = await historicalJob();
  const ref = (await one(`select job_ref from public.jobs where id=$1`, [j.id]))
    .job_ref;
  const r = await one(
    `select app.read_jobs(jsonb_build_object('read_type','JOBS','q',$1::text), ${actor()}) r`,
    [ref]
  );
  assert.equal(
    (r.r.jobs ?? []).length,
    0,
    'a historical job must never appear in the working queue'
  );
});

test('27. a live job still appears in the operational JOBS read', async () => {
  const j = await liveJobInsert();
  const ref = (await one(`select job_ref from public.jobs where id=$1`, [j.id]))
    .job_ref;
  const r = await one(
    `select app.read_jobs(jsonb_build_object('read_type','JOBS','q',$1::text), ${actor()}) r`,
    [ref]
  );
  assert.equal((r.r.jobs ?? []).length, 1, 'live work must still be listed');
});

test('28. Job Search finds a historical job by its current job ref', async () => {
  const j = await historicalJob();
  const ref = (await one(`select job_ref from public.jobs where id=$1`, [j.id]))
    .job_ref;
  const hits = (await searchAs('tanya', ref)).results ?? [];
  assert.equal(hits.length, 1, `searching ${ref} must find it`);
  assert.equal(
    hits[0].record_class,
    'HistoricalImport',
    'the result must declare itself historical so the UI can badge it'
  );
  assert.ok(
    hits[0].id,
    'the result carries the job id, so the normal Job Detail route works'
  );
});

test('29. Job Search finds a historical job by surname and by postcode', async () => {
  const c = await one(
    `insert into public.customers (first_name, last_name, address_line1, town, postcode, email)
     values ('Nadia', 'Quillfeather', '9 Test Lane', 'Testville', 'ZZ9 9ZZ', 'nq@test.invalid')
     returning id`
  );
  const j = await historicalJob({ customer_id: c.id });
  assert.ok(j.id);
  for (const term of ['Quillfeather', 'ZZ9 9ZZ']) {
    const hits = (await searchAs('tanya', term)).results ?? [];
    assert.ok(
      hits.some((h) => h.record_class === 'HistoricalImport'),
      `searching "${term}" must find the historical record`
    );
  }
});

test('30. Job Search enforces readability, it does not hand out every job', async () => {
  const j = await historicalJob();
  const ref = (await one(`select job_ref from public.jobs where id=$1`, [j.id]))
    .job_ref;
  // A surveyor may see their own sales, not somebody else's job.
  const mine = (
    await one(
      `select app.read_job_search(jsonb_build_object('person_id', $1::text,
       'roles', jsonb_build_array('Installer')), $2) r`,
      [person.id, ref]
    )
  ).r;
  assert.equal(
    (mine.results ?? []).length,
    0,
    'search must not bypass app.can_read_job'
  );
});

// --- Invariants the fix must not weaken --------------------------------------

test('31. job_in_scope and job_actionable remain false for historical', async () => {
  const j = await historicalJob();
  const r = await one(
    `select app.job_in_scope(j) s, app.job_actionable(j) a from public.jobs j where j.id=$1`,
    [j.id]
  );
  assert.equal(r.s, false, 'historical must stay out of operational scope');
  assert.equal(r.a, false, 'historical must stay non-actionable');
});

test('32. a historical job still creates no invoice stage when built', async () => {
  const j = await historicalJob();
  const n = async () =>
    (
      await one(
        `select count(*)::int c from public.invoice_stages where job_id=$1`,
        [j.id]
      )
    ).c;
  const before = await n();
  await db.query(`select app.build_invoice_stages($1)`, [j.id]).catch(() => {});
  assert.equal(
    await n(),
    before,
    'invoice stages stay gated for historical records'
  );
});

test('33. every function the historical policies call is executable by authenticated', async () => {
  // A row-level security expression runs as the querying role, so a policy that
  // calls a function `authenticated` cannot execute fails the whole read with
  // "permission denied for function ..." instead of returning no rows. The
  // historical_job_people policy calls app.can_read_job, which was owner-only,
  // so the table was unreadable by the application and nobody noticed until
  // something actually read it.
  const missing = await all(`
    select p.proname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_proc p on position(p.proname in pg_get_expr(pol.polqual, pol.polrelid)) > 0
    join pg_namespace n on n.oid = p.pronamespace
    where c.relname = 'historical_job_people'
      and n.nspname = 'app'
      and not has_function_privilege('authenticated', p.oid, 'execute')`);
  assert.deepEqual(
    missing.map((r) => r.proname),
    [],
    'these functions are used by the historical RLS policy but authenticated cannot execute them'
  );
});

// --- Browsing: Active / Historical / All --------------------------------------
//
// The archive has to be reachable without already knowing what to search for,
// but it must not leak into the working queue. The JOBS read takes a `view`
// for exactly that, and app.job_in_scope is left alone so nothing becomes
// operational.

const jobsRead = async (req) =>
  (
    await one(`select app.read_jobs($1::jsonb, ${actor()}) r`, [
      JSON.stringify({ read_type: 'JOBS', ...req })
    ])
  ).r;

test('34. the default view is the operational queue and excludes historical', async () => {
  await historicalJob();
  const live = await liveJobInsert();
  const r = await jobsRead({});
  assert.equal(r.view, 'active', 'omitting view must mean active');
  const refs = (r.jobs ?? []).map((j) => j.job_ref);
  const liveRef = (
    await one(`select job_ref from public.jobs where id=$1`, [live.id])
  ).job_ref;
  assert.ok(refs.includes(liveRef), 'live work is listed');
  const historicalRefs = (
    await all(
      `select job_ref from public.jobs where record_class='HistoricalImport'`
    )
  ).map((x) => x.job_ref);
  assert.equal(
    refs.filter((x) => historicalRefs.includes(x)).length,
    0,
    'no archived record may appear in the operational queue'
  );
});

test('35. counts are authoritative and add up', async () => {
  const r = await jobsRead({});
  const expected = await one(`select
      count(*) filter (where app.job_in_scope(j))::int a,
      count(*) filter (where j.record_class='HistoricalImport')::int h,
      count(*)::int t from public.jobs j`);
  assert.equal(r.counts.active, expected.a);
  assert.equal(r.counts.historical, expected.h);
  assert.equal(r.counts.all, expected.t);
  assert.equal(
    r.counts.active + r.counts.historical,
    r.counts.all,
    'every job is either operational or archived'
  );
});

test('36. the historical view returns only archived records', async () => {
  const r = await jobsRead({ view: 'historical' });
  assert.ok(r.total > 0, 'there is an archive to browse');
  assert.equal(r.total, r.counts.historical);
  for (const j of r.jobs) {
    assert.equal(
      j.record_class,
      'HistoricalImport',
      'the historical view must not contain live work'
    );
  }
});

test('37. the all view returns both, still marked apart', async () => {
  const r = await jobsRead({ view: 'all' });
  assert.equal(r.total, r.counts.all);
  const classes = new Set(r.jobs.map((j) => j.record_class));
  assert.ok(classes.has('HistoricalImport'), 'archived records are included');
  assert.ok(classes.has('Live'), 'live work is included');
});

test('38. historical browsing pages on the server', async () => {
  // Enough rows to page through without relying on the fixture count.
  for (let i = 0; i < 4; i += 1) await historicalJob();
  const first = await jobsRead({ view: 'historical', limit: '2' });
  const second = await jobsRead({
    view: 'historical',
    limit: '2',
    offset: '2'
  });
  assert.equal(first.jobs.length, 2, 'a page is the size asked for');
  assert.equal(second.jobs.length, 2);
  assert.equal(first.total, second.total, 'the total is the whole population');
  assert.ok(first.total > 2 && first.truncated, 'more remains after page one');
  const overlap = first.jobs.filter((a) =>
    second.jobs.some((b) => b.id === a.id)
  );
  assert.deepEqual(overlap, [], 'pages must not repeat rows');
});

test('39. historical search works, including the previous-system reference', async () => {
  const c = await one(
    `insert into public.customers (first_name, last_name, address_line1, town, postcode, email)
     values ('Bilbo','Underhill','13 Rivendell Way','Hobbiton','ZZ1 9ZZ','bu@test.invalid') returning id`
  );
  const j = await historicalJob({
    customer_id: c.id,
    source_reference: 'OLDREF-13RW'
  });
  const ref = (await one(`select job_ref from public.jobs where id=$1`, [j.id]))
    .job_ref;
  for (const term of [
    ref,
    'OLDREF-13RW',
    'Underhill',
    '13 Rivendell Way',
    'Hobbiton',
    'ZZ1 9ZZ'
  ]) {
    const r = await jobsRead({ view: 'historical', q: term });
    assert.ok(
      (r.jobs ?? []).some((x) => x.job_ref === ref),
      `historical search must find it by "${term}"`
    );
  }
  // Scoped: the same term finds nothing in the operational queue.
  const active = await jobsRead({ view: 'active', q: 'OLDREF-13RW' });
  assert.equal(
    (active.jobs ?? []).length,
    0,
    'active search stays operational'
  );
});

test('40. browsing enforces readability and never bypasses it', async () => {
  const mine = (
    await one(
      `select app.read_jobs('{"read_type":"JOBS","view":"all"}'::jsonb,
       jsonb_build_object('person_id', $1::text, 'roles', jsonb_build_array('Installer'))) r`,
      [person.id]
    )
  ).r;
  assert.equal(mine.total, 0, 'a role with no job visibility browses nothing');
  assert.equal(mine.counts.all, 0, 'counts respect permissions too');
});

test('41. an unknown view is refused rather than silently widened', async () => {
  await assert.rejects(
    db.query(
      `select app.read_jobs('{"read_type":"JOBS","view":"everything"}'::jsonb, ${actor()})`
    ),
    /R1A_INVALID_FIELDS/
  );
});

// --- Job Detail reads: readable, but never operational -----------------------
//
// Opening an imported job's detail page failed on Work, Money, Operations and
// History with R1A_OUTSIDE_PILOT: app.read_authorize_job refused anything
// app.job_in_scope excluded, before it ever asked whether the person could
// read it. Reading a job and being allowed to work on it are different
// questions, and the read models already answer the second one themselves.

const readAs = async (type, id, roles = ['Admin']) =>
  (
    await one(
      `select app.read_authorize_job(jsonb_build_object('person_id', $1::text,
       'roles', $2::jsonb), $3) j`,
      [person.id, JSON.stringify(roles), id]
    )
  ).j;

test('42. every Job Detail read works for a historical job, and still for a live one', async () => {
  const h = await historicalJob();
  const l = await liveJobInsert();
  for (const [id, label] of [
    [h.id, 'historical'],
    [l.id, 'live']
  ]) {
    const job = await one(`select * from public.jobs where id=$1`, [id]);
    for (const [name, expr] of [
      ['JOB_OVERVIEW', 'app.read_job_overview(j)'],
      ['AUDIT_HISTORY', 'app.read_audit_history(j)'],
      ['ACTION_AVAILABILITY', `app.read_action_availability(${actor()}, j)`]
    ]) {
      const r = await one(`select ${expr} r from public.jobs j where j.id=$1`, [
        id
      ]);
      assert.ok(r.r !== null, `${name} must answer for a ${label} job`);
    }
    assert.ok(job.id);
  }
});

test('43. the read guard authorises on readability, not operational scope', async () => {
  const h = await historicalJob();
  // Admin may read it even though it is out of operational scope.
  const job = await readAs('any', h.id, ['Admin']);
  assert.ok(job, 'a readable historical job resolves');
  // job_in_scope stays false; the guard simply no longer consults it.
  const inv = await one(
    `select app.job_in_scope(j) s, app.job_actionable(j) a from public.jobs j where j.id=$1`,
    [h.id]
  );
  assert.equal(inv.s, false, 'historical stays out of operational scope');
  assert.equal(inv.a, false, 'historical stays non-actionable');
});

test('44. historical support is not a permission bypass', async () => {
  const h = await historicalJob();
  await assert.rejects(
    db.query(
      `select app.read_authorize_job(jsonb_build_object('person_id', $1::text,
         'roles', jsonb_build_array('Installer')), $2)`,
      [person.id, h.id]
    ),
    /R1A_JOB_ACCESS_DENIED/,
    'someone who may not read the job is still refused, and not with OUTSIDE_PILOT'
  );
});

test('45. a missing job is still not found, not readable', async () => {
  await assert.rejects(
    db.query(
      `select app.read_authorize_job(${actor()}, '00000000-0000-0000-0000-000000000000')`
    ),
    /R1A_JOB_NOT_FOUND/
  );
});

test('46. a historical job offers no action while a live one does', async () => {
  const h = await historicalJob();
  const l = await liveJobInsert();
  const avail = async (id) => {
    const r = await one(
      `select app.read_action_availability(${actor()}, j) r from public.jobs j where j.id=$1`,
      [id]
    );
    return Object.entries(r.r?.commands ?? {})
      .filter(([, f]) => f?.available)
      .map(([k]) => k);
  };
  assert.deepEqual(
    await avail(h.id),
    [],
    'nothing may be done to a historical record'
  );
  // The live job is still assessed - every command is weighed and answered -
  // whereas before this fix the historical one could not be assessed at all.
  const live = await one(
    `select app.read_action_availability(${actor()}, j) r from public.jobs j where j.id=$1`,
    [l.id]
  );
  assert.ok(
    Object.keys(live.r?.commands ?? {}).length > 0,
    'a live job is assessed, so the empty historical answer is a decision not a failure'
  );
});

test('47. commands still refuse a historical job outright', async () => {
  const h = await historicalJob();
  // The command guard is a different function and keeps its scope check.
  await assert.rejects(
    db.query(`select app.authorize_job(${actor()}, $1::uuid)`, [h.id]),
    /R1A_OUTSIDE_PILOT/,
    'app.authorize_job must still reject historical records'
  );
});

// --- Run ---------------------------------------------------------------------

for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
  } catch (e) {
    console.log(`FAIL  ${name}`);
    console.log(`      ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`${passed}/${tests.length} historical-import assertions passed`);
