// Help Center: article lifecycle, revision history, who may read / edit /
// publish, audience and release filtering on the staff (and SimpleBot) read
// path, history immutability and the seed-preservation rules.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setup } from './fixtures.mjs';

// Every category the app knows about has to exist in the database, or a
// category page renders empty. Read from the code rather than pinned to a
// number, so adding one (Programmes) fails here if its seed is missing.
const CATEGORY_CODES = Array.from(
  fs
    .readFileSync(
      fileURLToPath(new URL('../../src/features/help/types.ts', import.meta.url)),
      'utf8'
    )
    .match(/HELP_CATEGORY_CODES = \[([^\]]*)\]/)[1]
    .matchAll(/'([a-z-]+)'/g),
  (m) => m[1]
);
const f = await setup();
const { db, one, all, people, cmd, id, ok, as } = f;

// A Manager (fixtures have none).
const mgr = (
  await one(
    `insert into public.people (legacy_id, email, display_name) values ('PERSON-mgr','mgr@test.local','Mia Manager') returning id`
  )
).id;
await db.query(
  `insert into public.person_roles (person_id, role_code) values ($1,'Manager')`,
  [mgr]
);
const mgrUid = (await one(`select gen_random_uuid() u`)).u;
await db.query(
  `insert into auth.users (id, email, email_confirmed_at) values ($1,'mgr@test.local',now())`,
  [mgrUid]
);
f.users.mgr = mgrUid;

const published = async (who, slug = null) => {
  await as(who);
  return all(`select * from public.help_published_articles($1)`, [slug]);
};
const article = (slug) =>
  one(`select * from public.help_articles where slug=$1`, [slug]);
const history = async (articleId) =>
  await all(
    `select revision_number, event, status, title from public.help_article_revisions where article_id=$1 order by revision_number`,
    [articleId]
  );
const create = (who, payload) =>
  cmd(who, { command_id: id(), command_type: 'HELP_ARTICLE_CREATE', payload });
const act = (who, type, a, payload = {}) =>
  cmd(who, {
    command_id: id(),
    command_type: type,
    expected_version: a.version,
    payload: { article_id: a.id, ...payload }
  });

const base = {
  slug: 't-move',
  title: 'How to move a job',
  summary: 'Change the installation dates of a booked job.',
  body: '## Steps\n1. Open the job.\n2. Choose **Move job**.',
  category: 'booking',
  aliases: ['Move Job', 'reschedule', 'reschedule'],
  keywords: ['dates'],
  routes: ['/dashboard/jobs/[jobId]/move'],
  tools: ['find_job'],
  release_functions: ['FN-07', 'FN-01'],
  related_slugs: ['no-such-guide']
};

// ---- create: editors only ----------------------------------------------------------
for (const who of ['sam', 'inst_a', 'dan', 'store']) {
  const r = await create(who, { ...base, slug: `x-${who}` });
  assert.equal(r.error, 'HELP_PERMISSION_DENIED', `${who} must not create`);
}
const created = ok(await create('tanya', base), 'office creates a draft');
assert.equal(created.status, 'draft');
let a = await article('t-move');
assert.deepEqual(
  a.aliases,
  ['move job', 'reschedule'],
  'aliases trimmed, lower-cased, de-duplicated'
);
assert.equal((await create('tanya', base)).error, 'HELP_SLUG_TAKEN');
assert.equal(
  (await create('tanya', { ...base, slug: 'Bad Slug!' })).error,
  'HELP_INVALID_SLUG'
);
assert.equal(
  (await create('tanya', { ...base, slug: 'ok-slug', category: 'nope' })).error,
  'HELP_INVALID_CATEGORY'
);
assert.equal(
  (
    await create('tanya', {
      ...base,
      slug: 'ok-slug',
      routes: ['javascript:alert(1)']
    })
  ).error,
  'HELP_INVALID_ROUTES'
);
assert.equal(
  (
    await create('tanya', {
      ...base,
      slug: 'ok-slug',
      audience_roles: ['Wizard']
    })
  ).error,
  'HELP_INVALID_AUDIENCE_ROLES'
);
assert.equal(
  (await create('tanya', { ...base, slug: 'ok-slug', tools: ['DROP TABLE'] }))
    .error,
  'HELP_INVALID_TOOLS'
);
assert.equal(
  (await create('tanya', { ...base, slug: 'ok-slug', body: 'x'.repeat(20001) }))
    .error,
  'HELP_INVALID_BODY'
);
assert.equal(
  (await create('tanya', { ...base, slug: 'ok-slug', unknown: 1 })).error,
  'R1A_INVALID_FIELDS'
);

