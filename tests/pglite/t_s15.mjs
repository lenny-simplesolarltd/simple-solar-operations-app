// S15 cancellation / reinstatement tests.
// Run: PORT_EXTRA=20260919147000_s15_cancellation.sql node t_s15.mjs
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok } = f;
const q = (sql, p = []) => db.query(sql, p);
const ins = async (sql, p = []) => (await one(sql + ' returning id', p)).id;
const jobRow = async (j) => one(`select * from public.jobs where id=$1`, [j]);
const counts = async () => one(`select (select count(*)::int from public.audit_events) a, (select count(*)::int from public.tasks) t,
  (select count(*)::int from public.task_events) e, (select count(*)::int from public.outbox) o,
  (select count(*)::int from public.commands) c, (select sum(version)::int from public.jobs) jv`);
const refuse = async (who, req, code) => {
  const before = await counts();
  const r = await cmd(who, req);
  assert.ok(r.error, `expected refusal ${code}, got ${JSON.stringify(r).slice(0, 300)}`);
  if (code instanceof RegExp) assert.match(r.error, code); else assert.equal(r.error, code);
  assert.deepEqual(await counts(), before, 'refusal wrote something: ' + code);
};

const { job } = await readyToBook(f);
await f.as('tanya');

// ---------------------------------------------------------------- seed
const merchant = await ins(`insert into public.companies (name, type) values ('Merchant Ltd','Merchant')`);
const scaffolder = await ins(`insert into public.companies (name, type) values ('Scaff Co','Scaffolder')`);
const product = await ins(`insert into public.products (sku, name, category, unit, stock_tracked) values ('P1','Panel','Panel','Each',true)`);
const store = await ins(`insert into public.stock_locations (name, type, usable) values ('Store','Store',true)`);
const site = await ins(`insert into public.stock_locations (name, type, job_id, usable) values ('Site','JobSite',$1,true)`, [job]);
const wpRoof = await ins(`insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, commissioning_required, sequence)
  values ($1,'Roof',true,'2026-11-16','2026-11-16','Scheduled',true,1)`, [job]);
const wpElec = await ins(`insert into public.work_packages (job_id, trade, required, planned_start, planned_end, actual_start, status, commissioning_required, sequence)
  values ($1,'Electrical',true,'2026-09-10','2026-09-10','2026-09-10','InProgress',true,2)`, [job]);
const allocFuture = await ins(`insert into public.allocations (work_package_id, person_id, role, start_at, end_at) values ($1,$2,'Lead','2026-11-16','2026-11-16')`, [wpRoof, people.inst_a]);
const allocPast = await ins(`insert into public.allocations (work_package_id, person_id, role, start_at, end_at) values ($1,$2,'Lead','2026-09-10','2026-09-10')`, [wpElec, people.inst_b]);
const mat = await ins(`insert into public.materials (job_id, work_package_id, product_id, required_quantity, unit, source, need_by_date) values ($1,$2,$3,12,'Each','Stock','2026-11-10')`, [job, wpRoof, product]);
const resFree = await ins(`insert into public.reservations (material_id, product_id, location_id, quantity) values ($1,$2,$3,8)`, [mat, product, store]);
const resPicked = await ins(`insert into public.reservations (material_id, product_id, location_id, quantity, status, picked_quantity, picked_at) values ($1,$2,$3,4,'Issued',4,now())`, [mat, product, store]);
await q(`insert into public.stock_movements (product_id, quantity, from_location_id, to_location_id, movement_type, job_id, movement_at, idempotency_key)
  values ($1,4,$2,$3,'Issue',$4,now(),'MOV-1')`, [product, store, site, job]);
