// P0 Evidence: registered uploads, job/task ownership, read authorization,
// retries, file rules, storage consistency and audit.
//
// PGlite has no Supabase Storage, so this suite installs a small stand-in for
// storage.objects AFTER the migrations. With it present the database behaves
// as it does on a real stack: a command never adopts an unregistered path and
// a Pending upload is only confirmed when its object exists.
// (Real Storage policies and signed URLs: tests/storage-evidence.test.mjs.)
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, users, cmd, id, ok, sell, as } = f;

await db.exec(`create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text,
    metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));`);
await db.query(`update public.release_modes set mode='Automated', authorised_job_scope='Pilot'
  where function_id in ('FN-03','FN-05','FN-06','FN-07','FN-08')`);

const rpc = async (who, fn, arg, cast = 'jsonb') => {
  await as(who);
  try { return (await db.query(`select public.${fn}($1::${cast}) r`, [arg])).rows[0].r; }
  catch (e) { return { error: e.message, detail: e.detail }; }
};
const begin = (who, req) => rpc(who, 'evidence_upload_begin', req);
const complete = (who, evidenceId) => rpc(who, 'evidence_upload_complete', evidenceId, 'uuid');
const open = (who, evidenceId) => rpc(who, 'evidence_open', evidenceId, 'uuid');
const list = (who, req) => rpc(who, 'list_evidence', req);
const put = (path, who, over = {}) => db.query(
  `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('evidence', $1, $2, $3)`,
  [path, over.owner ?? users[who], JSON.stringify({ size: over.size ?? 1234, mimetype: over.mime ?? 'application/pdf', eTag: '"abc"' })]);
const evidence = (evidenceId) => one(`select * from public.evidence where id=$1`, [evidenceId]);
const task = (job, code) => one(`select * from public.tasks where job_id=$1 and template_code=$2`, [job, code]);
const audits = async (evidenceId) => (await all(
  `select action from public.audit_events where entity_type='Evidence' and entity_id=$1 order by occurred_at, id`, [evidenceId])).map(a => a.action);
const counts = async () => JSON.stringify(await Promise.all(['evidence', 'audit_events', 'task_events', 'commands']
  .map(t => one(`select count(*)::int n from public.${t}`))));
const upload = (ctxType, ctxId, over = {}) => ({ upload_id: id(), context_type: ctxType, context_id: ctxId,
  filename: 'signed contract.pdf', mime_type: 'application/pdf', size_bytes: 1234, ...over });

// Job A sold by sam; job B by another surveyor, so sam (job.read.own) has no claim on B.
const sue = (await one(`insert into public.people (legacy_id, email, display_name) values ('PERSON-sue','sue@test.local','Sue Surveyor') returning id`)).id;
await db.query(`insert into public.person_roles (person_id, role_code) values ($1,'Surveyor')`, [sue]);
const soldA = await sell('tanya'); assert.ok(!soldA.error, JSON.stringify(soldA));
const soldB = await sell('tanya', { sale: { salesperson_id: sue } }); assert.ok(!soldB.error, JSON.stringify(soldB));
const jobA = soldA.job_id, jobB = soldB.job_id;
const pre02A = await task(jobA, 'PRE02'), pre02B = await task(jobB, 'PRE02');

