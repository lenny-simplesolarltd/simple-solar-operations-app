// P0 / R1 integration acceptance against a REAL local Supabase stack with
// Storage (Evidence x R1 completion x audit, then a full synthetic R1 job).
//
// Every business step is a real signed-in session calling the same entry
// points the app uses (submit_presale, evidence_upload_begin / Storage /
// evidence_upload_complete, execute_command, execute_operations_read). The
// only other actors are the ones production has:
//   * the scheduler: `select app.s10_run_schedules()` is exactly what pg_cron
//     job ss-s10-schedules runs (every 30 minutes) - run here on demand;
//   * the service role, only to switch release modes on for this local stack,
//     to plant a stray Storage object, and to prove immutability.
//
// Needs a stack with Storage:
//   SUPABASE_TEST_WORKDIR=<dir with supabase/config.toml> node --test tests/r1-p0-integration.test.mjs
// Named to run after preview-dev.test.mjs, which counts the rows it can see.
// Without Storage the suite skips itself. Release modes are restored to
// Disabled afterwards.
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
/** One SQL statement as the database owner (what pg_cron runs as). Returns rows of the first column. */
const sql = (statement) =>
  execFileSync(
    'psql',
    [DB_URL, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    { encoding: 'utf8' }
  ).trim();

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const bucket = (client) => client.storage.from('evidence');
const R1_MODES = {
  'FN-01': 'Automated',
  'FN-11': 'Manual',
  'FN-15': 'Manual',
  'FN-17': 'Manual',
  'FN-19': 'Manual',
  'FN-20': 'Manual'
};

let tanya, lucy, ben, lenny, casey, john, rick, james;
const ids = {};

async function run(client, request) {
  const req = { command_id: randomUUID(), ...request };
  const { data, error } = await client.rpc('execute_command', {
    p_request: req
  });
  return { req, data, error, result: data?.result };
}
async function ok(client, request, label) {
  const r = await run(client, request);
  assert.ifError(r.error, `${label}: ${r.error?.message}`);
  assert.equal(r.data.ok, true, label);
  return r;
}
const auditCount = () =>
  Number(sql('select count(*) from public.audit_events'));
/** A refusal returns the exact code and writes nothing - not even an audit row. */
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
  assert.equal(
    sql(
      `select count(*) from public.audit_events where command_id = '${r.req.command_id}'`
    ),
    '0'
  );
  return r;
}
const job = async (id) =>
  (await service.from('jobs').select('*').eq('id', id).single()).data;
const task = async (jobId, code) =>
  (
    await service
      .from('tasks')
      .select('*')
      .eq('job_id', jobId)
      .eq('template_code', code)
      .order('created_at')
      .limit(1)
      .single()
  ).data;
const wp = async (id) =>
  (await service.from('work_packages').select('*').eq('id', id).single()).data;
const opsRead = async (client, jobId) => {
  const { data, error } = await client.rpc('execute_operations_read', {
    p_request: { read_type: 'JOB_OPERATIONS', job_id: jobId }
  });
  assert.ifError(error);
  return data.data;
};

async function upload(client, contextType, contextId, filename, category) {
  const reg = await client.rpc('evidence_upload_begin', {
    p_request: {
      upload_id: randomUUID(),
      context_type: contextType,
      context_id: contextId,
      filename,
      mime_type: 'application/pdf',
      size_bytes: PDF.length,
      ...(category ? { category } : {})
    }
  });
  assert.ifError(reg.error);
  const ticket = await bucket(client).createSignedUploadUrl(
    reg.data.storage_path
  );
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
  return reg.data; // { evidence_id, storage_path } - still Pending until a command or evidence_upload_complete confirms it
}

