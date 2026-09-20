// Integration tests for the file manager, through the real path (Supabase Auth
// session -> PostgREST -> SECURITY DEFINER commands / RLS).
// LOCAL Supabase stack only.
//
// What these prove is the part that matters and cannot be seen from the UI:
// filing is logical, so moving and renaming a document cannot touch its job,
// its stored object or anything that relies on it as evidence; and the rules
// are the database's, not the browser's.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import { email, ensureLogin, person, service, signInAs } from './helpers.mjs';

let lenny, tanya, angel, lennyRow;
let jobId, jobRef, historicalJobId;

/** A stored document, as if it had been uploaded and confirmed. */
async function makeFile(name, over = {}) {
  const id = randomUUID();
  const job = over.job_id === null ? null : (over.job_id ?? jobId);
  const { error } = await service.from('evidence').insert({
    id,
    scope: job ? 'Job' : 'Library',
    job_id: job,
    category: over.category ?? 'Other',
    storage_path: `${job ?? 'library'}/${id}/${name}`,
    filename: name,
    original_filename: name,
    mime_type: 'application/pdf',
    size_bytes: 2048,
    upload_status: 'Uploaded',
    received_at: new Date().toISOString(),
    uploaded_by: lennyRow.id,
    customer_shareable: false,
    ...over,
    job_id: job
  });
  assert.ifError(error);
  return id;
}

const call = (client, fn, request) => client.rpc(fn, { p_request: request });

/** The refusal code a command raised, or null when it succeeded. */
const codeOf = (error) =>
  error ? String(error.message ?? '').split(':')[0].trim() : null;

async function newFolder(client, request) {
  const { data, error } = await call(client, 'file_folder_create', request);
  assert.ifError(error);
  return data.folder;
}

before(async () => {
  for (const name of ['lenny', 'tanya', 'angel']) await ensureLogin(email(name));
  lenny = await signInAs(email('lenny')); // Admin: file.manage + file.purge
  tanya = await signInAs(email('tanya')); // Office: file.manage
  angel = await signInAs(email('angel')); // Installer: neither
  lennyRow = await person('PERSON-lenny-dev');

  // Two jobs: one live, one an imported historical record.
  const { data: customer } = await service
    .from('customers')
    .insert({
      first_name: 'Files',
      last_name: 'Tester',
      address_line1: '1 Filing Road',
      town: 'Plymouth',
      postcode: 'FM1 1AA',
      email: `files.tester.${Date.now()}@example.invalid`
    })
    .select()
    .single();

  const salesperson = await person('PERSON-mike');
  const base = {
    customer_id: customer.id,
    salesperson_id: salesperson.id,
    display_name: 'File manager test job',
    sold_at: new Date().toISOString(),
    finance_route: 'Standard',
    original_gross_pence: 1000000,
    current_contract_gross_pence: 1000000,
    roof_required: true,
    electrical_required: true,
    scaffold_required: true
  };

  const { data: live, error: liveError } = await service
    .from('jobs')
    .insert({
      ...base,
      // The reference alphabet excludes I and O, so FLEA rather than FILE.
      job_ref: `SS-FLEA-${String(Date.now()).slice(-4)}`,
      workflow_stage: 'Prebooking'
    })
    .select()
    .single();
  assert.ifError(liveError);
  jobId = live.id;
  jobRef = live.job_ref;

  const { data: old, error: oldError } = await service
    .from('jobs')
    .insert({
      ...base,
      job_ref: `SS-HSTA-${String(Date.now()).slice(-4)}`,
      workflow_stage: 'OperationallyComplete',
      record_class: 'HistoricalImport',
      source_system: 'file-manager-test',
      archived_at: new Date().toISOString()
    })
    .select()
    .single();
  assert.ifError(oldError);
  historicalJobId = old.id;

  // These jobs are inserted directly rather than sold through the command, so
  // they need the presale a real sold job carries. Other suites pick an
  // arbitrary job and expect one; a fixture that is only half a job would make
  // them fail for a reason that has nothing to do with them.
  const presale = (job) => ({
    job_id: job,
    surveyor_id: salesperson.id,
    submitted_at: new Date().toISOString(),
    design: {},
    design_schema_version: 1,
    catalogue_version: 'test',
    system_kwp: 4,
    net_panels: 10,
    computed_total_pence: 1000000,
    agreed_price_pence: 1000000,
    price_breakdown: []
  });
  const { error: presaleError } = await service
    .from('presales')
    .insert([presale(jobId), presale(historicalJobId)]);
  assert.ifError(presaleError);
});

