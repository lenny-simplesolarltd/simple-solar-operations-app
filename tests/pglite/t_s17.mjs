// S17 read side: execute_read, due windows, result catalogue, RLS (canonical identity + Job Sold schema).
// Run: PORT_EXTRA=20260919149000_s17_reads_rls.sql node t_s17.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, people, users, cmd, read, sell, as, id } = f;
const data = (r, msg) => { if (!r || !r.ok) { console.log('FAILED:', msg, r); process.exit(1); } return r.data; };

// Extra staff: a second Office person (office manager) with a linked login, and a login with no person.
const olivia = (await one(`insert into public.people (legacy_id, email, display_name) values ('PERSON-olivia','olivia@test.local','Olivia') returning id`)).id;
await db.query(`insert into public.person_roles (person_id, role_code) values ($1,'Office')`, [olivia]);
users.olivia = randomUUID();
await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1,'olivia@test.local',now())`, [users.olivia]);
users.ghost = randomUUID();
await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1,'ghost@test.local',now())`, [users.ghost]);
const scaffCo = (await one(`insert into public.companies (name, type) values ('Scaff Co','Scaffolder') returning id`)).id;

const { job, jobRef } = await readyToBook(f);
// A second job that olivia (not tanya) is assigned to.
const sold2 = await sell('tanya', { customer: { first_name: 'Bob', last_name: 'Jones', postcode: 'TQ3 3HY' } });
const job2 = sold2.job_id;
await db.query(`update public.tasks set owner_id = $1 where job_id = $2 and owner_id = $3`, [olivia, job2, people.tanya]);
const today = (await one(`select app.london_date(now())::text d`)).d;

// ---------------------------------------------------------------- due_window
const dw = async (due, asOf) => (await one(`select app.due_window($1::timestamptz, $2::date) w`, [due, asOf])).w;
assert.equal((await dw(null, '2026-09-18')).class, 'NO_DUE');
let w = await dw('2026-09-15T10:00:00Z', '2026-09-18'); assert.equal(w.class, 'OVERDUE'); assert.equal(w.label, 'OVERDUE (3 days late)'); assert.equal(w.days_delta, -3);
assert.equal((await dw('2026-09-17T10:00:00Z', '2026-09-18')).label, 'OVERDUE (1 day late)');
assert.equal((await dw('2026-09-18T08:00:00Z', '2026-09-18')).class, 'DUE_TODAY');
// 23:30Z on the 18th is 00:30 on the 19th in London (BST): tomorrow, not today.
assert.equal((await dw('2026-09-18T23:30:00Z', '2026-09-18')).class, 'DUE_TOMORROW');
assert.equal((await dw('2026-09-25T10:00:00Z', '2026-09-18')).class, 'NEXT_7_DAYS');
w = await dw('2026-09-26T10:00:00Z', '2026-09-18'); assert.equal(w.class, 'NORMAL_LATER'); assert.equal(w.label, 'NORMAL/LATER'); assert.equal(w.days_delta, 8);

// ---------------------------------------------------------------- envelope / identity
let r = await read('tanya', { read_type: 'WHO_AM_I' });
let d = data(r, 'whoami');
assert.equal(r.actor_id, people.tanya); assert.equal(d.authenticated, true); assert.deepEqual(d.roles, ['Office']);
assert.equal(d.person.display_name, 'Tanya'); assert.equal(d.classes.office_manager, true); assert.equal(d.classes.admin, false);
for (const who of ['ghost', null]) {
  r = await read(who, { read_type: 'WHO_AM_I' });
  d = data(r, 'whoami ' + who); assert.equal(d.authenticated, false); assert.equal(d.person, null); assert.equal(r.actor_id, null);
}
assert.equal((await read('tanya', { read_type: 'WHO_AM_I', job_id: job })).error, 'R1A_INVALID_FIELDS');
assert.equal((await read('tanya', { read_type: 'OFFICE_HOME', bogus: 1 })).error, 'R1A_INVALID_FIELDS');
assert.equal((await read('tanya', { read_type: 'IDENTITY_PROBE' })).error, 'R1A_UNKNOWN_READ');
assert.equal((await read('tanya', { read_type: 'NOPE' })).error, 'R1A_UNKNOWN_READ');
assert.equal((await read('tanya', { read_type: 'STOCK_BALANCE' })).error, 'R1A_READ_UNSUPPORTED');
assert.equal((await read('store', { read_type: 'OFFICE_HOME' })).error, 'R1A_ROLE_DENIED');
assert.equal((await read('inst_a', { read_type: 'MY_TASKS' })).error, 'R1A_ROLE_DENIED');
assert.equal((await read('sam', { read_type: 'MY_TASKS' })).error, 'R1A_ROLE_DENIED');
assert.equal((await read('ghost', { read_type: 'OFFICE_HOME' })).error, 'R1A_UNKNOWN_OR_DUPLICATE_ACTOR');
assert.equal((await read(null, { read_type: 'OFFICE_HOME' })).error, 'R1A_AUTHENTICATED_EMAIL_REQUIRED');
assert.equal((await read('tanya', { read_type: 'OFFICE_HOME', as_of: '2026-02-30' })).error, 'S17_DATE_INVALID');
assert.equal((await read('tanya', { read_type: 'PLANNER_3_WEEKS', as_of: 'soon' })).error, 'S11_DATE_INVALID');

