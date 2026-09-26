// R2 stock module: goods-in, quarantine, opening count, reserve/pick/issue,
// stocktakes, reads. Run: PORT_EXTRA=20260919162000_r2_stock.sql node t_stock.mjs
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok, sell, as } = f;
const fail = async (who, req, code, msg) => {
  const r = await cmd(who, req);
  assert.ok(
    r.error,
    `${msg}: expected ${code}, got ${JSON.stringify(r).slice(0, 300)}`
  );
  assert.ok(
    r.error.startsWith(code),
    `${msg}: expected ${code}, got ${r.error}`
  );
};
const oread = async (who, req) => {
  await as(who);
  try {
    return (
      await db.query(`select public.execute_operations_read($1::jsonb) r`, [
        req
      ])
    ).rows[0].r;
  } catch (e) {
    return { error: e.message, detail: e.detail };
  }
};
// Snapshot of every table this module writes (refusal must write nothing).
const snap = async () =>
  JSON.stringify(
    await Promise.all(
      [
        'stock_movements',
        'receipt_lines',
        'deliveries',
        'orders',
        'issues',
        'reservations',
        'stocktakes',
        'stocktake_lines',
        'tasks',
        'evidence',
        'products',
        'audit_events',
        'commands',
        'stock_locations'
      ].map((t) => all(`select * from public.${t} order by 1`))
    )
  );
const noWrite = async (who, req, code, msg) => {
  const b = await snap();
  await fail(who, req, code, msg);
  assert.equal(await snap(), b, msg + ' wrote');
};

// ---- setup ------------------------------------------------------------------
const sold = await sell('tanya');
assert.ok(!sold.error, JSON.stringify(sold));
const job = sold.job_id;
await db.query(
  `update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id in ('FN-03','FN-05')`
);
const merchant = (
  await one(
    `insert into public.companies (name, type, standard_lead_days, delivery_weekday) values ('Greentech','Merchant',14,4) returning id`
  )
).id;
const panel = (
  await one(
    `insert into public.products (sku,name,category,unit,stock_tracked) values ('P460','Panel 460','Panel','Each',true) returning id`
  )
).id;
const cable = (
  await one(
    `insert into public.products (sku,name,category,unit,stock_tracked) values ('CAB','Cable','Electrical','Metre',false) returning id`
  )
).id;
const wp = (
  await one(
    `insert into public.work_packages (job_id, trade, required, commissioning_required, sequence) values ($1,'Roof',true,false,1) returning id`,
    [job]
  )
).id;

// Unconfigured locations fail visibly.
const order = await one(
  `insert into public.orders (job_id, merchant_id, work_type, requested_delivery_date, status) values ($1,$2,'Roof','2026-10-29','Confirmed') returning *`,
  [job, merchant]
);
const l1 = (
  await one(
    `insert into public.order_lines (order_id, product_id, description_snapshot, quantity, unit) values ($1,$2,'Panel 460',10,'Each') returning id`,
    [order.id, panel]
  )
).id;
const l2 = (
  await one(
    `insert into public.order_lines (order_id, product_id, description_snapshot, quantity, unit) values ($1,$2,'Cable',50,'Metre') returning id`,
    [order.id, cable]
  )
).id;
const del = (
  await one(
    `insert into public.deliveries (order_id, expected_date, receipt_status) values ($1,'2026-10-29','Expected') returning id`,
    [order.id]
  )
).id;
const mat04 = await one(
  `select app.create_task_instance($1,'MAT04','MAT04-'||$2::text,null,null,now(),null,null,null,'Deliveries',$2::uuid) id`,
  [job, del]
);
assert.ok(mat04.id);
const receive = (over = {}) => ({
  command_id: id(),
  command_type: 'GOODS_IN_RECEIVE',
  job_id: job,
  expected_version: order.version,
  payload: {
    delivery_id: del,
    delivery_note_reference: 'DN-1',
    delivery_note_path: `${job}/dn-1.pdf`,
    lines: [
      {
        order_line_id: l1,
        quantity_good: 6,
        quantity_damaged: 1,
        quantity_short: 1
      },
      { order_line_id: l2, quantity_good: 50 }
    ]
  },
  ...over
});
await noWrite('store', receive(), 'STOCK_CONFIG', 'no locations');

