// View-port material list reads (MATERIALS_BOARD, ORDERS_LIST, STOCK_OVERVIEW).
// Run with PORT_ALL=1 (the runner does).
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, cmd, id, ok, sell, as } = f;
async function ops(who, request) {
  await as(who);
  try { return (await db.query(`select public.execute_operations_read($1::jsonb) r`, [request])).rows[0].r; }
  catch (e) { return { error: e.message }; }
}
const data = (r, msg) => { if (!r || !r.ok) { console.log('FAILED:', msg, r); process.exit(1); } return r.data; };

await db.query(`update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id in ('FN-03','FN-05')`);
const gt = (await one(`insert into public.companies (name, type, standard_lead_days, delivery_weekday) values ('Greentech','Merchant',14,4) returning id`)).id;
const p460 = (await one(`insert into public.products (sku, name, category, unit, stock_tracked, default_supplier_id)
  values ('P460','460W Solar Panel','Panel','Each',true,$1) returning id`, [gt])).id;

await db.query(`insert into public.stock_locations (name, type, usable) values ('Main store','Store',true),('Quarantine','Quarantine',false),('Suppliers','Supplier',false)`);
const sold = await sell('tanya', { customer: { last_name: 'Board' } });
const job = sold.job_id;
const wp = (await one(`insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, sequence, commissioning_required)
  values ($1,'Roof',true,current_date + 60,current_date + 60,'Scheduled',1,true) returning id`, [job])).id;

const add = async (payload) => {
  const v = (await one(`select version from public.jobs where id=$1`, [job])).version;
  return ok(await cmd('tanya', { command_id: id(), command_type: 'MATERIAL_ADD', job_id: job, work_package_id: wp, expected_version: v, payload }), 'material add');
};
await add({ source: 'ToOrder', product_id: p460, required_quantity: 12 });
await add({ source: 'ToOrder', description: 'Bird netting', unit: 'Metre', required_quantity: 10, merchant_id: gt });

// ---- MATERIALS_BOARD ------------------------------------------------------------
let r = data(await ops('tanya', { read_type: 'MATERIALS_BOARD' }), 'board');
assert.equal(r.total, 1);
assert.equal(r.jobs[0].job_id, job); assert.equal(r.jobs[0].to_order, 2); assert.equal(r.jobs[0].lines, 2);
assert.ok(r.jobs[0].install_date);
r = data(await ops('store', { read_type: 'MATERIALS_BOARD', q: 'nobody' }), 'store search');
assert.equal(r.total, 0);

ok(await cmd('tanya', { command_id: id(), command_type: 'ORDERS_BUILD', job_id: job, payload: {} }), 'orders build');
r = data(await ops('tanya', { read_type: 'MATERIALS_BOARD' }), 'board after build');
assert.equal(r.jobs[0].to_order, 0); assert.equal(r.jobs[0].drafted, 2);

// ---- ORDERS_LIST ----------------------------------------------------------------
r = data(await ops('tanya', { read_type: 'ORDERS_LIST' }), 'orders');
assert.equal(r.total, 1);
const order = r.orders[0];
assert.equal(order.status, 'Draft'); assert.equal(order.merchant, 'Greentech'); assert.equal(order.job_id, job);
assert.equal(order.line_count, 2); assert.equal(Number(order.outstanding), 22);
assert.equal(order.acknowledgement_required, false);
assert.equal(r.counts.Draft, 1);
assert.deepEqual(r.merchants.map(m => m.name), ['Greentech']);
r = data(await ops('tanya', { read_type: 'ORDERS_LIST', status: 'Requested,Confirmed' }), 'status filter');
assert.equal(r.total, 0);
r = data(await ops('tanya', { read_type: 'ORDERS_LIST', q: 'greentech' }), 'text');
assert.equal(r.total, 1);
assert.equal((await ops('tanya', { read_type: 'ORDERS_LIST', status: 'Nope' })).error, 'R1A_INVALID_FIELDS');
assert.equal((await ops('sam', { read_type: 'ORDERS_LIST' })).error, 'R1A_ROLE_DENIED');

// Sending asks for an acknowledgement.
ok(await cmd('tanya', { command_id: id(), command_type: 'ORDER_SEND', job_id: job, expected_version: order.version, payload: { order_id: order.id } }), 'send');
r = data(await ops('tanya', { read_type: 'ORDERS_LIST', status: 'Requested' }), 'requested');
assert.equal(r.orders[0].acknowledgement_required, true);

// ---- STOCK_OVERVIEW ---------------------------------------------------------------
const pv = (await one(`select version from public.products where id=$1`, [p460])).version;
ok(await cmd('store', { command_id: id(), command_type: 'STOCK_OPENING_COUNT', expected_version: pv,
  payload: { product_id: p460, quantity: 30, reason: 'first count' } }), 'opening');
r = data(await ops('store', { read_type: 'STOCK_OVERVIEW' }), 'stock');
assert.equal(r.configured, true);
const p = r.products.find(x => x.product_id === p460);
assert.equal(Number(p.store_balance), 30); assert.equal(Number(p.available), 30); assert.equal(p.has_opening, true);
ok(await cmd('store', { command_id: id(), command_type: 'STOCKTAKE_START', payload: {} }), 'stocktake');
r = data(await ops('store', { read_type: 'STOCK_OVERVIEW' }), 'stock with stocktake');
assert.equal(r.stocktakes.length, 1); assert.equal(r.stocktakes[0].status, 'Draft');
assert.equal(r.stocktakes[0].items[0].name, '460W Solar Panel');
assert.equal((await ops('tanya', { read_type: 'STOCK_OVERVIEW' })).error, 'R1A_ROLE_DENIED');

console.log('t_materials_views: all assertions passed');
