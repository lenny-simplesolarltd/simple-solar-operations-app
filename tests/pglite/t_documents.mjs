// Customer document generation: the lifecycle around the renderer. Run:
//   node t_documents.mjs        (needs PORT_ALL=1; the runner sets it)
//
// The renderer itself is proved elsewhere (vitest, plus a pixel diff against
// the supplied masters). What these assertions protect is everything that
// could quietly ruin it afterwards:
//
//   - that a Ready revision is never rewritten, because an email sent last
//     week points at exactly those bytes;
//   - that a retry, a replay or two workers racing cannot make a second
//     revision of the same thing;
//   - that a failure leaves the job, the presale and every earlier revision
//     exactly as they were;
//   - that a historical import is never picked up at all.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './fixtures.mjs';

const f = await setup();
const { db, one, all, cmd, id, sell, as } = f;

const sold = await sell('tanya');
if (sold.error) {
  console.log('sale failed', sold);
  process.exit(1);
}
const JOB = sold.job_id;

const revisions = (type) =>
  all(
    `select * from public.document_revisions where job_id=$1 ${type ? 'and document_type=$2' : ''} order by document_type, revision_number`,
    type ? [JOB, type] : [JOB]
  );
const revision = (rid) =>
  one(`select * from public.document_revisions where id=$1`, [rid]);

// Registry reads (app.read_registry) go through execute_operations_read, not
// execute_read, which is what the shared `read` fixture calls.
const readOps = async (who, request) => {
  await as(who);
  try {
    return (
      await db.query(`select public.execute_operations_read($1::jsonb) r`, [
        request
      ])
    ).rows[0].r;
  } catch (e) {
    return { error: e.message, detail: e.detail };
  }
};

const svc = async (sql, params = []) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: e.message, detail: e.detail };
  }
};

/** Drive one revision all the way to Ready, as the worker would. */
async function generate(rid, { sha = 'a'.repeat(64), pages = 21 } = {}) {
  const up = await svc(
    `select public.document_revision_begin_upload($1::uuid, $2) r`,
    [rid, 'SS-TEST-0001-Quotation-Contract-R1.pdf']
  );
  if (up.error) return up;
  // PGlite has no Storage, and app.evidence_finalize treats a missing
  // storage.objects table as "nothing to verify" - the same path the other
  // suites take.
  return svc(
    `select public.document_revision_ready($1::uuid, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb) r`,
    [
      rid,
      sha,
      pages,
      JSON.stringify({ variables: { 'job.reference': sold.job_ref } }),
      'b'.repeat(64),
      '1.0.0',
      'c'.repeat(64),
      JSON.stringify([{ page: 19, reason: 'MCS inputs unavailable' }])
    ]
  );
}

// jobs_historical_is_inert: a historical record is archived and names the
// system it came from. Flipping record_class alone is refused, correctly.
const makeHistorical = () =>
  db.query(
    `update public.jobs
     set record_class='HistoricalImport', archived_at=now(),
         source_system='historical-job-booking-form'
     where id=$1`,
    [JOB]
  );
const makeLive = () =>
  db.query(
    `update public.jobs
     set record_class='Live', archived_at=null, source_system=null where id=$1`,
    [JOB]
  );

let passed = 0;
let composed = null;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- Queued by the sale, not by a person -------------------------------------

test('submitting a presale queues both documents', async () => {
  const rows = await revisions();
  assert.equal(rows.length, 2, 'one revision per document type');
  assert.deepEqual(rows.map((r) => r.document_type).sort(), [
    'QuotationContract',
    'ROI'
  ]);
  for (const r of rows) {
    assert.equal(r.status, 'Queued');
    assert.equal(r.revision_number, 1);
    assert.equal(r.source, 'system');
    assert.equal(r.attempt_count, 0);
  }
});

test('the presale itself is untouched by queueing', async () => {
  const p = await one(`select * from public.presales where job_id=$1`, [JOB]);
  assert.ok(p, 'the presale committed');
  assert.equal(p.net_panels, 12);
});

