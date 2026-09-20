// Bulk task operations: override completion, batch submit/execute, idempotency,
// concurrency, retry, recovery and the historical invariant.
//
// Fixture roles (fixtures.mjs): tanya=Office, ben=Admin, dan=Director,
// hannah=VariationApprover, store=Store, sam=Surveyor. task.override_complete
// and task.complete.cross_owner are granted to Admin/Manager/Director/Office -
// so tanya, ben and dan hold them and hannah (VariationApprover) does not,
// which is exactly the pair the permission tests need.
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';

const f = await setup();
const { db, one, all, people, cmd, read, id, ok, sell, as } = f;
const task = async (job, code) =>
  one(`select * from public.tasks where job_id=$1 and template_code=$2`, [job, code]);

// A Standard sale creates PRE01-PRE04 only, and every PRE template records a
// business fact, so none of them is completable from a batch under NORMAL
// mode. GHL01 is the realistic note-only case: an aftercare task whose
// completion asks for nothing but a note (app.cmd_task_complete's else-branch).
let seq = 0;
async function noteOnlyTask(job, owner = people.tanya) {
  seq += 1;
  return one(
    `insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id,
                               status, created_rule_version)
     select $1, 'GHL01', 'test-ghl01-' || $2::text, t.task_group, t.title, $3, 'Open', t.template_version
     from public.task_templates t where t.code='GHL01' returning *`,
    [job, `${job}-${seq}`, owner]);
}
// Registry reads (BATCH_*) are served by execute_operations_read; the
// fixture's read() is the older key-restricted execute_read entry point.
async function readOps(who, request) {
  await as(who);
  try {
    return (await db.query(`select public.execute_operations_read($1::jsonb) r`, [request])).rows[0].r;
  } catch (e) {
    return { error: e.message, detail: e.detail };
  }
}

const item = async (batch, taskId) =>
  one(`select * from public.command_batch_items where batch_id=$1 and task_id=$2`, [batch, taskId]);
const batchRow = async (batch) => one(`select * from public.command_batches where id=$1`, [batch]);

/** Submit a batch and drive it to completion the way the app does. */
async function runBatch(who, payload, limit = 25) {
  const r = await cmd(who, { command_id: id(), command_type: 'TASK_BATCH_SUBMIT', payload });
  if (!r.ok) return r;
  const batch = r.result.batch_id;
  await as(who);
  let guard = 0;
  for (;;) {
    const chunk = (await db.query(`select public.run_batch_chunk($1::uuid, $2::int) r`, [batch, limit])).rows[0].r;
    if (chunk.ran === 0 || (chunk.progress.pending === 0 && chunk.progress.retrying === 0)) break;
    if (++guard > 50) throw new Error('batch did not settle');
  }
  return { ...r, batch, progress: (await db.query(`select app.batch_progress($1::uuid) p`, [batch])).rows[0].p };
}

// ---------------------------------------------------------------------------
// A: a job whose PRE tasks are open, plus a second job for cross-job batches
// ---------------------------------------------------------------------------
const soldA = await sell('tanya');
assert.ok(!soldA.error, JSON.stringify(soldA));
const jobA = soldA.job_id;
const soldB = await sell('tanya', { customer: { first_name: 'Bob', last_name: 'Jones', postcode: 'LS2 2BB' } });
const jobB = soldB.job_id;
console.log('jobs', soldA.job_ref, soldB.job_ref);

// PRE03 is owned by ben with dan as backup (fixtures); the rest are tanya's.
const a01 = await task(jobA, 'PRE01');
const a03 = await task(jobA, 'PRE03');
const aNote = await noteOnlyTask(jobA);
assert.equal(a03.owner_id, people.ben);
assert.equal(a01.owner_id, people.tanya);

