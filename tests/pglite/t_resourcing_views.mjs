// View-port resourcing reads (STAFF_AVAILABILITY, INSTALLER_SKILLS,
// SCAFFOLD_BOARD, COMMISSIONING_QUEUE). Run with PORT_ALL=1 (the runner does).
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';
const f = await setup();
const { db, one, people, cmd, id, ok, sell, as } = f;
async function ops(who, request) {
  await as(who);
  try { return (await db.query(`select public.execute_operations_read($1::jsonb) r`, [request])).rows[0].r; }
  catch (e) { return { error: e.message }; }
}
const data = (r, msg) => { if (!r || !r.ok) { console.log('FAILED:', msg, r); process.exit(1); } return r.data; };
const today = (await one(`select app.london_date(now())::text d`)).d;
const plus = async n => (await one(`select (app.london_date(now()) + $1::int)::text d`, [n])).d;

// ---- STAFF_AVAILABILITY -------------------------------------------------------
ok(await cmd('tanya', { command_id: id(), command_type: 'RP_SET_AVAILABILITY',
  payload: { person_id: people.inst_a, type: 'Leave', from_date: await plus(3), to_date: await plus(5), reason: 'holiday' } }), 'leave');
ok(await cmd('tanya', { command_id: id(), command_type: 'RP_SET_AVAILABILITY',
  payload: { person_id: people.tanya, type: 'Training', from_date: await plus(90) } }), 'far training');
let r = data(await ops('tanya', { read_type: 'STAFF_AVAILABILITY' }), 'availability');
assert.equal(r.from, today);
assert.equal(r.entries.length, 1, 'the 90-day entry is outside the default 8-week window');
assert.equal(r.entries[0].display_name, 'Installer A'); assert.equal(r.entries[0].type, 'Leave');
assert.equal(r.entries[0].is_installer, true);
assert.ok(r.people.length >= 8);
r = data(await ops('tanya', { read_type: 'STAFF_AVAILABILITY', to: await plus(120) }), 'wider window');
assert.equal(r.entries.length, 2);
assert.equal((await ops('tanya', { read_type: 'STAFF_AVAILABILITY', from: 'soon' })).error.split(':')[0], 'RP_DATE_INVALID');
assert.equal((await ops('inst_a', { read_type: 'STAFF_AVAILABILITY' })).error, 'R1A_ROLE_DENIED');

// ---- INSTALLER_SKILLS -----------------------------------------------------------
ok(await cmd('tanya', { command_id: id(), command_type: 'RP_SET_SKILL',
  payload: { person_id: people.inst_a, skill: 'Roof', level: 'Lead', certified_until: '2020-01-01' } }), 'skill');
r = data(await ops('hannah', { read_type: 'INSTALLER_SKILLS' }), 'skills');
assert.deepEqual(r.installers.map(i => i.display_name), ['Installer A', 'Installer B']);
const a = r.installers[0];
assert.equal(a.skills.length, 1); assert.equal(a.skills[0].level, 'Lead'); assert.equal(a.skills[0].expired, true);
assert.equal(a.capacity_per_day, 1);
assert.ok(r.skills.includes('Roof'));

// ---- SCAFFOLD_BOARD ---------------------------------------------------------------
const sold = await sell('tanya', { customer: { last_name: 'Scaff' } });
await db.query(`update public.jobs set workflow_stage = 'Booked' where id = $1`, [sold.job_id]);
r = data(await ops('tanya', { read_type: 'SCAFFOLD_BOARD' }), 'scaffold board');
assert.equal(r.bookings.length, 0);
assert.deepEqual(r.needs_request.map(j => j.job_id), [sold.job_id]);
await db.query(`insert into public.scaffold_bookings (job_id, erect_planned_at, status, revision) values ($1, current_date + 10, 'Requested', 1)`, [sold.job_id]);
r = data(await ops('tanya', { read_type: 'SCAFFOLD_BOARD' }), 'scaffold board with booking');
assert.equal(r.bookings.length, 1); assert.equal(r.bookings[0].status, 'Requested');
assert.equal(r.bookings[0].acknowledgement_required, true);
assert.equal(r.needs_request.length, 0);
r = data(await ops('tanya', { read_type: 'SCAFFOLD_BOARD', view: 'finished' }), 'finished');
assert.equal(r.bookings.length, 0);
assert.equal((await ops('tanya', { read_type: 'SCAFFOLD_BOARD', view: 'x' })).error, 'R1A_INVALID_FIELDS');

// ---- COMMISSIONING_QUEUE --------------------------------------------------------
r = data(await ops('tanya', { read_type: 'COMMISSIONING_QUEUE' }), 'commissioning');
assert.equal(r.count, 0);
assert.equal((await ops('dan', { read_type: 'COMMISSIONING_QUEUE' })).error, 'R1A_ROLE_DENIED');

console.log('t_resourcing_views: all assertions passed');