// ---- drafts are invisible outside the editor path -----------------------------------
for (const who of ['sam', 'inst_a', 'dan', 'store', 'tanya', 'ben']) {
  assert.equal(
    (await published(who, 't-move')).length,
    0,
    `${who}: a draft is never on the read path`
  );
}
const asClient = async (who, fn) => {
  await as(who);
  await db.query('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.query('reset role');
  }
};
for (const who of ['sam', 'inst_a', 'dan', 'store']) {
  await asClient(who, async () => {
    assert.equal(
      (await all(`select * from public.help_articles`)).length,
      0,
      `${who}: no direct table read`
    );
    assert.equal(
      (await all(`select * from public.help_article_revisions`)).length,
      0,
      `${who}: no history read`
    );
    const categories = await all(`select code from public.help_categories`);
    assert.deepEqual(
      categories.map((c) => c.code).sort(),
      [...CATEGORY_CODES].sort(),
      `${who}: every category readable`
    );
  });
}
await asClient('tanya', async () => {
  assert.equal(
    (await all(`select * from public.help_articles where status='draft'`))
      .length,
    1,
    'editor sees drafts'
  );
  assert.ok(
    (await all(`select * from public.help_article_revisions`)).length > 80,
    'editor sees history'
  );
});
await asClient('sam', async () => {
  assert.ok(
    (await all(`select * from public.help_published_articles()`)).length > 0,
    'client role may call the read path'
  );
});
await as(null);
assert.equal(
  (await all(`select * from public.help_published_articles()`)).length,
  0,
  'anonymous: nothing'
);

// ---- the seeded standard articles ------------------------------------------------------
{
  // Every standard article, at whatever seed version the latest seed migration
  // brought it to (untouched articles follow newer seeds).
  const seeded = await all(
    `select * from public.help_articles where seed_version is not null`
  );
  assert.ok(seeded.length >= 40, `seeded ${seeded.length}`);
  assert.ok(
    seeded.some((a) => a.seed_version >= 2 && a.slug === 'issues-queue'),
    'seed v2 articles installed'
  );
  assert.ok(
    seeded.every(
      (a) => a.status === 'published' && a.created_by === null && a.category
    )
  );
  const everyone = (await published('ben')).length;
  const installer = (await published('inst_a')).map((r) => r.slug);
  const surveyor = (await published('sam')).map((r) => r.slug);
  assert.equal(
    everyone,
    seeded.length,
    'an editor reads every published article'
  );
  assert.ok(
    installer.includes('my-installs') && !installer.includes('cancel-a-job'),
    'installer sees installer guides, not office ones'
  );
  assert.ok(
    surveyor.includes('new-job-sold') && !surveyor.includes('my-installs'),
    'surveyor sees sales guides, not installer ones'
  );
  for (const who of ['inst_a', 'sam', 'store', 'dan']) {
    assert.ok(
      (await published(who)).some((r) => r.slug === 'job-stages'),
      `${who}: general guides are for everyone`
    );
  }
  // Re-running a seed migration (the old one or the newest) is a no-op.
  const fs = await import('node:fs');
  const before = (
    await one(`select count(*)::int n from public.help_article_revisions`)
  ).n;
  await as(null);
  for (const f of [
    '20260920100100_help_center_seed.sql',
    '20260920130000_help_center_seed_v2.sql'
  ])
    await db.exec(
      fs.readFileSync(
        new URL(`../../supabase/migrations/${f}`, import.meta.url),
        'utf8'
      )
    );
  assert.equal(
    (await one(`select count(*)::int n from public.help_article_revisions`)).n,
    before,
    'seed re-run changes nothing'
  );
}

