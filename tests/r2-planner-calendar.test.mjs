// Planner (operations calendar) integration acceptance against a REAL local
// Supabase stack.
//
// The point of these tests is that the calendar has no rules of its own. Every
// move the planner offers is one of the canonical commands, so what is proved
// here is that the commands refuse what they should refuse when the planner
// asks - leave, skills, capacity, job state, stale versions and role - and
// that the windowed reads the calendar is built on show live work, exclude
// historical records, and stay bounded.
//
//   SUPABASE_TEST_WORKDIR=<dir with supabase/config.toml> node --test tests/r2-planner-calendar.test.mjs
//
// Named to run after preview-dev.test.mjs, which counts the rows it can see.
// Needs Storage (the pre-booking journey uploads a real contract). Release
// modes are switched on for this local stack only and restored afterwards.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, person, service, signInAs } from './helpers.mjs';

const hasStorage = !!(await service.storage.getBucket('evidence')).data;
const skip = hasStorage ? false : 'this local stack runs without Storage';

const workdir = process.env.SUPABASE_TEST_WORKDIR
  ? ['--workdir', process.env.SUPABASE_TEST_WORKDIR]
  : [];
const DB_URL = execFileSync('supabase', ['status', '-o', 'env', ...workdir], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
}).match(/^DB_URL="?(.*?)"?$/m)?.[1];
assert.match(
  DB_URL ?? '',
  /^postgresql:\/\/[^@]+@(127\.0\.0\.1|localhost):/,
  'local database only'
);
const sql = (statement) =>
  execFileSync('psql', [DB_URL, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    encoding: 'utf8'
  }).trim();

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const bucket = (client) => client.storage.from('evidence');

// FN-01 and FN-02 together gate every R2 planning command; the planner needs
// both. FN-02 Automated only captures calendar_links + outbox rows - nothing
// is dispatched, because calendar.mode stays CAPTURE and no worker runs here.
const MODES = {
  'FN-01': 'Automated',
  'FN-02': 'Automated',
  'FN-11': 'Manual',
  'FN-15': 'Manual',
  'FN-17': 'Manual',
  'FN-19': 'Manual'
};

let tanya, ben, casey, rick;
const ids = {};
let jobId, pk, historicalJobId;