const store = (
  await one(
    `insert into public.stock_locations (name,type,usable) values ('Main Store','Store',true) returning id`
  )
).id;
const quar = (
  await one(
    `insert into public.stock_locations (name,type,usable) values ('Quarantine','Quarantine',false) returning id`
  )
).id;
const ext = (
  await one(
    `insert into public.stock_locations (name,type,usable) values ('External','Supplier',false) returning id`
  )
).id;
// A second Store without a setting is ambiguous -> visible config failure; the setting resolves it.
const store2 = (
  await one(
    `insert into public.stock_locations (name,type,usable) values ('Van','Store',true) returning id`
  )
).id;
await noWrite(
  'store',
  receive(),
  'STOCK_CONFIG: exactly one Store',
  'ambiguous store'
);
await db.query(
  `insert into public.settings (key, typed_value, scope, version, effective_from, reason) values ('stock.store_location_id', to_jsonb($1::text), 'Global', 1, '2026-01-01', 'test')`,
  [store]
);

// ---- GOODS_IN_RECEIVE refusals ----------------------------------------------
await noWrite(
  'tanya',
  receive({ payload: { ...receive().payload, bogus: 1 } }),
  'R1C_INVALID_FIELDS',
  'unknown payload key'
);
await noWrite('sam', receive(), 'R1A_ROLE_DENIED', 'surveyor');
await noWrite(
  'store',
  receive({ work_package_id: wp }),
  'R1C_INVALID_FIELDS',
  'wp in envelope'
);
await noWrite(
  'store',
  receive({ expected_version: 0 }),
  'R1C_EXPECTED_VERSION_REQUIRED',
  'bad version'
);
await noWrite(
  'store',
  receive({ expected_version: order.version + 1 }),
  'R1C_STALE_VERSION',
  'stale order'
);
await noWrite(
  'store',
  receive({ job_id: undefined }),
  'R1C_JOB_MISMATCH',
  'no job'
);
await noWrite(
  'store',
  receive({ payload: { ...receive().payload, delivery_id: id() } }),
  'R1C_DELIVERY_NOT_FOUND',
  'delivery'
);
await noWrite(
  'store',
  receive({ payload: { ...receive().payload, lines: [] } }),
  'R1C_RECEIPT_LINES_REQUIRED',
  'no lines'
);
await noWrite(
  'store',
  receive({
    payload: {
      ...receive().payload,
      lines: [
        { order_line_id: l1, quantity_good: 1 },
        { order_line_id: l1, quantity_good: 1 }
      ]
    }
  }),
  'R1C_DUPLICATE_RECEIPT_LINE',
  'dup'
);
await noWrite(
  'store',
  receive({
    payload: {
      ...receive().payload,
      lines: [{ order_line_id: l1, quantity_good: '1' }]
    }
  }),
  'R1C_INVALID_QUANTITY',
  'string qty'
);
await noWrite(
  'store',
  receive({
    payload: {
      ...receive().payload,
      lines: [{ order_line_id: l1, quantity_good: 11 }]
    }
  }),
  'MAT_REVIEW: receipt exceeds outstanding',
  'exceeds'
);
await noWrite(
  'store',
  receive({
    payload: {
      ...receive().payload,
      lines: [{ order_line_id: l1, quantity_good: 0 }]
    }
  }),
  'MAT_REVIEW: receipt quantities',
  'all zero'
);
await noWrite(
  'store',
  receive({ payload: { ...receive().payload, delivery_note_reference: '' } }),
  'MAT_REVIEW: delivery_note_reference required',
  'note ref'
);
// A late invalid line writes nothing (evidence included).
await noWrite(
  'store',
  receive({
    payload: {
      ...receive().payload,
      lines: [
        { order_line_id: l1, quantity_good: 1 },
        { order_line_id: id(), quantity_good: 1 }
      ]
    }
  }),
  'MAT_REVIEW: order line linkage invalid',
  'late line'
);
await db.query(
  `update public.release_modes set mode='Disabled' where function_id='FN-03'`
);
await noWrite('store', receive(), 'R1A_MODE_DENIED', 'FN-03 off');
await db.query(
  `update public.release_modes set mode='Automated' where function_id='FN-03'`
);