// ---- no direct writes ---------------------------------------------------------------
for (const who of ['ben', 'tanya']) {
  await as(who);
  await db.query('set role authenticated');
  for (const sql of [
    `update public.help_articles set title='hacked'`,
    `insert into public.help_articles (slug, title) values ('direct','Direct write')`,
    `delete from public.help_article_revisions`
  ]) {
    await assert.rejects(db.query(sql), /permission denied/, `${who}: ${sql}`);
  }
  await db.query('reset role');
}

// ---- publish: Admin / Manager only ----------------------------------------------------
assert.equal(
  (await act('tanya', 'HELP_ARTICLE_PUBLISH', a)).error,
  'HELP_PERMISSION_DENIED',
  'office cannot publish'
);
assert.equal(
  (await act('dan', 'HELP_ARTICLE_PUBLISH', a)).error,
  'HELP_PERMISSION_DENIED',
  'director cannot publish'
);
ok(
  await act('mgr', 'HELP_ARTICLE_PUBLISH', a, { change_note: 'First version' }),
  'manager publishes'
);
a = await article('t-move');
assert.equal(a.status, 'published');
assert.equal(a.has_unpublished_changes, false);
assert.ok(
  a.reviewed_at && a.review_due_at > a.reviewed_at,
  'publishing counts as a review'
);
assert.equal(
  (await act('mgr', 'HELP_ARTICLE_PUBLISH', a)).error,
  'HELP_NO_CHANGES'
);
assert.equal(
  (await act('mgr', 'HELP_ARTICLE_PUBLISH', { ...a, version: a.version - 1 }))
    .error,
  'HELP_STALE_VERSION'
);

for (const who of ['sam', 'inst_a', 'dan', 'store', 'tanya']) {
  const rows = await published(who, 't-move');
  assert.equal(rows.length, 1, `${who} reads the published article`);
  assert.equal(rows[0].title, 'How to move a job');
  assert.equal(rows[0].body.startsWith('## Steps'), true);
}

// ---- editing keeps staff on the published revision -------------------------------------
ok(
  await act('tanya', 'HELP_ARTICLE_UPDATE', a, {
    title: 'How to move a job (new)',
    body: 'New steps'
  }),
  'office edits'
);
a = await article('t-move');
assert.equal(a.has_unpublished_changes, true);
assert.equal(
  (await published('sam', 't-move'))[0].title,
  'How to move a job',
  'staff still read the published revision'
);
assert.equal(
  (await act('tanya', 'HELP_ARTICLE_UPDATE', a, { slug: 'moved' })).error,
  'HELP_SLUG_FIXED'
);
ok(await act('ben', 'HELP_ARTICLE_PUBLISH', a), 'admin publishes the edit');
a = await article('t-move');
assert.equal(
  (await published('sam', 't-move'))[0].title,
  'How to move a job (new)',
  'new revision is live at once'
);

// Editing back to the published content clears the pending flag.
ok(
  await act('tanya', 'HELP_ARTICLE_UPDATE', a, { body: 'Draft only' }),
  'edit'
);
a = await article('t-move');
ok(
  await act('tanya', 'HELP_ARTICLE_UPDATE', a, { body: 'New steps' }),
  'edit back'
);
a = await article('t-move');
assert.equal(a.has_unpublished_changes, false);

// ---- revert an old revision into the draft ------------------------------------------------
ok(
  await act('tanya', 'HELP_ARTICLE_REVERT', a, { revision_number: 1 }),
  'revert to revision 1'
);
a = await article('t-move');
assert.equal(a.title, 'How to move a job');
assert.equal(a.has_unpublished_changes, true);
assert.equal(
  (await published('sam', 't-move'))[0].title,
  'How to move a job (new)',
  'revert is a draft change only'
);
assert.equal(
  (await act('tanya', 'HELP_ARTICLE_REVERT', a, { revision_number: 99 })).error,
  'HELP_REVISION_NOT_FOUND'
);