const orderDraft = await ins(`insert into public.orders (job_id, merchant_id, work_type, requested_delivery_date) values ($1,$2,'Roof','2026-11-10')`, [job, merchant]);
const orderSent = await ins(`insert into public.orders (job_id, merchant_id, work_type, requested_delivery_date, status, supplier_reference, revision) values ($1,$2,'Electrical','2026-11-10','PartReceived','REF',4)`, [job, merchant]);
const line = await ins(`insert into public.order_lines (order_id, description_snapshot, quantity, unit) values ($1,'Cable',3,'Each')`, [orderSent]);
const deliv = await ins(`insert into public.deliveries (order_id, expected_date, receipt_status) values ($1,'2026-09-01','Part')`, [orderSent]);
await q(`insert into public.receipt_lines (delivery_id, order_line_id, quantity_good) values ($1,$2,1)`, [deliv, line]);
const sbErected = await ins(`insert into public.scaffold_bookings (job_id, company_id, erect_actual_at, status) values ($1,$2,'2026-09-05','Erected')`, [job, scaffolder]);
const sbPlanned = await ins(`insert into public.scaffold_bookings (job_id, company_id, erect_planned_at, status) values ($1,$2,'2026-11-14','Requested')`, [job, scaffolder]);
const outOld = await ins(`insert into public.outbox (idempotency_key, action_type, target, payload_hash, status) values ('OLD','CalendarCreate','CAL','h','Pending')`);
const outUnknown = await ins(`insert into public.outbox (idempotency_key, action_type, target, payload_hash, status, attempt_count) values ('UNK','Email','x','h','Processing',1)`);
const outDone = await ins(`insert into public.outbox (idempotency_key, action_type, target, payload_hash, status, attempt_count, correlation_id) values ('DONE','Email','x','h','Succeeded',1,$1)`, [job]);
const outUnrelated = await ins(`insert into public.outbox (idempotency_key, action_type, target, payload_hash, status) values ('OTHER','Email','x','h','Pending')`);
const link = await ins(`insert into public.calendar_links (job_id, allocation_id, calendar_id, external_event_id, producer, entity_revision, status, outbox_id)
  values ($1,$2,'CAL','EVENT','NewSystem',1,'Active',$3)`, [job, allocFuture, outOld]);
const comm = await ins(`insert into public.communications (job_id, type, subject, recipients_snapshot, status, outbox_id) values ($1,'Email','Booking','a@b','Queued',$2)`, [job, outUnknown]);
const commSent = await ins(`insert into public.communications (job_id, type, subject, recipients_snapshot, status) values ($1,'Email','Old','a@b','Sent')`, [job]);
const mkTask = (code, group, rel, status = 'Open') => ins(`insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, related_entity_type, related_entity_id, status, created_rule_version)
  values ($1,$2,$3,$4,'t',$5,$6,$7,$8,'1.0')`, [job, code, `T-${code}-${group}-${status}-${rel}`, group, people.tanya, rel, rel === 'Issues' ? wpRoof : job, status]);
const tBkg = await mkTask('BKG04', 'Booking', 'Jobs');
const tIssue = await mkTask('BKG04', 'Booking', 'Issues');
const tInstall = await mkTask('INS01', 'Install', 'Jobs');
const tMat = await mkTask('MAT01', 'Materials', 'Jobs', 'Waiting');
const tDone = await mkTask('BKG01', 'Booking', 'Jobs', 'Complete');

// ---------------------------------------------------------------- preview (read-only)
let before = await counts();
const prev = (await one(`select app.s15_preview($1, '2026-10-01') p`, [job])).p;
assert.deepEqual(await counts(), before);
assert.deepEqual(prev.risks, ['WORK_PERFORMED_OR_UNCERTAIN', 'PAYMENT_REVIEW', 'SAFE_STRIP_REQUIRED', 'PHYSICAL_STOCK_REVIEW']);
assert.equal(prev.can_cancel, true);
assert.equal(prev.would.work_packages_cancel, 1); assert.equal(prev.would.work_packages_review, 1);
assert.equal(prev.would.allocations_deactivate, 1); assert.equal(prev.would.allocations_notify, 2);
assert.equal(prev.would.reservations_release, 1); assert.equal(prev.would.reservations_review, 1);
assert.equal(prev.would.orders_cancel, 1); assert.equal(prev.would.orders_review, 1);
assert.equal(prev.would.outbox_cancel, 1); assert.equal(prev.would.outbox_review, 1);
assert.equal(prev.would.communications_fail, 1); assert.equal(prev.would.invoice_stages_review, 2);
console.log('preview ok; tasks_cancel =', prev.would.tasks_cancel);

