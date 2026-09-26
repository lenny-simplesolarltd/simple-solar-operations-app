// How a command was issued, and why nobody can lie about it.
//
// The audit already recorded WHO. It could not distinguish "Lenny completed
// that visit" from "Lenny completed that visit by asking SimpleBot to", because
// executing_service names the command rather than the caller. These tests pin
// down the new `origin` column and, more importantly, that it is DERIVED: no
// caller passes it, so no model argument and no hand-written RPC call can claim
// to be the assistant.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, service, signInAs } from './helpers.mjs';

let programmeId, office, lucyId, gateWas;

const run = async (client, type, payload, extra = {}) => {
  const { data, error } = await client.rpc('execute_command', {
    p_request: {
      command_id: extra.commandId ?? randomUUID(),
      command_type: type,
      payload,
      ...(extra.expectedVersion !== undefined
        ? { expected_version: extra.expectedVersion }
        : {})
    }
  });
  if (error) return { ok: false, code: error.message };
  return data?.ok
    ? { ok: true, result: data.result, replayed: data.replayed }
    : { ok: false, code: data?.outcome?.code };
};

/** A visit the office may still act on. */
async function anAwaitingVisit() {
  const { data, error } = await service
    .from('programme_visits')
    .select('id, version')
    .eq('programme_id', programmeId)
    .eq('review_status', 'AwaitingReview')
    .limit(1)
    .single();
  assert.ifError(error);
  return data;
}

before(async () => {
  const was = await service
    .from('release_modes')
    .select('mode, authorised_job_scope')
    .eq('function_id', 'FN-22')
    .single();
  gateWas = was.data;
  await service
    .from('release_modes')
    .update({ mode: 'Manual', authorised_job_scope: 'Pilot' })
    .eq('function_id', 'FN-22');

  programmeId = (
    await service
      .from('programmes')
      .select('id')
      .eq('code', 'DEV-PCH-SIM')
      .single()
  ).data.id;
  await ensureLogin(email('lucy'));
  office = await signInAs(email('lucy'));
  lucyId = (
    await service
      .from('people')
      .select('id')
      .eq('email', email('lucy'))
      .single()
  ).data.id;
});

after(async () => {
  if (gateWas)
    await service
      .from('release_modes')
      .update({
        mode: gateWas.mode,
        authorised_job_scope: gateWas.authorised_job_scope
      })
      .eq('function_id', 'FN-22');
});

