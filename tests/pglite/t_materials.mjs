// R2 materials and ordering (FN-03): 20260919161000_r2_materials_ordering.sql
// Run: PORT_EXTRA=20260919161000_r2_materials_ordering.sql node t_materials.mjs
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok, sell } = f;
const val = async (sql, p = []) => Object.values(await one(sql, p))[0];
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
async function opRead(who, request) {
  await f.as(who);
  try { return (await db.query(`select public.execute_operations_read($1::jsonb) r`, [request])).rows[0].r; }
  catch (e) { return { error: e.message }; }
}
const counts = async () => one(`select
  (select count(*)::int from public.materials) m, (select count(*)::int from public.orders) o,
  (select count(*)::int from public.order_lines) ol, (select count(*)::int from public.tasks) t,
  (select count(*)::int from public.communications) c, (select count(*)::int from public.deliveries) d,
  (select count(*)::int from public.acknowledgements) a, (select count(*)::int from public.audit_events) au,
  (select count(*)::int from public.commands) cm`);

// ---- pure date arithmetic (reference MAT 01, spec worked example) ----------
assert.equal(iso(await val(`select app.mat_delivery_date('2026-11-04', 4)`)), '2026-10-29');
assert.equal(iso(await val(`select app.mat_delivery_date('2026-11-16', 4)`)), '2026-11-12');
assert.equal(iso(await val(`select app.mat_delivery_date('2026-11-08', 4)`)), '2026-10-29', 'Sunday belongs to the week of Mon 2 Nov');
assert.equal(iso(await val(`select app.mat_delivery_date('2026-11-04', null)`)), '2026-10-29', 'default Thursday');
assert.equal(iso(await val(`select app.mat_delivery_date('2026-11-04', 2)`)), '2026-10-27');
assert.equal(iso(await val(`select app.mat_delivery_date('2026-11-04', 7)`)), '2026-10-29', 'Sunday weekday -> default');
assert.equal(iso(await val(`select app.mat_list_date('2026-10-29')`)), '2026-10-23');
assert.equal(iso(await val(`select app.mat_list_date('2026-11-12')`)), '2026-11-06');
assert.equal(iso(await val(`select app.mat_monday('2026-09-13')`)), '2026-09-07');
// Day start/end are Europe/London (BST in October, GMT after 25 Oct).
assert.equal((await val(`select app.mat_day_end('2026-09-14')`)).toISOString(), '2026-09-14T16:00:00.000Z');
assert.equal((await val(`select app.mat_day_end('2026-10-28')`)).toISOString(), '2026-10-28T17:00:00.000Z');
assert.equal((await val(`select app.mat_day_start('2026-10-15')`)).toISOString(), '2026-10-15T08:00:00.000Z');

// ---- configuration ----------------------------------------------------------
await db.query(`update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id='FN-03'`);
const gt = (await one(`insert into public.companies (name, type, standard_lead_days, delivery_weekday) values ('Greentech','Merchant',14,4) returning id`)).id;
const cef = (await one(`insert into public.companies (name, type, standard_lead_days, delivery_weekday) values ('CEF','Merchant',7,4) returning id`)).id;
const scaf = (await one(`insert into public.companies (name, type) values ('Scaffold Co','Scaffolder') returning id`)).id;
await db.query(`insert into public.contacts (company_id, name, email) values ($1,'Tom','tom@greentech.test')`, [gt]);
const p460 = (await one(`insert into public.products (sku, name, category, unit, stock_tracked, default_supplier_id, unit_cost_pence)
  values ('P460','460W Solar Panel','Panel','Each',true,$1,9000) returning id`, [gt])).id;
const p515 = (await one(`insert into public.products (sku, name, category, unit, stock_tracked, default_supplier_id)
  values ('P515','515W Solar Panel','Panel','Each',true,$1) returning id`, [gt])).id;
assert.equal(await val(`select app.mat_lead_risk('2026-10-29', $1, '2026-09-14')::text`, [gt]),
  '{"at_risk": false, "lead_days": 14, "latest_order_date": "2026-10-15"}');

const sold = await sell('tanya');
assert.ok(!sold.error, JSON.stringify(sold));
const job = sold.job_id;
const today = iso(await val(`select app.london_date(now())`));
const monday = iso(await val(`select app.mat_monday($1::date)`, [today]));
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const roofStart = addDays(monday, 42 + 2), elecStart = addDays(monday, 56);
const roofDel = addDays(monday, 42 - 7 + 3), elecDel = addDays(monday, 56 - 7 + 3);
const wpRoof = (await one(`insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, commissioning_required, sequence)
  values ($1,'Roof',true,$2,$2,'Scheduled',true,1) returning id`, [job, roofStart])).id;