// ---- file rules (before any database state is consulted) --------------------------
for (const [over, code] of [
  [{ mime_type: 'text/html', filename: 'x.html' }, 'EVIDENCE_TYPE_NOT_ALLOWED'],
  [{ mime_type: 'image/svg+xml', filename: 'x.svg' }, 'EVIDENCE_TYPE_NOT_ALLOWED'],
  [{ mime_type: 'application/x-msdownload', filename: 'x.exe' }, 'EVIDENCE_TYPE_NOT_ALLOWED'],
  [{ mime_type: 'image/jpeg', filename: 'photo.exe' }, 'EVIDENCE_TYPE_NOT_ALLOWED'],   // type and name disagree
  [{ filename: 'invoice.php.pdf' }, 'EVIDENCE_FILENAME_INVALID'],
  [{ filename: '../../etc/passwd' }, 'EVIDENCE_FILENAME_INVALID'],
  [{ filename: '   ' }, 'EVIDENCE_FILENAME_INVALID'],
  [{ size_bytes: 25 * 1024 * 1024 + 1 }, 'EVIDENCE_TOO_LARGE'],
  [{ size_bytes: 0 }, 'R1A_UPLOAD_INVALID'],
  [{ size_bytes: '12; drop table' }, 'R1A_INVALID_FIELDS'],
  [{ upload_id: 'nope' }, 'R1A_INVALID_FIELDS'],
  [{ context_id: 'nope' }, 'R1A_INVALID_FIELDS'],
  [{ job_id: jobB }, 'R1A_INVALID_FIELDS'],              // the browser never names the job
  [{ person_id: people.ben }, 'R1A_INVALID_FIELDS'],     // ... or the person
  [{ context_type: 'Bucket' }, 'EVIDENCE_CONTEXT_INVALID']
]) {
  const before = await counts();
  assert.equal((await begin('tanya', upload('Task', pre02A.id, over))).error, code, JSON.stringify(over));
  assert.equal(await counts(), before, 'refused registration wrote: ' + code);
}

// ---- who may register an upload ------------------------------------------------------
assert.equal((await begin(null, upload('Task', pre02A.id))).error, 'R1A_AUTHENTICATED_EMAIL_REQUIRED');
assert.equal((await begin('store', upload('Task', pre02A.id))).error, 'R1A_ROLE_DENIED');
assert.equal((await begin('inst_a', upload('Task', pre02A.id))).error, 'R1A_ROLE_DENIED');
assert.equal((await begin('hannah', upload('Task', pre02A.id))).error, 'R1A_JOB_ACCESS_DENIED');   // office, not on the job
assert.equal((await begin('dan', upload('Task', pre02A.id))).error, 'R1A_TASK_ACCESS_DENIED');      // on the job, not this task
assert.equal((await begin('tanya', upload('Task', id()))).error, 'R1A_TASK_NOT_FOUND');
assert.equal((await begin('tanya', upload('Job', jobA, { category: 'Selfie' }))).error, 'EVIDENCE_CATEGORY_INVALID');
assert.equal((await begin('hannah', upload('Job', jobA, { category: 'Other' }))).error, 'R1A_JOB_ACCESS_DENIED');
await db.query(`update public.people set active=false where id=$1`, [people.tanya]);
assert.equal((await begin('tanya', upload('Task', pre02A.id))).error, 'R1A_INACTIVE_ACTOR');
await db.query(`update public.people set active=true where id=$1`, [people.tanya]);

// ---- registration: server-derived job, path and category; idempotent retry ---------------
const req1 = upload('Task', pre02A.id, { filename: `..\\..\\${jobB}/Signed Contract (final).pdf`, category: 'Progress' });
let r = await begin('tanya', req1);
assert.ok(!r.error, JSON.stringify(r));
assert.equal(r.replayed, false); assert.equal(r.upload_status, 'Pending');
assert.equal(r.category, 'Contract', 'the task template decides the category, not the browser');
assert.equal(r.storage_path, `${jobA}/${r.evidence_id}/Signed-Contract-final.pdf`, 'no traversal into another job');
const ev1 = r.evidence_id;
let e = await evidence(ev1);
assert.equal(e.job_id, jobA); assert.equal(e.task_id, pre02A.id); assert.equal(e.uploaded_by, people.tanya);
assert.equal(e.context_type, 'Task'); assert.equal(e.mime_type, 'application/pdf'); assert.equal(Number(e.size_bytes), 1234);
assert.equal(e.original_filename, `..\\..\\${jobB}/Signed Contract (final).pdf`);
// retry: same registration, no second row, no second audit event
let before = await counts();
r = await begin('tanya', req1);
assert.equal(r.evidence_id, ev1); assert.equal(r.replayed, true);
assert.equal(await counts(), before, 'a retried registration wrote');
assert.equal((await begin('tanya', { ...req1, size_bytes: 99 })).error, 'EVIDENCE_UPLOAD_CONFLICT');
assert.equal((await begin('tanya', { ...req1, context_id: pre02B.id })).error, 'EVIDENCE_UPLOAD_CONFLICT');
assert.equal((await begin('ben', { ...req1 })).error, 'EVIDENCE_UPLOAD_CONFLICT', 'an upload id belongs to one person');

