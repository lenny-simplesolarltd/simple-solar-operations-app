// Integration tests for Evidence against a REAL local Supabase stack with
// Storage: real sessions, the real storage policies, real signed URLs.
// (The database rules themselves are covered in tests/pglite/t_evidence.mjs.)
//
// The shared local stack runs without Storage, so point this at a stack that
// has it:  SUPABASE_TEST_WORKDIR=<dir with supabase/config.toml> \
//          node --test tests/storage-evidence.test.mjs
// Without Storage the suite skips itself (and says so) instead of failing.
// Named to run after 00-identity.test.mjs (first by name), which expects a database with no logins yet.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import { anon, API_URL, email, ensureLogin, person, service, signInAs } from './helpers.mjs';

const hasStorage = !!(await service.storage.getBucket('evidence')).data;
const skip = hasStorage ? false : 'this local stack runs without Storage';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const bucket = (client) => client.storage.from('evidence');

let tanya, lucy, john, rick;
let jobA, jobB, pre02A, pre02B;
let uploaded; // { evidence_id, storage_path } of job A's contract

const sale = (salespersonId, n) => ({
  customer: { first_name: 'Evi', last_name: `Dence${n}`, address_line1: '1 Test Street', address_line2: null,
              town: 'Exeter', postcode: 'EX1 1AA', phone: '07000 000000', email: `evi${n}@example.com` },
  sale: { salesperson_id: salespersonId, lead_source: 'Referral', quote_reference: `Q-EV-${n}`,
          finance_route: 'Standard', agreed_price_pence: 1250000 },
  scope: { roof_required: true, electrical_required: true, scaffold_required: true, roof_notes: null, electrical_notes: null },
  design: { slopes: [] }, design_schema_version: 1, catalogue_version: 'test-catalogue',
  computed: { system_kwp: 5.1, net_panels: 10, computed_total_pence: 1250000,
              price_breakdown: [{ key: 'total', label: 'Total', pence: 1250000 }] }
});

const begin = (client, contextId, over = {}) => client.rpc('evidence_upload_begin', { p_request: {
  upload_id: randomUUID(), context_type: 'Task', context_id: contextId, filename: 'signed contract.pdf',
  mime_type: 'application/pdf', size_bytes: PDF.length, ...over } });

/** Register, send the bytes through a signed upload URL, confirm. */
async function uploadFor(client, taskId, over = {}) {
  const reg = await begin(client, taskId, over);
  assert.ifError(reg.error);
  const ticket = await bucket(client).createSignedUploadUrl(reg.data.storage_path);
  assert.ifError(ticket.error);
  const sent = await bucket(client).uploadToSignedUrl(reg.data.storage_path, ticket.data.token, PDF, { contentType: 'application/pdf' });
  assert.ifError(sent.error);
  const done = await client.rpc('evidence_upload_complete', { p_evidence_id: reg.data.evidence_id });
  assert.ifError(done.error);
  return done.data;
}

before(async () => {
  if (!hasStorage) return;
  for (const name of ['tanya', 'lucy', 'john', 'rick']) await ensureLogin(email(name));
  [tanya, lucy, john, rick] = await Promise.all(['tanya', 'lucy', 'john', 'rick'].map((n) => signInAs(email(n))));
  const rickRow = await person('PERSON-rick');
  // Local stack only (helpers.mjs asserts it): switch the task commands on.
  const modes = await service.from('release_modes').update({ mode: 'Automated', authorised_job_scope: 'Pilot' }).eq('function_id', 'FN-01');
  assert.ifError(modes.error);
  for (const n of [1, 2]) {
    const sold = await tanya.rpc('submit_presale', { p_command_id: randomUUID(), p_payload: sale(rickRow.id, `${n}-${Date.now()}`) });
    assert.ifError(sold.error);
    if (n === 1) jobA = sold.data.job_id; else jobB = sold.data.job_id;
  }
  const tasks = await service.from('tasks').select('*').in('job_id', [jobA, jobB]).eq('template_code', 'PRE02');
  assert.ifError(tasks.error);
  pre02A = tasks.data.find((t) => t.job_id === jobA);
  pre02B = tasks.data.find((t) => t.job_id === jobB);
});