const wpElec = (await one(`insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, commissioning_required, sequence)
  values ($1,'Electrical',true,$2,$2,'Scheduled',true,2) returning id`, [job, elecStart])).id;

const jobVer = async () => (await one(`select version from public.jobs where id=$1`, [job])).version;
const order = async oid => one(`select * from public.orders where id=$1`, [oid]);
const add = async (payload, extra = {}) => cmd(extra.who || 'tanya', { command_id: extra.cid || id(), command_type: 'MATERIAL_ADD', job_id: job,
  ...(extra.wp ? { work_package_id: extra.wp } : {}), expected_version: extra.ver ?? await jobVer(), payload });
const ocmd = async (type, oid, payload = {}, extra = {}) => cmd(extra.who || 'tanya', { command_id: extra.cid || id(), command_type: type,
  job_id: extra.job || job, expected_version: extra.ver ?? (await order(oid))?.version ?? 1, payload: { order_id: oid, ...payload } });
const tasksOf = async (type, eid) => (await all(`select template_code||':'||status s from public.tasks where related_entity_type=$1 and related_entity_id=$2 order by 1`, [type, eid])).map(r => r.s);
const dueOf = async key => (await one(`select due_at from public.tasks where instance_key=$1`, [key])).due_at.toISOString();
const sqlTs = async (sql, p = []) => (await val(sql, p)).toISOString();

// ---- release mode + role refusals write nothing ------------------------------
await db.query(`update public.release_modes set mode='Disabled' where function_id='FN-03'`);
let before = await counts();
let r = await add({ source: 'ToOrder', product_id: p460, required_quantity: 10 }, { wp: wpRoof });
assert.equal(r.error, 'R1A_MODE_DENIED');
await db.query(`update public.release_modes set mode='Automated' where function_id='FN-03'`);
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 10 }, { wp: wpRoof, who: 'store' })).error, 'R1A_ROLE_DENIED');
assert.deepEqual(await counts(), before, 'refusals wrote nothing');

// ---- MATERIAL_ADD --------------------------------------------------------------
const v0 = await jobVer();
const panelsCid = id();
const panelsReq = { command_id: panelsCid, command_type: 'MATERIAL_ADD', job_id: job, work_package_id: wpRoof, expected_version: v0,
  payload: { source: 'ToOrder', product_id: p460, required_quantity: 10 } };
r = ok(await cmd('tanya', panelsReq), 'panels');
const matPanels = r.material.id;
assert.equal(r.status, 'Created');
assert.equal(r.material.merchant_id, gt, 'merchant defaults from product supplier');
assert.equal(r.material.need_by_date, roofDel, 'need-by from the package delivery rule');
assert.equal(r.material.unit, 'Each');
assert.equal(r.work_type, 'Roof');
assert.equal(r.lead_time_risk.lead_days, 14);
assert.equal(r.lead_time_risk.at_risk, false);
assert.equal(r.task, null, 'ToOrder raises MAT01 only when the order is built');
assert.equal(await jobVer(), v0 + 1, 'job version pinned');
assert.equal((await cmd('tanya', panelsReq)).replayed, true);
assert.equal((await cmd('tanya', { ...panelsReq, payload: { ...panelsReq.payload, required_quantity: 11 } })).error, 'R1A_COMMAND_CONFLICT');
assert.equal(await val(`select count(*)::int from public.materials where job_id=$1`, [job]), 1);

