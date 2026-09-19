// P0 operational health: backup / recovery evidence and heartbeat states
// (20260919202100_p0_operational_health.sql). The rule under test: a state is
// Verified only with fresh evidence - never because a row exists, never by default.
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, read, as, id, ok } = f;
const system = async (sql, p = []) => {
  await as(null);
  return (await db.query(sql, p)).rows;
};
const j = async (sql, p = []) => (await system(sql, p))[0].r;
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
const n = async (from, p = []) =>
  (await one(`select count(*)::int n from ${from}`, p)).n;
// Everything happens in the past (evidence cannot be dated in the future).
const BASE = Date.now() - 400 * 86400000;
const at = (days = 0, minutes = 0) =>
  new Date(BASE + days * 86400000 + minutes * 60000).toISOString();
const health = (when) => j(`select app.operational_health($1) r`, [when]);
const item = (h, key) => h.items.find((i) => i.key === key);
const record = (who, payload) =>
  cmd(who, { command_id: id(), command_type: 'OPS_EVIDENCE_RECORD', payload });
const backup = (over = {}) => ({
  kind: 'DatabaseBackup',
  outcome: 'Verified',
  performed_at: at(0),
  subject_at: at(0, -300),
  method: 'Supabase dashboard: daily backups list',
  evidence_reference: 'OPS-LOG 2025-week-33, backup of 02:00',
  ...over
});

// ------------------------------------------------------------ no evidence is Unknown, never a pass
let h = await health(at(0));
for (const k of [
  'DatabaseBackup',
  'DatabaseRestoreDrill',
  'StorageBackup',
  'StorageRestoreDrill',
  'HealthCheck',
  'Scheduler'
])
  assert.equal(item(h, k).state, 'Unknown', k);
assert.equal(item(h, 'DatabaseBackup').evidence_at, null);
assert.equal(item(h, 'DatabaseBackup').last_verified_at, null);
assert.equal(item(h, 'Database').state, 'Verified');
assert.equal(item(h, 'AuditCoverage').state, 'Verified');
assert.equal(item(h, 'ReleaseFunctions').state, 'Verified');
assert.equal(item(h, 'ReleaseFunctions').monitoring_enabled, true);
assert.equal(h.overall_state, 'Unknown');
assert.equal(h.counts.Unknown, 6);
assert.deepEqual(h.thresholds, {
  check_stale_minutes: 90,
  backup_verification_stale_days: 8,
  restore_drill_stale_days: 90
});
// A row existing is not health: a heartbeat saying OK is not a system health check.
await j(`select app.record_heartbeat('Mailer', 'OK', null, 'hb-1', $1) r`, [
  at(0)
]);
let sys = (await read('tanya', { read_type: 'SYSTEM_STATUS' })).data;
assert.equal(
  sys.health.latest_check,
  null,
  'an OK heartbeat row is not reported as the health check'
);
assert.equal(sys.health.state, 'Unknown');
assert.ok(
  sys.not_configured.some((x) => x.area === 'Database backup verified')
);
assert.ok(
  !sys.not_configured.some((x) => /Drive|Destructive/.test(x.area)),
  'Apps Script placeholders are gone'
);

// ------------------------------------------------------------ recording: who, validation, nothing written on refusal
const snapshot = async () =>
  [
    await n(`public.operational_evidence`),
    await n(`public.audit_events`),
    await n(`public.commands`)
  ].join('/');
