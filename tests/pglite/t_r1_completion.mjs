// R1 completion after booking (migration 20260919210000_r1_completion.sql):
// COMMISSIONING_RECORD, Electrical completion, completion / issues,
// job-level calls, cancellation effects, installer changes, JOB_OPERATIONS.
//
// Old tests these map to (reference repo, commit f25002a):
//   tests/r1-appsheet.test.cjs:4457-4600  COMMISSIONING_RECORD 01-09
//   tests/r1-appsheet.test.cjs:4403       CALL_RECORD job-level calls
//   tests/r1-appsheet.test.cjs:87-88      OPERATIONAL_COMPLETE wrapper refusals
//   tests/s10.test.cjs:8-26,44            calls / issues / completion gate
//   tests/s12.test.cjs R1-01..04          office template never approved
//   tests/s15.test.cjs 01-04,13-14        cancellation effects / refusals
//   tests/r1-office-journey.test.cjs:343  CHANGE_INSTALLER Replace
//
// Run: npm run test:db:pglite -- t_r1_completion
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup, readyToBook } from './fixtures.mjs';

const f = await setup();
const { db, one, all, people, users, cmd, id, ok } = f;
const q = (sql, p = []) => db.query(sql, p);
const jobRow = async (j) => one(`select * from public.jobs where id=$1`, [j]);
const wpRow = async (w) =>
  one(`select * from public.work_packages where id=$1`, [w]);
const task = async (j, code) =>
  one(
    `select * from public.tasks where job_id=$1 and template_code=$2 order by created_at limit 1`,
    [j, code]
  );
const counts = async () =>
  one(`select
  (select count(*)::int from public.audit_events) audit, (select count(*)::int from public.commands) commands,
  (select count(*)::int from public.tasks) tasks, (select count(*)::int from public.task_events) task_events,
  (select count(*)::int from public.calls) calls, (select count(*)::int from public.issues) issues,
  (select count(*)::int from public.commissioning_submissions) submissions, (select count(*)::int from public.evidence) evidence,
  (select count(*)::int from public.allocations) allocations,
  (select string_agg(id::text || ':' || version, ',' order by id) from public.jobs) job_versions,
  (select string_agg(id::text || ':' || version, ',' order by id) from public.work_packages) wp_versions`);
// A refusal returns the exact code and writes nothing (not even an audit row).
const refuse = async (who, req, code) => {
  const before = await counts();
  const r = await cmd(who, req);
  assert.ok(
    r.error,
    `expected refusal ${code}, got ${JSON.stringify(r).slice(0, 400)}`
  );
  if (code instanceof RegExp) assert.match(r.error, code);
  else assert.equal(r.error, code);
  assert.deepEqual(await counts(), before, 'refusal wrote something: ' + code);
};
const opsRead = async (who, jobId) => {
  await f.as(who);
  try {
    return (
      await db.query(`select public.execute_operations_read($1::jsonb) r`, [
        { read_type: 'JOB_OPERATIONS', job_id: jobId }
      ])
    ).rows[0].r.data;
  } catch (e) {
    return { error: e.message };
  }
};
const setMode = (fn, mode, scope = 'Pilot') =>
  q(
    `update public.release_modes set mode=$2, authorised_job_scope=$3 where function_id=$1`,
    [fn, mode, mode === 'Disabled' ? 'None' : scope]
  );

// An Office person with a login but no assignment on any job.
{
  const p = await one(
    `insert into public.people (legacy_id, email, display_name) values ('PERSON-olive','olive@test.local','Olive') returning id`
  );
  await q(
    `insert into public.person_roles (person_id, role_code) values ($1,'Office')`,
    [p.id]
  );
  const uid = randomUUID();
  await q(
    `insert into auth.users (id, email, email_confirmed_at) values ($1,'olive@test.local',now())`,
    [uid]
  );
  people.olive = p.id;
  users.olive = uid;
}

// Sale -> ReadyToBook -> booking intake -> Booked, through commands only.
async function booked(over = {}) {
  const { job, jobRef } = await readyToBook(f, over);
  let j = await jobRow(job);
  const r = ok(
    await cmd('tanya', {
      command_id: id(),
      command_type: 'BOOKING_INTAKE',
      job_id: job,
      expected_version: j.version,
      payload: {
        customer_first_name: 'Ann',
        customer_last_name: 'Smith',
        street_address: '1 High St',
        city: 'Leeds',
        postcode: 'LS1 1AA',
        cost: '5000',
        finance_route: 'Standard',
        date_roofer: '2026-10-06',
        date_sparky: '2026-10-08',
        roofer: people.inst_a,
        sparky: people.inst_b,
        mat_panel_515: 12
      }
    }),
    'booking'
  );
  assert.equal(r.status, 'Processed', JSON.stringify(r.review_reasons));
  for (const code of ['BKG01', 'BKG02', 'BKG03']) {
    const t = await task(job, code);
    ok(
      await cmd('tanya', {
        command_id: id(),
        command_type: 'TASK_COMPLETE',
        task_id: t.id,
        expected_version: t.version,
        payload: { completion_note: `${code} done` }
      }),
      code
    );
  }
  j = await jobRow(job);
  assert.equal(
    ok(
      await cmd('tanya', {
        command_id: id(),
        command_type: 'CONFIRM_BOOKING',
        job_id: job,
        expected_version: j.version
      }),
      'confirm'
    ).status,
    'Booked'
  );
  const roof = await one(
    `select * from public.work_packages where job_id=$1 and trade='Roof'`,
    [job]
  );
  const elec = await one(
    `select * from public.work_packages where job_id=$1 and trade='Electrical'`,
    [job]
  );
  assert.equal(roof.commissioning_required, false);
  assert.equal(elec.commissioning_required, true);
  return { job, jobRef, roof: roof.id, elec: elec.id };
}