// ---------------------------------------------------------------- CANCEL_JOB refusals
let j = await jobRow(job);
const cancelPayload = { reason: 'Customer withdrew', effective_date: '2026-10-01', work_performed: 'Electrical first fix',
  material_state: 'Picked panels on site', scaffold_state: 'Erected', finance_review: 'Deposit paid; refund review', legacy_state: 'Trello card' };
const cancelReq = { command_id: id(), command_type: 'CANCEL_JOB', job_id: job, expected_version: j.version, payload: cancelPayload };
await refuse('dan', { ...cancelReq, command_id: id() }, 'S15_REFUSED: authenticated office actor required');
await refuse('tanya', { ...cancelReq, command_id: id(), expected_version: j.version - 1 }, 'S15_REVIEW: stale job revision');
await refuse('tanya', { ...cancelReq, command_id: id(), payload: { ...cancelPayload, work_performed: undefined } }, 'R1A_REQUIRED_WORK_PERFORMED');
await refuse('tanya', { ...cancelReq, command_id: id(), payload: { ...cancelPayload, legacy_state: '  ' } }, 'S15_REVIEW: legacy_state required');
await refuse('tanya', { ...cancelReq, command_id: id(), payload: { ...cancelPayload, effective_date: '2026-02-30' } }, 'S15_DATE_INVALID');
await refuse('tanya', { ...cancelReq, command_id: id(), payload: { ...cancelPayload, bogus: 1 } }, 'R1A_INVALID_FIELDS');
await q(`update public.release_modes set mode='Disabled', authorised_job_scope='None' where function_id='FN-17'`);
await refuse('tanya', { ...cancelReq, command_id: id() }, 'R1A_MODE_DENIED');
await q(`update public.release_modes set mode='Manual', authorised_job_scope='Pilot' where function_id='FN-17'`);
await q(`update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id='FN-11'`);
await refuse('tanya', { ...cancelReq, command_id: id() }, 'S15_REFUSED: unexpected mode FN-11');
await q(`update public.release_modes set mode='Manual' where function_id='FN-11'`);
await q(`update public.task_templates set active=false where code='S15-CAN-LEGACY'`);
await refuse('tanya', { ...cancelReq, command_id: id() }, 'S15_NOT_CONFIGURED: S15-CAN-LEGACY');
await q(`update public.task_templates set active=true where code='S15-CAN-LEGACY'`);