// ---- GOODS_IN_RECEIVE happy path ---------------------------------------------
const rreq = receive();
let r = ok(await cmd('store', rreq), 'receive');
assert.equal(r.status, 'Discrepancy');
assert.equal(r.complete, false);
assert.equal(r.order.status, 'PartReceived');
assert.equal(r.expected_version, order.version + 1);
assert.equal(r.receipt_lines.length, 2);
assert.equal(r.issues.length, 2);
assert.equal(r.delivery.received_by, people.store);
assert.match(r.delivery.discrepancy_note, /DamagedGoods 1/);
assert.match(r.delivery.discrepancy_note, /ShortDelivery 1/);
const movs = await all(
  `select * from public.stock_movements order by movement_type`
);
assert.deepEqual(
  movs.map((m) => [
    m.movement_type,
    Number(m.quantity),
    m.from_location_id,
    m.to_location_id
  ]),
  [
    ['Damage', 1, ext, quar],
    ['Receipt', 6, ext, store]
  ],
  'untracked cable: no movement'
);
const iss = await all(
  `select * from public.issues where job_id=$1 order by category`,
  [job]
);
assert.deepEqual(
  iss.map((i) => [
    i.type,
    i.category,
    i.responsible_company_id,
    i.office_owner_id,
    i.blocks_completion
  ]),
  [
    ['Supply', 'DamagedGoods', merchant, people.tanya, false],
    ['Supply', 'ShortDelivery', merchant, people.tanya, false]
  ]
);
assert.equal(
  (await one(`select status from public.tasks where id=$1`, [mat04.id])).status,
  'Complete'
);
assert.deepEqual(r.completed_tasks, [mat04.id]);
assert.ok(r.follow_up_delivery_id && r.follow_up_task);
const fu = await one(`select * from public.tasks where id=$1`, [
  r.follow_up_task
]);
assert.equal(fu.template_code, 'MAT04');
assert.equal(fu.instance_key, 'MAT04-' + r.follow_up_delivery_id);
assert.equal(fu.status, 'Open');
const ev = await one(`select * from public.evidence where id=$1`, [
  r.evidence_id
]);
assert.equal(ev.category, 'DeliveryNote');
assert.equal(
  (
    await one(
      `select count(*)::int n from public.audit_events where command_id=$1 and entity_type in ('Deliveries','Orders')`,
      [rreq.command_id]
    )
  ).n,
  2
);
// Replay: stored result, nothing added; changed content conflicts; re-receipt refused.
let before = await snap();
const rep = await cmd('store', rreq);
assert.equal(rep.replayed, true);
assert.deepEqual(rep.result, r);
assert.equal(await snap(), before, 'replay wrote');
await noWrite(
  'store',
  { ...rreq, payload: { ...rreq.payload, discrepancy_note: 'changed' } },
  'R1A_COMMAND_CONFLICT',
  'conflict'
);
await noWrite(
  'store',
  receive({ expected_version: r.order.version }),
  'MAT_REVIEW: delivery already received',
  'twice'
);
// Balance arrives on the follow-up delivery -> Received.
const r2 = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'GOODS_IN_RECEIVE',
    job_id: job,
    expected_version: r.order.version,
    payload: {
      delivery_id: r.follow_up_delivery_id,
      delivery_note_reference: 'DN-2',
      lines: [{ order_line_id: l1, quantity_good: 3 }]
    }
  }),
  'receive balance'
);
assert.equal(r2.complete, true);
assert.equal(r2.order.status, 'Received');
assert.equal(r2.status, 'Received');
assert.equal(r2.follow_up_delivery_id, null);
assert.deepEqual(r2.completed_tasks, [r.follow_up_task]);

