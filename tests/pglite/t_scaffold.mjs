// R2 scaffold commitments (FN-04). Run:
//   PORT_EXTRA=20260919163000_r2_scaffold.sql node t_scaffold.mjs
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok, as } = f;

const iso = v => v instanceof Date ? v.toISOString() : v;
const dstr = v => v instanceof Date ? v.toISOString().slice(0, 10) : v;
const jobRow = job => one(`select * from public.jobs where id=$1`, [job]);
const bookingOf = job => one(`select * from public.scaffold_bookings where job_id=$1 and status <> 'Cancelled'`, [job]);
const tasksOf = async b => (await all(`select template_code, status from public.tasks where related_entity_type='ScaffoldBookings' and related_entity_id=$1 order by template_code, created_at`, [b])).map(t => t.template_code + ':' + t.status);
const taskByKey = k => one(`select * from public.tasks where instance_key=$1`, [k]);
const opread = async (who, req) => { await as(who); try { return (await db.query(`select public.execute_operations_read($1::jsonb) r`, [req])).rows[0].r; } catch (e) { return { error: e.message, detail: e.detail }; } };
const snapshot = async () => {
  const out = {};
  for (const t of ['jobs', 'scaffold_bookings', 'communications', 'communication_jobs', 'acknowledgements', 'issues', 'issue_events',
                   'tasks', 'task_events', 'audit_events', 'commands', 'companies', 'contacts', 'outbox']) {
    out[t] = (await all(`select to_jsonb(x)::text r from public.${t} x`)).map(r => r.r).sort();
  }
  return JSON.stringify(out);
};
const refuses = async (who, req, code) => {
  const before = await snapshot();
  const r = await cmd(who, req);
  assert.equal(r.error, code, JSON.stringify(r));
  assert.equal(await snapshot(), before, 'refusal wrote something: ' + code);
  return r;
};
const C = (type, job, payload, extra = {}) => ({ command_id: id(), command_type: type, ...(job ? { job_id: job } : {}), ...extra, payload });
const londonDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(ms));
const tomorrow = londonDay(Date.now() + 86400000 * 2);

// Registered and in the command list.
assert.ok((await one(`select app.command_types() t`)).t.includes('SCAFFOLD_REQUEST'));
for (const code of ['SCA01', 'SCA02', 'SCA03', 'SCA04', 'SCA05'])
  assert.equal((await one(`select app.rule_owner($1) o`, [code])).o, people.tanya, 'assignment rule ' + code);

// ---------------------------------------------------------------------------
// 1. Scaffolder configuration (Admin; not FN-04 gated)
// ---------------------------------------------------------------------------
await refuses('tanya', C('SCAFFOLDER_CONFIGURE', null, { name: 'Acme Scaffolding' }), 'R1A_ROLE_DENIED');
await refuses('ben', C('SCAFFOLDER_CONFIGURE', null, { name: 'Acme', standard_lead_days: 99 }), 'SCF_REVIEW: standard_lead_days 0-60');
const cfgReq = C('SCAFFOLDER_CONFIGURE', null, { name: 'Acme Scaffolding', standard_lead_days: 5,
  contact: { name: 'Pat', email: 'Pat@Acme.example', phone: '01132 000000' } });
let r = ok(await cmd('ben', cfgReq), 'configure');
assert.equal(r.status, 'Created'); assert.equal(r.company.type, 'Scaffolder'); assert.equal(r.contact.email, 'pat@acme.example');
const acme = r.company_id;
assert.equal((await cmd('ben', cfgReq)).replayed, true);
assert.equal((await cmd('ben', { ...cfgReq, payload: { name: 'Other' } })).error, 'R1A_COMMAND_CONFLICT');
const merchant = (await one(`insert into public.companies (name, type) values ('Greentech', 'Merchant') returning id`)).id;
await refuses('ben', C('SCAFFOLDER_CONFIGURE', null, { company_id: merchant, name: 'Greentech' }), 'SCF_REFUSED: company exists with another type');
r = ok(await cmd('ben', C('SCAFFOLDER_CONFIGURE', null, { company_id: acme, name: 'Acme Scaffolding Ltd', standard_lead_days: 5, contact: { name: 'pat', phone: '0113' } })), 'update');
assert.equal(r.status, 'Updated'); assert.equal(r.company.version, 2); assert.equal(r.contact.email, null, 'same contact updated (natural key)');
assert.equal((await one(`select count(*)::int n from public.contacts where company_id=$1`, [acme])).n, 1);
let sc = await opread('tanya', { read_type: 'SCAFFOLDERS' });
assert.deepEqual(sc.data.map(x => [x.name, x.configured, x.contacts[0].email]), [['Acme Scaffolding Ltd', false, 'NOT_CONFIGURED']]);
ok(await cmd('ben', C('SCAFFOLDER_CONFIGURE', null, { company_id: acme, name: 'Acme Scaffolding', standard_lead_days: 5, contact: { name: 'Pat', email: 'pat@acme.example' } })), 'restore');

