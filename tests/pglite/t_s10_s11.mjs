// S10 (calls, issues, operational completion, scheduled generators) and
// S11 (planner update, move job, change installer) - PORT_EXTRA=20260919126000_s10_s11_operations.sql
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok } = f;
const { job } = await readyToBook(f);
const jobRow = async () => one(`select * from public.jobs where id=$1`, [job]);
const wpRow = async (wp) =>
  one(`select * from public.work_packages where id=$1`, [wp]);
const count = async (t, where = 'true', p = []) =>
  (await one(`select count(*)::int n from public.${t} where ${where}`, p)).n;
const snapshot = async () => {
  const out = {};
  for (const t of [
    'audit_events',
    'tasks',
    'task_events',
    'outbox',
    'calendar_links',
    'allocations',
    'issues',
    'issue_events',
    'calls',
    'ghl_tasks',
    'invoice_stages'
  ])
    out[t] = await count(t);
  out.versions = (
    await all(
      `select id, version from public.jobs union all select id, version from public.work_packages union all select id, version from public.allocations union all select id, version from public.scaffold_bookings order by 1`
    )
  )
    .map((r) => r.id + ':' + r.version)
    .join(',');
  return out;
};
const expectRefusal = async (who, req, code) => {
  const before = await snapshot();
  const r = await cmd(who, req);
  assert.equal(r.error, code, JSON.stringify(r));
  assert.deepEqual(
    await snapshot(),
    before,
    'refusal wrote something: ' + code
  );
};

// ---- seed booked work (booking intake is another module) --------------------
const company = (
  await one(
    `insert into public.companies (name, type) values ('Scaff Co', 'Scaffolder') returning id`
  )
).id;
const roof = (
  await one(
    `insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, commissioning_required, sequence)
  values ($1, 'Roof', true, '2026-10-12', '2026-10-13', 'Scheduled', false, 1) returning id`,
    [job]
  )
).id;
const elec = (
  await one(
    `insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, commissioning_required, sequence)
  values ($1, 'Electrical', true, '2026-10-14', '2026-10-14', 'Scheduled', true, 2) returning id`,
    [job]
  )
).id;
const aRoof = (
  await one(
    `insert into public.allocations (work_package_id, person_id, role, start_at, end_at) values ($1,$2,'Lead','2026-10-12','2026-10-13') returning id`,
    [roof, people.inst_a]
  )
).id;
const aElec = (
  await one(
    `insert into public.allocations (work_package_id, person_id, role, start_at, end_at) values ($1,$2,'Lead','2026-10-14','2026-10-14') returning id`,
    [elec, people.inst_b]
  )
).id;
const aElec2 = (
  await one(
    `insert into public.allocations (work_package_id, person_id, role, start_at, end_at) values ($1,$2,'Second','2026-10-14','2026-10-14') returning id`,
    [elec, people.inst_a]
  )
).id;
const scb = (
  await one(
    `insert into public.scaffold_bookings (job_id, company_id, erect_planned_at, strip_forecast_at, status) values ($1,$2,'2026-10-09','2026-10-30','Booked') returning id`,
    [job, company]
  )
).id;

