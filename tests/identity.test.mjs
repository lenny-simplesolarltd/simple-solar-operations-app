// Integration tests for the identity foundation.
//
// Runs against the LOCAL Supabase stack only (`npm run test:db` resets it
// first). Every assertion goes through the real path:
//   Supabase Auth session -> auth.uid() -> people -> person_roles -> RLS.
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, test } from 'node:test';

const env = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value])
);

const API_URL = env.API_URL;
assert.match(
  API_URL ?? '',
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  'identity tests only run against the local Supabase stack'
);

const PASSWORD = 'local-test-password-1';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(API_URL, env.SERVICE_ROLE_KEY, options);
const anon = createClient(API_URL, env.ANON_KEY, options);

async function createLogin(email, { confirmed = true } = {}) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: confirmed
  });
  assert.ifError(error);
  return data.user;
}

async function signInAs(email) {
  const client = createClient(API_URL, env.ANON_KEY, options);
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD
  });
  assert.ifError(error);
  return client;
}

async function person(legacyId) {
  const { data, error } = await service
    .from('people')
    .select('*')
    .eq('legacy_id', legacyId)
    .single();
  assert.ifError(error);
  return data;
}

const email = (name) => `${name}@simplesolarltd.co.uk`;

let mike, hannah, lenny, tanya, stranger;

before(async () => {
  await createLogin(email('mike'));
  await createLogin(email('hannah'));
  await createLogin(email('lenny'));
  await createLogin(email('tanya'));
  await createLogin('stranger@example.com');
  mike = await signInAs(email('mike'));
  hannah = await signInAs(email('hannah'));
  lenny = await signInAs(email('lenny'));
  tanya = await signInAs(email('tanya'));
  stranger = await signInAs('stranger@example.com');
});

describe('seed', () => {
  test('imports the 22 genuine people and no fixtures', async () => {
    const { data } = await service.from('people').select('legacy_id, email');
    assert.equal(data.length, 22);
    for (const row of data) {
      assert.doesNotMatch(row.email, /example\.invalid|NOT_CONFIGURED/);
      assert.doesNotMatch(
        row.legacy_id,
        /-s1\d-|-rp-|installer-[ab]|store|scaffolder/
      );
    }
  });

  test('roles come from PersonRoles; Hannah holds two', async () => {
    const { data } = await service
      .from('person_roles')
      .select('role_code, people!person_roles_person_id_fkey(legacy_id)')
      .eq('active', true);
    assert.equal(data.length, 22);
    // The shared info@ mailbox is a contact identity, not an administrator.
    assert.ok(!data.some((r) => r.people.legacy_id === 'PERSON-info'));
    const hannahRoles = data
      .filter((r) => r.people.legacy_id === 'PERSON-hannah')
      .map((r) => r.role_code)
      .sort();
    assert.deepEqual(hannahRoles, ['Office', 'VariationApprover']);
    // The smoke-test Admin grant on Tanya was not imported.
    const tanyaRoles = data.filter(
      (r) => r.people.legacy_id === 'PERSON-tanya'
    );
    assert.deepEqual(
      tanyaRoles.map((r) => r.role_code),
      ['Office']
    );
  });

  test('nine installer skills, level defaulted to Member', async () => {
    const { data } = await service
      .from('person_skills')
      .select('skill_code, level');
    assert.equal(data.length, 9);
    assert.ok(data.every((s) => s.level === 'Member'));
    assert.equal(data.filter((s) => s.skill_code === 'Roof').length, 3);
  });

  test('seeding creates no logins: people exist without auth accounts', async () => {
    const john = await person('PERSON-john-doyle');
    assert.equal(john.auth_user_id, null);
    assert.equal(john.active, true);
    const { data } = await service
      .from('people')
      .select('id')
      .not('auth_user_id', 'is', null);
    assert.equal(data.length, 4); // only the four logins created by this file
  });
});

describe('auth -> person mapping', () => {
  test('a verified login maps to the right person and roles', async () => {
    const { data, error } = await mike.rpc('current_actor');
    assert.ifError(error);
    assert.equal(data.length, 1);
    assert.equal(data[0].display_name, 'Mike Bater');
    assert.equal(data[0].person_id, (await person('PERSON-mike')).id);
    assert.deepEqual(data[0].roles, ['Surveyor']);
  });

  test('multiple roles are all returned', async () => {
    const { data } = await hannah.rpc('current_actor');
    assert.deepEqual(data[0].roles, ['Office', 'VariationApprover']);
  });

  test('an unverified email never links; verifying it does', async () => {
    const user = await createLogin(email('anne'), { confirmed: false });
    assert.equal((await person('PERSON-anne')).auth_user_id, null);
    const { error } = await service.auth.admin.updateUserById(user.id, {
      email_confirm: true
    });
    assert.ifError(error);
    assert.equal((await person('PERSON-anne')).auth_user_id, user.id);
  });

  test('a login with no matching person is nobody', async () => {
    const { data } = await stranger.rpc('current_actor');
    assert.deepEqual(data, []);
  });

  test('one login cannot be attached to two people', async () => {
    const mikeRow = await person('PERSON-mike');
    const { error } = await service
      .from('people')
      .update({ auth_user_id: mikeRow.auth_user_id })
      .eq('legacy_id', 'PERSON-rick');
    assert.equal(error?.code, '23505');
  });
});