// =============================================================================
// Job A: the full Electrical journey
// =============================================================================
const A = await booked();
const B = await booked(); // a second job for cross-job checks
console.log('booked', A.jobRef, B.jobRef);

// ---------------------------------------------------------------- COMMISSIONING_RECORD refusals
const commissioning = (
  over = {},
  payload = {
    evidence_path: `${A.job}/elec-cert.pdf`,
    reference: 'EIC-001',
    notes: 'Scanned EIC'
  }
) => {
  return async () => {
    const wp = await wpRow(over.work_package_id ?? A.elec);
    return {
      command_id: id(),
      command_type: 'COMMISSIONING_RECORD',
      job_id: A.job,
      work_package_id: A.elec,
      expected_version: wp.version,
      payload,
      ...over
    };
  };
};
await refuse('store', await commissioning()(), 'R1A_ROLE_DENIED'); // not office
await refuse('inst_b', await commissioning()(), 'R1A_ROLE_DENIED'); // installer (old test 04)
await refuse('dan', await commissioning()(), 'R1A_ROLE_DENIED'); // Director only (office manager required)
await refuse('hannah', await commissioning()(), 'R1A_ROLE_DENIED'); // VariationApprover only
await refuse('olive', await commissioning()(), 'R1A_JOB_ACCESS_DENIED'); // office, not assigned (old test 03b)
await setMode('FN-01', 'Disabled');
await refuse('tanya', await commissioning()(), 'R1A_MODE_DENIED'); // release mode off
await setMode('FN-01', 'Automated');
await refuse(
  'tanya',
  await commissioning({}, { reference: 'EIC-001' })(),
  'R1A_REQUIRED_EVIDENCE'
); // old test 02
await refuse(
  'tanya',
  await commissioning({}, { evidence_path: `${A.job}/x.pdf`, bogus: 1 })(),
  'R1A_INVALID_FIELDS'
);
await refuse(
  'tanya',
  await commissioning({ task_id: randomUUID() })(),
  'R1A_INVALID_FIELDS'
);
await refuse(
  'tanya',
  await commissioning({ work_package_id: A.roof })(),
  'R1A_COMMISSIONING_NOT_REQUIRED'
); // old test 03
await refuse(
  'tanya',
  await commissioning({ work_package_id: B.elec })(),
  'R1A_WORK_PACKAGE_JOB_MISMATCH'
); // old test 03
await refuse(
  'tanya',
  {
    ...(await commissioning()()),
    expected_version: (await wpRow(A.elec)).version + 1
  },
  'R1A_STALE_VERSION'
); // old test 05
await refuse(
  'tanya',
  await commissioning({}, { evidence_id: randomUUID() })(),
  'R1A_EVIDENCE_NOT_FOUND'
);
const bEvidence = (
  await one(
    `insert into public.evidence (job_id, category, storage_path, filename, upload_status) values ($1,'Commissioning',$2,'b.pdf','Uploaded') returning id`,
    [B.job, `${B.job}/b.pdf`]
  )
).id;
await refuse(
  'tanya',
  await commissioning({}, { evidence_id: bEvidence })(),
  'R1A_CROSS_JOB_EVIDENCE'
);
await refuse(
  'tanya',
  await commissioning({}, { evidence_path: `${B.job}/b.pdf` })(),
  'R1A_CROSS_JOB_EVIDENCE'
);

// ---------------------------------------------------------------- Electrical completion before commissioning
// Work confirmed through the INS01 call tasks (installer confirmation), customer happy through INS04.
let sch = (await one(`select app.s10_run_schedules('2026-10-12T12:00:00Z') r`))
  .r;
assert.ok(sch.installer_calls.created >= 2, JSON.stringify(sch));
let j = await jobRow(A.job);
// Wrong staff for completion (old r1-appsheet 87-88): VariationApprover and Director are refused.
await refuse(
  'hannah',
  {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version
  },
  'R1A_ROLE_DENIED'
);
await refuse(
  'dan',
  {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version
  },
  'R1A_ROLE_DENIED'
);
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version,
    payload: { force: true }
  },
  'R1A_INVALID_FIELDS'
);
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version - 1
  },
  'R1A_STALE_VERSION'
);
await setMode('FN-19', 'Disabled');
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version
  },
  'R1A_MODE_DENIED'
);
await setMode('FN-19', 'Manual');