// ---- MOVE_JOB ---------------------------------------------------------------
let j = await jobRow();
const moveReq = (extra = {}) => ({
  command_id: id(),
  command_type: 'MOVE_JOB',
  job_id: job,
  expected_version: j.version,
  payload: {
    activities: ['Roof', 'Scaffold'],
    planned_start: '2026-10-19',
    planned_end: '2026-10-20',
    scaffold_erect: '2026-10-16',
    reason: 'Customer agreed roof move',
    ...extra
  }
});
// stage restriction enforced server-side (ReadyToBook is not reschedulable)
await expectRefusal('tanya', moveReq(), 'R1A_STAGE_NOT_ELIGIBLE');
await db.query(
  `update public.jobs set workflow_stage='Booked', next_action_at='2026-10-09T00:00:00+01' where id=$1`,
  [job]
);
j = await jobRow();
await expectRefusal(
  'tanya',
  { ...moveReq(), expected_version: j.version - 1 },
  'R1A_STALE_VERSION'
);
await expectRefusal(
  'tanya',
  moveReq({ activities: ['Roof', 'Chimney'] }),
  'S11_REVIEW: invalid activity Chimney'
);
await expectRefusal(
  'tanya',
  moveReq({ activities: [] }),
  'R1A_REQUIRED_ACTIVITIES'
);
await expectRefusal(
  'tanya',
  moveReq({ planned_end: null }),
  'S11_REVIEW: planned_start/planned_end required for Roof'
);
await expectRefusal(
  'tanya',
  moveReq({ activities: ['Return'] }),
  'S11_REVIEW: no ReturnVisit work package to move'
);
await expectRefusal(
  'tanya',
  moveReq({ planned_end: '2026-10-18' }),
  'S11_DATE_INVALID: end before start'
);
await expectRefusal(
  'tanya',
  moveReq({ planned_start: '2026-02-30' }),
  'S11_DATE_INVALID: invalid calendar date'
);
await expectRefusal('tanya', moveReq({ reason: '' }), 'R1A_REQUIRED_REASON');
await expectRefusal('store', moveReq(), 'R1A_ROLE_DENIED');
await expectRefusal('tanya', moveReq({ bogus: 1 }), 'R1A_INVALID_FIELDS');
// S15 guard
const s15 = (
  await one(
    `insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, status, created_rule_version)
  values ($1::uuid,'S15-REOPEN-REVIEW','S15-TEST-'||$1::text,'Cancellation','Review',$2,'Open','S15-1.0') returning id`,
    [job, people.tanya]
  )
).id;
await expectRefusal('tanya', moveReq(), 'S15_REVIEW: normal work suppressed');
await db.query(`update public.tasks set status='Complete' where id=$1`, [s15]);

const mv = moveReq();
let r = ok(await cmd('tanya', mv), 'move roof+scaffold');
assert.equal(r.status, 'Moved');
assert.equal(r.external_calls, 0);
let w = await wpRow(roof);
assert.equal(w.planned_start.toISOString().slice(0, 10), '2026-10-19');
assert.equal(w.revision, 2);
assert.equal((await wpRow(elec)).revision, 1, 'electrical preserved');
assert.deepEqual(
  r.preserved.map((p) => p.trade),
  ['Electrical']
);
let al = await one(`select * from public.allocations where id=$1`, [aRoof]);
assert.equal(al.start_at.toISOString().slice(0, 10), '2026-10-19');
assert.ok(al.calendar_link_id);
const link = await one(`select * from public.calendar_links where id=$1`, [
  al.calendar_link_id
]);
assert.equal(link.status, 'Pending');
assert.equal(link.all_day, true);
const out1 = await one(`select * from public.outbox where id=$1`, [
  r.calendar_outbox_ids[0]
]);
assert.equal(out1.response_summary, 'CAPTURE_ONLY: no Calendar API call');
assert.equal(out1.action_type, 'CalendarCreate');
assert.equal(
  out1.idempotency_key,
  `S11-CALENDAR-${mv.command_id}-MOVE_${aRoof}`
);
assert.equal(
  (
    await one(`select * from public.scaffold_bookings where id=$1`, [scb])
  ).erect_planned_at
    .toISOString()
    .slice(0, 10),
  '2026-10-16'
);
assert.deepEqual(r.impact_tasks.map((t) => t.code).sort(), [
  'ASSIGNED_PEOPLE',
  'CALENDAR',
  'CUSTOMER_NOTICE',
  'INTERIM_INVOICE',
  'MATERIALS',
  'SCAFFOLD'
]);
const notice = await one(`select * from public.tasks where instance_key=$1`, [
  `S11-MOVE-CUSTOMER-NOTICE-${mv.command_id}`
]);
assert.equal(notice.owner_id, people.tanya);
assert.equal(notice.task_group, 'Booking');
assert.ok(notice.assignment_rule_id, 'owner from assignment rule');
assert.equal(notice.template_code, 'S11-MOVE-CUSTOMER-NOTICE');
j = await jobRow();
assert.equal(j.version, r.job.version);
assert.equal(
  (
    await one(`select app.london_date($1::timestamptz)::text d`, [
      j.next_action_at
    ])
  ).d,
  '2026-10-14',
  'next_action_at = earliest live date'
);
assert.equal(
  await count('audit_events', `command_id=$1 and action='MoveJob'`, [
    mv.command_id
  ]),
  4
); // wp, allocation, scaffold, job
// replay + conflict
let rp = await cmd('tanya', mv);
assert.equal(rp.replayed, true);
assert.equal(rp.result.status, 'Moved');
assert.equal(
  await count('tasks', `instance_key like $1`, [
    `S11-MOVE-%-${mv.command_id}%`
  ]),
  6
);
assert.equal(
  (await cmd('tanya', { ...mv, payload: { ...mv.payload, reason: 'other' } }))
    .error,
  'R1A_COMMAND_CONFLICT'
);