// ---------------------------------------------------------------- seed extra state
// Overdue booking task for tanya, job-less system task for olivia, INS01 call task, S13 GHL task.
const mk = async (code, key, owner, due, jobId = job, related = 'jobs') => (await one(
  `select app.create_task_instance($1,$2,$3,$4,null,$5::timestamptz,null,null,null,$6) id`, [jobId, code, key, owner, due, related])).id;
const bkg = await mk('BKG01', `BKG01-${job}`, people.tanya, '2026-09-10T09:00:00Z');
const ins01 = await mk('INS01', `INS01-${job}-R1`, people.tanya, `${today}T09:00:00Z`);
const ghl = await mk('S13-GHL-PROGRESSION', `S13-GHL-${job}`, people.tanya, null);
const sys = await mk('SYS01', `SYS01-${today}`, olivia, `${today}T08:00:00Z`, null, null);
await mk('BKG02', `BKG02-${job2}`, olivia, '2026-09-10T09:00:00Z', job2);
await db.query(`insert into public.issues (job_id, type, category, description, raised_at, raised_by, office_owner_id, severity, status, blocks_completion, blocks_strip, approval_status)
  values ($1,'Complaint','Workmanship','Scratched roof tile', now(), $2, $2, 'Normal', 'Open', true, false, 'NotRequired')`, [job, people.tanya]);
await db.query(`insert into public.intake (intake_id, form_type, form_id, submission_id, received_at, raw_payload_json, payload_hash, processing_status, validation_errors)
  values ('INT-1','Booking','F1','SUB-9', now(), '{"x":1}', 'h', 'Review', 'Missing postcode')`);

const snapshot = async () => one(`select (select count(*) from public.audit_events)::int a, (select count(*) from public.commands)::int c,
  (select count(*) from public.tasks)::int t, (select count(*) from public.task_events)::int e, (select sum(version) from public.jobs)::int v`);
let before = await snapshot();

// ---------------------------------------------------------------- OFFICE_HOME / MY_TASKS / TEAM_TASKS
d = data(await read('tanya', { read_type: 'OFFICE_HOME', as_of: today }), 'home');
assert.ok(d.overdue.some(t => t.id === bkg)); assert.equal(d.overdue_count, d.overdue.length);
assert.ok(d.due_today.some(t => t.id === ins01));
assert.ok(d.booking_review.some(t => t.id === bkg));
assert.ok(!d.overdue.some(t => t.job_id === job2), 'tasks tanya does not own are hidden');
assert.ok(!d.due_today.some(t => t.id === sys), 'olivia owns SYS01, not tanya');
assert.equal(d.unresolved_issues_count, 1);
const bv = d.overdue.find(t => t.id === bkg);
assert.equal(bv.job_ref, jobRef); assert.equal(bv.customer_name, 'Ann Smith'); assert.equal(bv.postcode, 'LS1 1AA');
assert.equal(bv.owner_name, 'Tanya'); assert.equal(bv.job_label, `${jobRef} – Smith – LS1 1AA`); assert.equal(bv.due_class, 'OVERDUE');
assert.equal(bv.group, 'Booking');
assert.equal(bv.search_text, `${jobRef.toLowerCase()} | ann smith | ls1 1aa | prepare booking | tanya | bkg01`);
assert.ok(Array.isArray(d.health_alerts));

d = data(await read('tanya', { read_type: 'MY_TASKS', as_of: today }), 'my');
assert.equal(d.scope, 'my'); assert.equal(new Set(d.tasks.map(t => t.id)).size, d.tasks.length, 'deduplicated');
assert.equal(d.tasks[0].id, bkg, 'overdue list first');
let dq = data(await read('tanya', { read_type: 'MY_TASKS', as_of: today, query: 'ls11aa' }), 'my q');
assert.ok(dq.count >= 1 && dq.tasks.every(t => t.postcode === 'LS1 1AA'));
assert.equal(data(await read('tanya', { read_type: 'MY_TASKS', as_of: today, query: 'zzzz' }), 'my q2').count, 0);
d = data(await read('olivia', { read_type: 'MY_TASKS', as_of: today }), 'olivia my');
assert.ok(d.tasks.some(t => t.id === sys)); assert.ok(!d.tasks.some(t => t.id === bkg));