// --- Claiming ----------------------------------------------------------------

test('claim marks Generating and hands over the frozen snapshot', async () => {
  const r = await svc(`select public.document_revision_claim(10) r`);
  assert.ok(!r.error, r.error);
  const claimed = r.rows[0].r.claimed;
  assert.equal(claimed.length, 2);
  const first = claimed[0];
  // Everything the renderer needs, and nothing it has to go back for.
  assert.ok(first.source.presale.design !== undefined);
  assert.ok(first.source.customer.first_name);
  assert.equal(first.source.job.reference, sold.job_ref);
  assert.equal(first.source.job.is_historical_import, false);
  assert.equal(first.source.settings.electricity_inflation_pct, 5);
  assert.equal(first.attempt, 1);
  const rows = await revisions();
  assert.ok(rows.every((x) => x.status === 'Generating'));
  assert.ok(rows.every((x) => x.claimed_at !== null));
});

test('a second claim returns nothing - work is claimed once', async () => {
  const r = await svc(`select public.document_revision_claim(10) r`);
  assert.equal(r.rows[0].r.claimed.length, 0);
});

// --- Ready -------------------------------------------------------------------

test('a finished revision records its artifact and provenance', async () => {
  const [q] = await revisions('QuotationContract');
  const r = await generate(q.id);
  assert.ok(!r.error, r.error);
  const after = await revision(q.id);
  assert.equal(after.status, 'Ready');
  assert.equal(after.content_sha256, 'a'.repeat(64));
  assert.equal(after.page_count, 21);
  assert.equal(after.template_version, '1.0.0');
  assert.equal(after.renderer_version, '1.0.0');
  assert.ok(after.generated_at);
  assert.ok(after.evidence_id, 'linked to a Files row');
  assert.equal(after.omitted_pages.length, 1, 'withheld MCS pages recorded');
});

test('the artifact is registered in Files as the same single object', async () => {
  const after = (await revisions('QuotationContract'))[0];
  const e = await one(`select * from public.evidence where id=$1`, [
    after.evidence_id
  ]);
  assert.equal(e.category, 'GeneratedDocument');
  assert.equal(e.job_id, JOB);
  assert.equal(e.scope, 'Job');
  assert.equal(e.upload_status, 'Uploaded');
  // One row, one object: Job Detail and Files point at the same bytes.
  assert.equal(e.storage_path, after.storage_path);
  assert.ok(e.storage_path.startsWith(`${JOB}/${e.id}/`));
});

test('completing twice is a replay, not a second document', async () => {
  const before = (await revisions('QuotationContract'))[0];
  const r = await generate(before.id);
  assert.ok(!r.error, r.error);
  assert.equal(r.rows[0].r.replayed, true);
  const after = (await revisions('QuotationContract'))[0];
  assert.equal(after.evidence_id, before.evidence_id);
  assert.equal(after.generated_at.getTime(), before.generated_at.getTime());
});

// --- Immutability ------------------------------------------------------------

test('a Ready revision cannot be rewritten', async () => {
  const [q] = await revisions('QuotationContract');
  const r = await svc(
    `update public.document_revisions set content_sha256=$2 where id=$1`,
    [q.id, 'd'.repeat(64)]
  );
  assert.match(r.error ?? '', /DOCUMENT_REVISION_IMMUTABLE/);
});

test('a Ready revision cannot be deleted', async () => {
  const [q] = await revisions('QuotationContract');
  const r = await svc(`delete from public.document_revisions where id=$1`, [
    q.id
  ]);
  assert.match(r.error ?? '', /DOCUMENT_REVISION_IMMUTABLE/);
});

test('a Ready revision cannot be re-opened for another attempt', async () => {
  const [q] = await revisions('QuotationContract');
  const r = await svc(
    `update public.document_revisions set status='Queued' where id=$1`,
    [q.id]
  );
  assert.match(r.error ?? '', /DOCUMENT_REVISION_IMMUTABLE/);
});