describe('folders', () => {
  test('a folder, a subfolder, and the tree the breadcrumbs are built from', async () => {
    const contracts = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: 'Contracts'
    });
    const signed = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      parent_id: contracts.id,
      name: 'Signed'
    });

    assert.equal(contracts.depth, 0);
    assert.equal(signed.depth, 1);
    assert.equal(signed.parent_id, contracts.id);

    const { data: browse } = await call(lenny, 'file_browse', {
      scope: 'Job',
      job_id: jobId,
      folder_id: signed.id
    });
    assert.deepEqual(
      browse.breadcrumbs.map((b) => b.name),
      ['Contracts']
    );
    assert.equal(browse.can_manage, true);
  });

  test('two folders cannot share a name in the same place', async () => {
    await newFolder(lenny, { scope: 'Job', job_id: jobId, name: 'Surveys' });
    const { error } = await call(lenny, 'file_folder_create', {
      scope: 'Job',
      job_id: jobId,
      name: 'Surveys'
    });
    assert.equal(codeOf(error), 'FILE_NAME_TAKEN');
  });

  test('a name is one segment: no slashes, no traversal', async () => {
    for (const name of ['a/b', '../etc', '.hidden', 'a\\b']) {
      const { error } = await call(lenny, 'file_folder_create', {
        scope: 'Job',
        job_id: jobId,
        name
      });
      assert.equal(codeOf(error), 'FILE_NAME_INVALID', name);
    }
  });

  test('a folder cannot be moved into itself or into its own descendant', async () => {
    const outer = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: 'Photos'
    });
    const inner = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      parent_id: outer.id,
      name: 'Roof'
    });

    const intoSelf = await call(lenny, 'file_folder_move', {
      folder_id: outer.id,
      parent_id: outer.id
    });
    assert.equal(codeOf(intoSelf.error), 'FILE_FOLDER_CYCLE');

    const intoChild = await call(lenny, 'file_folder_move', {
      folder_id: outer.id,
      parent_id: inner.id
    });
    assert.equal(codeOf(intoChild.error), 'FILE_FOLDER_CYCLE');
  });

  test('moving a folder rebuilds the whole subtree, not just the folder', async () => {
    const a = await newFolder(lenny, { scope: 'Job', job_id: jobId, name: 'A' });
    const b = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      parent_id: a.id,
      name: 'B'
    });
    const c = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      parent_id: b.id,
      name: 'C'
    });
    const home = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: 'Home'
    });

    const { error } = await call(lenny, 'file_folder_move', {
      folder_id: a.id,
      parent_id: home.id
    });
    assert.ifError(error);

    const { data: rows } = await service
      .from('file_folders')
      .select('id, depth, path_ids')
      .in('id', [a.id, b.id, c.id]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // The grandchild is the one a single-statement rebuild would get wrong.
    assert.equal(byId[a.id].depth, 1);
    assert.equal(byId[b.id].depth, 2);
    assert.equal(byId[c.id].depth, 3);
    assert.deepEqual(byId[c.id].path_ids, [home.id, a.id, b.id]);
  });
});

