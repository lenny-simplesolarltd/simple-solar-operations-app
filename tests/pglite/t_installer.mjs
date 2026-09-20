// R3 installer workflow, commissioning review, handover
// PORT_EXTRA=20260919165000_r3_installer_commissioning.sql node t_installer.mjs
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, all, people, cmd, id, ok, as } = f;
const { job } = await readyToBook(f);
const { job: otherJob } = await readyToBook(f);

const count = async (t, where = 'true', p = []) => (await one(`select count(*)::int n from public.${t} where ${where}`, p)).n;
const snapshot = async () => {
  const out = {};
  for (const t of ['audit_events', 'tasks', 'task_events', 'issues', 'issue_events', 'evidence', 'work_packages', 'allocations',
                   'commissioning_submissions', 'commissioning_answers', 'handover', 'commands'])
    out[t] = await count(t);
  out.versions = (await all(`select id, version from public.work_packages union all select id, version from public.commissioning_submissions
                             union all select id, version from public.jobs order by 1`)).map(r => r.id + ':' + r.version).join(',');
  return out;
};
const expectRefusal = async (who, req, code) => {
  const before = await snapshot();
  const r = await cmd(who, req);
  assert.equal(r.error, code, JSON.stringify(r));
  assert.deepEqual(await snapshot(), before, 'refusal wrote something: ' + code);
};
const opsRead = async (who, req) => {
  await as(who);
  try { return (await db.query(`select public.execute_operations_read($1::jsonb) r`, [req])).rows[0].r; }
  catch (e) { return { error: e.message, detail: e.detail }; }
};
const wp = async (w) => one(`select * from public.work_packages where id=$1`, [w]);
const sub = async (s) => one(`select * from public.commissioning_submissions where id=$1`, [s]);
const today = (await one(`select app.london_date(now())::text d`)).d;

// ---- seed booked work -----------------------------------------------------------
const mkWp = async (j, trade, seq, comm = true) => (await one(`insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, commissioning_required, sequence)
  values ($1,$2,true,$3,$3,'Scheduled',$4,$5) returning id`, [j, trade, today, comm, seq])).id;
const roof = await mkWp(job, 'Roof', 1);
const elec = await mkWp(job, 'Electrical', 2);
const other = await mkWp(otherJob, 'Roof', 1);
await db.query(`insert into public.allocations (work_package_id, person_id, role, start_at, end_at) values
  ($1,$3,'Lead',$5,$5), ($2,$4,'Lead',$5,$5), ($6,$3,'Lead',$5,$5)`, [roof, elec, people.inst_a, people.inst_b, today, other]);

const iw = (type, w, j, payload = {}, extra = {}) => ({ command_id: id(), command_type: type, job_id: j, work_package_id: w, payload, ...extra });

// ---- modes fail closed -------------------------------------------------------------
let w = await wp(roof);
await expectRefusal('inst_a', iw('IW_START', roof, job, {}, { expected_version: w.version }), 'R1A_MODE_DENIED');
await db.query(`update public.release_modes set mode='Automated', authorised_job_scope='Pilot' where function_id in ('FN-06','FN-07','FN-08')`);

// ---- IW_START: access rules and refusals -------------------------------------------
const start = iw('IW_START', roof, job, {}, { expected_version: w.version });
await expectRefusal('store', start, 'R1A_ROLE_DENIED');
await expectRefusal('dan', start, 'R1A_ROLE_DENIED');
await expectRefusal('inst_b', start, 'R1C_ASSIGNMENT_DENIED');
await expectRefusal('tanya', start, 'R1C_OFFICE_REASON_REQUIRED');
await expectRefusal('inst_a', { ...start, job_id: otherJob }, 'R1C_JOB_MISMATCH');
await expectRefusal('inst_a', { ...start, expected_version: w.version + 1 }, 'R1C_STALE_VERSION');
for (const v of [null, 0, -1, 1.5, true, '', '1.5'])
  await expectRefusal('inst_a', { ...start, expected_version: v }, 'R1C_EXPECTED_VERSION_REQUIRED');