// ---- review --------------------------------------------------------------------------------
assert.equal(
  (await act('tanya', 'HELP_ARTICLE_REVIEW', a)).error,
  'HELP_PERMISSION_DENIED'
);
ok(
  await act('ben', 'HELP_ARTICLE_REVIEW', a, {
    change_note: 'Checked against the app'
  }),
  'admin marks reviewed'
);
a = await article('t-move');
assert.equal(a.reviewed_by, people.ben);

// ---- archive / restore -------------------------------------------------------------------------
assert.equal(
  (await act('tanya', 'HELP_ARTICLE_ARCHIVE', a)).error,
  'HELP_PERMISSION_DENIED'
);
ok(await act('ben', 'HELP_ARTICLE_ARCHIVE', a), 'archive');
a = await article('t-move');
for (const who of ['sam', 'ben', 'tanya']) {
  assert.equal(
    (await published(who, 't-move')).length,
    0,
    `${who}: archived is never on the read path`
  );
}
assert.equal(
  (await act('tanya', 'HELP_ARTICLE_UPDATE', a, { body: 'x' })).error,
  'HELP_ARCHIVED'
);
ok(await act('ben', 'HELP_ARTICLE_RESTORE', a), 'restore');
a = await article('t-move');
assert.equal(a.status, 'published');
assert.equal(
  (await published('sam', 't-move'))[0].title,
  'How to move a job (new)',
  'restored to its last published revision'
);

// ---- history -----------------------------------------------------------------------------------------
const h = await history(a.id);
assert.deepEqual(
  h.map((r) => r.event),
  [
    'created',
    'published',
    'edited',
    'published',
    'edited',
    'edited',
    'reverted',
    'reviewed',
    'archived',
    'restored'
  ]
);
assert.deepEqual(
  h.map((r) => r.revision_number),
  h.map((_, i) => i + 1)
);
await assert.rejects(
  db.query(`update public.help_article_revisions set title='x'`),
  /HELP_HISTORY_IMMUTABLE/
);
await assert.rejects(
  db.query(`delete from public.help_article_revisions`),
  /HELP_HISTORY_IMMUTABLE|foreign key/
);
const audit = await all(
  `select action from public.audit_events where entity_type='help_article' and entity_id=$1 order by occurred_at, id`,
  [a.id]
);
assert.ok(audit.length >= 9, 'every change is audited');

// ---- idempotent retry -------------------------------------------------------------------------------
{
  const req = {
    command_id: id(),
    command_type: 'HELP_ARTICLE_CREATE',
    payload: { ...base, slug: 'retry-me', related_slugs: [] }
  };
  const first = await cmd('tanya', req);
  const again = await cmd('tanya', req);
  assert.equal(again.replayed, true);
  assert.equal(again.result.article_id, first.result.article_id);
  assert.equal(
    (
      await one(
        `select count(*)::int n from public.help_articles where slug='retry-me'`
      )
    ).n,
    1
  );
}

// ---- audience -----------------------------------------------------------------------------------------
ok(
  await create('ben', {
    slug: 'installer-only',
    title: 'Installer only guide',
    summary: 's',
    body: 'b',
    category: 'installation',
    audience_roles: ['Installer']
  }),
  'c'
);
let io = await article('installer-only');
ok(await act('ben', 'HELP_ARTICLE_PUBLISH', io), 'p');
assert.equal(
  (await published('inst_a', 'installer-only')).length,
  1,
  'installer reads it'
);
assert.equal(
  (await published('sam', 'installer-only')).length,
  0,
  'surveyor cannot read it, even by slug'
);
assert.equal(
  (await published('store', 'installer-only')).length,
  0,
  'store cannot read it'
);
assert.equal(
  (await published('ben', 'installer-only')).length,
  1,
  'editors read everything'
);
// The PUBLISHED audience governs, not a draft change.
io = await article('installer-only');
ok(
  await act('ben', 'HELP_ARTICLE_UPDATE', io, { audience_roles: [] }),
  'draft widens audience'
);
assert.equal(
  (await published('sam', 'installer-only')).length,
  0,
  'draft audience change is not live'
);

// Inactive staff read nothing.
await db.query(`update public.people set active=false where id=$1`, [
  people.sam
]);
assert.equal(
  (await published('sam')).length,
  0,
  'inactive person reads nothing'
);
await db.query(`update public.people set active=true where id=$1`, [
  people.sam
]);