// ---------------------------------------------------------------- CANCEL_JOB happy path
const cr = ok(await cmd('tanya', cancelReq), 'cancel');
assert.equal(cr.status, 'CancellationInProgress'); assert.equal(cr.review, true); assert.equal(cr.external_calls, 0);
j = await jobRow(job);
assert.equal(j.workflow_stage, 'CancellationInProgress'); assert.equal(j.cancellation_reason, 'Customer withdrew');
assert.equal(j.cancellation_by, people.tanya); assert.equal(j.version, cancelReq.expected_version + 1);
assert.equal((await one(`select app.london_date(cancellation_at)::text d from public.jobs where id=$1`, [job])).d, '2026-10-01');
const st = async (table, rid, col = 'status') => (await one(`select ${col} v from public.${table} where id=$1`, [rid])).v;
assert.equal(await st('work_packages', wpRoof), 'Cancelled'); assert.equal(await st('work_packages', wpRoof, 'revision'), 2);
assert.equal(await st('work_packages', wpElec), 'InProgress');
assert.equal(await st('allocations', allocFuture, 'active'), false);
assert.equal(await st('allocations', allocFuture, 'cancellation_reason'), 'Customer withdrew');
assert.equal(await st('allocations', allocPast, 'active'), true);
assert.equal(await st('tasks', tBkg), 'Cancelled'); assert.equal(await st('tasks', tBkg, 'completion_note'), 'Customer withdrew');
assert.equal(await st('tasks', tMat), 'Cancelled');
assert.equal(await st('tasks', tIssue), 'Open'); assert.equal(await st('tasks', tInstall), 'Open'); assert.equal(await st('tasks', tDone), 'Complete');
assert.equal(Number(await st('materials', mat, 'cancelled_quantity')), 12);
assert.equal(await st('reservations', resFree), 'Released'); assert.equal(await st('reservations', resPicked), 'Issued');
assert.equal((await one(`select count(*)::int n from public.stock_movements`)).n, 1);
assert.equal(await st('orders', orderDraft), 'Cancelled'); assert.equal(await st('orders', orderSent), 'Review');
assert.equal(await st('orders', orderSent, 'revision'), 5); assert.equal(await st('orders', orderSent, 'supplier_reference'), 'REF');
assert.equal(await st('scaffold_bookings', sbErected), 'Erected'); assert.equal(await st('scaffold_bookings', sbErected, 'revision'), 2);
assert.equal(await st('calendar_links', link), 'Error'); assert.equal(await st('calendar_links', link, 'external_event_id'), 'EVENT');
assert.equal(await st('calendar_links', link, 'entity_revision'), 2);
const calOut = await one(`select * from public.outbox where id=(select outbox_id from public.calendar_links where id=$1)`, [link]);
assert.equal(calOut.action_type, 'CalendarCancel'); assert.equal(calOut.status, 'NeedsReview'); assert.equal(calOut.correlation_id, job);
assert.equal(await st('outbox', outOld), 'Cancelled'); assert.equal(await st('outbox', outUnknown), 'NeedsReview');
assert.equal(await st('outbox', outDone), 'Succeeded'); assert.equal(await st('outbox', outUnrelated), 'Pending');
assert.equal(await st('communications', comm), 'Failed'); assert.equal(await st('communications', commSent), 'Sent');
const invBefore = await all(`select id, status, gross_pence, version from public.invoice_stages where job_id=$1 order by stage`, [job]);
const s15 = await all(`select * from public.tasks where job_id=$1 and task_group='Cancellation' order by template_code, related_entity_type`, [job]);
const codes = s15.map(t => `${t.template_code}:${t.related_entity_type}:${t.status}`);
console.log('cancellation tasks:', codes.join(' '));
for (const t of s15) {
  assert.equal(t.owner_id, people.tanya); assert.equal(t.priority, 1); assert.equal(t.revision_required, true);
  assert.equal(t.status, t.blocking_reason ? 'Blocked' : 'Open');
  assert.ok(t.instance_key.startsWith(`S15-${cancelReq.command_id}-${t.template_code}-`), t.instance_key);
}
const expect = ['S15-CAN-CALENDAR:CalendarLinks:Blocked', 'S15-CAN-CUSTOMER:Jobs:Open', 'S15-CAN-GHL:Jobs:Blocked',
  'S15-CAN-INSTALLER:Allocations:Open', 'S15-CAN-INSTALLER:Allocations:Open', 'S15-CAN-LEGACY:Jobs:Open',
  'S15-CAN-MERCHANT:Orders:Blocked', 'S15-CAN-REVIEW:Jobs:Blocked', 'S15-CAN-REVIEW:Outbox:Blocked',
  'S15-CAN-REVIEW:WorkPackages:Blocked', 'S15-CAN-SALES:Jobs:Open', 'S15-CAN-SCAFFOLD:ScaffoldBookings:Blocked',
  'S15-CAN-SIGNABLE:Jobs:Open', 'S15-CAN-STOCK:Jobs:Blocked', 'S15-CAN-STOCK:Reservations:Blocked',
  'S15-CAN-STRIP:ScaffoldBookings:Blocked', 'S15-CAN-XERO:InvoiceStages:Blocked', 'S15-CAN-XERO:InvoiceStages:Blocked'];
