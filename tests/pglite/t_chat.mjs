// Internal team chat. Run:
//   node t_chat.mjs
//
// Most of these assertions are about ONE thing: membership is the whole
// security model. A role never substitutes for being in the conversation.
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok, as } = f;
const { job: jobId } = await readyToBook(f);
const job = await one(`select id, job_ref from public.jobs where id=$1`, [
  jobId
]);

const C = (type, payload) => ({
  command_id: id(),
  command_type: type,
  payload
});
const opread = async (who, req) => {
  await as(who);
  try {
    return (
      await db.query(`select public.execute_operations_read($1::jsonb) r`, [
        req
      ])
    ).rows[0].r;
  } catch (e) {
    return { error: e.message };
  }
};
// PGlite connects as a superuser, which BYPASSES row level security. Every
// assertion about what RLS hides has to drop to the authenticated role first,
// or it silently proves nothing.
const asUser = async (who, fn) => {
  await as(who);
  await db.query('set role authenticated');
  try {
    return await fn();
  } catch (e) {
    throw new Error(`as ${who}: ${e.message}`);
  } finally {
    await db.query('reset role');
  }
};
const visibleMessages = (who) =>
  asUser(
    who,
    async () => (await all(`select id from public.chat_messages`)).length
  );

const refuses = async (who, req, code) => {
  const r = await cmd(who, req);
  assert.equal(r.error, code, JSON.stringify(r));
  return r;
};

// ---------------------------------------------------------------------------
// 0. Registration
// ---------------------------------------------------------------------------
const types = (await one(`select app.command_types() t`)).t;
for (const t of [
  'CHAT_START',
  'CHAT_SEND',
  'CHAT_EDIT',
  'CHAT_DELETE',
  'CHAT_REACT',
  'CHAT_MARK_READ'
])
  assert.ok(types.includes(t), 'registered: ' + t);

// ---------------------------------------------------------------------------
// 1. Direct conversations are unique per pair, whoever opens them
// ---------------------------------------------------------------------------
let r = ok(
  await cmd(
    'tanya',
    C('CHAT_START', { kind: 'Direct', person_ids: [people.ben] })
  ),
  'start'
);
assert.equal(r.created, true);
const direct = r.conversation_id;

// Ben opening "a new chat with Tanya" must land in the SAME conversation, not
// a second one that each of them half-reads.
r = ok(
  await cmd(
    'ben',
    C('CHAT_START', { kind: 'Direct', person_ids: [people.tanya] })
  ),
  'reopen'
);
assert.equal(r.created, false);
assert.equal(
  r.conversation_id,
  direct,
  'the pair has exactly one direct conversation'
);
assert.equal(
  (await one(`select count(*)::int n from public.chat_conversations`)).n,
  1
);

// ---------------------------------------------------------------------------
// 2. Sending, and what the server resolves rather than trusting
// ---------------------------------------------------------------------------
r = ok(
  await cmd(
    'tanya',
    C('CHAT_SEND', {
      conversation_id: direct,
      body: `Can you check ${job.job_ref}?`
    })
  ),
  'send'
);
const first = r.message_id;
// The job reference was resolved server-side into something the UI can link.
assert.deepEqual(r.job_ids, [job.id], 'the job reference resolved');

// A reference to a job that does not exist resolves to nothing rather than
// erroring: it is just text in a sentence.
r = ok(
  await cmd(
    'tanya',
    C('CHAT_SEND', { conversation_id: direct, body: 'and SS-ZZZZ-9999 too' })
  ),
  'unknown ref'
);
assert.deepEqual(r.job_ids, []);

// Mentioning somebody who is not in the conversation must not notify them
// about a room they cannot open.
r = ok(
  await cmd(
    'tanya',
    C('CHAT_SEND', {
      conversation_id: direct,
      body: 'ignore this',
      mention_person_ids: [people.dan, people.ben]
    })
  ),
  'mentions'
);
assert.deepEqual(
  r.mentioned,
  [people.ben],
  'only actual members are mentioned'
);

