import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, people, cmd, id, ok, sell } = f;
const task = async (job, code) => one(`select * from public.tasks where job_id=$1 and template_code=$2`, [job, code]);

// The sale: Job Sold's submit_presale creates customer, job, presale, PRE tasks;
// the backend adds the deposit/interim invoice stages in the same transaction.
const sold = await sell('tanya');
assert.ok(!sold.error, JSON.stringify(sold));
const job = sold.job_id;
console.log('sold', sold.job_ref, 'tasks', sold.tasks.map(t => t.code).join(','));
const dep = await one(`select * from public.invoice_stages where job_id=$1 and stage='Deposit'`, [job]);
assert.equal(Number(dep.gross_pence), 125000); assert.equal(dep.status, 'Pending');
assert.equal(Number((await one(`select gross_pence from public.invoice_stages where job_id=$1 and stage='Interim'`, [job])).gross_pence), 175000);
const pre03 = await task(job, 'PRE03'); assert.equal(pre03.owner_id, people.ben); assert.equal(pre03.backup_id, people.dan);

// PRE01 fail -> Waiting, then complete; envelope/idempotency checks
let t = await task(job, 'PRE01');
const failReq = { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'Xero down', outcome: 'failed' } };
let r = ok(await cmd('tanya', failReq), 'pre01 fail');
assert.equal(r.status, 'FollowUpRequired'); assert.equal(r.task.blocking_reason, 'PRE01_INVOICE_SEND_FAILED');
assert.equal((await cmd('tanya', failReq)).replayed, true);
assert.equal((await cmd('tanya', { ...failReq, payload: { completion_note: 'other', outcome: 'failed' } })).error, 'R1A_COMMAND_CONFLICT');
assert.equal((await cmd('tanya', { ...failReq, command_id: 'not-a-uuid' })).error, 'R1A_INVALID_COMMAND_ID');
assert.equal((await cmd('tanya', { ...failReq, command_id: id(), bogus: 1 })).error, 'R1A_INVALID_FIELDS');
assert.equal((await cmd(null, { ...failReq, command_id: id() })).error, 'R1A_AUTHENTICATED_EMAIL_REQUIRED');
assert.equal((await cmd('store', { ...failReq, command_id: id() })).error, 'R1A_ROLE_DENIED');
t = await task(job, 'PRE01');
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version - 1, payload: { completion_note: 'x' } })).error, 'R1A_STALE_VERSION');
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'sent' } })).error, 'R1A_REQUIRED_INVOICE_NUMBER');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'sent', invoice_number: 'INV-1', invoice_sent: 'yes' } }), 'pre01');
assert.equal(r.status, 'Completed'); assert.equal(r.invoice_stage.status, 'Sent');

// PRE02 awaiting then signed with evidence
t = await task(job, 'PRE02');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'sent to customer', contract_id: 'SIG-1', contract_signed: false } }), 'pre02 sent');
assert.equal(r.status, 'FollowUpRequired'); assert.equal(r.job.contract_status, 'Sent');
t = await task(job, 'PRE02');
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'signed', contract_id: 'SIG-1', contract_signed: true } })).error, 'R1A_REQUIRED_EVIDENCE_ID');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_EVIDENCE_ATTACH', task_id: t.id, expected_version: t.version, payload: { evidence_path: `${job}/contract.pdf` } }), 'attach');
assert.equal(r.status, 'EvidenceUploaded');
t = await task(job, 'PRE02');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'signed', contract_id: 'SIG-1', contract_signed: 'yes' } }), 'pre02');
assert.equal(r.job.contract_status, 'Signed');

// PRE04 mismatch then verify
t = await task(job, 'PRE04');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'value differs', customer_details_verified: 'yes', sold_value_verified: 'yes', verified_gross_amount: '4999' } }), 'pre04 mm');
assert.equal(r.task.blocking_reason, 'PRE04_VALUE_MISMATCH'); assert.equal(r.job.sold_booking_match_status, 'Review');
t = await task(job, 'PRE04');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'ok', customer_details_verified: true, sold_value_verified: true, verified_gross_amount: '£5,000' } }), 'pre04');
assert.equal(r.job.sold_booking_match_status, 'Match'); assert.equal(r.job.workflow_stage, 'Prebooking');

