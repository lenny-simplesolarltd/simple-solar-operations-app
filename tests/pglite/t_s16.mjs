// S16 health / heartbeat / system tasks + resilience review queue.
// Run: PORT_EXTRA=20260919128000_s16_health_resilience.sql node t_s16.mjs
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok } = f;
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const system = async () => db.query(`select set_config('request.jwt.claims', '', false)`); // cron: no JWT
const j = async (sql, p = []) => { await system(); return (await one(sql, p)).r; };
const count = async (sql, p = []) => (await one(`select count(*)::int n from ${sql}`, p)).n;
const expectErr = async (sql, p, re) => { await system(); try { await db.query(sql, p); assert.fail('expected error ' + re); } catch (e) { assert.match(e.message, re); } };

// Wednesday 2026-09-16 (BST): 09:00Z = 10:00 London, inside the staffed window.
const T0 = '2026-09-16T09:00:00Z';
const at = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();

// ---------------------------------------------------------------- heartbeats
let r = await j(`select app.record_heartbeat('Bridge', 'OK', null, 'k1', $1) r`, [T0]);
assert.equal(r.created, true); assert.equal(r.component, 'Bridge');
r = await j(`select app.record_heartbeat('Bridge', 'OK', null, 'k1', $1) r`, [at(5)]);
assert.equal(r.replay, true); assert.equal(await count(`public.health_checks where integration='Processing:Bridge'`), 1);
r = await j(`select app.record_heartbeat('Bridge', 'FAILED', 'Boom   timeout', 'k2', $1) r`, [at(10)]);
assert.equal(r.error_code, 'Boom timeout');
assert.equal(new Date(r.last_success).toISOString(), new Date(T0).toISOString(), 'last_success carried forward');
await expectErr(`select app.record_heartbeat('bad name!')`, [], /S16_REVIEW: component must be/);
await expectErr(`select app.record_heartbeat('X', 'not ok!')`, [], /S16_REVIEW: outcome must be a short code/);

let hb = await j(`select app.heartbeat_status($1, array['Ghost']) r`, [at(20)]);
const comp = (s, c) => s.components.find(x => x.component === c);
assert.equal(comp(hb, 'Bridge').state, 'Failing'); assert.equal(comp(hb, 'Bridge').stale, false);
assert.equal(comp(hb, 'Ghost').state, 'Never');
assert.equal(hb.alerts.find(a => a.component === 'Heartbeat:Bridge').severity, 'Warning');
assert.ok(hb.alerts.find(a => a.component === 'Heartbeat:Ghost'), 'Never alarmed in staffed window');
hb = await j(`select app.heartbeat_status($1) r`, [at(200)]); // failing + no success for 200 min, staffed
assert.equal(comp(hb, 'Bridge').stale, true); assert.equal(hb.alerts[0].severity, 'Critical');
await j(`select app.record_heartbeat('Bridge', 'OK', null, 'k3', $1) r`, [at(30)]);
hb = await j(`select app.heartbeat_status($1) r`, [at(40)]);
assert.equal(comp(hb, 'Bridge').state, 'Fresh');
hb = await j(`select app.heartbeat_status($1) r`, [at(30 + 121)]);
assert.equal(comp(hb, 'Bridge').state, 'Stale');
hb = await j(`select app.heartbeat_status($1) r`, ['2026-09-19T12:00:00Z']); // Saturday
assert.equal(comp(hb, 'Bridge').state, 'Quiet'); assert.equal(hb.staffed_window.reason, 'NOT_STAFFED_WEEKDAY');
hb = await j(`select app.heartbeat_status($1, array['Ghost']) r`, ['2026-09-16T17:30:00Z']); // 18:30 London
assert.equal(comp(hb, 'Bridge').state, 'Quiet'); assert.equal(hb.alerts.length, 0);
await q(`insert into public.settings (key, typed_value, scope, version, effective_from) values ('health.heartbeat_stale_minutes', '600', 'Global', 1, '2026-01-01')`);
hb = await j(`select app.heartbeat_status($1) r`, [at(30 + 121)]);
assert.equal(hb.stale_minutes, 600); assert.equal(comp(hb, 'Bridge').state, 'Fresh');
await q(`insert into public.settings (key, typed_value, scope, version, effective_from) values ('health.heartbeat_stale_minutes', '"-5"', 'Global', 2, '2026-01-01')`);
assert.equal((await j(`select app.heartbeat_status($1) r`, [T0])).stale_minutes, 120);
await q(`insert into public.holidays (local_date, description) values ('2026-09-17', 'Closed')`);
assert.equal((await j(`select app.staffed_window($1) r`, ['2026-09-17T10:00:00Z'])).reason, 'OFFICE_HOLIDAY');