assert.deepEqual(codes, expect);
assert.match(s15.find(t => t.template_code === 'S15-CAN-REVIEW' && t.related_entity_type === 'Jobs').title, /late\/partial cancellation: WORK_PERFORMED_OR_UNCERTAIN, PAYMENT_REVIEW/);
assert.equal((await one(`select count(*)::int n from public.ghl_tasks where job_id=$1 and opportunity_id is null`, [job])).n, 1);
assert.equal((await one(`select count(*)::int n from public.task_events e join public.tasks t on t.id=e.task_id where t.id=$1 and e.action='Cancel'`, [tBkg])).n, 1);
assert.equal((await one(`select count(*)::int n from public.audit_events where command_id=$1`, [cancelReq.command_id])).n, cr.affected);
// normal work suppressed
await assert.rejects(q(`select app.assert_normal_work($1)`, [job]), /S15_REVIEW: normal work suppressed/);

// replay / conflict / second cancellation
before = await counts();
const rep = await cmd('tanya', cancelReq); assert.equal(rep.replayed, true); assert.equal(rep.result.status, 'CancellationInProgress');
assert.deepEqual(await counts(), before);
await refuse('tanya', { ...cancelReq, payload: { ...cancelPayload, reason: 'different' } }, 'R1A_COMMAND_CONFLICT');
j = await jobRow(job);
await refuse('tanya', { ...cancelReq, command_id: id(), expected_version: j.version }, 'S15_REVIEW: cancellation already started; replay original command');

// ---------------------------------------------------------------- CANCELLATION_CLOSE blocked by confirmations
const pendingTracked = async () => (await all(`select id from public.tasks where job_id=$1 and task_group='Cancellation' and status not in ('Complete','NotRequired')`, [job]))
  .map(t => ({ task_id: t.id, reference: 'TRACK-1', reason: 'Retained owned obligation' }));
j = await jobRow(job);
await refuse('tanya', { command_id: id(), command_type: 'CANCELLATION_CLOSE', job_id: job, expected_version: j.version,
  payload: { reason: 'close', tracked_obligations: await pendingTracked() } }, /^S15_REVIEW: confirmation outstanding /);

// ---------------------------------------------------------------- CANCELLATION_RESOLVE
const taskOf = (code, type) => one(`select * from public.tasks where job_id=$1 and template_code=$2 and ($3::text is null or related_entity_type=$3) order by created_at limit 1`, [job, code, type ?? null]);
const resolve = async (who, t, payload, extra = {}) => {
  const jj = await jobRow(job);
  return cmd(who, { command_id: id(), command_type: 'CANCELLATION_RESOLVE', job_id: job, task_id: t.id, expected_version: jj.version,
    payload: { reason: 'resolved', task_version: t.version, evidence_reference: 'EV-1', ...payload }, ...extra });
};
let t = await taskOf('S15-CAN-MERCHANT');
const resolveBase = async (payload, extra = {}) => { const jj = await jobRow(job); return { command_id: id(), command_type: 'CANCELLATION_RESOLVE', job_id: job, task_id: t.id,
  expected_version: jj.version, payload: { reason: 'resolved', task_version: t.version, evidence_reference: 'EV-1', ...payload }, ...extra }; };
