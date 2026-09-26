// Integration tests for P0 audit integrity and operational health, through the
// real path (Supabase Auth session -> PostgREST -> RLS / execute_command).
// LOCAL Supabase stack only. The PGlite suites t_p0_audit / t_p0_health cover
// the rules in depth; this proves the grants and the REST surface.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import {
  anon,
  count,
  email,
  ensureLogin,
  person,
  service,
  signInAs
} from './helpers.mjs';

let lenny, ben, tanya, lennyRow, benRow;
let fn14;

const record = (client, payload) =>
  client.rpc('execute_command', {
    p_request: {
      command_id: randomUUID(),
      command_type: 'OPS_EVIDENCE_RECORD',
      payload
    }
  });
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
const backup = (over = {}) => ({
  kind: 'DatabaseBackup',
  outcome: 'Verified',
  performed_at: hoursAgo(1),
  subject_at: hoursAgo(9),
  method: 'Supabase dashboard: daily backups list',
  evidence_reference: 'integration-test evidence',
  ...over
});

before(async () => {
  for (const name of ['lenny', 'ben', 'tanya']) await ensureLogin(email(name));
  lenny = await signInAs(email('lenny')); // Admin
  ben = await signInAs(email('ben')); // Director
  tanya = await signInAs(email('tanya')); // Office
  lennyRow = await person('PERSON-lenny-dev');
  benRow = await person('PERSON-ben');
  const { data } = await service
    .from('release_modes')
    .select('*')
    .eq('function_id', 'FN-14')
    .single();
  fn14 = data;
});

after(async () => {
  // Leave the release gate exactly as it was found.
  await service
    .from('release_modes')
    .update({
      mode: fn14.mode,
      authorised_job_scope: fn14.authorised_job_scope
    })
    .eq('function_id', 'FN-14');
});

describe('restored audit triggers', () => {
  test('a direct Admin edit of configuration is audited with the person from the session', async () => {
    const { data: holiday, error } = await lenny
      .from('holidays')
      .insert({ local_date: '2031-12-25', description: 'Christmas Day' })
      .select()
      .single();
    assert.ifError(error);
    const { error: updateError } = await lenny
      .from('holidays')
      .update({ description: 'Christmas' })
      .eq('id', holiday.id);
    assert.ifError(updateError);

    const { data: events } = await lenny
      .from('audit_events')
      .select('*')
      .eq('entity_type', 'holidays')
      .eq('entity_id', holiday.id)
      .order('occurred_at');
    assert.deepEqual(
      events.map((e) => e.action),
      ['INSERT', 'UPDATE']
    );
    assert.ok(events.every((e) => e.initiating_person_id === lennyRow.id));
    assert.ok(events.every((e) => e.executing_service === 'db:holidays'));
    assert.equal(events[1].before_json.description, 'Christmas Day');
    assert.equal(events[1].after_json.description, 'Christmas');
    // The service role has no person: recorded as such, not as somebody.
    await service.from('holidays').delete().eq('id', holiday.id);
    const { data: removed } = await service
      .from('audit_events')
      .select('*')
      .eq('entity_type', 'holidays')
      .eq('entity_id', holiday.id)
      .eq('action', 'DELETE')
      .single();
    assert.equal(removed.initiating_person_id, null);
  });

  test('an unauthorized direct edit is refused and leaves no audit event', async () => {
    const before = await count('audit_events');
    const refused = await tanya
      .from('holidays')
      .insert({ local_date: '2031-12-26', description: 'x' });
    assert.match(refused.error?.message ?? '', /row-level security/);
    const refusedMode = await tanya
      .from('release_modes')
      .update({ mode: 'Automated', authorised_job_scope: 'All' })
      .eq('function_id', 'FN-20')
      .select();
    assert.match(refusedMode.error?.message ?? '', /permission denied/);
    const signedOut = await anon
      .from('holidays')
      .insert({ local_date: '2031-12-27', description: 'x' });
    assert.ok(signedOut.error);
    assert.equal(await count('audit_events'), before);
  });

  test('switching a release function is audited (RELEASE_MODE_SET only)', async () => {
    const { data: mode } = await service
      .from('release_modes')
      .select('*')
      .eq('function_id', 'FN-14')
      .single();
    // Direct writes are withdrawn, even for an Admin.
    const direct = await lenny
      .from('release_modes')
      .update({ scope_boundary_notes: 'reviewed by test' })
      .eq('id', mode.id);
    assert.match(direct.error?.message ?? '', /permission denied/);
    const set = (to, version) =>
      lenny.rpc('execute_command', {
        p_request: {
          command_id: randomUUID(),
          command_type: 'RELEASE_MODE_SET',
          expected_version: version,
          payload: {
            function_id: 'FN-14',
            mode: to,
            scope: 'Pilot',
            reason: 'reviewed by test'
          }
        }
      });
    const on = await set(
      mode.mode === 'Disabled' ? mode.planned_target_mode : 'Disabled',
      mode.version
    );
    assert.ifError(on.error);
    const { data: events } = await lenny
      .from('audit_events')
      .select('*')
      .eq('entity_type', 'release_modes')
      .eq('entity_id', mode.id)
      .eq('action', 'UPDATE')
      .order('occurred_at', { ascending: false })
      .limit(1);
    assert.equal(events[0].initiating_person_id, lennyRow.id);
    assert.equal(events[0].reason, 'reviewed by test');
    assert.notEqual(events[0].after_json.mode, mode.mode);
    const back = await set(mode.mode, events[0].after_json.version);
    assert.ifError(back.error);
  });

  test('the audit log cannot be altered by anyone', async () => {
    const { data: one } = await service
      .from('audit_events')
      .select('id')
      .limit(1)
      .single();
    for (const client of [lenny, ben, tanya]) {
      const edit = await client
        .from('audit_events')
        .update({ reason: 'edited' })
        .eq('id', one.id)
        .select();
      assert.ok(edit.error || edit.data.length === 0);
      const forge = await client.from('audit_events').insert({
        entity_type: 'x',
        entity_id: 'x',
        action: 'x',
        executing_service: 'forged'
      });
      assert.ok(forge.error);
    }
    const asService = await service
      .from('audit_events')
      .delete()
      .eq('id', one.id);
    assert.match(asService.error?.message ?? '', /AUDIT_EVENTS_ARE_IMMUTABLE/);
  });
});

