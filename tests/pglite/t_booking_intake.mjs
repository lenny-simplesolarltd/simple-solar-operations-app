// BOOKING_INTAKE (S05, R1). Run:
//   PORT_EXTRA=20260919145000_s05_booking_intake.sql node t_booking_intake.mjs
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { one, all, db, people, cmd, id, ok } = f;
const jobRow = (job) => one(`select * from public.jobs where id=$1`, [job]);
const count = async (table, where = 'true', p = []) =>
  (await one(`select count(*)::int n from public.${table} where ${where}`, p))
    .n;
const snapshot = async () => {
  const out = {};
  for (const t of [
    'jobs',
    'intake',
    'customer_changes',
    'work_packages',
    'allocations',
    'scaffold_bookings',
    'materials',
    'job_equipment',
    'technical_details',
    'tasks',
    'task_events',
    'audit_events',
    'commands',
    'customers',
    'presales'
  ]) {
    out[t] = (await all(`select to_jsonb(x)::text r from public.${t} x`))
      .map((r) => r.r)
      .sort();
  }
  return JSON.stringify(out);
};
const book = (who, job, version, payload, cid = id()) =>
  cmd(who, {
    command_id: cid,
    command_type: 'BOOKING_INTAKE',
    job_id: job,
    expected_version: version,
    payload
  });

// Directory data: one merchant, one scaffolder, one approved inverter product.
const merchant = (
  await one(
    `insert into public.companies (name, type) values ('Greentech', 'Merchant') returning id`
  )
).id;
const scaffolder = (
  await one(
    `insert into public.companies (name, type) values ('ScaffoldA', 'Scaffolder') returning id`
  )
).id;
const inverter = (
  await one(`insert into public.products (sku, name, category, model, unit, stock_tracked)
  values ('FOX-H1-5.0', 'Fox H1 5.0kW Inverter', 'Inverter', 'Fox 5.0', 'Each', false) returning id`)
).id;