// Electrical move with two allocations -> one ASSIGNED_PEOPLE task per allocation (§11.8)
const mv2 = {
  command_id: id(),
  command_type: 'MOVE_JOB',
  job_id: job,
  expected_version: j.version,
  payload: {
    activities: ['Electrical'],
    planned_start: '2026-10-21',
    planned_end: '2026-10-21',
    reason: 'Sparky delay'
  }
};
r = ok(await cmd('tanya', mv2), 'move electrical');
assert.equal(
  r.impact_tasks.filter((t) => t.code === 'ASSIGNED_PEOPLE').length,
  2
);
assert.equal(r.calendar_outbox_ids.length, 2);
assert.equal(r.preserved.filter((p) => p.scaffold_booking_id).length, 1);
j = await jobRow();
assert.equal(
  (
    await one(`select app.london_date($1::timestamptz)::text d`, [
      j.next_action_at
    ])
  ).d,
  '2026-10-16'
);

// ---- PLANNER_UPDATE ---------------------------------------------------------
w = await wpRow(roof);
const pu = (extra = {}, ver = w.version) => ({
  command_id: id(),
  command_type: 'PLANNER_UPDATE',
  job_id: job,
  work_package_id: roof,
  expected_version: ver,
  payload: {
    planned_start: '2026-10-22',
    planned_end: '2026-10-23',
    reason: 'Weather',
    ...extra
  }
});
await expectRefusal('tanya', pu({}, w.version + 1), 'R1A_STALE_VERSION');
await expectRefusal(
  'tanya',
  pu({ planned_end: '2026-10-01' }),
  'S11_DATE_INVALID: end before start'
);
await expectRefusal(
  'tanya',
  pu({ planned_start: 'next week' }),
  'S11_DATE_INVALID: expected YYYY-MM-DD or ISO timestamp'
);
await expectRefusal(
  'tanya',
  pu({ planned_start: undefined }),
  'R1A_REQUIRED_PLANNED_START'
);
r = ok(await cmd('tanya', pu()), 'planner update');
assert.equal(r.status, 'Updated');
assert.equal(r.work_package.revision, 3);
assert.equal(r.work_package.planned_start, '2026-10-22');
assert.equal(
  await count('audit_events', `entity_id=$1 and action='PlanDates'`, [roof]),
  1
);

// ---- CHANGE_INSTALLER -------------------------------------------------------
w = await wpRow(elec);
const ci = (extra = {}, env = {}) => ({
  command_id: id(),
  command_type: 'CHANGE_INSTALLER',
  job_id: job,
  work_package_id: elec,
  old_allocation_id: aElec,
  expected_version: w.version,
  ...env,
  payload: {
    mode: 'Replace',
    person_id: people.inst_a,
    reason: 'Lead unavailable',
    ...extra
  }
});
await expectRefusal(
  'tanya',
  { ...ci(), old_allocation_id: undefined },
  'R1A_REQUIRED_OLD_ALLOCATION_ID'
);
await expectRefusal(
  'tanya',
  ci({ mode: 'Swap' }),
  'S11_REVIEW: mode and reason required'
);
await expectRefusal(
  'tanya',
  ci({}, { expected_version: w.version + 5 }),
  'R1A_STALE_VERSION'
);
await expectRefusal(
  'tanya',
  ci({}, { old_allocation_id: aRoof }),
  'S11_REVIEW: allocation linkage invalid'
);
// NeedsReview outcomes write nothing (only the journal row)
const nr = async (payload, reason) => {
  const before = await snapshot();
  const res = ok(await cmd('tanya', ci(payload)), 'needs review ' + reason);
  assert.equal(res.status, 'NeedsReview');
  assert.equal(res.reason, reason, JSON.stringify(res));
  assert.deepEqual(await snapshot(), before);
};
await nr({ person_id: people.tanya }, 'INSTALLER_INACTIVE_OR_WRONG_ROLE');
await nr({}, 'CAPACITY_CONFLICT'); // inst_a already Second on electrical on 2026-10-21
const inst_c = (
  await one(
    `insert into public.people (legacy_id, email, display_name, capacity_per_day) values ('PERSON-inst_c','inst_c@test.local','Installer C',null) returning id`
  )
).id;
await db.query(
  `insert into public.person_roles (person_id, role_code) values ($1,'Installer')`,
  [inst_c]
);
await nr({ person_id: inst_c }, 'CAPACITY_NOT_CONFIGURED');
await db.query(`update public.people set capacity_per_day=1 where id=$1`, [
  inst_c
]);
const leave = (
  await one(
    `insert into public.person_availability (person_id, type, from_date, to_date) values ($1,'Leave','2026-10-20','2026-10-22') returning id`,
    [inst_c]
  )
).id;
await nr({ person_id: inst_c }, 'ON_LEAVE');
await db.query(
  `update public.person_availability set active=false where id=$1`,
  [leave]
);
const hol = (
  await one(
    `insert into public.holidays (local_date, description) values ('2026-10-21','Closure') returning id`
  )
).id;
await nr({ person_id: inst_c }, 'OFFICE_HOLIDAY');
await db.query(`delete from public.holidays where id=$1`, [hol]);

