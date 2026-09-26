// Communications: approval, dispatch intent, the manual-send record and the
// email claim decision. Run:
//   node t_communications.mjs
//
// The point of most of these assertions is that NOTHING IS SENT and that each
// of the four independent doors refuses on its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok, as } = f;
const { job } = await readyToBook(f);

const C = (type, payload, extra = {}) => ({
  command_id: id(),
  command_type: type,
  ...extra,
  payload
});
const commRow = (c) =>
  one(`select * from public.communications where id=$1`, [c]);
const outRow = (o) => one(`select * from public.outbox where id=$1`, [o]);
const sql = async (q, p = []) => {
  await as(null);
  return (await db.query(q, p)).rows[0]?.r;
};
const sqlErr = async (q, p = []) => {
  try {
    await sql(q, p);
    return null;
  } catch (e) {
    return e.message;
  }
};
const opread = async (who, req) => {
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
const setSetting = async (key, value) => {
  const v = (
    await one(
      `select coalesce(max(version),0)+1 v from public.settings where key=$1 and scope='Global'`,
      [key]
    )
  ).v;
  await db.query(
    `insert into public.settings (key, typed_value, scope, version, effective_from) values ($1,$2::jsonb,'Global',$3,'2026-01-01')`,
    [key, JSON.stringify(value), v]
  );
};
const snapshot = async () => {
  const out = {};
  for (const t of [
    'communications',
    'communication_jobs',
    'outbox',
    'audit_events',
    'commands',
    'acknowledgements'
  ])
    out[t] = (await all(`select to_jsonb(x)::text r from public.${t} x`))
      .map((r) => r.r)
      .sort();
  return JSON.stringify(out);
};
const refuses = async (who, req, code) => {
  const before = await snapshot();
  const r = await cmd(who, req);
  assert.equal(r.error, code, JSON.stringify(r));
  assert.equal(await snapshot(), before, 'refusal wrote something: ' + code);
  return r;
};

// ---------------------------------------------------------------------------
// 0. Registration and the resting state
// ---------------------------------------------------------------------------
const types = (await one(`select app.command_types() t`)).t;
for (const t of [
  'COMMUNICATION_APPROVE',
  'COMMUNICATION_QUEUE',
  'COMMUNICATION_RECORD_SENT'
])
  assert.ok(types.includes(t), 'registered: ' + t);

// 20260920260000 configured the transport: email.mode is LIVE, the sender is a
// real mailbox, and the adapter is named. Two doors are still shut, and they
// are the two that hold the line.
const setting = async (k) =>
  (
    await one(
      `select typed_value #>> '{}' v from public.settings where key='${k}' order by version desc limit 1`
    )
  ).v;

assert.equal(await setting('email.mode'), 'LIVE');
assert.equal(
  await setting('email.from_mailbox'),
  'operations@simplesolarltd.co.uk'
);
assert.equal(await setting('email.transport'), 'resend');

// THE LAST TWO DOORS. Neither may be opened by a migration: the allow-list
// carries real third-party addresses and is applied straight to the database,
// and the release mode is a recorded decision made through RELEASE_CONTROL.
// If either of these assertions ever fails in CI, something has committed a
// decision that was supposed to be taken by a person.
assert.deepEqual(
  (await one(`select app.setting_text_array('outbound.allowed_recipients') a`))
    .a,
  [],
  'the allow-list must never be committed to the repo'
);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.release_modes where function_id in ('FN-03','FN-04') and mode='Automated'`
    )
  ).n,
  0,
  'FN-03/FN-04 must ship not-Automated'
);

// And the point of all of it: with the transport fully configured, a claim is
// STILL refused, because the release mode is the outer gate.
await assert.rejects(
  () => one(`select public.outbox_claim(array['EmailOrder']) c`),
  /must be Automated/,
  'a configured transport must not be enough to claim a row'
);

// FN-20 and FN-18 are Manual by decision: they have no action type at all, so
// no amount of configuration can auto-dispatch a customer/installer notice.
assert.equal(
  (
    await one(
      `select count(*)::int n from app.outbox_action_types where function_id in ('FN-20','FN-18')`
    )
  ).n,
  0
);

// ---------------------------------------------------------------------------
// 1. A captured draft, exactly as the producers write one
// ---------------------------------------------------------------------------
const merchant = (
  await one(
    `insert into public.companies (name, type) values ('Acme Merchant','Merchant') returning id`
  )
).id;
await db.query(
  `insert into public.contacts (company_id, name, email, preferred_channel) values ($1,'Pat','Pat@Acme.example','Email')`,
  [merchant]
);
await db.query(
  `insert into public.contacts (company_id, name, email) values ($1,'No Address',null)`,
  [merchant]
);

const draft = async (over = {}) =>
  (
    await one(
      `insert into public.communications (job_id, company_id, type, subject, body_snapshot, recipients_snapshot, revision, status)
   values ($1,$2,$3,$4,$5,$6,1,'Draft') returning id`,
      [
        job,
        merchant,
        over.type ?? 'MerchantOrder',
        over.subject ?? 'Order SS-0001 rev 1',
        over.body ?? 'CAPTURED DRAFT — not sent. FN-03 R2.',
        over.recipients ??
          (await one(`select app.mat_contacts($1)::text r`, [merchant])).r
      ]
    )
  ).id;

const c1 = await draft();
// The snapshot keeps the unusable contact; only the usable one is a recipient.
const rec = (
  await one(
    `select app.comm_recipients(c) r from public.communications c where c.id=$1`,
    [c1]
  )
).r;
assert.equal(rec.ok, true);
assert.deepEqual(rec.to, ['pat@acme.example'], 'lower-cased, usable only');
assert.equal(
  rec.unusable.length,
  1,
  'the contact with no address is reported, not silently dropped'
);

// ---------------------------------------------------------------------------
// 2. Approval: authority, then state
// ---------------------------------------------------------------------------
await refuses(
  'inst_a',
  C('COMMUNICATION_APPROVE', { communication_id: c1 }),
  'R1A_ROLE_DENIED'
);
await refuses(
  'store',
  C('COMMUNICATION_APPROVE', { communication_id: c1 }),
  'R1A_ROLE_DENIED'
);
await refuses(
  'sam',
  C('COMMUNICATION_APPROVE', { communication_id: c1 }),
  'R1A_ROLE_DENIED'
);
await refuses(
  'tanya',
  C('COMMUNICATION_APPROVE', {}),
  'COMM_REFUSED: communication_id is required'
);
await refuses(
  'tanya',
  C('COMMUNICATION_APPROVE', { communication_id: id() }),
  'COMM_NOT_FOUND'
);
await refuses(
  'tanya',
  C(
    'COMMUNICATION_APPROVE',
    { communication_id: c1 },
    { expected_version: 99 }
  ),
  'R1A_STALE_VERSION'
);

let r = ok(
  await cmd(
    'tanya',
    C('COMMUNICATION_APPROVE', {
      communication_id: c1,
      reason: 'checked the lines'
    })
  ),
  'approve'
);
assert.equal(r.approved, true);
assert.equal(r.sent, false, 'approving never claims to have sent');
let row = await commRow(c1);
assert.equal(row.status, 'Approved');
assert.equal(row.approved_by, people.tanya, 'a named person, not a service');
assert.ok(row.approved_at);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.audit_events where entity_id=$1 and action='CommunicationApproved' and initiating_person_id=$2`,
      [c1, people.tanya]
    )
  ).n,
  1
);

