// View-port booking reads (BOOKING_BOARD, BOOKING_FORM, INTAKE_REVIEW_QUEUE).
// Run with PORT_ALL=1 (the runner does).
import assert from 'node:assert/strict';
import { setup, readyToBook } from './fixtures.mjs';
const f = await setup();
const { db, one, people, cmd, id, ok, as } = f;
async function ops(who, request) {
  await as(who);
  try {
    return (
      await db.query(`select public.execute_operations_read($1::jsonb) r`, [
        request
      ])
    ).rows[0].r;
  } catch (e) {
    return { error: e.message, detail: e.detail };
  }
}
const data = (r, msg) => {
  if (!r || !r.ok) {
    console.log('FAILED:', msg, r);
    process.exit(1);
  }
  return r.data;
};

const { job, jobRef } = await readyToBook(f);
const sold2 = await f.sell('tanya', {
  customer: { last_name: 'Jones', postcode: 'YO1 2BB' }
});

// ---- BOOKING_BOARD: views, counts, gates, availability ----------------------
let r = data(await ops('tanya', { read_type: 'BOOKING_BOARD' }), 'ready view');
assert.equal(r.view, 'ready');
assert.deepEqual(r.counts, {
  prebooking: 1,
  ready: 1,
  in_progress: 0,
  upcoming: 0
});
assert.deepEqual(
  r.jobs.map((j) => j.id),
  [job]
);
assert.equal(r.jobs[0].job_ref, jobRef);
assert.equal(
  r.jobs[0].commands.booking_intake.available,
  true,
  'tanya may start the booking'
);
assert.equal(r.jobs[0].gates, null, 'no gate evaluation on ReadyToBook rows');

r = data(
  await ops('tanya', { read_type: 'BOOKING_BOARD', view: 'prebooking' }),
  'prebooking view'
);
assert.deepEqual(
  r.jobs.map((j) => j.id),
  [sold2.job_id]
);
assert.equal(r.jobs[0].gates.ready, false);
assert.ok(
  r.jobs[0].gates.failing.some((g) => g.name === 'PRE02_satisfied'),
  'outstanding prebooking gate listed'
);

r = data(
  await ops('tanya', {
    read_type: 'BOOKING_BOARD',
    view: 'prebooking',
    q: 'smith'
  }),
  'search'
);
assert.equal(r.total, 0);

// ---- BOOKING_FORM ------------------------------------------------------------
r = data(
  await ops('tanya', { read_type: 'BOOKING_FORM', job_id: job }),
  'form'
);
assert.equal(r.job.id, job);
assert.equal(r.job.workflow_stage, 'ReadyToBook');
assert.equal(r.customer.first_name, 'Ann');
assert.equal(r.customer.postcode, 'LS1 1AA');
assert.deepEqual(r.options.installers.map((i) => i.name).sort(), [
  'Installer A',
  'Installer B'
]);
assert.equal(r.materials.length, 33);
assert.ok(r.materials.find((m) => m.key === 'mat_r420181_total').derived_total);
assert.equal(r.commands.booking_intake.available, true);
assert.equal(r.current.last_intake, null);

// Book it with a surname that differs from the sale -> Intake Review.
const jv = await one(`select version from public.jobs where id=$1`, [job]);
const booked = ok(
  await cmd('tanya', {
    command_id: id(),
    command_type: 'BOOKING_INTAKE',
    job_id: job,
    expected_version: jv.version,
    payload: {
      customer_last_name: 'Smyth',
      date_roofer: '2026-10-05',
      date_sparky: '2026-10-06',
      roofer: 'Installer A',
      sparky: people.inst_b,
      mat_panel_515: 12
    }
  }),
  'booking intake'
);
assert.equal(booked.status, 'Review');

r = data(
  await ops('tanya', { read_type: 'BOOKING_FORM', job_id: job }),
  'form after booking'
);
assert.equal(r.job.workflow_stage, 'BookingInProgress');
assert.equal(r.current.schedule.roof_date, '2026-10-05');
assert.deepEqual(r.current.schedule.team.map((t) => t.name).sort(), [
  'Installer A',
  'Installer B'
]);
assert.equal(r.current.last_intake.status, 'Review');
assert.ok(
  r.current.last_intake.errors.some((e) => e.error === 'CUSTOMER_MISMATCH')
);
assert.equal(r.gates.ready, false);

r = data(
  await ops('tanya', { read_type: 'BOOKING_BOARD', view: 'in_progress' }),
  'in progress'
);
assert.deepEqual(
  r.jobs.map((j) => j.id),
  [job]
);
const row = r.jobs[0];
assert.equal(row.in_review, true);
assert.equal(row.match_status, 'Review');
assert.ok(row.gates.failing.some((g) => g.name === 'sold_booking_match'));
assert.equal(row.commands.confirm_booking.available, false);
assert.equal(row.commands.confirm_booking.reason, 'BOOKING_CHECKS_OUTSTANDING');
assert.equal(r.can_confirm, true);

// ---- INTAKE_REVIEW_QUEUE -------------------------------------------------------
r = data(
  await ops('tanya', { read_type: 'INTAKE_REVIEW_QUEUE' }),
  'intake review'
);
assert.equal(r.count, 1);
assert.equal(r.items[0].job.id, job);
assert.equal(r.items[0].job.can_open, true);
assert.deepEqual(
  r.items[0].customer_changes.map((c) => [
    c.field_name,
    c.previous_value,
    c.incoming_value
  ]),
  [['last_name', 'Smith', 'Smyth']]
);

// ---- refusals -------------------------------------------------------------------
assert.equal(
  (await ops('sam', { read_type: 'BOOKING_BOARD' })).error,
  'R1A_ROLE_DENIED'
);
assert.equal(
  (await ops('hannah', { read_type: 'INTAKE_REVIEW_QUEUE' })).error,
  'R1A_ROLE_DENIED'
);
assert.equal(
  (await ops('tanya', { read_type: 'BOOKING_BOARD', view: 'bogus' })).error,
  'R1A_INVALID_FIELDS'
);
assert.equal(
  (await ops('tanya', { read_type: 'BOOKING_FORM' })).error,
  'R1A_JOB_NOT_FOUND'
);
// Hannah (job.read.all) can read the form but may not submit: not assigned.
r = data(
  await ops('hannah', { read_type: 'BOOKING_FORM', job_id: sold2.job_id }),
  'hannah form'
);
assert.equal(r.assigned, false);
assert.equal(r.commands.booking_intake.available, false);

console.log('t_booking_views: all assertions passed');