describe('RLS is fail-closed', () => {
  const tables = [
    'people',
    'person_roles',
    'person_skills',
    'roles',
    'skills',
    'audit_events'
  ];

  test('anonymous callers get nothing', async () => {
    for (const table of tables) {
      const { data, error } = await anon.from(table).select('*');
      assert.ok(error || data.length === 0, `${table} leaked to anon`);
    }
    const { data, error } = await anon.rpc('current_actor');
    assert.ok(error || data.length === 0);
  });

  test('an authenticated login that is not a person sees nothing', async () => {
    for (const table of tables) {
      const { data, error } = await stranger.from(table).select('*');
      assert.ok(
        error || data.length === 0,
        `${table} leaked to unmapped login`
      );
    }
  });

  test('a surveyor sees only their own person and role rows', async () => {
    const people = await mike.from('people').select('legacy_id');
    assert.deepEqual(people.data, [{ legacy_id: 'PERSON-mike' }]);
    const roles = await mike.from('person_roles').select('role_code');
    assert.deepEqual(roles.data, [{ role_code: 'Surveyor' }]);
    const audit = await mike.from('audit_events').select('id');
    assert.deepEqual(audit.data, []);
  });

  test('office-class staff see the whole directory but not the audit log', async () => {
    const people = await hannah.from('people').select('id');
    assert.equal(people.data.length, 22);
    const audit = await hannah.from('audit_events').select('id');
    assert.deepEqual(audit.data, []);
  });
});

describe('nobody can grant themselves a role', () => {
  test('insert, re-point and reactivate are all refused for non-admins', async () => {
    const mikeRow = await person('PERSON-mike');
    for (const client of [mike, hannah]) {
      const self = client === mike ? mikeRow : await person('PERSON-hannah');
      const grant = await client
        .from('person_roles')
        .insert({ person_id: self.id, role_code: 'Admin' });
      assert.equal(grant.error?.code, '42501');

      const edit = await client
        .from('person_roles')
        .update({ role_code: 'Admin' })
        .eq('person_id', self.id)
        .select();
      assert.deepEqual(edit.data, []);
    }
    const { data } = await service
      .from('person_roles')
      .select('role_code')
      .in('person_id', [mikeRow.id, (await person('PERSON-hannah')).id])
      .eq('role_code', 'Admin');
    assert.deepEqual(data, []);
  });

  test('non-admins cannot edit people or take over a login', async () => {
    const mikeRow = await person('PERSON-mike');
    const edit = await mike
      .from('people')
      .update({ display_name: 'Mike (Admin)' })
      .eq('id', mikeRow.id)
      .select();
    assert.deepEqual(edit.data, []);
    const create = await hannah
      .from('people')
      .insert({ display_name: 'Ghost', email: 'ghost@example.com' });
    assert.equal(create.error?.code, '42501');
  });

  test('client-supplied attribution is ignored', async () => {
    const mikeRow = await person('PERSON-mike');
    const { data, error } = await lenny
      .from('people')
      .insert({
        display_name: 'Temp Person',
        created_by: mikeRow.id,
        version: 99
      })
      .select()
      .single();
    assert.ifError(error);
    assert.equal(data.created_by, (await person('PERSON-lenny-dev')).id);
    assert.equal(data.version, 1);
  });

  test('rows cannot be deleted, even by an admin', async () => {
    const { error } = await lenny
      .from('person_roles')
      .delete()
      .eq('role_code', 'Surveyor');
    assert.equal(error?.code, '42501');
  });
});