const otherJob = (await sell('tanya', { customer: { last_name: 'Jones', postcode: 'LS2 2BB', phone: '07700900002' } })).job_id;
const wpOther = (await one(`insert into public.work_packages (job_id, trade, required, status, commissioning_required, sequence) values ($1,'Roof',true,'Unscheduled',true,1) returning id`, [otherJob])).id;
before = await counts();
assert.equal((await add({ source: 'ToOrder', required_quantity: 5, merchant_id: cef }, { wp: wpElec })).error, 'MAT_REVIEW: Other materials require description and unit');
assert.equal((await add({ source: 'ToOrder', description: 'Clips', unit: 'Each', required_quantity: 5 }, { wp: wpElec })).error, 'MAT_REVIEW: merchant_id required (no product default supplier)');
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 5 })).error, 'MAT_REVIEW: need_by_date required when the work package has no planned start');
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 0, need_by_date: '2026-12-01' })).error, 'MAT_REVIEW: required_quantity must be > 0');
assert.equal((await add({ source: 'Borrowed', product_id: p460, required_quantity: 1, need_by_date: '2026-12-01' })).error, 'MAT_REVIEW: source must be ToOrder, AlreadyOrdered or Stock');
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 1, need_by_date: '2026-12-01', merchant_id: scaf })).error, 'MAT_REVIEW: active Merchant company required');
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 1, need_by_date: '2026-02-30' })).error, 'MAT_DATE_INVALID');
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 1, need_by_date: '2026-12-01' }, { ver: v0 })).error, 'MAT_STALE: version');
assert.equal((await add({ source: 'AlreadyOrdered', description: 'Rails', unit: 'Each', required_quantity: 1, merchant_id: gt, need_by_date: '2026-12-01' })).error, 'MAT_REVIEW: already_ordered_reference required');
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 1, bogus: 1 })).error, 'R1A_INVALID_FIELDS');
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 1, need_by_date: '2026-12-01' }, { wp: wpOther })).error, 'MAT_REVIEW: work package linkage invalid');
assert.deepEqual(await counts(), before, 'refusals wrote nothing');

r = ok(await add({ source: 'ToOrder', description: '6mm twin & earth', unit: 'Metre', required_quantity: 50, merchant_id: cef }, { wp: wpElec }), 'cable');
assert.equal(r.material.need_by_date, elecDel); assert.equal(r.work_type, 'Electrical');
r = ok(await add({ source: 'ToOrder', description: 'Rails', unit: 'Each', required_quantity: 8, merchant_id: gt }, { wp: wpRoof }), 'rails');
// AlreadyOrdered -> MAT02 verification (never an order), same/next staffed day end.
r = ok(await add({ source: 'AlreadyOrdered', description: 'Hooks', unit: 'Each', required_quantity: 20, merchant_id: gt, already_ordered_reference: 'GT-PRE-77' }, { wp: wpRoof }), 'ao');
assert.equal(r.task.code, 'MAT02'); assert.equal(r.task.created, true);
let t = await one(`select * from public.tasks where id=$1`, [r.task.task_id]);
assert.equal(t.owner_id, people.tanya, 'owner from the MAT02 assignment rule');
assert.equal(t.title, 'Verify already-ordered materials — Greentech ref GT-PRE-77');
assert.equal(t.due_at.toISOString(), await sqlTs(`select app.mat_day_end(app.mat_same_or_next_staffed(app.london_date(now())))`));
assert.equal(t.related_entity_type, 'Materials');
// Stock -> MAT03 due end of the staffed day before need-by.
r = ok(await add({ source: 'Stock', product_id: p515, required_quantity: 4 }, { wp: wpRoof }), 'stock');
assert.equal(r.task.code, 'MAT03');
assert.equal(await dueOf('MAT03-' + r.material.id), await sqlTs(`select app.mat_day_end(app.mat_prev_staffed($1::date - 1))`, [roofDel]));

// ---- ORDERS_BUILD ------------------------------------------------------------
before = await counts();
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} })).error,
  'MAT_CONFIG: exactly one usable Store location required', 'unconfigured store fails visibly');