// ---- reads --------------------------------------------------------------------
let g = await oread('store', {
  read_type: 'GOODS_IN_DETAIL',
  payload: { delivery_id: del }
});
assert.equal(g.ok, true);
assert.equal(g.data.lines.length, 2);
assert.equal(g.data.expected_version, r2.order.version);
assert.equal(g.data.lines.find((l) => l.id === l1).outstanding, 0);
assert.equal(
  (
    await oread('store', {
      read_type: 'GOODS_IN_DETAIL',
      payload: { delivery_id: del, x: 1 }
    })
  ).error,
  'R1C_INVALID_FIELDS'
);
assert.equal(
  (
    await oread('sam', {
      read_type: 'GOODS_IN_DETAIL',
      payload: { delivery_id: del }
    })
  ).error,
  'R1A_ROLE_DENIED'
);
let b = await oread('store', {
  read_type: 'STOCK_BALANCE',
  payload: { product_id: panel }
});
assert.equal(b.data.store_balance, 9);
assert.equal(b.data.quarantine_balance, 1);
assert.equal(b.data.available, 9);
assert.equal(
  (
    await oread('tanya', {
      read_type: 'STOCK_BALANCE',
      payload: { product_id: panel }
    })
  ).error,
  'R1A_ROLE_DENIED',
  'Office cannot read balance'
);
assert.equal(
  (
    await oread('store', {
      read_type: 'STOCK_BALANCE',
      payload: { product_id: cable }
    })
  ).error,
  'R1C_STOCK_PRODUCT_REQUIRED'
);

// ---- STOCK_QUARANTINE ------------------------------------------------------------
let pv = (await one(`select version from public.products where id=$1`, [panel]))
  .version;
const q = (over = {}) => ({
  command_id: id(),
  command_type: 'STOCK_QUARANTINE',
  expected_version: pv,
  payload: {
    product_id: panel,
    quantity: 2,
    expected_balance: 9,
    reason: 'Cracked panel'
  },
  ...over
});
await noWrite('tanya', q(), 'R1A_ROLE_DENIED', 'office quarantine');
await noWrite(
  'store',
  q({ job_id: job }),
  'R1C_INVALID_FIELDS',
  'job on quarantine'
);
await noWrite(
  'store',
  q({ expected_version: pv + 1 }),
  'R1C_STALE_VERSION',
  'stale product'
);
await noWrite(
  'store',
  q({
    payload: {
      product_id: panel,
      quantity: 2,
      expected_balance: 8,
      reason: 'x'
    }
  }),
  'MAT_STALE: stock balance',
  'balance'
);
await noWrite(
  'store',
  q({
    payload: {
      product_id: panel,
      quantity: 20,
      expected_balance: 9,
      reason: 'x'
    }
  }),
  'MAT_REVIEW: insufficient stock',
  'insufficient'
);
await noWrite(
  'store',
  q({ payload: { product_id: panel, quantity: 2, expected_balance: 9 } }),
  'MAT_REVIEW: positive quantity and reason',
  'reason'
);
const qreq = q();
r = ok(await cmd('store', qreq), 'quarantine');
assert.equal(r.store_balance, 7);
assert.equal(r.quarantine_balance, 3);
assert.equal(r.expected_version, pv + 1);
before = await snap();
assert.equal((await cmd('store', qreq)).replayed, true);
assert.equal(await snap(), before);
await noWrite(
  'store',
  { ...qreq, command_id: id() },
  'R1C_STALE_VERSION',
  'old version after pin'
);
pv = r.expected_version;

// ---- STOCK_OPENING_COUNT ---------------------------------------------------------
const panel2 = await one(
  `insert into public.products (sku,name,category,unit,stock_tracked) values ('P515','Panel 515','Panel','Each',true) returning id, version`
);
const oc = {
  command_id: id(),
  command_type: 'STOCK_OPENING_COUNT',
  expected_version: panel2.version,
  payload: { product_id: panel2.id, quantity: 20, reason: 'Initial count' }
};
r = ok(await cmd('ben', oc), 'opening');
assert.equal(r.balance, 20);
await noWrite(
  'ben',
  { ...oc, command_id: id(), expected_version: r.expected_version },
  'STK_REVIEW: opening count already recorded',
  'opening twice'
);