// --- Failure -----------------------------------------------------------------

test('a failure schedules a retry and keeps the reason', async () => {
  const [roi] = await revisions('ROI');
  const r = await svc(
    `select public.document_revision_failed($1::uuid, $2, $3::jsonb, true) r`,
    [roi.id, 'MISSING_CONSUMPTION', JSON.stringify({ variable: 'roi.consume' })]
  );
  assert.ok(!r.error, r.error);
  const after = await revision(roi.id);
  assert.equal(
    after.status,
    'Queued',
    'retryable failures go back in the queue'
  );
  assert.equal(after.error_code, 'MISSING_CONSUMPTION');
  assert.ok(after.next_attempt, 'with a backoff');
  assert.equal(after.claimed_at, null);
});

test('a failure corrupts nothing else', async () => {
  // The job, the presale and the other document are exactly as they were.
  const job = await one(`select * from public.jobs where id=$1`, [JOB]);
  assert.equal(job.job_ref, sold.job_ref);
  const p = await one(`select * from public.presales where job_id=$1`, [JOB]);
  assert.ok(p);
  const [q] = await revisions('QuotationContract');
  assert.equal(q.status, 'Ready');
  assert.ok(q.evidence_id);
});

test('an unretryable failure stops immediately', async () => {
  const [roi] = await revisions('ROI');
  const r = await svc(
    `select public.document_revision_failed($1::uuid, $2, null, false) r`,
    [roi.id, 'INCOMPLETE_DESIGN']
  );
  assert.ok(!r.error, r.error);
  const after = await revision(roi.id);
  assert.equal(after.status, 'Failed');
  assert.equal(after.next_attempt, null);
  assert.equal(after.error_code, 'INCOMPLETE_DESIGN');
});

test('a failed revision can be asked for again, as a new attempt', async () => {
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'ROI' }
  });
  assert.ok(r.ok, JSON.stringify(r));
  const rows = await revisions('ROI');
  assert.equal(rows.length, 2, 'a new revision, not a resurrected one');
  assert.equal(rows[1].revision_number, 2);
  assert.equal(
    rows[0].status,
    'Failed',
    'the failed attempt is still on record'
  );
});

// --- Regeneration ------------------------------------------------------------

test('regenerating makes R2 and supersedes R1 without touching its file', async () => {
  const before = (await revisions('QuotationContract'))[0];
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'QuotationContract' }
  });
  assert.ok(r.ok, JSON.stringify(r));

  await svc(`select public.document_revision_claim(10) r`);
  const rows = await revisions('QuotationContract');
  const r2 = rows.find((x) => x.revision_number === 2);
  assert.ok(r2, 'a second revision exists');
  await generate(r2.id, { sha: 'e'.repeat(64) });

  const after = await revisions('QuotationContract');
  const [one_, two] = after;
  assert.equal(one_.status, 'Superseded');
  assert.equal(two.status, 'Ready');
  // R1's artifact is byte-identical to what it always was.
  assert.equal(one_.content_sha256, before.content_sha256);
  assert.equal(one_.evidence_id, before.evidence_id);
  assert.equal(one_.storage_path, before.storage_path);
  assert.equal(one_.superseded_by, two.id);
  assert.notEqual(two.content_sha256, one_.content_sha256);
});

test('a superseded revision stays superseded', async () => {
  const [r1] = await revisions('QuotationContract');
  const r = await svc(
    `update public.document_revisions set status='Ready' where id=$1`,
    [r1.id]
  );
  assert.match(r.error ?? '', /DOCUMENT_REVISION_IMMUTABLE/);
});

// --- Idempotency -------------------------------------------------------------

test('the same command twice yields one revision', async () => {
  const commandId = id();
  const request = {
    command_id: commandId,
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'ROI' }
  };
  const before = (await revisions('ROI')).length;
  const a = await cmd('tanya', request);
  const b = await cmd('tanya', request);
  assert.ok(a.ok && b.ok);
  assert.equal(b.replayed, true, 'the ledger answered the second one');
  assert.equal((await revisions('ROI')).length, before);
});