const day = (offset) => {
  const d = new Date('2026-11-02T12:00:00Z'); // a Monday, clear of the seeds
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function run(client, request) {
  const req = { command_id: randomUUID(), ...request };
  const { data, error } = await client.rpc('execute_command', { p_request: req });
  return { req, data, error, result: data?.result };
}
async function ok(client, request, label) {
  const r = await run(client, request);
  assert.ifError(r.error, `${label}: ${r.error?.message}`);
  assert.equal(r.data.ok, true, label);
  return r;
}
const auditCount = () => Number(sql('select count(*) from public.audit_events'));
/** A refusal returns the reference code and writes nothing at all. */
async function refuse(client, request, code, label = code) {
  const before = auditCount();
  const r = await run(client, request);
  assert.ok(
    r.error,
    `${label}: expected ${code}, got ${JSON.stringify(r.data)?.slice(0, 300)}`
  );
  if (code instanceof RegExp) assert.match(r.error.message, code, label);
  else assert.equal(r.error.message, code, label);
  assert.equal(auditCount(), before, `${label}: a refused command wrote audit`);
  return r;
}
/**
 * A command that ran, decided the person is not eligible and deliberately
 * wrote nothing. This is how the R2 planning commands answer an unavailable
 * or unskilled installer - not an error, but nothing changed.
 */
async function needsReview(client, request, reason, label = reason) {
  const r = await ok(client, request, label);
  assert.equal(r.result.status, 'NeedsReview', `${label}: ${JSON.stringify(r.result)}`);
  assert.equal(r.result.reason, reason, label);
  return r;
}

const opsRead = async (client, request) => {
  const { data, error } = await client.rpc('execute_operations_read', {
    p_request: request
  });
  return { data: data?.data, error };
};
const readOk = async (client, request, label) => {
  const r = await opsRead(client, request);
  assert.ifError(r.error, `${label}: ${r.error?.message}`);
  return r.data;
};

const job = async (id) =>
  (await service.from('jobs').select('*').eq('id', id).single()).data;
const wp = async (id) =>
  (await service.from('work_packages').select('*').eq('id', id).single()).data;
const task = async (j, code) =>
  (
    await service
      .from('tasks')
      .select('*')
      .eq('job_id', j)
      .eq('template_code', code)
      .order('created_at')
      .limit(1)
      .single()
  ).data;

async function upload(client, contextType, contextId, filename) {
  const reg = await client.rpc('evidence_upload_begin', {
    p_request: {
      upload_id: randomUUID(),
      context_type: contextType,
      context_id: contextId,
      filename,
      mime_type: 'application/pdf',
      size_bytes: PDF.length
    }
  });
  assert.ifError(reg.error);
  const ticket = await bucket(client).createSignedUploadUrl(reg.data.storage_path);
  assert.ifError(ticket.error);
  assert.ifError(
    (
      await bucket(client).uploadToSignedUrl(
        reg.data.storage_path,
        ticket.data.token,
        PDF,
        { contentType: 'application/pdf' }
      )
    ).error
  );
  return reg.data;
}

const sale = (salespersonId, tag) => ({
  customer: {
    first_name: 'Nina',
    last_name: 'Planner',
    address_line1: '7 Calendar Way',
    address_line2: null,
    town: 'Torquay',
    postcode: 'TQ3 3HY',
    phone: '07000 000009',
    email: `nina-${tag}@example.com`
  },
  sale: {
    salesperson_id: salespersonId,
    lead_source: 'Referral',
    quote_reference: `Q-PLAN-${tag}`,
    finance_route: 'Standard',
    agreed_price_pence: 900000
  },
  scope: {
    roof_required: true,
    electrical_required: true,
    scaffold_required: true,
    roof_notes: null,
    electrical_notes: null
  },
  design: { slopes: [] },
  design_schema_version: 1,
  catalogue_version: 'test-catalogue',
  computed: {
    system_kwp: 4.2,
    net_panels: 10,
    computed_total_pence: 900000,
    price_breakdown: [{ key: 'total', label: 'Total', pence: 900000 }]
  }
});

/** Sold -> ReadyToBook -> Booked, entirely through the real commands. */
async function bookedJob(tag) {
  const sold = await tanya.rpc('submit_presale', {
    p_command_id: randomUUID(),
    p_payload: sale(ids.rick, `${tag}-${Date.now()}`)
  });
  assert.ifError(sold.error);
  const id = sold.data.job_id;

  let t = await task(id, 'PRE01');
  await ok(
    tanya,
    {
      command_type: 'TASK_COMPLETE',
      task_id: t.id,
      expected_version: t.version,
      payload: {
        completion_note: 'invoice sent',
        invoice_number: `INV-PLAN-${tag}`,
        invoice_sent: true
      }
    },
    'PRE01'
  );
  t = await task(id, 'PRE02');
  const contract = await upload(tanya, 'Task', t.id, 'signed contract.pdf');
  await ok(
    tanya,
    {
      command_type: 'TASK_COMPLETE',
      task_id: t.id,
      expected_version: t.version,
      payload: {
        completion_note: 'signed',
        contract_id: `SIG-PLAN-${tag}`,
        contract_signed: true,
        evidence_path: contract.storage_path
      }
    },
    'PRE02'
  );
  t = await task(id, 'PRE04');
  await ok(
    tanya,
    {
      command_type: 'TASK_COMPLETE',
      task_id: t.id,
      expected_version: t.version,
      payload: {
        completion_note: 'verified',
        customer_details_verified: true,
        sold_value_verified: true,
        verified_gross_amount: 9000
      }
    },
    'PRE04'
  );
  t = await task(id, 'PRE03');
  await ok(
    ben,
    {
      command_type: 'TASK_COMPLETE',
      task_id: t.id,
      expected_version: t.version,
      payload: {
        completion_note: 'deposit in bank',
        deposit_bank_confirmed: true,
        deposit_amount: '2250',
        deposit_received_date: '2026-09-18',
        deposit_bank_reference: `BANK-PLAN-${tag}`
      }
    },
    'PRE03'
  );

  let j = await job(id);
  await ok(
    tanya,
    {
      command_type: 'BOOKING_INTAKE',
      job_id: id,
      expected_version: j.version,
      payload: {
        customer_first_name: 'Nina',
        customer_last_name: 'Planner',
        street_address: '7 Calendar Way',
        city: 'Torquay',
        postcode: 'TQ3 3HY',
        cost: '9000',
        finance_route: 'Standard',
        date_roofer: day(0),
        date_sparky: day(2),
        roofer: ids.angel,
        sparky: ids.casey
      }
    },
    'BOOKING_INTAKE'
  );
  for (const code of ['BKG01', 'BKG02', 'BKG03']) {
    const bt = await task(id, code);
    await ok(
      tanya,
      {
        command_type: 'TASK_COMPLETE',
        task_id: bt.id,
        expected_version: bt.version,
        payload: { completion_note: `${code} done` }
      },
      code
    );
  }
  j = await job(id);
  await ok(
    tanya,
    { command_type: 'CONFIRM_BOOKING', job_id: id, expected_version: j.version },
    'CONFIRM_BOOKING'
  );
  const pkgs = (await service.from('work_packages').select('*').eq('job_id', id))
    .data;
  return {
    id,
    roof: pkgs.find((p) => p.trade === 'Roof'),
    elec: pkgs.find((p) => p.trade === 'Electrical')
  };
}

before(async () => {
  if (!hasStorage) return;
  const names = ['tanya', 'ben', 'casey', 'rick'];
  for (const n of names) await ensureLogin(email(n));
  [tanya, ben, casey, rick] = await Promise.all(
    names.map((n) => signInAs(email(n)))
  );
  for (const [key, legacy] of [
    ['rick', 'PERSON-rick'],
    ['angel', 'PERSON-angel'],
    ['casey', 'PERSON-casey'],
    // Roof-skilled, so there is always a ready alternative to drag onto.
    ['john', 'PERSON-john-doyle'],
    ['josh', 'PERSON-josh-lewis'],
    // Electrical-skilled: the wrong trade for a roof package.
    ['james', 'PERSON-james']
  ]) {
    ids[key] = (await person(legacy)).id;
  }
  for (const [fn, mode] of Object.entries(MODES)) {
    const u = await service
      .from('release_modes')
      .update({ mode, authorised_job_scope: 'Pilot' })
      .eq('function_id', fn);
    assert.ifError(u.error);
  }
  const booked = await bookedJob('cal');
  jobId = booked.id;
  pk = booked;
});

after(async () => {
  if (!hasStorage) return;
  if (historicalJobId) {
    await service.from('work_packages').delete().eq('job_id', historicalJobId);
    await service.from('jobs').delete().eq('id', historicalJobId);
  }
  await service
    .from('release_modes')
    .update({ mode: 'Disabled', authorised_job_scope: 'None' })
    .in('function_id', Object.keys(MODES));
});

// =============================================================================
// PLANNER_WINDOW: what the calendar draws
// =============================================================================
describe('the windowed calendar read', { skip }, () => {
  test('returns exactly the range asked for, with whole-day dates', async () => {
    const data = await readOk(
      tanya,
      { read_type: 'PLANNER_WINDOW', from: day(0), to: day(6) },
      'PLANNER_WINDOW'
    );
    assert.equal(data.from, day(0));
    assert.equal(data.to, day(6));
    assert.equal(data.days, 7);
    assert.ok(Array.isArray(data.rows));
    assert.ok(Array.isArray(data.scaffold));
    assert.ok(Array.isArray(data.holidays));
    for (const row of data.rows) {
      assert.match(row.start_at, /^\d{4}-\d{2}-\d{2}$/, 'dates are days, not timestamps');
      assert.match(row.end_at, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('live scheduled work appears, with the version a command will need', async () => {
    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: day(-7),
      to: day(14)
    });
    const roof = data.rows.find((r) => r.work_package_id === pk.roof.id);
    assert.ok(roof, 'the booked roof package is in the window');
    assert.equal(roof.job_id, jobId);
    assert.equal(roof.trade, 'Roof');
    assert.equal(typeof roof.work_package_version, 'number');
    assert.equal(roof.allocated, true, 'the booking form allocated a roofer');
    assert.ok(roof.person_name, 'the installer is named for the card');
  });

  test('work outside the window is not returned', async () => {
    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: day(60),
      to: day(66)
    });
    assert.equal(
      data.rows.filter((r) => r.job_id === jobId).length,
      0,
      'a window that does not overlap the work returns none of it'
    );
  });

  test('a HistoricalImport job never enters the planner', async () => {
    // A historical record with dated work on it - the shape the planner must
    // refuse to schedule even if such a row somehow existed.
    historicalJobId = randomUUID();
    const live = await job(jobId);
    const copy = {
      ...live,
      id: historicalJobId,
      job_ref: 'SS-HZZZ-0001',
      record_class: 'HistoricalImport',
      archived_at: new Date().toISOString(),
      source_system: 'planner-test',
      created_at: undefined,
      updated_at: undefined,
      version: undefined
    };
    delete copy.created_at;
    delete copy.updated_at;
    delete copy.version;
    const ins = await service.from('jobs').insert(copy);
    assert.ifError(ins.error);
    const pkg = await wp(pk.roof.id);
    const wpIns = await service.from('work_packages').insert({
      ...pkg,
      id: randomUUID(),
      job_id: historicalJobId,
      created_at: undefined,
      updated_at: undefined,
      version: undefined
    });
    assert.ifError(wpIns.error);

    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: day(-7),
      to: day(14)
    });
    assert.equal(
      data.rows.filter((r) => r.job_id === historicalJobId).length,
      0,
      'historical work must not be schedulable operational work'
    );
    assert.ok(
      data.rows.some((r) => r.job_id === jobId),
      'the live job is still there'
    );
  });

  test('a historical job refuses every scheduling command', async () => {
    const pkg = (
      await service
        .from('work_packages')
        .select('*')
        .eq('job_id', historicalJobId)
        .limit(1)
        .single()
    ).data;
    await refuse(
      tanya,
      {
        command_type: 'PLAN_WORK_PACKAGE',
        job_id: historicalJobId,
        work_package_id: pkg.id,
        expected_version: pkg.version,
        payload: {
          person_id: ids.angel,
          start_at: day(3),
          end_at: day(3),
          role: 'Lead'
        }
      },
      // Two guards stand in front of this, and either refusing is correct:
      // app.authorize_job refuses an out-of-scope job (job_in_scope is false
      // for every HistoricalImport row), and app.assert_normal_work refuses a
      // historical one inside the handler. Which fires first is an ordering
      // detail; that nothing can be scheduled is the guarantee.
      /^(R1A_OUTSIDE_PILOT|HISTORICAL_IMPORT)/,
      'historical job is not actionable'
    );
  });

  test('the window is bounded, so the planner cannot ask for a history', async () => {
    const r = await opsRead(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: day(0),
      to: day(400)
    });
    assert.ok(r.error, 'an unbounded window is refused');
    assert.match(r.error.message, /at most 186 days/);
  });

  test('an end before its start is refused', async () => {
    const r = await opsRead(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: day(10),
      to: day(3)
    });
    assert.ok(r.error);
    assert.match(r.error.message, /before its start/);
  });
});