await expectRefusal('inst_a', { ...start, payload: { actor: people.ben } }, 'R1C_INVALID_FIELDS');
await expectRefusal('inst_a', { ...start, task_id: id() }, 'R1C_INVALID_FIELDS');
await expectRefusal('inst_a', { ...start, work_package_id: id() }, 'R1C_WORK_PACKAGE_NOT_FOUND');
// S15 reopen review suppresses installer work
const s15 = (await one(`insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, status, created_rule_version)
  values ($1::uuid,'S15-REOPEN-REVIEW','S15-IW-'||$1::text,'Cancellation','Review',$2,'Open','S15-1.0') returning id`, [job, people.tanya])).id;
await expectRefusal('inst_a', start, 'R1C_JOB_NOT_ACTIONABLE');
await db.query(`update public.tasks set status='Complete' where id=$1`, [s15]);

let r = ok(await cmd('inst_a', start), 'start');
assert.equal(r.status, 'InProgress'); assert.equal(r.expected_version, w.version + 1); assert.equal(r.external_calls, 0);
w = await wp(roof);
assert.equal(w.actual_start.toISOString().slice(0, 10), today);
assert.equal(await count('audit_events', `action='InstallerStart'`), 1);
// exact replay: stored result, nothing written; changed content conflicts
let before = await snapshot();
const again = await cmd('inst_a', start);
assert.equal(again.replayed, true); assert.deepEqual(again.result, r);
assert.deepEqual(await snapshot(), before);
await expectRefusal('inst_a', { ...start, payload: { reason: 'changed' } }, 'R1A_COMMAND_CONFLICT');
// office acting with a reason
r = ok(await cmd('tanya', iw('IW_START', roof, job, { reason: 'Installer phoned in' }, { expected_version: w.version })), 'office start');
assert.equal(r.status, 'InProgress');
assert.equal((await one(`select reason from public.audit_events where action='InstallerStart' order by occurred_at desc limit 1`)).reason, 'Installer phoned in');

// ---- IW_PROGRESS -------------------------------------------------------------------
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_PROGRESS', roof, job, {}, { expected_version: w.version }), 'IW_REVIEW: note or evidence required');
await expectRefusal('inst_a', iw('IW_PROGRESS', roof, job, { evidence: 'x' }, { expected_version: w.version }), 'R1C_INVALID_EVIDENCE');
await expectRefusal('inst_a', iw('IW_PROGRESS', roof, job, { evidence: [{ storage_path: `${job}/a.jpg` }, { filename: 'no path' }] }, { expected_version: w.version }), 'R1C_EVIDENCE_FILE_REQUIRED');
await expectRefusal('inst_a', iw('IW_PROGRESS', roof, job, { evidence: [{ storage_path: `${otherJob}/a.jpg` }] }, { expected_version: w.version }), 'R1C_UPLOAD_PATH_INVALID');
await expectRefusal('inst_a', iw('IW_PROGRESS', roof, job, { evidence: [{ storage_path: `${job}/a.jpg`, category: 'Selfie' }] }, { expected_version: w.version }), 'R1C_INVALID_FIELDS');
r = ok(await cmd('inst_a', iw('IW_PROGRESS', roof, job, { note: 'Rails on', evidence: [{ storage_path: `${job}/rails.jpg`, filename: 'rails.jpg', mime_type: 'image/jpeg' }] }, { expected_version: w.version })), 'progress');
assert.equal(r.expected_version, w.version + 1, 'append-only progress consumes the package version');
assert.equal(r.evidence.length, 1); assert.equal(r.evidence[0].created, true);
const ev = await one(`select * from public.evidence where id=$1`, [r.evidence[0].evidence_id]);
assert.equal(ev.category, 'Progress'); assert.equal(ev.captured_by, people.inst_a); assert.equal(ev.customer_shareable, false); assert.equal(ev.mime_type, 'image/jpeg');
w = await wp(roof);
r = ok(await cmd('inst_a', iw('IW_PROGRESS', roof, job, { note: 'same photo', evidence: [{ storage_path: `${job}/rails.jpg` }] }, { expected_version: w.version })), 'progress dedupe');
assert.equal(r.evidence[0].created, false);
// cross-job: a file already stored for another job
await db.query(`insert into public.evidence (job_id, category, storage_path, filename, upload_status) values ($1,'Other',$2,'x.jpg','Uploaded')`, [otherJob, `${job}/stolen.jpg`]);
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_PROGRESS', roof, job, { note: 'x', evidence: [{ storage_path: `${job}/stolen.jpg` }] }, { expected_version: w.version }), 'R1C_CROSS_JOB_EVIDENCE');