describe('bucket', { skip }, () => {
  test('is private, size-limited and type-limited', async () => {
    const { data } = await service.storage.getBucket('evidence');
    assert.equal(data.public, false);
    assert.equal(data.file_size_limit, 25 * 1024 * 1024);
    assert.deepEqual([...data.allowed_mime_types].sort(),
      ['application/pdf', 'image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp']);
  });
});

describe('upload', { skip }, () => {
  test('registered upload through a signed URL; storage is the witness', async () => {
    uploaded = await uploadFor(tanya, pre02A.id);
    assert.equal(uploaded.upload_status, 'Uploaded');
    assert.equal(uploaded.size_bytes, PDF.length);
    assert.equal(uploaded.mime_type, 'application/pdf');
    assert.ok(uploaded.storage_path.startsWith(`${jobA}/${uploaded.evidence_id}/`));
    const { data: row } = await service.from('evidence').select('*').eq('id', uploaded.evidence_id).single();
    assert.equal(row.job_id, jobA);
    assert.equal(row.task_id, pre02A.id);
    assert.equal(row.category, 'Contract');
    assert.equal(row.uploaded_by, (await person('PERSON-tanya')).id);
  });

  test('a retry with the same upload id is the same evidence; the stored file cannot be overwritten', async () => {
    const uploadId = randomUUID();
    const first = await begin(tanya, pre02A.id, { upload_id: uploadId, filename: 'retry.pdf' });
    const again = await begin(tanya, pre02A.id, { upload_id: uploadId, filename: 'retry.pdf' });
    assert.equal(again.data.evidence_id, first.data.evidence_id);
    assert.equal(again.data.replayed, true);
    const ticket = await bucket(tanya).createSignedUploadUrl(first.data.storage_path);
    assert.ifError(ticket.error);
    assert.ifError((await bucket(tanya).uploadToSignedUrl(first.data.storage_path, ticket.data.token, PDF, { contentType: 'application/pdf' })).error);
    // the answer was "lost": the browser retries the same file
    const second = await bucket(tanya).createSignedUploadUrl(first.data.storage_path);
    assert.ok(second.error, 'no second upload URL for a path that already holds a file');
    const done = await tanya.rpc('evidence_upload_complete', { p_evidence_id: first.data.evidence_id });
    assert.equal(done.data.upload_status, 'Uploaded');
    assert.equal((await begin(tanya, pre02A.id, { upload_id: uploadId, filename: 'retry.pdf' })).data.upload_status, 'Uploaded');
    const rows = await service.from('evidence').select('id').eq('client_upload_id', uploadId);
    assert.equal(rows.data.length, 1);
  });

  test('storage itself refuses the wrong type and an oversized file', async () => {
    const html = await begin(tanya, pre02A.id, { filename: 'page.pdf' });
    let ticket = await bucket(tanya).createSignedUploadUrl(html.data.storage_path);
    const asHtml = await bucket(tanya).uploadToSignedUrl(html.data.storage_path, ticket.data.token,
      Buffer.from('<script>alert(1)</script>'), { contentType: 'text/html' });
    assert.ok(asHtml.error, 'text/html accepted by the bucket');
    assert.equal((await tanya.rpc('evidence_upload_complete', { p_evidence_id: html.data.evidence_id })).error?.message, 'R1A_UPLOAD_MISSING');

    const big = await begin(tanya, pre02A.id, { filename: 'big.pdf', size_bytes: 1000 }); // lies about the size
    ticket = await bucket(tanya).createSignedUploadUrl(big.data.storage_path);
    const tooBig = await bucket(tanya).uploadToSignedUrl(big.data.storage_path, ticket.data.token,
      Buffer.alloc(25 * 1024 * 1024 + 1024, 1), { contentType: 'application/pdf' });
    assert.ok(tooBig.error, 'oversized file accepted by the bucket');
    assert.equal((await tanya.rpc('evidence_upload_complete', { p_evidence_id: big.data.evidence_id })).error?.message, 'R1A_UPLOAD_MISSING');
  });

  test('nobody writes to a path that is not their own pending registration', async () => {
    const reg = await begin(tanya, pre02A.id, { filename: 'mine.pdf' });
    for (const [who, client, path] of [
      ['uploader, guessed path', tanya, `${jobA}/guessed.pdf`],
      ['uploader, sibling of a registered path', tanya, reg.data.storage_path.replace('mine.pdf', 'other.pdf')],
      ['another office user, registered path', lucy, reg.data.storage_path],
      ['installer, registered path', john, reg.data.storage_path],
      ['signed out, registered path', anon, reg.data.storage_path]
    ]) {
      assert.ok((await bucket(client).upload(path, PDF, { contentType: 'application/pdf' })).error, `${who}: direct upload`);
      assert.ok((await bucket(client).createSignedUploadUrl(path)).error, `${who}: signed upload url`);
    }
    // an uploaded file can be neither replaced, moved nor removed by staff
    assert.ok((await bucket(tanya).upload(uploaded.storage_path, PDF, { contentType: 'application/pdf', upsert: true })).error);
    assert.ok((await bucket(tanya).move(uploaded.storage_path, `${jobB}/stolen.pdf`)).error);
    await bucket(tanya).remove([uploaded.storage_path]);
    assert.ok((await service.storage.from('evidence').download(uploaded.storage_path)).data, 'remove() by staff deleted the file');
  });
});