describe('admin changes, versioning and audit', () => {
  test('an admin grant is versioned and audited with the initiating person', async () => {
    const rosie = await person('PERSON-rosie');
    const lennyRow = await person('PERSON-lenny-dev');
    const { data: granted, error } = await lenny
      .from('person_roles')
      .insert({ person_id: rosie.id, role_code: 'Finance' })
      .select()
      .single();
    assert.ifError(error);
    assert.equal(granted.version, 1);
    assert.equal(granted.created_by, lennyRow.id);

    const { data: revoked } = await lenny
      .from('person_roles')
      .update({ active: false, version: 1 })
      .eq('id', granted.id)
      .select()
      .single();
    assert.equal(revoked.version, 2);
    assert.equal(revoked.updated_by, lennyRow.id);

    const { data: events } = await lenny
      .from('audit_events')
      .select('*')
      .eq('entity_type', 'person_roles')
      .eq('entity_id', granted.id)
      .order('occurred_at');
    assert.deepEqual(
      events.map((e) => e.action),
      ['INSERT', 'UPDATE']
    );
    assert.ok(events.every((e) => e.initiating_person_id === lennyRow.id));
    assert.equal(events[0].before_json, null);
    assert.equal(events[1].before_json.active, true);
    assert.equal(events[1].after_json.active, false);
    assert.equal(events[1].executing_service, 'db:person_roles');
  });

  test('a stale version is refused and changes nothing', async () => {
    const lucy = await person('PERSON-lucy');
    const stale = await lenny
      .from('people')
      .update({ display_name: 'Lucy R', version: lucy.version + 5 })
      .eq('id', lucy.id);
    assert.match(stale.error?.message ?? '', /STALE_VERSION/);
    assert.equal((await person('PERSON-lucy')).display_name, 'Lucy Ross');
  });

  test('seed writes are audited as system writes', async () => {
    const ben = await person('PERSON-ben');
    const { data } = await service
      .from('audit_events')
      .select('initiating_person_id, action')
      .eq('entity_type', 'people')
      .eq('entity_id', ben.id);
    assert.deepEqual(data, [{ initiating_person_id: null, action: 'INSERT' }]);
  });

  test('the audit log is immutable, even for the service role', async () => {
    const { data: one } = await service
      .from('audit_events')
      .select('id')
      .limit(1)
      .single();
    const edit = await service
      .from('audit_events')
      .update({ reason: 'x' })
      .eq('id', one.id);
    assert.match(edit.error?.message ?? '', /AUDIT_EVENTS_ARE_IMMUTABLE/);
    const remove = await service.from('audit_events').delete().eq('id', one.id);
    assert.match(remove.error?.message ?? '', /AUDIT_EVENTS_ARE_IMMUTABLE/);
  });
});

describe('skills', () => {
  test('office staff may configure skills, but only for installers', async () => {
    const angel = await person('PERSON-angel');
    const ok = await tanya.from('person_skills').insert({
      person_id: angel.id,
      skill_code: 'Electrical',
      level: 'Apprentice'
    });
    assert.ifError(ok.error);

    const mikeRow = await person('PERSON-mike');
    const notInstaller = await tanya
      .from('person_skills')
      .insert({ person_id: mikeRow.id, skill_code: 'Roof' });
    assert.match(
      notInstaller.error?.message ?? '',
      /SKILL_HOLDER_NOT_INSTALLER/
    );
  });

  test('a surveyor cannot configure skills', async () => {
    const angel = await person('PERSON-angel');
    const { error } = await mike
      .from('person_skills')
      .insert({ person_id: angel.id, skill_code: 'Roof', level: 'Lead' });
    assert.ok(error);
  });
});

describe('constraints', () => {
  test('emails are unique and stored normalised', async () => {
    const dup = await service
      .from('people')
      .insert({ display_name: 'Dup', email: email('ben') });
    assert.equal(dup.error?.code, '23505');
    const upper = await service
      .from('people')
      .insert({ display_name: 'Up', email: 'Ben2@Example.com' });
    assert.equal(upper.error?.code, '23514');
  });

  test('role and skill assignments are unique and use known codes', async () => {
    const ben = await person('PERSON-ben');
    const dup = await service
      .from('person_roles')
      .insert({ person_id: ben.id, role_code: 'Director' });
    assert.equal(dup.error?.code, '23505');
    const unknown = await service
      .from('person_roles')
      .insert({ person_id: ben.id, role_code: 'Wizard' });
    assert.equal(unknown.error?.code, '23503');
    const james = await person('PERSON-james');
    const level = await service
      .from('person_skills')
      .insert({ person_id: james.id, skill_code: 'Roof', level: 'Expert' });
    assert.equal(level.error?.code, '23514');
  });
});

// Keep last: these revoke access from sessions used above.
describe('revocation takes effect immediately', () => {
  test('revoking the only role leaves a live session with nothing', async () => {
    const mikeRow = await person('PERSON-mike');
    const { error } = await lenny
      .from('person_roles')
      .update({ active: false })
      .eq('person_id', mikeRow.id);
    assert.ifError(error);
    assert.deepEqual((await mike.rpc('current_actor')).data[0].roles, []);
    assert.deepEqual((await mike.from('people').select('id')).data, []);
  });

  test('deactivating a person leaves a live session as nobody', async () => {
    const hannahRow = await person('PERSON-hannah');
    const { error } = await lenny
      .from('people')
      .update({ active: false })
      .eq('id', hannahRow.id);
    assert.ifError(error);
    assert.deepEqual((await hannah.rpc('current_actor')).data, []);
    assert.deepEqual((await hannah.from('people').select('id')).data, []);
  });
});