describe('documents: filing is logical', () => {
  test('a move changes where it is filed and nothing else', async () => {
    const folder = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: 'Finance'
    });
    const fileId = await makeFile('statement.pdf');

    const { data: before } = await service
      .from('evidence')
      .select('job_id, storage_path, category, filing_version')
      .eq('id', fileId)
      .single();

    const { error } = await call(lenny, 'file_move', {
      file_ids: [fileId],
      folder_id: folder.id
    });
    assert.ifError(error);

    const { data: after } = await service
      .from('evidence')
      .select('job_id, storage_path, category, folder_id, filing_version')
      .eq('id', fileId)
      .single();

    assert.equal(after.folder_id, folder.id, 'it moved');
    assert.equal(after.job_id, before.job_id, 'still the same job');
    assert.equal(
      after.storage_path,
      before.storage_path,
      'the stored object never moves'
    );
    assert.equal(after.category, before.category, 'still the same kind of document');
    assert.equal(after.filing_version, before.filing_version + 1);
  });

  test('a rename changes the display name; the stored file keeps its own', async () => {
    const fileId = await makeFile('scan0001.pdf');
    const { error } = await call(lenny, 'file_rename', {
      file_id: fileId,
      name: 'Signed contract.pdf'
    });
    assert.ifError(error);

    const { data } = await service
      .from('evidence')
      .select('display_name, filename, storage_path')
      .eq('id', fileId)
      .single();
    assert.equal(data.display_name, 'Signed contract.pdf');
    assert.equal(data.filename, 'scan0001.pdf');
    assert.match(data.storage_path, /scan0001\.pdf$/);
  });

  test('a document can never be filed under another job', async () => {
    const otherFolder = await newFolder(lenny, {
      scope: 'Job',
      job_id: historicalJobId,
      name: 'Elsewhere'
    }).catch(() => null);
    // A historical job refuses folder creation outright, which is the point;
    // use the library instead, which is a different scope.
    const library = await newFolder(lenny, {
      scope: 'Library',
      name: `Policies ${Date.now()}`
    });
    const fileId = await makeFile('cross.pdf');

    const { error } = await call(lenny, 'file_move', {
      file_ids: [fileId],
      folder_id: library.id
    });
    assert.equal(codeOf(error), 'FILE_CROSS_SCOPE_MOVE');
    assert.equal(otherFolder, null);
  });

  test('a stale filing version is refused rather than silently winning', async () => {
    const fileId = await makeFile('concurrent.pdf');
    const { data: row } = await service
      .from('evidence')
      .select('filing_version')
      .eq('id', fileId)
      .single();

    // One tab renames it.
    const first = await call(lenny, 'file_rename', {
      file_id: fileId,
      name: 'First version.pdf',
      expected_version: row.filing_version
    });
    assert.ifError(first.error);

    // Another was still looking at the older version.
    const second = await call(lenny, 'file_rename', {
      file_id: fileId,
      name: 'Second version.pdf',
      expected_version: row.filing_version
    });
    assert.equal(codeOf(second.error), 'FILE_CONFLICT');

    const { data: after } = await service
      .from('evidence')
      .select('display_name')
      .eq('id', fileId)
      .single();
    assert.equal(after.display_name, 'First version.pdf', 'no lost update');
  });
});