const chg = ci({ person_id: inst_c });
r = ok(await cmd('tanya', chg), 'replace');
assert.equal(r.status, 'Replaced');
assert.equal(r.external_calls, 0);
const oldA = await one(`select * from public.allocations where id=$1`, [aElec]);
assert.equal(oldA.active, false);
assert.equal(oldA.cancellation_reason, 'Lead unavailable');
const newA = await one(`select * from public.allocations where id=$1`, [
  r.allocation.id
]);
assert.equal(newA.replaced_allocation_id, aElec);
assert.equal(newA.role, 'Lead');
assert.equal(newA.person_id, inst_c);
assert.ok(newA.calendar_link_id);
assert.equal(
  (
    await one(`select status from public.calendar_links where id=$1`, [
      oldA.calendar_link_id
    ])
  ).status,
  'Cancelled'
);
assert.equal(r.calendar_cancel.action_type, 'CalendarCancel');
assert.equal((await wpRow(elec)).revision, w.revision + 1);
assert.equal((await cmd('tanya', chg)).replayed, true);
assert.equal(
  await count('allocations', `work_package_id=$1 and active`, [elec]),
  2
);
// Add mode defaults role Second (inst_b is free on 2026-10-22..23 roof dates)
w = await wpRow(roof);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'CHANGE_INSTALLER',
    job_id: job,
    work_package_id: roof,
    expected_version: w.version,
    payload: {
      mode: 'Add',
      person_id: people.inst_b,
      reason: 'Two-person roof',
      old_allocation_id: aRoof
    }
  }),
  'add'
);
assert.equal(r.status, 'Added');
assert.equal(r.allocation.role, 'Second');
assert.equal(
  (await one(`select active from public.allocations where id=$1`, [aRoof]))
    .active,
  true
);

// ---- S10 scheduled generators -----------------------------------------------
await db.query(
  `update public.work_packages set actual_end='2026-10-23', status='ReportedComplete' where id=$1`,
  [roof]
);
let sch = (await one(`select app.s10_run_schedules() r`)).r;
assert.equal(sch.jobs_evaluated, 1);
assert.equal(sch.installer_calls.created, 2);
assert.equal(sch.customer_calls.blocked, 1);
assert.deepEqual(sch.errors, []);
sch = (await one(`select app.s10_run_schedules() r`)).r;
assert.equal(sch.installer_calls.created, 0);
assert.equal(sch.installer_calls.reused, 2);
w = await wpRow(roof);
let insRoof = await one(`select * from public.tasks where instance_key=$1`, [
  `INS01-${roof}-R${w.revision}`
]);
assert.equal(insRoof.owner_id, people.tanya);
assert.ok(insRoof.assignment_rule_id);
assert.equal(insRoof.related_entity_id, roof);
assert.equal(insRoof.due_at.toISOString(), '2026-10-26T09:00:00.000Z'); // Mon 26 Oct 2026 is GMT
let we = await wpRow(elec);
let insElec = await one(`select * from public.tasks where instance_key=$1`, [
  `INS01-${elec}-R${we.revision}`
]);
assert.equal(insElec.due_at.toISOString(), '2026-10-22T08:00:00.000Z'); // 09:00 BST on Thu 22 Oct

