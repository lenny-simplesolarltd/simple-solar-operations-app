// "View as user" - the HOSTED mechanism, at the database.
//
// Unlike supabase/dev/user_preview_hook.sql (a local-only hook that trusts a
// JWT claim), this one IS a migration and is what production would use. The
// request authenticates completely normally; an extra request header carries a
// proof that the DATABASE re-derives with a secret only it holds.
//
// These tests prove the four conditions in the migration, from both ends:
// through PostgREST (so the read-only-transaction rule is exercised for real)
// and directly in SQL (so each refusal can be isolated).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { API_URL, email, ensureLogin, person, service } from './helpers.mjs';
import { createClient } from '@supabase/supabase-js';

const workdir = process.env.SUPABASE_TEST_WORKDIR
  ? ['--workdir', process.env.SUPABASE_TEST_WORKDIR]
  : [];
const status = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env', ...workdir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v])
);

const SECRET = 'a-preview-only-signing-secret-for-tests-only';
const sql = (text) =>
  execFileSync(
    'psql',
    [status.DB_URL, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', text],
    {
      encoding: 'utf8'
    }
  ).trim();

/** Exactly what src/lib/preview/token.ts signPreviewHeader() produces. */
const proof = (sub, target, expiresAt = Date.now() + 120_000) =>
  `v1.${target}.${expiresAt}.${createHmac('sha256', SECRET)
    .update(`ss-preview:v1:${sub}:${target}:${expiresAt}`)
    .digest('hex')}`;

/** The developer's REAL session, plus the preview header. */
const previewing = (session, header) =>
  createClient(API_URL, status.ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'x-ss-dev-preview': header
      }
    },
    auth: { persistSession: false, autoRefreshToken: false }
  });

/** Resolves app.current_person_id() in SQL under simulated request settings. */
function resolveInSql({ sub, header, readOnly = true }) {
  const settings = [
    `set local request.jwt.claims = '${JSON.stringify({ sub })}'`,
    header
      ? `set local request.headers = '${JSON.stringify({ 'x-ss-dev-preview': header })}'`
      : `set local request.headers = '{}'`,
    readOnly ? 'set transaction read only' : null
  ].filter(Boolean);
  // One psql -c string is one transaction, and psql prints the LAST statement's
  // result - so the select must come last, with no explicit commit.
  return sql(
    `begin; ${settings.join('; ')}; select coalesce(app.current_person_id()::text, 'NOBODY');`
  );
}

let lenny, tanya, lennySession;

before(async () => {
  // The login must exist before the person is read: that is what links
  // people.auth_user_id to auth.users.
  await ensureLogin(email('lenny'));
  lenny = await person('PERSON-lenny-dev');
  tanya = await person('PERSON-tanya');
  assert.ok(lenny.auth_user_id, 'the developer fixture must have a login');

  // What an owner does by hand, once, to switch hosted preview on. The
  // migration deliberately leaves both empty.
  sql(
    `insert into app_preview.config (only_row, secret) values (true, '${SECRET}')
     on conflict (only_row) do update set secret = excluded.secret`
  );
  sql(
    `insert into app_preview.allowed_developers (auth_user_id, note)
     values ('${lenny.auth_user_id}', 'test') on conflict do nothing`
  );

  const client = createClient(API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: email('lenny'),
    password: 'local-test-password-1'
  });
  assert.ifError(error);
  lennySession = data.session;
});

after(async () => {
  // Leave the database as the migration leaves it: preview off. The role and
  // active flags are restored here too, so a failure mid-test cannot leave the
  // fixtures altered for the suites that follow.
  sql('delete from app_preview.config');
  sql('delete from app_preview.allowed_developers');
  await service
    .from('person_roles')
    .update({ active: true })
    .eq('person_id', lenny.id)
    .eq('role_code', 'Admin');
  await service.from('people').update({ active: true }).eq('id', tanya.id);
});