// =============================================================================
// PLANNER_UNSCHEDULED: the "needs scheduling" sidebar
// =============================================================================
describe('unscheduled work', { skip }, () => {
  test('lists required work on actionable jobs that has no dates', async () => {
    // Clear the roof package's dates the way an office would before re-planning.
    const before = await wp(pk.roof.id);
    await service
      .from('work_packages')
      .update({ planned_start: null, planned_end: null })
      .eq('id', pk.roof.id);

    const data = await readOk(tanya, {
      read_type: 'PLANNER_UNSCHEDULED',
      limit: 50
    });
    const mine = data.work.find((w) => w.work_package_id === pk.roof.id);
    assert.ok(mine, 'work with no dates needs scheduling');
    assert.equal(mine.job_id, jobId);
    assert.equal(typeof mine.work_package_version, 'number');
    assert.equal(mine.postcode, 'TQ3 3HY', 'the card can show where it is');
    assert.ok(data.total >= 1);

    await service
      .from('work_packages')
      .update({
        planned_start: before.planned_start,
        planned_end: before.planned_end
      })
      .eq('id', pk.roof.id);
  });

  test('excludes historical records', async () => {
    await service
      .from('work_packages')
      .update({ planned_start: null, planned_end: null })
      .eq('job_id', historicalJobId);
    const data = await readOk(tanya, { read_type: 'PLANNER_UNSCHEDULED' });
    assert.equal(
      data.work.filter((w) => w.job_id === historicalJobId).length,
      0,
      'a historical record is never ready to schedule'
    );
  });

  test('excludes work that already has dates', async () => {
    const data = await readOk(tanya, { read_type: 'PLANNER_UNSCHEDULED' });
    assert.equal(
      data.work.filter((w) => w.work_package_id === pk.roof.id).length,
      0,
      'scheduled work is not waiting to be scheduled'
    );
  });
});