// Idempotent, and never a second audit row.
r = ok(
  await cmd('tanya', C('COMMUNICATION_APPROVE', { communication_id: c1 })),
  're-approve'
);
assert.equal(r.already_approved, true);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.audit_events where entity_id=$1 and action='CommunicationApproved'`,
      [c1]
    )
  ).n,
  1
);

// A Director may approve but may not queue.
const cDir = await draft();
ok(
  await cmd('dan', C('COMMUNICATION_APPROVE', { communication_id: cDir })),
  'director approves'
);
await refuses(
  'dan',
  C('COMMUNICATION_QUEUE', { communication_id: cDir }),
  'R1A_ROLE_DENIED'
);

// ---------------------------------------------------------------------------
// 3. Door 1: the release mode. With FN-03 Disabled, queueing writes NOTHING.
// ---------------------------------------------------------------------------
await refuses(
  'tanya',
  C('COMMUNICATION_QUEUE', { communication_id: c1 }),
  'R1A_MODE_DENIED'
);
assert.equal(
  (await one(`select count(*)::int n from public.outbox`)).n,
  0,
  'no dispatch intent may accumulate while Disabled'
);

// A type that is never dispatchable stays refused whatever the modes say.
const notice = await draft({ type: 'CustomerNotice' });
ok(
  await cmd('tanya', C('COMMUNICATION_APPROVE', { communication_id: notice })),
  'approve notice'
);
await refuses(
  'tanya',
  C('COMMUNICATION_QUEUE', { communication_id: notice }),
  'COMM_NOT_DISPATCHABLE'
);

// ---------------------------------------------------------------------------
// 4. The manual route (FN-20 / FN-18): record the fact, claim no delivery
// ---------------------------------------------------------------------------
await refuses(
  'tanya',
  C('COMMUNICATION_RECORD_SENT', { communication_id: notice }),
  'COMM_REFUSED: note is required - say in your own words what was sent and to whom'
);
await refuses(
  'tanya',
  C('COMMUNICATION_RECORD_SENT', {
    communication_id: notice,
    note: 'x',
    sent_at: '2099-01-01'
  }),
  'COMM_REFUSED: sent_at is in the future'
);
r = ok(
  await cmd(
    'tanya',
    C('COMMUNICATION_RECORD_SENT', {
      communication_id: notice,
      note: 'Emailed Ann from my own mailbox',
      external_reference: 'gmail-thread-7'
    })
  ),
  'record sent'
);
assert.equal(r.recorded, true);
assert.equal(r.sent_by_system, false);
row = await commRow(notice);
assert.equal(row.status, 'Sent');
assert.equal(
  row.external_message_id,
  'manual:gmail-thread-7',
  'a human reference is never mistaken for a transport id'
);
assert.equal(row.outbox_id, null, 'the manual route creates no outbox row');
assert.equal(
  (
    await one(
      `select count(*)::int n from public.audit_events where entity_id=$1 and action='CommunicationRecordedSentByPerson' and reason='Emailed Ann from my own mailbox'`,
      [notice]
    )
  ).n,
  1
);
// Not twice.
await refuses(
  'tanya',
  C('COMMUNICATION_RECORD_SENT', { communication_id: notice, note: 'again' }),
  'COMM_STATUS_INVALID'
);

// ---------------------------------------------------------------------------
// 5. Door 1 open: queueing now works, and still sends nothing
// ---------------------------------------------------------------------------
await db.query(
  `update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id in ('FN-03','FN-04')`
);
r = ok(
  await cmd('tanya', C('COMMUNICATION_QUEUE', { communication_id: c1 })),
  'queue'
);
assert.equal(r.queued, true);
assert.equal(r.action_type, 'EmailOrder');
assert.equal(r.function_id, 'FN-03');
assert.equal(r.sent, false);
row = await commRow(c1);
assert.equal(row.status, 'Queued');
const o1 = row.outbox_id;
let out = await outRow(o1);
assert.equal(out.status, 'Pending');
assert.equal(out.action_type, 'EmailOrder');
// The queue stamps the sender the message was queued to go FROM, so a later
// change of mailbox is detectable (SENDER_CHANGED) rather than silent.
assert.equal(
  out.target,
  'operations@simplesolarltd.co.uk',
  'queued to send from the configured mailbox'
);
assert.equal(out.attempt_count, 0);
assert.match(out.response_summary, /nothing sent/);
assert.equal(
  out.payload_hash,
  (
    await one(
      `select app.comm_payload_hash(c) h from public.communications c where c.id=$1`,
      [c1]
    )
  ).h
);

// Re-queue is idempotent and creates no second row.
r = ok(
  await cmd('tanya', C('COMMUNICATION_QUEUE', { communication_id: c1 })),
  're-queue'
);
assert.equal(r.already_queued, true);
assert.equal((await one(`select count(*)::int n from public.outbox`)).n, 1);

// Queueing a Draft is refused: approval is not optional.
const c2 = await draft();
await refuses(
  'tanya',
  C('COMMUNICATION_QUEUE', { communication_id: c2 }),
  'COMM_NOT_APPROVED'
);

// A message with no usable address can be approved but never queued.
const noAddr = await draft({
  recipients: '[{"contact_id":"x","name":"Nobody","email":"NOT_CONFIGURED"}]'
});
ok(
  await cmd('tanya', C('COMMUNICATION_APPROVE', { communication_id: noAddr })),
  'approve no-address'
);
await refuses(
  'tanya',
  C('COMMUNICATION_QUEUE', { communication_id: noAddr }),
  'COMM_RECIPIENTS_INVALID'
);

// ---------------------------------------------------------------------------
// 6. Door 4: the allow-list. An empty one refuses the whole claim.
// ---------------------------------------------------------------------------
await setSetting('email.mode', 'LIVE');
assert.equal(
  await sqlErr(`select app.outbox_claim(array['EmailOrder'], 10) r`),
  'EMAIL_REFUSED: LIVE mode requires outbound.allowed_recipients'
);
assert.equal(
  (await outRow(o1)).status,
  'Pending',
  'a refused claim leaves the row untouched'
);

// ---------------------------------------------------------------------------
// 7. Door 3: the sender. Allow-listed recipient, but no configured mailbox.
// ---------------------------------------------------------------------------
await setSetting('outbound.allowed_recipients', ['pat@acme.example']);
// Unconfigure the mailbox the go-live migration set, so this door is still
// exercised: a deployment that loses the sender must fail closed, not send
// from whatever the provider defaults to.
await setSetting('email.from_mailbox', '');
let claim = await sql(`select app.outbox_claim(array['EmailOrder'], 10) r`);
assert.equal(claim.claimed.length, 0, 'nothing claimed for sending');
assert.equal(claim.settled.length, 1, JSON.stringify(claim));
assert.equal(
  claim.settled[0].code,
  'SENDER_NOT_CONFIGURED',
  JSON.stringify(claim.settled[0])
);
out = await outRow(o1);
assert.equal(out.status, 'NeedsReview');
assert.match(out.response_summary, /SENDER_NOT_CONFIGURED|email\.from_mailbox/);
assert.equal(
  (await commRow(c1)).status,
  'Uncertain',
  'the message follows its outbox row into review'
);

// ---------------------------------------------------------------------------
// 8. Door 2: CAPTURE. With everything else configured, CAPTURE still sends nothing.
// ---------------------------------------------------------------------------
await setSetting('email.from_mailbox', 'orders@simplesolar.example');
await setSetting('email.mode', 'CAPTURE');
const c3 = await draft();
ok(
  await cmd('tanya', C('COMMUNICATION_APPROVE', { communication_id: c3 })),
  'approve c3'
);
const o3 = ok(
  await cmd('tanya', C('COMMUNICATION_QUEUE', { communication_id: c3 })),
  'queue c3'
).outbox_id;
claim = await sql(`select app.outbox_claim(array['EmailOrder'], 10) r`);
assert.equal(claim.claimed.length, 0);
assert.ok(
  claim.skipped.some((s) => s.outbox_id === o3 && s.reason === 'CAPTURE_MODE'),
  JSON.stringify(claim)
);
assert.equal(
  (await outRow(o3)).status,
  'Pending',
  'CAPTURE reports and leaves it Pending'
);
assert.equal((await commRow(c3)).status, 'Queued');

// ---------------------------------------------------------------------------
// 9. All four doors open: the row is claimed, and the work is a spec, not a send
// ---------------------------------------------------------------------------
await setSetting('email.mode', 'LIVE');
claim = await sql(`select app.outbox_claim(array['EmailOrder'], 10) r`);
assert.equal(claim.claimed.length, 1, JSON.stringify(claim));
const w = claim.claimed[0];
assert.equal(w.outbox_id, o3);
assert.equal(w.work.operation, 'send');
assert.equal(w.work.from, 'orders@simplesolar.example');
assert.deepEqual(w.work.to, ['pat@acme.example']);
assert.equal(w.work.subject, 'Order SS-0001 rev 1');
assert.equal(w.work.delivery_confirmed, false, 'submission is never receipt');
assert.equal(w.work.dedupe_tag, `[SSO-COMM:${c3}]`);
assert.equal(w.work.reconcile_first, false, 'first attempt');
out = await outRow(o3);
assert.equal(out.status, 'Processing');
assert.equal(
  out.attempt_count,
  1,
  'the attempt is recorded BEFORE any external call'
);
assert.ok(out.claimed_at);
assert.equal(
  (await commRow(c3)).status,
  'Queued',
  'claiming does not change the message'
);

// A transport result lands through the recorded paths only.
await sql(`select app.outbox_record_success($1, 'gmail-msg-1', 'sent') r`, [
  o3
]);
out = await outRow(o3);
assert.equal(out.status, 'Succeeded');
row = await commRow(c3);
assert.equal(row.status, 'Sent');
assert.equal(row.external_message_id, 'gmail-msg-1');
assert.ok(row.sent_at);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.audit_events where entity_id=$1 and action='CommunicationDispatchSucceeded'`,
      [c3]
    )
  ).n,
  1
);
assert.equal(
  (
    await one(
      `select executing_service s from public.audit_events where entity_id=$1 and action='CommunicationDispatchSucceeded'`,
      [c3]
    )
  ).s,
  'EmailService',
  'the worker writes as a named service, never as a person'
);