await refuse('tanya', await resolveBase({ confirmed_revision: 4, outcome: 'Confirmed' }), 'S15_REVIEW: latest revision confirmation required; sent is not confirmed');
await refuse('tanya', await resolveBase({ confirmed_revision: 5, outcome: 'Sent' }), 'S15_REVIEW: latest revision confirmation required; sent is not confirmed');
await refuse('tanya', await resolveBase({ confirmed_revision: 5, outcome: 'Confirmed', task_version: t.version + 1 }), 'S15_REVIEW: stale task revision');
await refuse('tanya', await resolveBase({ confirmed_revision: 5, outcome: 'Confirmed', evidence_reference: undefined }), 'S15_REVIEW: open cancellation task and evidence required');
await refuse('tanya', await resolveBase({ confirmed_revision: 5, outcome: 'Confirmed' }, { expected_version: 1 }), 'S15_REVIEW: stale job revision');
await refuse('dan', await resolveBase({ confirmed_revision: 5, outcome: 'Confirmed' }), 'S15_REFUSED: authenticated office actor required');
await q(`update public.release_modes set mode='Disabled', authorised_job_scope='None' where function_id='FN-20'`);
await refuse('tanya', await resolveBase({ confirmed_revision: 5, outcome: 'Confirmed' }), 'R1A_MODE_DENIED');
await q(`update public.release_modes set mode='Manual', authorised_job_scope='Pilot' where function_id='FN-20'`);
const jv = (await jobRow(job)).version;
let rr = ok(await resolve('tanya', t, { confirmed_revision: 5, outcome: 'Confirmed' }), 'resolve merchant');
assert.equal(rr.task.status, 'Complete'); assert.equal(rr.task.revision_required, false); assert.equal(rr.task.completion_note, 'resolved; evidence: EV-1');
assert.equal(await st('orders', orderSent), 'Cancelled'); assert.equal(await st('orders', orderSent, 'confirmed_revision'), 5);
assert.equal((await jobRow(job)).version, jv + 1);
await refuse('tanya', await resolveBase({ confirmed_revision: 5, outcome: 'Confirmed' }), 'S15_REVIEW: open cancellation task and evidence required');
t = await taskOf('S15-CAN-SCAFFOLD');
ok(await resolve('tanya', t, { confirmed_revision: 2, outcome: 'Confirmed' }), 'resolve scaffold');
assert.equal(await st('scaffold_bookings', sbPlanned), 'Cancelled');
t = await taskOf('S15-CAN-STRIP');
await refuse('tanya', await resolveBase({ confirmed_revision: 2, outcome: 'Confirmed' }), 'S15_DATE_INVALID');
ok(await resolve('tanya', t, { confirmed_revision: 2, outcome: 'Confirmed', actual_date: '2026-10-05' }), 'resolve strip');
assert.equal((await one(`select strip_actual_at::text d from public.scaffold_bookings where id=$1`, [sbErected])).d, '2026-10-05');
t = await taskOf('S15-CAN-CALENDAR');
ok(await resolve('tanya', t, { confirmed_revision: 2, outcome: 'Confirmed' }), 'resolve calendar');
assert.equal(await st('calendar_links', link), 'Cancelled'); assert.equal(await st('calendar_links', link, 'last_synced_revision'), 2);
assert.equal(await st('outbox', calOut.id), 'Cancelled');
t = await taskOf('S15-CAN-GHL');
await refuse('tanya', await resolveBase({}), 'S15_NOT_CONFIGURED: GHL cancellation IDs');
t = await taskOf('S15-CAN-CUSTOMER');
rr = ok(await resolve('tanya', t, {}), 'resolve customer');
assert.equal((await one(`select count(*)::int n from public.task_events where task_id=$1 and action='Complete'`, [t.id])).n, 1);

// ---------------------------------------------------------------- CANCELLATION_CLOSE
j = await jobRow(job);
const tracked = await pendingTracked();
await refuse('tanya', { command_id: id(), command_type: 'CANCELLATION_CLOSE', job_id: job, expected_version: j.version,
  payload: { reason: 'close' } }, /^S15_REVIEW: unresolved obligation must be explicitly tracked /);
await refuse('tanya', { command_id: id(), command_type: 'CANCELLATION_CLOSE', job_id: job, expected_version: j.version,
  payload: { reason: 'close', tracked_obligations: tracked.map((x, i) => i ? x : { ...x, reference: ' ' }) } }, /^S15_REVIEW: unresolved obligation must be explicitly tracked /);
const closeReq = { command_id: id(), command_type: 'CANCELLATION_CLOSE', job_id: job, expected_version: j.version,
  payload: { reason: 'Obligations tracked', tracked_obligations: tracked } };
const cl = ok(await cmd('tanya', closeReq), 'close');
assert.equal(cl.status, 'Cancelled'); assert.equal(cl.tracked_obligations.length, tracked.length);
assert.equal((await jobRow(job)).workflow_stage, 'Cancelled');
assert.equal((await cmd('tanya', closeReq)).replayed, true);
j = await jobRow(job);
await refuse('tanya', { ...closeReq, command_id: id(), expected_version: j.version }, 'S15_REVIEW: cancellation not in progress');

