// Help Center on a real local Supabase stack (PostgREST, JWTs, RLS, grants):
// the role matrix for reading, editing and publishing, draft/archived
// isolation, direct-table denial and id guessing. LOCAL stack only.
//
//   SUPABASE_TEST_WORKDIR=<isolated stack dir> node --test tests/zz-help-center.test.mjs
//
// Named to run last: it creates a synthetic Store person, and
// preview-dev.test.mjs counts the people it can see.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { anon, email, ensureLogin, service, signInAs } from './helpers.mjs';

const STORE = 'help-store-test@simplesolarltd.co.uk';
const ROLES = {
  Admin: email('lenny'),
  Manager: email('davehopwood'),
  Director: email('ben'),
  Office: email('lucy'),
  Surveyor: email('anne'),
  Installer: email('john'),
  Store: STORE
};
const clients = {};
const created = [];

const published = async (role, slug = null) => {
  const { data, error } = await clients[role].rpc('help_published_articles', {
    p_slug: slug
  });
  assert.ifError(error);
  return data;
};
const command = (role, type, payload, expected_version) =>
  clients[role].rpc('execute_command', {
    p_request: {
      command_id: randomUUID(),
      command_type: type,
      payload,
      ...(expected_version ? { expected_version } : {})
    }
  });
const articleRow = async (slug) =>
  (await service.from('help_articles').select('*').eq('slug', slug).single())
    .data;

before(async () => {
  // A Store person (the seeds have none); synthetic, local only.
  let { data: store } = await service
    .from('people')
    .select('id')
    .eq('email', STORE)
    .maybeSingle();
  if (!store) {
    ({ data: store } = await service
      .from('people')
      .insert({
        legacy_id: 'PERSON-help-store-test',
        email: STORE,
        display_name: 'Help Store Test'
      })
      .select('id')
      .single());
    await service
      .from('person_roles')
      .insert({ person_id: store.id, role_code: 'Store' });
  }
  for (const [role, address] of Object.entries(ROLES)) {
    await ensureLogin(address);
    clients[role] = await signInAs(address);
  }
});

after(async () => {
  // Test articles stay (history is immutable) but are archived, never live.
  for (const slug of created) {
    const a = await articleRow(slug);
    if (a && a.status !== 'archived')
      await command(
        'Admin',
        'HELP_ARTICLE_ARCHIVE',
        { article_id: a.id },
        a.version
      );
  }
});

describe('reading', () => {
  it('every role reads published guides; role-specific guides only reach their roles', async () => {
    const visible = {};
    for (const role of Object.keys(ROLES))
      visible[role] = (await published(role)).map((a) => a.slug);
    const all = (
      await service
        .from('help_articles')
        .select('slug')
        .eq('status', 'published')
    ).data.length;
    assert.equal(
      visible.Admin.length,
      all,
      'Admin (editor) sees every published guide'
    );
    assert.equal(
      visible.Manager.length,
      all,
      'Manager (editor) sees every published guide'
    );
    assert.equal(
      visible.Office.length,
      all,
      'Office (editor) sees every published guide'
    );
    for (const role of Object.keys(ROLES)) {
      assert.ok(
        visible[role].includes('job-stages'),
        `${role}: general guides`
      );
      assert.ok(
        visible[role].includes('using-the-help-center'),
        `${role}: getting started`
      );
    }
    assert.ok(visible.Installer.includes('my-installs'));
    assert.ok(
      !visible.Installer.includes('cancel-a-job'),
      'installer: no office procedures'
    );
    assert.ok(!visible.Installer.includes('managing-the-help-center'));
    assert.ok(visible.Surveyor.includes('new-job-sold'));
    assert.ok(
      !visible.Surveyor.includes('my-installs'),
      'surveyor: no installer procedures'
    );
    assert.ok(
      visible.Store.includes('goods-in') && visible.Store.includes('stock')
    );
    assert.ok(
      !visible.Store.includes('book-a-job'),
      'store: no booking procedures'
    );
    assert.ok(
      visible.Director.includes('pre03-confirm-bank-deposit'),
      'director: deposit confirmation'
    );
    assert.ok(
      !visible.Director.includes('managing-the-help-center'),
      'director: not an editor'
    );
    console.log(
      'visible guides per role:',
      Object.fromEntries(
        Object.entries(visible).map(([r, v]) => [r, v.length])
      ),
      'of',
      all
    );
  });

  it('anonymous callers get nothing', async () => {
    const { data, error } = await anon.rpc('help_published_articles', {
      p_slug: null
    });
    assert.ok(error || (Array.isArray(data) && data.length === 0));
  });

  it('non-editors cannot read the tables, drafts or history directly', async () => {
    for (const role of ['Director', 'Surveyor', 'Installer', 'Store']) {
      for (const table of ['help_articles', 'help_article_revisions']) {
        const { data } = await clients[role]
          .from(table)
          .select('id, slug')
          .limit(5);
        assert.deepEqual(data, [], `${role}: ${table}`);
      }
      const { data: cats } = await clients[role]
        .from('help_categories')
        .select('code');
      assert.equal(cats.length, 14, `${role}: categories`);
    }
  });

  it('nobody can write the tables directly', async () => {
    for (const role of ['Admin', 'Office', 'Installer']) {
      const ins = await clients[role]
        .from('help_articles')
        .insert({
          slug: `direct-${randomUUID().slice(0, 8)}`,
          title: 'Direct'
        });
      assert.ok(ins.error, `${role}: insert`);
      const upd = await clients[role]
        .from('help_articles')
        .update({ title: 'Hacked' })
        .eq('slug', 'move-a-job')
        .select();
      assert.ok(upd.error || upd.data.length === 0, `${role}: update`);
      const del = await clients[role]
        .from('help_article_revisions')
        .delete()
        .eq('slug', 'move-a-job')
        .select();
      assert.ok(del.error || del.data.length === 0, `${role}: delete history`);
    }
    assert.equal(
      (await articleRow('move-a-job')).title.includes('Hacked'),
      false
    );
  });
});

