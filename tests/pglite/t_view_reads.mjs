// View-port read models (TASKS, TASK_DETAIL, JOBS, OFFICE_DASHBOARD, MY_REQUESTS) and
// canonical read visibility. Run with PORT_EXTRA=20260919170000_view_port_reads.sql (or PORT_ALL=1).
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, people, cmd, id, ok, as } = f;
async function ops(who, request) {
  await as(who);
  try { return (await db.query(`select public.execute_operations_read($1::jsonb) r`, [request])).rows[0].r; }
  catch (e) { return { error: e.message, detail: e.detail }; }
}
const data = (r, msg) => { if (!r || !r.ok) { console.log('FAILED:', msg, r); process.exit(1); } return r.data; };

const { job, jobRef } = await readyToBook(f);
const sold2 = await f.sell('tanya', { customer: { last_name: 'Jones', postcode: 'YO1 2BB' } });

// ---- TASKS: my / team / history / queue / due / text / redaction ----------
let r = data(await ops('tanya', { read_type: 'TASKS' }), 'my tasks');
assert.equal(r.scope, 'my');
assert.ok(r.tasks.length > 0 && r.tasks.every(t => t.owner_id === people.tanya || t.backup_id === people.tanya));
assert.ok(r.tasks.every(t => !['Complete', 'Cancelled', 'NotRequired'].includes(t.status)));
// AppSheet parity: open undated non-booking tasks are included (MY_TASKS dropped them).
const pre04 = r.tasks.find(t => t.template_code === 'PRE04' && t.job_id === sold2.job_id);
assert.ok(pre04, 'undated PRE04 on the second job is in My Tasks');
assert.equal(pre04.job_ref, sold2.job_ref); assert.equal(pre04.customer_name, 'Ann Jones'); assert.equal(pre04.postcode, 'YO1 2BB');

r = data(await ops('tanya', { read_type: 'TASKS', status: 'closed' }), 'history');
assert.ok(r.tasks.length >= 3 && r.tasks.every(t => t.status === 'Complete'));
assert.ok(r.tasks[0].completed_at && r.tasks[0].completed_by_name);

r = data(await ops('tanya', { read_type: 'TASKS', q: 'jones' }), 'text');
assert.ok(r.tasks.length > 0 && r.tasks.every(t => t.job_id === sold2.job_id));
r = data(await ops('tanya', { read_type: 'TASKS', q: 'yo12bb' }), 'postcode without space');
assert.ok(r.tasks.length > 0);

r = data(await ops('tanya', { read_type: 'TASKS', scope: 'team' }), 'team');
assert.equal(r.can_view_team, true);
assert.ok(r.tasks.some(t => t.template_code === 'PRE03'), 'PRE03 (ben) in tanya team view');
assert.ok(r.tasks.every(t => t.owner_id !== people.tanya));

r = data(await ops('tanya', { read_type: 'TASKS', scope: 'all', owner_id: people.ben }), 'owner filter');
assert.ok(r.tasks.every(t => t.owner_id === people.ben || t.backup_id === people.ben));

r = data(await ops('tanya', { read_type: 'TASKS', scope: 'all', job_id: jobRef }), 'job filter by ref');
assert.ok(r.tasks.every(t => t.job_id === job));

r = data(await ops('tanya', { read_type: 'TASKS', scope: 'all', due: 'none' }), 'due none');
assert.ok(r.tasks.every(t => t.due_at === null));

// Surveyor: no team visibility; direct call refused (hidden nav is not security).
assert.equal((await ops('sam', { read_type: 'TASKS', scope: 'team' })).error, 'R1A_ROLE_DENIED');
assert.equal((await ops('tanya', { read_type: 'TASKS', bogus: 1 })).error, 'R1A_INVALID_FIELDS');
assert.equal((await ops('tanya', { read_type: 'TASKS', queue: 'nope' })).error, 'R1A_INVALID_FIELDS');
assert.equal((await ops(null, { read_type: 'TASKS' })).error, 'R1A_AUTHENTICATED_EMAIL_REQUIRED');

// Booking queue = tasks in group Booking/Prebooking (reference rule), not a stage guess.
r = data(await ops('tanya', { read_type: 'TASKS', scope: 'all', queue: 'booking' }), 'booking queue');
assert.ok(r.tasks.length > 0 && r.tasks.every(t => ['Booking', 'Prebooking'].includes(t.group)));