// ---------------------------------------------------------------------------
// 2. Job 1: booking intake records a Planned scaffold booking; SCAFFOLD_REQUEST adopts it
// ---------------------------------------------------------------------------
const { job: job1 } = await readyToBook(f);
let j = await jobRow(job1);
ok(await cmd('tanya', { command_id: id(), command_type: 'BOOKING_INTAKE', job_id: job1, expected_version: j.version,
  payload: { date_roofer: '2027-03-10', date_scaffold: '2027-03-08', scaffold_company: 'acme scaffolding', scaffold_notes: 'Side gate' } }), 'intake');
let b = await bookingOf(job1);
assert.deepEqual([b.status, b.company_id, dstr(b.erect_planned_at)], ['Planned', acme, '2027-03-08']);
const intakeBookingId = b.id;

// Requirement read: required, intake booking ready to request.
let rq = await opread('tanya', { read_type: 'SCAFFOLD_REQUIREMENT', job_id: job1 });
assert.equal(rq.data.summary, 'Ready'); assert.equal(rq.data.existing_booking_id, b.id); assert.equal(rq.data.erect_date_source, 'booking_intake');

// Mode gate before FN-04 is enabled.
j = await jobRow(job1);
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, {}, { expected_version: j.version }), 'R1A_MODE_DENIED');
await db.query(`update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id='FN-04'`);
await refuses('store', C('SCAFFOLD_REQUEST', job1, {}, { expected_version: j.version }), 'R1A_ROLE_DENIED');
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, {}, { expected_version: j.version + 1 }), 'SCF_STALE: version');
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, { erect_planned_at: '2027-13-40' }, { expected_version: j.version }), 'SCF_DATE_INVALID');
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, { strip_forecast_at: '2027-03-01' }, { expected_version: j.version }), 'SCF_REVIEW: strip forecast before erect');
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, { company_id: merchant }, { expected_version: j.version }), 'SCF_REVIEW: active Scaffolder company required');
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, { quoted_cost_pence: -5 }, { expected_version: j.version }), 'SCF_REVIEW: quoted_cost_pence must be a non-negative integer');
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, { bogus: 1 }, { expected_version: j.version }), 'R1A_INVALID_FIELDS');