assert.deepEqual(await counts(), before, 'refusal wrote nothing');
await db.query(`insert into public.stock_locations (name, type, usable) values ('Main store','Store',true), ('Quarantine','Quarantine',false)`);
const buildReq = { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} };
r = ok(await cmd('tanya', buildReq), 'build');
assert.equal(r.orders.length, 2);
const roofO = r.orders.find(o => o.work_type === 'Roof'), elecO = r.orders.find(o => o.work_type === 'Electrical');
assert.equal(roofO.merchant_id, gt); assert.equal(roofO.lines_added.length, 2); assert.equal(roofO.created, true);
assert.equal(roofO.requested_delivery_date, roofDel);
assert.equal(elecO.merchant_id, cef); assert.equal(elecO.lines_added.length, 1);
const ROOF = roofO.order_id, ELEC = elecO.order_id;
let o = await order(ROOF);
assert.equal(o.status, 'Draft'); assert.equal(o.revision, 1);
assert.ok(o.delivery_location_id, 'delivery to the configured store');
const lines = await all(`select l.* from public.order_lines l join public.materials m on m.id=l.material_id where l.order_id=$1 order by m.created_at`, [ROOF]);
assert.deepEqual(lines.map(l => [Number(l.quantity), l.unit]), [[10, 'Each'], [8, 'Each']]);
assert.equal(lines[0].description_snapshot, '460W Solar Panel (P460)');
assert.equal(Number(lines[0].unit_net_cost_pence), 9000);
assert.equal((await one(`select order_line_id from public.materials where id=$1`, [matPanels])).order_line_id, lines[0].id);
assert.equal(await dueOf('MAT01-' + ROOF), await sqlTs(`select app.mat_day_start(app.mat_prev_staffed($1::date - 14))`, [roofDel]));
assert.equal(await dueOf('MAT01-' + ELEC), await sqlTs(`select app.mat_day_start(app.mat_prev_staffed($1::date - 7))`, [elecDel]));
assert.equal((await cmd('tanya', buildReq)).replayed, true);
r = ok(await cmd('tanya', { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} }), 'build2');
assert.equal(r.orders.length, 0); assert.equal(r.status, 'NoAction');
// A later requirement appends to the Draft order and pulls the delivery date earlier.
const lateDate = addDays(roofDel, -7);
ok(await add({ source: 'ToOrder', description: 'Flashing', unit: 'Each', required_quantity: 2, merchant_id: gt, need_by_date: lateDate }, { wp: wpRoof }), 'late');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} }), 'build3');
assert.equal(r.orders[0].created, false); assert.equal(r.orders[0].order_id, ROOF);
assert.equal(iso((await order(ROOF)).requested_delivery_date), lateDate);
assert.equal(await val(`select count(*)::int from public.order_lines where order_id=$1`, [ROOF]), 3);
assert.equal(await val(`select count(*)::int from public.orders where job_id=$1`, [job]), 2);
assert.equal(await val(`select count(*)::int from public.outbox`), 0);

// ---- ORDER_SEND --------------------------------------------------------------
before = await counts();
assert.equal((await ocmd('ORDER_SEND', ROOF, {}, { ver: 99 })).error, 'MAT_STALE: version');
assert.equal((await ocmd('ORDER_SEND', id())).error, 'MAT_REVIEW: order not found');
assert.equal((await ocmd('ORDER_SEND', ROOF, {}, { job: otherJob })).error, 'R1A_ORDER_JOB_MISMATCH');
assert.equal((await ocmd('ORDER_CONFIRM', ELEC, { supplier_reference: 'x' })).error, 'MAT_REVIEW: only a Requested order can be confirmed (status Draft)');
assert.deepEqual(await counts(), before, 'refusals wrote nothing');
const sendReq = { command_id: id(), command_type: 'ORDER_SEND', job_id: job, expected_version: (await order(ROOF)).version, payload: { order_id: ROOF } };
r = ok(await cmd('tanya', sendReq), 'send');
assert.equal(r.status, 'Requested'); assert.equal(r.sent, false); assert.equal(r.external_calls, 0);
o = await order(ROOF);
assert.equal(o.sent_message_id, null);
let comm = await one(`select * from public.communications where id=$1`, [r.communication.communication_id]);
assert.equal(comm.type, 'MerchantOrder'); assert.equal(comm.status, 'Draft'); assert.equal(comm.revision, 1);
assert.equal(comm.sent_at, null); assert.equal(iso(comm.delivery_date), lateDate);
let body = JSON.parse(comm.body_snapshot);
assert.equal(body.lines.length, 3); assert.equal(body.postcode, 'LS1 1AA'); assert.equal(body.job_reference, sold.job_ref);
assert.match(body.note, /CAPTURED DRAFT/);
assert.equal(JSON.parse(comm.recipients_snapshot)[0].name, 'Tom');
assert.equal((await one(`select * from public.communication_jobs where communication_id=$1`, [comm.id])).order_id, ROOF);
assert.deepEqual(await tasksOf('Orders', ROOF), ['MAT01:Complete', 'MAT06:Open']);
assert.equal(await dueOf('MAT06-' + ROOF + '-R1'), await sqlTs(`select app.mat_day_start(app.mat_next_staffed(app.london_date(now())))`));
assert.equal((await cmd('tanya', sendReq)).replayed, true);
assert.equal(await val(`select count(*)::int from public.communications where type='MerchantOrder'`), 1);
assert.equal(await val(`select count(*)::int from public.task_events e join public.tasks t on t.id=e.task_id where t.instance_key=$1 and e.action='Complete'`, ['MAT01-' + ROOF]), 1);

