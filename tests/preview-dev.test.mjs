// "View as user" - DATABASE level. Proves the preview evaluates the REAL RLS
// policies as the target, that nothing but a server-minted token can do it, and
// that a preview token can never write. Requires the dev hook:
//   npm run dev:preview:install   (LOCAL stack only - it is not a migration)
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import {
  API_URL,
  count,
  email,
  ensureLogin,
  person,
  service,
  signInAs
} from './helpers.mjs';

const status = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v])
);
const b64 = (v) => Buffer.from(v).toString('base64url');
function token(claims, secret = status.JWT_SECRET) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(
    JSON.stringify({
      aud: 'authenticated',
      role: 'authenticated',
      iat,
      exp: iat + 120,
      ...claims
    })
  );
  return `${head}.${body}.${b64(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}
const as = (jwt) =>
  createClient(API_URL, status.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });

let lennyUid, rickUid, people, totalJobs, ricksJobs;
const preview = (legacyId, extra = {}, sub = lennyUid) =>
  as(token({ sub, preview_person_id: people[legacyId].id, ...extra }));

function salePayload(salespersonId) {
  return {
    customer: {
      first_name: 'Preview',
      last_name: 'Fixture',
      address_line1: '1 Test St',
      address_line2: null,
      town: 'Exeter',
      postcode: 'EX1 1AA',
      phone: '07000000000',
      email: null
    },
    sale: {
      salesperson_id: salespersonId,
      lead_source: null,
      quote_reference: null,
      finance_route: 'Standard',
      agreed_price_pence: 900000
    },
    scope: {
      roof_required: true,
      electrical_required: true,
      scaffold_required: false,
      roof_notes: null,
      electrical_notes: null
    },
    design: {},
    design_schema_version: 1,
    catalogue_version: 'test',
    computed: {
      system_kwp: 4,
      net_panels: 8,
      computed_total_pence: 900000,
      price_breakdown: []
    }
  };
}

before(async () => {
  // Earlier suites end by deactivating Hannah; this suite needs her (multi-role).
  await service.from('people').update({ active: true }).eq('legacy_id', 'PERSON-hannah');
  for (const n of ['lenny', 'rick', 'dave']) await ensureLogin(email(n));
  people = Object.fromEntries(
    await Promise.all(
      [
        'PERSON-lenny-dev',
        'PERSON-tanya',
        'PERSON-ben',
        'PERSON-rick',
        'PERSON-dave-gorman',
        'PERSON-hannah',
        'PERSON-dan-anderson',
        'PERSON-lucy'
      ].map(async (id) => [id, await person(id)])
    )
  );
  lennyUid = people['PERSON-lenny-dev'].auth_user_id;
  rickUid = people['PERSON-rick'].auth_user_id;
  const rick = await signInAs(email('rick'));
  const dave = await signInAs(email('dave'));
  for (const [client, who] of [
    [rick, 'PERSON-rick'],
    [rick, 'PERSON-rick'],
    [dave, 'PERSON-dave-gorman']
  ]) {
    const { error } = await client.rpc('submit_presale', {
      p_command_id: randomUUID(),
      p_payload: salePayload(people[who].id)
    });
    assert.ifError(error);
  }
  totalJobs = await count('jobs');
  ricksJobs = await count('jobs', (q) =>
    q.eq('salesperson_id', people['PERSON-rick'].id)
  );
});

describe('the hook is development-only', () => {
  test('it is not a migration and no migration knows about preview', () => {
    const files = readdirSync('supabase/migrations');
    assert.ok(!files.some((f) => /preview/i.test(f)));
    for (const f of files)
      assert.doesNotMatch(
        readFileSync(`supabase/migrations/${f}`, 'utf8'),
        /preview_person_id|app_dev/
      );
  });
});

describe('effective visibility is the real RLS, evaluated as the target', () => {
  test('Office (Tanya): every job, every task, and My tasks are hers', async () => {
    const c = preview('PERSON-tanya');
    const { data: actor } = await c.rpc('current_actor');
    assert.deepEqual(
      [actor[0].display_name, actor[0].roles],
      ['Tanya Harris', ['Office']]
    );
    assert.equal((await c.from('jobs').select('id')).data.length, totalJobs);
    const tasks = (await c.from('tasks').select('owner_id, template_code'))
      .data;
    assert.equal(tasks.length, await count('tasks'));
    const mine = tasks.filter((t) => t.owner_id === people['PERSON-tanya'].id);
    assert.ok(
      mine.length > 0 &&
        mine.every((t) =>
          ['PRE01', 'PRE02', 'PRE04', 'PRE05'].includes(t.template_code)
        )
    );
    assert.deepEqual((await c.from('audit_events').select('id')).data, []); // Office never sees the audit log
  });

  test('Surveyor (Rick): only his own jobs and customers; no tasks; no staff directory', async () => {
    const c = preview('PERSON-rick');
    const jobs = (await c.from('jobs').select('salesperson_id')).data;
    assert.equal(jobs.length, ricksJobs);
    assert.ok(
      ricksJobs < totalJobs &&
        jobs.every((j) => j.salesperson_id === people['PERSON-rick'].id)
    );
    assert.equal(
      (await c.from('customers').select('id')).data.length,
      ricksJobs
    );
    assert.deepEqual((await c.from('tasks').select('id')).data, []);
    assert.deepEqual((await c.from('people').select('legacy_id')).data, [
      { legacy_id: 'PERSON-rick' }
    ]);
    assert.deepEqual(
      (await c.from('task_assignment_rules').select('id')).data,
      []
    );
  });

  test('Director (Ben): Director semantics - reads all jobs and tasks, owns PRE03, holds no submit permission', async () => {
    const c = preview('PERSON-ben');
    assert.deepEqual((await c.rpc('current_actor')).data[0].roles, [
      'Director'
    ]);
    assert.equal((await c.from('jobs').select('id')).data.length, totalJobs);
    const mine = (
      await c
        .from('tasks')
        .select('template_code')
        .eq('owner_id', people['PERSON-ben'].id)
    ).data;
    assert.ok(
      mine.length > 0 && mine.every((t) => t.template_code === 'PRE03')
    );
    const perms = (
      await c
        .from('role_permissions')
        .select('permission_code')
        .eq('role_code', 'Director')
    ).data.map((p) => p.permission_code);
    assert.ok(!perms.includes('presale.submit'));
  });

  test('multi-role staff (Hannah) resolve ALL active roles', async () => {
    assert.deepEqual(
      (await preview('PERSON-hannah').rpc('current_actor')).data[0].roles,
      ['Office', 'VariationApprover']
    );
  });

  test('Installer: no jobs, no customers, no tasks', async () => {
    const c = preview('PERSON-dan-anderson');
    for (const t of ['jobs', 'customers', 'presales', 'tasks'])
      assert.deepEqual((await c.from(t).select('id')).data, []);
  });
});

describe('the browser cannot forge a preview', () => {
  test('a token not signed with the database secret is rejected outright', async () => {
    const forged = as(
      token(
        { sub: lennyUid, preview_person_id: people['PERSON-tanya'].id },
        'a-secret-the-browser-might-guess-0000000'
      )
    );
    const { error, data } = await forged.from('jobs').select('id');
    assert.ok(error && !data);
  });

  test('forged role / permission claims change nothing: authority is person_roles', async () => {
    const c = preview('PERSON-rick', {
      roles: ['Admin'],
      app_metadata: { roles: ['Admin'] },
      permissions: ['job.read.all'],
      user_role: 'Admin'
    });
    assert.deepEqual((await c.rpc('current_actor')).data[0].roles, [
      'Surveyor'
    ]);
    assert.equal((await c.from('jobs').select('id')).data.length, ricksJobs);
  });

  test('a preview claim signed for a NON-admin real user resolves to nobody - not to them, not to the target', async () => {
    const c = preview('PERSON-tanya', {}, rickUid);
    assert.deepEqual((await c.rpc('current_actor')).data, []);
    assert.deepEqual((await c.from('jobs').select('id')).data, []);
  });

  test('inactive, unknown and malformed targets resolve to nobody', async () => {
    await service
      .from('people')
      .update({ active: false })
      .eq('id', people['PERSON-lucy'].id);
    const cases = [
      preview('PERSON-lucy'),
      as(token({ sub: lennyUid, preview_person_id: randomUUID() })),
      as(token({ sub: lennyUid, preview_person_id: 'not-a-uuid' })),
      as(token({ sub: lennyUid, preview_person_id: null }))
    ];
    for (const c of cases) {
      assert.deepEqual((await c.rpc('current_actor')).data, []);
      assert.deepEqual((await c.from('jobs').select('id')).data, []);
    }
    await service
      .from('people')
      .update({ active: true })
      .eq('id', people['PERSON-lucy'].id);
  });
});

describe('a preview token can never write (enforced in the database, not by buttons)', () => {
  test('Job Sold is refused even though the target holds presale.submit', async () => {
    const before = await count('jobs');
    const { error } = await preview('PERSON-rick').rpc('submit_presale', {
      p_command_id: randomUUID(),
      p_payload: salePayload(people['PERSON-rick'].id)
    });
    assert.match(error?.message ?? '', /PREVIEW_MODE_READ_ONLY/);
    assert.equal(await count('jobs'), before);
    assert.equal(await count('commands'), await count('jobs'));
  });

  test('direct table writes are refused too', async () => {
    const c = preview('PERSON-tanya');
    const skill = await c
      .from('person_skills')
      .insert({
        person_id: people['PERSON-dan-anderson'].id,
        skill_code: 'Roof'
      });
    assert.match(
      skill.error?.message ?? '',
      /PREVIEW_MODE_READ_ONLY|permission|row-level/
    );
    const { data: before } = await service
      .from('person_skills')
      .select('id')
      .eq('person_id', people['PERSON-dan-anderson'].id);
    assert.equal(before.length, 1);
  });
});

describe('ending preview / non-preview behaviour is unchanged', () => {
  test('the same real user without the claim is simply themselves', async () => {
    const c = as(token({ sub: lennyUid }));
    assert.deepEqual((await c.rpc('current_actor')).data[0].roles, ['Admin']);
    assert.ok(
      (await c.from('audit_events').select('id').limit(1)).data.length === 1
    );
  });

  test('a genuine session is unaffected by the hook', async () => {
    const rick = await signInAs(email('rick'));
    assert.deepEqual((await rick.rpc('current_actor')).data[0].roles, [
      'Surveyor'
    ]);
    assert.equal((await rick.from('jobs').select('id')).data.length, ricksJobs);
  });
});