// ---------------------------------------------------------------------------
// 10. Never a second copy: a re-queued, already-sent message settles, not sends
// ---------------------------------------------------------------------------
await db.query(`update public.communications set status='Queued' where id=$1`, [
  c3
]);
await db.query(
  `update public.outbox set status='Pending', next_attempt=now(), attempt_count=0, claimed_at=null where id=$1`,
  [o3]
);
claim = await sql(`select app.outbox_claim(array['EmailOrder'], 10) r`);
assert.equal(
  claim.claimed.length,
  0,
  'an already-sent message is never sent again'
);
const settled3 = claim.settled.find((s) => s.outbox_id === o3);
assert.ok(
  settled3,
  'the re-queued row was settled, not left pending: ' + JSON.stringify(claim)
);
assert.equal((await outRow(o3)).status, 'Succeeded');
assert.match((await outRow(o3)).response_summary, /ALREADY_SENT/);

// ---------------------------------------------------------------------------
// 11. The approved content is the content that gets sent
// ---------------------------------------------------------------------------
const c4 = await draft();
ok(
  await cmd('tanya', C('COMMUNICATION_APPROVE', { communication_id: c4 })),
  'approve c4'
);
const o4 = ok(
  await cmd('tanya', C('COMMUNICATION_QUEUE', { communication_id: c4 })),
  'queue c4'
).outbox_id;
// Someone edits the body after approval (a future editor, or a data fix).
await db.query(
  `update public.communications set subject='Order SS-0001 rev 1 URGENT' where id=$1`,
  [c4]
);
claim = await sql(`select app.outbox_claim(array['EmailOrder'], 10) r`);
assert.equal(
  claim.claimed.length,
  0,
  'changed content is never sent on the old approval'
);
assert.equal(
  claim.settled.find((s) => s.outbox_id === o4).code,
  'PAYLOAD_CHANGED',
  JSON.stringify(claim.settled)
);
assert.equal((await outRow(o4)).status, 'NeedsReview');
assert.equal((await commRow(c4)).status, 'Uncertain');