// ---- reserve / pick / issue ----------------------------------------------------------
const mat = (
  await one(
    `insert into public.materials (job_id, work_package_id, product_id, required_quantity, unit, source, need_by_date) values ($1,$2,$3,5,'Each','Stock','2026-10-28') returning id`,
    [job, wp, panel]
  )
).id;
const mat03 = await one(
  `select app.create_task_instance($1,'MAT03','MAT03-'||$2::text,null,null,now(),null,null,null,'Materials',$2::uuid) id`,
  [job, mat]
);
const matOther = (
  await one(
    `insert into public.materials (job_id, work_package_id, product_id, required_quantity, unit, source, need_by_date, merchant_id) values ($1,$2,$3,5,'Each','ToOrder','2026-10-28',$4) returning id`,
    [job, wp, panel, merchant]
  )
).id;
const res = (over = {}) => ({
  command_id: id(),
  command_type: 'STOCK_RESERVE',
  job_id: job,
  payload: { material_id: mat },
  ...over
});
await noWrite(
  'store',
  res({ job_id: undefined }),
  'R1C_JOB_MISMATCH',
  'reserve job'
);
await noWrite(
  'store',
  res({ payload: { material_id: matOther } }),
  'STK_REVIEW: material source must be Stock',
  'source'
);
await noWrite(
  'store',
  res({ payload: { material_id: mat, product_id: panel2.id } }),
  'STK_REVIEW: substitution refused',
  'substitution'
);
await noWrite(
  'store',
  res({ payload: { material_id: mat, quantity: 6 } }),
  'STK_REVIEW: quantity exceeds outstanding',
  'over outstanding'
);
await noWrite(
  'store',
  res({ payload: { material_id: mat, expected_available: 99 } }),
  'STK_STALE: available',
  'stale available'
);
await noWrite('sam', res(), 'R1A_ROLE_DENIED', 'surveyor reserve');
// Insufficient: 7 in store, reserve 5 leaves 2; a second material asking 3 fails.
r = ok(
  await cmd(
    'store',
    res({ payload: { material_id: mat, expected_available: 7 } })
  ),
  'reserve'
);
assert.equal(r.status, 'Reserved');
assert.equal(Number(r.reservation.quantity), 5);
assert.equal(r.available, 2);
const resv = r.reservation;
await noWrite(
  'store',
  res(),
  'STK_REVIEW: material already has an active reservation',
  'double reserve'
);
const mat2 = (
  await one(
    `insert into public.materials (job_id, work_package_id, product_id, required_quantity, unit, source, need_by_date) values ($1,$2,$3,3,'Each','Stock','2026-10-28') returning id`,
    [job, wp, panel]
  )
).id;
await noWrite(
  'store',
  res({ payload: { material_id: mat2 } }),
  'STK_INSUFFICIENT',
  'insufficient'
);
b = await oread('store', {
  read_type: 'STOCK_BALANCE',
  payload: { product_id: panel }
});
assert.equal(b.data.reserved, 5);
assert.equal(b.data.available, 2);
assert.equal(b.data.store_balance, 7);
// Quarantine is balance-checked (reference), not availability-checked.
pv = b.data.expected_version;
// Pick then issue.
const pk = {
  command_id: id(),
  command_type: 'STOCK_PICK',
  job_id: job,
  expected_version: resv.version,
  payload: { reservation_id: resv.id, picked_quantity: 5 }
};
await noWrite(
  'store',
  { ...pk, payload: { reservation_id: resv.id, picked_quantity: 6 } },
  'STK_REVIEW: picked quantity',
  'over pick'
);
await noWrite(
  'store',
  { ...pk, expected_version: resv.version + 1 },
  'R1C_STALE_VERSION',
  'stale res'
);
r = ok(await cmd('store', pk), 'pick');
assert.equal(r.status, 'Picked');
assert.equal(
  (
    await one(
      `select count(*)::int n from public.stock_movements where movement_type='Issue'`
    )
  ).n,
  0,
  'picking never moves stock'
);
const iq = {
  command_id: id(),
  command_type: 'STOCK_ISSUE',
  job_id: job,
  expected_version: r.expected_version,
  payload: { reservation_id: resv.id, expected_balance: 7 }
};
await noWrite(
  'store',
  { ...iq, payload: { reservation_id: resv.id, quantity: 6 } },
  'STK_REVIEW: issue quantity exceeds picked',
  'over issue'
);
await noWrite(
  'store',
  { ...iq, payload: { reservation_id: resv.id, expected_balance: 6 } },
  'STK_STALE: stock balance',
  'stale balance'
);
r = ok(await cmd('store', iq), 'issue');
assert.equal(r.status, 'Issued');
assert.equal(r.store_balance, 2);
assert.equal(r.outstanding, 0);
assert.deepEqual(r.completed_tasks, [mat03.id]);
const site = await one(`select * from public.stock_locations where id=$1`, [
  r.site_location_id
]);
assert.equal(site.type, 'JobSite');
assert.equal(site.job_id, job);
await noWrite(
  'store',
  { ...iq, command_id: id(), expected_version: r.reservation.version },
  'STK_REVIEW: reservation must be Active',
  'issue twice'
);
await noWrite(
  'store',
  res(),
  'STK_REVIEW: nothing outstanding',
  'fully issued'
);
let pick = await oread('tanya', {
  read_type: 'STOCK_JOB_PICKING',
  payload: { job_id: job }
});
assert.equal(pick.data.items.length, 2);
assert.equal(
  pick.data.summary,
  'Blocked',
  'mat2 cannot be covered (2 available, 3 needed)'
);