// ---- problems and variations ---------------------------------------------------------
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_REPORT_PROBLEM', roof, job, { category: 'Weather', description: 'x' }, { expected_version: w.version }), 'IW_REVIEW: category must be one of Access/Damage/Technical/Safety/MaterialsShort/Other');
await expectRefusal('inst_a', iw('IW_REPORT_PROBLEM', roof, job, { category: 'Access', description: 'x', blocks_completion: false }, { expected_version: w.version }), 'R1C_INVALID_FIELDS');
const prob = iw('IW_REPORT_PROBLEM', roof, job, { category: 'Safety', description: 'Loose tiles near eaves', evidence: [{ storage_path: `${job}/tiles.jpg` }] }, { expected_version: w.version });
r = ok(await cmd('inst_a', prob), 'problem');
assert.ok(r.issue_id); assert.equal(r.issue, undefined, 'installer response carries no issue row'); assert.equal(r.expected_version, w.version + 1);
let iss = await one(`select * from public.issues where id=$1`, [r.issue_id]);
assert.equal(iss.type, 'Remedial'); assert.equal(iss.severity, 'High'); assert.equal(iss.blocks_completion, true);
assert.equal(iss.office_owner_id, people.tanya); assert.equal(iss.raised_by, people.inst_a); assert.equal(iss.approval_status, 'NotRequired');
assert.equal(await count('issue_events', `issue_id=$1 and event_type='Opened'`, [iss.id]), 1);
let t = await one(`select * from public.tasks where instance_key=$1`, [`ISS02-${iss.id}`]);
assert.equal(t.owner_id, people.tanya); assert.equal(t.related_entity_type, 'Issues'); assert.match(t.title, /Safety on Roof$/);
assert.equal((await one(`select issue_id from public.evidence where storage_path=$1`, [`${job}/tiles.jpg`])).issue_id, iss.id);
assert.equal((await cmd('inst_a', prob)).replayed, true);
assert.equal(await count('issues'), 1);
const safetyIssue = iss.id;
w = await wp(roof);
r = ok(await cmd('inst_a', iw('IW_REPORT_PROBLEM', roof, job, { category: 'Access', description: 'Gate locked' }, { expected_version: w.version })), 'access problem');
assert.equal((await one(`select blocks_completion from public.issues where id=$1`, [r.issue_id])).blocks_completion, false);
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_REPORT_VARIATION', roof, job, { description: ' ' }, { expected_version: w.version }), 'IW_REVIEW: description required');
r = ok(await cmd('inst_a', iw('IW_REPORT_VARIATION', roof, job, { description: 'Customer wants bird mesh' }, { expected_version: w.version })), 'variation');
iss = await one(`select * from public.issues where id=$1`, [r.issue_id]);
assert.equal(iss.type, 'Variation'); assert.equal(iss.approval_status, 'Pending'); assert.equal(iss.blocks_completion, false);
assert.equal(iss.office_owner_id, people.hannah);
assert.equal((await one(`select to_char($1::timestamptz at time zone 'Europe/London','HH24:MI') h`, [iss.due_at])).h, '17:00');
t = await one(`select * from public.tasks where instance_key=$1`, [`ISS01-${iss.id}`]);
assert.equal(t.owner_id, people.hannah);