// ---- TASK_DETAIL --------------------------------------------------------
const pre03 = await one(`select * from public.tasks where job_id=$1 and template_code='PRE03'`, [sold2.job_id]);
r = data(await ops('ben', { read_type: 'TASK_DETAIL', task_id: pre03.id }), 'task detail');
assert.equal(r.task.id, pre03.id); assert.equal(r.task.is_mine, true); assert.equal(r.job.job_ref, sold2.job_ref);
assert.ok(Array.isArray(r.events)); // tasks created by submit_presale carry no Created event
assert.ok(r.availability, 'availability present');
// Installer has no visibility of that job.
assert.equal((await ops('inst_a', { read_type: 'TASK_DETAIL', task_id: pre03.id })).error, 'R1A_JOB_ACCESS_DENIED');

// ---- JOBS ---------------------------------------------------------------
r = data(await ops('tanya', { read_type: 'JOBS' }), 'jobs');
assert.equal(r.total, 2);
const j2 = r.jobs.find(x => x.id === sold2.job_id);
assert.equal(j2.customer_name, 'Ann Jones'); assert.equal(j2.workflow_stage, 'Prebooking');
assert.ok(j2.open_tasks > 0 && j2.next_task && j2.next_task.title);
r = data(await ops('tanya', { read_type: 'JOBS', stage: 'ReadyToBook' }), 'stage filter');
assert.deepEqual(r.jobs.map(x => x.id), [job]);
r = data(await ops('tanya', { read_type: 'JOBS', q: jobRef.toLowerCase() }), 'ref search');
assert.deepEqual(r.jobs.map(x => x.id), [job]);
assert.equal((await ops('tanya', { read_type: 'JOBS', stage: 'Nope' })).error, 'R1A_INVALID_FIELDS');
// Canonical visibility: Hannah (VariationApprover, job.read.all) sees both jobs though assigned to neither.
r = data(await ops('hannah', { read_type: 'JOBS' }), 'hannah jobs');
assert.equal(r.total, 2);
// Surveyor sees the jobs they sold (job.read.own; salesperson).
r = data(await ops('sam', { read_type: 'JOBS' }), 'sam jobs');
assert.equal(r.total, 2);
// Installer role cannot call JOBS.
assert.equal((await ops('inst_a', { read_type: 'JOBS' })).error, 'R1A_ROLE_DENIED');
// execute_read JOB_OVERVIEW now follows canonical visibility too (was: assignment only).
await as('hannah');
const ov = (await db.query(`select public.execute_read($1::jsonb) r`, [{ read_type: 'JOB_OVERVIEW', job_id: job }])).rows[0].r;
assert.equal(ov.ok, true);
// ...but acting still needs the reference assignment: hannah is not assigned.
const jr = await one(`select version from public.jobs where id=$1`, [job]);
assert.equal((await cmd('hannah', { command_id: id(), command_type: 'BOOKING_GATES', job_id: job, expected_version: jr.version })).error,
  'R1A_JOB_ACCESS_DENIED');

// ---- OFFICE_DASHBOARD ---------------------------------------------------
r = data(await ops('tanya', { read_type: 'OFFICE_DASHBOARD' }), 'dashboard');
assert.ok(r.my_tasks.open > 0);
assert.equal(r.jobs_by_stage.ReadyToBook, 1); assert.equal(r.jobs_by_stage.Prebooking, 1);
assert.equal(r.can_view_team, true); assert.ok(r.operations.booking_queue > 0);
r = data(await ops('sam', { read_type: 'OFFICE_DASHBOARD' }), 'sam dashboard');
assert.equal(r.can_view_team, false); assert.equal(r.operations.booking_queue, null);

// ---- MY_REQUESTS --------------------------------------------------------
r = data(await ops('tanya', { read_type: 'MY_REQUESTS' }), 'requests');
assert.ok(r.count >= 3);
assert.ok(r.requests.some(x => x.command_type === 'SOLD_INTAKE' && x.job_ref));
assert.ok(r.requests.some(x => x.command_type === 'TASK_COMPLETE' && x.outcome && x.outcome.status === 'Succeeded'));
r = data(await ops('dan', { read_type: 'MY_REQUESTS' }), 'dan requests');
assert.ok(r.requests.every(x => x.command_type !== 'SOLD_INTAKE'), 'only own commands');

console.log('t_view_reads: all assertions passed');