describe('trash and retention', () => {
  test('trashing hides a document from the job tab and the library search', async () => {
    const fileId = await makeFile('temporary.pdf');

    const { error } = await call(lenny, 'file_trash', { file_ids: [fileId] });
    assert.ifError(error);

    const { data: listed } = await call(lenny, 'list_evidence', {
      job_id: jobId
    });
    assert.ok(
      !listed.evidence.some((e) => e.id === fileId),
      'gone from the job Files tab'
    );

    const { data: searched } = await call(lenny, 'search_evidence', {});
    assert.ok(
      !searched.files.some((f) => f.id === fileId),
      'gone from the Files library'
    );

    const restored = await call(lenny, 'file_restore', { file_ids: [fileId] });
    assert.ifError(restored.error);
    const { data: back } = await call(lenny, 'list_evidence', { job_id: jobId });
    assert.ok(back.evidence.some((e) => e.id === fileId), 'and comes back');
  });

  test('a document a task relies on cannot be trashed at all', async () => {
    const fileId = await makeFile('evidence.pdf', { category: 'TaskEvidence' });
    await service
      .from('evidence')
      .update({ attached_at: new Date().toISOString() })
      .eq('id', fileId);

    const { error } = await call(lenny, 'file_trash', { file_ids: [fileId] });
    assert.equal(codeOf(error), 'FILE_EVIDENCE_LOCKED');

    // But filing it is still free.
    const folder = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: `Filed ${Date.now()}`
    });
    const moved = await call(lenny, 'file_move', {
      file_ids: [fileId],
      folder_id: folder.id
    });
    assert.ifError(moved.error);
  });

  test('trashing a folder takes its subtree, and restoring brings it back', async () => {
    const outer = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: `Bundle ${Date.now()}`
    });
    const inner = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      parent_id: outer.id,
      name: 'Inner'
    });
    const fileId = await makeFile('inside.pdf');
    await call(lenny, 'file_move', { file_ids: [fileId], folder_id: inner.id });

    const trashed = await call(lenny, 'file_folder_trash', {
      folder_id: outer.id
    });
    assert.ifError(trashed.error);
    assert.equal(trashed.data.folders_trashed, 2);
    assert.equal(trashed.data.files_trashed, 1);

    const restored = await call(lenny, 'file_folder_restore', {
      folder_id: outer.id
    });
    assert.ifError(restored.error);

    const { data: rows } = await service
      .from('file_folders')
      .select('trashed_at')
      .in('id', [outer.id, inner.id]);
    assert.ok(rows.every((r) => r.trashed_at === null));
    const { data: file } = await service
      .from('evidence')
      .select('trashed_at')
      .eq('id', fileId)
      .single();
    assert.equal(file.trashed_at, null);
  });

  test('only a trashed document can be destroyed, and only with permission', async () => {
    const fileId = await makeFile('destroy-me.pdf');

    const tooSoon = await call(lenny, 'file_purge', { file_ids: [fileId] });
    assert.equal(codeOf(tooSoon.error), 'FILE_NOT_IN_TRASH');

    await call(lenny, 'file_trash', { file_ids: [fileId] });

    const byOffice = await call(tanya, 'file_purge', { file_ids: [fileId] });
    assert.equal(codeOf(byOffice.error), 'FILE_PURGE_DENIED');

    const byAdmin = await call(lenny, 'file_purge', { file_ids: [fileId] });
    assert.ifError(byAdmin.error);

    // The row survives as a tombstone so the audit outlives the file.
    const { data: row } = await service
      .from('evidence')
      .select('purged_at, storage_path')
      .eq('id', fileId)
      .single();
    assert.ok(row.purged_at, 'a tombstone remains');

    const { error } = await call(lenny, 'file_details', { file_id: fileId });
    assert.equal(codeOf(error), 'EVIDENCE_NOT_FOUND', 'and is unreachable');
  });
});

describe('authorization is the database’s, not the browser’s', () => {
  test('an installer cannot organise documents, or reach them by guessing an id', async () => {
    const fileId = await makeFile('private.pdf', { category: 'Contract' });

    const folder = await call(angel, 'file_folder_create', {
      scope: 'Job',
      job_id: jobId,
      name: 'Mine'
    });
    assert.equal(codeOf(folder.error), 'FILE_PERMISSION_DENIED');

    const rename = await call(angel, 'file_rename', {
      file_id: fileId,
      name: 'anything.pdf'
    });
    assert.equal(codeOf(rename.error), 'EVIDENCE_NOT_FOUND');

    const details = await call(angel, 'file_details', { file_id: fileId });
    assert.equal(codeOf(details.error), 'EVIDENCE_NOT_FOUND');

    const library = await call(angel, 'file_browse', { scope: 'Library' });
    assert.equal(codeOf(library.error), 'FILE_PERMISSION_DENIED');
  });

  test('an imported historical job stays read-only', async () => {
    const fileId = await makeFile('historical.pdf', {
      job_id: historicalJobId
    });

    const folder = await call(lenny, 'file_folder_create', {
      scope: 'Job',
      job_id: historicalJobId,
      name: 'Nope'
    });
    assert.equal(codeOf(folder.error), 'HISTORICAL_IMPORT');

    const move = await call(lenny, 'file_move', {
      file_ids: [fileId],
      folder_id: null
    });
    assert.equal(codeOf(move.error), 'HISTORICAL_IMPORT');

    // Reading it is still fine, and the UI is told not to offer the actions.
    const { data: browse, error } = await call(lenny, 'file_browse', {
      scope: 'Job',
      job_id: historicalJobId
    });
    assert.ifError(error);
    assert.equal(browse.can_manage, false);
    assert.ok(browse.files.some((f) => f.id === fileId));
  });
});