test('a second request while one is in flight joins it', async () => {
  // Two people pressing Generate must not make two documents.
  const before = await revisions('ROI');
  const open = before.filter((r) =>
    ['Queued', 'Generating'].includes(r.status)
  );
  assert.ok(open.length <= 1, 'at most one open revision per type');
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'ROI' }
  });
  assert.ok(r.ok);
  const after = await revisions('ROI');
  assert.equal(after.length, before.length, 'no new revision was created');
});

// --- Historical imports ------------------------------------------------------

test('a historical import is refused and never queued', async () => {
  await makeHistorical();
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'ROI' }
  });
  assert.ok(r.error, 'refused');
  assert.match(r.error, /HISTORICAL_IMPORT/);
  await makeLive();
});

test('a worker never claims a historical import', async () => {
  // Leave one revision genuinely due, then mark the job historical.
  await db.query(
    `update public.document_revisions set status='Queued', next_attempt=now(), claimed_at=null
     where job_id=$1 and document_type='ROI' and revision_number=(
       select max(revision_number) from public.document_revisions where job_id=$1 and document_type='ROI')`,
    [JOB]
  );
  await makeHistorical();
  const r = await svc(`select public.document_revision_claim(10) r`);
  assert.equal(r.rows[0].r.claimed.length, 0, 'nothing was picked up');
  await makeLive();
});

// --- Stalled workers ---------------------------------------------------------

test('a revision abandoned mid-flight is recovered, not lost', async () => {
  const rows = await revisions('ROI');
  const target = rows[rows.length - 1];
  await db.query(
    `update public.document_revisions
     set status='Generating', claimed_at=now() - interval '1 hour', next_attempt=null
     where id=$1`,
    [target.id]
  );
  const r = await svc(`select public.document_revision_claim(10) r`);
  assert.ok(!r.error, r.error);
  assert.ok(r.rows[0].r.released_stalled >= 1, 'the stalled row was released');
});

// --- Authorisation and reads -------------------------------------------------

test('an installer cannot ask for a document', async () => {
  const r = await cmd('inst_a', {
    command_id: id(),
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'ROI' }
  });
  assert.ok(r.error, 'refused');
  assert.match(r.error, /DENIED|NOT_VISIBLE|NOT_ASSIGNED/);
});

test('the worker functions are closed to ordinary sessions', async () => {
  const granted = await all(
    `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') auth_ok
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('document_revision_claim','document_revision_ready','document_revision_failed','document_revision_begin_upload')`
  );
  assert.equal(granted.length, 4);
  for (const g of granted) {
    assert.equal(
      g.auth_ok,
      false,
      `${g.proname} must not be callable by a session`
    );
  }
});

test('JOB_DOCUMENTS returns the current revision and its history', async () => {
  const r = await readOps('tanya', {
    read_type: 'JOB_DOCUMENTS',
    job_id: JOB
  });
  assert.ok(r.ok, JSON.stringify(r));
  const data = r.data;
  assert.equal(data.job_reference, sold.job_ref);
  assert.equal(data.has_presale, true);
  const q = data.documents.find((d) => d.document_type === 'QuotationContract');
  assert.equal(q.current.status, 'Ready');
  assert.equal(q.current.revision_number, 2);
  assert.ok(q.history.length >= 2, 'older revisions remain visible');
  // Technical identity is present but tucked away.
  assert.ok(q.current.details.content_sha256);
  assert.ok(q.current.details.template_version);
});