const reqCmd = C('SCAFFOLD_REQUEST', job1, { strip_forecast_at: '2027-03-29', quoted_cost_pence: 85000, scope_file_id: `${job1}/scope.pdf` }, { expected_version: j.version });
r = ok(await cmd('tanya', reqCmd), 'request');
assert.equal(r.status, 'Requested'); assert.equal(r.adopted_intake_booking, true); assert.equal(r.erect_date_source, 'booking_intake');
assert.equal(r.booking.id, intakeBookingId, 'no parallel booking');
assert.equal(r.external_calls, 0);
assert.equal((await one(`select count(*)::int n from public.scaffold_bookings where job_id=$1`, [job1])).n, 1);
b = await bookingOf(job1);
assert.deepEqual([b.status, b.revision, b.confirmed_revision, Number(b.quoted_cost_pence), b.access_notes], ['Requested', 1, null, 85000, 'Side gate']);
let t = await taskByKey(`SCA01-${b.id}-R1`);
assert.equal(t.owner_id, people.tanya); assert.equal(t.job_id, job1); assert.equal(t.priority, 1);
assert.equal(iso(t.due_at), '2027-03-03T09:00:00.000Z', 'erect Mon 8 Mar - 5 lead = Wed 3 Mar 09:00 London (GMT)');
assert.match(t.title, /^Notify and confirm scaffolder erect — Acme Scaffolding erect 2027-03-08$/);
let comm = await one(`select * from public.communications where id=$1`, [r.communication.communication_id]);
assert.deepEqual([comm.type, comm.status, comm.revision, comm.sent_at, comm.outbox_id], ['ScaffoldInstruction', 'Draft', 1, null, null]);
assert.deepEqual(comm.attachment_ids, [`${job1}/scope.pdf`]);
assert.equal(JSON.parse(comm.recipients_snapshot)[0].email, 'pat@acme.example');
assert.equal(JSON.parse(comm.body_snapshot).note, 'CAPTURED DRAFT — not sent. FN-04 R2.');
assert.equal((await one(`select scaffold_booking_id from public.communication_jobs where communication_id=$1`, [comm.id])).scaffold_booking_id, b.id);
// replay / conflict / second request
assert.equal((await cmd('tanya', reqCmd)).replayed, true);
assert.equal((await cmd('tanya', { ...reqCmd, payload: { ...reqCmd.payload, quoted_cost_pence: 1 } })).error, 'R1A_COMMAND_CONFLICT');
j = await jobRow(job1);
await refuses('tanya', C('SCAFFOLD_REQUEST', job1, {}, { expected_version: j.version }), 'SCF_REVIEW: job already has an active scaffold booking');
rq = await opread('tanya', { read_type: 'SCAFFOLD_REQUIREMENT', job_id: job1 });
assert.equal(rq.data.summary, 'AlreadyBooked');

// ---------------------------------------------------------------------------
// 3. Confirm erect (acknowledgement of the current revision)
// ---------------------------------------------------------------------------
const bref = (job, payload, version, type) => C(type, job, payload, { expected_version: version });
await refuses('tanya', bref(job1, { booking_id: b.id }, b.version + 1, 'SCAFFOLD_CONFIRM_ERECT'), 'SCF_STALE: version');
await refuses('tanya', bref(job1, { booking_id: id() }, b.version, 'SCAFFOLD_CONFIRM_ERECT'), 'SCF_REVIEW: scaffold booking not found');
r = ok(await cmd('tanya', bref(job1, { booking_id: b.id, response_text: 'Confirmed by phone' }, b.version, 'SCAFFOLD_CONFIRM_ERECT')), 'confirm');
assert.equal(r.status, 'Confirmed'); assert.equal(r.booking.confirmed_revision, 1);
assert.deepEqual(await tasksOf(b.id), ['SCA01:Complete', 'SCA02:Open']);
t = await taskByKey(`SCA02-${b.id}-R1`);
assert.equal(iso(t.due_at), '2027-03-08T17:00:00.000Z', 'erect day end 17:00 London');
let acks = await all(`select * from public.acknowledgements where entity_id=$1 order by created_at`, [b.id]);
assert.deepEqual(acks.map(a => [a.acknowledged_revision, a.response, a.response_text, a.recorded_by]), [[1, 'Confirmed', 'Confirmed by phone', people.tanya]]);
let view = await opread('tanya', { read_type: 'SCAFFOLD_BOOKING', booking_id: b.id });
assert.equal(view.data.acknowledgement_required, false); assert.equal(view.data.next_action, 'Record actual erect (SCA02)');

// ---------------------------------------------------------------------------
// 4. Change dates -> new revision, re-acknowledgement
// ---------------------------------------------------------------------------
b = await bookingOf(job1);
await refuses('tanya', bref(job1, { booking_id: b.id, erect_planned_at: '2027-03-15' }, b.version, 'SCAFFOLD_CHANGE_DATES'), 'SCF_REVIEW: reason required');
await refuses('tanya', bref(job1, { booking_id: b.id, strip_planned_at: '2027-03-30', reason: 'x' }, b.version, 'SCAFFOLD_CHANGE_DATES'), 'SCF_REVIEW: strip not yet authorised');
r = ok(await cmd('tanya', bref(job1, { booking_id: b.id, erect_planned_at: '2027-03-15', reason: 'Roof moved a week' }, b.version, 'SCAFFOLD_CHANGE_DATES')), 'move');
assert.equal(r.revision, 2); assert.equal(r.status, 'Requested'); assert.equal(r.acknowledgement_required, true);
b = await bookingOf(job1);
assert.equal(b.confirmed_revision, 1); assert.equal(dstr(b.erect_planned_at), '2027-03-15');
assert.deepEqual(await tasksOf(b.id), ['SCA01:Complete', 'SCA01:Open', 'SCA02:Open']);
assert.equal(iso((await taskByKey(`SCA01-${b.id}-R2`)).due_at), '2027-03-10T09:00:00.000Z');
view = await opread('tanya', { read_type: 'SCAFFOLD_BOOKING', booking_id: b.id });
assert.equal(view.data.acknowledgement_required, true); assert.equal(view.data.communications.length, 2);
r = ok(await cmd('tanya', bref(job1, { booking_id: b.id }, b.version, 'SCAFFOLD_CONFIRM_ERECT')), 'reconfirm');
assert.equal(r.booking.confirmed_revision, 2);
acks = await all(`select acknowledged_revision from public.acknowledgements where entity_id=$1 order by acknowledged_revision`, [b.id]);
assert.deepEqual(acks.map(a => a.acknowledged_revision), [1, 2]);