// ---- required evidence before completion: a missing file completes nothing ---------------
const signed = (t, path, extra = {}) => ({ command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version,
  payload: { completion_note: 'signed', contract_id: 'SIG-1', contract_signed: true, evidence_path: path, ...extra } });
before = await counts();
assert.equal((await cmd('tanya', signed(pre02A, e.storage_path))).error, 'R1A_UPLOAD_MISSING');
assert.equal((await complete('tanya', ev1)).error, 'R1A_UPLOAD_MISSING');
assert.equal(await counts(), before, 'a command without its file wrote');
assert.equal((await task(jobA, 'PRE02')).status, 'Open');
assert.equal((await evidence(ev1)).upload_status, 'Pending');
assert.equal((await open('tanya', ev1)).error, 'EVIDENCE_NOT_READY');
assert.equal((await open('ben', ev1)).error, 'EVIDENCE_ACCESS_DENIED');

// storage policy helpers: only the uploader, only the registered path, only while Pending
const canStore = async (who, path) => { await as(who); return (await one(`select app.evidence_can_store_object($1) ok`, [path])).ok; };
const canRead = async (who, path) => { await as(who); return (await one(`select app.evidence_can_read_object($1) ok`, [path])).ok; };
assert.equal(await canStore('tanya', e.storage_path), true);
assert.equal(await canStore('ben', e.storage_path), false, 'Admin is not the uploader');
assert.equal(await canStore('tanya', `${jobA}/guessed.pdf`), false, 'an unregistered path stores nothing');
assert.equal(await canStore('tanya', `${jobA}/${ev1}/other.pdf`), false);
assert.equal(await canStore(null, e.storage_path), false);

// the stored object is checked: owner, size, type
await put(e.storage_path, 'ben');
assert.equal((await complete('tanya', ev1)).error, 'EVIDENCE_OBJECT_MISMATCH');
await db.query(`delete from storage.objects`);
await put(e.storage_path, 'tanya', { size: 26 * 1024 * 1024 });
assert.equal((await complete('tanya', ev1)).error, 'EVIDENCE_TOO_LARGE');
await db.query(`delete from storage.objects`);
await put(e.storage_path, 'tanya', { mime: 'text/html' });
assert.equal((await complete('tanya', ev1)).error, 'EVIDENCE_TYPE_NOT_ALLOWED');
await db.query(`delete from storage.objects`);
await put(e.storage_path, 'tanya', { size: 2048 });
assert.equal((await complete('dan', ev1)).error, 'EVIDENCE_NOT_FOUND', 'only the uploader (or Admin) confirms');
r = await complete('tanya', ev1);
assert.equal(r.upload_status, 'Uploaded'); assert.equal(Number(r.size_bytes), 2048, 'storage is the witness for size');
before = await counts();
assert.equal((await complete('tanya', ev1)).upload_status, 'Uploaded');
assert.equal(await counts(), before, 'confirming twice wrote');
assert.equal(await canStore('tanya', e.storage_path), false, 'an uploaded file cannot be stored again');
assert.equal((await begin('tanya', req1)).upload_status, 'Uploaded', 'a late retry sees the finished upload');

// ---- PRE02: complete with the registered file ------------------------------------------------
const pre02req = signed(await task(jobA, 'PRE02'), e.storage_path);
r = ok(await cmd('tanya', pre02req), 'pre02 complete');
assert.equal(r.job.contract_status, 'Signed');
let t = await task(jobA, 'PRE02');
assert.equal(t.status, 'Complete'); assert.equal(t.evidence_id, ev1);
assert.equal((await one(`select contract_evidence_id from public.jobs where id=$1`, [jobA])).contract_evidence_id, ev1);
e = await evidence(ev1);
assert.equal(e.category, 'Contract'); assert.equal(e.attached_by, people.tanya); assert.ok(e.attached_at);
// (events of one transaction share a timestamp, so compare as a set)
assert.deepEqual((await audits(ev1)).sort(), ['Attach', 'Register', 'TaskLink', 'Upload']);
// replaying the command creates nothing
before = await counts();
assert.equal((await cmd('tanya', pre02req)).replayed, true);
assert.equal(await counts(), before);
assert.equal((await one(`select count(*)::int n from public.evidence where job_id=$1`, [jobA])).n, 1);
// audit carries metadata only
const auditText = JSON.stringify(await all(`select before_json, after_json, reason from public.audit_events where entity_type='Evidence'`));
assert.ok(!/storage_path|token|signed|http/i.test(auditText.replace(/Signed-Contract-final\.pdf/g, '')), 'audit leaked a path or URL');