describe('operational evidence and health', () => {
  test('an outside monitor sees that the database answers, and coarse states only', async () => {
    const { data, error } = await anon.rpc('health_ping');
    assert.ifError(error);
    assert.deepEqual(Object.keys(data).sort(), [
      'database',
      'database_time',
      'overall_state',
      'states'
    ]);
    assert.equal(data.database, 'responding');
    assert.equal(data.states.AuditCoverage, 'Verified');
    assert.notEqual(data.overall_state, 'Verified', 'no evidence, no pass');
    const rows = await anon.from('operational_evidence').select('*');
    assert.ok(rows.error || rows.data.length === 0);
  });

  test('with the release gate off nothing is recorded', async () => {
    await service
      .from('release_modes')
      .update({ mode: 'Disabled', authorised_job_scope: 'None' })
      .eq('function_id', 'FN-14');
    const before = await count('operational_evidence');
    const { error } = await record(ben, backup());
    assert.match(error?.message ?? '', /R1A_MODE_DENIED/);
    assert.equal(await count('operational_evidence'), before);
  });

  test('a Director records a verified backup; it is attributed, audited and append-only', async () => {
    await service
      .from('release_modes')
      .update({ mode: 'Automated', authorised_job_scope: 'Pilot' })
      .eq('function_id', 'FN-14');

    const denied = await record(tanya, backup());
    assert.match(denied.error?.message ?? '', /R1A_ROLE_DENIED/);
    const leaky = await record(
      ben,
      backup({
        evidence_reference: 'postgresql://postgres:pw@db.example:5432/postgres'
      })
    );
    assert.match(leaky.error?.message ?? '', /OPS_REFUSED/);

    const { data: done, error } = await record(ben, backup());
    assert.ifError(error);
    const evidenceId = done.result.evidence_id;
    const { data: row } = await ben
      .from('operational_evidence')
      .select('*')
      .eq('id', evidenceId)
      .single();
    assert.equal(row.recorded_by, benRow.id);
    assert.equal(row.source, 'Person');
    const { data: event } = await lenny
      .from('audit_events')
      .select('*')
      .eq('entity_type', 'OperationalEvidence')
      .eq('entity_id', evidenceId)
      .single();
    assert.equal(event.initiating_person_id, benRow.id);
    assert.equal(event.command_id, row.command_id);

    // Office cannot read the evidence rows; nobody can write or change them directly.
    assert.deepEqual(
      (await tanya.from('operational_evidence').select('id')).data,
      []
    );
    const forged = await lenny.from('operational_evidence').insert({
      kind: 'DatabaseBackup',
      outcome: 'Verified',
      performed_at: hoursAgo(1),
      subject_at: hoursAgo(2),
      method: 'forged',
      evidence_reference: 'forged',
      source: 'Person',
      recorded_by: lennyRow.id,
      executing_service: 'forged'
    });
    assert.ok(forged.error);
    const edited = await service
      .from('operational_evidence')
      .update({ outcome: 'Failed' })
      .eq('id', evidenceId);
    assert.match(
      edited.error?.message ?? '',
      /OPERATIONAL_EVIDENCE_IS_IMMUTABLE/
    );

    // The state an outside monitor sees now has proof behind it.
    const { data: ping } = await anon.rpc('health_ping');
    assert.equal(ping.states.DatabaseBackup, 'Verified');
    assert.equal(
      ping.states.DatabaseRestoreDrill,
      'Unknown',
      'a backup is not a tested recovery'
    );
    assert.notEqual(ping.overall_state, 'Verified');
  });
});