// ---------------------------------------------------------------------------
// 5. Record erected; cancel refused once erected; strip gates
// ---------------------------------------------------------------------------
b = await bookingOf(job1);
await refuses('tanya', bref(job1, { booking_id: b.id, erect_actual_at: tomorrow }, b.version, 'SCAFFOLD_RECORD_ERECTED'), 'SCF_REVIEW: erect_actual_at cannot be in the future');
await refuses('tanya', bref(job1, { booking_id: b.id }, b.version, 'SCAFFOLD_RECORD_ERECTED'), 'SCF_REVIEW: erect_actual_at required');
r = ok(await cmd('tanya', bref(job1, { booking_id: b.id, erect_actual_at: '2026-09-01' }, b.version, 'SCAFFOLD_RECORD_ERECTED')), 'erected');
assert.equal(r.status, 'Erected'); assert.equal(r.late, false);
assert.deepEqual(await tasksOf(b.id), ['SCA01:Complete', 'SCA01:Complete', 'SCA02:Complete', 'SCA02:Complete']);
b = await bookingOf(job1);
assert.equal(dstr(b.erect_planned_at), '2027-03-15', 'planned kept separate from actual');
await refuses('tanya', bref(job1, { booking_id: b.id, reason: 'x' }, b.version, 'SCAFFOLD_CANCEL'), 'SCF_REFUSED: scaffold is erected; arrange safe strip and confirm removal instead of cancelling');
await refuses('tanya', bref(job1, { booking_id: b.id, erect_planned_at: '2027-03-16', reason: 'x' }, b.version, 'SCAFFOLD_CHANGE_DATES'), 'SCF_REVIEW: scaffold already erected; erect date cannot move');
await refuses('tanya', bref(job1, { booking_id: b.id, strip_planned_at: '2026-09-10' }, b.version, 'SCAFFOLD_PLAN_STRIP'), 'SCF_REVIEW: strip must be authorised before planning (status Erected)');
await refuses('tanya', bref(job1, { booking_id: b.id }, b.version, 'SCAFFOLD_CONFIRM_STRIP'), 'SCF_REVIEW: strip must be planned before confirmation');

// Blocked authorisation is a refusal that writes nothing (retryable with the same command id).
const authCmd = bref(job1, { booking_id: b.id }, b.version, 'SCAFFOLD_AUTHORISE_STRIP');
r = await refuses('tanya', authCmd, 'SCF_STRIP_BLOCKED');
assert.deepEqual(JSON.parse(r.detail).blockers, ['CUSTOMER_NOT_HAPPY']);
await db.query(`update public.jobs set customer_happy_at = now(), customer_happy_by = $2 where id=$1`, [job1, people.tanya]);