// ---------------------------------------------------------------- health
// Healthy needs proof that backups were verified and recovery was tested (P0 operational health):
// without it every evaluation is Degraded. Recorded here by a service, as a future verifier would.
for (const kind of ['DatabaseBackup', 'DatabaseRestoreDrill', 'StorageBackup', 'StorageRestoreDrill'])
  await j(`select app.record_operational_evidence($1, 'Verified', $2, $3, 'test fixture', 'fixture evidence', 'test-verifier') r`, [kind, at(-60), at(-120)]);
let h = await j(`select app.evaluate_health($1) r`, [at(40)]);
assert.equal(h.overall, 'Degraded'); // no prior system check
assert.ok(h.warnings.some(w => w.component === 'HealthChecks'));
h = await j(`select app.evaluate_health($1) r`, [at(45)]);
assert.equal(h.overall, 'Healthy', JSON.stringify(h.warnings));
const healthyAt = at(45);
// seed uncertain state
const ob = async (status, action, attempts, createdMin, corr = null) => (await one(
  `insert into public.outbox (idempotency_key, action_type, target, payload_hash, attempt_count, status, created_at, correlation_id)
   values ($1, $2, 'x@test', 'h', $3, $4, $5, $6) returning id`, [id(), action, attempts, status, at(createdMin), corr])).id;
const { job: jobA } = { job: null };
const oReview = await ob('NeedsReview', 'EmailSend', 5, 0);
const oRetry = await ob('RetryDue', 'EmailSend', 1, 0);
const oStalled = await ob('Processing', 'EmailSend', 1, 20);
const oFresh = await ob('Processing', 'EmailSend', 1, 55);
const oDone = await ob('Succeeded', 'EmailSend', 1, 0);
const oCal = await ob('NeedsReview', 'CalendarCreate', 2, 0);
const comm = (await one(`insert into public.communications (type, subject, recipients_snapshot, status) values ('Email', 'Order', 'a@b', 'Uncertain') returning id`)).id;
h = await j(`select app.evaluate_health($1) r`, [at(60)]);
assert.equal(h.overall, 'Degraded');
assert.ok(h.warnings.some(w => w.component === 'Communications'));
const hrow = await one(`select * from public.health_checks where id=$1`, [h.health_id]);
assert.equal(new Date(hrow.last_success).toISOString(), new Date(healthyAt).toISOString(), 'system last_success carried forward');
// Critical from a stale failing heartbeat
await j(`select app.record_heartbeat('Mailer', 'FAILED', 'SMTP down', null, $1) r`, [at(0)]);
h = await j(`select app.health_status($1) r`, [at(60)]);
assert.equal(h.overall, 'Critical'); assert.equal(h.issues[0].component, 'Heartbeat:Mailer');
assert.match(h.error_code, /^Heartbeat:Mailer_/);

// ---------------------------------------------------------------- review queue
const queue = await j(`select app.review_queue($1) r`, [at(60)]);
const ids = queue.items.map(i => i.id).sort();
assert.deepEqual(ids, [oReview, oRetry, oStalled, oCal, comm].sort());
assert.equal(queue.items.find(i => i.id === oStalled).status, 'ProcessingStalled');
assert.equal(queue.items.find(i => i.id === oCal).owner_service, 'CalendarService');
assert.equal(queue.by_kind.Outbox, 4); assert.equal(queue.by_kind.Communications, 1);
assert.ok(queue.indicators.last_health_success_at);