let before = await snapshot();
assert.equal((await record('tanya', backup())).error, 'R1A_ROLE_DENIED'); // Office
assert.equal((await record('inst_a', backup())).error, 'R1A_ROLE_DENIED');
assert.equal((await record('store', backup())).error, 'R1A_ROLE_DENIED');
for (const [over, re] of [
  [{ kind: undefined }, /R1A_REQUIRED_KIND/],
  [{ outcome: undefined }, /R1A_REQUIRED_OUTCOME/],
  [{ performed_at: undefined }, /R1A_REQUIRED_PERFORMED_AT/],
  [{ method: undefined }, /R1A_REQUIRED_METHOD/],
  [{ evidence_reference: undefined }, /R1A_REQUIRED_EVIDENCE_REFERENCE/],
  [{ kind: 'Backup' }, /OPS_REVIEW: kind must be/],
  [{ outcome: 'Pass' }, /OPS_REVIEW: outcome must be Verified or Failed/],
  [
    { performed_at: '2025-08-01 10:00' },
    /OPS_REVIEW: performed_at must be a date and time with a time zone/
  ],
  [
    { performed_at: '2025-13-45T10:00:00Z' },
    /OPS_REVIEW: performed_at must be/
  ],
  [
    { performed_at: new Date(Date.now() + 3600000).toISOString() },
    /OPS_REVIEW: performed_at cannot be in the future/
  ],
  [{ subject_at: undefined }, /OPS_REVIEW: subject_at/],
  [
    { subject_at: at(1) },
    /OPS_REVIEW: the backup cannot be newer than the check/
  ],
  [
    { kind: 'DatabaseRestoreDrill', outcome: 'Failed', subject_at: undefined },
    /OPS_REVIEW: subject_at/
  ],
  [{ method: 'x' }, /OPS_REVIEW: method/],
  [
    {
      evidence_reference:
        'postgresql://postgres:hunter2@db.example.supabase.co:5432/postgres'
    },
    /OPS_REFUSED: evidence must not contain credentials/
  ],
  [
    { notes: 'service key eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc' },
    /OPS_REFUSED/
  ],
  [{ notes: 'password = hunter2' }, /OPS_REFUSED/],
  [{ surprise: 'field' }, /R1A_INVALID_FIELDS/]
]) {
  const r = await record('ben', backup(over));
  assert.match(r.error ?? '', re, JSON.stringify(over));
}
assert.equal(
  await snapshot(),
  before,
  'refused evidence writes nothing and is not audited'
);

// A Director records a verified backup.
const commandId = id();
let r = ok(
  await cmd('dan', {
    command_id: commandId,
    command_type: 'OPS_EVIDENCE_RECORD',
    payload: backup({ notes: 'Seven daily backups listed.' })
  }),
  'record'
);
assert.equal(r.status, 'Recorded');
assert.equal(r.kind, 'DatabaseBackup');
assert.equal(r.outcome, 'Verified');
let row = await one(`select * from public.operational_evidence where id = $1`, [
  r.evidence_id
]);
assert.equal(row.source, 'Person');
assert.equal(row.recorded_by, people.dan);
assert.equal(row.command_id, commandId);
assert.equal(row.executing_service, 'command:OPS_EVIDENCE_RECORD');
let ev = await one(
  `select * from public.audit_events where entity_type = 'OperationalEvidence' and entity_id = $1`,
  [r.evidence_id]
);
assert.equal(ev.action, 'RecordedVerified');
assert.equal(ev.initiating_person_id, people.dan);
assert.equal(ev.command_id, commandId);
assert.equal(ev.after_json.evidence_reference, row.evidence_reference);
assert.equal(ev.before_json, null);
const replay = await cmd('dan', {
  command_id: commandId,
  command_type: 'OPS_EVIDENCE_RECORD',
  payload: backup({ notes: 'Seven daily backups listed.' })
});
assert.equal(replay.replayed, true);
assert.equal(await n(`public.operational_evidence`), 1);
assert.equal(
  (
    await cmd('dan', {
      command_id: commandId,
      command_type: 'OPS_EVIDENCE_RECORD',
      payload: backup({ notes: 'changed' })
    })
  ).error,
  'R1A_COMMAND_CONFLICT'
);