// ---------------------------------------------------------------- REINSTATE_JOB
const reinPayload = { reason: 'Customer back', new_date: '2026-12-01', commitment_review: 'Fresh planning only',
  finance_review: 'Deposit reused', evidence_reference: 'EV-REOPEN' };
const rein = (payload, extra = {}) => ({ command_id: id(), command_type: 'REINSTATE_JOB', job_id: job, expected_version: j.version,
  payload: { ...reinPayload, ...payload }, ...extra });
await refuse('tanya', rein({}), 'S15_REVIEW: late/partial work requires explicit risk review');
await refuse('tanya', rein({ risk_review: 'Reviewed', new_date: '2026-10-01' }), 'S15_REVIEW: fresh date after cancellation required');
await refuse('tanya', rein({ risk_review: 'Reviewed', new_date: 'soon' }), 'S15_DATE_INVALID');
await refuse('tanya', rein({ risk_review: 'Reviewed', evidence_reference: undefined }), 'R1A_REQUIRED_EVIDENCE_REFERENCE');
await refuse('tanya', rein({ risk_review: 'Reviewed', finance_review: ' ' }), 'S15_REVIEW: commitments, invoice/order reuse and evidence review required');
await refuse('dan', rein({ risk_review: 'Reviewed' }), 'S15_REFUSED: authenticated office actor required');
const reinReq = rein({ risk_review: 'Reviewed performed electrical work; no reversal' });
const ri = ok(await cmd('tanya', reinReq), 'reinstate');
assert.equal(ri.status, 'Prebooking');
j = await jobRow(job);
assert.equal(j.workflow_stage, 'Prebooking'); assert.equal(j.cancellation_at, null); assert.equal(j.cancellation_reason, null);
assert.equal(j.booking_approved_at, null);
assert.equal((await one(`select app.london_date(next_action_at)::text d from public.jobs where id=$1`, [job])).d, '2026-12-01');
const fresh = await all(`select * from public.work_packages where job_id=$1 and parent_package_id is not null`, [job]);
assert.equal(fresh.length, 1); assert.equal(fresh[0].parent_package_id, wpRoof); assert.equal(fresh[0].status, 'Unscheduled');
assert.equal(fresh[0].revision, 3); assert.equal(await st('work_packages', wpRoof), 'Cancelled');
assert.equal(await st('allocations', allocFuture, 'active'), false);
assert.deepEqual(await all(`select id, status, gross_pence, version from public.invoice_stages where job_id=$1 order by stage`, [job]), invBefore);
const review = await taskOf('S15-REOPEN-REVIEW');
assert.equal(review.status, 'Open'); assert.equal(review.revision_required, true);
await assert.rejects(q(`select app.assert_normal_work($1)`, [job]), /S15_REVIEW: normal work suppressed/);
assert.equal((await cmd('tanya', reinReq)).replayed, true);
// TASK_COMPLETE cannot complete it (revision_required) - that is why REOPEN_REVIEW_COMPLETE exists
await refuse('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: review.id, expected_version: review.version,
  payload: { completion_note: 'x' } }, 'R1A_TASK_NOT_COMPLETABLE');

// ---------------------------------------------------------------- REOPEN_REVIEW_COMPLETE
const rrc = (payload, extra = {}) => ({ command_id: id(), command_type: 'REOPEN_REVIEW_COMPLETE', job_id: job, task_id: review.id,
  expected_version: review.version, payload, ...extra });
await refuse('tanya', rrc({}), 'R1A_REQUIRED_NOTE');
await refuse('dan', rrc({ note: 'ok' }), 'S15_REFUSED: authenticated office actor required');
await refuse('tanya', rrc({ note: 'ok' }, { expected_version: review.version + 1 }), 'S15_REVIEW: stale task revision');
await refuse('tanya', rrc({ note: 'ok' }, { task_id: (await taskOf('S15-CAN-SALES')).id }), 'S15_REVIEW: open reopen review task required');
const rrcReq = rrc({ note: 'Fresh dates and reuse reviewed' });
const done = ok(await cmd('tanya', rrcReq), 'reopen review complete');
assert.equal(done.status, 'Completed'); assert.equal(done.task.status, 'Complete'); assert.equal(done.task.revision_required, false);
assert.equal(done.normal_work_suppressed, false);
await q(`select app.assert_normal_work($1)`, [job]); // no longer raises
assert.equal((await cmd('tanya', rrcReq)).replayed, true);
await refuse('tanya', rrc({ note: 'again' }, { expected_version: done.task.version }), 'S15_REVIEW: open reopen review task required');
// normal work resumes: booking gates run
j = await jobRow(job);
ok(await cmd('tanya', { command_id: id(), command_type: 'BOOKING_GATES', job_id: job, expected_version: j.version }), 'gates after reopen');