// ---------------------------------------------------------------------------
// 3. MEMBERSHIP, not role
// ---------------------------------------------------------------------------
// Dan is a Director. Ben is an Admin. Neither rank gets you into a private
// conversation you were not added to.
await refuses(
  'dan',
  C('CHAT_SEND', { conversation_id: direct, body: 'hello' }),
  'CHAT_NOT_A_MEMBER'
);

let read = await opread('dan', {
  read_type: 'CHAT_MESSAGES',
  conversation_id: direct
});
assert.match(
  read.error ?? '',
  /CHAT_NOT_A_MEMBER/,
  'a non-member cannot read the thread'
);

read = await opread('tanya', {
  read_type: 'CHAT_MESSAGES',
  conversation_id: direct
});
assert.equal(read.data.messages.length, 3);

// RLS says the same thing as the read does, for a direct table select.
assert.equal(
  await visibleMessages('dan'),
  0,
  'RLS hides the messages from a non-member'
);
assert.equal(await visibleMessages('tanya'), 3, 'and shows them to a member');

// Even a chat administrator may LIST but not READ. Seeing that a conversation
// exists is a different power from reading what is in it.
// Dan gets communications.chat.admin and is still NOT a member of this
// conversation - which is the only interesting case. (Ben is a member, so he
// would prove nothing here.)
await db.query(
  `insert into public.person_roles (person_id, role_code) values ($1,'Admin') on conflict do nothing`,
  [people.dan]
);
await asUser('dan', async () => {
  assert.ok(
    (await all(`select id from public.chat_conversations`)).length >= 1,
    'a chat admin lists conversations'
  );
  assert.ok(
    (await all(`select id from public.chat_members`)).length >= 1,
    'and sees who is in them'
  );
  assert.equal(
    (await all(`select id from public.chat_messages`)).length,
    0,
    'but still cannot read a single message body'
  );
});

// ---------------------------------------------------------------------------
// 4. Unread counts
// ---------------------------------------------------------------------------
read = await opread('ben', { read_type: 'CHAT_CONVERSATIONS' });
let conv = read.data.conversations.find((c) => c.conversation_id === direct);
assert.equal(conv.unread, 3, "Ben has not read any of Tanya's three");

ok(
  await cmd('ben', C('CHAT_MARK_READ', { conversation_id: direct })),
  'mark read'
);
read = await opread('ben', { read_type: 'CHAT_CONVERSATIONS' });
conv = read.data.conversations.find((c) => c.conversation_id === direct);
assert.equal(conv.unread, 0);

// Your own message is read by definition: sending must not make you unread.
ok(
  await cmd('ben', C('CHAT_SEND', { conversation_id: direct, body: 'on it' })),
  'ben replies'
);
read = await opread('ben', { read_type: 'CHAT_CONVERSATIONS' });
conv = read.data.conversations.find((c) => c.conversation_id === direct);
assert.equal(conv.unread, 0, 'your own message is not unread');

read = await opread('tanya', { read_type: 'CHAT_CONVERSATIONS' });
conv = read.data.conversations.find((c) => c.conversation_id === direct);
assert.equal(conv.unread, 1, 'Tanya now has one');

// The read marker never moves backwards.
const before = (
  await one(
    `select last_read_at from public.chat_members where conversation_id=$1 and person_id=$2`,
    [direct, people.ben]
  )
).last_read_at;
ok(
  await cmd(
    'ben',
    C('CHAT_MARK_READ', { conversation_id: direct, at: '2020-01-01T00:00:00Z' })
  ),
  'backdated'
);
const after = (
  await one(
    `select last_read_at from public.chat_members where conversation_id=$1 and person_id=$2`,
    [direct, people.ben]
  )
).last_read_at;
assert.deepEqual(after, before, 'a backdated mark-read is ignored');

// ---------------------------------------------------------------------------
// 5. Editing and deleting
// ---------------------------------------------------------------------------
await refuses(
  'ben',
  C('CHAT_EDIT', { message_id: first, body: 'changed' }),
  'CHAT_NOT_YOUR_MESSAGE'
);

ok(
  await cmd(
    'tanya',
    C('CHAT_EDIT', { message_id: first, body: 'Can you check it today?' })
  ),
  'edit'
);
let row = await one(`select * from public.chat_messages where id=$1`, [first]);
assert.equal(row.body, 'Can you check it today?');
assert.ok(row.edited_at);
assert.match(
  row.original_body,
  /Can you check SS-/,
  'the first edit keeps what was originally said'
);