assert.equal((await read('hannah', { read_type: 'TEAM_TASKS' })).error, 'R1A_ROLE_DENIED');
assert.equal((await read('dan', { read_type: 'TEAM_TASKS' })).error, 'R1A_ROLE_DENIED');
d = data(await read('olivia', { read_type: 'TEAM_TASKS', as_of: today }), 'team olivia');
let tb = d.tasks.find(t => t.id === bkg);
// Canonical visibility: Office holds job.read.all, so the team view is not redacted.
assert.equal(tb.customer_name, 'Ann Smith'); assert.equal(tb.customer_redacted, undefined);
assert.ok(tb.search_text.includes('smith'));
assert.equal(d.tasks.find(t => t.job_id === job2).customer_name, 'Bob Jones', 'own job not redacted');
assert.ok(data(await read('olivia', { read_type: 'TEAM_TASKS', as_of: today, query: 'smith' }), 'team q').count > 0, 'visible identity is searchable');
// Redaction still applies to a team reader without job visibility: remove Office's job.read.all.
await db.query(`delete from public.role_permissions where role_code='Office' and permission_code='job.read.all'`);
tb = data(await read('olivia', { read_type: 'TEAM_TASKS', as_of: today }), 'team olivia no read.all').tasks.find(t => t.id === bkg);
assert.equal(tb.customer_name, null); assert.equal(tb.customer_redacted, true); assert.equal(tb.job_label, jobRef);
await db.query(`insert into public.role_permissions (role_code, permission_code) values ('Office','job.read.all')`);
before = { ...before, a: before.a + 2 }; // the permission toggle above is audited by the canonical trigger; reads still write nothing
d = data(await read('tanya', { read_type: 'TEAM_TASKS', as_of: today }), 'team tanya');
assert.equal(d.tasks.find(t => t.id === bkg).customer_name, 'Ann Smith');
assert.ok(d.tasks.some(t => t.id === sys), 'team sees job-less tasks');

// ---------------------------------------------------------------- JOB_SEARCH / JOB_OVERVIEW / AUDIT_HISTORY
assert.equal((await read('tanya', { read_type: 'JOB_SEARCH' })).error, 'R1A_QUERY_REQUIRED');
assert.equal((await read('tanya', { read_type: 'JOB_SEARCH', query: '  ' })).error, 'R1A_QUERY_REQUIRED');
d = data(await read('tanya', { read_type: 'JOB_SEARCH', query: 'smith' }), 'search');
assert.equal(d.count, 1); assert.equal(d.results[0].id, job); assert.equal(d.results[0].job_ref, jobRef);
assert.equal(d.results[0].job_label, `${jobRef} – Smith – LS1 1AA`);
assert.equal(data(await read('tanya', { read_type: 'JOB_SEARCH', query: 'ls11aa' }), 's2').count, 1);
assert.equal(data(await read('tanya', { read_type: 'JOB_SEARCH', query: jobRef.toLowerCase() }), 's3').count, 1);
// Canonical visibility (20260919170000): Office holds job.read.all, so an unassigned job is found.
assert.equal(data(await read('tanya', { read_type: 'JOB_SEARCH', query: 'jones' }), 's4').count, 1, 'job.read.all sees unassigned');
assert.equal(data(await read('olivia', { read_type: 'JOB_SEARCH', query: 'jones' }), 's5').count, 1);
assert.equal(data(await read('olivia', { read_type: 'JOB_SEARCH', query: 'smith' }), 's6').count, 1, 'job.read.all');
assert.equal(data(await read('ben', { read_type: 'JOB_SEARCH', query: 's' }), 's7').count, 2);

d = data(await read('tanya', { read_type: 'JOB_OVERVIEW', job_id: job }), 'overview');
assert.equal(d.found, true); assert.equal(d.identity.workflow_stage, 'ReadyToBook'); assert.equal(d.identity.job_ref, jobRef);
assert.equal(d.identity.salesperson_id, people.sam);
for (const k of ['booking', 'work', 'materials', 'scaffold', 'commissioning', 'handover', 'finance', 'crm', 'cancellation', 'archive', 'system']) assert.ok(d[k], k);
assert.ok(d.booking.presale_id, 'sold document is the presale');
assert.equal(d.finance.deposit_confirmed, true); assert.ok(d.finance.stages.length >= 1); assert.equal(d.work.unresolved_issues, 1);
assert.ok(d.booking.tasks.some(t => t.id === bkg));
assert.equal(data(await read('tanya', { read_type: 'JOB_OVERVIEW', job_id: jobRef }), 'by ref').identity.id, job);
// Canonical visibility: Office / VariationApprover read every job...
assert.equal(data(await read('tanya', { read_type: 'JOB_OVERVIEW', job_id: job2 }), 'ov job2').identity.id, job2);
assert.equal(data(await read('hannah', { read_type: 'JOB_OVERVIEW', job_id: job }), 'ov hannah').identity.id, job);
// ...a role without job.read.all and no assignment still cannot.
assert.equal((await read('store', { read_type: 'JOB_OVERVIEW', job_id: job })).error, 'R1A_ROLE_DENIED');
assert.equal((await read('tanya', { read_type: 'JOB_OVERVIEW' })).error, 'R1A_JOB_NOT_FOUND');
assert.equal((await read('tanya', { read_type: 'JOB_OVERVIEW', job_id: '00000000-0000-0000-0000-000000000000' })).error, 'R1A_JOB_NOT_FOUND');