// ---------------------------------------------------------------------------
// 12. A recipient dropped from the allow-list stops the send
// ---------------------------------------------------------------------------
const c5 = await draft();
ok(
  await cmd('tanya', C('COMMUNICATION_APPROVE', { communication_id: c5 })),
  'approve c5'
);
const o5 = ok(
  await cmd('tanya', C('COMMUNICATION_QUEUE', { communication_id: c5 })),
  'queue c5'
).outbox_id;
await setSetting('outbound.allowed_recipients', ['someone.else@example.com']);
claim = await sql(`select app.outbox_claim(array['EmailOrder'], 10) r`);
assert.equal(claim.claimed.length, 0);
assert.equal(
  claim.settled.find((s) => s.outbox_id === o5).code,
  'RECIPIENT_NOT_ALLOWLISTED',
  JSON.stringify(claim.settled)
);
assert.equal((await outRow(o5)).status, 'NeedsReview');

// ---------------------------------------------------------------------------
// 13. Reads
// ---------------------------------------------------------------------------
let d = await opread('tanya', { read_type: 'COMMUNICATIONS', job_id: job });
assert.equal(d.ok, true, JSON.stringify(d));
assert.ok(d.data.communications.length >= 5);
assert.ok(d.data.communications.every((c) => c.job_id === job));
const seen = d.data.communications.find((c) => c.communication_id === c3);
assert.equal(seen.status, 'Sent');
assert.equal(seen.dispatchable, true);
assert.equal(
  d.data.communications.find((c) => c.communication_id === notice).dispatchable,
  false
);