// ---- cross-job: a file registered for job B is useless to job A, by path or by id ------------
r = await begin('tanya', upload('Task', pre02B.id, { filename: 'b-contract.pdf' }));
const evB = r.evidence_id, pathB = r.storage_path;
await put(pathB, 'tanya');
assert.equal((await complete('tanya', evB)).upload_status, 'Uploaded');
const pre05 = await one(`select app.create_task_instance($1::uuid,'PRE05','PRE05-X-'||$1::text,null,null,now(),null,null,null,null,null) id`, [jobA]);
const pre05row = await one(`select * from public.tasks where id=$1`, [pre05.id]);
before = await counts();
for (const payload of [{ completion_note: 'x', evidence_path: pathB }, { completion_note: 'x', evidence_id: evB }]) {
  r = await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: pre05row.id, expected_version: pre05row.version, payload });
  assert.equal(r.error, 'R1A_CROSS_JOB_EVIDENCE', JSON.stringify(payload));
}
assert.equal(await counts(), before);
await assert.rejects(db.query(`update public.tasks set evidence_id=$1 where id=$2`, [evB, pre05row.id]), /R1A_CROSS_JOB_EVIDENCE/);
await assert.rejects(db.query(`update public.evidence set job_id=$1 where id=$2`, [jobA, evB]), /EVIDENCE_IMMUTABLE/);
await assert.rejects(db.query(`update public.evidence set storage_path='x' where id=$1`, [evB]), /EVIDENCE_IMMUTABLE/);
await assert.rejects(db.query(`update public.evidence set task_id=$1 where id=$2`, [pre05row.id, evB]), /R1A_CROSS_JOB_EVIDENCE/);
await assert.rejects(db.query(`delete from public.evidence where id=$1`, [evB]), /EVIDENCE_IMMUTABLE/);

// ---- file exists but metadata missing: never adopted, reported to admins ---------------------
await put(`${jobA}/dropped-in.pdf`, 'tanya');
r = await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: pre05row.id, expected_version: pre05row.version,
  payload: { completion_note: 'x', evidence_path: `${jobA}/dropped-in.pdf` } });
assert.equal(r.error, 'R1A_UPLOAD_INVALID');
assert.equal(await canRead('ben', `${jobA}/dropped-in.pdf`), false, 'even Admin reads nothing without metadata');

// ---- the command itself confirms a registered file the browser never reported ------------------
r = await begin('tanya', upload('Task', pre05row.id, { filename: 'agreement.pdf' }));
assert.equal(r.category, 'FinanceAgreement');
const ev5 = r.evidence_id;
await put(r.storage_path, 'tanya');
ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: pre05row.id, expected_version: pre05row.version,
  payload: { completion_note: 'approved', evidence_path: r.storage_path } }), 'pre05');
assert.equal((await evidence(ev5)).upload_status, 'Uploaded');
assert.deepEqual((await audits(ev5)).sort(), ['Attach', 'Register', 'TaskLink', 'Upload']);

// ---- replacement keeps the earlier row (TASK_EVIDENCE_ATTACH on an open PRE02) -----------------
const attach = async (path) => { const tk = await task(jobB, 'PRE02');
  return cmd('tanya', { command_id: id(), command_type: 'TASK_EVIDENCE_ATTACH', task_id: tk.id, expected_version: tk.version, payload: { evidence_path: path } }); };