d = data(await read('tanya', { read_type: 'AUDIT_HISTORY', job_id: job }), 'audit');
assert.equal(d.found, true); assert.ok(d.task_events > 0 && d.audit_events > 0);
assert.equal(d.total_events, d.audit_events + d.task_events + d.issue_events);
for (let i = 1; i < d.events.length; i++) assert.ok(d.events[i - 1].timestamp <= d.events[i].timestamp, 'chronological');
assert.equal(data(await read('olivia', { read_type: 'AUDIT_HISTORY', job_id: job }), 'audit olivia').found, true);

// ---------------------------------------------------------------- OPERATIONAL_QUEUE / INTAKE_REVIEW
assert.equal((await read('tanya', { read_type: 'OPERATIONAL_QUEUE', queue: 'materials' })).error, 'R1A_QUEUE_NOT_IN_R1');
assert.equal((await read('tanya', { read_type: 'OPERATIONAL_QUEUE' })).error, 'R1A_QUEUE_NOT_IN_R1');
d = data(await read('tanya', { read_type: 'OPERATIONAL_QUEUE', queue: 'calls' }), 'calls');
assert.deepEqual(d.tasks.map(t => t.id), [ins01]);
d = data(await read('tanya', { read_type: 'OPERATIONAL_QUEUE', queue: 'ghl' }), 'ghl');
assert.ok(d.tasks.some(t => t.id === ghl), 'S13 GHL task in ghl queue');
d = data(await read('tanya', { read_type: 'OPERATIONAL_QUEUE', queue: 'booking', query: 'BKG01' }), 'booking');
assert.deepEqual(d.tasks.map(t => t.id), [bkg]); assert.equal(d.count, 1);
d = data(await read('tanya', { read_type: 'OPERATIONAL_QUEUE', queue: 'intake_review' }), 'iq');
assert.equal(d.count, 1); assert.equal(d.items[0].intake_id, 'INT-1');
assert.equal((await read('hannah', { read_type: 'OPERATIONAL_QUEUE', queue: 'intake_review' })).error, 'R1A_ROLE_DENIED');
d = data(await read('tanya', { read_type: 'INTAKE_REVIEW' }), 'intake');
assert.equal(d.count, 1); assert.equal(d.items[0].validation_errors, 'Missing postcode'); assert.equal(d.items[0].raw_payload_json, undefined);
assert.equal((await read('dan', { read_type: 'INTAKE_REVIEW' })).error, 'R1A_ROLE_DENIED');

// ---------------------------------------------------------------- admin reads
assert.equal((await read('tanya', { read_type: 'RELEASE_MODE_STATUS' })).error, 'R1A_ROLE_DENIED');
d = data(await read('ben', { read_type: 'RELEASE_MODE_STATUS' }), 'modes');
assert.equal(d.length, 20); assert.ok(d.every(m => m.function_id && m.mode && m.target_release && m.authorised_job_scope));
d = data(await read('tanya', { read_type: 'SYSTEM_STATUS' }), 'sys');
assert.ok(d.health && d.commit_journal && d.outbox); assert.equal(d.not_configured_count, d.not_configured.length);
assert.ok(d.not_configured.some(x => x.area === 'Scaffolder contacts'));
assert.equal((await read('dan', { read_type: 'SYSTEM_STATUS' })).error, 'R1A_ROLE_DENIED');
assert.equal((await read('hannah', { read_type: 'SYSTEM_STATUS' })).error, 'R1A_ROLE_DENIED');