const sale = (salespersonId, tag) => ({
  customer: {
    first_name: 'Rita',
    last_name: 'Integration',
    address_line1: '2 Synthetic Road',
    address_line2: null,
    town: 'Exeter',
    postcode: 'EX2 2BB',
    phone: '07000 000001',
    email: `rita-${tag}@example.com`
  },
  sale: {
    salesperson_id: salespersonId,
    lead_source: 'Referral',
    quote_reference: `Q-INT-${tag}`,
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
async function sell(tag) {
  const sold = await tanya.rpc('submit_presale', {
    p_command_id: randomUUID(),
    p_payload: sale(ids.rick, `${tag}-${Date.now()}`)
  });
  assert.ifError(sold.error);
  return sold.data.job_id;
}

/** PRE01 -> PRE02 (+ a real contract upload) -> PRE04 -> PRE03 (Director): the job becomes ReadyToBook. */
async function prebook(jobId) {
  let t = await task(jobId, 'PRE01');
  await ok(
    tanya,
    {
      command_type: 'TASK_COMPLETE',
      task_id: t.id,
      expected_version: t.version,
      payload: {
        completion_note: 'invoice sent',
        invoice_number: 'INV-INT-1',
        invoice_sent: true
      }
    },
    'PRE01'
  );
  t = await task(jobId, 'PRE02');
  const contract = await upload(tanya, 'Task', t.id, 'signed contract.pdf');
  await ok(
    tanya,
    {
      command_type: 'TASK_COMPLETE',
      task_id: t.id,
      expected_version: t.version,
      payload: {
        completion_note: 'signed',
        contract_id: 'SIG-INT-1',
        contract_signed: true,
        evidence_path: contract.storage_path
      }
    },
    'PRE02'
  );
  t = await task(jobId, 'PRE04');
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
  t = await task(jobId, 'PRE03');
  const r = await ok(
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
        deposit_bank_reference: 'BANK-INT-1'
      }
    },
    'PRE03'
  );
  assert.equal(
    r.result.job.workflow_stage,
    'ReadyToBook',
    JSON.stringify(r.result.readiness)
  );
  return contract;
}

/** Booking intake (first installers come from the booking form) -> BKG01-03 -> CONFIRM_BOOKING. */
async function book(jobId) {
  let j = await job(jobId);
  const r = await ok(
    tanya,
    {
      command_type: 'BOOKING_INTAKE',
      job_id: jobId,
      expected_version: j.version,
      payload: {
        customer_first_name: 'Rita',
        customer_last_name: 'Integration',
        street_address: '2 Synthetic Road',
        city: 'Exeter',
        postcode: 'EX2 2BB',
        cost: '9000',
        finance_route: 'Standard',
        date_roofer: '2026-10-06',
        date_sparky: '2026-10-08',
        roofer: ids.angel,
        sparky: ids.casey
      }
    },
    'BOOKING_INTAKE'
  );
  assert.equal(
    r.result.status,
    'Processed',
    JSON.stringify(r.result.review_reasons)
  );
  for (const code of ['BKG01', 'BKG02', 'BKG03']) {
    const t = await task(jobId, code);
    await ok(
      tanya,
      {
        command_type: 'TASK_COMPLETE',
        task_id: t.id,
        expected_version: t.version,
        payload: { completion_note: `${code} done` }
      },
      code
    );
  }
  j = await job(jobId);
  const c = await ok(
    tanya,
    {
      command_type: 'CONFIRM_BOOKING',
      job_id: jobId,
      expected_version: j.version
    },
    'CONFIRM_BOOKING'
  );
  assert.equal(c.result.status, 'Booked');
  const pkgs = (
    await service.from('work_packages').select('*').eq('job_id', jobId)
  ).data;
  return {
    roof: pkgs.find((p) => p.trade === 'Roof'),
    elec: pkgs.find((p) => p.trade === 'Electrical')
  };
}

before(async () => {
  if (!hasStorage) return;
  const names = {
    tanya: 'tanya',
    lucy: 'lucy',
    ben: 'ben',
    lenny: 'lenny',
    casey: 'casey',
    john: 'john',
    rick: 'rick',
    james: 'james'
  };
  for (const n of Object.values(names)) await ensureLogin(email(n));
  [tanya, lucy, ben, lenny, casey, john, rick, james] = await Promise.all(
    Object.values(names).map((n) => signInAs(email(n)))
  );
  for (const [key, legacy] of [
    ['rick', 'PERSON-rick'],
    ['angel', 'PERSON-angel'],
    ['casey', 'PERSON-casey'],
    ['james', 'PERSON-james'],
    ['tanya', 'PERSON-tanya']
  ])
    ids[key] = (await person(legacy)).id;
  // Local stack only (helpers.mjs asserts it): switch R1 on for the pilot scope.
  for (const [fn, mode] of Object.entries(R1_MODES)) {
    const u = await service
      .from('release_modes')
      .update({ mode, authorised_job_scope: 'Pilot' })
      .eq('function_id', fn);
    assert.ifError(u.error);
  }
});

after(async () => {
  if (!hasStorage) return;
  await service
    .from('release_modes')
    .update({ mode: 'Disabled', authorised_job_scope: 'None' })
    .in('function_id', Object.keys(R1_MODES));
});

// =============================================================================
// Full synthetic Standard job, driven only through the application's commands
// =============================================================================
describe('R1 end to end: Sold -> OperationallyComplete', { skip }, () => {
  let A, B; // job ids: A is the full journey, B only donates cross-job evidence
  let pk; // A's work packages
  let bFile, bEvidence, officeFirst;

  test('Job Sold creates PRE01-PRE04 with explicit owners', async () => {
    A = await sell('A');
    B = await sell('B');
    const tasks = (
      await service
        .from('tasks')
        .select('template_code, owner_id')
        .eq('job_id', A)
    ).data;
    assert.deepEqual(tasks.map((t) => t.template_code).sort(), [
      'PRE01',
      'PRE02',
      'PRE03',
      'PRE04'
    ]);
    assert.equal((await job(A)).workflow_stage, 'Prebooking');
  });

  test('PRE01 -> PRE02 (+ contract upload) -> PRE04 -> PRE03 -> ReadyToBook', async () => {
    const contract = await prebook(A);
    const ev = (
      await service
        .from('evidence')
        .select('*')
        .eq('id', contract.evidence_id)
        .single()
    ).data;
    assert.equal(ev.job_id, A);
    assert.equal(ev.upload_status, 'Uploaded');
    assert.equal(ev.category, 'Contract');
    assert.equal((await job(A)).contract_evidence_id, contract.evidence_id);
  });

  test('booking -> Booked; first installers allocated by the booking form fields', async () => {
    pk = await book(A);
    assert.equal((await job(A)).workflow_stage, 'Booked');
    const allocs = (
      await service
        .from('allocations')
        .select('person_id, work_package_id, active')
        .eq('active', true)
        .in('work_package_id', [pk.roof.id, pk.elec.id])
    ).data;
    assert.ok(
      allocs.some(
        (a) => a.work_package_id === pk.roof.id && a.person_id === ids.angel
      ),
      'roofer allocated'
    );
    assert.ok(
      allocs.some(
        (a) => a.work_package_id === pk.elec.id && a.person_id === ids.casey
      ),
      'sparky allocated'
    );
    assert.equal(pk.elec.commissioning_required, true);
    assert.equal(pk.roof.commissioning_required, false);
  });

  test('planner/date change and installer replacement (with stale-version refusal)', async () => {
    const roof = await wp(pk.roof.id);
    await ok(
      tanya,
      {
        command_type: 'PLANNER_UPDATE',
        job_id: A,
        work_package_id: roof.id,
        expected_version: roof.version,
        payload: {
          planned_start: '2026-10-07',
          planned_end: '2026-10-07',
          reason: 'Weather'
        }
      },
      'PLANNER_UPDATE'
    );
    assert.equal((await wp(roof.id)).planned_start, '2026-10-07');
    await refuse(
      tanya,
      {
        command_type: 'PLANNER_UPDATE',
        job_id: A,
        work_package_id: roof.id,
        expected_version: roof.version,
        payload: { planned_start: '2026-10-08', planned_end: '2026-10-08' }
      },
      'R1A_STALE_VERSION',
      'stale planner update'
    );

    const elec = await wp(pk.elec.id);
    const lead = (
      await service
        .from('allocations')
        .select('*')
        .eq('work_package_id', elec.id)
        .eq('active', true)
    ).data[0];
    const change = await ok(
      tanya,
      {
        command_type: 'CHANGE_INSTALLER',
        job_id: A,
        work_package_id: elec.id,
        expected_version: elec.version,
        payload: {
          mode: 'Replace',
          old_allocation_id: lead.id,
          person_id: ids.james,
          reason: 'Casey on leave'
        }
      },
      'CHANGE_INSTALLER'
    );
    assert.equal(
      change.result.status,
      'Replaced',
      JSON.stringify(change.result)
    );
    const now = (
      await service
        .from('allocations')
        .select('person_id, active')
        .eq('work_package_id', elec.id)
    ).data;
    assert.ok(now.some((a) => a.person_id === ids.james && a.active));
    assert.ok(
      now.some((a) => a.person_id === ids.casey && !a.active),
      'replaced allocation kept, inactive'
    );
    pk.elec = await wp(elec.id);
  });

  test('wrong role, wrong job access, duplicate command id, disabled release mode', async () => {
    const j = await job(A);
    const call = {
      command_type: 'CALL_RECORD',
      job_id: A,
      expected_version: j.version,
      payload: {
        type: 'Customer',
        outcome: 'Other',
        notes: 'Access arrangements discussed'
      }
    };
    await refuse(john, call, 'R1A_ROLE_DENIED', 'installer');
    await refuse(rick, call, 'R1A_ROLE_DENIED', 'surveyor');
    await refuse(lucy, call, 'R1A_JOB_ACCESS_DENIED', 'office, not assigned');

    // job-level call, then the same command id again: a replay, nothing new
    const first = await ok(tanya, call, 'job-level call');
    assert.equal(first.result.job_level, true);
    const audits = auditCount();
    const again = await tanya.rpc('execute_command', { p_request: first.req });
    assert.ifError(again.error);
    assert.equal(again.data.replayed, true);
    assert.equal(again.data.result.call.id, first.result.call.id);
    assert.equal(auditCount(), audits, 'replay wrote audit');
    assert.equal(
      (
        await service
          .from('calls')
          .select('id')
          .eq('job_id', A)
          .is('task_id', null)
      ).data.length,
      1
    );
    // same id, different content -> conflict, nothing written
    const before = auditCount();
    const reuse = await tanya.rpc('execute_command', {
      p_request: {
        ...first.req,
        payload: { ...call.payload, notes: 'changed' }
      }
    });
    assert.match(
      reuse.error?.message ?? '',
      /IDEMPOTENCY|CONFLICT|FINGERPRINT/i,
      'id reuse'
    );
    assert.equal(auditCount(), before, 'id reuse wrote audit');
    const ops = await opsRead(tanya, A);
    assert.ok(
      ops.calls.some((c) => c.id === first.result.call.id && c.job_level)
    );

    // FN-01 switched off: refused as a MODE problem, worded for staff
    await service
      .from('release_modes')
      .update({ mode: 'Disabled', authorised_job_scope: 'None' })
      .eq('function_id', 'FN-01');
    try {
      const j2 = await job(A);
      const r = await refuse(
        tanya,
        { ...call, expected_version: j2.version },
        'R1A_MODE_DENIED',
        'FN-01 disabled'
      );
      const words = await tanya.rpc('describe_command_error', {
        p_error: r.error.message,
        p_command_id: r.req.command_id,
        p_field: null
      });
      assert.ifError(words.error); // signed-in staff can read the catalogue (integration grant)
      assert.notEqual(
        words.data.message,
        'Something went wrong. Nothing was changed. Try again.'
      );
      assert.equal(
        (await opsRead(tanya, A)).actions.call_record.denied,
        'MODE'
      );
    } finally {
      await service
        .from('release_modes')
        .update({ mode: 'Automated', authorised_job_scope: 'Pilot' })
        .eq('function_id', 'FN-01');
    }
  });

  test('operational work: scheduler raises INS01; installer confirmation calls', async () => {
    const early = await ok(
      tanya,
      {
        command_type: 'OPERATIONAL_COMPLETE',
        job_id: A,
        expected_version: (await job(A)).version
      },
      'early'
    );
    assert.equal(early.result.status, 'NeedsReview');
    assert.ok(early.result.gate.reasons.includes('REQUIRED_WORK_UNCONFIRMED'));
    assert.ok(
      early.result.gate.reasons.includes(
        `COMMISSIONING_NOT_ACCEPTED:${pk.elec.id}`
      )
    );

    sql('select app.s10_run_schedules()'); // = pg_cron ss-s10-schedules
    const ins01 = (
      await service
        .from('tasks')
        .select('*')
        .eq('job_id', A)
        .eq('template_code', 'INS01')
    ).data;
    assert.equal(ins01.length, 2);
    for (const t of ins01)
      await ok(
        tanya,
        {
          command_type: 'CALL_RECORD',
          job_id: A,
          task_id: t.id,
          expected_version: t.version,
          payload: {
            type: 'Installer',
            outcome: 'Complete',
            actual_completion_confirmed: true,
            notes: 'Installer confirmed done'
          }
        },
        'INS01'
      );
    const pkgs = (
      await service
        .from('work_packages')
        .select('status, installer_confirmation_at')
        .eq('job_id', A)
    ).data;
    assert.ok(
      pkgs.every(
        (p) => p.status === 'ConfirmedComplete' && p.installer_confirmation_at
      )
    );
  });

  test('customer-happy confirmation (INS04 raised by the scheduler)', async () => {
    sql('select app.s10_run_schedules()');
    const ins04 = await task(A, 'INS04');
    assert.ok(ins04, 'INS04 raised');
    await ok(
      tanya,
      {
        command_type: 'CALL_RECORD',
        job_id: A,
        task_id: ins04.id,
        expected_version: ins04.version,
        payload: { type: 'Customer', outcome: 'Complete', customer_happy: true }
      },
      'INS04'
    );
    assert.ok((await job(A)).customer_happy_at);
  });

  // ---------------------------------------------------------------- Evidence x COMMISSIONING_RECORD
  test('commissioning refuses missing, cross-job, unregistered and undelivered evidence - writing nothing', async () => {
    const elec = await wp(pk.elec.id);
    const rec = (payload) => ({
      command_type: 'COMMISSIONING_RECORD',
      job_id: A,
      work_package_id: elec.id,
      expected_version: elec.version,
      payload
    });
    const subs = async () =>
      (
        await service
          .from('commissioning_submissions')
          .select('id')
          .eq('work_package_id', elec.id)
      ).data.length;

    await refuse(tanya, rec({ reference: 'EIC-0' }), 'R1A_REQUIRED_EVIDENCE');
    // job B's file (registered and stored under job B)
    const bt = await task(B, 'PRE02');
    bFile = await upload(tanya, 'Task', bt.id, 'b-file.pdf');
    await refuse(
      tanya,
      rec({ evidence_path: bFile.storage_path }),
      'R1A_CROSS_JOB_EVIDENCE',
      'job B path'
    );
    bEvidence = (
      await tanya.rpc('evidence_upload_complete', {
        p_evidence_id: bFile.evidence_id
      })
    ).data;
    await refuse(
      tanya,
      rec({ evidence_id: bFile.evidence_id }),
      'R1A_CROSS_JOB_EVIDENCE',
      'job B evidence id'
    );
    // an object dropped into job A's folder with no registration is never adopted
    const stray = `${A}/dropped-in-cert.pdf`;
    assert.ifError(
      (
        await service.storage
          .from('evidence')
          .upload(stray, PDF, { contentType: 'application/pdf' })
      ).error
    );
    await refuse(
      tanya,
      rec({ evidence_path: stray }),
      'R1A_UPLOAD_INVALID',
      'unregistered object'
    );
    // registered but the file never arrived
    const reg = await tanya.rpc('evidence_upload_begin', {
      p_request: {
        upload_id: randomUUID(),
        context_type: 'Job',
        context_id: A,
        category: 'Commissioning',
        filename: 'never-sent.pdf',
        mime_type: 'application/pdf',
        size_bytes: PDF.length
      }
    });
    assert.ifError(reg.error);
    await refuse(
      tanya,
      rec({ evidence_path: reg.data.storage_path }),
      'R1A_UPLOAD_MISSING',
      'registered, not stored'
    );
    assert.equal(await subs(), 0);
    // Director and Variation-approver roles do not record commissioning (office / manager / admin)
    await refuse(
      ben,
      rec({ evidence_path: stray }),
      'R1A_ROLE_DENIED',
      'director'
    );
  });

  test('office commissioning with a real upload is Accepted, linked once, same job only', async () => {
    const elec = await wp(pk.elec.id);
    const cert = await upload(
      tanya,
      'Job',
      A,
      'EIC certificate.pdf',
      'Commissioning'
    );
    const r = await ok(
      tanya,
      {
        command_type: 'COMMISSIONING_RECORD',
        job_id: A,
        work_package_id: elec.id,
        expected_version: elec.version,
        payload: {
          evidence_path: cert.storage_path,
          reference: 'EIC-1001',
          notes: 'Tested and certified'
        }
      },
      'COMMISSIONING_RECORD'
    );
    officeFirst = r;
    assert.equal(
      r.result.evidence_created,
      true,
      'first use of the registered upload'
    );
    assert.equal(r.result.evidence_id, cert.evidence_id);
    const sub = (
      await service
        .from('commissioning_submissions')
        .select('*')
        .eq('id', r.result.submission_id)
        .single()
    ).data;
    assert.equal(sub.status, 'Accepted');
    assert.equal(sub.source_system, 'R1A-office-manual');
    assert.equal(sub.allocation_id, null);
    assert.equal(sub.office_reference, 'EIC-1001');
    const ev = (
      await service
        .from('evidence')
        .select('*')
        .eq('id', cert.evidence_id)
        .single()
    ).data;
    assert.deepEqual(
      [ev.job_id, ev.submission_id, ev.upload_status, ev.category],
      [A, sub.id, 'Uploaded', 'Commissioning']
    );
    const tpl = (
      await service
        .from('commissioning_templates')
        .select('*')
        .eq('template_version', 'R1-OFFICE-MANUAL-1.0')
        .eq('trade', 'Electrical')
        .single()
    ).data;
    assert.equal(
      tpl.approved_at,
      null,
      'the office template is never an approved technical form'
    );

    // audit: one event per change, the template once (row trigger), no path / URL anywhere
    const events =
      sql(`select entity_type || '|' || action || '|' || count(*) from public.audit_events
                        where command_id = '${r.req.command_id}' group by entity_type, entity_id, action order by 1`).split(
        '\n'
      );
    assert.ok(
      events.every((e) => e.endsWith('|1')),
      `duplicate audit events: ${events}`
    );
    assert.ok(
      events.some((e) =>
        e.startsWith('CommissioningSubmissions|OfficeCommissioningRecorded|')
      )
    );
    assert.ok(
      events.some((e) => e.startsWith('commissioning_templates|INSERT|')),
      `template row audit missing: ${events}`
    );
    assert.ok(
      !events.some((e) => e.includes('OfficeTemplate')),
      'template audited twice'
    );
    assert.equal(
      sql(
        `select reason from public.audit_events where command_id = '${r.req.command_id}' and entity_type = 'commissioning_templates'`
      ),
      'R1 office commissioning template for Electrical'
    );
  });

  test('re-record supersedes; history is immutable; files stay on their own work package', async () => {
    let elec = await wp(pk.elec.id);
    const spare = await upload(
      tanya,
      'Job',
      A,
      'EIC corrected.pdf',
      'Commissioning'
    );
    await tanya.rpc('evidence_upload_complete', {
      p_evidence_id: spare.evidence_id
    });
    const r = await ok(
      tanya,
      {
        command_type: 'COMMISSIONING_RECORD',
        job_id: A,
        work_package_id: elec.id,
        expected_version: elec.version,
        payload: { evidence_id: spare.evidence_id, reference: 'EIC-1001-A' }
      },
      're-record with an existing same-job file'
    );
    assert.equal(r.result.evidence_created, false);
    assert.equal(
      r.result.supersedes_submission_id,
      officeFirst.result.submission_id
    );
    const prior = (
      await service
        .from('commissioning_submissions')
        .select('*')
        .eq('id', officeFirst.result.submission_id)
        .single()
    ).data;
    assert.equal(prior.status, 'Accepted');
    assert.equal(
      prior.office_reference,
      'EIC-1001',
      'superseded row unchanged'
    );
    const tamper = await service
      .from('commissioning_submissions')
      .update({ review_notes: 'rewritten' })
      .eq('id', prior.id);
    assert.ok(tamper.error, 'an Accepted submission was overwritten');

    // The reference keeps one office record per work package: quoting the file
    // already on that record is allowed, and the link is not moved.
    elec = await wp(pk.elec.id);
    const again = await ok(
      tanya,
      {
        command_type: 'COMMISSIONING_RECORD',
        job_id: A,
        work_package_id: elec.id,
        expected_version: elec.version,
        payload: {
          evidence_id: officeFirst.result.evidence_id,
          reference: 'EIC-1001-B'
        }
      },
      're-record quoting the first certificate'
    );
    assert.equal(again.result.supersedes_submission_id, r.result.submission_id);
    assert.equal(
      (
        await service
          .from('evidence')
          .select('submission_id')
          .eq('id', officeFirst.result.evidence_id)
          .single()
      ).data.submission_id,
      officeFirst.result.submission_id,
      'evidence link was re-pointed'
    );

    // A file on ANOTHER work package's record is refused. (Fixture: R1 only
    // requires Electrical commissioning, so the roof is flagged here to reach
    // this rule, then restored.)
    await service
      .from('work_packages')
      .update({ commissioning_required: true })
      .eq('id', pk.roof.id);
    try {
      const roof = await wp(pk.roof.id);
      const roofCert = await upload(
        tanya,
        'Job',
        A,
        'roof-cert.pdf',
        'Commissioning'
      );
      await ok(
        tanya,
        {
          command_type: 'COMMISSIONING_RECORD',
          job_id: A,
          work_package_id: roof.id,
          expected_version: roof.version,
          payload: { evidence_path: roofCert.storage_path }
        },
        'roof commissioning'
      );
      elec = await wp(pk.elec.id);
      await refuse(
        tanya,
        {
          command_type: 'COMMISSIONING_RECORD',
          job_id: A,
          work_package_id: elec.id,
          expected_version: elec.version,
          payload: { evidence_id: roofCert.evidence_id }
        },
        'R1A_EVIDENCE_ALREADY_LINKED',
        "another package's file"
      );
    } finally {
      await service
        .from('work_packages')
        .update({ commissioning_required: false })
        .eq('id', pk.roof.id);
    }

    const ops = await opsRead(tanya, A);
    const e = ops.packages.find((p) => p.id === elec.id).commissioning;
    assert.equal(e.accepted, true);
    assert.equal(
      e.installer_accepted,
      false,
      'office record is distinguishable from an installer form'
    );
    assert.equal(
      e.current.length,
      1,
      'only the current (superseding) office record is shown'
    );
    assert.equal(e.current[0].id, again.result.submission_id);
    assert.deepEqual(
      e.current[0].evidence.map((x) => x.id),
      [officeFirst.result.evidence_id, spare.evidence_id],
      'the current record shows the files of the work package office record'
    );
  });

  test('evidence reads: allocated installer sees the certificate, never the contract; others see nothing', async () => {
    const cert = officeFirst.result.evidence_id;
    assert.ifError(
      (await james.rpc('evidence_open', { p_evidence_id: cert })).error
    ); // allocated electrician
    const contract = (await job(A)).contract_evidence_id;
    assert.equal(
      (await james.rpc('evidence_open', { p_evidence_id: contract })).error
        ?.message,
      'EVIDENCE_ACCESS_DENIED'
    );
    for (const other of [casey, john]) // replaced installer, installer never on the job
      assert.equal(
        (await other.rpc('evidence_open', { p_evidence_id: cert })).error
          ?.message,
        'EVIDENCE_ACCESS_DENIED'
      );
    const open = await tanya.rpc('evidence_open', { p_evidence_id: cert });
    const signed = await bucket(tanya).createSignedUrl(
      open.data.storage_path,
      60
    );
    assert.equal((await fetch(signed.data.signedUrl)).status, 200);
    assert.equal(
      (
        await tanya.rpc('evidence_open', {
          p_evidence_id: bEvidence.evidence_id
        })
      ).error,
      null,
      'B is readable by its own office'
    );
  });

  test('blocking issue holds Electrical completion until resolved and closed', async () => {
    let j = await job(A);
    await refuse(
      ben,
      {
        command_type: 'OPERATIONAL_COMPLETE',
        job_id: A,
        expected_version: j.version
      },
      'R1A_ROLE_DENIED',
      'director completes'
    );
    const iss = await ok(
      tanya,
      {
        command_type: 'ISSUE_CREATE',
        job_id: A,
        expected_version: j.version,
        payload: {
          issue_type: 'Remedial',
          title: 'Loose clip',
          description: 'Cable clip loose on the gable',
          customer_impact: 'yes'
        }
      },
      'ISSUE_CREATE'
    );
    j = await job(A);
    const held = await ok(
      tanya,
      {
        command_type: 'OPERATIONAL_COMPLETE',
        job_id: A,
        expected_version: j.version
      },
      'held'
    );
    assert.equal(held.result.status, 'NeedsReview');
    assert.deepEqual(held.result.gate.reasons, ['BLOCKING_ISSUE_OPEN']);
    let issue = (
      await service
        .from('issues')
        .select('*')
        .eq('id', iss.result.issue_id)
        .single()
    ).data;
    await ok(
      tanya,
      {
        command_type: 'ISSUE_UPDATE',
        job_id: A,
        issue_id: issue.id,
        expected_version: issue.version,
        payload: {
          action: 'TRANSITION',
          status: 'Resolved',
          resolution: 'Clip refitted'
        }
      },
      'resolve issue'
    );
    issue = (
      await service.from('issues').select('*').eq('id', issue.id).single()
    ).data;
    await ok(
      tanya,
      {
        command_type: 'ISSUE_UPDATE',
        job_id: A,
        issue_id: issue.id,
        expected_version: issue.version,
        payload: {
          action: 'TRANSITION',
          status: 'Closed',
          customer_resolution_confirmed: true
        }
      },
      'close issue'
    );
  });

  test('OPERATIONAL_COMPLETE from Booked (R1 never enters InProgress / Aftercare)', async () => {
    const j = await job(A);
    assert.equal(j.workflow_stage, 'Booked');
    const ops = await opsRead(tanya, A);
    assert.equal(
      ops.completion.action.available,
      true,
      JSON.stringify(ops.completion)
    );
    const r = await ok(
      tanya,
      {
        command_type: 'OPERATIONAL_COMPLETE',
        job_id: A,
        expected_version: j.version
      },
      'complete'
    );
    assert.equal(r.result.status, 'Completed', JSON.stringify(r.result));
    const done = await job(A);
    assert.equal(done.workflow_stage, 'OperationallyComplete');
    assert.ok(done.operational_complete_at);
  });

  test('audit: coverage intact, no file paths or URLs, rejected commands left nothing', async () => {
    // TASK_EVIDENCE_ATTACH on job B's open PRE02 (contract received before completion), twice:
    // the pointer moves, the earlier row stays, and neither audit event carries the path.
    const bt = await task(B, 'PRE02');
    await ok(
      tanya,
      {
        command_type: 'TASK_EVIDENCE_ATTACH',
        job_id: B,
        task_id: bt.id,
        expected_version: bt.version,
        payload: { evidence_path: bFile.storage_path }
      },
      'attach'
    );
    const second = await upload(tanya, 'Task', bt.id, 'b-contract-v2.pdf');
    const bt2 = await task(B, 'PRE02');
    await ok(
      tanya,
      {
        command_type: 'TASK_EVIDENCE_ATTACH',
        job_id: B,
        task_id: bt2.id,
        expected_version: bt2.version,
        payload: { evidence_path: second.storage_path }
      },
      'replace'
    );
    assert.equal((await task(B, 'PRE02')).evidence_id, second.evidence_id);
    assert.equal(
      (
        await service
          .from('evidence')
          .select('upload_status')
          .eq('id', bFile.evidence_id)
          .single()
      ).data.upload_status,
      'Uploaded'
    );
    assert.equal(
      sql(`select count(*) from public.audit_events where entity_type = 'Evidence' and action = 'TaskReplace'
                      and entity_id = '${second.evidence_id}'`),
      '1'
    );
    const cov = JSON.parse(sql('select app.audit_coverage()'));
    assert.equal(cov.state, 'Verified');
    // Every table the database says must be audited, is. Counted from
    // app.audit_required rather than written down here, so a migration that
    // registers a new table does not fail this test for the wrong reason -
    // Verified above already means nothing registered is missing a trigger.
    assert.equal(
      cov.covered_tables,
      Number(sql('select count(*) from app.audit_required')),
      'every registered table is covered'
    );
    assert.ok(cov.covered_tables >= 26, 'coverage never shrinks');
    const leaks =
      sql(`select count(*) from public.audit_events a join public.evidence e on e.job_id in ('${A}', '${B}')
                       where coalesce(a.before_json::text, '') || coalesce(a.after_json::text, '') || coalesce(a.reason, '')
                             like '%' || e.storage_path || '%'`);
    assert.equal(leaks, '0', 'an audit event carries an evidence storage path');
    assert.equal(
      sql(
        `select count(*) from public.audit_events where (after_json::text || coalesce(before_json::text, '')) ~* '(signedurl|token=|/storage/v1/)'`
      ),
      '0'
    );
    // no row snapshots of operational bodies (commissioning answers, intake payloads, communications)
    assert.equal(
      sql(`select count(*) from public.audit_events where entity_type in
      ('commissioning_answers', 'intake', 'communications', 'acknowledgements', 'evidence', 'calls', 'issues')`),
      '0'
    );
  });
});

// =============================================================================
// Cancellation from every R1 stage, close, reinstate, reopen review
// =============================================================================
describe('R1 cancellation and reinstatement', { skip }, () => {
  const cancelPayload = {
    reason: 'Customer withdrew',
    effective_date: '2026-09-19',
    work_performed: 'None',
    material_state: 'None',
    scaffold_state: 'None',
    finance_review: 'Refund deposit',
    legacy_state: 'None'
  };

  async function cancelCloseReinstate(jobId, label) {
    let j = await job(jobId);
    await refuse(
      lucy,
      {
        command_type: 'CANCEL_JOB',
        job_id: jobId,
        expected_version: j.version,
        payload: cancelPayload
      },
      'R1A_JOB_ACCESS_DENIED',
      `${label}: unassigned office`
    );
    await refuse(
      ben,
      {
        command_type: 'CANCEL_JOB',
        job_id: jobId,
        expected_version: j.version,
        payload: cancelPayload
      },
      /R1A_ROLE_DENIED|S15_REFUSED/,
      `${label}: director`
    );
    await ok(
      tanya,
      {
        command_type: 'CANCEL_JOB',
        job_id: jobId,
        expected_version: j.version,
        payload: cancelPayload
      },
      `${label}: cancel`
    );
    assert.equal((await job(jobId)).workflow_stage, 'CancellationInProgress');

    let ops = await opsRead(tanya, jobId);
    const open = ops.cancellation.tasks;
    assert.ok(open.length > 0, `${label}: cancellation tasks raised`);
    assert.equal(
      ops.cancellation.actions.close.available,
      !open.some((t) => t.confirmation)
    );

    // resolve one task with evidence (a non-confirmation, resolvable one)
    const first = open.find((t) => t.resolvable && !t.confirmation);
    j = await job(jobId);
    await refuse(
      tanya,
      {
        command_type: 'CANCELLATION_RESOLVE',
        job_id: jobId,
        task_id: first.id,
        expected_version: j.version,
        payload: { reason: 'Handled', task_version: first.version }
      },
      'S15_REVIEW: open cancellation task and evidence required',
      `${label}: resolve without evidence`
    );
    await ok(
      tanya,
      {
        command_type: 'CANCELLATION_RESOLVE',
        job_id: jobId,
        task_id: first.id,
        expected_version: j.version,
        payload: {
          reason: 'Handled',
          task_version: first.version,
          evidence_reference: 'EMAIL-CAN-1'
        }
      },
      `${label}: resolve`
    );

    // close: every task still open is tracked
    ops = await opsRead(tanya, jobId);
    j = await job(jobId);
    await ok(
      tanya,
      {
        command_type: 'CANCELLATION_CLOSE',
        job_id: jobId,
        expected_version: j.version,
        payload: {
          reason: 'Obligations tracked',
          tracked_obligations: ops.cancellation.tasks.map((t) => ({
            task_id: t.id,
            reference: 'CRM-1',
            reason: 'With owner'
          }))
        }
      },
      `${label}: close`
    );
    assert.equal((await job(jobId)).workflow_stage, 'Cancelled');
    assert.equal(
      (await opsRead(tanya, jobId)).actions.reinstate_job.available,
      true
    );

    j = await job(jobId);
    await ok(
      tanya,
      {
        command_type: 'REINSTATE_JOB',
        job_id: jobId,
        expected_version: j.version,
        payload: {
          reason: 'Customer back',
          new_date: '2026-11-02',
          commitment_review: 'reviewed',
          finance_review: 'deposit held',
          evidence_reference: 'EMAIL-RE-1',
          risk_review: 'reviewed'
        }
      },
      `${label}: reinstate`
    );
    j = await job(jobId);
    assert.equal(j.workflow_stage, 'Prebooking');
    ops = await opsRead(tanya, jobId);
    assert.ok(ops.cancellation.reopen_review, `${label}: reopen review raised`);
    assert.equal(
      ops.cancellation.actions.reopen_review_complete.available,
      true
    );
    // normal work (the booking checks) is paused until the review is complete
    await refuse(
      tanya,
      {
        command_type: 'BOOKING_GATES',
        job_id: jobId,
        expected_version: j.version
      },
      'S15_REVIEW: normal work suppressed',
      `${label}: suppressed`
    );
    const rr = ops.cancellation.reopen_review;
    await ok(
      tanya,
      {
        command_type: 'REOPEN_REVIEW_COMPLETE',
        job_id: jobId,
        task_id: rr.id,
        expected_version: rr.version,
        payload: { note: 'Dates, gates and obligations reviewed' }
      },
      `${label}: reopen review`
    );
    assert.equal(
      (await opsRead(tanya, jobId)).cancellation.reopen_review,
      null
    );
    j = await job(jobId);
    await ok(
      tanya,
      {
        command_type: 'BOOKING_GATES',
        job_id: jobId,
        expected_version: j.version
      },
      `${label}: normal work resumed`
    );
  }

  test('from Prebooking', async () => {
    const j = await sell('C-pre');
    await cancelCloseReinstate(j, 'Prebooking');
  });

  test('from ReadyToBook', async () => {
    const j = await sell('C-rtb');
    await prebook(j);
    await cancelCloseReinstate(j, 'ReadyToBook');
  });

  test('from Booked', async () => {
    const j = await sell('C-bkd');
    await prebook(j);
    await book(j);
    await cancelCloseReinstate(j, 'Booked');
  });
});

describe('System Health for Director', { skip }, () => {
  test('Director reads SYSTEM_STATUS and records backup evidence; Surveyor and Installer cannot', async () => {
    await service
      .from('release_modes')
      .update({ mode: 'Automated', authorised_job_scope: 'Pilot' })
      .eq('function_id', 'FN-14');
    try {
      const read = await ben.rpc('execute_read', {
        p_request: { read_type: 'SYSTEM_STATUS' }
      });
      assert.ifError(read.error);
      assert.ok(read.data.data.operational.items.length > 0);
      for (const who of [rick, john]) {
        const denied = await who.rpc('execute_read', {
          p_request: { read_type: 'SYSTEM_STATUS' }
        });
        assert.equal(denied.error?.message, 'R1A_ROLE_DENIED');
      }
      await ok(
        ben,
        {
          command_type: 'OPS_EVIDENCE_RECORD',
          payload: {
            kind: 'DatabaseBackup',
            outcome: 'Verified',
            performed_at: new Date().toISOString(),
            subject_at: new Date(Date.now() - 3600e3).toISOString(),
            method: 'Supabase dashboard: daily backups list',
            evidence_reference: 'TICKET-INT-1'
          }
        },
        'director records evidence'
      );
      // Director still cannot use the office-only parts of System Health
      assert.equal(
        (
          await ben.rpc('execute_read', {
            p_request: { read_type: 'RELEASE_MODE_STATUS' }
          })
        ).error?.message,
        'R1A_ROLE_DENIED'
      );
      assert.equal(
        (
          await ben.rpc('execute_operations_read', {
            p_request: { read_type: 'CALENDAR_STATUS' }
          })
        ).error?.message,
        'R1A_ROLE_DENIED'
      );
    } finally {
      await service
        .from('release_modes')
        .update({ mode: 'Disabled', authorised_job_scope: 'None' })
        .eq('function_id', 'FN-14');
    }
  });
});
