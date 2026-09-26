// R2 calendar (FN-02) + resource planning + generic outbox worker protocol.
// PORT_EXTRA=20260919164000_r2_calendar_resourcing.sql node t_calendar.mjs
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, read, as, id, ok } = f;
const { job } = await readyToBook(f);

const count = async (t, where = 'true', p = []) =>
  (
    await one(
      `select count(*)::int n from ${t.includes('.') ? t : 'public.' + t} where ${where}`,
      p
    )
  ).n;
const snapshot = async () => {
  const out = {};
  for (const t of [
    'audit_events',
    'tasks',
    'task_events',
    'outbox',
    'calendar_links',
    'allocations',
    'person_skills',
    'person_availability',
    'teams',
    'team_members'
  ])
    out[t] = await count(t);
  out.versions = (
    await all(`select id, version from public.jobs union all select id, version from public.work_packages
    union all select id, version from public.allocations union all select id, version from public.calendar_links
    union all select id, version from public.person_skills union all select id, version from public.teams order by 1`)
  )
    .map((r) => r.id + ':' + r.version)
    .join(',');
  out.outbox = (
    await all(`select id, status, attempt_count from public.outbox order by id`)
  )
    .map((r) => r.id + r.status + r.attempt_count)
    .join(',');
  return out;
};
const expectRefusal = async (who, req, code) => {
  const before = await snapshot();
  const r = await cmd(who, req);
  assert.equal(r.error, code, JSON.stringify(r));
  assert.deepEqual(
    await snapshot(),
    before,
    'refusal wrote something: ' + code
  );
};
// Worker calls run without a user (service role).
const sql = async (q, p = []) => {
  await as(null);
  return (await db.query(q, p)).rows[0]?.r;
};
const sqlErr = async (q, p = []) => {
  try {
    await sql(q, p);
    return null;
  } catch (e) {
    return e.message;
  }
};
const expectSqlRefusal = async (q, code, p = []) => {
  const before = await snapshot();
  assert.equal(await sqlErr(q, p), code);
  assert.deepEqual(
    await snapshot(),
    before,
    'refusal wrote something: ' + code
  );
};
const CAL = `array['CalendarCreate','CalendarUpdate','CalendarCancel']`;
const claim = () => sql(`select app.outbox_claim(${CAL}, 20) r`);
const success = (o, ext, s) =>
  sql(`select app.outbox_record_success($1, $2, $3) r`, [o, ext, s]);
const failure = (o, t, e) =>
  sql(`select app.outbox_record_failure($1, $2, $3) r`, [o, t, e]);
const uncertain = (o, s) =>
  sql(`select app.outbox_record_uncertain($1, $2) r`, [o, s]);
const outRow = (o) => one(`select * from public.outbox where id=$1`, [o]);
const linkRow = (l) =>
  one(`select * from public.calendar_links where id=$1`, [l]);