d = await opread('tanya', {
  read_type: 'COMMUNICATIONS',
  job_id: job,
  status: 'Uncertain'
});
assert.ok(d.data.communications.every((c) => c.status === 'Uncertain'));
assert.equal(
  (await opread('tanya', { read_type: 'COMMUNICATIONS', nonsense: 1 })).error,
  'R1A_INVALID_FIELDS'
);

d = await opread('tanya', { read_type: 'COMMUNICATION', communication_id: c3 });
assert.equal(d.data.communication.status, 'Sent');
assert.equal(d.data.recipients.ok, true);
assert.equal(d.data.outbox.status, 'Succeeded');
assert.deepEqual(d.data.acknowledgements, []);

// Installers and surveyors see none of this, through either read.
for (const who of ['inst_a', 'sam', 'store'])
  assert.equal(
    (await opread(who, { read_type: 'COMMUNICATIONS', job_id: job })).error,
    'R1A_ROLE_DENIED',
    who
  );

// ---------------------------------------------------------------------------
// The worker claims every email type the database registers
//
// A type registered in app.outbox_action_types but absent from the worker's
// list is invisible: its rows queue, pass every gate, and sit Pending for
// ever, which looks exactly like a shut gate. EmailReport was added to the
// database and not to the worker, so scheduled reports could never have been
// sent. Read from the code rather than restated here, so adding the next type
// fails this test until the worker knows about it.
// ---------------------------------------------------------------------------
const workerTypes = Array.from(
  fs
    .readFileSync(
      fileURLToPath(
        new URL(
          '../../src/features/communications/server/email-worker.ts',
          import.meta.url
        )
      ),
      'utf8'
    )
    .match(/EMAIL_ACTION_TYPES = \[([^\]]*)\]/)[1]
    .matchAll(/'([A-Za-z]+)'/g),
  (m) => m[1]
);
assert.deepEqual(
  workerTypes.slice().sort(),
  (
    await all(
      `select action_type from app.outbox_action_types where service = 'EmailService'`
    )
  )
    .map((r) => r.action_type)
    .sort(),
  'every EmailService action type is claimed by the email worker'
);