describe('command origin', () => {
  test('a command issued the ordinary way is recorded as UI', async () => {
    const visit = await anAwaitingVisit();
    const commandId = randomUUID();
    const done = await run(
      office,
      'PROGRAMME_VISIT_REVIEW',
      {
        visit_id: visit.id,
        disposition: 'ActionRequired',
        action_note: 'From the review screen.'
      },
      { commandId, expectedVersion: visit.version }
    );
    assert.equal(done.ok, true, `refused: ${done.code}`);

    const command = await service
      .from('commands')
      .select('origin, actor_person_id')
      .eq('command_id', commandId)
      .single();
    assert.equal(command.data.origin, 'UI');
    assert.equal(
      command.data.actor_person_id,
      lucyId,
      'the human must still be the actor'
    );

    const audit = await service
      .from('audit_events')
      .select('origin, initiating_person_id')
      .eq('command_id', commandId);
    assert.ok(audit.data.length > 0);
    for (const row of audit.data) {
      assert.equal(row.origin, 'UI');
      assert.equal(row.initiating_person_id, lucyId);
    }
  });

  test('a command the assistant raised and confirmed is recorded as SimpleBot', async () => {
    const visit = await anAwaitingVisit();
    // The assistant's contract: the pending action's id IS the command id.
    const commandId = randomUUID();
    const pending = await service.from('assistant_pending_actions').insert({
      id: commandId,
      person_id: lucyId,
      thread_id: randomUUID(),
      tool: 'programme_review_visit',
      args: { visit_id: visit.id },
      args_hash: 'a'.repeat(64),
      preview: {},
      status: 'claimed',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    });
    assert.ifError(pending.error);

    const done = await run(
      office,
      'PROGRAMME_VISIT_REVIEW',
      {
        visit_id: visit.id,
        disposition: 'ActionRequired',
        action_note: 'Asked SimpleBot to.'
      },
      { commandId, expectedVersion: visit.version }
    );
    assert.equal(done.ok, true, `refused: ${done.code}`);

    const command = await service
      .from('commands')
      .select('origin, actor_person_id')
      .eq('command_id', commandId)
      .single();
    assert.equal(command.data.origin, 'SimpleBot');
    // The accountable actor is still the human, not a bot.
    assert.equal(command.data.actor_person_id, lucyId);

    const audit = await service
      .from('audit_events')
      .select('origin, initiating_person_id')
      .eq('command_id', commandId);
    assert.ok(audit.data.length > 0);
    for (const row of audit.data) {
      assert.equal(row.origin, 'SimpleBot');
      assert.equal(
        row.initiating_person_id,
        lucyId,
        'SimpleBot must never replace the person'
      );
    }
  });

  test('origin cannot be supplied by the caller', async () => {
    const visit = await anAwaitingVisit();
    // Exactly what a prompt-injected model, or somebody hand-writing the RPC,
    // would try. execute_command allows a closed set of keys, and origin is not
    // one of them, so the whole request is refused rather than half-trusted.
    const { data, error } = await office.rpc('execute_command', {
      p_request: {
        command_id: randomUUID(),
        command_type: 'PROGRAMME_VISIT_REVIEW',
        expected_version: visit.version,
        origin: 'SimpleBot',
        payload: { visit_id: visit.id, disposition: 'ActionRequired' }
      }
    });
    const refused = !!error || data?.ok === false;
    assert.ok(refused, 'a caller-supplied origin was accepted');
  });

  test('a pending action belonging to somebody else does not make it SimpleBot', async () => {
    const visit = await anAwaitingVisit();
    const other = (
      await service
        .from('people')
        .select('id')
        .eq('email', email('john'))
        .single()
    ).data.id;
    const commandId = randomUUID();
    await service.from('assistant_pending_actions').insert({
      id: commandId,
      person_id: other,
      thread_id: randomUUID(),
      tool: 'programme_review_visit',
      args: {},
      args_hash: 'b'.repeat(64),
      preview: {},
      status: 'claimed',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    });

    const done = await run(
      office,
      'PROGRAMME_VISIT_REVIEW',
      { visit_id: visit.id, disposition: 'ActionRequired' },
      { commandId, expectedVersion: visit.version }
    );
    assert.equal(done.ok, true, `refused: ${done.code}`);
    const command = await service
      .from('commands')
      .select('origin')
      .eq('command_id', commandId)
      .single();
    assert.equal(
      command.data.origin,
      'UI',
      "another person's pending action granted SimpleBot provenance"
    );
  });

  test('replaying a SimpleBot command changes nothing and writes no second audit event', async () => {
    const visit = await anAwaitingVisit();
    const commandId = randomUUID();
    await service.from('assistant_pending_actions').insert({
      id: commandId,
      person_id: lucyId,
      thread_id: randomUUID(),
      tool: 'programme_review_visit',
      args: {},
      args_hash: 'c'.repeat(64),
      preview: {},
      status: 'claimed',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    });

    const payload = {
      visit_id: visit.id,
      disposition: 'MeterRequiresChanging'
    };
    const first = await run(office, 'PROGRAMME_VISIT_REVIEW', payload, {
      commandId,
      expectedVersion: visit.version
    });
    assert.equal(first.ok, true, `refused: ${first.code}`);
    const eventsAfterFirst = await service
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('command_id', commandId);

    const again = await run(office, 'PROGRAMME_VISIT_REVIEW', payload, {
      commandId,
      expectedVersion: visit.version
    });
    assert.equal(again.ok, true);
    assert.equal(
      again.replayed,
      true,
      'the second call was not treated as a replay'
    );

    const eventsAfterReplay = await service
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('command_id', commandId);
    assert.equal(
      eventsAfterReplay.count,
      eventsAfterFirst.count,
      'the replay wrote another audit event'
    );

    const command = await service
      .from('commands')
      .select('origin')
      .eq('command_id', commandId)
      .single();
    assert.equal(command.data.origin, 'SimpleBot');
  });
});