// ---- CALL_RECORD ------------------------------------------------------------
const call = (task, payload, ver = task.version) => ({
  command_id: id(),
  command_type: 'CALL_RECORD',
  job_id: job,
  task_id: task.id,
  expected_version: ver,
  payload
});
const pre01 = await one(
  `select * from public.tasks where job_id=$1 and template_code='PRE01'`,
  [job]
);
await expectRefusal(
  'tanya',
  call(pre01, { type: 'Installer', outcome: 'Complete' }),
  'S10_REVIEW: invalid call task'
);
await expectRefusal(
  'tanya',
  call(
    insRoof,
    { type: 'Installer', outcome: 'Complete' },
    insRoof.version + 1
  ),
  'R1A_STALE_VERSION'
);
await expectRefusal(
  'tanya',
  call(insRoof, { type: 'Installer', outcome: 'Maybe' }),
  'S10_REVIEW: invalid call outcome'
);
await expectRefusal(
  'tanya',
  call(insRoof, {
    type: 'Installer',
    outcome: 'Complete',
    attempted_at: 'yesterday'
  }),
  'S10_DATE_INVALID: invalid timestamp'
);
await expectRefusal(
  'tanya',
  call(insRoof, {
    type: 'Installer',
    outcome: 'Complete',
    work_package_id: elec
  }),
  'S10_REVIEW: work package linkage invalid'
);
await expectRefusal(
  'tanya',
  call(insRoof, { outcome: 'Complete' }),
  'R1A_REQUIRED_TYPE'
);
await expectRefusal(
  'dan',
  call(insRoof, { type: 'Installer', outcome: 'Complete' }),
  'R1A_TASK_ACCESS_DENIED'
);
// NoAnswer keeps it Open with a follow-up
const na = call(insRoof, {
  type: 'Installer',
  outcome: 'NoAnswer',
  attempted_at: '2026-10-26T10:00:00Z',
  notes: 'voicemail'
});
r = ok(await cmd('tanya', na), 'no answer');
assert.equal(r.status, 'Recorded');
assert.equal(r.task.status, 'Open');
assert.ok(r.task.next_followup_at);
assert.equal((await cmd('tanya', na)).replayed, true);
assert.equal(await count('calls', `task_id=$1`, [insRoof.id]), 1);
assert.equal(
  await count('task_events', `task_id=$1 and action='CallOutcome'`, [
    insRoof.id
  ]),
  1
);
insRoof = await one(`select * from public.tasks where id=$1`, [insRoof.id]);
r = ok(
  await cmd(
    'tanya',
    call(insRoof, {
      type: 'Installer',
      outcome: 'Complete',
      actual_completion_confirmed: true,
      attempted_at: '2026-10-26T11:00:00Z'
    })
  ),
  'confirmed'
);
assert.equal(r.task.status, 'Complete');
assert.equal(r.work_package.status, 'ConfirmedComplete');
// electrical: return required -> remedial issue + ISS02 + REM01
r = ok(
  await cmd(
    'tanya',
    call(insElec, {
      type: 'Installer',
      outcome: 'ReturnRequired',
      actual_completion_confirmed: 'yes',
      notes: 'Isolator missing'
    })
  ),
  'return'
);
assert.equal(r.work_package.status, 'ReturnRequired');
assert.equal(r.issue.type, 'Remedial');
assert.equal(r.issue.category, 'ReturnRequired');
assert.equal(r.issue.blocks_completion, true);
assert.equal(r.issue_task.template_code, 'ISS02');
assert.equal(r.return_task.template_code, 'REM01');
assert.equal(r.return_task.instance_key, `REM01-${r.issue.id}-E1`);
const remedial = r.issue.id;
// a date change bumps the revision -> a new INS01 episode
we = await wpRow(elec);
ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'PLANNER_UPDATE',
    job_id: job,
    work_package_id: elec,
    expected_version: we.version,
    payload: {
      planned_start: '2026-10-27',
      planned_end: '2026-10-27',
      reason: 'Return visit'
    }
  }),
  'return date'
);
await db.query(
  `update public.work_packages set actual_end='2026-10-27' where id=$1`,
  [elec]
);
sch = (await one(`select app.s10_run_schedules('2026-10-27T12:00:00Z') r`)).r;
assert.equal(sch.installer_calls.created, 1);
we = await wpRow(elec);
insElec = await one(`select * from public.tasks where instance_key=$1`, [
  `INS01-${elec}-R${we.revision}`
]);
ok(
  await cmd(
    'tanya',
    call(insElec, {
      type: 'Installer',
      outcome: 'Complete',
      actual_completion_confirmed: true,
      attempted_at: '2026-10-28T09:30:00Z'
    })
  ),
  'elec confirmed'
);

