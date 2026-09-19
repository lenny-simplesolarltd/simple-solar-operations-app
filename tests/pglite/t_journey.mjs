// Cross-module R1 journey: Sold -> ReadyToBook -> Booking -> Booked -> calls -> OperationallyComplete,
// then a second job cancelled and reinstated. Run with PORT_ALL=1.
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok } = f;
const job_ = async (job) => one(`select * from public.jobs where id=$1`, [job]);
const task = async (job, code) => one(`select * from public.tasks where job_id=$1 and template_code=$2`, [job, code]);

const { job, jobRef } = await readyToBook(f);
let j = await job_(job);
let r = ok(await cmd('tanya', { command_id: id(), command_type: 'BOOKING_INTAKE', job_id: job, expected_version: j.version, payload: {
  customer_first_name: 'Ann', customer_last_name: 'Smith', street_address: '1 High St', city: 'Leeds', postcode: 'LS1 1AA',
  cost: '5000', finance_route: 'Standard', date_roofer: '2026-10-06', date_sparky: '2026-10-08',
  roofer: people.inst_a, sparky: people.inst_b, mat_panel_515: 12 } }), 'booking');
assert.equal(r.status, 'Processed', JSON.stringify(r.review_reasons)); assert.equal(r.workflow_stage, 'BookingInProgress');
assert.deepEqual(r.helper_tasks_completed, []); // PRE-COPY-JOBID is not created on the canonical sale path
console.log('booking', jobRef, r.status, 'tasks', JSON.stringify(r.booking_tasks.created));

// Reads see the booking
r = ok(await (async () => { await f.as('tanya'); return (await db.query(`select public.execute_read($1::jsonb) r`, [{ read_type: 'ACTION_AVAILABILITY', job_id: job }])).rows[0].r; })(), 'avail') ?? null;

for (const code of ['BKG01', 'BKG02', 'BKG03']) {
  const t = await task(job, code);
  ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: `${code} done` } }), code);
}
j = await job_(job);
r = ok(await cmd('tanya', { command_id: id(), command_type: 'CONFIRM_BOOKING', job_id: job, expected_version: j.version }), 'confirm');
assert.equal(r.status, 'Booked'); assert.deepEqual(r.tasks_created, ['BKG04', 'BKG05']);

// Work done: actual ends recorded; schedules raise INS01 per package
await db.query(`update public.work_packages set actual_start=planned_start, actual_end=planned_end where job_id=$1`, [job]);
let sch = (await one(`select app.s10_run_schedules('2026-10-12T12:00:00Z') r`)).r;
assert.equal(sch.installer_calls.created, 2, JSON.stringify(sch));
for (const t of await all(`select * from public.tasks where job_id=$1 and template_code='INS01'`, [job])) {
  ok(await cmd('tanya', { command_id: id(), command_type: 'CALL_RECORD', job_id: job, task_id: t.id, expected_version: t.version,
    payload: { type: 'Installer', outcome: 'Complete', actual_completion_confirmed: true } }), 'ins01');
}
sch = (await one(`select app.s10_run_schedules('2026-10-13T12:00:00Z') r`)).r;
assert.equal(sch.customer_calls.created, 1);
const ins04 = await task(job, 'INS04');
ok(await cmd('tanya', { command_id: id(), command_type: 'CALL_RECORD', job_id: job, task_id: ins04.id, expected_version: ins04.version,
  payload: { type: 'Customer', outcome: 'Complete', customer_happy: true } }), 'ins04');

// Commissioning: the office records the current-process evidence (COMMISSIONING_RECORD, R1).
for (const wp of await all(`select * from public.work_packages where job_id=$1 and commissioning_required`, [job])) {
  ok(await cmd('tanya', { command_id: id(), command_type: 'COMMISSIONING_RECORD', job_id: job, work_package_id: wp.id,
    expected_version: wp.version, payload: { evidence_path: `${job}/${wp.trade}-cert.pdf`, reference: `CERT-${wp.trade}` } }), 'commissioning');
}
j = await job_(job);
r = ok(await cmd('tanya', { command_id: id(), command_type: 'OPERATIONAL_COMPLETE', job_id: job, expected_version: j.version }), 'opc');
assert.equal(r.status, 'Completed', JSON.stringify(r));
j = await job_(job);
assert.equal(j.workflow_stage, 'OperationallyComplete');
assert.ok(await one(`select 1 x from public.invoice_stages where job_id=$1 and stage='Balance'`, [job]));
assert.ok(await task(job, 'GHL01'));
console.log('job 1 OperationallyComplete');

// Second job: cancel then close, reinstate, complete reopen review
const second = await readyToBook(f);
j = await job_(second.job);
r = ok(await cmd('tanya', { command_id: id(), command_type: 'CANCEL_JOB', job_id: second.job, expected_version: j.version, payload: {
  reason: 'Customer withdrew', effective_date: '2026-09-20', work_performed: 'None', material_state: 'None', scaffold_state: 'None',
  finance_review: 'Refund deposit', legacy_state: 'None' } }), 'cancel');
j = await job_(second.job);
assert.equal(j.workflow_stage, 'CancellationInProgress');
const open = await all(`select id, template_code, version from public.tasks where job_id=$1 and task_group='Cancellation' and status in ('Open','Blocked')`, [second.job]);
console.log('cancellation tasks', open.map(t => t.template_code).join(','));
r = ok(await cmd('tanya', { command_id: id(), command_type: 'CANCELLATION_CLOSE', job_id: second.job, expected_version: j.version, payload: {
  reason: 'All obligations tracked', tracked_obligations: open.map(t => ({ task_id: t.id, reference: 'tracked', reason: 'handled offline' })) } }), 'close');
j = await job_(second.job);
assert.equal(j.workflow_stage, 'Cancelled');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'REINSTATE_JOB', job_id: second.job, expected_version: j.version, payload: {
  reason: 'Customer back', new_date: '2026-11-02', commitment_review: 'ok', finance_review: 'ok', evidence_reference: 'EMAIL-1', risk_review: 'Deposit held; contract re-issued' } }), 'reinstate');
j = await job_(second.job);
assert.equal(j.workflow_stage, 'Prebooking');
const rr = await task(second.job, 'S15-REOPEN-REVIEW');
ok(await cmd('tanya', { command_id: id(), command_type: 'REOPEN_REVIEW_COMPLETE', job_id: second.job, task_id: rr.id, expected_version: rr.version, payload: { note: 'reviewed' } }), 'reopen review');
j = await job_(second.job);
r = await cmd('tanya', { command_id: id(), command_type: 'BOOKING_GATES', job_id: second.job, expected_version: j.version });
console.log('after reinstatement BOOKING_GATES ->', r.error ?? r.result.status, (r.result?.readiness?.gates ?? []).filter(g => !g.pass).map(g => g.name).join(','));

// describe helpers
console.log((await one(`select public.describe_command_error('R1A_STALE_VERSION', 'cmd-x') r`)).r.message);
const c = await one(`select (select count(*) from public.audit_events)::int a, (select count(*) from public.commit_journal)::int j`);
console.log('audit rows', c.a, 'journal', c.j);
console.log('JOURNEY PASS');
