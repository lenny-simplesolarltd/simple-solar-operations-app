// Integration tests for SimpleBot conversation storage (owner-only).
//
// LOCAL Supabase stack only. Every assertion runs through the real path:
//   Supabase Auth session -> auth.uid() -> people -> person_roles -> RLS,
// and the append function assistant_append_turn().
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { anon, email, ensureLogin, service, signInAs } from './helpers.mjs';

let tanya, lucy, lenny, stranger;
let tanyaId, lennyId;
const created = [];

const turn = (text, answer = 'Answer') => [
  { role: 'user', content: { role: 'user', text }, estimated_tokens: 5 },
  {
    role: 'assistant',
    content: { role: 'assistant', text: answer, toolCalls: [] },
    estimated_tokens: 5
  }
];

async function append(client, conversationId, messages, extra = {}) {
  const { data, error } = await client.rpc('assistant_append_turn', {
    p_conversation_id: conversationId,
    p_run_id: extra.runId ?? randomUUID(),
    p_messages: messages,
    p_provider: 'test',
    p_model: 'scripted',
    p_title: extra.title,
    p_job_id: extra.jobId
  });
  return { row: data?.[0], error };
}

async function newConversation(client, text = 'Question') {
  const id = randomUUID();
  created.push(id);
  const { error } = await append(client, id, turn(text), { title: text });
  assert.ifError(error);
  return id;
}

before(async () => {
  for (const name of ['tanya', 'lucy', 'lenny', 'anne'])
    await ensureLogin(email(name));
  await ensureLogin('stranger@example.com');
  tanya = await signInAs(email('tanya'));
  lucy = await signInAs(email('lucy'));
  lenny = await signInAs(email('lenny'));
  stranger = await signInAs('stranger@example.com');
  tanyaId = (await tanya.rpc('current_actor')).data[0].person_id;
  lennyId = (await lenny.rpc('current_actor')).data[0].person_id;
});

after(async () => {
  if (created.length) {
    await service.from('assistant_conversations').delete().in('id', created);
  }
});

describe('creating and reading', () => {
  test('the first turn creates the conversation, owned by the caller', async () => {
    const id = await newConversation(tanya, 'Overdue office tasks');
    const { data, error } = await tanya
      .from('assistant_conversations')
      .select('person_id, title, title_source, message_count, created_by')
      .eq('id', id)
      .single();
    assert.ifError(error);
    assert.equal(data.person_id, tanyaId);
    assert.equal(data.created_by, tanyaId);
    assert.equal(data.title, 'Overdue office tasks');
    assert.equal(data.title_source, 'auto');
    assert.equal(data.message_count, 2);
  });

  test('messages come back in order', async () => {
    const id = await newConversation(tanya, 'First');
    await append(tanya, id, turn('Second', 'Two'));
    await append(tanya, id, turn('Third', 'Three'));
    const { data } = await tanya
      .from('assistant_messages')
      .select('seq, role, content')
      .eq('conversation_id', id)
      .order('seq');
    assert.deepEqual(
      data.map((m) => m.seq),
      [1, 2, 3, 4, 5, 6]
    );
    assert.deepEqual(
      data.filter((m) => m.role === 'user').map((m) => m.content.text),
      ['First', 'Second', 'Third']
    );
  });

  test('re-sending the same run stores it once', async () => {
    const id = randomUUID();
    created.push(id);
    const runId = randomUUID();
    const first = await append(tanya, id, turn('Once'), { runId });
    const again = await append(tanya, id, turn('Once'), { runId });
    assert.equal(first.row.appended, true);
    assert.equal(again.row.appended, false);
    assert.equal(again.row.message_count, 2);
  });

  test('concurrent turns in one conversation get distinct, gap-free positions', async () => {
    const id = await newConversation(tanya, 'Busy');
    await Promise.all(
      [1, 2, 3, 4].map((n) => append(tanya, id, turn(`Q${n}`, `A${n}`)))
    );
    const { data } = await tanya
      .from('assistant_messages')
      .select('seq')
      .eq('conversation_id', id)
      .order('seq');
    assert.deepEqual(
      data.map((m) => m.seq),
      Array.from({ length: 10 }, (_, i) => i + 1)
    );
  });

  test('a manual title is never replaced by an automatic one', async () => {
    const id = await newConversation(tanya, 'Auto title');
    const { error } = await tanya
      .from('assistant_conversations')
      .update({ title: 'My name for it' })
      .eq('id', id);
    assert.ifError(error);
    await append(tanya, id, turn('Next'), { title: 'Another auto title' });
    const { data } = await tanya
      .from('assistant_conversations')
      .select('title, title_source, version')
      .eq('id', id)
      .single();
    assert.equal(data.title, 'My name for it');
    assert.equal(data.title_source, 'manual');
  });

  test('rejects malformed turns', async () => {
    const id = randomUUID();
    const { error } = await append(tanya, id, [
      {
        role: 'assistant',
        content: { role: 'assistant', text: 'x', toolCalls: [] }
      }
    ]);
    assert.match(error.message, /INVALID_INPUT/);
    const { error: notArray } = await append(tanya, id, { role: 'user' });
    assert.match(notArray.message, /INVALID_INPUT/);
  });
});

