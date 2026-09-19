// Convergence operations (migration 20260920120000) against a REAL local
// stack: release control, staff access, task reassignment, the Issues queue,
// the Files library search and R1 readiness - authorization first.
//
// Named to run after preview-dev.test.mjs (which counts rows). Release modes
// are switched only in this local stack and restored to Disabled afterwards.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { anon, email, ensureLogin, person, service, signInAs } from './helpers.mjs';

let lenny, dave, tanya, lucy, ben, rick, james, job, pre01;
const ids = {};

const cmd = (client, request) => client.rpc('execute_command', { p_request: { command_id: randomUUID(), ...request } });
const read = (client, readType, params = {}) =>
  client.rpc('execute_operations_read', { p_request: { read_type: readType, ...params } });
const mode = async (fn) => (await service.from('release_modes').select('*').eq('function_id', fn).single()).data;
const setMode = (client, fn, row, to, reason = 'convergence test', scope = 'Pilot') =>
  cmd(client, { command_type: 'RELEASE_MODE_SET', expected_version: row.version,
                payload: { function_id: fn, mode: to, scope, reason } });

before(async () => {
  const names = ['lenny', 'davehopwood', 'tanya', 'lucy', 'ben', 'rick', 'james'];
  for (const n of names) await ensureLogin(email(n));
  [lenny, dave, tanya, lucy, ben, rick, james] = await Promise.all(names.map((n) => signInAs(email(n))));
  for (const [k, legacy] of [['lenny', 'PERSON-lenny-dev'], ['dave', 'PERSON-dave-hopwood'], ['tanya', 'PERSON-tanya'],
                             ['lucy', 'PERSON-lucy'], ['rick', 'PERSON-rick'], ['ben', 'PERSON-ben'], ['rosie', 'PERSON-rosie']])
    ids[k] = (await person(legacy)).id;
  // FN-01 on for this local stack (through the command, as an Admin would).
  const fn01 = await mode('FN-01');
  if (fn01.mode === 'Disabled') assert.ifError((await setMode(lenny, 'FN-01', fn01, 'Automated')).error);
  const sold = await tanya.rpc('submit_presale', { p_command_id: randomUUID(), p_payload: {
    customer: { first_name: 'Cora', last_name: 'Convergence', address_line1: '5 Synthetic Way', address_line2: null,
                town: 'Exeter', postcode: 'EX5 5EE', phone: '07000 000005', email: `cora-${Date.now()}@example.com` },
    sale: { salesperson_id: ids.rick, lead_source: 'Referral', quote_reference: `Q-CONV-${Date.now()}`,
            finance_route: 'Standard', agreed_price_pence: 700000 },
    scope: { roof_required: true, electrical_required: true, scaffold_required: true, roof_notes: null, electrical_notes: null },
    design: { slopes: [] }, design_schema_version: 1, catalogue_version: 'test-catalogue',
    computed: { system_kwp: 4, net_panels: 10, computed_total_pence: 700000, price_breakdown: [{ key: 'total', label: 'Total', pence: 700000 }] } } });
  assert.ifError(sold.error);
  job = sold.data.job_id;
  pre01 = (await service.from('tasks').select('*').eq('job_id', job).eq('template_code', 'PRE01').single()).data;
});

after(async () => {
  // Back to the migration default: everything Disabled (dependants first).
  const rows = (await service.from('release_modes').select('*').neq('mode', 'Disabled')).data ?? [];
  await service.from('release_modes').update({ mode: 'Disabled', authorised_job_scope: 'None' })
    .in('function_id', rows.map((r) => r.function_id));
});

