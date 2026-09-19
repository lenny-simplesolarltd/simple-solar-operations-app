// P0 audit integrity: the row-level audit triggers lost in the drop/restore
// incident are back, record the right actor, stay out of rejected work, and a
// future loss is detected (20260919202000_p0_audit_integrity.sql).
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, as, id, ok } = f;
const count = async (where = 'true', p = []) =>
  (
    await one(
      `select count(*)::int n from public.audit_events where ${where}`,
      p
    )
  ).n;
const last = async (table, entityId) =>
  one(
    `select * from public.audit_events where entity_type=$1 and entity_id=$2 order by occurred_at desc, id desc limit 1`,
    [table, String(entityId)]
  );
// Staff reach tables as the `authenticated` role (RLS applies); the test session is otherwise a superuser.
const staff = async (who, sql, p = []) => {
  await as(who);
  await db.query(`set role authenticated`);
  try {
    return { rows: (await db.query(sql, p)).rows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.query(`reset role`);
  }
};
// Migrations, seeds, the service role: no JWT, no person.
const system = async (sql, p = []) => {
  await as(null);
  return (await db.query(sql, p)).rows;
};

// ------------------------------------------------------------ coverage
// Required tables are a SUBSET check: other modules may add tables (audited or
// not) without touching this list, but none of these may lose its trigger.
const REQUIRED = {
  // identity / Job Sold
  people: 'IUD',
  person_roles: 'IUD',
  person_skills: 'IUD',
  role_permissions: 'IUD',
  customers: 'IUD',
  jobs: 'IUD',
  presales: 'I',
  task_templates: 'IUD',
  task_assignment_rules: 'IUD',
  tasks: 'IUD',
  // lost in the incident, restored
  companies: 'IUD',
  contacts: 'IUD',
  holidays: 'IUD',
  person_availability: 'IUD',
  teams: 'IUD',
  team_members: 'IUD',
  settings: 'I',
  release_modes: 'IUD',
  products: 'IUD',
  stock_locations: 'IUD',
  mapping_rules: 'IUD',
  commissioning_templates: 'IUD',
  commissioning_questions: 'IUD',
  // added
  roles: 'IUD',
  permissions: 'IUD',
  skills: 'IUD'
};
const RESTORED = [
  'companies',
  'contacts',
  'holidays',
  'person_availability',
  'teams',
  'team_members',
  'settings',
  'release_modes',
  'products',
  'stock_locations',
  'mapping_rules',
  'commissioning_templates',
  'commissioning_questions'
];
const installed = {};
for (const r of await all(`select c.relname t, bool_or((tg.tgtype & 4) > 0) i, bool_or((tg.tgtype & 16) > 0) u, bool_or((tg.tgtype & 8) > 0) d
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'public' and pn.nspname = 'app' and p.proname = 'audit_row_change'
      and not tg.tgisinternal and tg.tgenabled <> 'D' and (tg.tgtype & 1) = 1 group by 1`))
  installed[r.t] = (r.i ? 'I' : '') + (r.u ? 'U' : '') + (r.d ? 'D' : '');
for (const [t, ops] of Object.entries(REQUIRED))
  for (const op of ops)
    assert.ok(
      (installed[t] || '').includes(op),
      `public.${t} has no audit trigger for ${op}`
    );
for (const t of RESTORED)
  assert.ok(installed[t], `restored table ${t} is covered`);

let cov = (await one(`select app.audit_coverage() r`)).r;
assert.equal(cov.state, 'Verified');
assert.deepEqual(cov.missing, []);
assert.deepEqual(cov.append_only_guards_missing, []);
assert.equal(cov.covered_tables, cov.required_tables);
// The database's own list names at least every table this test requires.
const declared = (await all(`select table_name from app.audit_required`)).map(
  (r) => r.table_name
);
for (const t of Object.keys(REQUIRED))
  assert.ok(declared.includes(t), `${t} declared in app.audit_required`);

// Tables that hold customer responses / form answers are audited by their
// commands (semantic events), never by copying the row.
for (const t of [
  'intake',
  'communications',
  'acknowledgements',
  'commissioning_answers',
  'commissioning_submissions',
  'evidence',
  'outbox'
])
  assert.equal(
    installed[t],
    undefined,
    `${t} must not be snapshotted into the audit log`
  );

// ------------------------------------------------------------ direct staff edits (RLS): insert / update, actor, source
const direct = [
  [
    'holidays',
    'ben',
    `insert into public.holidays (local_date, description) values ('2026-12-24', 'Closed') returning id`,
    `update public.holidays set description = 'Christmas Eve' where id = $1`,
    'description',
    'Closed',
    'Christmas Eve'
  ],
  [
    'companies',
    'ben',
    `insert into public.companies (name, type) values ('Acme Scaffold', 'Scaffolder') returning id`,
    `update public.companies set name = 'Acme Scaffolding' where id = $1`,
    'name',
    'Acme Scaffold',
    'Acme Scaffolding'
  ],
  [
    'products',
    'ben',
    `insert into public.products (sku, name, category, unit, stock_tracked) values ('P-1', 'Panel', 'Panel', 'Each', true) returning id`,
    `update public.products set name = 'Panel 430W' where id = $1`,
    'name',
    'Panel',
    'Panel 430W'
  ],
  [
    'stock_locations',
    'ben',
    `insert into public.stock_locations (name, type, usable) values ('Unit 4', 'Store', true) returning id`,
    `update public.stock_locations set name = 'Unit 4a' where id = $1`,
    'name',
    'Unit 4',
    'Unit 4a'
  ],
  [
    'teams',
    'tanya',
    `insert into public.teams (name, trade) values ('Crew 1', 'Roof') returning id`,
    `update public.teams set trade = 'Mixed' where id = $1`,
    'trade',
    'Roof',
    'Mixed'
  ],
  [
    'person_availability',
    'tanya',
    `insert into public.person_availability (person_id, type, from_date) values ('${people.inst_a}', 'Leave', '2026-10-01') returning id`,
    `update public.person_availability set type = 'Sick' where id = $1`,
    'type',
    'Leave',
    'Sick'
  ]
];
const ids = {};
for (const [table, who, insertSql, updateSql, col, v1, v2] of direct) {
  let r = await staff(who, insertSql);
  assert.ok(!r.error, `${table} insert: ${r.error}`);
  const rowId = r.rows[0].id;
  ids[table] = rowId;
  let ev = await last(table, rowId);
  assert.equal(ev.action, 'INSERT', table);
  assert.equal(ev.before_json, null);
  assert.equal(ev.after_json[col], v1);
  assert.equal(
    ev.initiating_person_id,
    people[who],
    `${table}: actor from the session`
  );
  assert.equal(ev.executing_service, `db:${table}`);
  assert.equal(ev.command_id, null);
  r = await staff(who, updateSql, [rowId]);
  assert.ok(!r.error, `${table} update: ${r.error}`);
  ev = await last(table, rowId);
  assert.equal(ev.action, 'UPDATE');
  assert.equal(ev.before_json[col], v1);
  assert.equal(ev.after_json[col], v2);
  assert.equal(ev.after_json.version, ev.before_json.version + 1);
  assert.equal(ev.initiating_person_id, people[who]);
}
// contacts + team_members hang off the rows above.
let r = await staff(
  'ben',
  `insert into public.contacts (company_id, name) values ($1, 'Site Desk') returning id`,
  [ids.companies]
);
assert.equal(
  (await last('contacts', r.rows[0].id)).initiating_person_id,
  people.ben
);
r = await staff(
  'tanya',
  `insert into public.team_members (team_id, person_id, role) values ($1, $2, 'Lead') returning id`,
  [ids.teams, people.inst_a]
);
assert.equal((await last('team_members', r.rows[0].id)).action, 'INSERT');
// The actor never comes from the row: a forged updated_by is overwritten and the event names the session's person.
r = await staff(
  'ben',
  `update public.holidays set description = 'Forged', updated_by = $2 where id = $1`,
  [ids.holidays, people.dan]
);
assert.ok(!r.error, r.error);
assert.equal(
  (await last('holidays', ids.holidays)).initiating_person_id,
  people.ben
);

// settings: insert-only, versioned; release_modes: the release gates themselves.
r = await staff(
  'ben',
  `insert into public.settings (key, typed_value, scope, version, effective_from, changed_by, reason)
  values ('office.hours', '{"start":"08:00","end":"17:00"}', 'Global', 2, '2026-01-01', $1, 'earlier start') returning id`,
  [people.ben]
);
assert.ok(!r.error, r.error);
let ev = await last('settings', r.rows[0].id);
assert.equal(ev.after_json.key, 'office.hours');
assert.equal(ev.after_json.typed_value.start, '08:00');
assert.equal(ev.initiating_person_id, people.ben);
const fn20 = await one(
  `select * from public.release_modes where function_id = 'FN-20'`
);
r = await staff(
  'ben',
  `update public.release_modes set scope_boundary_notes = 'reviewed' where id = $1`,
  [fn20.id]
);
assert.ok(!r.error, r.error);
ev = await last('release_modes', fn20.id);
assert.equal(ev.action, 'UPDATE');
assert.equal(ev.before_json.mode, fn20.mode);
assert.equal(
  ev.after_json.mode,
  fn20.mode,
  'test did not switch a function on'
);
assert.equal(ev.initiating_person_id, people.ben);

// ------------------------------------------------------------ unauthorized direct mutation refused, and not audited
let before = await count();
r = await staff(
  'tanya',
  `insert into public.holidays (local_date, description) values ('2026-12-25', 'x') returning id`
); // Office is not Admin
assert.match(r.error, /row-level security/);
r = await staff(
  'tanya',
  `update public.release_modes set mode = 'Automated', authorised_job_scope = 'All' where function_id = 'FN-20' returning id`
);
assert.ok(!r.error);
assert.equal(r.rows.length, 0, 'RLS hides the row from a non-admin update');
assert.equal(
  (
    await one(
      `select mode from public.release_modes where function_id = 'FN-20'`
    )
  ).mode,
  fn20.mode
);
r = await staff(
  'inst_a',
  `insert into public.products (sku, name, category, unit, stock_tracked) values ('P-2', 'x', 'Panel', 'Each', true)`
);
assert.match(r.error, /row-level security/);
r = await staff('ben', `delete from public.holidays where id = $1`, [
  ids.holidays
]); // no delete grant, even for Admin
assert.match(r.error, /permission denied/);
r = await staff(
  null,
  `insert into public.holidays (local_date, description) values ('2026-12-26', 'x')`
); // signed out
assert.ok(r.error);
// A mutation rejected by the table itself (constraint, stale version) leaves nothing either.
r = await staff(
  'ben',
  `insert into public.companies (name, type) values ('Bad', 'NotAType')`
);
assert.match(r.error, /check constraint/);
r = await staff(
  'ben',
  `update public.companies set name = 'Stale', version = 99 where id = $1`,
  [ids.companies]
);
assert.match(r.error, /STALE_VERSION/);
assert.equal(await count(), before, 'rejected mutations are not audited');

// ------------------------------------------------------------ commands: correlation, and rejected commands are not audited
const commandId = id();
const created = ok(
  await cmd('tanya', {
    command_id: commandId,
    command_type: 'RP_UPSERT_TEAM',
    payload: { name: 'Roof Crew A', trade: 'Roof' }
  }),
  'team'
);
ev = await last('teams', created.team.id);
assert.equal(ev.command_id, commandId, 'row event carries the command id');
assert.equal(ev.executing_service, 'command:RP_UPSERT_TEAM');
assert.equal(ev.initiating_person_id, people.tanya);
const semantic = await one(
  `select * from public.audit_events where entity_type = 'Teams' and entity_id = $1`,
  [created.team.id]
);
assert.equal(
  semantic.command_id,
  commandId,
  'and so does the semantic event of the command'
);
before = await count();
r = await cmd('tanya', {
  command_id: id(),
  command_type: 'RP_UPSERT_TEAM',
  payload: { name: 'Bad Crew', trade: 'Plumbing' }
});
assert.match(r.error, /RP_REVIEW/);
r = await cmd('inst_a', {
  command_id: id(),
  command_type: 'RP_UPSERT_TEAM',
  payload: { name: 'Crew X', trade: 'Roof' }
});
assert.equal(r.error, 'R1A_ROLE_DENIED');
assert.equal(await count(), before, 'rejected commands are not audited');
assert.equal(
  (
    await one(
      `select count(*)::int n from public.teams where name in ('Bad Crew', 'Crew X')`
    )
  ).n,
  0
);
// A replay returns the stored result and writes nothing new.
const again = await cmd('tanya', {
  command_id: commandId,
  command_type: 'RP_UPSERT_TEAM',
  payload: { name: 'Roof Crew A', trade: 'Roof' }
});
assert.equal(again.replayed, true);
assert.equal(await count(), before);

// ------------------------------------------------------------ changes outside any user: honest source, no invented person
const [tpl] =
  await system(`insert into public.commissioning_templates (trade, equipment_type, template_version, effective_from)
  values ('Electrical', 'Inverter', 'v1', '2026-01-01') returning id`);
ev = await last('commissioning_templates', tpl.id);
assert.equal(ev.initiating_person_id, null);
assert.equal(ev.executing_service, 'db:commissioning_templates');
assert.equal(ev.command_id, null);
const [qn] = await system(
  `insert into public.commissioning_questions (template_id, question_key, label, data_type, display_order)
  values ($1, 'dc_voltage', 'DC voltage', 'number', 1) returning id`,
  [tpl.id]
);
await system(
  `update public.commissioning_questions set label = 'DC string voltage' where id = $1`,
  [qn.id]
);
ev = await last('commissioning_questions', qn.id);
assert.equal(ev.action, 'UPDATE');
assert.equal(ev.before_json.label, 'DC voltage');
assert.equal(ev.after_json.label, 'DC string voltage');
await system(`delete from public.commissioning_questions where id = $1`, [
  qn.id
]);
ev = await last('commissioning_questions', qn.id);
assert.equal(ev.action, 'DELETE');
assert.equal(ev.after_json, null);
assert.equal(ev.before_json.question_key, 'dc_voltage');
const [mr] =
  await system(`insert into public.mapping_rules (form_id, question_id, source_label, target_table, target_field, mapping_version, effective_from, owner, disposition)
  values ('F1', 'Q1', 'Name', 'customers', 'first_name', 'v1', '2026-01-01', 'Office', 'Import') returning id`);
assert.equal((await last('mapping_rules', mr.id)).action, 'INSERT');
await system(
  `insert into public.skills (code, name) values ('Battery', 'Battery storage')`
);
ev = await last('skills', 'Battery');
assert.equal(ev.action, 'INSERT');
assert.equal(ev.initiating_person_id, null);
await system(
  `insert into public.roles (code, name, description) values ('Auditor', 'Auditor', 'Read-only reviewer')`
);
await system(
  `insert into public.permissions (code, description) values ('audit.read', 'Read the audit log')`
);
assert.equal((await last('roles', 'Auditor')).action, 'INSERT');
assert.equal((await last('permissions', 'audit.read')).action, 'INSERT');
// A service that names itself is recorded as that service, still with no person.
await as(null);
await db.query(`begin`);
await db.query(
  `select set_config('app.executing_service', 'seed:holidays-2027', true)`
);
const hol = (
  await db.query(
    `insert into public.holidays (local_date, description) values ('2027-01-01', 'New Year') returning id`
  )
).rows[0];
await db.query(`commit`);
ev = await last('holidays', hol.id);
assert.equal(ev.executing_service, 'seed:holidays-2027');
assert.equal(ev.initiating_person_id, null);
await system(`delete from public.holidays where id = $1`, [hol.id]);
assert.equal((await last('holidays', hol.id)).action, 'DELETE');

// ------------------------------------------------------------ the log itself is append-only
const victim = await one(`select id from public.audit_events limit 1`);
for (const sql of [
  `update public.audit_events set reason = 'edited' where id = '${victim.id}'`,
  `delete from public.audit_events where id = '${victim.id}'`,
  `insert into public.audit_events (entity_type, entity_id, action, executing_service) values ('x', 'x', 'x', 'forged')`,
  `truncate public.audit_events`
]) {
  for (const who of ['ben', 'tanya', 'inst_a']) {
    r = await staff(who, sql);
    assert.match(r.error ?? '', /permission denied/, `${who}: ${sql}`);
  }
}
for (const sql of [
  `update public.audit_events set reason = 'edited' where id = '${victim.id}'`,
  `delete from public.audit_events where id = '${victim.id}'`,
  `truncate public.audit_events`
]) {
  await as(null);
  await assert.rejects(
    db.query(sql),
    /AUDIT_EVENTS_ARE_IMMUTABLE/,
    'even the service role: ' + sql
  );
}
// Only Admin-class staff can read it.
assert.ok(
  (await staff('ben', `select id from public.audit_events limit 5`)).rows
    .length > 0
);
assert.equal(
  (await staff('tanya', `select id from public.audit_events limit 5`)).rows
    .length,
  0
);
assert.equal(
  (await staff('inst_a', `select id from public.audit_events limit 5`)).rows
    .length,
  0
);

// ------------------------------------------------------------ sensitive data
let red = (
  await one(`select app.audit_redact('people', $1::jsonb) r`, [
    JSON.stringify({
      id: '1',
      email: 'a@b',
      invitation_token: 'tok-123',
      api_key: 'k',
      password_hash: 'h',
      client_secret: 's',
      notes: null,
      reset_token: null
    })
  ])
).r;
assert.deepEqual(red, {
  id: '1',
  email: 'a@b',
  invitation_token: '[redacted]',
  api_key: '[redacted]',
  password_hash: '[redacted]',
  client_secret: '[redacted]',
  notes: null,
  reset_token: null
});
r = await staff(
  'ben',
  `insert into public.settings (key, typed_value, scope, version, effective_from, changed_by, reason)
  values ('xero.client_secret', '"super-secret-value"', 'Global', 1, '2026-01-01', $1, 'test') returning id`,
  [people.ben]
);
assert.ok(!r.error, r.error);
ev = await last('settings', r.rows[0].id);
assert.equal(ev.after_json.typed_value, '[redacted]');
assert.equal(ev.after_json.key, 'xero.client_secret');
assert.equal(
  await count(
    `after_json::text like '%super-secret-value%' or before_json::text like '%super-secret-value%'`
  ),
  0
);
// Nothing in the log, from any trigger, carries a secret-looking key with a value.
const leaks = await all(
  `select a.entity_type, e.key from public.audit_events a,
    lateral jsonb_each(coalesce(a.after_json, '{}') || coalesce(a.before_json, '{}')) e
  where a.entity_type = any ($1) and e.key ~* '(token|secret|password|passwd|api_?key|credential|private_key)'
    and e.value not in ('null'::jsonb, '"[redacted]"'::jsonb)`,
  [Object.keys(REQUIRED)]
);
assert.deepEqual(leaks, []);

// ------------------------------------------------------------ regression: the incident, replayed
// Disabling or dropping a trigger is reported, table by table.
await system(`alter table public.holidays disable trigger holidays_audit`);
cov = (await one(`select app.audit_coverage() r`)).r;
assert.equal(cov.state, 'Failed');
assert.deepEqual(
  cov.missing.map((m) => m.table),
  ['holidays']
);
await system(`alter table public.holidays enable trigger holidays_audit`);
await system(`drop trigger settings_audit on public.settings`);
await system(`drop trigger release_modes_audit on public.release_modes`);
await system(
  `create trigger release_modes_audit after insert on public.release_modes for each row execute function app.audit_row_change()`
);
cov = (await one(`select app.audit_coverage() r`)).r;
assert.deepEqual(cov.missing, [
  {
    table: 'release_modes',
    exists: true,
    missing_operations: ['DELETE', 'UPDATE']
  },
  { table: 'settings', exists: true, missing_operations: ['INSERT'] }
]);
let health = (await one(`select app.operational_health() r`)).r;
let item = health.items.find((i) => i.key === 'AuditCoverage');
assert.equal(item.state, 'Failed');
assert.match(item.detail, /release_modes, settings/);
assert.equal(health.overall_state, 'Failed');
// What the incident did: dropping the function cascades to every trigger that calls it.
await system(`drop function app.audit_row_change() cascade`);
cov = (await one(`select app.audit_coverage() r`)).r;
assert.equal(cov.state, 'Failed');
assert.equal(cov.covered_tables, 0);
assert.deepEqual(
  cov.missing.map((m) => m.table).sort(),
  Object.keys(REQUIRED).sort()
);
assert.deepEqual(
  cov.append_only_guards_missing,
  [],
  'the log guards use their own function'
);
// ... and an evaluation records it as Critical, so the sweep raises an alert.
health = (await one(`select app.health_status(now()) r`)).r;
assert.equal(health.overall, 'Critical');
assert.ok(
  health.issues.some((i) => i.component === 'Operational:AuditCoverage')
);

console.log('P0 AUDIT INTEGRITY TESTS PASSED');
process.exit(0);