describe('the migration ships preview switched off', () => {
  test('the secret and the allow-list are not in the repository', () => {
    const migration = readFileSync(
      'supabase/migrations/20260920140000_dev_preview_hosted.sql',
      'utf8'
    );
    assert.doesNotMatch(migration, /insert into app_preview/i);
    assert.equal(sql('select count(*) from app_preview.config'), '1'); // only these tests put one there
  });

  test('neither table is readable or writable through the API', async () => {
    const anon = createClient(API_URL, status.ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { error } = await anon.from('config').select('secret');
    assert.ok(error, 'app_preview is not an exposed schema');
  });
});

describe('a valid preview resolves as the target, and only then', () => {
  test('the developer reads as Tanya, with her roles, not their own', async () => {
    const client = previewing(
      lennySession,
      proof(lenny.auth_user_id, tanya.id)
    );
    const { data, error } = await client.rpc('current_actor');
    assert.ifError(error);
    assert.deepEqual(
      [data[0].person_id, data[0].display_name, data[0].roles],
      [tanya.id, 'Tanya Harris', ['Office']]
    );
    // Office never sees the audit log; the developer's own Admin role does not leak.
    assert.deepEqual((await client.from('audit_events').select('id')).data, []);
  });

  test('without the header the very same session is the developer again', async () => {
    const client = createClient(API_URL, status.ANON_KEY, {
      global: {
        headers: { Authorization: `Bearer ${lennySession.access_token}` }
      },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data } = await client.rpc('current_actor');
    assert.equal(data[0].person_id, lenny.id);
  });
});

describe('a preview can never write', () => {
  test('a write carrying the header resolves to nobody, so RLS refuses it', async () => {
    const client = previewing(
      lennySession,
      proof(lenny.auth_user_id, tanya.id)
    );
    const { error } = await client.rpc('execute_command', {
      p_request: { command_id: randomUUID(), command_type: 'TASK_COMPLETE' }
    });
    assert.ok(error, 'a command under preview must not succeed');
  });

  test('identity resolves to nobody in a read-write transaction', () => {
    assert.equal(
      resolveInSql({
        sub: lenny.auth_user_id,
        header: proof(lenny.auth_user_id, tanya.id),
        readOnly: false
      }),
      'NOBODY'
    );
  });
});

describe('every condition fails closed - to NOBODY, never to the developer', () => {
  const forgeries = {
    'a tampered signature': () => {
      const good = proof(lenny.auth_user_id, tanya.id);
      // Flip the last hex digit to something it definitely is not.
      return good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
    },
    'a proof minted for another target': () => {
      const good = proof(lenny.auth_user_id, lenny.id).split('.');
      return `v1.${tanya.id}.${good[2]}.${good[3]}`;
    },
    'an expired proof': () =>
      proof(lenny.auth_user_id, tanya.id, Date.now() - 1000),
    'a stretched expiry': () => {
      const good = proof(lenny.auth_user_id, tanya.id).split('.');
      return `v1.${tanya.id}.${Number(good[2]) + 600_000}.${good[3]}`;
    },
    'a proof issued to a different developer': () =>
      proof(randomUUID(), tanya.id),
    'a hand-made proof with no signature': () =>
      `v1.${tanya.id}.${Date.now() + 1000}.`,
    'a proof naming a person who does not exist': () =>
      proof(lenny.auth_user_id, '11111111-1111-4111-8111-111111111111'),
    junk: () => 'not-a-proof'
  };

  for (const [name, build] of Object.entries(forgeries)) {
    test(`${name} resolves to nobody`, () => {
      assert.equal(
        resolveInSql({ sub: lenny.auth_user_id, header: build() }),
        'NOBODY'
      );
    });
  }

  test('a genuine proof from a developer who is not on the allow-list', () => {
    const header = proof(lenny.auth_user_id, tanya.id);
    sql(`delete from app_preview.allowed_developers`);
    assert.equal(resolveInSql({ sub: lenny.auth_user_id, header }), 'NOBODY');
    sql(
      `insert into app_preview.allowed_developers (auth_user_id) values ('${lenny.auth_user_id}')`
    );
    assert.equal(resolveInSql({ sub: lenny.auth_user_id, header }), tanya.id);
  });

  test('a genuine proof from an allow-listed developer who is not Admin', async () => {
    const header = proof(lenny.auth_user_id, tanya.id);
    await service
      .from('person_roles')
      .update({ active: false })
      .eq('person_id', lenny.id)
      .eq('role_code', 'Admin');
    assert.equal(resolveInSql({ sub: lenny.auth_user_id, header }), 'NOBODY');
    await service
      .from('person_roles')
      .update({ active: true })
      .eq('person_id', lenny.id)
      .eq('role_code', 'Admin');
    assert.equal(resolveInSql({ sub: lenny.auth_user_id, header }), tanya.id);
  });

  test('a genuine proof when the database holds no secret', () => {
    const header = proof(lenny.auth_user_id, tanya.id);
    sql('delete from app_preview.config');
    assert.equal(resolveInSql({ sub: lenny.auth_user_id, header }), 'NOBODY');
    sql(
      `insert into app_preview.config (only_row, secret) values (true, '${SECRET}')`
    );
  });

  test('a preview of an inactive person', async () => {
    await service.from('people').update({ active: false }).eq('id', tanya.id);
    assert.equal(
      resolveInSql({
        sub: lenny.auth_user_id,
        header: proof(lenny.auth_user_id, tanya.id)
      }),
      'NOBODY'
    );
    await service.from('people').update({ active: true }).eq('id', tanya.id);
  });
});

describe('the read paths a preview uses stay read-only-transaction safe', () => {
  // Hosted preview resolves only in a READ ONLY transaction. PostgREST gives one
  // to GET and to STABLE/IMMUTABLE rpc calls - so every RPC the preview data
  // client allows must be non-VOLATILE, or that read would silently return
  // nothing. Keep this list in step with READ_RPCS in src/lib/supabase/data.ts.
  const READ_RPCS = [
    'current_actor',
    'execute_read',
    'execute_operations_read',
    'describe_command_error',
    'describe_command_result',
    'list_evidence',
    'search_evidence',
    'cancellation_preview',
    'help_published_articles',
    'help_health'
  ];

  test('none of them is VOLATILE', () => {
    const rows = sql(
      `select p.proname || '=' || p.provolatile::text
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (${READ_RPCS.map((r) => `'${r}'`).join(',')})`
    ).split('\n');
    assert.equal(rows.length, READ_RPCS.length);
    for (const row of rows)
      assert.notEqual(row.split('=')[1], 'v', `${row} must not be VOLATILE`);
  });
});

describe('ordinary requests are completely unaffected', () => {
  test('no header: identity is still auth.uid() -> people', () => {
    assert.equal(resolveInSql({ sub: lenny.auth_user_id }), lenny.id);
    assert.equal(
      resolveInSql({ sub: lenny.auth_user_id, readOnly: false }),
      lenny.id
    );
    assert.equal(resolveInSql({ sub: randomUUID() }), 'NOBODY');
  });
});