// ---- release awareness ------------------------------------------------------------------------------------
await db.query(
  `update public.release_modes set mode='Disabled' where function_id='FN-07'`
);
assert.equal(
  (await published('sam', 't-move'))[0].release_on,
  false,
  'switched off'
);
await db.query(
  `update public.release_modes set mode='Manual', authorised_job_scope='Pilot' where function_id='FN-07'`
);
await db.query(
  `update public.release_modes set mode='Disabled' where function_id='FN-01'`
);
assert.equal(
  (await published('sam', 't-move'))[0].release_on,
  false,
  'off while ANY listed function is off'
);
await db.query(
  `update public.release_modes set mode='Automated', authorised_job_scope='All' where function_id='FN-01'`
);
assert.equal(
  (await published('sam', 't-move'))[0].release_on,
  true,
  'switched on when all are on'
);
assert.equal(
  (await published('sam', 't-move'))[0].release_names.length,
  2,
  'release names are reported'
);
assert.equal(
  (await published('inst_a', 'installer-only'))[0].release_on,
  true,
  'no release functions = always on'
);

// ---- health -----------------------------------------------------------------------------------------------
await as('sam');
await assert.rejects(
  db.query(`select public.help_health()`),
  /HELP_PERMISSION_DENIED/
);
await as('tanya');
const health = (await one(`select public.help_health() h`)).h;
const codes = health.issues.map((i) => `${i.slug}:${i.code}`);
assert.ok(
  codes.includes('t-move:BROKEN_RELATED_LINK'),
  'related no-such-guide does not exist'
);
assert.ok(codes.includes('installer-only:UNPUBLISHED_CHANGES'));
assert.ok(health.release_functions.includes('FN-21'));
await db.query(
  `update public.help_articles set review_due_at = now() - interval '1 day' where slug='installer-only'`
);
assert.ok(
  (await one(`select public.help_health() h`)).h.issues.some(
    (i) => i.slug === 'installer-only' && i.code === 'REVIEW_OVERDUE'
  )
);

// ---- seed preservation -----------------------------------------------------------------------------------------
await as(null);
const seed = (v, over = {}) =>
  one(`select app.help_seed_article($1::jsonb, $2) r`, [
    JSON.stringify({
      slug: 'seeded-guide',
      title: `Seeded guide v${v}`,
      summary: 'Seed',
      body: `Body v${v}`,
      category: 'jobs',
      ...over
    }),
    v
  ]);
assert.equal((await seed(1)).r, 'created');
let s = await article('seeded-guide');
assert.equal(s.status, 'published');
assert.equal(s.seed_version, 1);
assert.equal(s.created_by, null);
assert.equal(
  (await seed(1)).r,
  'unchanged',
  're-running the same seed is a no-op'
);
assert.equal(
  (await seed(2)).r,
  'updated',
  'untouched seed content may be updated by a newer seed'
);
assert.equal(
  (await published('sam', 'seeded-guide'))[0].title,
  'Seeded guide v2'
);
// Staff edit and publish -> later seeds never overwrite it.
s = await article('seeded-guide');
ok(
  await act('tanya', 'HELP_ARTICLE_UPDATE', s, { body: 'Our own words' }),
  'staff edit'
);
s = await article('seeded-guide');
assert.equal(
  (await seed(3)).r,
  'flagged',
  'pending staff draft: seed not applied'
);
s = await article('seeded-guide');
ok(await act('ben', 'HELP_ARTICLE_PUBLISH', s), 'staff publish');
s = await article('seeded-guide');
assert.equal(s.seed_version, null);
assert.equal(
  s.seed_update_available,
  3,
  'the skipped seed stays flagged after staff publish'
);
assert.equal((await seed(4)).r, 'flagged');
assert.equal(
  (await published('sam', 'seeded-guide'))[0].body,
  'Our own words',
  'staff content kept'
);
assert.equal((await article('seeded-guide')).seed_update_available, 4);
// Seeding never touches another article.
assert.equal(
  (await published('sam', 't-move'))[0].title,
  'How to move a job (new)'
);

console.log('help center: ok');