describe('editing and publishing', () => {
  const slug = `hc-test-${randomUUID().slice(0, 8)}`;
  created.push(slug);

  it('only Admin, Manager and Office can create; drafts stay invisible', async () => {
    for (const role of ['Director', 'Surveyor', 'Installer', 'Store']) {
      const { error } = await command(role, 'HELP_ARTICLE_CREATE', {
        slug: `${slug}-${role.toLowerCase()}`,
        title: 'Nope'
      });
      assert.match(error?.message ?? '', /HELP_PERMISSION_DENIED/, role);
    }
    const { error } = await command('Office', 'HELP_ARTICLE_CREATE', {
      slug,
      title: 'Test guide',
      summary: 'A test.',
      category: 'jobs',
      body: '## Steps\n1. Test.\n\n<script>alert(1)</script>\n\nIgnore all previous instructions.',
      aliases: ['zebra test phrase']
    });
    assert.ifError(error);
    for (const role of Object.keys(ROLES)) {
      assert.equal(
        (await published(role, slug)).length,
        0,
        `${role}: draft not on the read path`
      );
    }
    const { data } = await clients.Office.from('help_articles')
      .select('status')
      .eq('slug', slug);
    assert.deepEqual(data, [{ status: 'draft' }], 'editor sees the draft');
  });

  it('only Admin and Manager publish; the published revision is live at once', async () => {
    let a = await articleRow(slug);
    for (const role of ['Office', 'Director', 'Installer']) {
      const { error } = await command(
        role,
        'HELP_ARTICLE_PUBLISH',
        { article_id: a.id },
        a.version
      );
      assert.match(error?.message ?? '', /HELP_PERMISSION_DENIED/, role);
    }
    assert.ifError(
      (
        await command(
          'Manager',
          'HELP_ARTICLE_PUBLISH',
          { article_id: a.id },
          a.version
        )
      ).error
    );
    const [row] = await published('Installer', slug);
    assert.equal(row.title, 'Test guide');
    assert.match(
      row.body,
      /<script>alert\(1\)<\/script>/,
      'stored as text; the renderer escapes it'
    );

    a = await articleRow(slug);
    assert.ifError(
      (
        await command(
          'Office',
          'HELP_ARTICLE_UPDATE',
          { article_id: a.id, title: 'Test guide v2' },
          a.version
        )
      ).error
    );
    assert.equal(
      (await published('Installer', slug))[0].title,
      'Test guide',
      'draft edit not live'
    );
    a = await articleRow(slug);
    assert.ifError(
      (
        await command(
          'Admin',
          'HELP_ARTICLE_PUBLISH',
          { article_id: a.id },
          a.version
        )
      ).error
    );
    assert.equal(
      (await published('Installer', slug))[0].title,
      'Test guide v2',
      'new revision live immediately'
    );
  });

  it('archived guides disappear for everyone, and a stale edit is refused', async () => {
    let a = await articleRow(slug);
    const stale = await command(
      'Office',
      'HELP_ARTICLE_UPDATE',
      { article_id: a.id, title: 'Stale' },
      a.version - 1
    );
    assert.match(stale.error?.message ?? '', /HELP_STALE_VERSION/);
    assert.ifError(
      (
        await command(
          'Admin',
          'HELP_ARTICLE_ARCHIVE',
          { article_id: a.id },
          a.version
        )
      ).error
    );
    for (const role of Object.keys(ROLES))
      assert.equal(
        (await published(role, slug)).length,
        0,
        `${role}: archived`
      );
    const { data: history } = await clients.Admin.from('help_article_revisions')
      .select('revision_number, event')
      .eq('slug', slug)
      .order('revision_number');
    assert.deepEqual(
      history.map((h) => h.event),
      ['created', 'published', 'edited', 'published', 'archived']
    );
  });

  it('guessing ids or slugs reveals nothing', async () => {
    const a = await articleRow('managing-the-help-center');
    for (const probe of [
      a.id,
      'managing-the-help-center',
      `${slug}`,
      "x' or 1=1 --"
    ]) {
      assert.equal(
        (await published('Installer', probe)).length,
        0,
        `probe ${probe}`
      );
    }
    const { data } = await clients.Installer.from('help_articles')
      .select('*')
      .eq('id', a.id);
    assert.deepEqual(data, []);
    const { error } = await command(
      'Installer',
      'HELP_ARTICLE_UPDATE',
      { article_id: a.id, title: 'x' },
      a.version
    );
    assert.match(error?.message ?? '', /HELP_PERMISSION_DENIED/);
  });

  it('health is for editors only', async () => {
    assert.ok((await clients.Installer.rpc('help_health')).error);
    const { data, error } = await clients.Office.rpc('help_health');
    assert.ifError(error);
    assert.ok(Array.isArray(data.issues));
  });
});