describe('open / download', { skip }, () => {
  test('authorized staff get a short-lived URL that serves the file', async () => {
    for (const client of [tanya, lucy, rick]) {       // owner, other office (job.read.all), the salesperson
      const open = await client.rpc('evidence_open', { p_evidence_id: uploaded.evidence_id });
      assert.ifError(open.error);
      const signed = await bucket(client).createSignedUrl(open.data.storage_path, 60);
      assert.ifError(signed.error);
      const response = await fetch(signed.data.signedUrl);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
    }
    const signed = await bucket(tanya).createSignedUrl(uploaded.storage_path, 60, { download: 'Signed contract.pdf' });
    const response = await fetch(signed.data.signedUrl);
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/);
  });

  test('knowing the path gains an unauthorized person nothing', async () => {
    assert.equal((await john.rpc('evidence_open', { p_evidence_id: uploaded.evidence_id })).error?.message, 'EVIDENCE_ACCESS_DENIED');
    assert.ok((await anon.rpc('evidence_open', { p_evidence_id: uploaded.evidence_id })).error);
    for (const [who, client] of [['installer', john], ['signed out', anon]]) {
      assert.ok((await bucket(client).download(uploaded.storage_path)).error, `${who}: download`);
      assert.ok((await bucket(client).createSignedUrl(uploaded.storage_path, 60)).error, `${who}: signed url`);
      assert.deepEqual((await bucket(client).list(jobA)).data ?? [], [], `${who}: list`);
      assert.deepEqual((await client.from('evidence').select('id').eq('job_id', jobA)).data ?? [], [], `${who}: table`);
    }
    // no public URL exists for a private bucket
    const pub = await fetch(`${API_URL}/storage/v1/object/public/evidence/${uploaded.storage_path}`);
    assert.ok(pub.status >= 400);
    const bare = await fetch(`${API_URL}/storage/v1/object/evidence/${uploaded.storage_path}`);
    assert.ok(bare.status >= 400);
    // the list never carries a path
    const list = await tanya.rpc('list_evidence', { p_request: { job_id: jobA } });
    assert.ok(list.data.evidence.length >= 1);
    assert.ok(list.data.evidence.every((e) => !('storage_path' in e) && e.job_id === jobA));
    assert.deepEqual((await john.rpc('list_evidence', { p_request: { job_id: jobA } })).data.evidence, []);
  });

  test('an inactive person opens nothing, through the database or Storage', async () => {
    const lucyRow = await person('PERSON-lucy');
    await service.from('people').update({ active: false }).eq('id', lucyRow.id);
    try {
      assert.equal((await lucy.rpc('evidence_open', { p_evidence_id: uploaded.evidence_id })).error?.message, 'R1A_INACTIVE_ACTOR');
      assert.ok((await bucket(lucy).createSignedUrl(uploaded.storage_path, 60)).error);
      assert.ok((await bucket(lucy).download(uploaded.storage_path)).error);
    } finally {
      await service.from('people').update({ active: true }).eq('id', lucyRow.id);
    }
  });
});