// ---------------------------------------------------------------- ACTION_AVAILABILITY
d = data(await read('tanya', { read_type: 'ACTION_AVAILABILITY', job_id: job }), 'aa');
let c = d.commands;
assert.deepEqual(c.booking_intake, { command_type: 'BOOKING_INTAKE', available: true, expected_version_entity: 'Jobs' });
assert.equal(c.start_job_booking.available, true); assert.equal(c.start_job_booking.prefill.postcode, 'LS1 1AA');
assert.equal(c.start_job_booking.prefill.job_ref, jobRef);
assert.deepEqual(c.move_job, { command_type: 'MOVE_JOB', available: false, expected_version_entity: 'Jobs', reason: 'STAGE_NOT_ELIGIBLE' });
assert.equal(c.deposit_confirm.reason, 'DIRECTOR_REQUIRED');
assert.equal(c.confirm_booking.reason, 'STAGE_NOT_ELIGIBLE');
assert.equal(c.cancel_job.available, true); assert.equal(c.reinstate_job.reason, 'STAGE_NOT_CANCELLED');
assert.equal(c.operational_complete.reason, 'STAGE_NOT_ELIGIBLE');
assert.equal(c.sold_intake, undefined, 'the sale is submit_presale, not a command');
assert.equal(c.call_record.expected_version_entity, 'Tasks');
assert.equal(d.actions.record_call.available, true); assert.equal(d.actions.record_call.mode, 'Automated');
assert.equal(d.actions.cancel_job.mode, 'Manual'); assert.equal(d.actions.archive_job.available, false);
assert.equal(d.actions.complete_task, undefined);
d = data(await read('ben', { read_type: 'ACTION_AVAILABILITY', job_id: job }), 'aa ben');
assert.equal(d.commands.deposit_confirm.reason, 'ALREADY_CONFIRMED');
// Reading is not acting: hannah can open the job but every command shows NOT_ASSIGNED.
d = data(await read('hannah', { read_type: 'ACTION_AVAILABILITY', job_id: job }), 'aa hannah');
assert.equal(d.assigned, false);
assert.ok(Object.values(d.commands).every(c => c.available === false));
assert.ok(Object.values(d.commands).some(c => c.reason === 'NOT_ASSIGNED'));
await db.query(`update public.release_modes set mode='Disabled' where function_id='FN-01'`);
d = data(await read('tanya', { read_type: 'ACTION_AVAILABILITY', job_id: job }), 'aa off');
assert.equal(d.commands.call_record.reason, 'MODE_UNAVAILABLE'); assert.equal(d.commands.start_job_booking.reason, 'MODE_UNAVAILABLE');
assert.equal(d.actions.record_call.mode, 'Disabled'); assert.equal(d.actions.record_call.available, false);
await db.query(`update public.release_modes set mode='Automated' where function_id='FN-01'`);

// ---------------------------------------------------------------- TASK_ACTION_AVAILABILITY
const pre01 = await one(`select * from public.tasks where job_id=$1 and template_code='PRE01'`, [job]);
d = data(await read('tanya', { read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre01.id }), 'taa');
assert.equal(d.actions.complete.available, false); assert.equal(d.actions.complete.note, 'Already Complete');
assert.equal(d.commands.task_reopen.available, true); assert.equal(d.commands.task_complete.reason, 'COMPLETE_NOT_AVAILABLE');
assert.equal(d.commands.task_evidence_attach.reason, 'ATTACH_NOT_AVAILABLE');
d = data(await read('dan', { read_type: 'TASK_ACTION_AVAILABILITY', task_id: pre01.id }), 'taa dan');
assert.equal(d.commands.task_reopen.reason, 'TASK_OWNER_OR_BACKUP_REQUIRED');
d = data(await read('tanya', { read_type: 'TASK_ACTION_AVAILABILITY', task_id: bkg }), 'taa bkg');
assert.equal(d.commands.task_complete.available, true); assert.equal(d.commands.start_job_booking.reason, 'NOT_A_BOOKING_HELPER_TASK');
assert.equal((await read('tanya', { read_type: 'TASK_ACTION_AVAILABILITY', task_id: 'x' })).error, 'R1A_TASK_NOT_FOUND');
d = data(await read('olivia', { read_type: 'TASK_ACTION_AVAILABILITY', task_id: bkg }), 'taa olivia');
assert.equal(d.commands.task_complete.available, false); assert.equal(d.assigned, false);
assert.equal((await read('tanya', { read_type: 'TASK_ACTION_AVAILABILITY', task_id: sys })).error, 'R1A_TASK_ACCESS_DENIED');
assert.equal(data(await read('olivia', { read_type: 'TASK_ACTION_AVAILABILITY', task_id: sys }), 'sys taa').commands.task_complete.available, true);

// ---------------------------------------------------------------- PLANNER
const wp = (trade, s, e, st = 'Scheduled') => one(`insert into public.work_packages (job_id, required, commissioning_required, sequence, trade, planned_start, planned_end, status)
  values ($1, true, false, 1, $2, $3, $4, $5) returning id`, [job, trade, s, e, st]).then(x => x.id);
