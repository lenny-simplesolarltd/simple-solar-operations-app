// R4 finance / reporting / archive. Run:
//   PORT_EXTRA=20260919166000_r4_finance_reporting.sql node t_finance.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, users, cmd, read, sell, as, id, ok } = f;

// A Finance person (role exists in the canonical vocabulary).
{
  const p = await one(
    `insert into public.people (legacy_id, email, display_name) values ('PERSON-fin','fin@test.local','Fiona Finance') returning id`
  );
  await db.query(
    `insert into public.person_roles (person_id, role_code) values ($1,'Finance')`,
    [p.id]
  );
  const uid = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at) values ($1,'fin@test.local',now())`,
    [uid]
  );
  people.fin = p.id;
  users.fin = uid;
}
const worker = async (sql, params = []) => {
  await as(null);
  try {
    return (await db.query(sql, params)).rows[0].r;
  } catch (e) {
    return { error: e.message, detail: e.detail };
  }
};
const count = async (sql, p = []) => (await one(sql, p)).n;
const snapshotCounts = async () => ({
  audit: await count(`select count(*)::int n from public.audit_events`),
  outbox: await count(`select count(*)::int n from public.outbox`),
  tasks: await count(`select count(*)::int n from public.tasks`),
  snaps: await count(`select count(*)::int n from public.report_snapshots`),
  archive: await count(`select count(*)::int n from public.archive_index`),
  commands: await count(`select count(*)::int n from public.commands`)
});

// --- FN-09 disabled: sale creates stages but no intents ------------------------
let s0 = await sell('tanya');
assert.ok(!s0.error, JSON.stringify(s0));
assert.equal(
  await count(
    `select count(*)::int n from public.outbox where correlation_id like 'XI-' || $1 || '-%'`,
    [s0.job_id]
  ),
  0
);
// Modes off -> the commands are refused.
assert.equal(
  (
    await cmd('fin', {
      command_id: id(),
      command_type: 'XERO_INTENT_CREATE',
      job_id: s0.job_id,
      payload: { stage: 'Deposit' }
    })
  ).error,
  'R1A_MODE_DENIED'
);

await db.query(
  `update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id in ('FN-09','FN-12','FN-13')`
);

// Backfill command on the earlier job (Finance, org-wide; not assigned).
let r = ok(
  await cmd('fin', {
    command_id: id(),
    command_type: 'XERO_INTENT_CREATE',
    job_id: s0.job_id,
    payload: { stage: 'Interim' }
  }),
  'intent backfill'
);
assert.equal(r.status, 'Created');
assert.equal(
  (
    await cmd('tanya', {
      command_id: id(),
      command_type: 'XERO_INTENT_CREATE',
      job_id: s0.job_id,
      payload: { stage: 'Interim' }
    })
  ).error,
  'R1A_ROLE_DENIED'
);
assert.equal(
  (
    await cmd('fin', {
      command_id: id(),
      command_type: 'XERO_INTENT_CREATE',
      job_id: s0.job_id,
      payload: { stage: 'Balance' }
    })
  ).error,
  'S13_REVIEW: stage not found'
);
r = ok(
  await cmd('fin', {
    command_id: id(),
    command_type: 'XERO_INTENT_CREATE',
    job_id: s0.job_id,
    payload: { stage: 'Interim' }
  }),
  'intent again'
);
assert.equal(r.created, false);
assert.equal(r.reason, 'Already exists');

// --- Job A: intents at sale ------------------------------------------------------
const A = (await sell('tanya')).job_id;
const intents = await all(
  `select * from public.outbox where correlation_id like 'XI-' || $1 || '-%' order by correlation_id`,
  [A]
);
assert.deepEqual(
  intents.map((o) => o.correlation_id),
  [`XI-${A}-Deposit`, `XI-${A}-Interim`]
);
assert.ok(
  intents.every(
    (o) =>
      o.action_type === 'XeroInvoice' &&
      o.status === 'Pending' &&
      o.response_summary.includes('CAPTURE_ONLY')
  )
);
const stageOf = async (job, st) =>
  one(`select * from public.invoice_stages where job_id=$1 and stage=$2`, [
    job,
    st
  ]);
const intentOf = async (job, st) =>
  one(`select * from public.outbox where correlation_id=$1`, [
    `XI-${job}-${st}`
  ]);

// Dispatch disabled by default; prepare refuses, nothing written.
let st = await worker(`select app.xero_dispatch_status() r`);
assert.equal(st.xero_mode, 'DISABLED');
assert.equal(st.live_ready, false);
const depIntent = await intentOf(A, 'Deposit');
assert.match(
  (await worker(`select app.xero_prepare_dispatch($1) r`, [depIntent.id]))
    .error,
  /^XO_REFUSED: Xero automation is not enabled/
);
assert.equal((await intentOf(A, 'Deposit')).status, 'Pending');
await db.query(
  `insert into public.settings (key, typed_value, scope, version, effective_from, reason) values ('xero.mode','"LIVE"','Global',1,'2026-01-01','test')`
);
st = await worker(`select app.xero_dispatch_status() r`);
assert.equal(st.live_ready, true);
const env = st.envelopes.find((e) => e.intent_id === depIntent.id);
assert.match(env.reference, /^SS-[A-Z]{4}-\d{4}-DEP$/);
assert.equal(env.create_as, 'DRAFT');
assert.equal(env.amounts.gross_pence, 125000);
assert.deepEqual(env.blockers, ['CONTACT_NOT_CONFIGURED']);
assert.equal(env.contact.name, 'Ann Smith');
// Blocked -> NeedsReview, not sent.
r = await worker(`select app.xero_prepare_dispatch($1) r`, [depIntent.id]);
assert.equal(r.send, false);
assert.equal(r.code, 'CONTACT_NOT_CONFIGURED');
assert.equal((await intentOf(A, 'Deposit')).status, 'NeedsReview');
// Contact configured -> send, request id stamped.
await db.query(
  `update public.invoice_stages set xero_contact_id='XC-1' where job_id=$1`,
  [A]
);
const intIntent = await intentOf(A, 'Interim');
r = await worker(`select app.xero_prepare_dispatch($1) r`, [intIntent.id]);
assert.equal(r.send, true, JSON.stringify(r));
assert.equal(r.envelope.reference.slice(-3), 'INT');
assert.equal((await stageOf(A, 'Interim')).request_id, intIntent.id);
r = await worker(
  `select app.xero_note_dispatch_outcome($1,'Accepted','ZAP-1') r`,
  [intIntent.id]
);
assert.equal(r.action, 'XeroRequestSent');
assert.equal(
  (await worker(`select app.xero_retry_policy() r`)).max_attempts,
  3
);

// Invoice callback: link, map status, replay, conflict, unknown request.
r = await worker(
  `select app.xero_apply_invoice_callback('CB-1',$1,'INV-002','INV-0002','AUTHORISED') r`,
  [intIntent.id]
);
assert.equal(r.status, 'Authorised', JSON.stringify(r));
let s = await stageOf(A, 'Interim');
assert.equal(s.xero_invoice_id, 'INV-002');
assert.equal(s.invoice_number, 'INV-0002');
assert.equal(s.source_status, 'AUTHORISED');
assert.equal((await intentOf(A, 'Interim')).status, 'Succeeded');
assert.equal((await intentOf(A, 'Interim')).external_id, 'INV-002');
assert.equal(
  (
    await worker(
      `select app.xero_apply_invoice_callback('CB-1',$1,'INV-999') r`,
      [intIntent.id]
    )
  ).replay,
  true
);
assert.equal((await stageOf(A, 'Interim')).xero_invoice_id, 'INV-002');
r = await worker(
  `select app.xero_apply_invoice_callback('CB-2',$1,'INV-777') r`,
  [intIntent.id]
);
assert.equal(r.status, 'NeedsReview');
assert.equal((await intentOf(A, 'Interim')).status, 'NeedsReview');
assert.equal((await stageOf(A, 'Interim')).xero_invoice_id, 'INV-002');
assert.equal(
  (
    await worker(`select app.xero_apply_invoice_callback('CB-3',$1,'X') r`, [
      randomUUID()
    ])
  ).error,
  'XO_REVIEW: unknown request_id'
);
assert.equal(
  (
    await worker(
      `select app.xero_apply_invoice_callback('CB-3b',$1,'INV-002') r`,
      [depIntent.id]
    )
  ).error,
  'XO_REVIEW: Xero invoice already linked to another stage'
);
r = await worker(
  `select app.xero_apply_invoice_callback('CB-4',$1,'INV-001','INV-0001','DRAFT') r`,
  [depIntent.id]
);
assert.equal(r.status, 'Draft');
// A linked stage is never requested again.
assert.ok(
  (
    await worker(
      `select app.xero_envelope(o) r from public.outbox o where o.id=$1`,
      [depIntent.id]
    )
  ).blockers.includes('ALREADY_LINKED:INV-001')
);

// Payment callback: PartPaid, replay, Paid, no manual bank checks.
const mbc = await count(
  `select count(*)::int n from public.manual_bank_checks`
);
r = await worker(
  `select app.xero_apply_payment_callback('P-1','INV-001','PAY-1',50000,'2026-09-10') r`
);
assert.equal(r.stage_status, 'PartPaid', JSON.stringify(r));
assert.equal(r.manual_bank_check_touched, false);
let pay = await one(
  `select * from public.payments where xero_payment_id='PAY-1'`
);
assert.equal(pay.status, 'Reported');
assert.equal(pay.payment_date.toISOString().slice(0, 10), '2026-09-10');
assert.equal(
  (
    await worker(
      `select app.xero_apply_payment_callback('P-1b','INV-001','PAY-1',50000) r`
    )
  ).replay,
  true
);
r = await worker(
  `select app.xero_apply_payment_callback('P-2','INV-001','PAY-2',75000) r`
);
assert.equal(r.stage_status, 'Paid');
assert.equal(r.paid_total_pence, 125000);
assert.equal(
  await count(`select count(*)::int n from public.manual_bank_checks`),
  mbc
);
assert.match(
  (
    await worker(
      `select app.xero_apply_payment_callback('P-3','INV-404','PAY-3',1) r`
    )
  ).error,
  /no invoice stage linked/
);
assert.match(
  (
    await worker(
      `select app.xero_apply_payment_callback('P-4','INV-001','PAY-4',-5) r`
    )
  ).error,
  /positive integer/
);

// --- S14 reads -------------------------------------------------------------------
let sum;
const opRead = async (who, req) => {
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
r = await opRead('fin', { read_type: 'FINANCE_SUMMARY', job_id: A });
sum = r.data;
assert.equal(sum.invoiced, 300000);
assert.equal(sum.total_paid, 125000);
assert.equal(sum.outstanding, 175000);
assert.equal(sum.financially_complete, false);
assert.equal(sum.stage_details.Deposit.outstanding, 0);
assert.equal(
  (await opRead('store', { read_type: 'FINANCE_SUMMARY', job_id: A })).error,
  'R1A_ROLE_DENIED'
);
assert.equal(
  (await opRead('fin', { read_type: 'FINANCE_SUMMARY', job_id: A, bogus: 1 }))
    .error,
  'R1A_INVALID_FIELDS'
);
assert.equal(
  (await opRead('hannah', { read_type: 'FINANCE_SUMMARY', job_id: A })).error,
  'R1A_ROLE_DENIED'
);
r = await opRead('tanya', { read_type: 'INVOICE_STATUS', job_id: A });
assert.equal(r.data.stages.length, 2);
assert.ok(r.data.stages.every((x) => x.has_xero_intent));
assert.equal(
  (await opRead('fin', { read_type: 'XERO_REQUESTS' })).data.live_ready,
  true
);

// Job B: reconciliation exceptions (seeded payments).
const B = (await sell('tanya')).job_id;
const bDep = await stageOf(B, 'Deposit'),
  bInt = await stageOf(B, 'Interim');
await db.query(
  `insert into public.payments (invoice_stage_id, xero_payment_id, amount_pence, payment_date, status) values ($1,'XRO-OVER',200000,'2026-09-01','Reported')`,
  [bDep.id]
);
await db.query(
  `insert into public.payments (invoice_stage_id, amount_pence, payment_date, status) values ($1,1000,'2026-09-01','Reported')`,
  [bInt.id]
);
await db.query(
  `insert into public.invoice_stages (job_id, stage, amount_net_pence, vat_pence, gross_pence, status) values ($1,'Balance',1,0,1,'Pending')`,
  [B]
);
r = (await opRead('fin', { read_type: 'PAYMENT_RECONCILIATION', job_id: B }))
  .data;
assert.deepEqual(r.exceptions.map((e) => e.type).sort(), [
  'FINAL_BEFORE_OPERATIONAL',
  'MISSING_EXTERNAL_REF',
  'OVERPAYMENT'
]);
assert.equal(r.needs_review, true);
// Overdue: summary (outstanding) vs invoice status (not Confirmed) definitions.
await db.query(
  `update public.invoice_stages set due_date = current_date - 3 where id = $1`,
  [bInt.id]
);
assert.deepEqual(
  (await opRead('fin', { read_type: 'FINANCE_SUMMARY', job_id: B })).data
    .overdue_stages,
  ['Interim']
);

// --- Job C: full payment -> financially complete -> GHL progression -------------
const C = (await sell('tanya')).job_id;
await db.query(
  `update public.jobs set operational_complete_at = now() - interval '7 months' where id=$1`,
  [C]
);
await worker(`select app.build_invoice_stages($1) r`, [C]);
assert.equal(
  await count(
    `select count(*)::int n from public.outbox where correlation_id like 'XI-' || $1 || '-%'`,
    [C]
  ),
  3,
  'balance intent with the stage'
);
let i = 0;
for (const [stage, gross] of [
  ['Deposit', 125000],
  ['Interim', 175000],
  ['Balance', 200000]
]) {
  const o = await intentOf(C, stage);
  r = await worker(`select app.xero_apply_invoice_callback($1,$2,$3) r`, [
    `CBC-${stage}`,
    o.id,
    `INVC-${stage}`
  ]);
  assert.equal(r.status, 'Draft', JSON.stringify(r));
  r = await worker(`select app.xero_apply_payment_callback($1,$2,$3,$4) r`, [
    `PC-${stage}`,
    `INVC-${stage}`,
    `PAYC-${stage}`,
    gross
  ]);
  assert.equal(r.stage_status, 'Paid');
  i++;
}
assert.equal(r.milestones.ghl.created, true, JSON.stringify(r.milestones));
const ghlTask = await one(
  `select * from public.tasks where job_id=$1 and template_code='S13-GHL-PROGRESSION'`,
  [C]
);
assert.equal(ghlTask.instance_key, `S13-GHL-${C}`);
assert.equal(ghlTask.owner_id, people.tanya);
assert.equal(ghlTask.priority, 2);
assert.equal(
  (
    await one(
      `select readiness_snapshot from public.ghl_tasks where task_id=$1`,
      [ghlTask.id]
    )
  ).readiness_snapshot,
  '{"stage":"payment-complete"}'
);
assert.equal(
  (await opRead('fin', { read_type: 'FINANCE_SUMMARY', job_id: C })).data
    .financially_complete,
  true
);

// --- Job D: interim chase at FIN02 (scheduler) -----------------------------------
const D = (await sell('tanya')).job_id;
await db.query(
  `update public.jobs set next_action_at = now() - interval '2 days' where id=$1`,
  [D]
);
r = await worker(`select app.s13_run_milestones() r`);
assert.ok(
  r.jobs.some((j) => j.job_id === D && j.result.interim_chase.created),
  JSON.stringify(r)
);
assert.ok(
  !r.jobs.some((j) => j.job_id === A && j.result.interim_chase),
  'no install date -> no chase'
);
const chase = await one(
  `select * from public.tasks where job_id=$1 and template_code='S13-INTERIM-CHASE'`,
  [D]
);
assert.equal(chase.task_group, 'Finance');
assert.equal(chase.priority, 1);
assert.equal(chase.owner_id, people.tanya);
await worker(`select app.s13_run_milestones() r`);
assert.equal(
  await count(
    `select count(*)::int n from public.tasks where job_id=$1 and template_code='S13-INTERIM-CHASE'`,
    [D]
  ),
  1
);
await db.query(
  `update public.release_modes set mode='Disabled', authorised_job_scope='None' where function_id='FN-09'`
);
assert.equal(
  (await worker(`select app.s13_run_milestones() r`)).skipped,
  'FN-09 not Automated'
);
await db.query(
  `update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id='FN-09'`
);

// --- XERO_REVIEW_CANCEL_INVOICE ------------------------------------------------
const aInt = await stageOf(A, 'Interim'),
  aDep = await stageOf(A, 'Deposit');
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'XERO_REVIEW_CANCEL_INVOICE',
    payload: { invoice_stage_id: aInt.id, reason: 'Job cancelled' }
  }),
  'rc int'
);
assert.equal(r.created, true);
assert.match(r.action, /void\/credit/);
assert.equal(r.deleted, false);
let t = await one(`select * from public.tasks where id=$1`, [r.task_id]);
assert.match(t.title, /^Review\/cancel Xero invoice — Interim INV-0002/);
assert.equal(t.task_group, 'Finance');
assert.equal(t.related_entity_type, 'InvoiceStages');
assert.equal(t.owner_id, people.tanya);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'XERO_REVIEW_CANCEL_INVOICE',
    payload: { invoice_stage_id: aDep.id, reason: 'x' }
  }),
  'rc dep'
);
assert.match(r.action, /void\/credit/, 'deposit is Paid');
const s0Int = await stageOf(s0.job_id, 'Interim');
r = ok(
  await cmd('fin', {
    command_id: id(),
    command_type: 'XERO_REVIEW_CANCEL_INVOICE',
    payload: { invoice_stage_id: s0Int.id, reason: 'x' }
  }),
  'rc none'
);
assert.match(r.action, /no Xero invoice linked/);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'XERO_REVIEW_CANCEL_INVOICE',
    payload: { invoice_stage_id: aInt.id, reason: 'again' }
  }),
  'rc again'
);
assert.equal(r.created, false);
assert.equal(
  (await stageOf(A, 'Interim')).xero_invoice_id,
  'INV-002',
  'nothing deleted locally'
);
assert.equal(
  (
    await cmd('store', {
      command_id: id(),
      command_type: 'XERO_REVIEW_CANCEL_INVOICE',
      payload: { invoice_stage_id: aInt.id, reason: 'x' }
    })
  ).error,
  'R1A_ROLE_DENIED'
);
assert.equal(
  (
    await cmd('tanya', {
      command_id: id(),
      command_type: 'XERO_REVIEW_CANCEL_INVOICE',
      payload: { invoice_stage_id: aInt.id }
    })
  ).error,
  'R1A_REQUIRED_REASON'
);

// --- REPORT_SNAPSHOT_CREATE ----------------------------------------------------
const snapReq = {
  command_id: id(),
  command_type: 'REPORT_SNAPSHOT_CREATE',
  payload: {
    report_type: 'monthly',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    job_ids: [A, C]
  }
};
r = ok(await cmd('fin', snapReq), 'snapshot');
assert.equal(r.created, true);
assert.equal(r.totals.job_count, 2);
assert.equal(r.totals.financially_complete, 1);
assert.equal(r.totals.total_paid, 125000 + 500000);
assert.equal((await cmd('fin', snapReq)).replayed, true);
assert.equal(
  (
    await cmd('fin', {
      ...snapReq,
      payload: { ...snapReq.payload, job_ids: [A] }
    })
  ).error,
  'R1A_COMMAND_CONFLICT'
);
r = ok(await cmd('dan', { ...snapReq, command_id: id() }), 'snapshot again');
assert.equal(r.created, false);
assert.equal(r.status, 'AlreadyExists');
assert.equal(
  (await cmd('tanya', { ...snapReq, command_id: id() })).error,
  'R1A_ROLE_DENIED'
);
assert.equal(
  (
    await cmd('fin', {
      ...snapReq,
      command_id: id(),
      payload: {
        ...snapReq.payload,
        period_start: '2026-10-01',
        period_end: '2026-09-30'
      }
    })
  ).error,
  'S14_REVIEW: period_start must not be after period_end'
);
assert.equal(
  (
    await cmd('fin', {
      ...snapReq,
      command_id: id(),
      payload: {
        ...snapReq.payload,
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        job_ids: [randomUUID()]
      }
    })
  ).error,
  'R1A_JOB_NOT_FOUND'
);
await assert.rejects(
  db.query(`update public.report_snapshots set report_type='x'`),
  /IMMUTABLE/
);
assert.equal(
  await count(`select count(*)::int n from public.report_snapshots`),
  1
);

// --- Archive (job C) -------------------------------------------------------------
r = (await opRead('tanya', { read_type: 'ARCHIVE_ELIGIBILITY', job_id: C }))
  .data;
assert.equal(r.eligible, false);
assert.ok(
  r.blockers.some((b) => /open tasks/.test(b)) &&
    r.blockers.some((b) => /Handover not sent/.test(b)),
  JSON.stringify(r.blockers)
);
let jC = await one(`select * from public.jobs where id=$1`, [C]);
const before = await snapshotCounts();
r = await cmd('tanya', {
  command_id: id(),
  command_type: 'ARCHIVE_JOB',
  job_id: C,
  expected_version: jC.version,
  payload: { reason: 'Six months' }
});
assert.equal(r.error, 'S16_REVIEW: job not archive-eligible');
assert.ok(JSON.parse(r.detail).blockers.length > 0);
assert.deepEqual(await snapshotCounts(), before, 'refusal writes nothing');
// Clear obligations.
await db.query(
  `update public.tasks set status='Complete', completed_at=now() where job_id=$1 and status not in ('Complete','NotRequired','Cancelled')`,
  [C]
);
await db.query(`update public.jobs set handover_status='Sent' where id=$1`, [
  C
]);
r = (await opRead('tanya', { read_type: 'ARCHIVE_ELIGIBILITY', job_id: C }))
  .data;
assert.equal(r.eligible, true, JSON.stringify(r.blockers));
// Recent completion blocks.
r = (await opRead('tanya', { read_type: 'ARCHIVE_ELIGIBILITY', job_id: A }))
  .data;
assert.ok(r.blockers.includes('Not operationally complete'));
jC = await one(`select * from public.jobs where id=$1`, [C]);
assert.equal(
  (
    await cmd('tanya', {
      command_id: id(),
      command_type: 'ARCHIVE_JOB',
      job_id: C,
      expected_version: jC.version - 1,
      payload: { reason: 'x' }
    })
  ).error,
  'R1A_STALE_VERSION'
);
assert.equal(
  (
    await cmd('fin', {
      command_id: id(),
      command_type: 'ARCHIVE_JOB',
      job_id: C,
      expected_version: jC.version,
      payload: { reason: 'x' }
    })
  ).error,
  'R1A_ROLE_DENIED'
);
const archReq = {
  command_id: id(),
  command_type: 'ARCHIVE_JOB',
  job_id: C,
  expected_version: jC.version,
  payload: { reason: 'Six months' }
};
r = ok(await cmd('tanya', archReq), 'archive');
assert.equal(r.archived, true);
assert.equal(r.record_counts.InvoiceStages, 3);
assert.equal(r.record_counts.Payments, 3);
assert.ok(
  (await one(`select archived_at from public.jobs where id=$1`, [C]))
    .archived_at
);
assert.equal(
  await count(
    `select count(*)::int n from public.archive_index where job_id=$1 and restored_at is null`,
    [C]
  ),
  1
);
assert.equal(
  await count(
    `select count(*)::int n from public.audit_events where entity_id=$1 and action='S16Archive'`,
    [C]
  ),
  1
);
assert.equal((await cmd('tanya', archReq)).replayed, true);
jC = await one(`select * from public.jobs where id=$1`, [C]);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'ARCHIVE_JOB',
    job_id: C,
    expected_version: jC.version,
    payload: { reason: 'again' }
  }),
  'archive again'
);
assert.equal(r.status, 'AlreadyArchived');
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'REOPEN_ARCHIVED_JOB',
    job_id: C,
    expected_version: jC.version,
    payload: { reason: 'Customer query' }
  }),
  'reopen'
);
assert.equal(r.reopened, true);
assert.equal(
  (await one(`select archived_at from public.jobs where id=$1`, [C]))
    .archived_at,
  null
);
assert.equal(
  await count(
    `select count(*)::int n from public.archive_index where job_id=$1 and restored_at is not null`,
    [C]
  ),
  1
);
jC = await one(`select * from public.jobs where id=$1`, [C]);
assert.equal(
  (
    await cmd('tanya', {
      command_id: id(),
      command_type: 'REOPEN_ARCHIVED_JOB',
      job_id: C,
      expected_version: jC.version,
      payload: { reason: 'x' }
    })
  ).error,
  'S16_REVIEW: job not archived'
);
await db.query(
  `update public.release_modes set mode='Disabled', authorised_job_scope='None' where function_id='FN-13'`
);
assert.equal(
  (
    await cmd('tanya', {
      command_id: id(),
      command_type: 'ARCHIVE_JOB',
      job_id: C,
      expected_version: jC.version,
      payload: { reason: 'x' }
    })
  ).error,
  'R1A_MODE_DENIED'
);

// --- S15 suppression: no intents on a cancelling job ------------------------------
await db.query(`update public.jobs set cancellation_at = now() where id=$1`, [
  B
]);
assert.equal(
  (
    await cmd('fin', {
      command_id: id(),
      command_type: 'XERO_INTENT_CREATE',
      job_id: B,
      payload: { stage: 'Balance' }
    })
  ).error,
  'S15_REVIEW: normal work suppressed'
);

console.log('t_finance: all assertions passed');