// =============================================================================
// Moving work: the canonical command, and everything it refuses
// =============================================================================
describe('moving work from the planner', { skip }, () => {
  const allocationOf = async (workPackageId) =>
    (
      await service
        .from('allocations')
        .select('*')
        .eq('work_package_id', workPackageId)
        .eq('active', true)
        .limit(1)
        .single()
    ).data;

  test('a valid move succeeds and is audited with both dates', async () => {
    const pkg = await wp(pk.roof.id);
    const alloc = await allocationOf(pk.roof.id);
    const before = auditCount();
    const r = await ok(
      tanya,
      {
        command_type: 'MOVE_WORK_PACKAGE',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version,
        payload: {
          allocation_id: alloc.id,
          start_at: day(7),
          end_at: day(7),
          reason: 'customer asked for the following week'
        }
      },
      'MOVE_WORK_PACKAGE'
    );
    assert.equal(r.result.status, 'Moved');
    assert.equal((await wp(pk.roof.id)).planned_start, day(7));
    assert.ok(auditCount() > before, 'the move is audited');

    const audit = sql(
      `select before_json ->> 'planned_start' || ' -> ' || (after_json ->> 'planned_start')
       from public.audit_events
       where entity_type = 'WorkPackages' and entity_id = '${pkg.id}' and action = 'Move'
       order by occurred_at desc limit 1`
    );
    assert.equal(audit, `${day(0)} -> ${day(7)}`, 'the audit carries old and new dates');

    // And the planner read now shows it where it was moved to.
    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: day(7),
      to: day(7)
    });
    assert.ok(data.rows.some((row) => row.work_package_id === pk.roof.id));
  });

  test('a stale version is refused, so one planner cannot overwrite another', async () => {
    const pkg = await wp(pk.roof.id);
    const alloc = await allocationOf(pk.roof.id);
    await refuse(
      tanya,
      {
        command_type: 'MOVE_WORK_PACKAGE',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version - 1,
        payload: {
          allocation_id: alloc.id,
          start_at: day(8),
          end_at: day(8),
          reason: 'stale drag'
        }
      },
      'R1A_STALE_VERSION'
    );
    assert.equal(
      (await wp(pk.roof.id)).planned_start,
      day(7),
      'the stale move changed nothing'
    );
  });

  test('a move with no reason is refused', async () => {
    const pkg = await wp(pk.roof.id);
    const alloc = await allocationOf(pk.roof.id);
    await refuse(
      tanya,
      {
        command_type: 'MOVE_WORK_PACKAGE',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version,
        payload: {
          allocation_id: alloc.id,
          start_at: day(8),
          end_at: day(8)
        }
      },
      /move reason required/
    );
  });

  test('an installer cannot move work from the planner', async () => {
    const pkg = await wp(pk.roof.id);
    const alloc = await allocationOf(pk.roof.id);
    await refuse(
      casey,
      {
        command_type: 'MOVE_WORK_PACKAGE',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version,
        payload: {
          allocation_id: alloc.id,
          start_at: day(9),
          end_at: day(9),
          reason: 'installer tried to reschedule himself'
        }
      },
      /ROLE_DENIED/,
      'role is enforced by the command, not the calendar'
    );
  });

  test('moving onto the installer leave blocks it', async () => {
    const alloc = await allocationOf(pk.roof.id);
    const leave = await service
      .from('person_availability')
      .insert({
        person_id: alloc.person_id,
        type: 'Leave',
        from_date: day(14),
        to_date: day(18),
        reason: 'annual leave',
        active: true
      })
      .select()
      .single();
    assert.ifError(leave.error);

    const pkg = await wp(pk.roof.id);
    await needsReview(
      tanya,
      {
        command_type: 'MOVE_WORK_PACKAGE',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version,
        payload: {
          allocation_id: alloc.id,
          start_at: day(15),
          end_at: day(15),
          reason: 'dragged onto a leave day'
        }
      },
      'ON_LEAVE'
    );
    assert.equal(
      (await wp(pk.roof.id)).planned_start,
      day(7),
      'nothing moved onto the leave'
    );
    await service.from('person_availability').delete().eq('id', leave.data.id);
  });

  test('moving beyond the installer capacity blocks it', async () => {
    const alloc = await allocationOf(pk.roof.id);
    const who = (
      await service
        .from('people')
        .select('*')
        .eq('id', alloc.person_id)
        .single()
    ).data;
    // One job a day, and they already have the electrical package that day.
    await service
      .from('people')
      .update({ capacity_per_day: 1 })
      .eq('id', alloc.person_id);
    const elecAlloc = await allocationOf(pk.elec.id);
    await service
      .from('allocations')
      .update({ person_id: alloc.person_id })
      .eq('id', elecAlloc.id);

    const pkg = await wp(pk.roof.id);
    const elec = await wp(pk.elec.id);
    await needsReview(
      tanya,
      {
        command_type: 'MOVE_WORK_PACKAGE',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version,
        payload: {
          allocation_id: alloc.id,
          start_at: elec.planned_start,
          end_at: elec.planned_start,
          reason: 'dragged onto a day they are already full'
        }
      },
      'CAPACITY_CONFLICT'
    );

    await service
      .from('allocations')
      .update({ person_id: elecAlloc.person_id })
      .eq('id', elecAlloc.id);
    await service
      .from('people')
      .update({ capacity_per_day: who.capacity_per_day })
      .eq('id', alloc.person_id);
  });
});