// ---------------------------------------------------------------------------
// 1. Happy path at ReadyToBook
// ---------------------------------------------------------------------------
const { job, jobRef } = await readyToBook(f);
let j = await jobRow(job);
assert.equal(j.workflow_stage, 'ReadyToBook');
const payload = {
  customer_first_name: 'Ann',
  customer_last_name: 'Smith',
  street_address: '1 High St',
  city: 'Leeds',
  postcode: 'ls1 1aa',
  cost: '5,000.00',
  finance_route: 'Standard',
  merchant_name: 'greentech',
  date_roofer: '2026-10-06',
  date_sparky: '2026-10-08',
  date_scaffold: '2026-10-03',
  roofer: 'Installer  A',
  sparky: people.inst_b,
  scaffold_company: scaffolder,
  scaffold_notes: 'Side access',
  roofing_notes: 'South facing',
  ordering_notes: 'Deliver kerbside',
  fox_jb_calc: '3 strings',
  roof_hooks_type: 'Slate portrait',
  mat_slate_portrait: 12,
  mat_slate_landscape: '8',
  mat_r420181_total: 99,
  mat_panel_515: 8,
  mat_panel_460: 0,
  mat_optimisers: 4,
  inverter: 'fox 5.0',
  battery: 'PowerVault G200',
  battery_qty: 2,
  extras: 'Bird spikes',
  solar_kw: '4.12',
  annual_generation: 3800,
  submitted_by: 'tanya@test.local'
};
const cid = id();
const v0 = j.version;
const r1 = await book('tanya', job, v0, payload, cid);
const res = ok(r1, 'booking');
assert.equal(res.status, 'Processed', JSON.stringify(res.review_reasons));
assert.equal(res.match_status, 'Match');
assert.equal(res.workflow_stage, 'BookingInProgress');
assert.equal(res.job_ref, jobRef);
assert.equal(res.external_calls, 0);
assert.deepEqual(res.customer_changes, []);
assert.deepEqual(
  res.helper_tasks_completed,
  [],
  'the canonical sale creates no PRE-COPY-JOBID helper'
);
assert.deepEqual([...res.booking_tasks.created].sort(), [
  'BKG01',
  'BKG02',
  'BKG03'
]);
assert.equal(res.intake_id, 'R1A-BOOK-' + cid);
j = await jobRow(job);
assert.equal(res.version, j.version);
assert.equal(j.sold_booking_match_status, 'Match');
assert.equal(j.booking_approved_at, null, 'never confirms the booking');
const intake = await one(`select * from public.intake where intake_id=$1`, [
  res.intake_id
]);
assert.equal(j.booking_submission_id, intake.id);
assert.deepEqual(
  [
    intake.form_type,
    intake.processing_status,
    intake.job_id,
    intake.raw_payload_json.booking_job_ref
  ],
  ['Booking', 'Processed', job, jobRef]
);
assert.equal(
  (
    await one(
      `select app.london_date(next_action_at)::text d from public.jobs where id=$1`,
      [job]
    )
  ).d,
  '2026-10-03'
);
const pre01 = await one(
  `select * from public.tasks where job_id=$1 and template_code='PRE01'`,
  [job]
);
// BKG tasks, not BKG04/05, PRE tasks untouched
assert.deepEqual(
  (
    await all(
      `select template_code from public.tasks where job_id=$1 and template_code like 'BKG%' order by 1`,
      [job]
    )
  ).map((r) => r.template_code),
  ['BKG01', 'BKG02', 'BKG03']
);
assert.equal(
  await count(
    'tasks',
    `job_id=$1 and template_code like 'PRE0%' and status <> 'Complete'`,
    [job]
  ),
  0
);
// work packages + allocations
const wps = await all(
  `select * from public.work_packages where job_id=$1 order by sequence`,
  [job]
);
assert.deepEqual(
  wps.map((w) => [
    w.trade,
    w.status,
    w.planned_start.toISOString?.().slice(0, 10) ?? String(w.planned_start),
    w.commissioning_required,
    w.sequence
  ]),
  [
    ['Roof', 'Scheduled', '2026-10-06', false, 1],
    ['Electrical', 'Scheduled', '2026-10-08', true, 2]
  ]
);
const allocs = await all(
  `select w.trade, a.role, a.person_id from public.allocations a join public.work_packages w on w.id=a.work_package_id where w.job_id=$1 order by 1,2`,
  [job]
);
assert.deepEqual(
  allocs.map((a) => [a.trade, a.role, a.person_id]),
  [
    ['Electrical', 'Lead', people.inst_b],
    ['Roof', 'Lead', people.inst_a]
  ]
);
// scaffold
const sc = await all(
  `select company_id, erect_planned_at::text d, status, access_notes from public.scaffold_bookings where job_id=$1`,
  [job]
);
assert.deepEqual(
  sc.map((s) => [s.company_id, s.d, s.status, s.access_notes]),
  [[scaffolder, '2026-10-03', 'Planned', 'Side access']]
);
// materials: derived hook total 20 (submitted 99 ignored), components skipped, zero panel skipped
const mats = await all(
  `select m.*, w.trade from public.materials m left join public.work_packages w on w.id=m.work_package_id where m.job_id=$1 order by description`,
  [job]
);
const md = Object.fromEntries(mats.map((m) => [m.description, m]));
assert.deepEqual(
  mats.map((m) => [m.description, Number(m.required_quantity)]).sort(),
  [
    ['Amount of 515 Panels', 8],
    ['Bird spikes', 1],
    ['Optimisers', 4],
    ['PowerVault G200', 2],
    ['Total Renusol Roof Hook (R420181) -& screws', 20],
    ['fox 5.0', 1]
  ].sort()
);
assert.ok(
  mats.every((m) => m.merchant_id === merchant && m.source === 'ToOrder')
);
assert.equal(md['Amount of 515 Panels'].trade, 'Roof');
assert.equal(md['Optimisers'].trade, 'Electrical');
assert.equal(md['Amount of 515 Panels'].notes, 'MAPPING_REQUIRED:panel_515');
assert.equal(md['Amount of 515 Panels'].product_id, null);
assert.equal(md['fox 5.0'].product_id, inverter);
assert.equal(md['fox 5.0'].notes, null);
assert.equal(md['PowerVault G200'].notes, 'MAPPING_REQUIRED:battery_to_order');
assert.equal(
  String(
    md['Amount of 515 Panels'].need_by_date.toISOString?.().slice(0, 10) ??
      md['Amount of 515 Panels'].need_by_date
  ).slice(0, 10),
  '2026-10-06'
);
// equipment
const eq = await all(
  `select equipment_type, planned_product_id, quantity, technical_review_status, planned_location from public.job_equipment where job_id=$1 order by 1`,
  [job]
);
assert.deepEqual(
  eq.map((e) => [
    e.equipment_type,
    e.planned_product_id,
    e.quantity,
    e.technical_review_status,
    e.planned_location
  ]),
  [
    ['Battery', null, 2, 'MappingRequired', null],
    ['Inverter', inverter, 1, 'Planned', null]
  ]
);
// technical details
const td = await one(`select * from public.technical_details where job_id=$1`, [
  job
]);
assert.deepEqual(
  [
    Number(td.system_kw),
    Number(td.annual_generation_kwh),
    td.roof_notes,
    td.mounting_orientation,
    td.ordering_notes
  ],
  [
    4.12,
    3800,
    'South facing',
    'Slate portrait',
    'Deliver kerbside\n\nFox junction box calculation: 3 strings'
  ]
);
// audit
assert.equal(
  await count(
    'audit_events',
    `entity_id=$1 and action='BookingIntake' and command_id=$2`,
    [job, cid]
  ),
  1
);
assert.equal(
  await count(
    'audit_events',
    `entity_id=$1 and action='WorkflowStage:BookingInProgress'`,
    [job]
  ),
  1
);
// booking gates now block on BKG tasks only (and nothing else)
const gates = (await one(`select app.evaluate_booking_gates($1) g`, [job])).g;
assert.deepEqual(
  gates.gates
    .filter((g) => !g.pass)
    .map((g) => g.name)
    .sort(),
  ['task_BKG01', 'task_BKG02', 'task_BKG03']
);
console.log('happy path ok', jobRef, res.version);

