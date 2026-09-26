// Quote versions: editing a presale without ever editing a presale. Run:
//   node t_presale_versions.mjs        (needs PORT_ALL=1; the runner sets it)
//
// The whole point is that "editable" and "immutable" are both true here. A
// correction and a new version both write a NEW row and supersede the old one;
// nothing is ever updated in place except the two columns that mark a row
// superseded. That is what keeps a contract traceable to the figures it was
// generated from after somebody has changed their mind twice.
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';

const f = await setup();
const { db, one, all, cmd, id, sell, as } = f;

const sold = await sell('tanya');
if (sold.error) {
  console.log('sale failed', sold);
  process.exit(1);
}
const JOB = sold.job_id;

const versions = () =>
  all(
    `select * from public.presales where job_id=$1
     order by quote_number, correction_number`,
    [JOB]
  );
const current = () =>
  one(
    `select * from public.presales where job_id=$1 and superseded_by is null`,
    [JOB]
  );
const revisions = () =>
  all(
    `select * from public.document_revisions where job_id=$1
     order by document_type, revision_number`,
    [JOB]
  );

const svc = async (sql, params = []) => {
  try {
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { error: e.message, detail: e.detail };
  }
};

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

const revise = (mode, payload = {}) =>
  cmd('tanya', {
    command_id: id(),
    command_type: 'PRESALE_REVISE',
    job_id: JOB,
    payload: { mode, reason: 'because the customer asked', ...payload }
  });

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- The starting point -------------------------------------------------------

test('a sale starts at Quote 1', async () => {
  const rows = await versions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quote_number, 1);
  assert.equal(rows[0].correction_number, 1);
  assert.equal(rows[0].superseded_by, null, 'and it is the current one');
  assert.equal(rows[0].revision_reason, null, 'the original needs no reason');
});

// --- Correcting ---------------------------------------------------------------