// Complaint (unsafe) blocks the strip.
await refuses('tanya', C('SCAFFOLD_COMPLAINT', job1, { booking_id: b.id, category: 'Rude', description: 'x' }), 'SCF_REVIEW: category must be one of MissedAppointment/Access/Damage/UnsafeConcern/Other');
await refuses('tanya', C('SCAFFOLD_COMPLAINT', job1, { booking_id: b.id, category: 'Access' }), 'SCF_REVIEW: description required');
const cmp1 = ok(await cmd('tanya', C('SCAFFOLD_COMPLAINT', job1, { booking_id: b.id, category: 'UnsafeConcern', description: 'Loose board on lift 2' })), 'complaint');
assert.equal(cmp1.blocks_strip, true);
let issue = await one(`select * from public.issues where id=$1`, [cmp1.issue_id]);
assert.deepEqual([issue.type, issue.responsible_company_id, issue.severity, issue.office_owner_id, issue.status], ['Complaint', acme, 'High', people.tanya, 'Open']);
b = await bookingOf(job1);
assert.deepEqual(b.related_issue_ids, [cmp1.issue_id]);
r = await refuses('tanya', { ...authCmd, expected_version: b.version }, 'SCF_STRIP_BLOCKED');
assert.deepEqual(JSON.parse(r.detail).blockers, [`STRIP_BLOCKING_ISSUES:${cmp1.issue_id}`]);
await db.query(`update public.issues set status='Resolved', resolved_at=now() where id=$1`, [cmp1.issue_id]);
const cmp2 = ok(await cmd('tanya', C('SCAFFOLD_COMPLAINT', job1, { booking_id: b.id, category: 'Damage', description: 'Gutter dent' })), 'complaint 2');
assert.equal(cmp2.blocks_strip, false);
b = await bookingOf(job1);
// Same command id as the blocked attempt now authorises (REF-04 §7 fix); needs the current version.
r = ok(await cmd('tanya', { ...authCmd, expected_version: b.version }), 'authorise');
assert.equal(r.status, 'StripAuthorised'); assert.equal(r.booking.strip_authorised_by, people.tanya);
const nextStaffed = (await one(`select app.scf_day_start(app.next_staffed_date(now())) d`)).d;
assert.equal(iso((await taskByKey(`SCA03-${b.id}-R2`)).due_at), iso(nextStaffed));

// Plan / confirm / record strip
b = await bookingOf(job1);
await refuses('tanya', bref(job1, { booking_id: b.id, strip_planned_at: '2026-08-01' }, b.version, 'SCAFFOLD_PLAN_STRIP'), 'SCF_REVIEW: strip before erect');
r = ok(await cmd('tanya', bref(job1, { booking_id: b.id, strip_planned_at: '2026-09-10' }, b.version, 'SCAFFOLD_PLAN_STRIP')), 'plan strip');
assert.equal(r.status, 'StripPlanned'); assert.equal(r.booking.revision, 3); assert.equal(r.acknowledgement_required, true);
comm = await one(`select * from public.communications where id=$1`, [r.communication.communication_id]);
assert.deepEqual([comm.type, comm.revision, comm.status], ['ScaffoldStripInstruction', 3, 'Draft']);
b = await bookingOf(job1);
r = ok(await cmd('tanya', bref(job1, { booking_id: b.id }, b.version, 'SCAFFOLD_CONFIRM_STRIP')), 'confirm strip');
assert.equal(r.status, 'StripConfirmed'); assert.equal(r.booking.confirmed_revision, 3);
assert.equal(iso((await taskByKey(`SCA04-${b.id}-R3`)).due_at), '2026-09-10T16:00:00.000Z', '17:00 London BST');
b = await bookingOf(job1);
await refuses('tanya', bref(job1, { booking_id: b.id, strip_actual_at: '2026-08-15' }, b.version, 'SCAFFOLD_RECORD_STRIPPED'), 'SCF_REVIEW: strip before erect');
await refuses('tanya', bref(job1, { booking_id: b.id, strip_actual_at: tomorrow }, b.version, 'SCAFFOLD_RECORD_STRIPPED'), 'SCF_REVIEW: strip_actual_at cannot be in the future');
r = ok(await cmd('tanya', bref(job1, { booking_id: b.id, strip_actual_at: '2026-09-10', actual_cost_pence: 90000, invoice_reference: 'ACME-1' }, b.version, 'SCAFFOLD_RECORD_STRIPPED')), 'stripped');
assert.equal(r.status, 'Stripped'); assert.deepEqual(r.open_complaints, [cmp2.issue_id]); assert.equal(r.late, false);
assert.equal((await one(`select status from public.issues where id=$1`, [cmp2.issue_id])).status, 'Open', 'actual strip never closes a complaint');
b = await one(`select * from public.scaffold_bookings where id=$1`, [b.id]);
assert.equal(Number(b.actual_cost_pence), 90000);
assert.deepEqual(await tasksOf(b.id), ['SCA01:Complete', 'SCA01:Complete', 'SCA02:Complete', 'SCA02:Complete', 'SCA03:Complete', 'SCA04:Complete']);
view = await opread('tanya', { read_type: 'SCAFFOLD_BOOKING', booking_id: b.id });
assert.equal(view.data.next_action, 'Complete'); assert.equal(view.data.acknowledgements.length, 3);
assert.equal((await one(`select count(*)::int n from public.outbox`)).n, 0, 'nothing is sent');
assert.equal((await one(`select count(*)::int n from public.communications where status <> 'Draft'`)).n, 0);