// Missing prerequisite: nothing confirmed yet -> NeedsReview, nothing written.
let before = await counts();
let r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version
  }),
  'opc early'
);
assert.equal(r.status, 'NeedsReview');
assert.ok(r.gate.reasons.includes('REQUIRED_WORK_UNCONFIRMED'));
assert.ok(r.gate.reasons.includes(`COMMISSIONING_NOT_ACCEPTED:${A.elec}`));
assert.ok(r.gate.reasons.includes('CUSTOMER_NOT_HAPPY'));
assert.equal(
  (await counts()).audit,
  before.audit,
  'NeedsReview wrote an audit row'
);
assert.equal((await jobRow(A.job)).workflow_stage, 'Booked');

for (const t of await all(
  `select * from public.tasks where job_id=$1 and template_code='INS01' order by created_at`,
  [A.job]
)) {
  ok(
    await cmd('tanya', {
      command_id: id(),
      command_type: 'CALL_RECORD',
      job_id: A.job,
      task_id: t.id,
      expected_version: t.version,
      payload: {
        type: 'Installer',
        outcome: 'Complete',
        actual_completion_confirmed: true,
        notes: 'Installer confirmed done'
      }
    }),
    'ins01'
  );
}
sch = (await one(`select app.s10_run_schedules('2026-10-13T12:00:00Z') r`)).r;
assert.equal(sch.customer_calls.created, 1, JSON.stringify(sch));
const ins04 = await task(A.job, 'INS04');
ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'CALL_RECORD',
    job_id: A.job,
    task_id: ins04.id,
    expected_version: ins04.version,
    payload: { type: 'Customer', outcome: 'Complete', customer_happy: true }
  }),
  'ins04'
);

// Only the Electrical commissioning is now missing: the exact R1 blocker the port had.
j = await jobRow(A.job);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version
  }),
  'opc no commissioning'
);
assert.equal(r.status, 'NeedsReview');
assert.deepEqual(r.gate.reasons, [`COMMISSIONING_NOT_ACCEPTED:${A.elec}`]);
let ops = await opsRead('tanya', A.job);
assert.equal(ops.completion.action.available, false);
assert.equal(ops.completion.action.denied, 'STATE');
assert.equal(ops.completion.action.reason, 'COMPLETION_GATE_OPEN');
const elecOps = ops.packages.find((p) => p.id === A.elec);
assert.equal(elecOps.commissioning.required, true);
assert.equal(elecOps.commissioning.accepted, false);
assert.equal(elecOps.actions.commissioning_record.available, true);
assert.equal(
  ops.packages.find((p) => p.id === A.roof).actions.commissioning_record.reason,
  'COMMISSIONING_NOT_REQUIRED'
);
// Role vs mode denial as the UI sees it.
assert.equal(
  (await opsRead('hannah', A.job)).packages.find((p) => p.id === A.elec).actions
    .commissioning_record.denied,
  'ROLE'
);
await setMode('FN-01', 'Disabled');
assert.equal(
  (await opsRead('tanya', A.job)).packages.find((p) => p.id === A.elec).actions
    .commissioning_record.denied,
  'MODE'
);
await setMode('FN-01', 'Automated');
assert.match((await opsRead('store', A.job)).error, /R1A_ROLE_DENIED/);
console.log('Electrical job blocked only by commissioning');

// ---------------------------------------------------------------- COMMISSIONING_RECORD happy path (old test 01)
const tasksBefore = await all(
  `select id, status, version from public.tasks where job_id=$1 order by id`,
  [A.job]
);
const wpBefore = await wpRow(A.elec);
const jobBefore = await jobRow(A.job);
before = await counts();
const recordReq = await commissioning()();
const rec = ok(await cmd('tanya', recordReq), 'commissioning record');
assert.equal(rec.status, 'Recorded');
assert.equal(rec.evidence_created, true);
assert.equal(rec.template_version, 'R1-OFFICE-MANUAL-1.0');
assert.equal(rec.supersedes_submission_id, null);
assert.equal(rec.external_calls, 0);
const sub = await one(
  `select * from public.commissioning_submissions where id=$1`,
  [rec.submission_id]
);
assert.equal(sub.status, 'Accepted');
assert.equal(sub.source_system, 'R1A-office-manual');
assert.equal(sub.allocation_id, null);
assert.equal(sub.installer_id, null);
assert.equal(sub.reviewed_by, people.tanya);
assert.equal(sub.office_reference, 'EIC-001');
assert.equal(sub.review_notes, 'Reference: EIC-001 - Scanned EIC');
const ev = await one(`select * from public.evidence where id=$1`, [
  rec.evidence_id
]);
assert.equal(ev.job_id, A.job);
assert.equal(ev.category, 'Commissioning');
assert.equal(ev.submission_id, sub.id);
assert.equal(ev.customer_shareable, false);
const tmpl = await one(
  `select * from public.commissioning_templates where trade='Electrical' and template_version='R1-OFFICE-MANUAL-1.0'`
);
assert.equal(tmpl.equipment_type, 'OfficeRecordedEvidence');
assert.equal(tmpl.approved_by, null);
assert.equal(tmpl.approved_at, null);
// Never an approved R3 template (old s12 R1-04).
assert.equal(
  (
    await one(
      `select (app.iw_approved_template('Electrical','R1-OFFICE-MANUAL-1.0')).id x`
    )
  ).x,
  null
);
const audit = await all(
  `select * from public.audit_events where command_id=$1`,
  [recordReq.command_id]
);
assert.ok(
  audit.some(
    (a) =>
      a.action === 'OfficeCommissioningRecorded' &&
      a.entity_id === sub.id &&
      a.initiating_person_id === people.tanya
  )
);
// No task, job or work-package version change (reference).
assert.deepEqual(
  await all(
    `select id, status, version from public.tasks where job_id=$1 order by id`,
    [A.job]
  ),
  tasksBefore
);
assert.equal((await wpRow(A.elec)).version, wpBefore.version);
assert.equal((await jobRow(A.job)).version, jobBefore.version);
const after = await counts();
assert.equal(after.submissions, before.submissions + 1);
assert.equal(after.evidence, before.evidence + 1);
assert.equal(after.commands, before.commands + 1);