// ------------------------------------------------------------ Verified -> Stale -> Failed -> Verified
h = await health(at(0, 60));
let b = item(h, 'DatabaseBackup');
assert.equal(b.state, 'Verified');
assert.equal(b.recorded_by, 'Dan');
assert.equal(b.source, 'Person');
assert.equal(new Date(b.evidence_at).toISOString(), at(0));
assert.equal(new Date(b.subject_at).toISOString(), at(0, -300));
assert.equal(item(await health(at(7, 0)), 'DatabaseBackup').state, 'Verified');
b = item(await health(at(8, 1)), 'DatabaseBackup');
assert.equal(b.state, 'Stale', 'an old pass is not a pass');
assert.equal(new Date(b.last_verified_at).toISOString(), at(0));
assert.equal((await health(at(8, 1))).overall_state, 'Stale');
assert.equal(
  item(await health(at(-1)), 'DatabaseBackup').state,
  'Unknown',
  'evidence does not apply before it was gathered'
);
ok(
  await record(
    'ben',
    backup({
      outcome: 'Failed',
      performed_at: at(2),
      subject_at: undefined,
      notes: 'Backups list empty since yesterday.'
    })
  ),
  'failed'
);
b = item(await health(at(2, 5)), 'DatabaseBackup');
assert.equal(b.state, 'Failed');
assert.equal(
  new Date(b.last_verified_at).toISOString(),
  at(0),
  'last verified is kept'
);
assert.equal((await health(at(2, 5))).overall_state, 'Failed');
assert.equal(
  item(await health(at(30)), 'DatabaseBackup').state,
  'Failed',
  'a failure does not age into something milder'
);
ok(
  await record('ben', backup({ performed_at: at(3), subject_at: at(3, -120) })),
  'fixed'
);
assert.equal(item(await health(at(3, 5)), 'DatabaseBackup').state, 'Verified');

// Recovery has to be tested, separately from backups existing.
assert.equal(
  item(await health(at(3, 5)), 'DatabaseRestoreDrill').state,
  'Unknown'
);
ok(
  await record('ben', {
    kind: 'DatabaseRestoreDrill',
    outcome: 'Verified',
    performed_at: at(4),
    subject_at: at(3, -120),
    method:
      'Restored the 02:00 backup into a scratch project; row counts compared',
    evidence_reference: 'DR-DRILL-001'
  }),
  'drill'
);
assert.equal(
  item(await health(at(4, 5)), 'DatabaseRestoreDrill').state,
  'Verified'
);
assert.equal(
  item(await health(at(94)), 'DatabaseRestoreDrill').state,
  'Verified'
);
assert.equal(
  item(await health(at(94, 5)), 'DatabaseRestoreDrill').state,
  'Stale'
);
// Thresholds are settings; a nonsense value falls back to the default.
const setSetting = (key, value, v) =>
  system(
    `insert into public.settings (key, typed_value, scope, version, effective_from)
  values ($1, $2::jsonb, 'Global', $3, '2020-01-01')`,
    [key, JSON.stringify(value), v]
  );
await setSetting('health.restore_drill_stale_days', 30, 1);
assert.equal(item(await health(at(35)), 'DatabaseRestoreDrill').state, 'Stale');
await setSetting('health.restore_drill_stale_days', 'never', 2);
h = await health(at(35));
assert.equal(h.thresholds.restore_drill_stale_days, 90);
assert.equal(item(h, 'DatabaseRestoreDrill').state, 'Verified');