describe('commands', { skip }, () => {
  const complete = (client, task, path) => client.rpc('execute_command', { p_request: {
    command_id: randomUUID(), command_type: 'TASK_COMPLETE', task_id: task.id, expected_version: task.version,
    payload: { completion_note: 'signed', contract_id: 'SIG-1', contract_signed: true, evidence_path: path } } });

  test('a file of job A cannot complete a task of job B; a dropped-in file is never adopted', async () => {
    assert.equal((await complete(tanya, pre02B, uploaded.storage_path)).error?.message, 'R1A_CROSS_JOB_EVIDENCE');
    const stray = `${jobB}/dropped-in.pdf`;
    assert.ifError((await service.storage.from('evidence').upload(stray, PDF, { contentType: 'application/pdf' })).error);
    assert.equal((await complete(tanya, pre02B, stray)).error?.message, 'R1A_UPLOAD_INVALID');
    assert.ok((await bucket(tanya).download(stray)).error, 'a file without metadata is readable');
    const still = await service.from('tasks').select('status, evidence_id').eq('id', pre02B.id).single();
    assert.equal(still.data.status, 'Open');
    assert.equal(still.data.evidence_id, null);
  });

  test('a registered file that never arrived completes nothing; once stored, the command confirms it', async () => {
    const reg = await begin(tanya, pre02B.id, { filename: 'b-contract.pdf' });
    assert.equal((await complete(tanya, pre02B, reg.data.storage_path)).error?.message, 'R1A_UPLOAD_MISSING');
    assert.equal((await service.from('tasks').select('status').eq('id', pre02B.id).single()).data.status, 'Open');
    const ticket = await bucket(tanya).createSignedUploadUrl(reg.data.storage_path);
    assert.ifError((await bucket(tanya).uploadToSignedUrl(reg.data.storage_path, ticket.data.token, PDF, { contentType: 'application/pdf' })).error);
    const done = await complete(tanya, pre02B, reg.data.storage_path);   // no evidence_upload_complete call in between
    assert.ifError(done.error);
    const job = await service.from('jobs').select('contract_status, contract_evidence_id').eq('id', jobB).single();
    assert.equal(job.data.contract_status, 'Signed');
    assert.equal(job.data.contract_evidence_id, reg.data.evidence_id);
    const actions = await service.from('audit_events').select('action').eq('entity_type', 'Evidence').eq('entity_id', reg.data.evidence_id);
    assert.deepEqual(actions.data.map((a) => a.action).sort(), ['Attach', 'Register', 'TaskLink', 'Upload']);
  });
});

describe('consistency', { skip }, () => {
  test('metadata whose file is gone is reported once, and shows up for admins', async () => {
    const gone = await uploadFor(tanya, pre02A.id, { filename: 'will-vanish.pdf' });
    assert.ifError((await service.storage.from('evidence').remove([gone.storage_path])).error);
    assert.ifError((await tanya.rpc('evidence_open', { p_evidence_id: gone.evidence_id })).error);
    assert.ok((await bucket(tanya).createSignedUrl(gone.storage_path, 60)).error);
    for (let i = 0; i < 2; i += 1)
      assert.equal((await tanya.rpc('evidence_report_missing', { p_evidence_id: gone.evidence_id })).data.file_present, false);
    const events = await service.from('audit_events').select('id').eq('entity_id', gone.evidence_id).eq('action', 'FileMissing');
    assert.equal(events.data.length, 1);
    assert.equal((await tanya.rpc('evidence_consistency')).error?.message, 'R1A_ROLE_DENIED');
    await ensureLogin(email('lenny'));
    const report = await (await signInAs(email('lenny'))).rpc('evidence_consistency');
    assert.ifError(report.error);
    assert.ok(report.data.file_missing.some((m) => m.evidence_id === gone.evidence_id));
    assert.ok(report.data.object_without_metadata.length >= 1, 'the dropped-in file');
  });
});