ok(await attach(pathB), 'attach 1');
r = await begin('tanya', upload('Task', pre02B.id, { filename: 'b-contract-v2.pdf' }));
const evB2 = r.evidence_id;
await put(r.storage_path, 'tanya');
ok(await attach(r.storage_path), 'attach 2');
assert.equal((await task(jobB, 'PRE02')).evidence_id, evB2);
assert.equal((await evidence(evB)).task_id, pre02B.id, 'the replaced file is kept, still tied to its task');
assert.ok((await audits(evB2)).includes('TaskReplace'));

// ---- installer evidence -----------------------------------------------------------------------
const today = (await one(`select app.london_date(now())::text d`)).d;
const mkWp = async (j, trade, seq) => (await one(`insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, commissioning_required, sequence)
  values ($1,$2,true,$3,$3,'Scheduled',true,$4) returning id`, [j, trade, today, seq])).id;
const roof = await mkWp(jobA, 'Roof', 1), elec = await mkWp(jobA, 'Electrical', 2);
await db.query(`insert into public.allocations (work_package_id, person_id, role, start_at, end_at) values ($1,$3,'Lead',$5,$5), ($2,$4,'Lead',$5,$5)`,
  [roof, elec, people.inst_a, people.inst_b, today]);
const photo = (over = {}) => upload('WorkPackage', roof, { filename: 'IMG_0001.JPG', mime_type: 'image/jpeg', category: 'Progress', ...over });
assert.equal((await begin('inst_b', photo())).error, 'R1C_ASSIGNMENT_DENIED', 'not allocated to this package');
assert.equal((await begin('store', photo())).error, 'R1C_ASSIGNMENT_DENIED');
assert.equal((await begin('inst_a', photo({ category: 'Contract' }))).error, 'EVIDENCE_CATEGORY_INVALID');
assert.equal((await begin('inst_a', photo({ category: undefined }))).error, 'EVIDENCE_CATEGORY_INVALID');
r = await begin('inst_a', photo());
assert.ok(!r.error, JSON.stringify(r));
const evP = r.evidence_id, pathP = r.storage_path;
await put(pathP, 'inst_a', { mime: 'image/jpeg' });
assert.equal((await complete('inst_a', evP)).upload_status, 'Uploaded');
const iw = (type, payload, w) => ({ command_id: id(), command_type: type, job_id: jobA, work_package_id: roof, expected_version: w.version, payload });
let w = await one(`select * from public.work_packages where id=$1`, [roof]);
ok(await cmd('inst_a', iw('IW_START', {}, w)), 'start');
w = await one(`select * from public.work_packages where id=$1`, [roof]);
// a problem report re-categorises the (not yet used) photo and ties it to the issue
r = ok(await cmd('inst_a', iw('IW_REPORT_PROBLEM', { category: 'Safety', description: 'Loose tiles', evidence: [{ storage_path: pathP }] }, w)), 'problem');
assert.deepEqual(r.evidence, [{ evidence_id: evP, created: true }]);
e = await evidence(evP);
assert.equal(e.category, 'Problem'); assert.equal(e.work_package_id, roof); assert.equal(e.issue_id, r.issue_id);
assert.equal(e.filename, 'IMG_0001.JPG', 'file name comes from the registration, not the command');
w = await one(`select * from public.work_packages where id=$1`, [roof]);
r = ok(await cmd('inst_a', iw('IW_PROGRESS', { note: 'same photo', evidence: [{ storage_path: pathP }] }, w)), 'reuse');
assert.deepEqual(r.evidence, [{ evidence_id: evP, created: false }]);
assert.equal((await evidence(evP)).category, 'Problem', 'a reused file keeps its first category');