// ---- ORDER_CONFIRM -----------------------------------------------------------
assert.equal((await ocmd('ORDER_CONFIRM', ROOF, {})).error, 'MAT_REVIEW: supplier_reference required');
assert.equal((await ocmd('ORDER_CONFIRM', ROOF, { supplier_reference: 'x', acknowledged_revision: 2 })).error, 'MAT_REVIEW: acknowledged_revision invalid');
r = ok(await ocmd('ORDER_CONFIRM', ROOF, { supplier_reference: 'GT-12345' }), 'confirm');
assert.equal(r.status, 'Confirmed'); assert.equal(r.outcome, 'ConfirmedLatest');
o = await order(ROOF);
assert.equal(o.supplier_reference, 'GT-12345'); assert.equal(o.confirmed_revision, 1); assert.equal(o.confirmed_by, people.tanya);
const del1 = r.delivery.id;
assert.equal(r.delivery.expected_date, lateDate); assert.equal(r.delivery.receipt_status, 'Expected');
assert.equal(await val(`select count(*)::int from public.acknowledgements where entity_id=$1 and acknowledged_revision=1`, [ROOF]), 1);
assert.deepEqual(await tasksOf('Orders', ROOF), ['MAT01:Complete', 'MAT06:Complete']);
assert.deepEqual(await tasksOf('Deliveries', del1), ['MAT04:Open']);
assert.equal(await dueOf('MAT04-' + del1), await sqlTs(`select app.mat_day_end($1::date)`, [lateDate]));
let view = (await opRead('tanya', { read_type: 'ORDER_VIEW', order_id: ROOF })).data;
assert.equal(view.acknowledgement_required, false);
assert.equal((await ocmd('ORDER_CONFIRM', ROOF, { supplier_reference: 'x' })).error, 'MAT_REVIEW: only a Requested order can be confirmed (status Confirmed)');