// PRE03: Tanya (assigned, not owner/backup) denied; Ben mismatch then Dan (backup) confirms
t = await task(job, 'PRE03');
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'x' } })).error, 'R1A_TASK_ACCESS_DENIED');
r = ok(await cmd('ben', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'short', deposit_bank_confirmed: 'yes', deposit_amount: '1000', deposit_received_date: '2026-09-01', deposit_bank_reference: 'BANK-1' } }), 'pre03 mm');
assert.equal(r.task.blocking_reason, 'PRE03_DEPOSIT_AMOUNT_MISMATCH'); assert.equal(r.bank_check.outcome, 'AmountMismatch');
t = await task(job, 'PRE03');
r = ok(await cmd('dan', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'received', deposit_bank_confirmed: 'yes', deposit_amount: '1250.00', deposit_received_date: '2026-09-02', deposit_bank_reference: 'BANK-2' } }), 'pre03');
assert.equal(r.status, 'Completed'); assert.equal(r.job.workflow_stage, 'ReadyToBook', JSON.stringify(r.readiness?.gates?.filter(g => !g.pass)));
console.log('ReadyToBook reached; readiness summary:', r.readiness.summary);
assert.equal((await one(`select count(*)::int n from public.audit_events where entity_id=$1 and action='WorkflowStage:ReadyToBook'`, [job])).n, 1);

// Reopen PRE04 -> demoted, history preserved; re-complete -> promoted
t = await task(job, 'PRE04');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_REOPEN', task_id: t.id, expected_version: t.version, payload: { reopen_reason: 'recheck' } }), 'reopen');
assert.equal(r.job.workflow_stage, 'Prebooking'); assert.equal(r.readiness.stage_demoted, true);
assert.equal(r.task.completion_note, 'ok');
t = await task(job, 'PRE04');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'ok again', customer_details_verified: true, sold_value_verified: true, verified_gross_amount: 5000 } }), 'pre04 again');
assert.equal(r.job.workflow_stage, 'ReadyToBook');

// BOOKING_GATES stays ReadyToBook (no booking linked); CONFIRM_BOOKING refuses
let j = await one(`select * from public.jobs where id=$1`, [job]);
r = ok(await cmd('tanya', { command_id: id(), command_type: 'BOOKING_GATES', job_id: job, expected_version: j.version }), 'gates');
assert.equal(r.status, 'ReadyToBook');
j = await one(`select * from public.jobs where id=$1`, [job]);
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'CONFIRM_BOOKING', job_id: job, expected_version: j.version })).error, 'R1A_STAGE_NOT_BOOKING_IN_PROGRESS');
assert.equal((await cmd('dan', { command_id: id(), command_type: 'CONFIRM_BOOKING', job_id: job, expected_version: j.version })).error, 'R1A_ROLE_DENIED');
r = ok(await cmd('dan', { command_id: id(), command_type: 'DEPOSIT_CONFIRM', job_id: job, expected_version: j.version, payload: { reference: 'BANK-2', deposit_bank_confirmed: 'yes', deposit_amount: '1250', deposit_received_date: '2026-09-02' } }), 'dep');
assert.equal(r.status, 'AlreadyConfirmed');
// hannah (VariationApprover) is office-class but not assigned to this job
assert.equal((await cmd('hannah', { command_id: id(), command_type: 'BOOKING_GATES', job_id: job, expected_version: j.version })).error, 'R1A_JOB_ACCESS_DENIED');

// Phoenix route: PRE05 instead of PRE01/PRE03
const ph = await sell('tanya', { sale: { finance_route: 'Phoenix' } });
assert.deepEqual(ph.tasks.map(t => t.code).sort(), ['PRE02', 'PRE04', 'PRE05']);
// release mode off -> refused
await db.query(`update public.release_modes set mode='Disabled' where function_id='FN-01'`);
t = await task(ph.job_id, 'PRE02');
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'x' } })).error, 'R1A_MODE_DENIED');
const counts = await one(`select (select count(*) from public.audit_events)::int a, (select count(*) from public.task_events)::int te, (select count(*) from public.commands)::int c`);
console.log('audit', counts.a, 'task_events', counts.te, 'commands', counts.c);
console.log('PREBOOKING JOURNEY PASS');