describe('release control', () => {
  test('only Admin / Manager switch; Office and Director are refused', async () => {
    const fn18 = await mode('FN-18');
    for (const who of [tanya, ben]) assert.equal((await setMode(who, 'FN-18', fn18, 'Manual')).error?.message, 'R1A_ROLE_DENIED');
    assert.equal((await read(tanya, 'RELEASE_CONTROL')).error?.message, 'R1A_ROLE_DENIED');
    const view = await read(ben, 'RELEASE_CONTROL');
    assert.ifError(view.error);
    assert.equal(view.data.data.can_change, false, 'Director reads only');
  });

  test('planned mode only, reason required, version checked, one audit event', async () => {
    let fn18 = await mode('FN-18');
    assert.equal((await setMode(dave, 'FN-18', fn18, 'Automated')).error?.message, 'RELEASE_MODE_NOT_PLANNED');
    assert.equal((await setMode(dave, 'FN-18', fn18, 'Manual', 'x')).error?.message, 'RELEASE_REASON_REQUIRED');
    assert.equal((await setMode(dave, 'FN-18', { ...fn18, version: fn18.version + 7 }, 'Manual')).error?.message, 'R1A_STALE_VERSION');
    const on = await setMode(dave, 'FN-18', fn18, 'Manual');
    assert.ifError(on.error);
    const audit = (await service.from('audit_events').select('*').eq('entity_type', 'release_modes')
      .eq('entity_id', fn18.id).order('occurred_at', { ascending: false }).limit(1)).data[0];
    assert.equal(audit.reason, 'convergence test');
    assert.equal(audit.initiating_person_id, ids.dave);
    assert.equal(audit.after_json.mode, 'Manual');
    const perCommand = (await service.from('audit_events').select('id').eq('command_id', audit.command_id)).data;
    assert.equal(perCommand.length, 1, 'exactly one audit event per release change');
    fn18 = await mode('FN-18');
    assert.equal(fn18.authorised_job_scope, 'Pilot');
  });

  test('dependencies hold both ways; direct writes are refused', async () => {
    const fn01 = await mode('FN-01');
    const refused = await setMode(lenny, 'FN-01', fn01, 'Disabled');
    assert.equal(refused.error?.message, 'RELEASE_DEPENDANT_ENABLED', 'FN-18 still needs FN-01');
    const fn18 = await mode('FN-18');
    assert.ifError((await setMode(lenny, 'FN-18', fn18, 'Disabled')).error);
    assert.ifError((await setMode(lenny, 'FN-01', await mode('FN-01'), 'Disabled')).error);
    const fn19 = await mode('FN-19');
    assert.equal((await setMode(lenny, 'FN-19', fn19, 'Manual')).error?.message, 'RELEASE_DEPENDENCY_DISABLED');
    assert.ifError((await setMode(lenny, 'FN-01', await mode('FN-01'), 'Automated')).error);
    const direct = await lenny.from('release_modes').update({ mode: 'Automated' }).eq('function_id', 'FN-02');
    assert.match(direct.error?.message ?? '', /permission denied/);
  });

  test('readiness never counts missing evidence as a pass', async () => {
    const r = await read(tanya, 'RELEASE_READINESS');
    assert.ifError(r.error);
    const items = Object.fromEntries(r.data.data.items.map((i) => [i.key, i.state]));
    assert.equal(r.data.data.ready, false);
    assert.equal(items.DatabaseRestoreDrill, 'Unknown');
    assert.equal(items.AuditCoverage, 'Pass');
    assert.equal(items.TaskOwners, 'Pass');
    assert.equal(items.PrivateFiles, 'Pass');
    assert.equal((await read(rick, 'RELEASE_READINESS')).error?.message, 'R1A_ROLE_DENIED');
  });
});