const wpAlloc = await wp('Roof', '2026-10-05', '2026-10-06');
const wpBare = await wp('Electrical', '2026-10-07', '2026-10-07');
await wp('Other', '2026-10-05', '2026-10-05', 'Cancelled');
await wp('Other', '2026-12-01', '2026-12-02');
const alloc = (await one(`insert into public.allocations (work_package_id, person_id, role, start_at, end_at, active) values ($1,$2,'Lead',null,null,true) returning id`, [wpAlloc, people.inst_a])).id;
await db.query(`insert into public.allocations (work_package_id, person_id, role, start_at, end_at, active) values ($1,$2,'Lead','2026-10-05','2026-10-05',false)`, [wpAlloc, people.inst_b]);
await db.query(`insert into public.scaffold_bookings (job_id, company_id, erect_planned_at, strip_forecast_at, status) values ($1,$2,'2026-10-02','2026-10-20','Requested')`, [job, scaffCo]);
d = data(await read('hannah', { read_type: 'PLANNER_3_WEEKS', as_of: '2026-10-01' }), 'planner');
assert.equal(d.from, '2026-10-01'); assert.equal(d.to, '2026-10-21'); assert.equal(d.weeks, 3);
assert.equal(d.rows.length, 2, 'cancelled + out-of-window excluded; inactive allocation not joined');
const ra = d.rows.find(x => x.work_package_id === wpAlloc), rb = d.rows.find(x => x.work_package_id === wpBare);
assert.equal(ra.allocated, true); assert.equal(ra.allocation_id, alloc); assert.equal(ra.start_at, '2026-10-05'); assert.equal(ra.person_name, 'Installer A');
assert.equal(rb.allocated, false, 'unallocated booked work stays visible'); assert.equal(rb.person_id, null); assert.equal(rb.job_ref, jobRef);
assert.deepEqual(d.scaffold.map(s => s.kind), ['Erect', 'StripForecast']); assert.equal(d.scaffold[0].company, 'Scaff Co');
d = data(await read('tanya', { read_type: 'PLANNER_6_WEEKS', as_of: '2026-10-01' }), 'planner6');
assert.equal(d.to, '2026-11-11');

// Reads wrote nothing.
assert.deepEqual(await snapshot(), before);