describe('search and audit', () => {
  test('a result says which folder it lives in', async () => {
    const folder = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: `Where ${Date.now()}`
    });
    const fileId = await makeFile('findable-report.pdf');
    await call(lenny, 'file_move', { file_ids: [fileId], folder_id: folder.id });

    const { data, error } = await call(lenny, 'file_search', {
      q: 'findable-report'
    });
    assert.ifError(error);
    const hit = data.files.find((f) => f.id === fileId);
    assert.ok(hit, 'found it');
    assert.equal(hit.location.folder_id, folder.id);
    assert.equal(hit.location.folder_path, folder.name);
    assert.equal(hit.location.job_ref, jobRef);
  });

  test('searching by job reference finds the job’s documents', async () => {
    await makeFile('by-job-ref.pdf');
    const { data } = await call(lenny, 'file_search', { q: jobRef });
    assert.ok(data.files.length > 0);
    assert.ok(data.files.every((f) => f.job_id === jobId));
  });

  test('every filing change is audited, without anyone typing a reason', async () => {
    const folder = await newFolder(lenny, {
      scope: 'Job',
      job_id: jobId,
      name: `Audited ${Date.now()}`
    });
    const fileId = await makeFile('audited.pdf');
    await call(lenny, 'file_move', { file_ids: [fileId], folder_id: folder.id });
    await call(lenny, 'file_rename', { file_id: fileId, name: 'Audited.pdf' });
    await call(lenny, 'file_trash', { file_ids: [fileId] });
    await call(lenny, 'file_restore', { file_ids: [fileId] });

    const { data: events } = await service
      .from('audit_events')
      .select('action, initiating_person_id, before_json, after_json')
      .eq('entity_type', 'Evidence')
      .eq('entity_id', fileId);

    const actions = events.map((e) => e.action);
    for (const expected of ['Move', 'Rename', 'Trash', 'Restore']) {
      assert.ok(actions.includes(expected), `${expected} audited`);
    }
    assert.ok(
      events.every((e) => e.initiating_person_id === lennyRow.id),
      'the actor is recorded on every one'
    );
    const move = events.find((e) => e.action === 'Move');
    assert.equal(move.before_json.folder_id, null);
    assert.equal(move.after_json.folder_id, folder.id);

    const { data: folderEvents } = await service
      .from('audit_events')
      .select('action')
      .eq('entity_type', 'FileFolder')
      .eq('entity_id', folder.id);
    assert.ok(folderEvents.some((e) => e.action === 'Create'));
  });
});

describe('existing documents are untouched', () => {
  test('a document with no folder is still found, opened and listed', async () => {
    const fileId = await makeFile('legacy-untouched.pdf');

    const { data: row } = await service
      .from('evidence')
      .select('folder_id, scope, trashed_at, purged_at, filing_version')
      .eq('id', fileId)
      .single();
    assert.equal(row.folder_id, null, 'no folder: the job’s top level');
    assert.equal(row.scope, 'Job');
    assert.equal(row.trashed_at, null);
    assert.equal(row.purged_at, null);
    assert.equal(row.filing_version, 1);

    const { data: listed } = await call(lenny, 'list_evidence', {
      job_id: jobId
    });
    assert.ok(listed.evidence.some((e) => e.id === fileId));

    const { data: browse } = await call(lenny, 'file_browse', {
      scope: 'Job',
      job_id: jobId
    });
    assert.ok(
      browse.files.some((f) => f.id === fileId),
      'and it sits at the top level of the file manager'
    );

    const { error } = await call(lenny, 'file_details', { file_id: fileId });
    assert.ifError(error);
  });
});