// Duplicate / retry (old test 06): same command id -> replayed, nothing new.
before = await counts();
const replay = await cmd('tanya', recordReq);
assert.equal(replay.ok, true);
assert.equal(replay.replayed, true);
assert.equal(replay.result.submission_id, rec.submission_id);
assert.deepEqual(await counts(), before);
// Same id, different content -> conflict, nothing written.
await refuse(
  'tanya',
  { ...recordReq, payload: { ...recordReq.payload, reference: 'EIC-XXX' } },
  'R1A_COMMAND_CONFLICT'
);
// Replay is re-authorised: the same id from someone else conflicts before any write.
await refuse('hannah', recordReq, 'R1A_ROLE_DENIED');

// Shape constraint: office rows are Accepted with no allocation; installer rows keep their allocation.
await assert.rejects(
  q(
    `insert into public.commissioning_submissions (job_id, work_package_id, template_version, status, source_system) values ($1,$2,'x','Draft','R1A-office-manual')`,
    [A.job, A.elec]
  ),
  /commissioning_submissions_shape_check/
);
await assert.rejects(
  q(
    `insert into public.commissioning_submissions (job_id, work_package_id, template_version, status) values ($1,$2,'x','Draft')`,
    [A.job, A.elec]
  ),
  /commissioning_submissions_shape_check/
);