// ---------------------------------------------------------------------------
// The allow-list guards DERIVED recipients, not chosen ones
//
// A merchant address comes out of job data, so a bug there could write to a
// stranger and the allow-list is what stops it. A report's recipients were
// typed into a screen by somebody with the permission to choose them - asking
// for the same names again in a settings row only means the report silently
// does not arrive.
// ---------------------------------------------------------------------------
const stranger = 'nobody-allow-listed@example.test';
await db.query(
  `insert into public.settings (key, typed_value, scope, version, effective_from, reason)
   select 'outbound.allowed_recipients', '["someone.else@example.test"]'::jsonb, 'Global',
          coalesce(max(version),0)+1, current_date, 'test: the stranger is deliberately absent'
   from public.settings where key='outbound.allowed_recipients' and scope='Global'`
);

const decisionFor = async (type, actionType) => {
  const c = (
    await one(
      `insert into public.communications (type, subject, body_snapshot, recipients_snapshot, revision, status)
       values ($1,'Subject','Body',$2,1,'Queued') returning id`,
      [type, JSON.stringify([{ name: null, email: stranger }])]
    )
  ).id;
  const o = (
    await one(
      `insert into public.outbox (idempotency_key, action_type, target, payload_hash, job_revision, status)
       select $1, $2, app.setting('email.from_mailbox') #>> '{}',
              app.comm_payload_hash(c), 1, 'Pending'
       from public.communications c where c.id = $3 returning id`,
      [`TEST-${actionType}-${c}`, actionType, c]
    )
  ).id;
  await db.query(`update public.communications set outbox_id=$1 where id=$2`, [o, c]);
  return one(`select app.email_claim_decision(o) d from public.outbox o where o.id=$1`, [o]);
};

assert.equal(
  (await decisionFor('MerchantOrder', 'EmailOrder')).d.code,
  'RECIPIENT_NOT_ALLOWLISTED',
  'a DERIVED recipient still has to be allow-listed'
);
assert.equal(
  (await decisionFor('ScheduledReport', 'EmailReport')).d.decision,
  'send',
  'a CHOSEN recipient does not: picking them was the authorisation'
);

console.log('t_communications ok');