// INS02 (FN-18 Manual): due 2 staffed days after actual_end, owner = lead
sch = (await one(`select app.s10_run_schedules('2026-10-28T12:00:00Z') r`)).r;
assert.equal(sch.commissioning_reminders.created, 0, 'not yet due');
assert.equal(
  sch.customer_calls.created,
  1,
  'INS04 once everything is confirmed'
);
sch = (await one(`select app.s10_run_schedules('2026-10-29T12:00:00Z') r`)).r;
assert.equal(sch.commissioning_reminders.created, 1);
assert.equal(sch.customer_calls.created, 0);
const ins02 = await one(
  `select * from public.tasks where template_code='INS02' and job_id=$1`,
  [job]
);
assert.equal(ins02.owner_id, inst_c);
assert.equal(ins02.assignment_rule_id, null);
assert.equal(ins02.due_at.toISOString(), '2026-10-29T09:00:00.000Z');
const ins04 = await one(
  `select * from public.tasks where template_code='INS04' and job_id=$1`,
  [job]
);
assert.equal(ins04.instance_key, `INS04-${job}-ROOT`);
assert.equal(ins04.due_at.toISOString(), '2026-10-29T09:00:00.000Z');

// ---- ISSUE_CREATE / ISSUE_UPDATE -------------------------------------------
j = await jobRow();
const ic = (payload, ver = j.version, env = {}) => ({
  command_id: id(),
  command_type: 'ISSUE_CREATE',
  job_id: job,
  expected_version: ver,
  ...env,
  payload: {
    issue_type: 'Variation',
    title: 'Extra panel',
    description: 'Customer wants one more panel',
    ...payload
  }
});
await expectRefusal(
  'tanya',
  ic({ issue_type: 'Other' }),
  'R1A_INVALID_ISSUE_TYPE'
);
await expectRefusal('tanya', ic({ severity: 'High' }), 'R1A_INVALID_SEVERITY');
await expectRefusal('tanya', ic({}, j.version + 1), 'R1A_STALE_VERSION');
await expectRefusal(
  'tanya',
  ic({}, j.version, { task_id: ins04.id }),
  'R1A_INVALID_FIELDS'
);
await expectRefusal(
  'tanya',
  ic({ customer_impact: 'perhaps' }),
  'R1A_INVALID_CUSTOMER_IMPACT'
);
await expectRefusal(
  'tanya',
  ic({ requested_by: 'ben@test.local' }),
  'R1A_ACTOR_MISMATCH'
);
await expectRefusal(
  'tanya',
  ic({ owner_id: f.id() }),
  'R1A_SALESPERSON_NOT_FOUND'
);
const icReq = ic({ customer_impact: 'no', requested_by: 'tanya@test.local' });
r = ok(await cmd('tanya', icReq), 'variation');
assert.equal(r.status, 'Created');
assert.equal(r.issue.office_owner_id, people.hannah);
assert.equal(r.issue.blocks_completion, false);
assert.equal(r.task.template_code, 'ISS01');
assert.equal(r.task.owner_id, people.hannah);
assert.equal((await jobRow()).version, j.version, 'job untouched');
assert.equal((await cmd('tanya', icReq)).replayed, true);
const variation = r.issue.id;
// VariationApprover must be exactly one
await db.query(
  `update public.person_roles set active=false where person_id=$1`,
  [people.hannah]
);
await expectRefusal(
  'tanya',
  ic({}),
  'S10_CONFIG: exactly one active VariationApprover owner required'
);
await db.query(
  `update public.person_roles set active=true where person_id=$1`,
  [people.hannah]
);