// ---- ORDER_REVISE (sent order: urgent inside lead time, delivery moves) --------
assert.equal((await ocmd('ORDER_REVISE', ROOF, { requested_delivery_date: roofDel })).error, 'MAT_REVIEW: reason required');
assert.equal((await ocmd('ORDER_REVISE', ROOF, { reason: 'x' })).error, 'MAT_REVIEW: requested_delivery_date or lines required');
const soon = addDays(today, 5);
r = ok(await ocmd('ORDER_REVISE', ROOF, { requested_delivery_date: soon, reason: 'Roof moved' }), 'revise');
assert.equal(r.revision, 2); assert.equal(r.status, 'Requested'); assert.equal(r.acknowledgement_required, true);
assert.equal(r.urgent, true, 'inside the 14-day lead time');
o = await order(ROOF);
assert.equal(o.confirmed_revision, 1); assert.equal(iso(o.requested_delivery_date), soon);
comm = await one(`select * from public.communications where id=$1`, [r.communication.communication_id]);
assert.equal(comm.revision, 2); assert.match(comm.subject, /^URGENT UPDATE – delivery /);
assert.equal(JSON.parse(comm.body_snapshot).supersedes_revision, 1);
assert.equal(JSON.parse(comm.body_snapshot).amendment_reason, 'Roof moved');
assert.deepEqual(await tasksOf('Orders', ROOF), ['MAT01:Complete', 'MAT06:Complete', 'MAT06:Open']);
assert.equal(await dueOf('MAT06-' + ROOF + '-R2'), await sqlTs(`select app.mat_day_end(app.mat_same_or_next_staffed(app.london_date(now())))`));
assert.equal(iso((await one(`select expected_date from public.deliveries where id=$1`, [del1])).expected_date), soon);
assert.equal(await dueOf('MAT04-' + del1), await sqlTs(`select app.mat_day_end($1::date)`, [soon]));
view = (await opRead('tanya', { read_type: 'ORDER_VIEW', order_id: ROOF })).data;
assert.equal(view.acknowledgement_required, true);
// A second revision before confirmation supersedes the open MAT06 of revision 2.
r = ok(await ocmd('ORDER_REVISE', ROOF, { requested_delivery_date: addDays(today, 60), reason: 'Moved again' }), 'revise2');
assert.equal(r.revision, 3); assert.equal(r.urgent, false); assert.equal(r.superseded_tasks.length, 1);
assert.match(r.communication ? (await one(`select subject from public.communications where id=$1`, [r.communication.communication_id])).subject : '', /\(AMENDED\)/);
assert.equal((await one(`select status from public.tasks where instance_key=$1`, ['MAT06-' + ROOF + '-R2'])).status, 'Cancelled');
assert.equal(await val(`select count(*)::int from public.task_events e join public.tasks t on t.id=e.task_id where t.instance_key=$1 and e.action='Supersede'`, ['MAT06-' + ROOF + '-R2']), 1);
assert.equal(await dueOf('MAT06-' + ROOF + '-R3'), await sqlTs(`select app.mat_day_start(app.mat_next_staffed(app.london_date(now())))`));
// Stale reply to revision 2: recorded, powerless.
before = await counts();
r = ok(await ocmd('ORDER_CONFIRM', ROOF, { supplier_reference: 'GT-OLD', acknowledged_revision: 2 }), 'stale');
assert.equal(r.status, 'StaleRefused');
o = await order(ROOF);
assert.equal(o.status, 'Requested'); assert.equal(o.confirmed_revision, 1); assert.equal(o.supplier_reference, 'GT-12345');
assert.equal((await one(`select status from public.tasks where instance_key=$1`, ['MAT06-' + ROOF + '-R3'])).status, 'Open');
const after = await counts();
assert.equal(after.a, before.a + 1); assert.equal(after.t, before.t); assert.equal(after.o, before.o);
// Confirm the latest revision: the open delivery is reused (no duplicate).
r = ok(await ocmd('ORDER_CONFIRM', ROOF, { supplier_reference: 'GT-12345-A', acknowledged_revision: 3 }), 'confirm3');
assert.equal(r.delivery.id, del1, 'open expected delivery reused');
assert.equal((await order(ROOF)).confirmed_revision, 3);
assert.equal(await val(`select count(*)::int from public.deliveries where order_id=$1`, [ROOF]), 1);
assert.equal(await dueOf('MAT04-' + del1), await sqlTs(`select app.mat_day_end($1::date)`, [addDays(today, 60)]));
assert.deepEqual((await all(`select acknowledged_revision r from public.acknowledgements where entity_id=$1 order by created_at, acknowledged_revision`, [ROOF])).map(x => x.r), [1, 2, 3]);
// Line changes: cancelled quantity mirrors onto the material; invalid amounts refused.
const line1 = lines[0].id;
r = ok(await ocmd('ORDER_REVISE', ROOF, { lines: [{ order_line_id: line1, cancelled_quantity: 2 }], reason: 'Two fewer panels' }), 'revise lines');
assert.equal(r.revision, 4);
assert.equal(Number((await one(`select cancelled_quantity from public.order_lines where id=$1`, [line1])).cancelled_quantity), 2);
const mp = await one(`select * from public.materials where id=$1`, [matPanels]);
assert.equal(Number(mp.cancelled_quantity), 2); assert.equal(mp.revision, 2);
before = await counts();
assert.equal((await ocmd('ORDER_REVISE', ROOF, { lines: [{ order_line_id: line1, cancelled_quantity: 20 }], reason: 'x' })).error, 'MAT_REVIEW: cancelled_quantity invalid');
assert.equal((await ocmd('ORDER_REVISE', ROOF, { lines: [{ order_line_id: id(), quantity: 1 }], reason: 'x' })).error, 'MAT_REVIEW: order line linkage invalid');
// Received goods block a quantity below the receipt (receipt rows are the stock module's; seeded here).
const delRow = await one(`insert into public.deliveries (order_id, expected_date, receipt_status, actual_received_at) values ($1,$2,'Partial',now()) returning id`, [ROOF, today]);
await db.query(`insert into public.receipt_lines (delivery_id, order_line_id, quantity_good, quantity_damaged) values ($1,$2,5,1)`, [delRow.id, line1]);
assert.equal((await ocmd('ORDER_REVISE', ROOF, { lines: [{ order_line_id: line1, quantity: 5 }], reason: 'x' })).error, 'MAT_REVIEW: quantity below received');
assert.equal(await val(`select app.mat_line_outstanding($1)::text`, [line1]), '2', '10 - 2 cancelled - 6 received');
assert.equal(await val(`select app.mat_order_fully_received($1)`, [ROOF]), false);
const cnow = await counts(); cnow.d -= 1; assert.deepEqual(cnow, before, 'refusals wrote nothing');
// Draft revision needs no acknowledgement.
r = ok(await ocmd('ORDER_REVISE', ELEC, { requested_delivery_date: addDays(elecDel, 1), reason: 'Electrical moved' }), 'revise draft');
assert.equal(r.acknowledgement_required, false); assert.equal(r.communication, null); assert.equal(r.status, 'Draft');