// ---- commissioning draft (no approved template) -------------------------------------
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { answers: [{ question_key: 'invented', value_boolean: true }] }, { expected_version: w.version }), 'R1C_APPROVED_QUESTION_REQUIRED');
await expectRefusal('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { answers: [] }, { expected_version: w.version }), 'IW_REVIEW: answers or evidence required');
await expectRefusal('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { answers: {} }, { expected_version: w.version }), 'R1C_INVALID_ANSWERS');
r = ok(await cmd('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { evidence: [{ storage_path: `${job}/comm-1.jpg` }] }, { expected_version: w.version })), 'draft');
assert.equal(r.status, 'Draft'); assert.equal(r.template_version, 'NOT_CONFIGURED'); assert.equal(r.expected_version, w.version + 1);
const s1 = r.submission_id;
let s = await sub(s1);
assert.equal(s.installer_id, people.inst_a); assert.equal(s.version, 1);
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { evidence: [{ storage_path: `${job}/comm-2.jpg` }] }, { expected_version: w.version }), 'R1C_STALE_SUBMISSION');
await expectRefusal('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { submission_id: s1, expected_submission_version: 7, evidence: [{ storage_path: `${job}/comm-2.jpg` }] }, { expected_version: w.version }), 'R1C_STALE_SUBMISSION');
r = ok(await cmd('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { submission_id: s1, expected_submission_version: 1, evidence: [{ storage_path: `${job}/comm-2.jpg` }] }, { expected_version: w.version })), 'resume draft');
assert.equal(r.submission_id, s1); assert.equal((await sub(s1)).version, 2);

// ---- report completion Complete: reuses the package's submission --------------------
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_REPORT_COMPLETION', roof, job, { outcome: 'Done', actual_end: today }, { expected_version: w.version }), 'IW_REVIEW: outcome must be Complete or ReturnRequired');
await expectRefusal('inst_a', iw('IW_REPORT_COMPLETION', roof, job, { outcome: 'Complete', actual_end: '2999-01-01' }, { expected_version: w.version }), 'IW_REVIEW: actual_end cannot be in the future');
await expectRefusal('inst_a', iw('IW_REPORT_COMPLETION', roof, job, { outcome: 'Complete', actual_end: '2026-02-30' }, { expected_version: w.version }), 'IW_DATE_INVALID');
await expectRefusal('inst_a', iw('IW_REPORT_COMPLETION', roof, job, { outcome: 'ReturnRequired', actual_end: today }, { expected_version: w.version }), 'IW_REVIEW: return_reason required');
const done = iw('IW_REPORT_COMPLETION', roof, job, { outcome: 'Complete', actual_end: today, evidence: [{ storage_path: `${job}/done.jpg` }] }, { expected_version: w.version });
r = ok(await cmd('inst_a', done), 'complete');
assert.equal(r.status, 'ReportedComplete'); assert.equal(r.commissioning_submission.id, s1); assert.match(r.next, /INS01/);
w = await wp(roof);
assert.equal(w.completion_outcome, 'Complete'); assert.equal(w.installer_confirmation_at, null, 'reporting is not office confirmation');
assert.equal((await cmd('inst_a', done)).replayed, true);
await expectRefusal('inst_a', { ...done, command_id: id(), expected_version: w.version }, 'IW_REVIEW: cannot report completion from ReportedComplete');

// ---- submit / review ---------------------------------------------------------------
s = await sub(s1);
await expectRefusal('inst_a', iw('IW_COMMISSIONING_SUBMIT', roof, job, { submission_id: s1 }, { expected_version: s.version + 1 }), 'R1C_STALE_VERSION');
await expectRefusal('inst_b', iw('IW_COMMISSIONING_SUBMIT', elec, job, { submission_id: s1 }, { expected_version: s.version }), 'R1C_SUBMISSION_MISMATCH');
const submit = iw('IW_COMMISSIONING_SUBMIT', roof, job, { submission_id: s1 }, { expected_version: s.version });
r = ok(await cmd('inst_a', submit), 'submit');
assert.equal(r.status, 'Submitted'); assert.equal(r.expected_version, s.version + 1);
assert.equal((await cmd('inst_a', submit)).replayed, true);
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { evidence: [{ storage_path: `${job}/late.jpg` }] }, { expected_version: w.version }), 'IW_REVIEW: a submission is awaiting review; wait for Returned or Accepted');
s = await sub(s1);
const review = (status, extra = {}) => iw('COMMISSIONING_REVIEW', roof, job, { submission_id: s1, status, review_notes: 'Reviewed', ...extra }, { expected_version: s.version });
await expectRefusal('inst_a', review('Returned'), 'R1A_ROLE_DENIED');
await expectRefusal('tanya', review('Accepted'), 'R1C_APPROVED_TEMPLATE_REQUIRED');
await expectRefusal('tanya', review('Returned', { review_notes: '' }), 'R1C_REVIEW_STATE_OR_NOTES');
await expectRefusal('tanya', review('Maybe'), 'R1C_REVIEW_STATE_OR_NOTES');
r = ok(await cmd('tanya', review('Returned', { review_notes: 'Inverter photo missing' })), 'return');
assert.equal(r.status, 'Returned');
s = await sub(s1);
assert.equal(s.reviewed_by, people.tanya); assert.equal(s.review_notes, 'Inverter photo missing');
// reviewed forms are immutable, even to direct SQL
await assert.rejects(db.query(`update public.commissioning_submissions set review_notes='x' where id=$1`, [s1]), /immutable/);

// ---- supersede a Returned form -----------------------------------------------------
w = await wp(roof);
await expectRefusal('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { submission_id: s1, expected_submission_version: s.version, evidence: [{ storage_path: `${job}/comm-1.jpg` }] }, { expected_version: w.version }),
  'IW_REVIEW: evidence file already linked to another submission; upload it again');
r = ok(await cmd('inst_a', iw('IW_COMMISSIONING_DRAFT', roof, job, { submission_id: s1, expected_submission_version: s.version, evidence: [{ storage_path: `${job}/inverter.jpg` }, { storage_path: `${job}/rails.jpg` }] }, { expected_version: w.version })), 'supersede');
const s2 = r.submission_id;
assert.notEqual(s2, s1);
assert.equal((await sub(s2)).supersedes_submission_id, s1);
assert.deepEqual(await sub(s1), s, 'returned form untouched');
assert.equal((await one(`select submission_id from public.evidence where storage_path=$1`, [`${job}/rails.jpg`])).submission_id, s2, 'unlinked progress photo linked');
assert.equal(await count('evidence', 'submission_id=$1', [s1]), 2, 'original evidence links retained');
let rd = await opsRead('inst_a', { read_type: 'INSTALLER_WORKFLOW', work_package_id: roof });
assert.equal(rd.data.submission.id, s2); assert.equal(rd.data.evidence.length, 2); assert.equal(rd.data.questions.length, 0);
assert.ok(!JSON.stringify(rd).includes('gross_pence'));
assert.equal((await opsRead('inst_b', { read_type: 'INSTALLER_WORKFLOW', work_package_id: roof })).error, 'R1C_ASSIGNMENT_DENIED');
assert.equal((await opsRead('inst_a', { read_type: 'INSTALLER_WORKFLOW', work_package_id: roof, job_id: job })).error, 'R1C_INVALID_FIELDS');
assert.equal((await opsRead('tanya', { read_type: 'INSTALLER_WORKFLOW', work_package_id: roof })).data.work_package_id, roof, 'office reads without a reason');

// ---- approved template: answers, submit, accept (electrical, inst_b) -----------------
const tpl = (await one(`insert into public.commissioning_templates (trade, equipment_type, template_version, effective_from, active, approved_by, approved_at)
  values ('Electrical','Inverter','TEST-APPROVED-1','2026-01-01',true,$1,now()) returning id`, [people.ben])).id;
await db.query(`insert into public.commissioning_questions (template_id, question_key, label, data_type, display_order)
  values ($1,'inverter_serial','Inverter serial','Text',1), ($1,'panels_fitted','Panels fitted','Number',2)`, [tpl]);
w = await wp(elec);
ok(await cmd('inst_b', iw('IW_START', elec, job, {}, { expected_version: w.version })), 'start elec');
w = await wp(elec);
r = ok(await cmd('inst_b', iw('IW_REPORT_COMPLETION', elec, job, { outcome: 'Complete', actual_end: today }, { expected_version: w.version })), 'complete elec');
const e1 = r.commissioning_submission.id;
assert.equal((await sub(e1)).template_version, 'NOT_CONFIGURED');
// Regression (20260920150000): the draft IW_REPORT_COMPLETION opens is stamped
// NOT_CONFIGURED, and the read used to demand an exact version match - so the
// installer's form offered no questions at all and the submission could never
// leave NOT_CONFIGURED, which in turn disabled Accept. The read must use the
// same rule as app.iw_approved_template.
rd = await opsRead('inst_b', { read_type: 'INSTALLER_WORKFLOW', work_package_id: elec });
assert.equal(rd.data.submission.template_version, 'NOT_CONFIGURED');
assert.deepEqual(rd.data.questions.map((q) => q.question_key).sort(), ['inverter_serial', 'panels_fitted'],
  'a NOT_CONFIGURED draft still offers the approved template questions');
w = await wp(elec);
await expectRefusal('inst_b', iw('IW_COMMISSIONING_DRAFT', elec, job, { submission_id: e1, expected_submission_version: 1, answers: [{ question_key: 'panels_fitted', value_number: '12' }] }, { expected_version: w.version }), 'R1C_INVALID_ANSWER');
await expectRefusal('inst_b', iw('IW_COMMISSIONING_DRAFT', elec, job, { submission_id: e1, expected_submission_version: 1, answers: [{ question_key: 'roof_angle', value_number: 30 }] }, { expected_version: w.version }), 'R1C_APPROVED_QUESTION_REQUIRED');
r = ok(await cmd('inst_b', iw('IW_COMMISSIONING_DRAFT', elec, job, { submission_id: e1, expected_submission_version: 1, answers: [{ question_key: 'inverter_serial', value_text: 'INV-1' }, { question_key: 'panels_fitted', value_number: 10 }] }, { expected_version: w.version })), 'answers');
assert.equal(r.template_version, 'TEST-APPROVED-1', 'NOT_CONFIGURED draft adopts the approved template');
w = await wp(elec); s = await sub(e1);
ok(await cmd('inst_b', iw('IW_COMMISSIONING_DRAFT', elec, job, { submission_id: e1, expected_submission_version: s.version, answers: [{ question_key: 'panels_fitted', value_number: 12 }] }, { expected_version: w.version })), 'upsert');
assert.equal(Number((await one(`select value_number from public.commissioning_answers where submission_id=$1 and question_key='panels_fitted'`, [e1])).value_number), 12);
assert.equal(await count('commissioning_answers', 'submission_id=$1', [e1]), 2);
s = await sub(e1);
ok(await cmd('inst_b', iw('IW_COMMISSIONING_SUBMIT', elec, job, { submission_id: e1 }, { expected_version: s.version })), 'submit elec');
await assert.rejects(db.query(`update public.commissioning_answers set value_text='changed' where submission_id=$1`, [e1]), /immutable/, 'answers never overwritten once submitted');
s = await sub(e1);
const accept = iw('COMMISSIONING_REVIEW', elec, job, { submission_id: e1, status: 'Accepted', review_notes: 'Technical review completed' }, { expected_version: s.version });
r = ok(await cmd('tanya', accept), 'accept');
assert.equal(r.status, 'Accepted'); assert.equal((await sub(e1)).reviewed_by, people.tanya);
assert.equal((await cmd('tanya', accept)).replayed, true);
w = await wp(elec);
await expectRefusal('inst_b', iw('IW_COMMISSIONING_DRAFT', elec, job, { evidence: [{ storage_path: `${job}/after.jpg` }] }, { expected_version: w.version }), 'IW_REVIEW: commissioning already accepted for this package');
// OPERATIONAL_COMPLETE gate now sees the accepted electrical form; roof still outstanding
const gate = (await one(`select app.s10_evaluate_operational_completion($1) g`, [job])).g;
assert.ok(!gate.reasons.includes(`COMMISSIONING_NOT_ACCEPTED:${elec}`)); assert.ok(gate.reasons.includes(`COMMISSIONING_NOT_ACCEPTED:${roof}`));

// ---- ReturnRequired on the other job's package --------------------------------------
w = await wp(other);
const ret = iw('IW_REPORT_COMPLETION', other, otherJob, { outcome: 'ReturnRequired', actual_end: today, return_reason: 'Two panels short', evidence: [{ storage_path: `${otherJob}/short.jpg` }] }, { expected_version: w.version });
r = ok(await cmd('inst_a', ret), 'return required');
assert.equal(r.status, 'ReturnRequired'); assert.ok(r.return_package_id); assert.ok(r.return_allocation_id); assert.ok(r.issue_id);
assert.equal(r.return_package, undefined);
const rp = await wp(r.return_package_id);
assert.equal(rp.trade, 'Roof'); assert.equal(rp.parent_package_id, other); assert.equal(rp.status, 'Unscheduled'); assert.equal(rp.sequence, 2);
const ra = await one(`select * from public.allocations where id=$1`, [r.return_allocation_id]);
assert.equal(ra.person_id, people.inst_a); assert.equal(ra.role, 'Lead'); assert.equal(ra.start_at, null);
iss = await one(`select * from public.issues where id=$1`, [r.issue_id]);
assert.equal(iss.category, 'ReturnRequired'); assert.equal(iss.responsible_person_id, people.inst_a);
assert.equal(iss.linked_return_package_id, rp.id); assert.equal(iss.blocks_completion, true);
assert.equal((await one(`select issue_id from public.evidence where storage_path=$1`, [`${otherJob}/short.jpg`])).issue_id, iss.id);
const rem = await one(`select * from public.tasks where instance_key=$1`, [`REM01-${iss.id}`]);
const bkg = await one(`select * from public.tasks where instance_key=$1`, [`BKG02-${rp.id}`]);
assert.equal(rem.owner_id, people.tanya); assert.equal(bkg.owner_id, people.tanya); assert.equal(bkg.related_entity_id, rp.id);
assert.equal((await one(`select to_char($1::timestamptz at time zone 'Europe/London','HH24:MI') h`, [bkg.due_at])).h, '09:00');
assert.equal((await cmd('inst_a', ret)).replayed, true);
assert.equal(await count('work_packages', 'job_id=$1', [otherJob]), 2, 'one return per replay');

// ---- INSTALLER_MY_WORK -----------------------------------------------------------------
rd = await opsRead('inst_a', { read_type: 'INSTALLER_MY_WORK' });
assert.equal(rd.data.count, 3, 'roof + other + return package');
assert.ok(rd.data.items.every(i => i.site && i.site.postcode));
assert.ok(!JSON.stringify(rd).includes('gross_pence'));
assert.equal((await opsRead('inst_b', { read_type: 'INSTALLER_MY_WORK' })).data.count, 1);
assert.equal((await opsRead('inst_a', { read_type: 'INSTALLER_MY_WORK', payload: { from: '2999-01-01' } })).data.count, 1, 'dateless return package stays');
assert.equal((await opsRead('store', { read_type: 'INSTALLER_MY_WORK' })).error, 'R1A_ROLE_DENIED');

// ---- Handover --------------------------------------------------------------------------
let hr = await opsRead('tanya', { read_type: 'HANDOVER_READINESS', job_id: job });
assert.equal(hr.data.ready, false); assert.equal(hr.data.submissions_count, 2, 'superseded Returned form not counted');
assert.equal((await opsRead('inst_a', { read_type: 'HANDOVER_READINESS', job_id: job })).error, 'R1A_ROLE_DENIED');
let j = await one(`select * from public.jobs where id=$1`, [job]);
const ho = { command_id: id(), command_type: 'HANDOVER_CREATE', job_id: job, expected_version: j.version,
             payload: { checklist_version: 'HO-1.0', required_document_types: ['Certificate', 'Warranty'] } };
await expectRefusal('inst_a', ho, 'R1A_ROLE_DENIED');
await expectRefusal('tanya', { ...ho, payload: { ...ho.payload, required_document_types: 'Certificate' } }, 'S12_REVIEW: required_document_types must be a list of document types');
await expectRefusal('tanya', { ...ho, expected_version: j.version + 1 }, 'R1A_STALE_VERSION');
r = ok(await cmd('tanya', ho), 'handover');
assert.equal(r.status, 'Created'); assert.equal(r.handover.completeness_status, 'Pending'); assert.equal(r.readiness.ready, false);
assert.equal((await cmd('tanya', ho)).replayed, true);
r = ok(await cmd('tanya', { ...ho, command_id: id() }), 'handover again');
assert.equal(r.status, 'AlreadyExists'); assert.equal(await count('handover'), 1);

console.log('t_installer: all assertions passed');