// 2. idempotent replay: stored result, nothing written
let before = await snapshot();
assert.equal(
  (await book('tanya', job, v0 + 1, payload, cid)).error,
  'R1A_COMMAND_CONFLICT',
  'different content'
);
const replay2 = await book('tanya', job, v0, payload, cid);
assert.equal(replay2.replayed, true);
assert.deepEqual(replay2.result, res);
assert.equal(await snapshot(), before, 'replay writes nothing');

// 3. stale version from an older open form, refusals write nothing
before = await snapshot();
assert.equal(
  (await book('tanya', job, v0, { solar_kw: '9.99' })).error,
  'R1A_STALE_VERSION'
);
assert.equal(
  (
    await book('tanya', job, j.version, {
      ...payload,
      finance_route: 'Phoenix'
    })
  ).error,
  'R1A_FINANCE_ROUTE_CONFLICT'
);
assert.equal(
  (await book('tanya', job, j.version, { finance_route: 'Cash' })).error,
  'R1A_INVALID_FINANCE_ROUTE'
);
assert.equal(
  (await book('tanya', job, j.version, { surname_match: 'Smith' })).error,
  'R1A_INVALID_FIELDS'
);
assert.equal(
  (await book('tanya', job, j.version, { invoice_date: '2026-10-02' })).error,
  'R1A_INVALID_FIELDS'
);
assert.equal(
  (
    await cmd('tanya', {
      command_id: id(),
      command_type: 'BOOKING_INTAKE',
      job_id: job,
      task_id: pre01.id,
      expected_version: j.version,
      payload: {}
    })
  ).error,
  'R1A_INVALID_FIELDS'
);
assert.equal(
  (await book('tanya', job, j.version, { date_roofer: '06/10/2026' })).error,
  'R1A_INVALID_DATE'
);
assert.equal(
  (await book('tanya', job, j.version, { date_roofer: '2026-02-30' })).error,
  'R1A_INVALID_DATE'
);
assert.equal(
  (await book('tanya', job, j.version, { mat_rail: -1 })).error,
  'R1A_INVALID_INTEGER'
);
assert.equal(
  (await book('tanya', job, j.version, { mat_rail: '2.5' })).error,
  'R1A_INVALID_INTEGER'
);
assert.equal(
  (await book('tanya', job, j.version, { cost: '12.345' })).error,
  'R1A_INVALID_GROSS_AMOUNT'
);
assert.equal(
  (await book('tanya', job, j.version, { submitted_by: 'ben@test.local' }))
    .error,
  'R1A_ACTOR_MISMATCH'
);
assert.equal(
  (await book('store', job, j.version, {})).error,
  'R1A_ROLE_DENIED'
);
assert.equal(
  (await book('hannah', job, j.version, {})).error,
  'R1A_JOB_ACCESS_DENIED'
);
assert.equal(
  (await book('tanya', '00000000-0000-0000-0000-000000000000', 1, {})).error,
  'R1A_JOB_NOT_FOUND'
);
assert.equal(await snapshot(), before, 'refusals write nothing');