// ---------------------------------------------------------------- sweep
const auditBefore = await count(`public.audit_events`);
let s = await j(`select app.run_resilience_sweep($1) r`, [at(60)]);
assert.equal(s.ok, true, JSON.stringify(s));
assert.equal(s.review_tasks.created.length, 4); // RetryDue skipped
assert.ok(!s.review_tasks.created.some(c => c.id === oRetry));
const comps = s.alerts.alerts.map(a => a.component).sort();
assert.deepEqual(comps, ['Heartbeat:Mailer', 'Outbox']);
assert.equal(s.alerts.created.length, 2);
const rt = await one(`select * from public.tasks where instance_key=$1`, [`RS-REVIEW-Outbox-${oReview}`]);
assert.equal(rt.owner_id, people.tanya); assert.equal(rt.backup_id, people.ben); assert.equal(rt.task_group, 'System'); assert.equal(rt.priority, 1);
assert.equal(rt.created_by, null);
const alertTask = await one(`select * from public.tasks where instance_key='RS-ALERT-Heartbeat:Mailer-2026-09-16'`);
assert.ok(alertTask);
const sysRow = await one(`select * from public.health_checks where id=$1`, [s.health.health_id]);
assert.equal(sysRow.outcome, 'Critical'); assert.ok(sysRow.next_action_task_id);
const newAudit = await q(`select * from public.audit_events where command_id = 'RS-SWEEP-20260916T100000'`);
assert.equal(newAudit.length, (await count(`public.audit_events`)) - auditBefore, 'every sweep audit row carries the sweep correlation id');
assert.ok(newAudit.length >= 6);
assert.ok(newAudit.every(a => a.initiating_person_id === null && a.executing_service === 'scheduler:ResilienceReview'));
assert.equal((await one(`select outcome from public.health_checks where integration='Processing:ResilienceSweep' order by checked_at desc limit 1`)).outcome, 'OK');
// rerun: idempotent
s = await j(`select app.run_resilience_sweep($1) r`, [at(90)]);
assert.deepEqual(s.review_tasks.created.map(c => c.id), [oFresh]); assert.equal(s.review_tasks.reused.length, 4); // oFresh now stalled (35 min)
assert.equal(s.alerts.created.length, 0); assert.equal(s.alerts.reused.length, 2);
// London day: 23:30Z on 16 Sep is 00:30 on 17 Sep in London
s = await j(`select app.run_resilience_sweep($1) r`, ['2026-09-16T23:30:00Z']);
assert.equal(s.alerts.day, '2026-09-17');
assert.ok(await one(`select 1 from public.tasks where instance_key='RS-ALERT-Outbox-2026-09-17'`));

// FN-14 disabled -> nothing written
await q(`update public.release_modes set mode='Disabled', authorised_job_scope='None' where function_id='FN-14'`);
let n0 = await count(`public.tasks`), h0 = await count(`public.health_checks`);
s = await j(`select app.run_resilience_sweep($1) r`, [at(120)]);
assert.equal(s.status, 'Disabled'); assert.equal(await count(`public.tasks`), n0); assert.equal(await count(`public.health_checks`), h0);
let res = await cmd('tanya', { command_id: id(), command_type: 'OUTBOX_RESOLVE', payload: { outbox_id: oReview, decision: 'Cancel', reason: 'x' } });
assert.equal(res.error, 'R1A_MODE_DENIED');
await q(`update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id='FN-14'`);

// ---------------------------------------------------------------- OUTBOX_RESOLVE
const rq = (payload, cid = id()) => ({ command_id: cid, command_type: 'OUTBOX_RESOLVE', payload });
const a0 = await count(`public.audit_events`);
const refusals = [
  ['store', { outbox_id: oReview, decision: 'Cancel', reason: 'x' }, 'R1A_ROLE_DENIED'],
  ['hannah', { outbox_id: oReview, decision: 'Cancel', reason: 'x' }, 'R1A_ROLE_DENIED'],
  ['tanya', { outbox_id: oReview, decision: 'Cancel' }, 'R1A_REQUIRED_REASON'],
  ['tanya', { outbox_id: oReview, decision: 'Cancel', reason: 'x', bogus: 1 }, 'R1A_INVALID_FIELDS'],
  ['tanya', { outbox_id: oReview, decision: 'Delete', reason: 'x' }, 'RS_REVIEW: decision must be MarkSucceeded, Cancel or Retry'],
  ['tanya', { outbox_id: oReview, decision: 'MarkSucceeded', reason: 'x' }, 'RS_REVIEW: external_id required to mark succeeded (confirm the external result first)'],
  ['tanya', { outbox_id: oCal, decision: 'Cancel', reason: 'x' }, 'RS_REFUSED: calendar rows are resolved by the calendar service'],
  ['tanya', { outbox_id: oDone, decision: 'Cancel', reason: 'x' }, 'RS_REVIEW: outbox status is not reviewable'],
  ['tanya', { outbox_id: '00000000-0000-0000-0000-000000000000', decision: 'Cancel', reason: 'x' }, 'RS_REVIEW: outbox row not found'],
  ['tanya', { outbox_id: 'nope', decision: 'Cancel', reason: 'x' }, 'RS_REVIEW: outbox row not found'],
];
for (const [who, payload, code] of refusals) assert.equal((await cmd(who, rq(payload))).error, code, code);
assert.equal(await count(`public.audit_events`), a0, 'refusals write nothing');
assert.equal((await one(`select status from public.outbox where id=$1`, [oReview])).status, 'NeedsReview');
assert.equal(await count(`public.commands where command_type='OUTBOX_RESOLVE'`), 0);