// ---- read authorization --------------------------------------------------------------------------
const contractPath = (await evidence(ev1)).storage_path;
assert.equal((await open('tanya', ev1)).storage_path, contractPath);
assert.equal((await open('hannah', ev1)).evidence_id, ev1, 'office class reads every job (job.read.all)');
assert.equal((await open('sam', ev1)).evidence_id, ev1, 'the salesperson reads their own sale');
assert.equal((await open('sam', evB2)).error, 'EVIDENCE_ACCESS_DENIED', 'job.read.own stops at another person’s sale');
assert.equal((await open('inst_a', ev1)).error, 'EVIDENCE_ACCESS_DENIED', 'installers never open a contract');
assert.equal((await open('store', ev1)).error, 'EVIDENCE_ACCESS_DENIED');
assert.equal((await open('inst_a', evP)).evidence_id, evP, 'allocated installer opens their package’s photo');
assert.equal((await open('inst_b', evP)).error, 'EVIDENCE_ACCESS_DENIED', 'same job, other package');
assert.equal((await open('tanya', id())).error, 'EVIDENCE_NOT_FOUND');
assert.equal((await open(null, ev1)).error, 'R1A_AUTHENTICATED_EMAIL_REQUIRED');
await db.query(`update public.allocations set active=false where work_package_id=$1`, [roof]);
assert.equal((await open('inst_a', evP)).error, 'EVIDENCE_ACCESS_DENIED', 'access ends with the allocation');
await db.query(`update public.allocations set active=true where work_package_id=$1`, [roof]);
await db.query(`update public.people set active=false where id=$1`, [people.hannah]);
assert.equal((await open('hannah', ev1)).error, 'R1A_INACTIVE_ACTOR');
assert.equal(await canRead('hannah', contractPath), false);
await db.query(`update public.people set active=true where id=$1`, [people.hannah]);
// storage agrees with the database; guessing a path gains nothing
assert.equal(await canRead('tanya', contractPath), true);
assert.equal(await canRead('inst_a', contractPath), false);
assert.equal(await canRead('sam', (await evidence(evB2)).storage_path), false);
assert.equal(await canRead('inst_a', pathP), true);
assert.equal(await canRead('inst_b', pathP), false);
assert.equal(await canRead('tanya', `${jobA}/contract.pdf`), false);
assert.equal(await canRead(null, contractPath), false);

// ---- lists: one job's evidence only, never a storage path ----------------------------------------
r = await list('tanya', { job_id: jobA });
assert.deepEqual(r.evidence.map(x => x.id).sort(), [ev1, ev5, evP].sort());
assert.ok(r.evidence.every(x => x.job_id === jobA && !('storage_path' in x)));
const row = r.evidence.find(x => x.id === ev1);
assert.equal(row.category, 'Contract'); assert.equal(row.added_by_name, 'Tanya'); assert.equal(row.can_open, true);
assert.equal(row.filename, `..\\..\\${jobB}/Signed Contract (final).pdf`);
assert.deepEqual((await list('inst_a', { job_id: jobA })).evidence.map(x => x.id), [evP], 'installer: own package only');
assert.deepEqual((await list('inst_b', { job_id: jobA })).evidence, []);
assert.deepEqual((await list('sam', { job_id: jobB })).evidence, []);
r = await list('tanya', { task_id: pre02B.id });
assert.deepEqual(r.evidence.map(x => [x.id, x.current]).sort(), [[evB, false], [evB2, true]].sort());
assert.deepEqual((await list('tanya', { work_package_id: roof })).evidence.map(x => x.id), [evP]);
assert.equal((await list('tanya', { job_id: jobA, task_id: pre02A.id })).error, 'R1A_INVALID_FIELDS');
assert.equal((await list('tanya', { job_id: 'x' })).error, 'R1A_INVALID_FIELDS');