// ---- MERCHANT_WEEKLY_LIST ----------------------------------------------------
// Urgent send of the electrical order, confirmed for elecDel.
r = ok(await ocmd('ORDER_SEND', ELEC, { urgent: true }), 'send elec');
assert.equal(await dueOf('MAT06-' + ELEC + '-R2'), await sqlTs(`select app.mat_day_end(app.mat_same_or_next_staffed(app.london_date(now())))`));
ok(await ocmd('ORDER_CONFIRM', ELEC, { supplier_reference: 'CEF-1', confirmed_delivery_date: elecDel }), 'confirm elec');
const listDate = iso(await val(`select app.mat_list_date($1::date)`, [elecDel]));
const wkReq = { command_id: id(), command_type: 'MERCHANT_WEEKLY_LIST', payload: { list_date: listDate } };
r = ok(await cmd('tanya', wkReq), 'weekly');
const weekStart = addDays(listDate, 3);
assert.equal(r.week_start, weekStart);
assert.equal(r.lists.length, 1); assert.equal(r.lists[0].merchant_id, cef);
assert.equal(r.lists[0].items, 1); assert.equal(r.lists[0].unacknowledged, 0); assert.equal(r.lists[0].created, true);
comm = await one(`select * from public.communications where id=$1`, [r.lists[0].communication_id]);
assert.equal(comm.type, 'MerchantDeliveryList'); assert.equal(comm.status, 'Draft'); assert.equal(comm.job_id, null);
assert.equal(iso(comm.covered_week_start), weekStart); assert.equal(iso(comm.delivery_date), elecDel);
const item = JSON.parse(comm.body_snapshot).items[0];
assert.equal(item.postcode, 'LS1 1AA'); assert.equal(item.work_type, 'Electrical'); assert.equal(item.supplier_reference, 'CEF-1');
assert.deepEqual(r.lists[0].tasks.map(x => x.code), ['MAT05', 'MAT06']);
assert.equal(await dueOf('MAT05-' + cef + '-' + weekStart), await sqlTs(`select app.london_at($1::date, '12:00')`, [listDate]));
assert.equal(await dueOf('MAT06-LIST-' + cef + '-' + weekStart), await sqlTs(`select app.mat_day_start(app.mat_next_staffed($1::date))`, [listDate]));
assert.equal((await one(`select job_id from public.tasks where instance_key=$1`, ['MAT05-' + cef + '-' + weekStart])).job_id, null);
r = ok(await cmd('tanya', { ...wkReq, command_id: id() }), 'weekly again');
assert.ok(r.lists.every(l => l.created === false));
assert.equal(await val(`select count(*)::int from public.communications where type='MerchantDeliveryList'`), 1);
// An amended, unconfirmed order shows as unacknowledged on the next list.
ok(await ocmd('ORDER_REVISE', ELEC, { lines: [{ order_line_id: (await one(`select id from public.order_lines where order_id=$1`, [ELEC])).id, quantity: 60 }], reason: 'More cable' }), 'rev elec');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'MERCHANT_WEEKLY_LIST', payload: { list_date: listDate } }), 'weekly3');
assert.equal(r.lists[0].created, false, 'the captured list for a week is never rewritten');
// The next week's list shows the amended, unconfirmed order (delivery moved a week later).
await db.query(`update public.deliveries set expected_date = expected_date + 7 where order_id=$1`, [ELEC]);
r = ok(await cmd('tanya', { command_id: id(), command_type: 'MERCHANT_WEEKLY_LIST', payload: { list_date: addDays(listDate, 7) } }), 'weekly4');
assert.equal(r.lists[0].unacknowledged, 1);