// A second edit does not overwrite the original.
ok(
  await cmd(
    'tanya',
    C('CHAT_EDIT', { message_id: first, body: 'third wording' })
  ),
  'edit again'
);
row = await one(`select * from public.chat_messages where id=$1`, [first]);
assert.match(
  row.original_body,
  /Can you check SS-/,
  'still the FIRST body, not the second'
);

// Deleting keeps the row so the conversation keeps its shape.
ok(
  await cmd(
    'tanya',
    C('CHAT_DELETE', { message_id: first, reason: 'wrong thread' })
  ),
  'delete'
);
row = await one(`select * from public.chat_messages where id=$1`, [first]);
assert.equal(row.body, '');
assert.ok(row.deleted_at);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.chat_messages where conversation_id=$1`,
      [direct]
    )
  ).n,
  4,
  'the message is still there, blanked'
);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.audit_events where action='ChatMessageDeleted'`
    )
  ).n,
  1,
  'deleting is audited; sending is not'
);

// A deleted message returns no body to the reader.
read = await opread('tanya', {
  read_type: 'CHAT_MESSAGES',
  conversation_id: direct
});
const gone = read.data.messages.find((m) => m.message_id === first);
assert.equal(gone.body, null);
assert.equal(gone.deleted, true);

// Sending a message is NOT audited - a busy conversation would drown the log.
assert.equal(
  (
    await one(
      `select count(*)::int n from public.audit_events where action like 'ChatMessage%' and action <> 'ChatMessageDeleted'`
    )
  ).n,
  0
);

// ---------------------------------------------------------------------------
// 6. Reactions
// ---------------------------------------------------------------------------
const bensMsg = (
  await one(
    `select id from public.chat_messages where author_person_id=$1 order by created_at desc limit 1`,
    [people.ben]
  )
).id;
ok(
  await cmd('tanya', C('CHAT_REACT', { message_id: bensMsg, emoji: '👍' })),
  'react'
);
assert.equal(
  (await one(`select count(*)::int n from public.chat_reactions`)).n,
  1
);
// Reacting twice with the same emoji is idempotent, not a second reaction.
ok(
  await cmd('tanya', C('CHAT_REACT', { message_id: bensMsg, emoji: '👍' })),
  'react again'
);
assert.equal(
  (await one(`select count(*)::int n from public.chat_reactions`)).n,
  1
);
ok(
  await cmd(
    'tanya',
    C('CHAT_REACT', { message_id: bensMsg, emoji: '👍', on: false })
  ),
  'unreact'
);
assert.equal(
  (await one(`select count(*)::int n from public.chat_reactions`)).n,
  0
);
// A non-member cannot react to a message they cannot see.
await refuses(
  'dan',
  C('CHAT_REACT', { message_id: bensMsg, emoji: '👍' }),
  'CHAT_NOT_A_MEMBER'
);

// ---------------------------------------------------------------------------
// 7. Groups, and who may be in one
// ---------------------------------------------------------------------------
r = ok(
  await cmd(
    'tanya',
    C('CHAT_START', {
      kind: 'Group',
      title: 'Thursday installs',
      person_ids: [people.ben, people.dan]
    })
  ),
  'group'
);
const group = r.conversation_id;
assert.equal(r.members, 3, 'the author is always a member');

// A direct conversation is exactly two people.
await refuses(
  'tanya',
  C('CHAT_START', { kind: 'Direct', person_ids: [people.ben, people.dan] }),
  'CHAT_REFUSED: a direct conversation is exactly two people'
);

// Somebody who cannot chat at all cannot be put in a conversation: it would
// silently accumulate messages nobody will read.
const mute = (
  await one(
    `insert into public.people (legacy_id, email, display_name) values ('PERSON-mute','mute@test.local','Mute') returning id`
  )
).id;
await db.query(
  `insert into public.person_roles (person_id, role_code) values ($1,'ReadOnly')`,
  [mute]
);
await refuses(
  'tanya',
  C('CHAT_START', { kind: 'Group', person_ids: [people.ben, mute] }),
  'CHAT_MEMBER_CANNOT_CHAT'
);