const good = rq({ outbox_id: oReview, decision: 'MarkSucceeded', reason: 'Found in sent items', external_id: 'MSG-42' });
res = ok(await cmd('tanya', good), 'resolve');
assert.equal(res.status, 'Succeeded'); assert.equal(res.completed_tasks.length, 1); assert.equal(res.external_calls, 0);
const o1 = await one(`select * from public.outbox where id=$1`, [oReview]);
assert.equal(o1.external_id, 'MSG-42'); assert.match(o1.response_summary, /^RESOLVED by tanya@test.local: confirmed external result MSG-42/);
const t1 = await one(`select * from public.tasks where id=$1`, [res.completed_tasks[0]]);
assert.equal(t1.status, 'Complete'); assert.equal(t1.completed_by, people.tanya); assert.equal(t1.completion_note, 'MarkSucceeded: Found in sent items');
const ae = await one(`select * from public.audit_events where entity_type='Outbox' and entity_id=$1`, [oReview]);
assert.equal(ae.action, 'ResolveMarkSucceeded'); assert.equal(ae.initiating_person_id, people.tanya);
assert.equal(ae.executing_service, 'command:OUTBOX_RESOLVE'); assert.equal(ae.command_id, good.command_id);
assert.equal(ae.before_json.status, 'NeedsReview'); assert.equal(ae.after_json.status, 'Succeeded');
assert.equal(await count(`public.task_events where task_id=$1 and action='Complete'`, [t1.id]), 1);
const a1 = await count(`public.audit_events`);
const replay = await cmd('tanya', good);
assert.equal(replay.replayed, true); assert.equal(replay.result.status, 'Succeeded'); assert.equal(await count(`public.audit_events`), a1);
assert.equal((await cmd('tanya', { ...good, payload: { ...good.payload, reason: 'other' } })).error, 'R1A_COMMAND_CONFLICT');
// resolved again -> not reviewable
assert.equal((await cmd('tanya', rq({ outbox_id: oReview, decision: 'Cancel', reason: 'x' }))).error, 'RS_REVIEW: outbox status is not reviewable');
// Retry (Ben, Admin) on the stalled Processing row -> Pending
res = ok(await cmd('ben', rq({ outbox_id: oStalled, decision: 'Retry', reason: 'Not received, resend' })), 'retry');
assert.equal(res.status, 'Pending');
assert.ok((await one(`select next_attempt from public.outbox where id=$1`, [oStalled])).next_attempt);
// Cancel a RetryDue row (no review task to complete)
res = ok(await cmd('tanya', rq({ outbox_id: oRetry, decision: 'Cancel', reason: 'Superseded' })), 'cancel');
assert.equal(res.status, 'Cancelled'); assert.equal(res.completed_tasks.length, 0);

// needs review again after resolution -> new episode task
await q(`update public.outbox set status='NeedsReview', attempt_count=2 where id=$1`, [oStalled]);
s = await j(`select app.run_resilience_sweep($1) r`, [at(150)]);
assert.ok(s.review_tasks.created.some(c => c.id === oStalled));
assert.ok(await one(`select 1 from public.tasks where instance_key=$1 and status='Open'`, [`RS-REVIEW-Outbox-${oStalled}-E2`]));