// ---------------------------------------------------------------------------
// 1. Preflight classifies each task honestly
// ---------------------------------------------------------------------------
{
  const pf = await readOps('tanya', {
    read_type: 'BATCH_PREFLIGHT', operation: 'TASK_BATCH_COMPLETE',
    task_ids: [a01.id, a03.id, aNote.id]
  });
  assert.ok(pf.ok, JSON.stringify(pf));
  const by = Object.fromEntries(pf.data.items.map((i) => [i.template_code, i]));
  // PRE01/PRE03 record business facts only the task screen can collect.
  assert.equal(by.PRE01.outcome, 'needs_information');
  assert.equal(by.PRE03.outcome, 'needs_information');
  // GHL01 needs only a note -> a batch can do it.
  assert.equal(by.GHL01.outcome, 'ready');
  assert.equal(pf.data.total, 3);
  // Cross-owner is not a blocker for tanya: she holds task.complete.cross_owner.
  assert.ok(!by.PRE03.blocking.some((b) => b.code === 'ownership'), JSON.stringify(by.PRE03.blocking));
  console.log('preflight counts', JSON.stringify(pf.data.counts));
}

// ---------------------------------------------------------------------------
// 2. Normal batch completion: partial success, per-item reasons
//    (3 selected: 1 ready, 2 need information -> the 1 still completes)
// ---------------------------------------------------------------------------
{
  const r = await runBatch('tanya', {
    operation: 'TASK_BATCH_COMPLETE', completion_note: 'Checked with provider',
    task_ids: [a01.id, a03.id, aNote.id]
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result.queued, 1);
  assert.equal(r.progress.succeeded, 1);
  assert.equal(r.progress.failed, 2);
  const done = await one(`select * from public.tasks where id=$1`, [aNote.id]);
  assert.equal(done.status, 'Complete');
  assert.equal(done.completion_mode, 'normal');
  assert.equal(done.completion_note, 'Checked with provider');
  // The two that could not run say why, and were never attempted.
  const it01 = await item(r.batch, a01.id);
  assert.equal(it01.status, 'Failed');
  assert.equal(it01.attempt_count, 0);
  assert.match(it01.error_detail, /invoice/i);
  console.log('partial batch', JSON.stringify(r.progress));
}

// ---------------------------------------------------------------------------
// 3. Override completion: permission, cross-owner, no business write
// ---------------------------------------------------------------------------
{
  // hannah (VariationApprover) is office class but holds neither new permission.
  const denied = await cmd('hannah', {
    command_id: id(), command_type: 'TASK_BATCH_SUBMIT',
    payload: { operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'because', task_ids: [a01.id] }
  });
  assert.equal(denied.error, 'TASK_OVERRIDE_DENIED');

  // A reason is required, and must be more than a keystroke.
  const noReason = await cmd('tanya', {
    command_id: id(), command_type: 'TASK_BATCH_SUBMIT',
    payload: { operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'x', task_ids: [a01.id] }
  });
  assert.equal(noReason.error, 'R1A_REQUIRED_OVERRIDE_REASON');

  // Tanya overrides PRE01 (hers) and PRE03 (Ben's) in one batch, across owners.
  const r = await runBatch('tanya', {
    operation: 'TASK_BATCH_OVERRIDE_COMPLETE',
    override_reason: 'Confirmed manually by office',
    override_category: 'Confirmed externally',
    task_ids: [a01.id, a03.id]
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.progress.succeeded, 2, JSON.stringify(r.progress));

  const t01 = await one(`select * from public.tasks where id=$1`, [a01.id]);
  const t03 = await one(`select * from public.tasks where id=$1`, [a03.id]);
  assert.equal(t01.status, 'Complete');
  assert.equal(t01.completion_mode, 'override');
  assert.equal(t01.override_reason, 'Confirmed manually by office');
  // Never a fabricated note.
  assert.equal(t01.completion_note, null);
  // The owner is untouched; the ACTOR is Tanya.
  assert.equal(t03.owner_id, people.ben, 'Ben stays the owner of PRE03');
  assert.equal(t03.override_actor_id, people.tanya);
  assert.equal(t03.completed_by, people.tanya);
  // What was bypassed is recorded structurally.
  const bypassed = t03.override_bypassed.map((b) => b.code);
  assert.ok(bypassed.includes('deposit_bank_confirmed'), JSON.stringify(bypassed));
  console.log('PRE03 bypassed:', bypassed.join(', '));

  // NO business fact was written by the override.
  const stage = await one(`select * from public.invoice_stages where job_id=$1 and stage='Deposit'`, [jobA]);
  assert.equal(stage.sent_at, null, 'override must not stamp the deposit invoice');
  assert.equal(stage.invoice_number, null);
  const checks = await all(`select * from public.manual_bank_checks where job_id=$1`, [jobA]);
  assert.equal(checks.length, 0, 'override must not write a bank check');

  // Audit: owner and actor are both preserved, and the event is distinguishable.
  const ev = await one(
    `select * from public.task_events where task_id=$1 and action='OverrideComplete'`, [a03.id]);
  assert.equal(ev.actor, people.tanya);
  assert.equal(ev.old_owner, people.ben);
  assert.equal(ev.new_owner, people.ben);
  const au = await one(
    `select * from public.audit_events where entity_id=$1 and action='OverrideComplete'`, [a03.id]);
  assert.equal(au.initiating_person_id, people.tanya);
  assert.equal(au.reason, 'Confirmed manually by office');
  assert.match(au.executing_service, /^batch:ui:TASK_OVERRIDE_COMPLETE$/);
}

// ---------------------------------------------------------------------------
// 4. An override does NOT advance the job, and the debt stays visible
// ---------------------------------------------------------------------------
{
  const job = await one(`select * from public.jobs where id=$1`, [jobA]);
  assert.equal(job.workflow_stage, 'Prebooking', 'override must never promote a job');
  const debt = (await db.query(`select app.job_override_debt($1::uuid) d`, [jobA])).rows[0].d;
  assert.equal(debt.length, 2);
  const codes = debt.map((d) => d.template_code).sort();
  assert.deepEqual(codes, ['PRE01', 'PRE03']);
  assert.ok(debt[0].unrecorded.length > 0, 'the unrecorded facts must be listed');
  assert.ok(debt.every((d) => d.override_by === 'Tanya'));
  console.log('override debt:', debt.map((d) => `${d.template_code}(${d.unrecorded.length})`).join(' '));

  // The readiness gate still reports the real requirement as unmet.
  const readiness = (await db.query(`select app.evaluate_ready_to_book($1::uuid) r`, [jobA])).rows[0].r;
  assert.equal(readiness.ready, false);
  const failing = readiness.gates.filter((g) => !g.pass).map((g) => g.name);
  assert.ok(failing.includes('PRE01_satisfied'), JSON.stringify(failing));
  console.log('still blocked by:', failing.join(', '));
}

// ---------------------------------------------------------------------------
// 5. Idempotency: replayed submit, re-run chunk, already-complete
// ---------------------------------------------------------------------------
{
  const commandId = id();
  const payload = {
    operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'Duplicate requirement',
    task_ids: [(await noteOnlyTask(jobB)).id]
  };
  const first = await cmd('tanya', { command_id: commandId, command_type: 'TASK_BATCH_SUBMIT', payload });
  assert.ok(first.ok);
  // The same command id and content: the stored result, no second batch.
  const again = await cmd('tanya', { command_id: commandId, command_type: 'TASK_BATCH_SUBMIT', payload });
  assert.equal(again.replayed, true);
  assert.equal(again.result.batch_id, first.result.batch_id);
  assert.equal((await all(`select * from public.command_batches`)).filter((b) => b.command_id === commandId).length, 1);
  // Different content under the same id is a conflict, not a silent overwrite.
  const conflict = await cmd('tanya', {
    command_id: commandId, command_type: 'TASK_BATCH_SUBMIT',
    payload: { ...payload, override_reason: 'something else' }
  });
  assert.equal(conflict.error, 'R1A_COMMAND_CONFLICT');

  // Drive it, then drive it again: the second pass does nothing.
  const batch = first.result.batch_id;
  await as('tanya');
  await db.query(`select public.run_batch_chunk($1::uuid, 25)`, [batch]);
  const p1 = (await db.query(`select app.batch_progress($1::uuid) p`, [batch])).rows[0].p;
  assert.equal(p1.succeeded, 1);
  const rerun = (await db.query(`select public.run_batch_chunk($1::uuid, 25) r`, [batch])).rows[0].r;
  assert.equal(rerun.ran, 0);
  // Exactly one commands-ledger row, one task_event.
  const it = await one(`select * from public.command_batch_items where batch_id=$1`, [batch]);
  assert.equal((await all(`select * from public.commands where command_id=$1`, [it.command_id])).length, 1);
  assert.equal((await all(
    `select * from public.task_events where task_id=$1 and action='OverrideComplete'`, [it.task_id])).length, 1);
}

// ---------------------------------------------------------------------------
// 6. Already complete is a no-op that counts as done, not a failure
// ---------------------------------------------------------------------------
{
  const r = await runBatch('tanya', {
    operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'Historical admin cleanup',
    task_ids: [aNote.id]   // completed normally in section 2
  });
  assert.ok(r.ok);
  assert.equal(r.progress.skipped, 1, JSON.stringify(r.progress));
  const t = await one(`select * from public.tasks where id=$1`, [aNote.id]);
  // Untouched: still a normal completion with its real note.
  assert.equal(t.completion_mode, 'normal');
  assert.equal(t.completion_note, 'Checked with provider');
}

// ---------------------------------------------------------------------------
// 7. Stale version -> NeedsReview, never a blind overwrite; retry re-reads
// ---------------------------------------------------------------------------
{
  const b02 = await task(jobB, 'PRE02');
  const r = await cmd('tanya', {
    command_id: id(), command_type: 'TASK_BATCH_SUBMIT',
    payload: { operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'Manager instruction', task_ids: [b02.id] }
  });
  const batch = r.result.batch_id;
  // Someone else moves the row between preflight and execution.
  ok(await cmd('tanya', {
    command_id: id(), command_type: 'TASK_COMPLETE', task_id: b02.id, expected_version: b02.version,
    payload: { completion_note: 'sent to customer', contract_id: 'SIG-9', contract_signed: false }
  }), 'pre02 moved');

  await as('tanya');
  await db.query(`select public.run_batch_chunk($1::uuid, 25)`, [batch]);
  let it = await one(`select * from public.command_batch_items where batch_id=$1`, [batch]);
  assert.equal(it.status, 'NeedsReview');
  assert.match(it.error_code, /R1A_STALE_VERSION/);
  assert.equal((await batchRow(batch)).status, 'CompletedWithErrors');

  // Retry re-reads the version rather than forcing the old one through.
  ok(await cmd('tanya', { command_id: id(), command_type: 'BATCH_RETRY', payload: { batch_id: batch } }), 'retry');
  it = await one(`select * from public.command_batch_items where batch_id=$1`, [batch]);
  assert.equal(it.status, 'Pending');
  assert.equal(it.attempt_count, 0);
  await as('tanya');
  await db.query(`select public.run_batch_chunk($1::uuid, 25)`, [batch]);
  it = await one(`select * from public.command_batch_items where batch_id=$1`, [batch]);
  assert.equal(it.status, 'Succeeded', JSON.stringify(it.error_code));
  console.log('stale version reviewed then retried cleanly');
}

// ---------------------------------------------------------------------------
// 8. A permanent refusal is never re-queued by retry
// ---------------------------------------------------------------------------
{
  const b01 = await task(jobB, 'PRE01');
  const r = await runBatch('tanya', {
    operation: 'TASK_BATCH_COMPLETE', completion_note: 'note', task_ids: [b01.id]
  });
  const it = await item(r.batch, b01.id);
  assert.equal(it.status, 'Failed');
  const retried = ok(await cmd('tanya', {
    command_id: id(), command_type: 'BATCH_RETRY', payload: { batch_id: r.batch } }), 'retry permanent');
  assert.equal(retried.requeued, 0, 'a permanent refusal must not re-queue');
}

// ---------------------------------------------------------------------------
// 9. Cross-owner permission is real: a person without it cannot reach
//    another person's task, with or without an override
// ---------------------------------------------------------------------------
{
  const b03 = await task(jobB, 'PRE03');   // owned by ben, backup dan
  assert.equal(b03.owner_id, people.ben);
  // hannah is office class and assigned to the job, but holds neither permission.
  const pf = await readOps('hannah', {
    read_type: 'BATCH_PREFLIGHT', operation: 'TASK_BATCH_COMPLETE', task_ids: [b03.id] });
  assert.ok(pf.ok, JSON.stringify(pf));
  assert.equal(pf.data.items[0].outcome, 'not_permitted');
  assert.ok(pf.data.items[0].blocking.some((b) => b.code === 'ownership'));

  const r = await runBatch('hannah', {
    operation: 'TASK_BATCH_COMPLETE', completion_note: 'n', task_ids: [b03.id] });
  assert.ok(r.ok);
  assert.equal(r.progress.succeeded, 0);
  assert.equal((await one(`select * from public.tasks where id=$1`, [b03.id])).status, 'Open');

  // dan (Director, and the backup) can: authorised cross-owner completion.
  const r2 = await runBatch('dan', {
    operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'Confirmed externally', task_ids: [b03.id] });
  assert.equal(r2.progress.succeeded, 1, JSON.stringify(r2.progress));
  const after = await one(`select * from public.tasks where id=$1`, [b03.id]);
  assert.equal(after.owner_id, people.ben, 'owner unchanged');
  assert.equal(after.override_actor_id, people.dan);
}

// ---------------------------------------------------------------------------
// 10. Bulk reopen keeps history, and clears the override projection
// ---------------------------------------------------------------------------
{
  const r = await runBatch('tanya', {
    operation: 'TASK_BATCH_REOPEN', reopen_reason: 'Reverting the cleanup',
    task_ids: [a01.id, a03.id, aNote.id]
  });
  assert.equal(r.progress.succeeded, 3, JSON.stringify(r.progress));
  const t01 = await one(`select * from public.tasks where id=$1`, [a01.id]);
  assert.equal(t01.status, 'Open');
  // No longer an override completion...
  assert.equal(t01.completion_mode, 'normal');
  assert.equal(t01.override_actor_id, null);
  // ...but the history says it happened.
  const actions = (await all(
    `select action from public.task_events where task_id=$1 order by occurred_at, id`, [a01.id]))
    .map((e) => e.action);
  assert.ok(actions.includes('OverrideComplete'), actions.join(','));
  assert.ok(actions.includes('Reopen'), actions.join(','));
  // A normal completion's note survives reopening, as it always did.
  assert.equal((await one(`select * from public.tasks where id=$1`, [aNote.id])).completion_note, 'Checked with provider');
  // The debt clears with the override.
  assert.equal((await db.query(`select app.job_override_debt($1::uuid) d`, [jobA])).rows[0].d.length, 0);

  // Reopening something already open is idempotent, not an error.
  const again = await runBatch('tanya', {
    operation: 'TASK_BATCH_REOPEN', reopen_reason: 'Reverting again', task_ids: [a01.id] });
  assert.equal(again.progress.skipped, 1, JSON.stringify(again.progress));
}

// ---------------------------------------------------------------------------
// 11. Bulk reassign, with the same eligibility rules as the single command
// ---------------------------------------------------------------------------
{
  const r = await runBatch('ben', {
    operation: 'TASK_BATCH_REASSIGN', owner_id: people.dan, reason: 'Cover while away',
    task_ids: [a01.id, aNote.id]
  });
  assert.equal(r.progress.succeeded, 2, JSON.stringify(r.progress));
  assert.equal((await one(`select * from public.tasks where id=$1`, [a01.id])).owner_id, people.dan);
  const ev = await one(
    `select * from public.task_events where task_id=$1 and action='Reassign'`, [a01.id]);
  assert.equal(ev.old_owner, people.tanya);
  assert.equal(ev.new_owner, people.dan);
  assert.equal(ev.actor, people.ben);

  // An ineligible owner is refused per item, not silently accepted.
  const bad = await runBatch('ben', {
    operation: 'TASK_BATCH_REASSIGN', owner_id: people.store, reason: 'Wrong person', task_ids: [aNote.id] });
  assert.equal(bad.progress.succeeded, 0);
  const it = await item(bad.batch, aNote.id);
  assert.match(it.error_code, /TASK_OWNER_NOT_ELIGIBLE/);
}

// ---------------------------------------------------------------------------
// 12. A selector resolves server-side, under the caller's own visibility
// ---------------------------------------------------------------------------
{
  const pf = await readOps('tanya', {
    read_type: 'BATCH_PREFLIGHT', operation: 'TASK_BATCH_OVERRIDE_COMPLETE',
    selector: { scope: 'all', status: 'open', job_id: jobB, code_prefix: 'PRE' }
  });
  assert.ok(pf.ok, JSON.stringify(pf));
  assert.ok(pf.data.total >= 1);
  assert.ok(pf.data.items.every((i) => i.template_code.startsWith('PRE')), 'code_prefix must filter');

  // A Surveyor cannot use a team-wide selector at all (the read refuses it).
  const denied = await readOps('sam', {
    read_type: 'BATCH_PREFLIGHT', operation: 'TASK_BATCH_COMPLETE',
    selector: { scope: 'all', status: 'open' } });
  assert.match(denied.error ?? '', /ROLE_DENIED/);
}

// ---------------------------------------------------------------------------
// 13. Historical records are not actionable, by class
// ---------------------------------------------------------------------------
{
  // Make jobB historical and try to touch one of its tasks.
  const bTask = await task(jobB, 'PRE04');
  await db.query(
    `update public.jobs set record_class='HistoricalImport', source_system='test', archived_at=now() where id=$1`,
    [jobB]);

  // The single command refuses it (the invariant this work added).
  const single = await cmd('tanya', {
    command_id: id(), command_type: 'TASK_COMPLETE', task_id: bTask.id, expected_version: bTask.version,
    payload: { completion_note: 'x', customer_details_verified: true, sold_value_verified: true,
               verified_gross_amount: 5000 } });
  assert.match(single.error, /HISTORICAL_IMPORT/);

  // An override cannot reach it either: this is a hard invariant.
  const pf = await readOps('tanya', {
    read_type: 'BATCH_PREFLIGHT', operation: 'TASK_BATCH_OVERRIDE_COMPLETE', task_ids: [bTask.id] });
  assert.equal(pf.data.items[0].outcome, 'not_actionable');
  assert.ok(pf.data.items[0].blocking.some((b) => b.code === 'live_job' && b.kind === 'hard'));

  const r = await runBatch('tanya', {
    operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'DEV/test', task_ids: [bTask.id] });
  assert.equal(r.progress.succeeded, 0);
  assert.equal((await one(`select * from public.tasks where id=$1`, [bTask.id])).status, 'Open');
  await db.query(`update public.jobs set record_class='Live', source_system=null, archived_at=null where id=$1`, [jobB]);
  console.log('historical jobs refused by class, override included');
}

// ---------------------------------------------------------------------------
// 14. Work completed by another command is never swept up by a batch
// ---------------------------------------------------------------------------
{
  // INS01/INS04 are completed by recording a call; S15 work on the Operations tab.
  const callTask = await one(
    `insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id,
                               status, created_rule_version)
     select $1, 'INS01', 'test-ins01-' || $2::text, t.task_group, t.title, $3, 'Open', t.template_version
     from public.task_templates t where t.code='INS01' returning *`,
    [jobA, `${jobA}`, people.tanya]);
  if (callTask) {
    const pf = await readOps('tanya', {
      read_type: 'BATCH_PREFLIGHT', operation: 'TASK_BATCH_OVERRIDE_COMPLETE', task_ids: [callTask.id] });
    assert.equal(pf.data.items[0].outcome, 'not_actionable');
    assert.ok(pf.data.items[0].blocking.some((b) => b.code === 'not_completed_elsewhere'));
    console.log('call tasks stay with CALL_RECORD');
  }
}

// ---------------------------------------------------------------------------
// 15. Chunking, cancellation and stall recovery
// ---------------------------------------------------------------------------
{
  // Twelve completable tasks across two jobs.
  const jobs = [];
  for (let i = 0; i < 6; i += 1) {
    const s = await sell('tanya', { customer: { first_name: `Bulk${i}`, last_name: 'Test', postcode: 'LS3 3CC' } });
    jobs.push(s.job_id);
  }
  const ids = [];
  for (const j of jobs) {
    ids.push((await noteOnlyTask(j)).id);
    ids.push((await task(j, 'PRE02')).id);   // needs information -> fails preflight
  }

  const submitted = await cmd('tanya', {
    command_id: id(), command_type: 'TASK_BATCH_SUBMIT',
    payload: { operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'Historical admin cleanup', task_ids: ids }
  });
  const batch = submitted.result.batch_id;
  assert.equal(submitted.result.queued, 12, 'an override can take PRE02 as well');

  // One bounded chunk at a time, as the browser drives it.
  await as('tanya');
  const c1 = (await db.query(`select public.run_batch_chunk($1::uuid, 5) r`, [batch])).rows[0].r;
  assert.equal(c1.ran, 5);
  assert.equal(c1.progress.pending, 7);
  assert.equal((await batchRow(batch)).status, 'Processing');

  // Cancelling leaves the five committed and stops the rest.
  ok(await cmd('tanya', { command_id: id(), command_type: 'BATCH_CANCEL', payload: { batch_id: batch } }), 'cancel');
  const p = (await db.query(`select app.batch_progress($1::uuid) p`, [batch])).rows[0].p;
  assert.equal(p.succeeded, 5);
  assert.equal(p.cancelled, 7);
  assert.equal((await batchRow(batch)).status, 'Cancelled');
  console.log('cancelled mid-batch:', JSON.stringify(p));
}

{
  // A worker that died mid-item: the row is released and recovered, and the
  // recovery path does NOT need a session (pg_cron has no auth.uid()).
  const s = await sell('tanya', { customer: { first_name: 'Stall', last_name: 'Test', postcode: 'LS4 4DD' } });
  const t = await noteOnlyTask(s.job_id);
  const r = await cmd('tanya', {
    command_id: id(), command_type: 'TASK_BATCH_SUBMIT',
    payload: { operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'Manager instruction', task_ids: [t.id] }
  });
  const batch = r.result.batch_id;
  await db.query(
    `update public.command_batch_items set status='Processing', claimed_at=now() - interval '30 minutes'
     where batch_id=$1`, [batch]);

  await as(null);   // no signed-in user, as in the cron sweep
  const rec = (await db.query(`select app.run_batch_recovery() r`)).rows[0].r;
  assert.ok(rec.released >= 1, JSON.stringify(rec));
  const it = await one(`select * from public.command_batch_items where batch_id=$1`, [batch]);
  assert.equal(it.status, 'Succeeded', JSON.stringify(it.error_code));
  // The actor is still the human who asked, never a system identity.
  const done = await one(`select * from public.tasks where id=$1`, [t.id]);
  assert.equal(done.override_actor_id, people.tanya);
  assert.equal((await batchRow(batch)).status, 'Completed');
  console.log('stalled item recovered by the sweep, actor preserved');
}

// ---------------------------------------------------------------------------
// 16. A batch belongs to its submitter
// ---------------------------------------------------------------------------
{
  const s = await sell('tanya', { customer: { first_name: 'Owned', last_name: 'Test', postcode: 'LS5 5EE' } });
  const t = await noteOnlyTask(s.job_id);
  const r = await cmd('tanya', {
    command_id: id(), command_type: 'TASK_BATCH_SUBMIT',
    payload: { operation: 'TASK_BATCH_OVERRIDE_COMPLETE', override_reason: 'Manager instruction', task_ids: [t.id] }
  });
  const batch = r.result.batch_id;
  // dan did not submit it, so he cannot drive it.
  await as('dan');
  await assert.rejects(
    () => db.query(`select public.run_batch_chunk($1::uuid, 25)`, [batch]),
    /BATCH_ACCESS_DENIED/);
  // ...and cannot read its detail (though an admin can).
  const denied = await readOps('hannah', { read_type: 'BATCH_DETAIL', batch_id: batch });
  assert.match(denied.error ?? '', /BATCH_ACCESS_DENIED|ROLE_DENIED/);
  const allowed = await readOps('ben', { read_type: 'BATCH_DETAIL', batch_id: batch });
  assert.ok(allowed.ok, JSON.stringify(allowed));
  assert.equal(allowed.data.is_mine, false);
  assert.equal(allowed.data.requested_by, 'Tanya');
}

// ---------------------------------------------------------------------------
// 17. Error classification
// ---------------------------------------------------------------------------
{
  const cls = async (state, msg) =>
    (await db.query(`select app.batch_error_class($1,$2) c`, [state, msg])).rows[0].c;
  assert.equal(await cls('40P01', 'deadlock detected'), 'RetryDue');
  assert.equal(await cls('40001', 'could not serialize'), 'RetryDue');
  assert.equal(await cls('P0001', 'R1A_STALE_VERSION'), 'NeedsReview');
  assert.equal(await cls('P0001', 'R1A_ROLE_DENIED'), 'Failed');
  assert.equal(await cls('P0001', 'HISTORICAL_IMPORT: ...'), 'Failed');
  assert.equal(await cls('P0001', 'TASK_OVERRIDE_DENIED'), 'Failed');
  assert.equal(await cls('23505', 'duplicate key'), 'NeedsReview');
}

// ---------------------------------------------------------------------------
// 18. The processing-centre reads
// ---------------------------------------------------------------------------
{
  const list = await readOps('tanya', { read_type: 'BATCHES', limit: 50 });
  assert.ok(list.ok, JSON.stringify(list));
  assert.ok(list.data.batches.length > 5);
  assert.ok(list.data.batches.every((b) => b.is_mine));
  assert.ok(list.data.batches[0].progress.total >= 0);

  const detail = await readOps('tanya', { read_type: 'BATCH_DETAIL', batch_id: list.data.batches[0].batch_id });
  assert.ok(detail.ok, JSON.stringify(detail));
  assert.ok(Array.isArray(detail.data.items));
  assert.ok(detail.data.items.every((i) => 'template_code' in i && 'status' in i));

  // An admin can see everyone's.
  const everyone = await readOps('ben', { read_type: 'BATCHES', all: true, limit: 50 });
  assert.ok(everyone.data.batches.some((b) => !b.is_mine));
  console.log('processing centre:', everyone.data.batches.length, 'operations visible to an admin');
}

console.log('\nt_batches: all assertions passed');

// ---------------------------------------------------------------------------
// 19. The override is visible wherever the task is shown
// ---------------------------------------------------------------------------
{
  const s = await sell('tanya', { customer: { first_name: 'Visible', last_name: 'Test', postcode: 'LS6 6FF' } });
  const t = await task(s.job_id, 'PRE01');
  const r = await runBatch('tanya', {
    operation: 'TASK_BATCH_OVERRIDE_COMPLETE',
    override_reason: 'Invoice raised outside the system', task_ids: [t.id] });
  assert.equal(r.progress.succeeded, 1);

  // The task list (History) distinguishes it from an ordinary completion.
  const list = await readOps('tanya', {
    read_type: 'TASKS', scope: 'all', status: 'closed', job_id: s.job_id });
  const row = list.data.tasks.find((x) => x.id === t.id);
  assert.equal(row.status, 'Complete');
  assert.equal(row.completion_mode, 'override');
  assert.equal(row.override_by, 'Tanya');
  assert.equal(row.override_reason, 'Invoice raised outside the system');
  assert.ok(row.override_unrecorded.length > 0, 'the list says what was not recorded');

  // An ordinary completion is not dressed up as one.
  const other = await noteOnlyTask(s.job_id);
  await runBatch('tanya', {
    operation: 'TASK_BATCH_COMPLETE', completion_note: 'Done properly', task_ids: [other.id] });
  const plain = (await readOps('tanya', {
    read_type: 'TASKS', scope: 'all', status: 'closed', job_id: s.job_id
  })).data.tasks.find((x) => x.id === other.id);
  assert.equal(plain.completion_mode, 'normal');
  assert.equal(plain.override_by, null);
  assert.equal(plain.override_unrecorded, null);

  // And the job surface can explain why it is still gated.
  const debt = await readOps('tanya', { read_type: 'JOB_OVERRIDE_DEBT', job_id: s.job_id });
  assert.ok(debt.ok, JSON.stringify(debt));
  assert.equal(debt.data.overrides.length, 1);
  assert.equal(debt.data.overrides[0].template_code, 'PRE01');
  console.log('override visible in lists and on the job:',
    debt.data.overrides[0].unrecorded.join(', '));
}

console.log('t_batches: override visibility checks passed');