// =============================================================================
// Reassigning: dragging onto another resource row
// =============================================================================
describe('reassigning work from the team view', { skip }, () => {
  const allocationOf = async (workPackageId) =>
    (
      await service
        .from('allocations')
        .select('*')
        .eq('work_package_id', workPackageId)
        .eq('active', true)
        .limit(1)
        .single()
    ).data;

  test('the readiness read names who is free and why the rest are not', async () => {
    const alloc = await allocationOf(pk.roof.id);
    const data = await readOk(tanya, {
      read_type: 'RP_CHANGE_INSTALLER_OPTIONS',
      work_package_id: pk.roof.id,
      old_allocation_id: alloc.id
    });
    assert.ok(Array.isArray(data.candidates));
    assert.ok(data.candidates.length > 0, 'there are installers to choose from');
    for (const c of data.candidates) {
      assert.equal(typeof c.ready, 'boolean');
      assert.ok(Array.isArray(c.reasons), 'an unready candidate can say why');
    }
  });

  test('an installer without the skill is not given the work', async () => {
    const alloc = await allocationOf(pk.roof.id);
    // James Davies is an Electrical installer: the wrong trade for a roof
    // package, and exactly what dragging onto the wrong row looks like.
    const other = { person_id: ids.james };
    const pkg = await wp(pk.roof.id);
    await needsReview(
      tanya,
      {
        command_type: 'CHANGE_INSTALLER_R2',
        job_id: jobId,
        work_package_id: pkg.id,
        old_allocation_id: alloc.id,
        expected_version: pkg.version,
        payload: {
          mode: 'Replace',
          person_id: other.person_id,
          reason: 'dragged onto the wrong trade'
        }
      },
      'SKILL_MISMATCH'
    );
    assert.equal(
      (await allocationOf(pk.roof.id)).person_id,
      alloc.person_id,
      'the work stayed with its installer'
    );
  });

  test('a reassignment to a ready installer succeeds and is audited', async () => {
    const alloc = await allocationOf(pk.roof.id);
    const options = await readOk(tanya, {
      read_type: 'RP_CHANGE_INSTALLER_OPTIONS',
      work_package_id: pk.roof.id,
      old_allocation_id: alloc.id
    });
    // Josh Lewis is Roof-skilled and has nothing else booked in this window.
    const ready = options.candidates.find((c) => c.person_id === ids.josh);
    assert.ok(ready, 'the roof-skilled alternative is offered');
    assert.equal(
      ready.ready,
      true,
      `expected a free roof installer, got ${JSON.stringify(ready.reasons)}`
    );

    const pkg = await wp(pk.roof.id);
    const before = auditCount();
    const r = await ok(
      tanya,
      {
        command_type: 'CHANGE_INSTALLER_R2',
        job_id: jobId,
        work_package_id: pkg.id,
        old_allocation_id: alloc.id,
        expected_version: pkg.version,
        payload: {
          mode: 'Replace',
          person_id: ready.person_id,
          reason: 'dragged onto another installer'
        }
      },
      'CHANGE_INSTALLER_R2'
    );
    assert.notEqual(r.result.status, 'NeedsReview');
    assert.equal((await allocationOf(pk.roof.id)).person_id, ready.person_id);
    assert.ok(auditCount() > before, 'the reassignment is audited');
    assert.ok(
      Number(
        sql(
          `select count(*) from public.audit_events
           where entity_type = 'Allocations' and occurred_at > now() - interval '1 minute'`
        )
      ) > 0
    );
  });
});