// ---------------------------------------------------------------- second job: Phoenix, no invoice stages, external scaffold + risk
const sold2 = await f.sell('tanya', { customer: { first_name: 'Bo', last_name: 'Lee', address_line1: '2 Low St', town: 'York', postcode: 'YO1 1AA' },
  sale: { finance_route: 'Phoenix' } });
assert.ok(!sold2.error, JSON.stringify(sold2));
const job2 = sold2.job_id;
await f.as('tanya');
await q(`delete from public.invoice_stages where job_id=$1`, [job2]); // exercise the no-invoice FINANCE branch
await q(`insert into public.stock_movements (product_id, quantity, from_location_id, to_location_id, movement_type, job_id, movement_at, idempotency_key)
  values ($1,1,$2,$3,'Issue',$4,now(),'MOV-2')`, [product, store, site, job2]);
const j2 = await jobRow(job2);
const c2 = ok(await cmd('ben', { command_id: id(), command_type: 'CANCEL_JOB', job_id: job2, expected_version: j2.version,
  payload: { ...cancelPayload, material_state: 'None', legacy_state: 'None', scaffold_state: 'External scaffold agreed' } }), 'cancel2');
const codes2 = (await all(`select template_code || ':' || coalesce(title,'') c, instance_key from public.tasks where job_id=$1 and task_group='Cancellation' order by 1`, [job2]));
console.log('job2 tasks:', codes2.map(x => x.c.split(':')[0]).join(' '));
const names2 = codes2.map(x => x.c.split(':')[0]);
for (const code of ['S15-CAN-FINANCE', 'S15-CAN-PHOENIX', 'S15-CAN-STOCK', 'S15-CAN-CUSTOMER', 'S15-CAN-SALES', 'S15-CAN-GHL']) assert.ok(names2.includes(code), code);
assert.ok(!names2.includes('S15-CAN-LEGACY')); assert.ok(!names2.includes('S15-CAN-XERO'));
assert.equal(names2.filter(c => c === 'S15-CAN-REVIEW').length, 2, 'scaffold reconcile + late review both kept');
assert.ok(codes2.some(x => x.instance_key.endsWith('-SCAFFOLD')));
assert.equal((await one(`select owner_id from public.tasks where job_id=$1 and template_code='S15-CAN-GHL'`, [job2])).owner_id, people.ben);
// PRE tasks cancelled, PRE03 (Prebooking group) cancelled too
assert.equal((await one(`select count(*)::int n from public.tasks where job_id=$1 and template_code like 'PRE%' and status='Cancelled'`, [job2])).n > 0, true);
// Reinstate from CancellationInProgress refused
await refuse('ben', { command_id: id(), command_type: 'REINSTATE_JOB', job_id: job2, expected_version: (await jobRow(job2)).version,
  payload: { ...reinPayload, risk_review: 'x' } }, 'S15_REVIEW: only Cancelled can reopen');
// Resolve on a job that is not cancelling
const someTask = await one(`select * from public.tasks where job_id=$1 and template_code='S15-CAN-SALES'`, [job]);
await refuse('tanya', { command_id: id(), command_type: 'CANCELLATION_RESOLVE', job_id: job, task_id: someTask.id, expected_version: (await jobRow(job)).version,
  payload: { reason: 'x', task_version: someTask.version, evidence_reference: 'e' } }, 'S15_REVIEW: cancellation not active');

console.log('t_s15: ALL PASSED');