// ------------------------------------------------------------ automation: honest source, no invented person
let auto = await j(
  `select app.record_operational_evidence('StorageBackup', 'Verified', $1, $2, 'Management API: bucket snapshot listed',
  'snapshot 8842', 'backup-verifier') r`,
  [at(4), at(4, -60)]
);
row = await one(`select * from public.operational_evidence where id = $1`, [
  auto.evidence_id
]);
assert.equal(row.source, 'Automation');
assert.equal(row.recorded_by, null);
assert.equal(row.executing_service, 'automation:backup-verifier');
ev = await one(
  `select * from public.audit_events where entity_type = 'OperationalEvidence' and entity_id = $1`,
  [auto.evidence_id]
);
assert.equal(ev.initiating_person_id, null);
assert.equal(ev.executing_service, 'automation:backup-verifier');
b = item(await health(at(4, 5)), 'StorageBackup');
assert.equal(b.state, 'Verified');
assert.equal(b.source, 'Automation');
assert.equal(b.recorded_by, null);
await assert.rejects(
  system(
    `select app.record_operational_evidence('StorageBackup', 'Verified', $1, $2, 'method', 'ref', '') r`,
    [at(4), at(4)]
  ),
  /OPS_REVIEW: executing service name required/
);
// Staff cannot reach the automation entry point or write the table.
assert.match(
  (
    await staff(
      'ben',
      `select app.record_operational_evidence('StorageBackup', 'Verified', now(), now(), 'method', 'ref', 'me')`
    )
  ).error,
  /permission denied/
);
assert.match(
  (
    await staff(
      'ben',
      `insert into public.operational_evidence (kind, outcome, performed_at, subject_at, method, evidence_reference, source, recorded_by, executing_service)
  values ('DatabaseBackup', 'Verified', now(), now(), 'forged', 'forged', 'Person', '${people.ben}', 'forged')`
    )
  ).error,
  /permission denied/
);
// Append-only, for everyone.
for (const sql of [
  `update public.operational_evidence set outcome = 'Verified'`,
  `delete from public.operational_evidence`,
  `truncate public.operational_evidence`
])
  await assert.rejects(system(sql), /OPERATIONAL_EVIDENCE_IS_IMMUTABLE/, sql);
// Readable by those who may record it.
assert.ok(
  (await staff('dan', `select id from public.operational_evidence`)).rows
    .length >= 4
);
assert.equal(
  (await staff('tanya', `select id from public.operational_evidence`)).rows
    .length,
  0
);
assert.equal(
  (await staff('inst_a', `select id from public.operational_evidence`)).rows
    .length,
  0
);

// ------------------------------------------------------------ heartbeat: fresh / stale / failed, and what Healthy needs
h = await j(`select app.health_status($1) r`, [at(5)]);
assert.equal(h.overall, 'Degraded');
assert.ok(
  h.warnings.some(
    (w) =>
      w.component === 'Operational:StorageRestoreDrill' &&
      /^Unknown/.test(w.detail)
  ),
  'missing recovery evidence degrades health'
);
let sweep = await j(`select app.run_resilience_sweep($1) r`, [at(5)]);
assert.equal(sweep.ok, true, JSON.stringify(sweep));
assert.equal(sweep.health.overall, 'Degraded');
h = await health(at(5, 10));
assert.equal(
  item(h, 'HealthCheck').state,
  'Failed',
  'a recent check with warnings ran, but is not a pass'
);
assert.equal(item(h, 'HealthCheck').outcome, 'Degraded');
assert.match(item(h, 'HealthCheck').detail, /did not pass.*warnings/);
assert.equal(item(h, 'Scheduler').state, 'Verified');
assert.equal(item(h, 'Scheduler').pg_cron, null);
h = await health(at(5, 91));
assert.equal(
  item(h, 'HealthCheck').state,
  'Stale',
  'a stopped scheduler is visible'
);
assert.equal(item(h, 'Scheduler').state, 'Stale');
assert.equal(
  item(h, 'HealthCheck').outcome,
  'Degraded',
  'the old outcome is shown as what it was, not as current'
);
// With every kind of evidence in place, and a second evaluation (a prior check exists), health is Healthy.
ok(
  await record('ben', {
    kind: 'StorageRestoreDrill',
    outcome: 'Verified',
    performed_at: at(5),
    subject_at: at(4, -60),
    method:
      'Restored 20 evidence files to a scratch bucket; checksums compared',
    evidence_reference: 'DR-DRILL-002'
  }),
  'storage drill'
);
await j(`select app.record_heartbeat('Mailer', 'OK', null, 'hb-1b', $1) r`, [
  at(5, 29)
]); // the component is alive
sweep = await j(`select app.run_resilience_sweep($1) r`, [at(5, 30)]);
assert.equal(sweep.health.overall, 'Healthy', JSON.stringify(sweep.health));
h = await health(at(5, 31));
assert.equal(h.overall_state, 'Verified');
assert.equal(h.counts.Verified, 9);
assert.equal(item(h, 'HealthCheck').outcome, 'Healthy');
// A critical evaluation is Failed, fresh or not-so-fresh.
await j(
  `select app.record_heartbeat('Mailer', 'FAILED', 'SMTP down', 'hb-2', $1) r`,
  [at(5, 32)]
);
await system(
  `insert into public.health_checks (integration, checked_at, outcome, last_success, error_code)
  values ('S16-system', $1, 'Critical', $2, 'Heartbeat:Mailer_x')`,
  [at(5, 40), at(5, 30)]
);
h = await health(at(5, 45));
assert.equal(item(h, 'HealthCheck').state, 'Failed');
assert.equal(h.overall_state, 'Failed');
// A sweep that fails is Failed.
await j(
  `select app.record_heartbeat('ResilienceSweep', 'FAILED', 'boom', 'hb-3', $1) r`,
  [at(5, 50)]
);
h = await health(at(5, 55));
assert.equal(item(h, 'Scheduler').state, 'Failed');
assert.match(item(h, 'Scheduler').detail, /boom/);