// =============================================================================
// The resource view feeds on canonical availability
// =============================================================================
describe('the team view', { skip }, () => {
  test('reports leave from person_availability, not a planner table of its own', async () => {
    const someone = ids.angel;
    const leave = await service
      .from('person_availability')
      .insert({
        person_id: someone,
        type: 'Leave',
        from_date: day(21),
        to_date: day(22),
        reason: 'team view leave',
        active: true
      })
      .select()
      .single();
    assert.ifError(leave.error);

    const data = await readOk(tanya, {
      read_type: 'RP_TEAM_PLANNER',
      start: day(21),
      weeks: 1
    });
    const everyone = [
      ...data.teams.flatMap((t) => t.members),
      ...data.unassigned_installers
    ];
    const them = everyone.find((p) => p.person_id === someone);
    assert.ok(them, 'the installer is a row in the resource view');
    assert.ok(
      them.leave.some((l) => l.from_date === day(21) && l.type === 'Leave'),
      'their leave shows on the board'
    );

    await service.from('person_availability').delete().eq('id', leave.data.id);
  });

  test('the calendar and the resource view agree on the same allocations', async () => {
    const windowRead = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: day(0),
      to: day(20)
    });
    const team = await readOk(tanya, {
      read_type: 'RP_TEAM_PLANNER',
      start: day(0),
      weeks: 3
    });
    const inTeam = new Set(
      [
        ...team.teams.flatMap((t) => t.members),
        ...team.unassigned_installers
      ].flatMap((p) => p.allocations.map((a) => a.allocation_id))
    );
    const inCalendar = windowRead.rows
      .filter((r) => r.allocation_id)
      .map((r) => r.allocation_id);
    for (const id of inCalendar) {
      assert.ok(
        inTeam.has(id),
        'every allocation the calendar draws is on the resource view too'
      );
    }
  });
});