// 4. re-booking the same job (BookingInProgress): allowed, adds no duplicate lines/allocations
const again = ok(
  await book('tanya', job, j.version, {
    date_roofer: '2026-10-07',
    roofer: 'Installer B',
    mat_panel_515: 10,
    inverter: 'Fox 5.0'
  }),
  'rebook'
);
assert.equal(again.workflow_stage, 'BookingInProgress');
assert.deepEqual(again.helper_tasks_completed, []);
assert.deepEqual(again.booking_tasks.created, []);
assert.equal(
  await count(
    'allocations a join public.work_packages w on w.id=a.work_package_id',
    `w.job_id=$1`,
    [job]
  ),
  2
);
assert.equal(await count('materials', `job_id=$1`, [job]), 6);
assert.equal(await count('job_equipment', `job_id=$1`, [job]), 2);
assert.equal(
  (
    await one(
      `select planned_start::text d from public.work_packages where job_id=$1 and trade='Roof'`,
      [job]
    )
  ).d,
  '2026-10-07'
);
assert.equal(await count('work_packages', `job_id=$1`, [job]), 2);

// 5. Review: customer / amount / installer / merchant mismatch, customer never overwritten
const second = await readyToBook(f, {
  customer: { last_name: 'Jones', postcode: 'YO1 2BB', phone: '07123456789' }
});
let j2 = await jobRow(second.job);
const rv = ok(
  await book('tanya', second.job, j2.version, {
    customer_last_name: 'Jonas',
    phone: '07123456789',
    email: 'NEW@Example.com',
    cost: '4000',
    roofer: 'Nobody',
    sparky: people.tanya,
    merchant_name: 'Unknown Merchant',
    mat_panel_460: 6,
    date_roofer: '2026-11-02'
  }),
  'review booking'
);
assert.equal(rv.status, 'Review');
assert.equal(rv.match_status, 'Review');
assert.deepEqual(rv.review_reasons, [
  'CUSTOMER_MISMATCH',
  'AMOUNT_MISMATCH',
  'INSTALLER_NOT_FOUND',
  'INSTALLER_NOT_FOUND',
  'MERCHANT_UNRESOLVED'
]);
assert.deepEqual(
  rv.customer_changes.map((c) => [
    c.field_name,
    c.previous_value,
    c.incoming_value
  ]),
  [
    ['last_name', 'Jones', 'Jonas'],
    ['email', null, 'new@example.com']
  ]
);
assert.deepEqual(rv.amount_mismatch, { previous: 500000, incoming: 400000 });
assert.equal(
  rv.workflow_stage,
  'BookingInProgress',
  'review still links and moves ReadyToBook -> BookingInProgress'
);
const cust = await one(
  `select c.* from public.customers c join public.jobs j on j.customer_id=c.id where j.id=$1`,
  [second.job]
);
assert.deepEqual(
  [cust.last_name, cust.email],
  ['Jones', null],
  'customer untouched'
);
assert.equal(
  await count(
    'customer_changes',
    `job_id=$1 and resolution is null and reason='BOOKING_CUSTOMER_MISMATCH' and source_submission_id=$2`,
    [second.job, rv.intake_id]
  ),
  2
);
const in2 = await one(`select * from public.intake where intake_id=$1`, [
  rv.intake_id
]);
assert.equal(in2.processing_status, 'Review');
assert.equal(in2.processed_at, null);
assert.ok(
  JSON.parse(in2.validation_errors).some(
    (e) => e.error === 'CUSTOMER_MISMATCH' && e.field === 'last_name'
  )
);
j2 = await jobRow(second.job);
assert.equal(j2.sold_booking_match_status, 'Review');
assert.equal(
  j2.display_name,
  'Jonas – YO1 2BB',
  'derived display name follows the reference'
);
assert.equal(
  await count('materials', `job_id=$1 and merchant_id is null`, [second.job]),
  1
);
assert.equal(
  await count(
    'allocations a join public.work_packages w on w.id=a.work_package_id',
    `w.job_id=$1`,
    [second.job]
  ),
  0
);
console.log('review path ok');