let iss = await one(`select * from public.issues where id=$1`, [remedial]);
const iu = (issue, payload, ver = issue.version) => ({
  command_id: id(),
  command_type: 'ISSUE_UPDATE',
  job_id: job,
  issue_id: issue.id,
  expected_version: ver,
  payload
});
await expectRefusal(
  'tanya',
  iu(iss, { action: 'REASSIGN' }),
  'R1A_REQUIRED_OWNER_ID'
);
await expectRefusal(
  'tanya',
  iu(iss, { action: 'DELETE' }),
  'R1A_ISSUE_ACTION_DENIED'
);
await expectRefusal(
  'tanya',
  iu(iss, { action: 'TRANSITION', status: 'Resolved' }),
  'S10_REVIEW: resolution required'
);
await expectRefusal(
  'tanya',
  iu(iss, {
    action: 'TRANSITION',
    status: 'Closed',
    customer_resolution_confirmed: true
  }),
  'S10_REVIEW: resolved issue and customer confirmation required'
);
await expectRefusal(
  'tanya',
  iu(iss, { action: 'TRANSITION', status: 'Open' }),
  'S10_REVIEW: invalid issue transition'
);
await expectRefusal(
  'tanya',
  iu(iss, { action: 'REASSIGN', owner_id: people.ben }, iss.version + 1),
  'R1A_STALE_VERSION'
);
r = ok(
  await cmd('tanya', iu(iss, { action: 'REASSIGN', owner_id: people.ben })),
  'reassign'
);
assert.equal(r.status, 'Updated');
assert.equal(r.issue.office_owner_id, people.ben);
iss = await one(`select * from public.issues where id=$1`, [remedial]);
r = ok(
  await cmd(
    'tanya',
    iu(iss, {
      action: 'TRANSITION',
      status: 'Resolved',
      resolution: 'Isolator fitted'
    })
  ),
  'resolve'
);
assert.equal(r.issue.status, 'Resolved');
iss = await one(`select * from public.issues where id=$1`, [remedial]);
await expectRefusal(
  'tanya',
  iu(iss, { action: 'TRANSITION', status: 'Closed' }),
  'S10_REVIEW: resolved issue and customer confirmation required'
);
r = ok(
  await cmd(
    'tanya',
    iu(iss, {
      action: 'TRANSITION',
      status: 'Closed',
      customer_resolution_confirmed: 'yes'
    })
  ),
  'close'
);
assert.equal(r.issue.status, 'Closed');
assert.equal(r.issue.closed_by, people.tanya);
assert.deepEqual(
  (
    await all(
      `select event_type from public.issue_events where issue_id=$1 order by created_at, event_type`,
      [remedial]
    )
  )
    .map((e) => e.event_type)
    .sort(),
  ['Closed', 'Opened', 'Reassigned', 'Resolved']
);

// ---- OPERATIONAL_COMPLETE ---------------------------------------------------
j = await jobRow();
const oc = (ver) => ({
  command_id: id(),
  command_type: 'OPERATIONAL_COMPLETE',
  job_id: job,
  expected_version: ver
});
await expectRefusal('tanya', oc(j.version + 1), 'R1A_STALE_VERSION');
await expectRefusal('hannah', oc(j.version), 'R1A_ROLE_DENIED');
let before = await snapshot();
r = ok(await cmd('tanya', oc(j.version)), 'needs review');
assert.equal(r.status, 'NeedsReview');
assert.deepEqual(r.gate.reasons, [
  `COMMISSIONING_NOT_ACCEPTED:${elec}`,
  'CUSTOMER_NOT_HAPPY'
]);
assert.deepEqual(await snapshot(), before, 'NeedsReview writes nothing');