// ---- ORDER_CANCEL ------------------------------------------------------------
// Draft cancel: silent, materials released, rebuild makes a new order.
ok(await add({ source: 'ToOrder', description: 'Isolator', unit: 'Each', required_quantity: 1, merchant_id: cef }, { wp: wpElec }), 'iso');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} }), 'build iso');
const ISO = r.orders[0].order_id;
assert.notEqual(ISO, ELEC, 'a sent order is never appended to');
const isoMat = (await one(`select material_id from public.order_lines where order_id=$1`, [ISO])).material_id;
r = ok(await ocmd('ORDER_CANCEL', ISO, { reason: 'Scope change' }), 'cancel draft');
assert.equal(r.status, 'Cancelled'); assert.equal(r.acknowledgement_required, false); assert.equal(r.communication, null);
assert.equal((await one(`select order_line_id from public.materials where id=$1`, [isoMat])).order_line_id, null);
assert.deepEqual(await tasksOf('Orders', ISO), ['MAT01:Cancelled']);
let req = (await opRead('tanya', { read_type: 'MATERIAL_REQUIREMENTS', job_id: job })).data;
assert.equal(req.items.find(i => i.material_id === isoMat).state, 'ToOrder');
assert.equal((await ocmd('ORDER_CANCEL', ISO, { reason: 'again' })).error, 'MAT_REVIEW: already cancelled');
r = ok(await cmd('tanya', { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} }), 'rebuild');
assert.equal(r.orders.length, 1); assert.notEqual(r.orders[0].order_id, ISO);
// Sent order cancellation drafts a notice and MAT06 acknowledgement.
const elecDel1 = (await one(`select id from public.deliveries where order_id=$1`, [ELEC])).id;
r = ok(await ocmd('ORDER_CANCEL', ELEC, { reason: 'Customer changed mind' }), 'cancel sent');
assert.equal(r.acknowledgement_required, true);
assert.equal((await one(`select type from public.communications where id=$1`, [r.communication.communication_id])).type, 'MerchantOrderCancellation');
assert.equal(r.task.code, 'MAT06');
assert.equal((await one(`select receipt_status from public.deliveries where id=$1`, [elecDel1])).receipt_status, 'Cancelled');
assert.deepEqual(await tasksOf('Deliveries', elecDel1), ['MAT04:Cancelled']);
// Received goods refuse cancel.
await db.query(`update public.orders set status='PartReceived' where id=$1`, [ROOF]);
assert.equal((await ocmd('ORDER_CANCEL', ROOF, { reason: 'x' })).error, 'MAT_REFUSED: goods received; use return/credit review instead of cancel');

// ---- reads -------------------------------------------------------------------
req = (await opRead('store', { read_type: 'MATERIAL_REQUIREMENTS', job_id: job })).data;
assert.equal(req.found, true);
const states = Object.fromEntries(req.items.map(i => [i.description || i.product_name, i.state]));
assert.equal(states['460W Solar Panel'], 'PartReceived');
assert.equal(states['Hooks'], 'VerifyExternalOrder');
assert.equal(states['515W Solar Panel'], 'Stock');
assert.equal(states['6mm twin & earth'], 'ToOrder', 'released by the cancelled order');
assert.equal(req.items.find(i => i.material_id === matPanels).received_good, 5);
assert.equal((await opRead('store', { read_type: 'ORDER_VIEW', order_id: id() })).data.found, false);
view = (await opRead('store', { read_type: 'ORDER_VIEW', order_id: ROOF })).data;
assert.equal(view.lines.find(l => l.id === line1).outstanding, 2);
assert.equal(view.communications.length, 4);
const q = (await opRead('store', { read_type: 'STORE_QUEUE', from: today, to: addDays(today, 90) })).data;
assert.ok(q.expected_deliveries.some(d => d.delivery_id === del1));
assert.ok(q.open_store_tasks.some(x => x.template_code === 'MAT03'));
assert.equal((await opRead('inst_a', { read_type: 'STORE_QUEUE' })).error, 'R1A_ROLE_DENIED');
assert.equal((await opRead('store', { read_type: 'STORE_QUEUE', bogus: 1 })).error, 'R1A_INVALID_FIELDS');

// ---- S15 suppression ---------------------------------------------------------
await db.query(`update public.jobs set cancellation_at = now() where id=$1`, [job]);
assert.equal((await add({ source: 'ToOrder', product_id: p460, required_quantity: 1 }, { wp: wpRoof })).error, 'S15_REVIEW: normal work suppressed');
assert.equal((await cmd('tanya', { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} })).error, 'S15_REVIEW: normal work suppressed');

// Every captured message is a Draft; nothing was queued for sending.
assert.equal(await val(`select count(*)::int from public.communications where status <> 'Draft'`), 0);
assert.equal(await val(`select count(*)::int from public.outbox`), 0);
assert.ok(await val(`select count(*)::int from public.audit_events where entity_type='Orders' and action in ('BuildOrder','Send','Confirm','Revise','Cancel')`) >= 10);
console.log('t_materials: all assertions passed');