const wpRow = (w) => one(`select * from public.work_packages where id=$1`, [w]);
const setSetting = async (key, value) => {
  const v = (
    await one(
      `select coalesce(max(version),0)+1 v from public.settings where key=$1 and scope='Global'`,
      [key]
    )
  ).v;
  await db.query(
    `insert into public.settings (key, typed_value, scope, version, effective_from) values ($1,$2::jsonb,'Global',$3,'2026-01-01')`,
    [key, JSON.stringify(value), v]
  );
};
const readX = async (who, req) => {
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
const d = (x) => (x instanceof Date ? x.toISOString() : String(x)).slice(0, 10);

// ---- seed booked work (booking intake is another module) --------------------
const roof = (
  await one(
    `insert into public.work_packages (job_id, trade, required, status, commissioning_required, sequence)
  values ($1,'Roof',true,'Unscheduled',false,1) returning id`,
    [job]
  )
).id;
const elec = (
  await one(
    `insert into public.work_packages (job_id, trade, required, status, commissioning_required, sequence)
  values ($1,'Electrical',true,'Unscheduled',true,2) returning id`,
    [job]
  )
).id;
await setSetting(
  'calendar.shared_calendar_id',
  'cal-shared@group.calendar.google.com'
);

// =============================================================================
// Resource planning configuration
// =============================================================================
const skill = (person, skill, extra = {}) => ({
  command_id: id(),
  command_type: 'RP_SET_SKILL',
  payload: { person_id: person, skill, ...extra }
});
await expectRefusal('store', skill(people.inst_a, 'Roof'), 'R1A_ROLE_DENIED');
await expectRefusal('hannah', skill(people.inst_a, 'Roof'), 'R1A_ROLE_DENIED');
await expectRefusal(
  'tanya',
  skill(people.tanya, 'Roof'),
  'RP_REVIEW: active Installer required'
);
await expectRefusal(
  'tanya',
  skill(people.inst_a, 'Plumbing'),
  'RP_REVIEW: skill must be Roof or Electrical'
);
await expectRefusal(
  'tanya',
  skill(people.inst_a, 'Roof', { level: 'Boss' }),
  'RP_REVIEW: level must be Lead, Member or Apprentice'
);
await expectRefusal(
  'tanya',
  skill(people.inst_a, 'Roof', { certified_until: '2026-02-30' }),
  'RP_DATE_INVALID: invalid calendar date'
);
await expectRefusal(
  'tanya',
  skill(people.inst_a, 'Roof', { colour: 'red' }),
  'R1A_INVALID_FIELDS'
);
const sk1 = skill(people.inst_a, 'Roof', {
  level: 'Lead',
  certified_until: '2026-10-12'
});
let r = ok(await cmd('tanya', sk1), 'skill');
assert.equal(r.status, 'Created');
assert.equal(r.skill.skill_code, 'Roof');
assert.equal(r.skill.level, 'Lead');
let rp = await cmd('tanya', sk1);
assert.equal(rp.replayed, true);
assert.equal(rp.result.skill.id, r.skill.id);
assert.equal(
  (await cmd('tanya', { ...sk1, payload: { ...sk1.payload, level: 'Member' } }))
    .error,
  'R1A_COMMAND_CONFLICT'
);
assert.equal(
  await count(
    'audit_events',
    `entity_type='PersonSkills' and action='SetSkill'`
  ),
  1
);
await expectRefusal(
  'tanya',
  { ...skill(people.inst_a, 'Roof', { level: 'Lead' }), expected_version: 9 },
  'R1A_STALE_VERSION'
);
r = ok(
  await cmd('tanya', skill(people.inst_a, 'Roof', { level: 'Lead' })),
  'skill update'
);
assert.equal(r.status, 'Updated');
assert.equal(r.skill.certified_until, null);
assert.equal(r.skill.version, 2);
ok(await cmd('ben', skill(people.inst_b, 'Electrical')), 'skill b');

// availability
const avail = (extra = {}) => ({
  command_id: id(),
  command_type: 'RP_SET_AVAILABILITY',
  payload: {
    person_id: people.inst_b,
    type: 'Leave',
    from_date: '2026-10-14',
    to_date: '2026-10-16',
    reason: 'Holiday',
    ...extra
  }
});
await expectRefusal(
  'tanya',
  avail({ type: 'Party' }),
  'RP_REVIEW: type must be Leave, Sick, Training, Unavailable or Available'
);
await expectRefusal(
  'tanya',
  avail({ to_date: '2026-10-01' }),
  'RP_REVIEW: to_date before from_date'
);
await expectRefusal(
  'tanya',
  avail({ from_date: null }),
  'RP_REVIEW: from_date required'
);
await expectRefusal('dan', avail(), 'R1A_ROLE_DENIED');
r = ok(await cmd('tanya', avail()), 'leave');
assert.equal(r.status, 'Created');
assert.equal(r.replan_required, false);
assert.equal(r.availability.approved_by, people.tanya);
const leaveB = r.availability.id;

// teams
const team = (extra = {}) => ({
  command_id: id(),
  command_type: 'RP_UPSERT_TEAM',
  payload: { name: 'Roof Crew A', trade: 'Mixed', ...extra }
});
await expectRefusal(
  'tanya',
  team({ trade: 'Plumbing' }),
  'RP_REVIEW: trade must be Roof, Electrical or Mixed'
);
await expectRefusal('tanya', team({ name: ' ' }), 'RP_REVIEW: name required');
r = ok(await cmd('tanya', team()), 'team');
assert.equal(r.status, 'Created');
const teamId = r.team.id;
r = ok(
  await cmd('tanya', team({ name: 'roof  crew a!', notes: 'same slug' })),
  'team slug upsert'
);
assert.equal(r.status, 'Updated');
assert.equal(r.team.id, teamId);
const member = (person, role, extra = {}) => ({
  command_id: id(),
  command_type: 'RP_SET_TEAM_MEMBER',
  payload: { team_id: teamId, person_id: person, role, ...extra }
});
ok(await cmd('tanya', member(people.inst_a, 'Lead')), 'lead');
await expectRefusal(
  'tanya',
  member(people.inst_b, 'Lead'),
  `RP_REVIEW: team already has an active Lead (${people.inst_a}); change that member first`
);
await expectRefusal(
  'tanya',
  member(people.tanya, 'Member'),
  'RP_REVIEW: active Installer required'
);
await expectRefusal(
  'tanya',
  {
    ...member(people.inst_b, 'Member'),
    payload: { team_id: id(), person_id: people.inst_b }
  },
  'RP_REVIEW: team not found'
);
ok(await cmd('tanya', member(people.inst_b, 'Member')), 'member');

// assessment reads
let a = (
  await readX('tanya', {
    read_type: 'RP_ASSESS',
    trade: 'Roof',
    start_at: '2026-10-14',
    end_at: '2026-10-15'
  })
).data;
const byId = (res, pid) => res.candidates.find((c) => c.person_id === pid);
assert.equal(byId(a, people.inst_a).ready, true);
assert.deepEqual(byId(a, people.inst_b).reasons.sort(), [
  'ON_LEAVE',
  'SKILL_MISMATCH'
]);
assert.equal(a.candidates[0].person_id, people.inst_a, 'ready ranked first');
assert.equal(a.working_days, 2);
a = (
  await readX('tanya', {
    read_type: 'RP_ASSESS',
    trade: 'Electrical',
    start_at: '2026-10-14',
    end_at: '2026-10-14',
    team_id: teamId
  })
).data;
assert.equal(a.team.lead_person_id, people.inst_a);
assert.equal(a.team.all_ready, false);
assert.equal(a.team.lead_ready, false);
assert.equal(
  (
    await readX('tanya', {
      read_type: 'RP_ASSESS',
      trade: 'Gas',
      start_at: '2026-10-14',
      end_at: '2026-10-14'
    })
  ).error,
  'RP_REVIEW: trade must be Roof or Electrical'
);
assert.equal(
  (
    await readX('tanya', {
      read_type: 'RP_ASSESS',
      trade: 'Roof',
      start_at: '2026-10-14'
    })
  ).error,
  'RP_REVIEW: start and end dates required'
);
assert.equal(
  (await readX('tanya', { read_type: 'RP_ASSESS', trade: 'Roof', bogus: 1 }))
    .error,
  'R1A_INVALID_FIELDS'
);
assert.equal(
  (await readX('store', { read_type: 'RP_TEAMS' })).error,
  'R1A_ROLE_DENIED'
);
const teams = (await readX('dan', { read_type: 'RP_TEAMS' })).data.teams;
assert.equal(teams.length, 1);
assert.equal(teams[0].members.length, 2);
assert.equal(teams[0].lead, people.inst_a);

// =============================================================================
// S11 R2 planning commands
// =============================================================================
const plan = (wp, person, start, end, ver, extra = {}) => ({
  command_id: id(),
  command_type: 'PLAN_WORK_PACKAGE',
  job_id: job,
  work_package_id: wp,
  expected_version: ver,
  payload: { person_id: person, start_at: start, end_at: end, ...extra }
});
let w = await wpRow(roof);
await expectRefusal(
  'tanya',
  plan(roof, people.inst_a, '2026-10-12', '2026-10-13', w.version),
  'R1A_MODE_DENIED'
);
await db.query(
  `update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id='FN-02'`
);
await expectRefusal(
  'store',
  plan(roof, people.inst_a, '2026-10-12', '2026-10-13', w.version),
  'R1A_ROLE_DENIED'
);
await expectRefusal(
  'tanya',
  plan(roof, people.inst_a, '2026-10-12', '2026-10-13', w.version + 1),
  'R1A_STALE_VERSION'
);
await expectRefusal(
  'tanya',
  plan(roof, people.inst_a, '2026-10-13', '2026-10-12', w.version),
  'S11_DATE_INVALID: end before start'
);
await expectRefusal(
  'tanya',
  {
    ...plan(roof, people.inst_a, '2026-10-12', '2026-10-13', w.version),
    work_package_id: id()
  },
  'S11_REVIEW: work package linkage invalid'
);
await expectRefusal(
  'tanya',
  plan(roof, people.inst_a, '2026-10-12', '2026-10-13', w.version, {
    role: 'Boss'
  }),
  'S11_REVIEW: invalid role'
);
// ineligible installers: NeedsReview, nothing written
const nr = async (req, reason) => {
  const before = await snapshot();
  const res = ok(await cmd('tanya', req), 'needs review ' + reason);
  assert.equal(res.status, 'NeedsReview');
  assert.equal(res.reason, reason, JSON.stringify(res));
  assert.deepEqual(await snapshot(), before);
  return res;
};
let res = await nr(
  plan(roof, people.inst_b, '2026-10-12', '2026-10-13', w.version),
  'SKILL_MISMATCH'
);
assert.deepEqual(res.detail.skills, ['Electrical']);
await nr(
  plan(
    elec,
    people.inst_b,
    '2026-10-15',
    '2026-10-15',
    (await wpRow(elec)).version
  ),
  'ON_LEAVE'
);
const hol = (
  await one(
    `insert into public.holidays (local_date, description) values ('2026-10-20','Closure') returning id`
  )
).id;
await nr(
  plan(
    elec,
    people.inst_b,
    '2026-10-19',
    '2026-10-20',
    (await wpRow(elec)).version
  ),
  'OFFICE_HOLIDAY'
);
await nr(
  plan(roof, people.tanya, '2026-10-12', '2026-10-13', w.version),
  'INSTALLER_INACTIVE_OR_WRONG_ROLE'
);

const pl = plan(roof, people.inst_a, '2026-10-12', '2026-10-13', w.version);
r = ok(await cmd('tanya', pl), 'plan roof');
assert.equal(r.status, 'Planned');
assert.equal(r.external_calls, 0);
assert.equal(r.allocation.role, 'Lead');
assert.equal(r.work_package.status, 'Scheduled');
assert.equal(r.work_package.revision, 2);
const allocA = r.allocation.id;
let al = await one(`select * from public.allocations where id=$1`, [allocA]);
const link1 = al.calendar_link_id;
assert.ok(link1);
let lk = await linkRow(link1);
assert.equal(lk.status, 'Pending');
assert.equal(lk.calendar_id, 'cal-shared@group.calendar.google.com');
const outPlan = lk.outbox_id;
let o = await outRow(outPlan);
assert.equal(o.action_type, 'CalendarCreate');
assert.equal(o.status, 'Pending');
assert.equal(o.response_summary, 'CAPTURE_ONLY: no Calendar API call');
assert.equal(o.idempotency_key, `S11-CALENDAR-${pl.command_id}-UPSERT`);
assert.equal(
  r.calendar.payload.end_at,
  '2026-10-14',
  'all-day end is exclusive'
);
rp = await cmd('tanya', pl);
assert.equal(rp.replayed, true);
assert.equal(await count('allocations'), 1);
assert.equal(await count('outbox'), 1);
assert.equal(
  (
    await cmd('tanya', {
      ...pl,
      payload: { ...pl.payload, start_at: '2026-10-11' }
    })
  ).error,
  'R1A_COMMAND_CONFLICT'
);
assert.equal(
  d(
    (await one(`select next_action_at from public.jobs where id=$1`, [job]))
      .next_action_at
  ) <= '2026-10-12',
  true
);

// availability now conflicts with the planned allocation
r = ok(
  await cmd(
    'tanya',
    avail({
      person_id: people.inst_a,
      from_date: '2026-10-13',
      to_date: null,
      type: 'Sick'
    })
  ),
  'sick'
);
assert.equal(r.replan_required, true);
assert.equal(r.allocation_conflicts[0].allocation_id, allocA);
const sickA = r.availability.id;
const cancelAv = {
  command_id: id(),
  command_type: 'RP_CANCEL_AVAILABILITY',
  payload: { availability_id: sickA }
};
await expectRefusal('tanya', cancelAv, 'RP_REVIEW: reason required');
await expectRefusal(
  'tanya',
  { ...cancelAv, payload: { availability_id: id(), reason: 'x' } },
  'RP_REVIEW: availability not found'
);
r = ok(
  await cmd('tanya', {
    ...cancelAv,
    payload: { availability_id: sickA, reason: 'Recovered' }
  }),
  'cancel sick'
);
assert.equal(r.availability.active, false);

// change-installer options / move preview / team planner / status reads
a = (
  await readX('tanya', {
    read_type: 'RP_CHANGE_INSTALLER_OPTIONS',
    work_package_id: roof,
    old_allocation_id: allocA
  })
).data;
assert.equal(a.trade, 'Roof');
assert.equal(a.current_allocations.length, 1);
assert.equal(byId(a, people.inst_a).currently_allocated, true);
assert.equal(byId(a, people.inst_a).ready, true);
assert.equal(a.teams.length, 1);
assert.equal(a.teams[0].members.length, 2);
const pv = (
  await readX('tanya', {
    read_type: 'RP_MOVE_JOB_PREVIEW',
    job_id: job,
    activities: ['Roof'],
    planned_start: '2026-10-19',
    planned_end: '2026-10-21'
  })
).data;
assert.equal(pv.work_packages.length, 1);
assert.equal(pv.preserved.length, 1);
assert.deepEqual(pv.work_packages[0].people[0].reasons, ['OFFICE_HOLIDAY']);
assert.equal(pv.ok_to_move, false);
assert.equal(pv.calendar_links, 1);
assert.equal(
  (
    await readX('tanya', {
      read_type: 'RP_MOVE_JOB_PREVIEW',
      job_id: job,
      activities: []
    })
  ).error,
  'RP_REVIEW: select at least one activity (Roof|Electrical|Scaffold)'
);
const tp = (
  await readX('tanya', {
    read_type: 'RP_TEAM_PLANNER',
    start: '2026-10-12',
    weeks: 3
  })
).data;
assert.equal(tp.to, '2026-11-01');
assert.deepEqual(tp.holidays, ['2026-10-20']);
assert.equal(
  tp.teams[0].members.find((m) => m.person_id === people.inst_a).allocations
    .length,
  1
);
assert.equal(
  tp.teams[0].members.find((m) => m.person_id === people.inst_b).leave.length,
  1
);
assert.equal(tp.unallocated_work.length, 0, 'elec has no planned dates');
const st = (await readX('tanya', { read_type: 'RP_STATUS' })).data;
assert.equal(st.installers, 2);
assert.equal(st.installers_with_skills, 2);
assert.equal(st.teams, 1);

// MOVE_WORK_PACKAGE
await db.query(`update public.jobs set workflow_stage='Booked' where id=$1`, [
  job
]);
w = await wpRow(roof);
const mvw = (start, end, extra = {}, ver = w.version) => ({
  command_id: id(),
  command_type: 'MOVE_WORK_PACKAGE',
  job_id: job,
  work_package_id: roof,
  expected_version: ver,
  payload: {
    allocation_id: allocA,
    start_at: start,
    end_at: end,
    reason: 'Customer agreed',
    ...extra
  }
});
await expectRefusal(
  'tanya',
  mvw('2026-10-26', '2026-10-27', { reason: null }),
  'S11_REVIEW: move reason required'
);
await expectRefusal(
  'tanya',
  mvw('2026-10-26', '2026-10-27', { allocation_id: id() }),
  'S11_REVIEW: active allocation linkage invalid'
);
await expectRefusal(
  'tanya',
  mvw('2026-10-26', '2026-10-27', {}, w.version + 1),
  'R1A_STALE_VERSION'
);
await nr(mvw('2026-10-19', '2026-10-21'), 'OFFICE_HOLIDAY');
const s15 = (
  await one(
    `insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, status, created_rule_version)
  values ($1::uuid,'S15-REOPEN-REVIEW','S15-TEST-'||$1::text,'Cancellation','Review',$2,'Open','S15-1.0') returning id`,
    [job, people.tanya]
  )
).id;
await expectRefusal(
  'tanya',
  mvw('2026-10-26', '2026-10-27'),
  'S15_REVIEW: normal work suppressed'
);
await db.query(`update public.tasks set status='Complete' where id=$1`, [s15]);
const mv1 = mvw('2026-10-26', '2026-10-27');
r = ok(await cmd('tanya', mv1), 'move');
assert.equal(r.status, 'Moved');
assert.equal(r.work_package.revision, 3);
assert.equal(r.allocation.start_at, '2026-10-26');
lk = await linkRow(link1);
assert.equal(lk.id, r.calendar.link.id, 'same link re-queued');
const outMove1 = lk.outbox_id;
assert.notEqual(outMove1, outPlan);
assert.equal((await outRow(outMove1)).action_type, 'CalendarCreate');
assert.equal(
  await count('audit_events', `command_id=$1 and action='Move'`, [
    mv1.command_id
  ]),
  2
);

// =============================================================================
// Generic outbox protocol + calendar worker
// =============================================================================
await expectSqlRefusal(
  `select app.outbox_claim(array['Nope'], 5) r`,
  'OUTBOX_REFUSED: unregistered action type Nope'
);
await expectSqlRefusal(
  `select app.outbox_claim(array['XeroInvoice'], 5) r`,
  'OUTBOX_REFUSED: FN-09 must be Automated'
);
await db.query(
  `update public.release_modes set mode='Disabled' where function_id='FN-02'`
);
await expectSqlRefusal(
  `select app.outbox_claim(${CAL}, 5) r`,
  'OUTBOX_REFUSED: FN-02 must be Automated'
);
await db.query(
  `update public.release_modes set mode='Automated' where function_id='FN-02'`
);

// CAPTURE (default): due rows reported, nothing written
let before = await snapshot();
let c = await claim();
assert.equal(c.claimed.length, 0);
assert.equal(c.skipped.length, 2);
assert.ok(c.skipped.every((s) => s.reason === 'CAPTURE_MODE'));
assert.deepEqual(await snapshot(), before, 'capture wrote something');
let pvw = (await readX('tanya', { read_type: 'CALENDAR_DISPATCH_PREVIEW' }))
  .data;
assert.equal(pvw.mode, 'CAPTURE');
assert.equal(pvw.planned.length, 2);
assert.ok(
  pvw.planned.every((p) => p.would.startsWith('Refused:CAL_REFUSED')),
  JSON.stringify(pvw)
);

// LIVE without the shared calendar allow-listed: refused, nothing written
await setSetting('calendar.mode', 'LIVE');
await expectSqlRefusal(
  `select app.outbox_claim(${CAL}, 5) r`,
  'CAL_REFUSED: LIVE mode requires calendar.shared_calendar_id in calendar.allowed_calendar_ids'
);
await setSetting('calendar.allowed_calendar_ids', [
  'cal-shared@group.calendar.google.com'
]);
let cs = (await readX('ben', { read_type: 'CALENDAR_STATUS' })).data;
assert.equal(cs.live_ready, true);
assert.equal(cs.outbox.due_now, 2);
assert.equal(cs.links.total, 1);
assert.equal(
  (await readX('dan', { read_type: 'CALENDAR_STATUS' })).error,
  'R1A_ROLE_DENIED'
);
pvw = (await readX('tanya', { read_type: 'CALENDAR_DISPATCH_PREVIEW' })).data;
assert.deepEqual(
  pvw.planned.map((p) => p.would),
  ['Cancel:SUPERSEDED', 'create']
);

// claim: superseded plan row cancelled, move row claimed as a create
c = await claim();
assert.equal(c.settled.length, 1);
assert.equal(c.settled[0].outbox_id, outPlan);
assert.equal(c.settled[0].outcome, 'Cancelled');
assert.match(
  (await outRow(outPlan)).response_summary,
  /^SUPERSEDED: calendar link/
);
assert.equal(c.claimed.length, 1);
let item = c.claimed[0];
assert.equal(item.outbox_id, outMove1);
assert.equal(item.attempt, 1);
assert.equal(item.prior_uncertain, false);
assert.equal(item.work.operation, 'create');
assert.equal(item.work.calendar_id, 'cal-shared@group.calendar.google.com');
assert.equal(item.work.event.start, '2026-10-26');
assert.equal(item.work.event.end, '2026-10-28');
assert.equal(item.work.event.tag, `[SSO:${link1}]`);
assert.ok(item.work.event.description.includes(`[SSO:${link1}]`));
assert.match(item.work.event.title, / — Roof$/);
o = await outRow(outMove1);
assert.equal(o.status, 'Processing');
assert.equal(o.attempt_count, 1);
assert.ok(o.claimed_at);
assert.ok((await linkRow(link1)).last_attempt_at, 'link attempt stamped');
assert.equal(
  (await claim()).claimed.length,
  0,
  'processing rows are not claimed twice'
);
// success persists the external id; replay; late failure refused
r = await success(
  outMove1,
  'evt-1',
  'CREATED: calendar event (2026-10-26→2026-10-28)'
);
assert.equal(r.outcome, 'Succeeded');
assert.equal(r.replay, false);
lk = await linkRow(link1);
assert.equal(lk.status, 'Active');
assert.equal(lk.external_event_id, 'evt-1');
assert.equal(lk.event_uid, 'evt-1');
assert.equal(lk.last_synced_revision, lk.entity_revision);
assert.equal(lk.error, null);
assert.equal((await success(outMove1, 'evt-1', 'again')).replay, true);
await expectSqlRefusal(
  `select app.outbox_record_failure('${outMove1}', true, 'late') r`,
  'OUTBOX_NOT_PROCESSING'
);
await expectSqlRefusal(
  `select app.outbox_record_success('${id()}', 'x', 'y') r`,
  'OUTBOX_NOT_FOUND'
);
const audC = await one(
  `select * from public.audit_events where entity_type='CalendarLinks' and action='CalendarCreate'`
);
assert.equal(audC.executing_service, 'CalendarService');
assert.equal(audC.initiating_person_id, null);
assert.equal(
  await count(
    'audit_events',
    `entity_type='Outbox' and entity_id=$1 and action in ('OutboxClaimed','OutboxSucceeded')`,
    [outMove1]
  ),
  2
);

// move again -> CalendarUpdate on the same event; transient failures back off 1,2,4,8 then review
w = await wpRow(roof);
r = ok(
  await cmd('tanya', mvw('2026-10-28', '2026-10-29', {}, w.version)),
  'move 2'
);
const outUpd = (await linkRow(link1)).outbox_id;
assert.equal((await outRow(outUpd)).action_type, 'CalendarUpdate');
c = await claim();
item = c.claimed[0];
assert.equal(item.work.operation, 'update');
assert.equal(item.work.external_event_id, 'evt-1');
assert.equal(item.work.if_event_missing, 'review');
const backoffs = [];
for (let attempt = 1; attempt <= 5; attempt++) {
  if (attempt > 1) {
    assert.equal((await claim()).claimed.length, 0, 'not due yet');
    await db.query(
      `update public.outbox set next_attempt = now() - interval '1 second' where id=$1`,
      [outUpd]
    );
    c = await claim();
    assert.equal(c.claimed[0].attempt, attempt);
    assert.equal(c.claimed[0].prior_uncertain, true);
  }
  r = await failure(outUpd, true, 'HTTP 503');
  if (attempt < 5) {
    assert.equal(r.status, 'RetryDue');
    assert.equal(r.summary, `RETRY_DUE attempt ${attempt}: HTTP 503`);
    backoffs.push(Math.round((new Date(r.next_attempt) - Date.now()) / 60000));
    lk = await linkRow(link1);
    assert.equal(lk.status, 'Error');
  } else {
    assert.equal(r.status, 'NeedsReview');
    assert.equal(r.summary, 'NEEDS_REVIEW MAX_RETRIES_EXCEEDED: HTTP 503');
  }
}
assert.deepEqual(backoffs, [1, 2, 4, 8]);
assert.equal(
  await count(
    'audit_events',
    `entity_type='CalendarLinks' and action='CalendarUpdateRetry'`
  ),
  4
);
assert.equal(
  await count(
    'audit_events',
    `entity_type='CalendarLinks' and action='CalendarUpdateFailed'`
  ),
  1
);
cs = (await readX('tanya', { read_type: 'CALENDAR_STATUS' })).data;
assert.equal(cs.needs_review.length, 1);
assert.equal(cs.needs_review[0].link_id, link1);
// S16 health / review queue still read the outbox (statuses unchanged)
const hs = await sql(`select app.health_status() r`);
assert.ok(JSON.stringify(hs).includes(outUpd));
const rq = await sql(`select app.review_queue() r`);
assert.equal(
  rq.items.find((i) => i.id === outUpd).owner_service,
  'CalendarService'
);
// RS-REVIEW task for it (S16 sweep helper), completed by the calendar resolution
await db.query(
  `insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, status, created_rule_version, related_entity_type, related_entity_id)
  values ($1,'RS-REVIEW',$2,'System','Review',$3,'Open','RS-1.0','Outbox',$4)`,
  [job, `RS-REVIEW-Outbox-${outUpd}`, people.tanya, outUpd]
);

// human review resolution
const resolve = (outbox, resolution, extra = {}) => ({
  command_id: id(),
  command_type: 'CALENDAR_REVIEW_RESOLVE',
  payload: {
    outbox_id: outbox,
    resolution,
    reason: 'Checked calendar',
    ...extra
  }
});
await expectRefusal('dan', resolve(outUpd, 'Retry'), 'R1A_ROLE_DENIED');
await expectRefusal(
  'tanya',
  resolve(outUpd, 'Guess'),
  'CAL_REVIEW: resolution must be AdoptEvent, MarkCancelled, Retry or Retarget'
);
await expectRefusal(
  'tanya',
  resolve(outUpd, 'Retry', { reason: null }),
  'CAL_REVIEW: outbox_id and reason required'
);
await expectRefusal(
  'tanya',
  resolve(outUpd, 'AdoptEvent'),
  'CAL_REVIEW: external_event_id required to adopt'
);
await expectRefusal(
  'tanya',
  resolve(outMove1, 'Retry'),
  'CAL_REVIEW: outbox status Succeeded is not reviewable'
);
await expectRefusal(
  'tanya',
  resolve(id(), 'Retry'),
  'CAL_REVIEW: calendar outbox row not found'
);
const rs1 = resolve(outUpd, 'Retry');
r = ok(await cmd('ben', rs1), 'retry');
assert.equal(r.outbox_status, 'Pending');
assert.equal(r.link_status, 'UpdatePending');
assert.equal(r.completed_tasks.length, 1);
assert.equal((await cmd('ben', rs1)).replayed, true);
c = await claim();
assert.equal(c.claimed[0].attempt, 6);
r = await uncertain(outUpd, 'UNCERTAIN_OUTCOME: update returned no event id');
assert.equal(r.status, 'NeedsReview');
assert.equal(
  r.summary,
  'NEEDS_REVIEW UNCERTAIN_OUTCOME: update returned no event id'
);
r = ok(
  await cmd(
    'tanya',
    resolve(outUpd, 'AdoptEvent', { external_event_id: 'evt-2' })
  ),
  'adopt'
);
assert.equal(r.outbox_status, 'Succeeded');
assert.equal(r.link_status, 'Active');
lk = await linkRow(link1);
assert.equal(lk.external_event_id, 'evt-2');
assert.equal(
  await count(
    'audit_events',
    `entity_type='CalendarLinks' and action='CalendarReviewAdoptEvent'`
  ),
  1
);

// drift detection
let cand = await sql(`select app.calendar_drift_candidates(10) r`);
assert.equal(cand.length, 1);
assert.equal(cand[0].expected.start, '2026-10-28');
r = await sql(`select app.calendar_record_drift($1, $2::jsonb) r`, [
  link1,
  { start: '2026-10-28', end: '2026-10-30', title: cand[0].expected.title }
]);
assert.equal(r.drift, false);
r = await sql(`select app.calendar_record_drift($1, $2::jsonb) r`, [
  link1,
  { start: '2026-10-29', end: '2026-10-30', title: cand[0].expected.title }
]);
assert.equal(r.drift, true);
assert.equal(r.task_created, true);
const drift = await one(`select * from public.tasks where id=$1`, [r.task_id]);
assert.equal(drift.template_code, 'CAL-DRIFT');
assert.equal(drift.related_entity_id, link1);
assert.match((await linkRow(link1)).error, /^EXTERNAL_EDIT: start 2026-10-29/);
r = await sql(`select app.calendar_record_drift($1, $2::jsonb) r`, [
  link1,
  { start: '2026-10-29', end: '2026-10-30', title: cand[0].expected.title }
]);
assert.equal(r.task_created, false);
assert.equal(await count('audit_events', `action='CalendarExternalEdit'`), 1);
assert.equal(
  d((await wpRow(roof)).planned_start),
  '2026-10-28',
  'drift never moves the job'
);

// CHANGE_INSTALLER_R2: skill-aware; Replace cancels the old event and creates the new one
w = await wpRow(roof);
const ci = (person, mode, extra = {}, ver = w.version) => ({
  command_id: id(),
  command_type: 'CHANGE_INSTALLER_R2',
  job_id: job,
  work_package_id: roof,
  old_allocation_id: allocA,
  expected_version: ver,
  payload: { person_id: person, mode, reason: 'Lead off', ...extra }
});
await expectRefusal(
  'tanya',
  ci(people.inst_b, 'Swap'),
  'S11_REVIEW: mode and reason required'
);
await expectRefusal(
  'tanya',
  ci(people.inst_b, 'Replace', {}, w.version + 1),
  'R1A_STALE_VERSION'
);
await nr(ci(people.inst_b, 'Replace'), 'SKILL_MISMATCH');
ok(
  await cmd('tanya', skill(people.inst_b, 'Roof', { level: 'Apprentice' })),
  'b roof'
);
const chg = ci(people.inst_b, 'Replace');
r = ok(await cmd('tanya', chg), 'replace');
assert.equal(r.status, 'Replaced');
assert.equal(r.allocation.role, 'Lead');
assert.equal(r.old_allocation.active, false);
const allocB = r.allocation.id;
const outCancel = r.calendar_cancel.id;
const link2 = r.calendar.link.id;
const outCreate2 = r.calendar.outbox.id;
assert.equal((await linkRow(link1)).status, 'Cancelled');
// options read now ranks the apprentice with a warning
a = (
  await readX('tanya', {
    read_type: 'RP_ASSESS',
    trade: 'Roof',
    start_at: '2026-10-28',
    end_at: '2026-10-29',
    person_ids: [people.inst_b]
  })
).data;
assert.deepEqual(a.candidates[0].warnings, ['APPRENTICE_NEEDS_SUPERVISION']);

c = await claim();
assert.equal(c.claimed.length, 2);
const del = c.claimed.find((x) => x.outbox_id === outCancel),
  cre = c.claimed.find((x) => x.outbox_id === outCreate2);
assert.equal(del.work.operation, 'delete');
assert.equal(del.work.external_event_id, 'evt-2');
assert.equal(cre.work.operation, 'create');
r = await success(outCancel, null, 'DELETED: calendar event removed');
lk = await linkRow(link1);
assert.equal(lk.status, 'Cancelled');
assert.equal(lk.external_event_id, 'evt-2');
assert.equal((await outRow(outCancel)).external_id, 'evt-2');
// the create stalls (worker crashed): released after 15 minutes, then reconciled by tag
assert.equal((await sql(`select app.outbox_release_stalled() r`)).count, 0);
await db.query(
  `update public.outbox set claimed_at = now() - interval '16 minutes' where id=$1`,
  [outCreate2]
);
r = await sql(`select app.outbox_release_stalled() r`);
assert.deepEqual(r.released, [outCreate2]);
o = await outRow(outCreate2);
assert.equal(o.status, 'RetryDue');
assert.equal(
  o.response_summary,
  'STALLED: Processing for >15 min; reconcile before retry'
);
assert.equal(
  (await linkRow(link2)).error,
  'STALLED: prior attempt outcome unknown'
);
assert.equal(
  await count(
    'audit_events',
    `entity_type='CalendarLinks' and action='CalendarStalled'`
  ),
  1
);
c = await claim();
item = c.claimed[0];
assert.equal(item.outbox_id, outCreate2);
assert.equal(item.work.operation, 'reconcile-then-create');
assert.equal(item.attempt, 2);
r = await failure(
  outCreate2,
  false,
  'DUPLICATE_EVENTS: tag matched 2 events: e1,e2'
);
assert.equal(r.status, 'NeedsReview');
assert.equal(
  r.summary,
  'NEEDS_REVIEW DUPLICATE_EVENTS: tag matched 2 events: e1,e2'
);
r = ok(
  await cmd('tanya', resolve(outCreate2, 'MarkCancelled')),
  'mark cancelled'
);
assert.equal(r.outbox_status, 'Cancelled');
assert.equal(r.link_status, 'Cancelled');

// target checks before any call: wrong calendar -> review -> Retarget -> create
ok(
  await cmd(
    'tanya',
    plan(
      elec,
      people.inst_b,
      '2026-10-21',
      '2026-10-21',
      (await wpRow(elec)).version
    )
  ),
  'plan elec'
);
const link3 = (
  await one(
    `select calendar_link_id from public.allocations where work_package_id=$1 and active`,
    [elec]
  )
).calendar_link_id;
const outElec = (await linkRow(link3)).outbox_id;
await db.query(
  `update public.calendar_links set calendar_id='someone-else@calendar' where id=$1`,
  [link3]
);
c = await claim();
assert.equal(c.claimed.length, 0);
assert.equal(c.settled[0].code, 'CALENDAR_TARGET_NOT_SHARED');
o = await outRow(outElec);
assert.equal(o.status, 'NeedsReview');
assert.equal(o.attempt_count, 0, 'no attempt counted');
assert.equal((await linkRow(link3)).status, 'Error');
r = ok(await cmd('tanya', resolve(outElec, 'Retarget')), 'retarget');
assert.equal(r.outbox_status, 'Pending');
assert.equal(
  (await linkRow(link3)).calendar_id,
  'cal-shared@group.calendar.google.com'
);
c = await claim();
assert.equal(c.claimed[0].work.operation, 'create');
await success(outElec, 'evt-3', 'CREATED');

// cancel of a link with no external event settles without any call
ok(await cmd('tanya', skill(people.inst_a, 'Electrical')), 'a elec');
w = await wpRow(elec);
const elecAlloc = (
  await one(
    `select id from public.allocations where work_package_id=$1 and active`,
    [elec]
  )
).id;
const add = (old, person, mode, ver) => ({
  command_id: id(),
  command_type: 'CHANGE_INSTALLER_R2',
  job_id: job,
  work_package_id: elec,
  old_allocation_id: old,
  expected_version: ver,
  payload: { person_id: person, mode, reason: 'Second pair of hands' }
});
r = ok(
  await cmd('tanya', add(elecAlloc, people.inst_a, 'Add', w.version)),
  'add'
);
assert.equal(r.status, 'Added');
assert.equal(r.allocation.role, 'Second');
assert.equal(r.calendar_cancel, null);
const secondA = r.allocation.id,
  link4 = r.calendar.link.id,
  outCreate4 = r.calendar.outbox.id;
// same person again: already allocated that day -> capacity conflict, nothing written
await nr(
  add(elecAlloc, people.inst_b, 'Replace', r.work_package.version),
  'CAPACITY_CONFLICT'
);
const instC = (
  await one(
    `insert into public.people (legacy_id, email, display_name, capacity_per_day) values ('PERSON-inst_c','inst_c@test.local','Installer C',1) returning id`
  )
).id;
await db.query(
  `insert into public.person_roles (person_id, role_code) values ($1,'Installer')`,
  [instC]
);
r = ok(
  await cmd('tanya', add(secondA, instC, 'Replace', r.work_package.version)),
  'replace before dispatch'
);
assert.equal(r.allocation.role, 'Second');
const outCancel4 = r.calendar_cancel.id;
assert.equal((await linkRow(link4)).outbox_id, outCancel4);
assert.equal(
  await count(
    'audit_events',
    `entity_type='CalendarLinks' and action='CalendarRequeued' and entity_id=$1`,
    [link4]
  ),
  1
);
c = await claim();
const st4 = Object.fromEntries(c.settled.map((s) => [s.outbox_id, s]));
assert.equal(
  st4[outCreate4].outcome,
  'Cancelled',
  'superseded create never sent'
);
assert.equal(st4[outCancel4].outcome, 'Succeeded');
assert.equal(
  (await outRow(outCancel4)).response_summary,
  'NO_EXTERNAL_EVENT: nothing to cancel in Calendar'
);
assert.equal((await outRow(outCancel4)).attempt_count, 1);
assert.equal((await linkRow(link4)).status, 'Cancelled');
assert.equal(c.claimed.length, 1);
assert.equal(c.claimed[0].work.operation, 'create');
await uncertain(c.claimed[0].outbox_id, null);
assert.equal(
  (await outRow(c.claimed[0].outbox_id)).response_summary,
  'NEEDS_REVIEW UNCERTAIN_OUTCOME: Uncertain outcome — requires manual review'
);

// =============================================================================
// Generic protocol for another sender (registry-driven policy)
// =============================================================================
await db.query(`insert into app.outbox_action_types (action_type, service, max_attempts, backoff_minutes, module)
  values ('TestEmail', 'EmailWorker', 2, '{3}', 'test')`);
const te = (
  await one(`insert into public.outbox (idempotency_key, action_type, target, payload_hash, status)
  values ('TE-1','TestEmail','x@test.local','h','Pending') returning id`)
).id;
c = await sql(`select app.outbox_claim(array['TestEmail'], 5) r`);
assert.equal(c.claimed[0].outbox_id, te);
assert.equal(c.claimed[0].work, null);
r = await failure(te, true, 'SMTP 421');
assert.equal(r.status, 'RetryDue');
assert.equal(Math.round((new Date(r.next_attempt) - Date.now()) / 60000), 3);
await db.query(`update public.outbox set next_attempt = now() where id=$1`, [
  te
]);
c = await sql(`select app.outbox_claim(array['TestEmail'], 5) r`);
r = await failure(te, true, 'SMTP 421');
assert.equal(r.summary, 'NEEDS_REVIEW MAX_RETRIES_EXCEEDED: SMTP 421');
assert.equal(
  (
    await one(
      `select executing_service from public.audit_events where entity_id=$1 and action='OutboxRetry'`,
      [te]
    )
  ).executing_service,
  'EmailWorker'
);
// per-call policy override (e.g. app.xero_retry_policy) and required transient flag
const te2 = (
  await one(`insert into public.outbox (idempotency_key, action_type, target, payload_hash, status)
  values ('TE-2','TestEmail','x@test.local','h','Pending') returning id`)
).id;
await sql(`select app.outbox_claim(array['TestEmail'], 5) r`);
await expectSqlRefusal(
  `select app.outbox_record_failure('${te2}', null, 'x') r`,
  'OUTBOX_REFUSED: transient flag required'
);
r = await sql(`select app.outbox_record_failure($1, true, 'boom', 1, null) r`, [
  te2
]);
assert.equal(r.status, 'NeedsReview');
// XeroInvoice registered with its own policy (3 attempts, 2/4/8 minutes)
const xr = await one(
  `select * from app.outbox_action_types where action_type='XeroInvoice'`
);
assert.equal(xr.max_attempts, 3);
assert.deepEqual(xr.backoff_minutes, [2, 4, 8]);

// outbound allow-lists
await expectSqlRefusal(
  `select app.outbound_guard('EMAIL', array['a@b.co']) r`,
  'S01_REFUSED: empty allowlist'
);
await setSetting('outbound.allowed_recipients', ['Ops@Example.com']);
r = await sql(`select app.outbound_guard('EMAIL', array['ops@example.com']) r`);
assert.deepEqual(r.to, ['ops@example.com']);
assert.equal(r.delivery_confirmed, false);
assert.equal(
  await sqlErr(
    `select app.outbound_guard('EMAIL', array['ops@example.com'], array['x@y.co']) r`
  ),
  'S01_REFUSED: destination outside allowlist'
);
assert.equal(
  await sqlErr(`select app.outbound_guard('EMAIL', array['not a mailbox']) r`),
  'S01_REFUSED: invalid mailbox'
);
assert.equal(
  await sqlErr(`select app.outbound_guard('SMS', array['ops@example.com']) r`),
  'S01_REFUSED: unsupported action'
);
assert.equal(
  await sqlErr(
    `select app.outbound_guard('CALENDAR', array['ops@example.com'], '{}', '{}', 'other') r`
  ),
  'S01_REFUSED: calendar outside allowlist'
);
r = await sql(
  `select app.outbound_guard('CALENDAR', array['ops@example.com'], '{}', '{}', 'cal-shared@group.calendar.google.com') r`
);
assert.equal(r.kind, 'CALENDAR');

// worker entry points: service role only
const priv = async (role, fn) =>
  (await one(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))
    .p;
for (const fn of [
  'public.outbox_claim(text[],int)',
  'public.outbox_record_success(uuid,text,text)',
  'public.outbox_record_failure(uuid,boolean,text,int,int[])',
  'public.outbox_record_uncertain(uuid,text)',
  'public.outbox_release_stalled(int,text[])',
  'public.calendar_record_drift(uuid,jsonb)'
]) {
  assert.equal(await priv('service_role', fn), true, fn);
  assert.equal(await priv('authenticated', fn), false, fn);
  assert.equal(await priv('anon', fn), false, fn);
}
r = await sql(`select public.outbox_claim(${CAL}, 5) r`);
assert.equal(r.claimed.length, 0);

console.log('t_calendar: all assertions passed');