// ---------------------------------------------------------------------------
// 6. Job 2: no scaffold detail at booking; erect date from lead days rolled off
//    non-working days; single active scaffolder resolved; weekly list; cancel
// ---------------------------------------------------------------------------
const { job: job2 } = await readyToBook(f);
j = await jobRow(job2);
ok(await cmd('tanya', { command_id: id(), command_type: 'BOOKING_INTAKE', job_id: job2, expected_version: j.version,
  payload: { date_roofer: '2027-03-11' } }), 'intake 2');
assert.equal(await bookingOf(job2), undefined, 'intake created no booking without scaffold detail');
await db.query(`insert into public.holidays (local_date, description) values ('2027-03-05', 'Test closure')`);
rq = await opread('tanya', { read_type: 'SCAFFOLD_REQUIREMENT', job_id: job2 });
assert.deepEqual([rq.data.summary, rq.data.company_id, rq.data.proposed_erect_date, rq.data.erect_date_source], ['Ready', acme, '2027-03-04', 'lead_days']);
j = await jobRow(job2);
r = ok(await cmd('tanya', C('SCAFFOLD_REQUEST', job2, {}, { expected_version: j.version })), 'request 2');
assert.equal(r.adopted_intake_booking, false); assert.equal(r.erect_date_source, 'lead_days');
assert.equal(r.booking.erect_planned_at, '2027-03-04', 'Thu 11 Mar - 5 = Sat 6 -> Fri 5 closed -> Thu 4');
assert.equal(r.booking.company_id, acme);
const b2 = await bookingOf(job2);
assert.equal(iso((await taskByKey(`SCA01-${b2.id}-R1`)).due_at), '2027-02-26T09:00:00.000Z', 'Thu 4 - 5 = Sat 27 Feb -> Fri 26 Feb');

// Weekly list (Friday list)
const wk = C('SCAFFOLD_WEEKLY_LIST', null, { week_start: '2027-03-03' });
await refuses('tanya', { ...wk, job_id: job2 }, 'R1A_INVALID_FIELDS');
r = ok(await cmd('tanya', wk), 'weekly');
assert.equal(r.week_start, '2027-03-01'); assert.equal(r.lists.length, 1);
const list = r.lists[0];
assert.deepEqual([list.company_id, list.items, list.unacknowledged, list.created], [acme, 1, 1, true]);
comm = await one(`select * from public.communications where id=$1`, [list.communication_id]);
assert.deepEqual([comm.type, comm.status, comm.job_id, dstr(comm.covered_week_start)], ['ScaffoldWeeklyList', 'Draft', null, '2027-03-01']);
assert.equal(JSON.parse(comm.body_snapshot).items[0].kind, 'Erect');
t = await one(`select * from public.tasks where id=$1`, [list.task.task_id]);
assert.deepEqual([t.template_code, t.job_id, iso(t.due_at), t.related_entity_type], ['SCA05', null, '2027-02-26T12:00:00.000Z', 'Communications']);
r = ok(await cmd('tanya', C('SCAFFOLD_WEEKLY_LIST', null, { week_start: '2027-03-07' })), 'weekly again');
assert.equal(r.week_start, '2027-03-08', 'Sunday rolls forward');
r = ok(await cmd('tanya', C('SCAFFOLD_WEEKLY_LIST', null, { week_start: '2027-03-01' })), 'weekly idem');
assert.equal(r.lists[0].created, false); assert.equal(r.lists[0].task.created, false);
assert.equal((await one(`select count(*)::int n from public.communications where type='ScaffoldWeeklyList'`)).n, 1);