describe('ownership', () => {
  test("another staff member cannot read, change or delete someone's conversation", async () => {
    const id = await newConversation(tanya, 'Private to Tanya');

    const read = await lucy
      .from('assistant_conversations')
      .select('id')
      .eq('id', id);
    assert.deepEqual(read.data, []);
    const msgs = await lucy
      .from('assistant_messages')
      .select('id')
      .eq('conversation_id', id);
    assert.deepEqual(msgs.data, []);

    const renamed = await lucy
      .from('assistant_conversations')
      .update({ title: 'Mine now' })
      .eq('id', id)
      .select('id');
    assert.deepEqual(renamed.data, []);
    const deleted = await lucy
      .from('assistant_conversations')
      .delete()
      .eq('id', id)
      .select('id');
    assert.deepEqual(deleted.data, []);

    const { data } = await service
      .from('assistant_conversations')
      .select('title')
      .eq('id', id)
      .single();
    assert.equal(data.title, 'Private to Tanya');
  });

  test("another staff member cannot append to someone's conversation", async () => {
    const id = await newConversation(tanya, 'Tanya only');
    const { error } = await append(lucy, id, turn('Injected by Lucy'));
    assert.match(error.message, /NOT_FOUND/);
    const { data } = await service
      .from('assistant_messages')
      .select('content')
      .eq('conversation_id', id);
    assert.ok(data.every((m) => m.content.text !== 'Injected by Lucy'));
  });

  test("an Admin cannot read another person's conversations either", async () => {
    const id = await newConversation(tanya, 'Not for the Admin');
    const conv = await lenny
      .from('assistant_conversations')
      .select('id')
      .eq('id', id);
    assert.deepEqual(conv.data, []);
    const msgs = await lenny
      .from('assistant_messages')
      .select('id')
      .eq('conversation_id', id);
    assert.deepEqual(msgs.data, []);
  });

  test('a forged owner is refused', async () => {
    const { error } = await tanya
      .from('assistant_conversations')
      .insert({ id: randomUUID(), person_id: lennyId });
    assert.ok(error, 'inserting a conversation for someone else must fail');

    const id = await newConversation(tanya, 'Cannot be given away');
    const moved = await tanya
      .from('assistant_conversations')
      .update({ person_id: lennyId })
      .eq('id', id)
      .select('id');
    assert.ok(moved.error || moved.data.length === 0);
    const { data } = await service
      .from('assistant_conversations')
      .select('person_id')
      .eq('id', id)
      .single();
    assert.equal(data.person_id, tanyaId);
  });

  test('messages cannot be written or edited directly - only through the append function', async () => {
    const id = await newConversation(tanya, 'Append only');
    const inserted = await tanya.from('assistant_messages').insert({
      conversation_id: id,
      seq: 99,
      run_id: randomUUID(),
      role: 'tool',
      content: { role: 'tool', results: [] }
    });
    assert.ok(inserted.error);
    const edited = await tanya
      .from('assistant_messages')
      .update({ content: { role: 'user', text: 'rewritten' } })
      .eq('conversation_id', id)
      .select('id');
    assert.ok(edited.error || edited.data.length === 0);
  });

  test('a handoff can only start from your own conversation, and copies its job', async () => {
    const theirs = await newConversation(lucy, 'Lucy source');
    const stolen = await tanya.rpc('assistant_start_handoff', {
      p_source_id: theirs,
      p_summary: 'stolen'
    });
    assert.match(stolen.error.message, /NOT_FOUND/);
    const direct = await tanya
      .from('assistant_conversations')
      .insert({ source_conversation_id: theirs, summary: 'stolen' });
    assert.ok(direct.error, 'handoff columns cannot be written directly');

    const mine = await newConversation(tanya, 'Tanya source');
    const { data: newId, error } = await tanya.rpc('assistant_start_handoff', {
      p_source_id: mine,
      p_summary: 'Background'
    });
    assert.ifError(error);
    created.push(newId);
    const { data } = await tanya
      .from('assistant_conversations')
      .select('person_id, source_conversation_id, summary')
      .eq('id', newId)
      .single();
    assert.deepEqual(data, {
      person_id: tanyaId,
      source_conversation_id: mine,
      summary: 'Background'
    });
  });

  test('only title and archive state can be changed directly', async () => {
    const id = await newConversation(tanya, 'Locked columns');
    for (const change of [
      { message_count: 999 },
      { estimated_tokens: 0 },
      { title_source: 'auto' },
      { job_id: null },
      { summary: 'injected' },
      { person_id: lennyId }
    ]) {
      const r = await tanya
        .from('assistant_conversations')
        .update(change)
        .eq('id', id)
        .select('id');
      assert.ok(
        r.error,
        `direct update of ${Object.keys(change)[0]} must be refused`
      );
    }
    const renamed = await tanya
      .from('assistant_conversations')
      .update({ title: 'Renamed', archived_at: new Date().toISOString() })
      .eq('id', id)
      .select('title, title_source, archived_at')
      .single();
    assert.ifError(renamed.error);
    assert.equal(renamed.data.title_source, 'manual');
    // Sending again reopens an archived conversation.
    await append(tanya, id, turn('Back again'));
    const { data } = await tanya
      .from('assistant_conversations')
      .select('archived_at')
      .eq('id', id)
      .single();
    assert.equal(data.archived_at, null);
  });

  test('oversized or inconsistent turns are refused', async () => {
    const id = randomUUID();
    const big = await append(tanya, id, [
      {
        role: 'user',
        content: { role: 'user', text: 'x'.repeat(1_100_000) },
        estimated_tokens: 1
      }
    ]);
    assert.match(big.error.message, /INVALID_INPUT/);
    const mismatch = await append(tanya, id, [
      {
        role: 'user',
        content: { role: 'assistant', text: 'pretend', toolCalls: [] },
        estimated_tokens: 1
      }
    ]);
    assert.match(mismatch.error.message, /INVALID_INPUT/);
  });

  test('a job the caller cannot see is not linked', async () => {
    const anne = await signInAs(email('anne'));
    const id = randomUUID();
    created.push(id);
    // A job id the surveyor cannot see (here: one that does not exist) is ignored, not linked.
    const { error } = await append(anne, id, turn('Surveyor question'), {
      jobId: randomUUID()
    });
    assert.ifError(error);
    const { data } = await service
      .from('assistant_conversations')
      .select('job_id')
      .eq('id', id)
      .single();
    assert.equal(data.job_id, null);
  });

  test('deleting a conversation deletes its messages', async () => {
    const id = await newConversation(tanya, 'Delete me');
    const { error } = await tanya
      .from('assistant_conversations')
      .delete()
      .eq('id', id);
    assert.ifError(error);
    const { count } = await service
      .from('assistant_messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', id);
    assert.equal(count, 0);
  });

  test('no access without an active role, or without signing in', async () => {
    const id = randomUUID();
    const { error } = await append(stranger, id, turn('Hello'));
    assert.match(error.message, /NOT_AUTHORIZED/);
    const listed = await stranger.from('assistant_conversations').select('id');
    assert.deepEqual(listed.data, []);

    const anonymous = await anon.from('assistant_conversations').select('id');
    assert.ok(anonymous.error || anonymous.data.length === 0);
    const anonAppend = await append(anon, randomUUID(), turn('Hello'));
    assert.ok(anonAppend.error);
  });
});