test('DOCUMENT_OPERATIONS reports the work and why it failed', async () => {
  const r = await readOps('tanya', { read_type: 'DOCUMENT_OPERATIONS' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(Array.isArray(r.data.revisions));
  assert.ok(r.data.revisions.length > 0);
  const row = r.data.revisions[0];
  for (const key of [
    'status',
    'attempt_count',
    'next_attempt',
    'error_code',
    'job_reference',
    'document_type'
  ]) {
    assert.ok(key in row, `operations view exposes ${key}`);
  }
  assert.ok(r.data.counts);
});

// --- Communications: the attachment is a revision, forever -------------------

test('composing refuses when the customer has no email address', async () => {
  // The fixture customer was captured with a phone number only. Guessing an
  // address, or composing to nobody, would be worse than saying so.
  const rows = await revisions('QuotationContract');
  const r1 = rows.find((x) => x.revision_number === 1);
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'COMMUNICATION_COMPOSE',
    job_id: JOB,
    payload: { revision_id: r1.id }
  });
  assert.ok(r.error, 'refused');
  assert.match(r.error, /COMM_RECIPIENTS_INVALID/);
});

test('Email composes a Draft with the exact revision attached', async () => {
  await db.query(
    `update public.customers set email='ann.smith@example.com'
     where id=(select customer_id from public.jobs where id=$1)`,
    [JOB]
  );
  const rows = await revisions('QuotationContract');
  const r1 = rows.find((x) => x.revision_number === 1);
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'COMMUNICATION_COMPOSE',
    job_id: JOB,
    payload: { revision_id: r1.id }
  });
  assert.ok(r.ok, JSON.stringify(r));
  const out = r.result;
  assert.equal(out.attachment_evidence_id, r1.evidence_id);
  assert.match(out.subject, /Simple Solar quotation/);
  assert.match(out.subject, new RegExp(sold.job_ref));

  const comm = await one(`select * from public.communications where id=$1`, [
    out.communication_id
  ]);
  assert.equal(comm.status, 'Draft', 'composing sends nothing');
  assert.equal(comm.type, 'CustomerDocument');
  assert.equal(comm.job_id, JOB);
  assert.deepEqual(comm.attachment_ids, [r1.evidence_id]);
  composed = { communicationId: comm.id, evidenceId: r1.evidence_id };
});

test('a customer email can never be queued for automatic dispatch', async () => {
  // CustomerDocument has no action_type, so there is no released function that
  // could send it. A person sends it and records that they did.
  const kind = await one(
    `select * from app.communication_kinds where type='CustomerDocument'`
  );
  assert.equal(kind.action_type, null);
  assert.equal(kind.function_id, null);
});

test('a newer revision does not rewrite an earlier email', async () => {
  const before = await one(`select * from public.communications where id=$1`, [
    composed.communicationId
  ]);
  // Generate R3 of the quotation.
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'QuotationContract' }
  });
  assert.ok(r.ok, JSON.stringify(r));
  await svc(`select public.document_revision_claim(10) r`);
  const rows = await revisions('QuotationContract');
  const newest = rows[rows.length - 1];
  await generate(newest.id, { sha: 'f'.repeat(64) });

  const after = await one(`select * from public.communications where id=$1`, [
    composed.communicationId
  ]);
  assert.deepEqual(
    after.attachment_ids,
    before.attachment_ids,
    'the email still points at the revision it was composed with'
  );
  assert.equal(after.attachment_ids[0], composed.evidenceId);

  // And that revision's own bytes are untouched, though it is superseded.
  const r1 = rows.find((x) => x.revision_number === 1);
  assert.equal(r1.status, 'Superseded');
  assert.equal(r1.evidence_id, composed.evidenceId);
  assert.equal(r1.content_sha256, 'a'.repeat(64));
});

test('an unfinished revision cannot be attached to anything', async () => {
  const roi = (await revisions('ROI')).find((x) => x.status !== 'Ready');
  if (!roi) return;
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'COMMUNICATION_COMPOSE',
    job_id: JOB,
    payload: { revision_id: roi.id }
  });
  assert.ok(r.error, 'refused');
  assert.match(r.error, /DOCUMENT_REVISION_NOT_READY/);
});

for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e.message}`);
    process.exit(1);
  }
}
console.log(`ok ${passed}/${tests.length} document generation`);
