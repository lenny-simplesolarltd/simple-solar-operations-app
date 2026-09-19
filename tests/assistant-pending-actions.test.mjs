// Integration tests for SimpleBot durable pending actions (BD-07).
//
// LOCAL Supabase stack only. Every call runs as a real signed-in user through
// the public functions; the database derives the actor from the session.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import { anon, email, ensureLogin, service, signInAs } from './helpers.mjs';

let lucy, tanya, lenny, stranger;

const hash = (v) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function propose(client, overrides = {}) {
  const id = randomUUID();
  const args = overrides.args ?? { form_id: randomUUID(), operations: [] };
  const { error } = await client.rpc('assistant_register_pending_action', {
    p_id: id,
    p_thread_id: randomUUID(),
    p_tool: overrides.tool ?? 'edit_form_draft',
    p_args: args,
    p_args_hash: hash(args),
    p_expected_version: 3,
    p_preview: { title: 'Edit the draft', changes: [] },
    p_expires_at:
      overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString()
  });
  return { id, args, error };
}

const claim = async (client, id, decision = 'confirm') =>
  (
    await client.rpc('assistant_claim_pending_action', {
      p_id: id,
      p_decision: decision
    })
  ).data;

const status = async (id) =>
  (
    await service
      .from('assistant_pending_actions')
      .select('status, outcome_code')
      .eq('id', id)
      .single()
  ).data;

before(async () => {
  for (const name of ['lucy', 'tanya', 'lenny']) await ensureLogin(email(name));
  await ensureLogin('stranger@example.com');
  [lucy, tanya, lenny, stranger] = await Promise.all([
    signInAs(email('lucy')),
    signInAs(email('tanya')),
    signInAs(email('lenny')),
    signInAs('stranger@example.com')
  ]);
});

describe('pending actions', () => {
  test('a confirm returns the stored action once; the outcome is recorded', async () => {
    const { id, args, error } = await propose(lucy);
    assert.ifError(error);
    const won = await claim(lucy, id);
    assert.equal(won.outcome, 'ok');
    assert.deepEqual(won.args, args);
    assert.equal(won.expected_version, 3);
    assert.equal((await claim(lucy, id)).outcome, 'already_used');
    await lucy.rpc('assistant_complete_pending_action', {
      p_id: id,
      p_succeeded: true,
      p_code: null
    });
    assert.deepEqual(await status(id), {
      status: 'succeeded',
      outcome_code: null
    });
    // A recorded outcome cannot be released back to pending.
    await lucy.rpc('assistant_release_pending_action', { p_id: id });
    assert.equal((await status(id)).status, 'succeeded');
  });

  test("another staff member - even an Admin - cannot confirm, cancel or see someone's proposal", async () => {
    const { id } = await propose(lucy);
    assert.equal((await claim(tanya, id)).outcome, 'unknown');
    assert.equal((await claim(lenny, id, 'cancel')).outcome, 'unknown');
    assert.deepEqual(
      (await lenny.from('assistant_pending_actions').select('id').eq('id', id))
        .data,
      []
    );
    assert.equal(
      (await status(id)).status,
      'pending',
      'their attempts do not use it up'
    );
    assert.equal((await claim(lucy, id)).outcome, 'ok');
  });

  test('concurrent confirmations: exactly one wins', async () => {
    const { id } = await propose(lucy);
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => claim(lucy, id))
    );
    assert.equal(outcomes.filter((o) => o.outcome === 'ok').length, 1);
    assert.equal(
      outcomes.filter((o) => o.outcome === 'already_used').length,
      5
    );
  });

  test('an expired proposal cannot be claimed', async () => {
    const { id, error } = await propose(lucy, {
      expiresAt: new Date(Date.now() + 1500).toISOString()
    });
    assert.ifError(error);
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal((await claim(lucy, id)).outcome, 'expired');
    assert.equal((await status(id)).status, 'pending');
  });

  test('a cancelled proposal can never be confirmed', async () => {
    const { id } = await propose(lucy);
    assert.equal((await claim(lucy, id, 'cancel')).outcome, 'ok');
    assert.equal((await claim(lucy, id)).outcome, 'already_used');
    assert.equal((await status(id)).status, 'cancelled');
  });

  test('a transport failure releases the claim so the same action can be retried', async () => {
    const { id } = await propose(lucy);
    assert.equal((await claim(lucy, id)).outcome, 'ok');
    await lucy.rpc('assistant_release_pending_action', { p_id: id });
    assert.equal((await claim(lucy, id)).outcome, 'ok');
    await lucy.rpc('assistant_complete_pending_action', {
      p_id: id,
      p_succeeded: false,
      p_code: 'FORMS_STALE_VERSION'
    });
    assert.deepEqual(await status(id), {
      status: 'failed',
      outcome_code: 'FORMS_STALE_VERSION'
    });
  });

  test('forged or unknown ids reveal nothing', async () => {
    assert.equal((await claim(lucy, randomUUID())).outcome, 'unknown');
  });

  test('proposals are validated and owned by the caller', async () => {
    const tooLong = await propose(lucy, {
      expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString()
    });
    assert.match(tooLong.error.message, /INVALID_INPUT/);
    const badTool = await propose(lucy, { tool: 'DROP TABLE x' });
    assert.ok(badTool.error);
    const noRole = await propose(stranger);
    assert.match(noRole.error.message, /NOT_AUTHORIZED/);
    const anonymous = await propose(anon);
    assert.ok(anonymous.error);

    const { id } = await propose(tanya);
    const { data } = await service
      .from('assistant_pending_actions')
      .select('person_id')
      .eq('id', id)
      .single();
    const { data: me } = await tanya.rpc('current_actor');
    assert.equal(data.person_id, me[0].person_id);
  });

  test('the table cannot be written directly', async () => {
    const insert = await lucy.from('assistant_pending_actions').insert({
      id: randomUUID(),
      person_id: randomUUID(),
      thread_id: randomUUID(),
      tool: 'x',
      args: {},
      args_hash: 'a'.repeat(64),
      preview: {},
      expires_at: new Date(Date.now() + 60_000).toISOString()
    });
    assert.ok(insert.error);
    const { id } = await propose(lucy);
    const update = await lucy
      .from('assistant_pending_actions')
      .update({ status: 'pending' })
      .eq('id', id)
      .select('id');
    assert.ok(update.error || update.data.length === 0);
  });
});