// =============================================================================
// Nothing the planner does bypasses the write path
// =============================================================================
describe('the planner has no private write path', { skip }, () => {
  test('a signed-in office user cannot write scheduling tables directly', async () => {
    for (const table of ['work_packages', 'allocations', 'scaffold_bookings']) {
      const r = await tanya
        .from(table)
        .update({ updated_at: new Date().toISOString() })
        .eq('job_id', jobId);
      assert.ok(
        r.error,
        `${table}: a client must not be able to write scheduling rows`
      );
    }
  });

  test('every planner read is registered, so it is role-checked like the rest', async () => {
    const registered = sql(
      `select string_agg(read_type, ',' order by read_type)
       from app.read_registry where read_type like 'PLANNER_%'`
    );
    assert.equal(
      registered,
      'PLANNER_HISTORICAL_COUNT,PLANNER_UNSCHEDULED,PLANNER_WINDOW'
    );
    const roles = sql(
      `select string_agg(distinct r, ',' order by r) from app.read_registry,
       unnest(roles) r where read_type = 'PLANNER_WINDOW'`
    );
    assert.equal(roles, 'Admin,Director,Manager,Office,VariationApprover');
  });

  test('an installer is refused the planner reads', async () => {
    const r = await opsRead(casey, {
      read_type: 'PLANNER_WINDOW',
      from: day(0),
      to: day(6)
    });
    assert.ok(r.error, 'the planner is an office surface');
    assert.match(r.error.message, /ROLE_DENIED/);
  });
});