test('a correction keeps the quote number and moves the revision', async () => {
  const r = await revise('correction', {
    roof_notes: 'south-facing, corrected'
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result.quote_number, 1, 'the customer still has Quote 1');
  assert.equal(r.result.correction_number, 2);
  assert.equal(r.result.quote_label, 'Quote 1 (rev 2)');

  const rows = await versions();
  assert.equal(rows.length, 2, 'a new row, not an edited one');
  assert.equal(
    rows[0].superseded_by,
    rows[1].id,
    'the old one points at the new'
  );
  assert.ok(rows[0].superseded_at);
  assert.equal(rows[1].roof_notes, 'south-facing, corrected');
});

test('the superseded version is byte-for-byte what it always was', async () => {
  const [first] = await versions();
  assert.equal(first.roof_notes, null, 'the original notes are untouched');
  assert.equal(first.quote_number, 1);
  assert.equal(first.correction_number, 1);
});

test('unchanged fields carry forward', async () => {
  const c = await current();
  assert.equal(
    Number(c.agreed_price_pence),
    500000,
    'price was not in the payload'
  );
  assert.equal(c.net_panels, 12);
});

// --- New versions -------------------------------------------------------------

test('a new version moves the quote number and resets the revision', async () => {
  const r = await revise('new_version', {
    agreed_price_pence: 640000,
    computed: {
      system_kwp: 7.6,
      net_panels: 16,
      computed_total_pence: 640000,
      price_breakdown: []
    },
    reason: 'customer wants a second battery'
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.result.quote_number, 2);
  assert.equal(r.result.correction_number, 1, 'a new quote starts at rev 1');
  assert.equal(r.result.quote_label, 'Quote 2');

  const c = await current();
  assert.equal(Number(c.agreed_price_pence), 640000);
  assert.equal(c.net_panels, 16);
  assert.equal(c.revision_reason, 'customer wants a second battery');
});

test('exactly one version is ever current', async () => {
  const rows = await versions();
  assert.equal(rows.length, 3);
  assert.equal(
    rows.filter((r) => r.superseded_by === null).length,
    1,
    'one current version'
  );
  // And the database enforces it, not just this code.
  const r = await svc(
    `insert into public.presales
       (job_id, surveyor_id, submitted_at, design, design_schema_version, catalogue_version,
        system_kwp, net_panels, computed_total_pence, agreed_price_pence, price_breakdown,
        quote_number, correction_number)
     values ($1, $2, now(), '{}'::jsonb, 1, 'x', 1, 1, 1, 1, '[]'::jsonb, 99, 99)`,
    [JOB, f.people.sam]
  );
  assert.match(r.error ?? '', /presales_current_per_job/);
});

// --- Immutability -------------------------------------------------------------

test('a presale still cannot be edited', async () => {
  const c = await current();
  const r = await svc(
    `update public.presales set agreed_price_pence=1 where id=$1`,
    [c.id]
  );
  assert.match(r.error ?? '', /PRESALES_IS_IMMUTABLE/);
});

test('a presale still cannot be deleted', async () => {
  const c = await current();
  const r = await svc(`delete from public.presales where id=$1`, [c.id]);
  assert.match(r.error ?? '', /PRESALES_IS_IMMUTABLE/);
});

test('a superseded version cannot be superseded again', async () => {
  const [first] = await versions();
  const c = await current();
  const r = await svc(
    `update public.presales set superseded_by=$2, superseded_at=now() where id=$1`,
    [first.id, c.id]
  );
  assert.match(r.error ?? '', /PRESALES_IS_IMMUTABLE/);
});

test('superseding cannot smuggle another change through with it', async () => {
  const c = await current();
  const [first] = await versions();
  const r = await svc(
    `update public.presales
     set superseded_by=$2, superseded_at=now(), agreed_price_pence=999
     where id=$1`,
    [c.id, first.id]
  );
  assert.match(r.error ?? '', /PRESALES_IS_IMMUTABLE/);
});

// --- What it means for documents ---------------------------------------------

test('each version queues its own documents', async () => {
  const rows = await revisions();
  const perPresale = new Map();
  for (const r of rows)
    perPresale.set(r.presale_id, (perPresale.get(r.presale_id) ?? 0) + 1);
  assert.ok(perPresale.size >= 2, 'more than one version has documents');
});

test('a document queued against an older version is abandoned, not rendered', async () => {
  // Quote 1's queued revisions must not quietly render as Quote 2.
  const rows = await revisions();
  const abandoned = rows.filter(
    (r) => r.error_code === 'SUPERSEDED_BEFORE_RENDER'
  );
  assert.ok(abandoned.length > 0, 'the superseded queue entries were failed');
  for (const r of abandoned) assert.equal(r.status, 'Failed');
});

test('generation always uses the current version', async () => {
  const c = await current();
  const rows = await revisions();
  const open = rows.filter((r) => ['Queued', 'Generating'].includes(r.status));
  assert.ok(open.length > 0);
  for (const r of open)
    assert.equal(r.presale_id, c.id, 'queued against the current quote');
});

// --- Refusals -----------------------------------------------------------------

test('a revision must say why it exists', async () => {
  const r = await cmd('tanya', {
    command_id: id(),
    command_type: 'PRESALE_REVISE',
    job_id: JOB,
    payload: { mode: 'correction' }
  });
  assert.match(r.error ?? '', /PRESALE_REASON_REQUIRED/);
});

test('the mode must be one of the two that mean something', async () => {
  const r = await revise('whatever');
  assert.match(r.error ?? '', /PRESALE_MODE_INVALID/);
});

test('an installer cannot revise a sale', async () => {
  const r = await cmd('inst_a', {
    command_id: id(),
    command_type: 'PRESALE_REVISE',
    job_id: JOB,
    payload: { mode: 'correction', reason: 'x' }
  });
  assert.ok(r.error, 'refused');
  assert.match(r.error, /DENIED|NOT_VISIBLE|NOT_ASSIGNED/);
});

test('a historical record has no presale to revise', async () => {
  await db.query(
    `update public.jobs set record_class='HistoricalImport', archived_at=now(),
     source_system='historical-job-booking-form' where id=$1`,
    [JOB]
  );
  const r = await revise('correction');
  assert.match(r.error ?? '', /HISTORICAL_IMPORT/);
  await db.query(
    `update public.jobs set record_class='Live', archived_at=null, source_system=null where id=$1`,
    [JOB]
  );
});

// --- Reading the history ------------------------------------------------------

test('PRESALE_VERSIONS lists every quote, newest first', async () => {
  const r = await readOps('tanya', {
    read_type: 'PRESALE_VERSIONS',
    job_id: JOB
  });
  assert.ok(r.ok, JSON.stringify(r));
  const v = r.data.versions;
  assert.equal(v.length, 3);
  assert.equal(v[0].quote_label, 'Quote 2');
  assert.equal(v[0].is_current, true);
  assert.equal(v[1].quote_label, 'Quote 1 (rev 2)');
  assert.equal(v[2].quote_label, 'Quote 1');
  assert.equal(v.filter((x) => x.is_current).length, 1);
});

test('the job overview still resolves one presale, and names the quote', async () => {
  // This is the read that a scalar subquery would have broken outright.
  const c = await current();
  const r = await one(
    `select app.read_job_overview(j) o from public.jobs j where j.id=$1`,
    [JOB]
  );
  assert.equal(r.o.booking.presale_id, c.id);
  assert.equal(r.o.booking.quote_label, 'Quote 2');
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
console.log(`ok ${passed}/${tests.length} presale versions`);