// ---------------------------------------------------------------- staff read models
await f.as('tanya');
const pq = (await one(`select public.resilience_review_queue() r`)).r;
assert.ok(pq.count >= 2);
assert.ok((await one(`select public.system_health() r`)).r.overall);
await f.as('store');
await assert.rejects(db.query(`select public.resilience_review_queue()`), /R1A_ROLE_DENIED/);

// ---------------------------------------------------------------- system tasks
let st = await j(`select app.run_system_tasks('2026-09-16') r`);
assert.equal(st.ok, true, JSON.stringify(st)); assert.equal(st.tasks_created, 2);
const sys01 = await one(`select * from public.tasks where instance_key='S16-2026-09-16-SYS01'`);
const sys02 = await one(`select * from public.tasks where instance_key='S16-2026-09-16-SYS02'`);
assert.equal(new Date(sys01.due_at).toISOString(), '2026-09-16T08:00:00.000Z'); // 09:00 BST
assert.equal(new Date(sys02.due_at).toISOString(), '2026-09-16T15:30:00.000Z'); // 16:30 BST
assert.equal(sys01.owner_id, people.tanya); assert.equal(sys01.backup_id, people.ben); assert.equal(sys01.job_id, null);
assert.equal(sys01.related_entity_type, 'HealthChecks'); assert.equal(sys01.created_rule_version, 'S16-1.0');
assert.equal((await one(`select * from public.audit_events where entity_type='Tasks' and entity_id=$1`, [sys01.id])).initiating_person_id, null);
st = await j(`select app.run_system_tasks('2026-09-16') r`);
assert.equal(st.tasks_created, 0); assert.equal(st.tasks_reused, 2);
// winter date: 09:00 GMT
st = await j(`select app.run_system_tasks('2026-12-01') r`);
assert.equal(new Date((await one(`select due_at from public.tasks where instance_key='S16-2026-12-01-SYS01'`)).due_at).toISOString(), '2026-12-01T09:00:00.000Z');
n0 = await count(`public.tasks`);
assert.equal((await j(`select app.run_system_tasks('2026-09-19') r`)).status, 'NotStaffedDay'); // Saturday
assert.equal((await j(`select app.run_system_tasks('2026-09-17') r`)).status, 'NotStaffedDay'); // holiday
assert.equal(await count(`public.tasks`), n0);
assert.equal((await one(`select outcome from public.health_checks where integration='Processing:SystemTasks' order by created_at desc limit 1`)).outcome, 'OK');
// assignment rule missing -> visible failure, FAILED heartbeat, nothing else written
await q(`update public.task_assignment_rules set active = false where template_code in ('SYS01', 'SYS02', 'RS-REVIEW', 'RS-ALERT')`);
st = await j(`select app.run_system_tasks('2026-09-18') r`);
assert.equal(st.ok, false, JSON.stringify(st)); assert.match(st.error, /TASK_ASSIGNMENT_CONFIG/);
assert.equal(await count(`public.tasks`), n0);
assert.equal((await one(`select outcome, error_code from public.health_checks where integration='Processing:SystemTasks' order by created_at desc limit 1`)).outcome, 'FAILED');
// sweep fails the same way when it needs to create a task -> FAILED heartbeat, no health row
await ob('NeedsReview', 'EmailSend', 1, 100);
h0 = await count(`public.health_checks where integration='S16-system'`);
s = await j(`select app.run_resilience_sweep($1) r`, [at(160)]);
assert.equal(s.ok, false); assert.match(s.error, /TASK_ASSIGNMENT_CONFIG/);
assert.equal(await count(`public.health_checks where integration='S16-system'`), h0);
assert.equal((await one(`select outcome from public.health_checks where integration='Processing:ResilienceSweep' order by created_at desc limit 1`)).outcome, 'FAILED');
// FN-16 not Manual -> Disabled
await q(`update public.release_modes set mode='Disabled', authorised_job_scope='None' where function_id='FN-16'`);
assert.equal((await j(`select app.run_system_tasks('2026-09-21') r`)).status, 'Disabled');
assert.equal(await count(`public.tasks`), n0);

console.log('t_s16 OK');