// Re-record with a new command supersedes (history kept, gate unchanged).
const rec2 = ok(
  await cmd(
    'tanya',
    await commissioning(
      {},
      { evidence_id: rec.evidence_id, reference: 'EIC-001A' }
    )()
  ),
  're-record'
);
assert.equal(rec2.supersedes_submission_id, rec.submission_id);
assert.equal(rec2.evidence_created, false);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.commissioning_submissions where work_package_id=$1`,
      [A.elec]
    )
  ).n,
  2
);
ops = await opsRead('tanya', A.job);
assert.deepEqual(
  ops.packages
    .find((p) => p.id === A.elec)
    .commissioning.current.map((s) => s.office_reference),
  ['EIC-001A']
);
console.log('COMMISSIONING_RECORD ok');

// ---------------------------------------------------------------- Issues: a blocking issue holds completion
j = await jobRow(A.job);
await refuse(
  'store',
  {
    command_id: id(),
    command_type: 'ISSUE_CREATE',
    job_id: A.job,
    expected_version: j.version,
    payload: {
      issue_type: 'Complaint',
      title: 'Scratch',
      description: 'Fascia scratched'
    }
  },
  'R1A_ROLE_DENIED'
);
const iss = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'ISSUE_CREATE',
    job_id: A.job,
    expected_version: j.version,
    payload: {
      issue_type: 'Complaint',
      title: 'Scratch',
      description: 'Fascia scratched',
      customer_impact: 'yes'
    }
  }),
  'issue'
);
let issue = await one(`select * from public.issues where id=$1`, [
  iss.issue_id
]);
assert.equal(issue.blocks_completion, true);
assert.equal(issue.status, 'Open');
j = await jobRow(A.job);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version
  }),
  'opc blocked'
);
assert.equal(r.status, 'NeedsReview');
assert.deepEqual(r.gate.reasons, ['BLOCKING_ISSUE_OPEN']);
ops = await opsRead('tanya', A.job);
assert.equal(ops.issues[0].blocks_completion, true);
assert.equal(ops.issues[0].actions.resolve.available, true);
assert.equal(ops.issues[0].actions.close.reason, 'RESOLVE_FIRST');
// Resolve needs a resolution; close needs Resolved + customer confirmation.
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'ISSUE_UPDATE',
    job_id: A.job,
    issue_id: issue.id,
    expected_version: issue.version,
    payload: { action: 'TRANSITION', status: 'Resolved' }
  },
  'S10_REVIEW: resolution required'
);
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'ISSUE_UPDATE',
    job_id: A.job,
    issue_id: issue.id,
    expected_version: issue.version,
    payload: {
      action: 'TRANSITION',
      status: 'Closed',
      customer_resolution_confirmed: true
    }
  },
  'S10_REVIEW: resolved issue and customer confirmation required'
);
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'ISSUE_UPDATE',
    job_id: B.job,
    issue_id: issue.id,
    expected_version: issue.version,
    payload: { action: 'TRANSITION', status: 'Resolved', resolution: 'x' }
  },
  'R1A_ISSUE_JOB_MISMATCH'
);
ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'ISSUE_UPDATE',
    job_id: A.job,
    issue_id: issue.id,
    expected_version: issue.version,
    payload: {
      action: 'TRANSITION',
      status: 'Resolved',
      resolution: 'Fascia repainted'
    }
  }),
  'resolve'
);
issue = await one(`select * from public.issues where id=$1`, [issue.id]);
assert.equal(issue.status, 'Resolved');
ops = await opsRead('tanya', A.job);
assert.equal(ops.completion.gate.ready, true);
assert.equal(ops.completion.action.available, true);

// ---------------------------------------------------------------- Final completion
j = await jobRow(A.job);
const opcReq = {
  command_id: id(),
  command_type: 'OPERATIONAL_COMPLETE',
  job_id: A.job,
  expected_version: j.version
};
r = ok(await cmd('tanya', opcReq), 'opc');
assert.equal(r.status, 'Completed', JSON.stringify(r));
j = await jobRow(A.job);
assert.equal(j.workflow_stage, 'OperationallyComplete');
assert.equal(j.operational_complete_by, people.tanya);
assert.ok(await task(A.job, 'GHL01'));
assert.ok(
  await one(
    `select 1 x from public.audit_events where command_id=$1 and action='OperationalComplete'`,
    [opcReq.command_id]
  )
);
before = await counts();
assert.equal((await cmd('tanya', opcReq)).replayed, true); // retry: stored answer
assert.deepEqual(await counts(), before);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'OPERATIONAL_COMPLETE',
    job_id: A.job,
    expected_version: j.version
  }),
  'again'
);
assert.equal(r.status, 'AlreadyComplete');
ops = await opsRead('tanya', A.job);
assert.equal(ops.completion.action.reason, 'ALREADY_COMPLETE');
console.log('Electrical job', A.jobRef, 'OperationallyComplete');

// Closing the resolved issue after completion (customer confirmed).
issue = await one(`select * from public.issues where id=$1`, [issue.id]);
ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'ISSUE_UPDATE',
    job_id: A.job,
    issue_id: issue.id,
    expected_version: issue.version,
    payload: {
      action: 'TRANSITION',
      status: 'Closed',
      customer_resolution_confirmed: true
    }
  }),
  'close issue'
);
assert.equal(
  (
    await one(
      `select count(*)::int n from public.issue_events where issue_id=$1`,
      [issue.id]
    )
  ).n,
  3
);

// =============================================================================
// Job-level calls (job B)
// =============================================================================
j = await jobRow(B.job);
const callReq = (over = {}, payload = {}) => ({
  command_id: id(),
  command_type: 'CALL_RECORD',
  job_id: B.job,
  expected_version: j.version,
  payload: {
    type: 'Customer',
    outcome: 'NoAnswer',
    notes: 'Rang about access',
    ...payload
  },
  ...over
});
await refuse('store', callReq(), 'R1A_ROLE_DENIED');
await refuse('inst_a', callReq(), 'R1A_ROLE_DENIED');
await refuse('olive', callReq(), 'R1A_JOB_ACCESS_DENIED');
await setMode('FN-01', 'Disabled');
await refuse('tanya', callReq(), 'R1A_MODE_DENIED');
await setMode('FN-01', 'Automated');
await refuse(
  'tanya',
  callReq({ expected_version: j.version + 1 }),
  'R1A_STALE_VERSION'
);
await refuse('tanya', callReq({}, { outcome: '' }), 'R1A_REQUIRED_OUTCOME');
await refuse(
  'tanya',
  callReq({}, { type: 'Sales' }),
  'S10_REVIEW: invalid call type'
);
await refuse(
  'tanya',
  callReq({}, { customer_happy: true }),
  'S10_REVIEW: completion and customer outcomes need the INS01 / INS04 call task'
);
await refuse(
  'tanya',
  callReq({}, { actual_completion_confirmed: true }),
  'S10_REVIEW: completion and customer outcomes need the INS01 / INS04 call task'
);
await refuse(
  'tanya',
  callReq({}, { work_package_id: A.elec }),
  'S10_REVIEW: work package linkage invalid'
);
// A given task must be on this job (old r1-appsheet 4403).
const aTask = await task(A.job, 'BKG04');
await refuse('tanya', callReq({ task_id: aTask.id }), 'R1A_TASK_JOB_MISMATCH');
await refuse(
  'tanya',
  callReq({ task_id: randomUUID() }),
  'R1A_TASK_JOB_MISMATCH'
);

before = await counts();
const tasksB = await all(
  `select id, status, version from public.tasks where job_id=$1 order by id`,
  [B.job]
);
const jobCall = callReq({}, { work_package_id: B.roof });
r = ok(await cmd('tanya', jobCall), 'job call');
assert.equal(r.status, 'Recorded');
assert.equal(r.job_level, true);
const call = await one(`select * from public.calls where id=$1`, [r.call.id]);
assert.equal(call.task_id, null);
assert.equal(call.attempted_by, people.tanya);
assert.equal(call.work_package_id, B.roof);
assert.deepEqual(
  await all(
    `select id, status, version from public.tasks where job_id=$1 order by id`,
    [B.job]
  ),
  tasksB
);
let now = await counts();
assert.equal(now.calls, before.calls + 1);
assert.equal(now.task_events, before.task_events);
assert.equal(now.job_versions, before.job_versions);
assert.ok(
  await one(
    `select 1 x from public.audit_events where command_id=$1 and entity_type='Calls' and action='RecordCall'`,
    [jobCall.command_id]
  )
);
// Blank task_id is the same as omitted.
r = ok(
  await cmd(
    'ben',
    callReq(
      { task_id: '' },
      { type: 'Supplier', outcome: 'Other', notes: 'Merchant delivery slot' }
    )
  ),
  'blank task'
);
assert.equal(r.job_level, true);
// Retry
before = await counts();
assert.equal((await cmd('tanya', jobCall)).replayed, true);
assert.deepEqual(await counts(), before);
// Task calls keep working (INS01/INS04 only).
await refuse(
  'tanya',
  {
    ...callReq({ task_id: (await task(B.job, 'BKG04')).id }),
    expected_version: (await task(B.job, 'BKG04')).version
  },
  'S10_REVIEW: invalid call task'
);
// Visible on the job, without customer contact details.
ops = await opsRead('tanya', B.job);
assert.equal(ops.calls.length, 2);
assert.equal(
  ops.calls.every((c) => c.job_level),
  true
);
assert.equal(
  ops.calls.find((c) => c.type === 'Customer').attempted_by_name,
  'Tanya'
);
assert.ok(
  !JSON.stringify(ops).includes('07700900001'),
  'customer phone leaked'
);
assert.ok(!JSON.stringify(ops.calls).includes('@'), 'email leaked');
// Task calls from job A are listed as task calls.
assert.ok(
  (await opsRead('tanya', A.job)).calls.some(
    (c) => c.task_code === 'INS01' && !c.job_level
  )
);
console.log('job-level calls ok');

// =============================================================================
// Installer changes (job B, Booked)
// =============================================================================
const bElec = await wpRow(B.elec);
const lead = await one(
  `select * from public.allocations where work_package_id=$1 and active and role='Lead'`,
  [B.elec]
);
const change = (over = {}, payload = {}) => ({
  command_id: id(),
  command_type: 'CHANGE_INSTALLER',
  job_id: B.job,
  work_package_id: B.elec,
  expected_version: bElec.version,
  payload: {
    mode: 'Replace',
    person_id: people.inst_a,
    reason: 'Inst B off sick',
    old_allocation_id: lead.id,
    ...payload
  },
  ...over
});
await refuse('store', change(), 'R1A_ROLE_DENIED');
await refuse('olive', change(), 'R1A_JOB_ACCESS_DENIED');
await refuse(
  'tanya',
  change({ expected_version: bElec.version + 1 }),
  'R1A_STALE_VERSION'
);
await refuse(
  'tanya',
  change({ work_package_id: A.elec }),
  'R1A_WORK_PACKAGE_JOB_MISMATCH'
);
await refuse('tanya', change({}, { reason: '' }), 'R1A_REQUIRED_REASON');
await setMode('FN-01', 'Disabled');
await refuse('tanya', change(), 'R1A_MODE_DENIED');
await setMode('FN-01', 'Automated');
// Not an installer -> NeedsReview, nothing written.
before = await counts();
r = ok(
  await cmd('tanya', change({}, { person_id: people.tanya })),
  'needs review'
);
assert.equal(r.status, 'NeedsReview');
assert.equal((await counts()).allocations, before.allocations);
assert.equal((await counts()).audit, before.audit);
// Replace: old allocation off, new one on the same dates and role, package revision bumped, calendar captured.
const changeReq = change();
r = ok(await cmd('tanya', changeReq), 'replace');
assert.equal(r.status, 'Replaced');
const oldAlloc = await one(`select * from public.allocations where id=$1`, [
  lead.id
]);
assert.equal(oldAlloc.active, false);
assert.equal(oldAlloc.cancellation_reason, 'Inst B off sick');
const newAlloc = await one(`select * from public.allocations where id=$1`, [
  r.allocation.id
]);
assert.equal(newAlloc.person_id, people.inst_a);
assert.equal(newAlloc.role, 'Lead');
assert.equal(newAlloc.active, true);
assert.equal(String(newAlloc.start_at), String(lead.start_at));
assert.equal(newAlloc.replaced_allocation_id, lead.id);
assert.equal((await wpRow(B.elec)).revision, bElec.revision + 1);
assert.ok(
  (
    await all(`select action from public.audit_events where command_id=$1`, [
      changeReq.command_id
    ])
  ).some((a) => a.action === 'ReplaceInstaller')
);
before = await counts();
assert.equal((await cmd('tanya', changeReq)).replayed, true);
assert.deepEqual(await counts(), before);
// Stale after the change (version moved on).
await refuse(
  'tanya',
  change(
    { expected_version: bElec.version },
    { old_allocation_id: newAlloc.id }
  ),
  'R1A_STALE_VERSION'
);
// Planner consistency: the job's planner rows show the new installer.
ops = await opsRead('tanya', B.job);
assert.deepEqual(
  ops.packages.find((p) => p.id === B.elec).allocations.map((a) => a.person_id),
  [people.inst_a]
);
await f.as('tanya');
const planner = (
  await db.query(`select public.execute_read($1::jsonb) r`, [
    { read_type: 'PLANNER_6_WEEKS', as_of: '2026-10-01' }
  ])
).rows[0].r.data;
const elecRows = planner.rows.filter((row) => row.work_package_id === B.elec);
assert.deepEqual(
  elecRows.map((row) => [row.allocation_id, row.person_id, row.role]),
  [[newAlloc.id, people.inst_a, 'Lead']]
);
assert.equal(elecRows[0].work_package_version, (await wpRow(B.elec)).version);
// PLANNER_UPDATE: dates on one package.
const pw = await wpRow(B.roof);
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'PLANNER_UPDATE',
    job_id: B.job,
    work_package_id: B.roof,
    expected_version: pw.version,
    payload: { planned_start: '2026-10-20', planned_end: '2026-10-19' }
  },
  'S11_DATE_INVALID: end before start'
);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'PLANNER_UPDATE',
    job_id: B.job,
    work_package_id: B.roof,
    expected_version: pw.version,
    payload: {
      planned_start: '2026-10-20',
      planned_end: '2026-10-21',
      reason: 'Weather'
    }
  }),
  'planner update'
);
assert.equal(r.work_package.planned_start, '2026-10-20');
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'PLANNER_UPDATE',
    job_id: B.job,
    work_package_id: B.roof,
    expected_version: pw.version,
    payload: { planned_start: '2026-10-22', planned_end: '2026-10-22' }
  },
  'R1A_STALE_VERSION'
);
console.log('installer changes ok');

// =============================================================================
// Cancellation (jobs B and C)
// =============================================================================
// Director / VariationApprover assigned to job B through issues they own, so
// the S15 narrowing (Admin / Office / Manager only) is what refuses them.
for (const who of ['dan', 'hannah']) {
  j = await jobRow(B.job);
  ok(
    await cmd('tanya', {
      command_id: id(),
      command_type: 'ISSUE_CREATE',
      job_id: B.job,
      expected_version: j.version,
      payload: {
        issue_type: 'Variation',
        title: `Query for ${who}`,
        description: 'Extra panel?',
        owner_id: people[who],
        customer_impact: 'no'
      }
    }),
    'issue ' + who
  );
}
j = await jobRow(B.job);
const cancelPayload = {
  reason: 'Customer withdrew',
  effective_date: '2026-10-01',
  work_performed: 'None',
  material_state: 'None',
  scaffold_state: 'None',
  finance_review: 'Refund deposit',
  legacy_state: 'None'
};
const cancelReq = {
  command_id: id(),
  command_type: 'CANCEL_JOB',
  job_id: B.job,
  expected_version: j.version,
  payload: cancelPayload
};
await refuse(
  'dan',
  { ...cancelReq, command_id: id() },
  'S15_REFUSED: authenticated office actor required'
);
await refuse(
  'hannah',
  { ...cancelReq, command_id: id() },
  'S15_REFUSED: authenticated office actor required'
);
await refuse('store', { ...cancelReq, command_id: id() }, 'R1A_ROLE_DENIED');
await refuse(
  'olive',
  { ...cancelReq, command_id: id() },
  'R1A_JOB_ACCESS_DENIED'
);
await refuse(
  'tanya',
  { ...cancelReq, command_id: id(), expected_version: j.version - 1 },
  'S15_REVIEW: stale job revision'
);
await refuse(
  'tanya',
  { ...cancelReq, command_id: id(), payload: { ...cancelPayload, reason: '' } },
  'R1A_REQUIRED_REASON'
);
await setMode('FN-17', 'Disabled');
await refuse('tanya', { ...cancelReq, command_id: id() }, 'R1A_MODE_DENIED');
await setMode('FN-17', 'Manual');
ops = await opsRead('tanya', B.job);
assert.equal(ops.actions.cancel_job.available, true);
assert.equal(ops.actions.reinstate_job.reason, 'STAGE_NOT_CANCELLED');
// Preview is read-only and says what would happen.
await f.as('tanya');
before = await counts();
const preview = (
  await db.query(
    `select public.cancellation_preview($1::uuid, '2026-10-01'::date) p`,
    [B.job]
  )
).rows[0].p;
assert.deepEqual(await counts(), before);
assert.equal(preview.can_cancel, true);
const liveAllocs = await all(
  `select * from public.allocations where work_package_id in (select id from public.work_packages where job_id=$1) and active`,
  [B.job]
);
const openBkg = await all(
  `select id from public.tasks where job_id=$1 and template_code in ('BKG04','BKG05') and status in ('Open','Waiting','InProgress','Blocked')`,
  [B.job]
);

r = ok(await cmd('tanya', cancelReq), 'cancel B');
assert.equal(r.status, 'CancellationInProgress');
j = await jobRow(B.job);
assert.equal(j.workflow_stage, 'CancellationInProgress');
assert.equal(j.cancellation_reason, 'Customer withdrew');
assert.equal(j.version, cancelReq.expected_version + 1);
// Deterministic effects: unstarted packages cancelled, future allocations off, one installer notice per allocation,
// open booking tasks cancelled, job kept (never deleted).
assert.equal(
  (
    await one(
      `select count(*)::int n from public.work_packages where job_id=$1 and status<>'Cancelled'`,
      [B.job]
    )
  ).n,
  0
);
for (const a of liveAllocs)
  assert.equal(
    (await one(`select active from public.allocations where id=$1`, [a.id]))
      .active,
    false
  );
assert.equal(
  (
    await one(
      `select count(*)::int n from public.tasks where job_id=$1 and template_code='S15-CAN-INSTALLER'`,
      [B.job]
    )
  ).n,
  liveAllocs.length
);
for (const t of openBkg)
  assert.equal(
    (await one(`select status from public.tasks where id=$1`, [t.id])).status,
    'Cancelled'
  );
assert.ok(
  await one(`select 1 x from public.audit_events where command_id=$1`, [
    cancelReq.command_id
  ])
);
// Retry, second cancel, and work after cancellation.
before = await counts();
assert.equal((await cmd('tanya', cancelReq)).replayed, true);
assert.deepEqual(await counts(), before);
await refuse(
  'tanya',
  { ...cancelReq, command_id: id(), expected_version: j.version },
  /^S15_REVIEW: cancellation already started/
);
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'CALL_RECORD',
    job_id: B.job,
    expected_version: j.version,
    payload: { type: 'Customer', outcome: 'Other' }
  },
  'R1A_JOB_NOT_ACTIONABLE'
);
ops = await opsRead('tanya', B.job);
assert.equal(ops.actions.cancel_job.denied, 'STATE');
assert.equal(ops.actions.call_record.denied, 'STATE');
assert.ok(ops.job.open_cancellation_tasks > 0);
console.log(
  'cancel from Booked ok; open cancellation tasks',
  ops.job.open_cancellation_tasks
);

// Job C: cancelled from ReadyToBook (before booking) - nothing planned to undo.
const C = await readyToBook(f);
j = await jobRow(C.job);
r = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'CANCEL_JOB',
    job_id: C.job,
    expected_version: j.version,
    payload: cancelPayload
  }),
  'cancel C'
);
assert.equal((await jobRow(C.job)).workflow_stage, 'CancellationInProgress');
assert.equal(
  (
    await one(
      `select count(*)::int n from public.tasks where job_id=$1 and template_code='S15-CAN-INSTALLER'`,
      [C.job]
    )
  ).n,
  0
);
// A commissioning record on a cancelled job is refused.
const cElec = await one(
  `select * from public.work_packages where job_id=$1 and trade='Electrical'`,
  [B.job]
);
await refuse(
  'tanya',
  {
    command_id: id(),
    command_type: 'COMMISSIONING_RECORD',
    job_id: B.job,
    work_package_id: cElec.id,
    expected_version: cElec.version,
    payload: { evidence_path: `${B.job}/c.pdf` }
  },
  'R1A_JOB_NOT_ACTIONABLE'
);
// An operationally complete job can still be cancelled; it is flagged for review (S15 risk OPERATIONALLY_COMPLETE).
j = await jobRow(A.job);
await f.as('tanya');
const aPreview = (
  await db.query(`select public.cancellation_preview($1::uuid) p`, [A.job])
).rows[0].p;
assert.ok(
  aPreview.risks.includes('OPERATIONALLY_COMPLETE'),
  JSON.stringify(aPreview.risks)
);

console.log('R1 COMPLETION PASS');

// Staff-facing wording
const worded = (
  await one(
    `select public.describe_command_result('COMMISSIONING_RECORD', $1::jsonb) r`,
    [{ status: 'Recorded' }]
  )
).r;
assert.equal(worded.status, 'Succeeded');
assert.match(worded.message, /^Commissioning evidence recorded/);
assert.equal(
  (
    await one(
      `select public.describe_command_result('CALL_RECORD', $1::jsonb) r`,
      [{ status: 'Recorded' }]
    )
  ).r.message,
  'Call recorded.'
);
const err = (
  await one(
    `select public.describe_command_error('R1A_COMMISSIONING_ALREADY_ACCEPTED') r`
  )
).r;
assert.match(
  err.message,
  /installer commissioning form has already been accepted/
);
console.log('wording ok');