// Cancel before erection
b = await bookingOf(job2);
await refuses('tanya', bref(job2, { booking_id: b.id }, b.version, 'SCAFFOLD_CANCEL'), 'SCF_REVIEW: reason required');
await refuses('tanya', bref(job1, { booking_id: b.id, reason: 'x' }, b.version, 'SCAFFOLD_CANCEL'), 'R1A_SCAFFOLD_BOOKING_JOB_MISMATCH');
const canCmd = bref(job2, { booking_id: b.id, reason: 'Customer postponed' }, b.version, 'SCAFFOLD_CANCEL');
r = ok(await cmd('tanya', canCmd), 'cancel');
assert.equal(r.status, 'Cancelled'); assert.equal(r.cancelled_tasks.length, 1); assert.equal(r.booking.revision, 2);
assert.deepEqual(await tasksOf(b.id), ['SCA01:Cancelled']);
assert.equal((await one(`select type from public.communications where id=$1`, [r.communication.communication_id])).type, 'ScaffoldCancellation');
assert.equal((await cmd('tanya', canCmd)).replayed, true);
rq = await opread('tanya', { read_type: 'SCAFFOLD_REQUIREMENT', job_id: job2 });
assert.equal(rq.data.summary, 'Ready', 'a cancelled booking does not count');

// ---------------------------------------------------------------------------
// 7. Two scaffolders: company must be named; chase for a missed erect
// ---------------------------------------------------------------------------
const bravo = ok(await cmd('ben', C('SCAFFOLDER_CONFIGURE', null, { name: 'Bravo Scaffolds', standard_lead_days: 3 })), 'bravo').company_id;
const { job: job3 } = await readyToBook(f);
j = await jobRow(job3);
await refuses('tanya', C('SCAFFOLD_REQUEST', job3, { erect_planned_at: '2026-09-01' }, { expected_version: j.version }), 'SCF_REVIEW: scaffolder company_id required');
r = ok(await cmd('tanya', C('SCAFFOLD_REQUEST', job3, { erect_planned_at: '2026-09-01', company_id: bravo }, { expected_version: j.version })), 'request 3');
const b3 = await bookingOf(job3);
r = ok(await cmd('tanya', C('SCAFFOLD_CHASE', null, {})), 'chase');
assert.equal(r.created.length, 1); assert.equal(r.created[0].code, 'SCA02');
t = await one(`select * from public.tasks where id=$1`, [r.created[0].task_id]);
assert.equal(t.instance_key, `SCA02-${b3.id}-R1-CHASE`); assert.match(t.title, /CHASE: erect planned 2026-09-01 not recorded/);
assert.equal(t.owner_id, people.tanya);
assert.equal(ok(await cmd('tanya', C('SCAFFOLD_CHASE', null, {})), 'chase 2').created.length, 0, 'once per revision');
// Strip chase on job1 is not due (stripped); on a planned strip in the past it is.

// ---------------------------------------------------------------------------
// 8. Not required / cancellation suppression
// ---------------------------------------------------------------------------
const { job: job4 } = await readyToBook(f, { scope: { scaffold_required: false } });
j = await jobRow(job4);
await refuses('tanya', C('SCAFFOLD_REQUEST', job4, {}, { expected_version: j.version }), 'SCF_REVIEW: job does not require scaffold');
rq = await opread('tanya', { read_type: 'SCAFFOLD_REQUIREMENT', job_id: job4 });
assert.equal(rq.data.summary, 'NotRequired');
await db.query(`update public.jobs set cancellation_at = now() where id=$1`, [job3]);
b = await bookingOf(job3);
await refuses('tanya', bref(job3, { booking_id: b.id }, b.version, 'SCAFFOLD_CONFIRM_ERECT'), 'S15_REVIEW: normal work suppressed');
assert.equal((await opread('tanya', { read_type: 'SCAFFOLD_BOOKING', bogus: 1 })).error, 'R1A_INVALID_FIELDS');

// Semantic audit per mutation
const acts = (await all(`select action from public.audit_events where entity_type='ScaffoldBookings' and entity_id=$1 order by occurred_at, id`, [intakeBookingId])).map(a => a.action);
for (const a of ['BookingIntake', 'Request', 'ConfirmErect', 'ChangeDates', 'RecordErected', 'AuthoriseStrip', 'PlanStrip', 'ConfirmStrip', 'RecordStripped'])
  assert.ok(acts.includes(a), 'audit ' + a);

console.log('t_scaffold: all assertions passed');