// ---------------------------------------------------------------- result catalogue
const err = async (e, cid = null, field = null) => (await one(`select public.describe_command_error($1, $2, $3) r`, [e, cid, field])).r;
let e = await err('R1A_STALE_VERSION'); assert.equal(e.status, 'ActionRequired'); assert.equal(e.heading, 'ACTION REQUIRED'); assert.match(e.message, /changed after you opened/);
e = await err('R1A_REQUIRED_CITY'); assert.equal(e.status, 'ActionRequired'); assert.equal(e.field, 'city'); assert.equal(e.message, 'The town or city is required. Add it and try again.');
e = await err('R1A_REQUIRED_COMPLETION_NOTE'); assert.equal(e.field, 'completion_note'); assert.match(e.message, /completion note is required/);
e = await err('R1A_REQUIRED_WIDGET_COLOUR'); assert.equal(e.message, 'The widget colour is required. Add it and try again.');
e = await err('R1A_ROLE_DENIED', 'cmd-1'); assert.equal(e.status, 'Failed'); assert.equal(e.heading, 'COULD NOT COMPLETE'); assert.match(e.message, /permission.*Reference: cmd-1\.$/);
e = await err('R1A_MODE_DENIED'); assert.match(e.message, /switched off/);
e = await err('R1A_TASK_ACCESS_DENIED'); assert.match(e.message, /task owner, their backup/);
e = await err('S15_REVIEW: normal work suppressed'); assert.equal(e.status, 'ActionRequired'); assert.equal(e.message, 'This needs checking before it can go ahead: normal work suppressed.');
e = await err('S11_REVIEW: stale job revision'); assert.match(e.message, /changed after you opened/);
e = await err('S06_CONFIG: active X template required'); assert.equal(e.status, 'Failed'); assert.match(e.message, /setup needs attention/); assert.equal(e.detail, 'active X template required');
e = await err('S10_REFUSED: nope'); assert.match(e.message, /isn't allowed/);
e = await err('R1A_INVALID_ANYTHING'); assert.equal(e.status, 'ActionRequired');
e = await err('S11_DATE_INVALID: bad'); assert.match(e.message, /date entered/);
e = await err('R1A_COMMAND_CONFLICT'); assert.match(e.message, /clashes/);
e = await err('something exploded'); assert.equal(e.code, 'UNCLASSIFIED'); assert.equal(e.status, 'Failed');
e = await err('R1C_UPLOAD_PENDING'); assert.equal(e.status, 'Failed', 'UploadPending is not ported');
// Job Sold (submit_presale / canonical) refusals.
e = await err('REQUIRED_SALESPERSON_ID'); assert.equal(e.status, 'ActionRequired'); assert.equal(e.field, 'salesperson_id'); assert.equal(e.message, 'The salesperson is required. Add it and try again.');
e = await err('INVALID_POSTCODE', null, 'customer.postcode'); assert.equal(e.status, 'ActionRequired'); assert.equal(e.field, 'customer.postcode'); assert.match(e.message, /postcode isn't valid/);
e = await err('TOO_LONG_NOTES'); assert.equal(e.status, 'ActionRequired'); assert.match(e.message, /too long/);
e = await err('TASK_ASSIGNMENT_CONFIG'); assert.equal(e.status, 'Failed'); assert.match(e.message, /setup needs attention/);
e = await err('STALE_VERSION'); assert.equal(e.status, 'ActionRequired');
e = await err('PERMISSION_DENIED'); assert.match(e.message, /permission/);
const res = async (t, x) => (await one(`select public.describe_command_result($1, $2::jsonb) r`, [t, x])).r;
let s = await res('TASK_COMPLETE', { status: 'FollowUpRequired', task: { status: 'Waiting', blocking_reason: 'PRE01_INVOICE_SEND_FAILED', next_followup_at: '2026-09-21T08:00:00Z' } });
assert.equal(s.status, 'FollowUpRequired'); assert.equal(s.heading, 'SAVED – FOLLOW-UP NEEDED');
assert.equal(s.message, 'Saved. The deposit invoice was not sent, so this task is waiting for follow-up. Next follow-up: 21 Sep 2026.');
s = await res('TASK_COMPLETE', { status: 'Completed', task: { status: 'Complete' }, readiness: { stage_advanced: true, workflow_stage: 'ReadyToBook' } });
assert.equal(s.message, 'Task completed successfully. The job is now Ready to Book.');
s = await res('SUBMIT_PRESALE', sold2);
assert.equal(s.message, `New job created: ${sold2.job_ref}.`); assert.deepEqual(s.extras, { result_job_id: job2, result_job_ref: sold2.job_ref });
s = await res('TASK_REOPEN', { ok: true, replayed: true, result: { status: 'Reopened', readiness: { stage_demoted: true } } });
assert.equal(s.message, 'Task reopened. It is back in the task list.'); assert.equal(s.replay, true);
s = await res('MOVE_JOB', { status: 'NeedsReview', reason: 'S11_CAPACITY_EXCEEDED' });
assert.equal(s.status, 'ActionRequired'); assert.equal(s.message, 'The move needs checking before it can go ahead: capacity exceeded.');
s = await res('CANCEL_JOB', { status: 'Cancelled', review: ['x'] }); assert.equal(s.message, 'Job cancellation recorded. Some items need review.');
s = await res('SOMETHING_ELSE', { status: 'Blocked' }); assert.equal(s.status, 'ActionRequired');
s = await res('CONFIRM_BOOKING', { status: 'Booked' }); assert.match(s.message, /^Booking confirmed/);
// Real round trip: a refused command described.
const refused = await cmd('store', { command_id: id(), command_type: 'BOOKING_GATES', job_id: job, expected_version: 1 });
assert.equal(refused.error, 'R1A_ROLE_DENIED'); assert.equal((await err(refused.error)).status, 'Failed');

// ---------------------------------------------------------------- RLS on the port's tables
async function exec(who, sql, p = []) {
  await as(who);
  await db.query(`set role authenticated`);
  try { return await db.query(sql, p); } catch (x) { return { error: x.message }; } finally { await db.query(`reset role`); }
}
const count = async (who, table, where = 'true', p = []) => {
  const r = await exec(who, `select count(*)::int n from public.${table} where ${where}`, p); return r.error ? r : r.rows[0].n; };

// Job-owned rows follow the canonical jobs policy (office class: job.read.all).
assert.equal(await count('tanya', 'issues'), 1); assert.equal(await count('hannah', 'issues'), 1);
assert.equal(await count('store', 'issues'), 0); assert.equal(await count('inst_a', 'issues'), 0);
assert.equal(await count('ghost', 'issues'), 0); assert.equal(await count(null, 'issues'), 0);
assert.ok(await count('tanya', 'invoice_stages') >= 2); assert.equal(await count('inst_a', 'invoice_stages'), 0);
assert.equal(await count('sam', 'invoice_stages', 'job_id = $1', [job]), (await one(`select count(*)::int n from public.invoice_stages where job_id=$1`, [job])).n, 'surveyor sees own sold job');
assert.equal(await count('tanya', 'scaffold_bookings'), 1); assert.equal(await count('store', 'scaffold_bookings'), 0);
// Task history follows the canonical tasks policy.
assert.equal(await count('tanya', 'task_events', 'task_id = $1', [bkg]), 1);
assert.equal(await count('inst_a', 'task_events'), 0);
// Installers: allocated packages, own + crew active allocations.
assert.equal(await count('inst_a', 'work_packages'), 1); assert.equal(await count('inst_a', 'allocations'), 1);
assert.equal(await count('inst_b', 'allocations'), 1, 'own (inactive) allocation row');
assert.equal(await count('inst_b', 'work_packages'), 0);
assert.equal(await count('tanya', 'work_packages'), 4); assert.equal(await count('tanya', 'allocations'), 2);
// Reference data for any active actor; nothing for unknown users.
assert.equal(await count('inst_a', 'release_modes'), 20); assert.equal(await count('ghost', 'release_modes'), 0);
assert.equal(await count('store', 'companies'), 1);
// Journals / settings / intake: admin only (office managers see Intake Review rows).
assert.equal(await count('tanya', 'settings'), 0); assert.ok(await count('ben', 'settings') > 0);
assert.equal(await count('tanya', 'intake'), 1); assert.equal(await count('hannah', 'intake'), 0); assert.equal(await count('ben', 'intake'), 1);
assert.equal(await count('tanya', 'outbox'), 0);
// anon has no privileges on the port's tables.
await db.query(`set role anon`);
await assert.rejects(db.query(`select count(*) from public.issues`), /permission denied/);
await db.query(`reset role`);

// Direct writes: configuration only.
let x = await exec('ben', `insert into public.holidays (local_date, description, office_closed) values ('2026-12-25','Christmas', true) returning created_by, version`);
assert.ok(!x.error, x.error); assert.equal(x.rows[0].created_by, people.ben); assert.equal(x.rows[0].version, 1);
x = await exec('tanya', `insert into public.holidays (local_date, description, office_closed) values ('2026-12-26','Boxing', true)`);
assert.match(x.error, /row-level security/);
x = await exec('tanya', `insert into public.person_availability (person_id, type, from_date, to_date) values ($1,'Leave','2026-10-01','2026-10-02') returning id`, [people.inst_a]);
assert.ok(!x.error, x.error);
x = await exec('hannah', `insert into public.person_availability (person_id, type, from_date, to_date) values ($1,'Leave','2026-10-01','2026-10-02')`, [people.inst_a]);
assert.match(x.error, /row-level security/);
assert.equal(await count('inst_a', 'person_availability'), 1); assert.equal(await count('inst_b', 'person_availability'), 0);
x = await exec('ben', `update public.companies set notes = 'x' where id = $1 returning version, updated_by`, [scaffCo]);
assert.equal(x.rows[0].version, 2); assert.equal(x.rows[0].updated_by, people.ben);
x = await exec('tanya', `update public.companies set notes = 'hacked' where id = $1`, [scaffCo]);
assert.equal(x.affectedRows ?? 0, 0, 'office cannot update companies');
x = await exec('ben', `insert into public.settings (key, typed_value, scope, version, effective_from, changed_by) values ('x.y','1','Global',1,'2026-01-01',$1)`, [people.ben]);
assert.ok(!x.error, x.error);
x = await exec('ben', `insert into public.settings (key, typed_value, scope, version, effective_from, changed_by) values ('x.y','2','Global',2,'2026-01-01',$1)`, [people.tanya]);
assert.match(x.error, /row-level security/, 'setting attributed to its author');
x = await exec('ben', `update public.settings set reason = 'x' where key = 'x.y'`); assert.match(x.error, /permission denied/);
for (const [who, sql] of [['ben', `update public.issues set description = 'x'`], ['ben', `delete from public.holidays`],
  ['tanya', `insert into public.work_packages (job_id, required, commissioning_required, sequence, trade) values ('${job}', true, false, 9, 'Roof')`],
  ['ben', `insert into public.calls (job_id, type, outcome) values ('${job}','Customer','Other')`]]) {
  x = await exec(who, sql); assert.match(x.error, /permission denied/, sql);
}
// Canonical tables are untouched by this module (their own policies apply).
assert.equal((await one(`select count(*)::int n from pg_policies where schemaname='public' and tablename in ('jobs','tasks','people','customers','audit_events') and policyname not in ('jobs_select','tasks_select','people_select','people_insert','people_update','customers_select','audit_events_select')`)).n, 0);
// Readers can call the result catalogue and execute_read; anon cannot.
await as('tanya'); await db.query(`set role authenticated`);
assert.equal((await db.query(`select public.describe_command_error('R1A_STALE_VERSION') r`)).rows[0].r.status, 'ActionRequired');
assert.equal((await db.query(`select public.execute_read('{"read_type":"MY_TASKS"}') r`)).rows[0].r.ok, true);
await db.query(`reset role`); await db.query(`set role anon`);
await assert.rejects(db.query(`select public.execute_read('{"read_type":"WHO_AM_I"}')`), /permission denied/);
await db.query(`reset role`);

console.log('t_s17 OK');