// S15 suppression.
await db.query(`update public.jobs set cancellation_at = now() where id=$1`, [
  job
]);
await noWrite(
  'store',
  res({ payload: { material_id: mat2, quantity: 1 } }),
  'R1C_JOB_NOT_ACTIONABLE',
  'cancelling job'
);
await db.query(`update public.jobs set cancellation_at = null where id=$1`, [
  job
]);

// ---- stocktakes ---------------------------------------------------------------------------
const st = { command_id: id(), command_type: 'STOCKTAKE_START', payload: {} };
await noWrite('tanya', st, 'R1A_ROLE_DENIED', 'office stocktake');
r = ok(await cmd('store', st), 'start');
const take = r.stocktake.id;
assert.equal(r.lines.length, 2);
await noWrite(
  'store',
  { ...st, command_id: id() },
  'STK_REVIEW: an open stocktake already exists',
  'second open'
);
const count = (product, qty, extra = {}) => ({
  command_id: id(),
  command_type: 'STOCKTAKE_COUNT',
  payload: {
    stocktake_id: take,
    product_id: product,
    counted_quantity: qty,
    ...extra
  }
});
await noWrite(
  'store',
  count(panel, 1),
  'STK_REVIEW: variance reason required',
  'reason'
);
await noWrite(
  'store',
  {
    command_id: id(),
    command_type: 'STOCKTAKE_APPROVE',
    payload: { stocktake_id: take }
  },
  'STK_REVIEW: only a stocktake in Review',
  'approve draft'
);
r = ok(
  await cmd('store', count(panel, 1, { reason: 'One missing' })),
  'count panel'
);
assert.equal(Number(r.line.variance), -1);
assert.equal(r.status, 'Draft');
assert.ok(r.task);
// A movement after cut-off forces AtCount.
await db.query(
  `insert into public.stock_movements (product_id, quantity, from_location_id, to_location_id, movement_type, movement_at, idempotency_key) values ($1,1,$2,$3,'Receipt',now()+interval '1 second','TEST-LATE')`,
  [panel2.id, ext, store]
);
await noWrite(
  'store',
  count(panel2.id, 21),
  'STK_REVIEW: movements after cut-off',
  'cut-off'
);
r = ok(
  await cmd('store', count(panel2.id, 21, { count_basis: 'AtCount' })),
  'count panel2'
);
assert.equal(Number(r.line.variance), 0);
assert.equal(r.status, 'Review');
const ap = {
  command_id: id(),
  command_type: 'STOCKTAKE_APPROVE',
  payload: { stocktake_id: take }
};
r = ok(await cmd('ben', ap), 'approve');
assert.equal(r.status, 'Approved');
assert.equal(r.adjustments.length, 1);
assert.equal(r.completed_tasks.length, 1);
const adj = await one(`select * from public.stock_movements where id=$1`, [
  r.adjustments[0].movement_id
]);
assert.equal(adj.movement_type, 'Adjustment');
assert.equal(adj.from_location_id, store);
assert.equal(adj.to_location_id, ext);
b = await oread('store', {
  read_type: 'STOCK_BALANCE',
  payload: { product_id: panel }
});
assert.equal(b.data.store_balance, 1);
await noWrite(
  'ben',
  { ...ap, command_id: id() },
  'STK_REVIEW: only a stocktake in Review',
  'approve twice'
);

// Ledger is append-only.
await assert.rejects(
  db.query(`update public.stock_movements set quantity = 99`)
);

console.log('t_stock: all assertions passed');