// ---- goods-in: Store uploads the delivery note without being assigned to the job -------------------
const merchant = (await one(`insert into public.companies (name, type, standard_lead_days, delivery_weekday) values ('Greentech','Merchant',14,4) returning id`)).id;
const cable = (await one(`insert into public.products (sku,name,category,unit,stock_tracked) values ('CAB','Cable','Electrical','Metre',false) returning id`)).id;
const order = await one(`insert into public.orders (job_id, merchant_id, work_type, requested_delivery_date, status) values ($1,$2,'Roof','2026-10-29','Confirmed') returning *`, [jobA, merchant]);
const line = (await one(`insert into public.order_lines (order_id, product_id, description_snapshot, quantity, unit) values ($1,$2,'Cable',50,'Metre') returning id`, [order.id, cable])).id;
const del = (await one(`insert into public.deliveries (order_id, expected_date, receipt_status) values ($1,'2026-10-29','Expected') returning id`, [order.id])).id;
await db.query(`insert into public.stock_locations (name,type,usable) values ('Main Store','Store',true), ('Quarantine','Quarantine',false), ('External','Supplier',false)`);
assert.equal((await begin('inst_a', upload('Delivery', del, { filename: 'dn.pdf' }))).error, 'R1A_ROLE_DENIED');
assert.equal((await begin('store', upload('Delivery', id(), { filename: 'dn.pdf' }))).error, 'R1C_DELIVERY_NOT_FOUND');
r = await begin('store', upload('Delivery', del, { filename: 'dn.pdf', category: 'Contract' }));
assert.equal(r.category, 'DeliveryNote');
const evD = r.evidence_id;
await put(r.storage_path, 'store');
r = ok(await cmd('store', { command_id: id(), command_type: 'GOODS_IN_RECEIVE', job_id: jobA, expected_version: order.version,
  payload: { delivery_id: del, delivery_note_reference: 'DN-1', delivery_note_path: r.storage_path, lines: [{ order_line_id: line, quantity_good: 50 }] } }), 'goods in');
assert.equal(r.evidence_id, evD);
e = await evidence(evD);
assert.equal(e.upload_status, 'Uploaded'); assert.equal(e.job_id, jobA); assert.equal(e.uploaded_by, people.store);
assert.equal((await open('store', evD)).evidence_id, evD, 'Store reads delivery notes');
assert.equal((await open('inst_a', evD)).error, 'EVIDENCE_ACCESS_DENIED');

// ---- metadata and storage cannot drift apart silently ----------------------------------------------
const consistency = async (who) => { await as(who);
  try { return (await db.query(`select public.evidence_consistency() r`)).rows[0].r; } catch (err) { return { error: err.message }; } };
assert.equal((await consistency('tanya')).error, 'R1A_ROLE_DENIED', 'Admin only');
r = await begin('tanya', upload('Job', jobA, { filename: 'never-arrives.pdf', category: 'Other' }));
await db.query(`update public.evidence set registered_at = now() - interval '2 hours' where id=$1`, [r.evidence_id]);
await db.query(`delete from storage.objects where name=$1`, [contractPath]);        // metadata exists, file gone
let c = await consistency('ben');
assert.deepEqual(c.pending_stale.map(x => x.evidence_id), [r.evidence_id]);
assert.deepEqual(c.file_missing.map(x => x.evidence_id), [ev1]);
assert.equal(c.object_without_metadata.length, 1, 'the dropped-in file');
// a reader who hits the missing file leaves one audit record, however often they try
const report = (who, evidenceId) => rpc(who, 'evidence_report_missing', evidenceId, 'uuid');
assert.equal((await report('inst_a', ev1)).error, 'EVIDENCE_NOT_FOUND', 'only someone who may read it');
assert.equal((await report('tanya', ev1)).file_present, false);
assert.equal((await report('tanya', ev1)).file_present, false);
assert.equal((await audits(ev1)).filter(a => a === 'FileMissing').length, 1);
assert.equal((await report('tanya', ev5)).file_present, true);
assert.ok(!(await audits(ev5)).includes('FileMissing'));
// a registration whose file never arrived is the only thing that may be removed
await db.query(`delete from public.evidence where id=$1`, [r.evidence_id]);

// ---- staff wording exists for every new refusal ------------------------------------------------------
for (const code of ['EVIDENCE_TYPE_NOT_ALLOWED', 'EVIDENCE_TOO_LARGE', 'EVIDENCE_FILENAME_INVALID', 'EVIDENCE_ACCESS_DENIED',
                    'EVIDENCE_NOT_FOUND', 'EVIDENCE_FILE_MISSING', 'EVIDENCE_NOT_READY', 'EVIDENCE_UPLOAD_CONFLICT']) {
  const d = (await one(`select public.describe_command_error($1) d`, [code])).d;
  assert.ok(d.message && !/went wrong/i.test(d.message), code + ': ' + JSON.stringify(d));
}
console.log('evidence ok');