describe('staff access', () => {
  test('Manager adds a person; only an Admin gives Admin', async () => {
    const created = await cmd(dave, { command_type: 'STAFF_CREATE',
      payload: { display_name: 'Sam Convergence', email: `sam.conv.${Date.now()}@example.com`, roles: ['Office'] } });
    assert.ifError(created.error);
    const personId = created.data.result.person_id;
    const row = (await service.from('people').select('*').eq('id', personId).single()).data;
    assert.equal((await cmd(dave, { command_type: 'STAFF_ROLE_SET', expected_version: row.version,
      payload: { person_id: personId, role_code: 'Admin', active: true, reason: 'test' } })).error?.message, 'STAFF_ADMIN_GRANT_DENIED');
    assert.equal((await cmd(tanya, { command_type: 'STAFF_ROLE_SET', expected_version: row.version,
      payload: { person_id: personId, role_code: 'Surveyor', active: true, reason: 'test' } })).error?.message, 'R1A_ROLE_DENIED');
    const granted = await cmd(dave, { command_type: 'STAFF_ROLE_SET', expected_version: row.version,
      payload: { person_id: personId, role_code: 'Surveyor', active: true, reason: 'also sells' } });
    assert.ifError(granted.error);
    assert.equal(granted.data.result.status, 'Granted');
    const dup = await cmd(dave, { command_type: 'STAFF_CREATE',
      payload: { display_name: 'Sam Again', email: row.email, roles: ['Office'] } });
    assert.equal(dup.error?.message, 'STAFF_EMAIL_EXISTS');
  });

  test('no self lock-out, never the last Admin; deactivation takes effect at once', async () => {
    const me = (await service.from('people').select('*').eq('id', ids.lenny).single()).data;
    assert.equal((await cmd(lenny, { command_type: 'STAFF_SET_ACTIVE', expected_version: me.version,
      payload: { person_id: ids.lenny, active: false, reason: 'test' } })).error?.message, 'STAFF_SELF_LOCKOUT');
    const adminRole = (await service.from('person_roles').select('*').eq('person_id', ids.lenny).eq('role_code', 'Admin').single()).data;
    assert.equal((await cmd(lenny, { command_type: 'STAFF_ROLE_SET', expected_version: adminRole.version,
      payload: { person_id: ids.lenny, role_code: 'Admin', active: false, reason: 'test' } })).error?.message, 'STAFF_SELF_LOCKOUT');
    const lucyRow = (await service.from('people').select('*').eq('id', ids.lucy).single()).data;
    assert.ifError((await cmd(lenny, { command_type: 'STAFF_SET_ACTIVE', expected_version: lucyRow.version,
      payload: { person_id: ids.lucy, active: false, reason: 'on leave' } })).error);
    try {
      assert.equal((await read(lucy, 'TASKS', { scope: 'my' })).error?.message, 'R1A_INACTIVE_ACTOR');
    } finally {
      const again = (await service.from('people').select('*').eq('id', ids.lucy).single()).data;
      assert.ifError((await cmd(lenny, { command_type: 'STAFF_SET_ACTIVE', expected_version: again.version,
        payload: { person_id: ids.lucy, active: true, reason: 'back' } })).error);
    }
  });
});

describe('task reassignment', () => {
  test('eligible people only, version checked, owner changes, history kept', async () => {
    const cands = await read(tanya, 'TASK_REASSIGN_CANDIDATES', { task_id: pre01.id });
    assert.ifError(cands.error);
    assert.equal(cands.data.data.available.available, true);
    assert.ok(cands.data.data.people.some((p) => p.id === ids.rosie));
    const pre03 = (await service.from('tasks').select('*').eq('job_id', job).eq('template_code', 'PRE03').single()).data;
    assert.equal((await cmd(tanya, { command_type: 'TASK_REASSIGN', task_id: pre03.id, expected_version: pre03.version,
      payload: { owner_id: ids.rosie, reason: 'cover' } })).error?.message, 'TASK_OWNER_NOT_ELIGIBLE', 'PRE03 is Admin/Manager/Director only');
    assert.equal((await cmd(rick, { command_type: 'TASK_REASSIGN', task_id: pre01.id, expected_version: pre01.version,
      payload: { owner_id: ids.rosie, reason: 'cover' } })).error?.message, 'R1A_ROLE_DENIED');
    const moved = await cmd(tanya, { command_type: 'TASK_REASSIGN', task_id: pre01.id, expected_version: pre01.version,
      payload: { owner_id: ids.rosie, backup_id: ids.tanya, reason: 'holiday cover' } });
    assert.ifError(moved.error);
    const after = (await service.from('tasks').select('*').eq('id', pre01.id).single()).data;
    assert.deepEqual([after.owner_id, after.backup_id], [ids.rosie, ids.tanya]);
    assert.equal((await cmd(tanya, { command_type: 'TASK_REASSIGN', task_id: pre01.id, expected_version: pre01.version,
      payload: { owner_id: ids.tanya, reason: 'again' } })).error?.message, 'R1A_STALE_VERSION');
    const ev = (await service.from('task_events').select('*').eq('task_id', pre01.id)).data;
    assert.ok(ev.some((e) => JSON.stringify(e).includes('Reassign')));
  });
});