// An inactive person likewise.
await db.query(`update public.people set active=false where id=$1`, [
  people.sam
]);
await refuses(
  'tanya',
  C('CHAT_START', { kind: 'Group', person_ids: [people.ben, people.sam] }),
  'CHAT_MEMBER_INVALID'
);

// ---------------------------------------------------------------------------
// 8. Replies stay inside their conversation
// ---------------------------------------------------------------------------
r = ok(
  await cmd(
    'tanya',
    C('CHAT_SEND', { conversation_id: group, body: 'morning' })
  ),
  'group message'
);
const groupMsg = r.message_id;
await refuses(
  'tanya',
  C('CHAT_SEND', {
    conversation_id: direct,
    body: 'reply across',
    reply_to_id: groupMsg
  }),
  'CHAT_REPLY_NOT_IN_CONVERSATION'
);

// ---------------------------------------------------------------------------
// 9. A message must say something
// ---------------------------------------------------------------------------
await refuses(
  'tanya',
  C('CHAT_SEND', { conversation_id: direct, body: '   ' }),
  'CHAT_REFUSED: a message needs something in it'
);

// ---------------------------------------------------------------------------
// 10. Tagging a task: the client says what it MEANT, the server decides
// ---------------------------------------------------------------------------
// A task Tanya owns, and one she does not.
const mine = (
  await one(
    `insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, created_rule_version)
  values ($1,'PRE01','chat-mine','Presale','Send deposit invoice',$2,1) returning id`,
    [job.id, people.tanya]
  )
).id;
const theirs = (
  await one(
    `insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, created_rule_version)
  values ($1,'INS01','chat-theirs','Install','Installer confirmation call',$2,1) returning id`,
    [job.id, people.inst_a]
  )
).id;

// Tanya is Office, which holds task.read.all, so both are hers to tag.
r = ok(
  await cmd(
    'tanya',
    C('CHAT_SEND', {
      conversation_id: direct,
      body: 'look at these',
      mention_task_ids: [mine, theirs]
    })
  ),
  'tag tasks'
);
assert.deepEqual(
  [...r.task_ids].sort(),
  [mine, theirs].sort(),
  'an office actor may tag any task they can read'
);

// An installer may read only their own. Tagging somebody else's must drop it
// rather than refuse: tagging can never become a way to discover a task.
await db.query(
  `insert into public.chat_members (conversation_id, person_id) values ($1,$2)
  on conflict do nothing`,
  [direct, people.inst_a]
);
r = ok(
  await cmd(
    'inst_a',
    C('CHAT_SEND', {
      conversation_id: direct,
      body: 'and these',
      mention_task_ids: [mine, theirs]
    })
  ),
  'installer tags'
);
assert.deepEqual(
  r.task_ids,
  [theirs],
  'only the task the author may read survives'
);

// Rubbish in the payload is ignored, not fatal.
r = ok(
  await cmd(
    'tanya',
    C('CHAT_SEND', {
      conversation_id: direct,
      body: 'junk',
      mention_task_ids: ['not-a-uuid', id()]
    })
  ),
  'junk task ids'
);
assert.deepEqual(r.task_ids, [], 'unknown and malformed ids are dropped');

// The READER's visibility applies again on the way out.
read = await opread('tanya', {
  read_type: 'CHAT_MESSAGES',
  conversation_id: direct
});
const tagged = read.data.messages.find((m) => m.body === 'look at these');
assert.equal(tagged.tasks.length, 2, 'Tanya sees both tagged tasks');
assert.ok(
  tagged.tasks.every((t) => t.job_ref === job.job_ref),
  'each carries its job reference'
);

read = await opread('inst_a', {
  read_type: 'CHAT_MESSAGES',
  conversation_id: direct
});
const seenByInstaller = read.data.messages.find(
  (m) => m.body === 'look at these'
);
assert.deepEqual(
  seenByInstaller.tasks.map((t) => t.task_id),
  [theirs],
  "the installer sees only the task they may read, in somebody else's message"
);

console.log('t_chat: ok');
