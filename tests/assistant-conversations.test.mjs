// Integration tests for SimpleBot conversation storage (owner-only).
//
// LOCAL Supabase stack only. Every assertion runs through the real path:
//   Supabase Auth session -> auth.uid() -> people -> person_roles -> RLS,
// and the append function assistant_append_turn().
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { anon, email, ensureLogin, service, signInAs } from './helpers.mjs';

let hannah, lucy, lenny, stranger;
let hannahId, lennyId;
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
  for (const name of ['hannah', 'lucy', 'lenny'])
    await ensureLogin(email(name));
  await ensureLogin('stranger@example.com');
  hannah = await signInAs(email('hannah'));
  lucy = await signInAs(email('lucy'));
  lenny = await signInAs(email('lenny'));
  stranger = await signInAs('stranger@example.com');
  hannahId = (await hannah.rpc('current_actor')).data[0].person_id;
  lennyId = (await lenny.rpc('current_actor')).data[0].person_id;
});

after(async () => {
  if (created.length) {
    await service.from('assistant_conversations').delete().in('id', created);
  }
});

describe('creating and reading', () => {
  test('the first turn creates the conversation, owned by the caller', async () => {
    const id = await newConversation(hannah, 'Overdue office tasks');
    const { data, error } = await hannah
      .from('assistant_conversations')
      .select('person_id, title, title_source, message_count, created_by')
      .eq('id', id)
      .single();
    assert.ifError(error);
    assert.equal(data.person_id, hannahId);
    assert.equal(data.created_by, hannahId);
    assert.equal(data.title, 'Overdue office tasks');
    assert.equal(data.title_source, 'auto');
    assert.equal(data.message_count, 2);
  });

  test('messages come back in order', async () => {
    const id = await newConversation(hannah, 'First');
    await append(hannah, id, turn('Second', 'Two'));
    await append(hannah, id, turn('Third', 'Three'));
    const { data } = await hannah
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
    const first = await append(hannah, id, turn('Once'), { runId });
    const again = await append(hannah, id, turn('Once'), { runId });
    assert.equal(first.row.appended, true);
    assert.equal(again.row.appended, false);
    assert.equal(again.row.message_count, 2);
  });

  test('concurrent turns in one conversation get distinct, gap-free positions', async () => {
    const id = await newConversation(hannah, 'Busy');
    await Promise.all(
      [1, 2, 3, 4].map((n) => append(hannah, id, turn(`Q${n}`, `A${n}`)))
    );
    const { data } = await hannah
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
    const id = await newConversation(hannah, 'Auto title');
    const { error } = await hannah
      .from('assistant_conversations')
      .update({ title: 'My name for it', title_source: 'manual' })
      .eq('id', id);
    assert.ifError(error);
    await append(hannah, id, turn('Next'), { title: 'Another auto title' });
    const { data } = await hannah
      .from('assistant_conversations')
      .select('title, title_source, version')
      .eq('id', id)
      .single();
    assert.equal(data.title, 'My name for it');
    assert.equal(data.title_source, 'manual');
  });

  test('rejects malformed turns', async () => {
    const id = randomUUID();
    const { error } = await append(hannah, id, [
      {
        role: 'assistant',
        content: { role: 'assistant', text: 'x', toolCalls: [] }
      }
    ]);
    assert.match(error.message, /INVALID_INPUT/);
    const { error: notArray } = await append(hannah, id, { role: 'user' });
    assert.match(notArray.message, /INVALID_INPUT/);
  });
});

describe('ownership', () => {
  test("another staff member cannot read, change or delete someone's conversation", async () => {
    const id = await newConversation(hannah, 'Private to Hannah');

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
    assert.equal(data.title, 'Private to Hannah');
  });

  test("another staff member cannot append to someone's conversation", async () => {
    const id = await newConversation(hannah, 'Hannah only');
    const { error } = await append(lucy, id, turn('Injected by Lucy'));
    assert.match(error.message, /NOT_FOUND/);
    const { data } = await service
      .from('assistant_messages')
      .select('content')
      .eq('conversation_id', id);
    assert.ok(data.every((m) => m.content.text !== 'Injected by Lucy'));
  });

  test("an Admin cannot read another person's conversations either", async () => {
    const id = await newConversation(hannah, 'Not for the Admin');
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
    const { error } = await hannah
      .from('assistant_conversations')
      .insert({ id: randomUUID(), person_id: lennyId });
    assert.ok(error, 'inserting a conversation for someone else must fail');

    const id = await newConversation(hannah, 'Cannot be given away');
    const moved = await hannah
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
    assert.equal(data.person_id, hannahId);
  });

  test('messages cannot be written or edited directly - only through the append function', async () => {
    const id = await newConversation(hannah, 'Append only');
    const inserted = await hannah.from('assistant_messages').insert({
      conversation_id: id,
      seq: 99,
      run_id: randomUUID(),
      role: 'tool',
      content: { role: 'tool', results: [] }
    });
    assert.ok(inserted.error);
    const edited = await hannah
      .from('assistant_messages')
      .update({ content: { role: 'user', text: 'rewritten' } })
      .eq('conversation_id', id)
      .select('id');
    assert.ok(edited.error || edited.data.length === 0);
  });

  test('a handoff can only link to your own conversation', async () => {
    const theirs = await newConversation(lucy, 'Lucy source');
    const { error } = await hannah
      .from('assistant_conversations')
      .insert({ source_conversation_id: theirs, summary: 'stolen' });
    assert.ok(error, "linking to another person's conversation must fail");

    const mine = await newConversation(hannah, 'Hannah source');
    const { data, error: ok } = await hannah
      .from('assistant_conversations')
      .insert({ source_conversation_id: mine, summary: 'Background' })
      .select('id, person_id')
      .single();
    assert.ifError(ok);
    created.push(data.id);
    assert.equal(data.person_id, hannahId);
  });

  test('deleting a conversation deletes its messages', async () => {
    const id = await newConversation(hannah, 'Delete me');
    const { error } = await hannah
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