// customer unhappy -> complaint (blocking); then happy
let t4 = await one(`select * from public.tasks where id=$1`, [ins04.id]);
r = ok(
  await cmd(
    'tanya',
    call(t4, {
      type: 'Customer',
      outcome: 'Unhappy',
      customer_happy: false,
      notes: 'Mess left on drive'
    })
  ),
  'unhappy'
);
assert.equal(r.issue.type, 'Complaint');
assert.equal(r.issue.category, 'CustomerCall');
assert.equal(r.issue_task.owner_id, people.tanya);
const complaint = r.issue.id;
t4 = await one(`select * from public.tasks where id=$1`, [ins04.id]);
r = ok(
  await cmd(
    'tanya',
    call(t4, { type: 'Customer', outcome: 'Complete', customer_happy: true })
  ),
  'happy'
);
assert.ok(r.job_customer_happy_at);
await db.query(
  `insert into public.commissioning_submissions (job_id, work_package_id, allocation_id, installer_id, template_version, status)
  values ($1,$2,$3,$4,'R1-OFFICE-MANUAL-1.0','Accepted')`,
  [
    job,
    elec,
    r.allocation?.id ??
      (
        await one(
          `select id from public.allocations where work_package_id=$1 and role='Lead' and active`,
          [elec]
        )
      ).id,
    inst_c
  ]
);
j = await jobRow();
r = ok(await cmd('tanya', oc(j.version)), 'blocked by complaint');
assert.deepEqual(r.gate.reasons, ['BLOCKING_ISSUE_OPEN']);
iss = await one(`select * from public.issues where id=$1`, [complaint]);
ok(
  await cmd(
    'tanya',
    iu(iss, { action: 'TRANSITION', status: 'Resolved', resolution: 'Cleaned' })
  ),
  'resolve complaint'
);
// S15 guard
await db.query(`update public.tasks set status='Open' where id=$1`, [s15]);
await expectRefusal(
  'tanya',
  oc(j.version),
  'S15_REVIEW: normal work suppressed'
);
await db.query(`update public.tasks set status='Complete' where id=$1`, [s15]);
j = await jobRow();
const ocReq = oc(j.version);
r = ok(await cmd('tanya', ocReq), 'complete');
assert.equal(r.status, 'Completed');
assert.equal(r.created, true);
assert.equal(r.external_calls, 0);
assert.equal(r.job.workflow_stage, 'OperationallyComplete');
assert.equal(r.job.operational_complete_by, people.tanya);
assert.equal(r.ghl_task.template_code, 'GHL01');
assert.equal(r.ghl_task.instance_key, `GHL01-${job}-OPCOMPLETE`);
assert.equal(await count('ghl_tasks', `job_id=$1`, [job]), 1);
assert.deepEqual(r.invoice_stages.stages_created, ['Balance']);
assert.equal(
  Number(
    (
      await one(
        `select gross_pence from public.invoice_stages where job_id=$1 and stage='Balance'`,
        [job]
      )
    ).gross_pence
  ),
  200000
);
assert.equal((await cmd('tanya', ocReq)).replayed, true);
j = await jobRow();
r = ok(await cmd('tanya', oc(j.version)), 'already');
assert.equal(r.status, 'AlreadyComplete');
assert.equal(await count('ghl_tasks', `job_id=$1`, [job]), 1);
assert.equal(await count('tasks', `template_code='GHL01'`), 1);

// ---- actionability after completion / archive -------------------------------
await expectRefusal(
  'tanya',
  {
    command_id: id(),
    command_type: 'MOVE_JOB',
    job_id: job,
    expected_version: j.version,
    payload: {
      activities: ['Roof'],
      planned_start: '2026-11-02',
      planned_end: '2026-11-02',
      reason: 'x'
    }
  },
  'R1A_STAGE_NOT_ELIGIBLE'
);
await db.query(`update public.jobs set archived_at=now() where id=$1`, [job]);
w = await wpRow(roof);
await expectRefusal(
  'tanya',
  {
    command_id: id(),
    command_type: 'PLANNER_UPDATE',
    job_id: job,
    work_package_id: roof,
    expected_version: w.version,
    payload: { planned_start: '2026-11-02', planned_end: '2026-11-02' }
  },
  'R1A_JOB_NOT_ACTIONABLE'
);
iss = await one(`select * from public.issues where id=$1`, [variation]);
await expectRefusal(
  'tanya',
  iu(iss, { action: 'TRANSITION', status: 'Resolved', resolution: 'x' }),
  'R1A_JOB_NOT_ACTIONABLE'
);
t4 = await one(`select * from public.tasks where id=$1`, [ins04.id]);
await expectRefusal(
  'tanya',
  call(t4, { type: 'Customer', outcome: 'Other' }),
  'R1A_JOB_NOT_ACTIONABLE'
);
sch = (await one(`select app.s10_run_schedules() r`)).r;
assert.equal(sch.jobs_evaluated, 0, 'archived jobs are not scheduled');

// generator refuses when the release mode is off
await db.query(`update public.jobs set archived_at=null where id=$1`, [job]);
await db.query(
  `update public.release_modes set mode='Disabled' where function_id='FN-18'`
);
await assert.rejects(
  db.query(`select app.s10_schedule_missing_commissioning($1)`, [job]),
  /S10_REFUSED: FN-18 must be Manual/
);
sch = (await one(`select app.s10_run_schedules() r`)).r;
assert.equal(sch.modes['FN-18'], false);

console.log('t_s10_s11: all assertions passed');