// 6. early booking at Prebooking: linked, stage stays, no BKG tasks
const sold = await f.sell('tanya', {
  customer: {
    first_name: 'Eve',
    last_name: 'Early',
    address_line1: '2 Low St',
    town: 'York',
    postcode: 'YO2 2AA'
  },
  sale: { finance_route: 'Phoenix' },
  scope: {
    scaffold_required: false,
    roof_required: false,
    electrical_required: false
  }
});
assert.ok(sold.job_id, JSON.stringify(sold));
let j3 = await jobRow(sold.job_id);
const early = ok(
  await book('tanya', sold.job_id, j3.version, {
    finance_route: 'Phoenix',
    extras: 'Loose extras',
    date_scaffold: '2026-10-01'
  }),
  'early'
);
assert.equal(early.workflow_stage, 'Prebooking');
assert.equal(early.booking_tasks, null);
assert.deepEqual(early.review_reasons, ['SCAFFOLD_NOT_REQUIRED']);
assert.equal(early.status, 'Review');
assert.equal(
  await count('scaffold_bookings', `job_id=$1`, [sold.job_id]),
  0,
  'no scaffold manufactured'
);
j3 = await jobRow(sold.job_id);
assert.equal(j3.scaffold_required, false);
assert.ok(j3.booking_submission_id);
assert.equal(
  await count('tasks', `job_id=$1 and template_code like 'BKG%'`, [
    sold.job_id
  ]),
  0
);
assert.deepEqual(early.helper_tasks_completed, []);
// extras with no work package still reach the order list
assert.equal(
  await count(
    'materials',
    `job_id=$1 and work_package_id is null and need_by_date is null and notes='MAPPING_REQUIRED:extras'`,
    [sold.job_id]
  ),
  1
);

// 7. stage / actionability refusals
await db.query(`update public.jobs set workflow_stage='Booked' where id=$1`, [
  sold.job_id
]);
j3 = await jobRow(sold.job_id);
assert.equal(
  (await book('tanya', sold.job_id, j3.version, {})).error,
  'R1A_STAGE_NOT_ELIGIBLE'
);
await db.query(
  `update public.jobs set workflow_stage='Cancelled' where id=$1`,
  [sold.job_id]
);
j3 = await jobRow(sold.job_id);
assert.equal(
  (await book('tanya', sold.job_id, j3.version, {})).error,
  'R1A_JOB_NOT_ACTIONABLE'
);

// 8. scaffold required, scaffolder by exact name, unknown scaffold company is advisory (Draft, no review)
const third = await readyToBook(f, { customer: { last_name: 'Third' } });
const j4 = await jobRow(third.job);
const sc3 = ok(
  await book('tanya', third.job, j4.version, {
    scaffold_company: 'Mystery Scaffold',
    scaffold_notes: 'rear'
  }),
  'scaffold advisory'
);
assert.equal(sc3.status, 'Processed');
assert.deepEqual(sc3.review_reasons, ['SCAFFOLD_COMPANY_UNRESOLVED']);
assert.deepEqual(
  (
    await all(
      `select status, company_id, access_notes from public.scaffold_bookings where job_id=$1`,
      [third.job]
    )
  ).map((s) => [s.status, s.company_id, s.access_notes]),
  [['Draft', null, 'rear']]
);
console.log('ALL BOOKING_INTAKE TESTS PASSED');