describe('issues queue', () => {
  test('office sees open issues across jobs with actions; other roles are refused', async () => {
    const j = (await service.from('jobs').select('version').eq('id', job).single()).data;
    const raised = await cmd(tanya, { command_type: 'ISSUE_CREATE', job_id: job, expected_version: j.version,
      payload: { issue_type: 'Complaint', title: 'Gutter', description: 'Gutter bracket loose', customer_impact: 'yes' } });
    assert.ifError(raised.error);
    const q = await read(tanya, 'ISSUES', { status: 'open', q: 'EX5' });
    assert.ifError(q.error);
    const issue = q.data.data.issues.find((i) => i.id === raised.data.result.issue_id);
    assert.ok(issue, 'issue listed by postcode search');
    assert.equal(issue.blocks_completion, true);
    assert.equal(issue.actions.resolve.available, true);
    assert.ok(q.data.data.counts.blocking >= 1);
    for (const who of [rick, james]) assert.equal((await read(who, 'ISSUES')).error?.message, 'R1A_ROLE_DENIED');
    assert.equal((await read(tanya, 'ISSUES', { status: 'nope' })).error?.message, 'R1A_INVALID_FIELDS');
  });
});

describe('files library search', () => {
  test('authorized results only, never a storage path', async () => {
    const hasStorage = !!(await service.storage.getBucket('evidence')).data;
    if (!hasStorage) return;
    const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
    const reg = await tanya.rpc('evidence_upload_begin', { p_request: { upload_id: randomUUID(), context_type: 'Job',
      context_id: job, category: 'Contract', filename: 'conv-contract.pdf', mime_type: 'application/pdf', size_bytes: PDF.length } });
    assert.ifError(reg.error);
    const ticket = await tanya.storage.from('evidence').createSignedUploadUrl(reg.data.storage_path);
    assert.ifError((await tanya.storage.from('evidence').uploadToSignedUrl(reg.data.storage_path, ticket.data.token, PDF,
      { contentType: 'application/pdf' })).error);
    assert.ifError((await tanya.rpc('evidence_upload_complete', { p_evidence_id: reg.data.evidence_id })).error);
    const found = await tanya.rpc('search_evidence', { p_request: { q: 'conv-contract' } });
    assert.ifError(found.error);
    assert.ok(found.data.files.some((f) => f.id === reg.data.evidence_id && f.postcode === 'EX5 5EE'));
    assert.ok(found.data.files.every((f) => !('storage_path' in f)));
    const byPostcode = await tanya.rpc('search_evidence', { p_request: { q: 'EX5 5EE', category: 'Contract' } });
    assert.ok(byPostcode.data.files.some((f) => f.id === reg.data.evidence_id));
    const installer = await james.rpc('search_evidence', { p_request: { q: 'conv-contract' } });
    assert.ifError(installer.error);
    assert.equal(installer.data.files.length, 0, 'an installer never sees contracts');
    assert.ok((await anon.rpc('search_evidence', { p_request: {} })).error);
    assert.equal((await tanya.rpc('search_evidence', { p_request: { bogus: 1 } })).error?.message, 'R1A_INVALID_FIELDS');
  });
});