// ------------------------------------------------------------ what staff see, and what an outside monitor sees
sys = (await read('tanya', { read_type: 'SYSTEM_STATUS' })).data;
assert.equal(sys.operational.items.length, 9);
assert.ok(
  ['Verified', 'Stale', 'Failed', 'Unknown'].includes(
    sys.operational.overall_state
  )
);
assert.equal(sys.health.latest_check.integration, 'S16-system');
assert.equal(sys.health.state, 'Stale', 'the last check was 400 days ago');
assert.equal(
  (await read('inst_a', { read_type: 'SYSTEM_STATUS' })).error,
  'R1A_ROLE_DENIED'
);
await as(null);
await db.query(`set role anon`);
const ping = (await db.query(`select public.health_ping() r`)).rows[0].r;
await assert.rejects(
  db.query(`select app.operational_health()`),
  /permission denied/
);
await assert.rejects(
  db.query(`select * from public.operational_evidence`),
  /permission denied/
);
await db.query(`reset role`);
assert.deepEqual(Object.keys(ping).sort(), [
  'database',
  'database_time',
  'overall_state',
  'states'
]);
assert.equal(ping.database, 'responding');
assert.equal(ping.states.DatabaseBackup, 'Stale');
assert.ok(
  !JSON.stringify(ping).includes('DR-DRILL'),
  'no evidence details leave the database for anon'
);

// ------------------------------------------------------------ release gate: switched off means nothing is recorded, and says so
await system(
  `update public.release_modes set mode = 'Disabled', authorised_job_scope = 'None' where function_id = 'FN-14'`
);
before = await snapshot();
assert.equal(
  (await record('ben', backup({ performed_at: at(6), subject_at: at(6, -60) })))
    .error,
  'R1A_MODE_DENIED'
);
await assert.rejects(
  system(
    `select app.record_operational_evidence('StorageBackup', 'Verified', $1, $2, 'method', 'ref-1', 'backup-verifier')`,
    [at(6), at(6)]
  ),
  /R1A_MODE_DENIED/
);
assert.equal(await snapshot(), before);
h = await health(at(5, 56));
assert.equal(item(h, 'Scheduler').state, 'Unknown');
assert.match(item(h, 'Scheduler').detail, /FN-14.*not switched on/);
assert.equal(item(h, 'ReleaseFunctions').monitoring_enabled, false);
assert.equal(item(h, 'ReleaseFunctions').state, 'Verified');
assert.equal(
  item(h, 'DatabaseBackup').state,
  'Verified',
  'evidence already recorded still counts'
);
// An inconsistent gate (Disabled but scoped) is a failure, as in the reference.
await system(
  `update public.release_modes set authorised_job_scope = 'Pilot' where function_id = 'FN-14'`
);
assert.equal(item(await health(at(5, 56)), 'ReleaseFunctions').state, 'Failed');

console.log('P0 OPERATIONAL HEALTH TESTS PASSED');
process.exit(0);
