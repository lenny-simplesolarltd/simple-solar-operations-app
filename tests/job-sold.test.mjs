// Integration tests for SOLD_INTAKE (public.submit_presale).
// Real Auth sessions -> auth.uid() -> person -> permissions -> one transaction.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import {
  anon,
  count,
  email,
  ensureLogin,
  person,
  service,
  signInAs
} from './helpers.mjs';

let rick, dave, tanya, lucy, ben, lenny, john, stranger;
let rickRow, daveRow, tanyaRow, benRow, danRow;

before(async () => {
  const logins = ['rick', 'dave', 'tanya', 'lucy', 'ben', 'lenny', 'john'];
  for (const name of logins) await ensureLogin(email(name));
  await ensureLogin('outsider@example.com');
  [rick, dave, tanya, lucy, ben, lenny, john] = await Promise.all(
    logins.map((name) => signInAs(email(name)))
  );
  stranger = await signInAs('outsider@example.com');
  rickRow = await person('PERSON-rick');
  daveRow = await person('PERSON-dave-gorman');
  tanyaRow = await person('PERSON-tanya');
  benRow = await person('PERSON-ben');
  danRow = await person('PERSON-dan');
});

function payload(salespersonId, overrides = {}) {
  const base = {
    customer: {
      first_name: '  Pat ',
      last_name: 'Example',
      address_line1: '1 Test Street',
      address_line2: null,
      town: 'Exeter',
      postcode: 'ex11aa',
      phone: '07000 000000',
      email: 'Pat.Example@Example.COM'
    },
    sale: {
      salesperson_id: salespersonId,
      lead_source: 'Referral',
      quote_reference: 'Q-100',
      finance_route: 'Standard',
      agreed_price_pence: 1250000
    },
    scope: {
      roof_required: true,
      electrical_required: true,
      scaffold_required: true,
      roof_notes: 'Concrete tile',
      electrical_notes: null
    },
    design: { slopes: [{ id: 's1', label: 'Primary Elevation' }] },
    design_schema_version: 1,
    catalogue_version: 'test-catalogue',
    computed: {
      system_kwp: 5.1,
      net_panels: 10,
      computed_total_pence: 1249900,
      price_breakdown: [
        { key: 'total', label: 'Total system price', pence: 1249900 }
      ]
    }
  };
  return {
    ...base,
    ...overrides,
    customer: { ...base.customer, ...overrides.customer },
    sale: { ...base.sale, ...overrides.sale },
    scope: { ...base.scope, ...overrides.scope }
  };
}

const submit = (client, commandId, body) =>
  client.rpc('submit_presale', { p_command_id: commandId, p_payload: body });

const snapshot = async () => ({
  customers: await count('customers'),
  jobs: await count('jobs'),
  presales: await count('presales'),
  tasks: await count('tasks'),
  commands: await count('commands'),
  audit: await count('audit_events')
});

/** 09:00 Europe/London on the next Mon-Fri after `from`. */
function nextStaffedDayLondon(from) {
  const londonDate = (d) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d);
  const [y, m, d] = londonDate(from).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + 1));
  while ([0, 6].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  for (const offsetHours of [0, 1]) {
    const candidate = new Date(day.getTime() + (9 - offsetHours) * 3600_000);
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      hour12: false
    }).format(candidate);
    if (hour === '09') return candidate;
  }
  throw new Error('could not resolve 09:00 London');
}

describe('a Surveyor sells a Standard job', () => {
  const commandId = randomUUID();
  let result;
  let started;

  test('one call creates customer, job, presale and PRE01-PRE04', async () => {
    const before = await snapshot();
    started = new Date();
    const { data, error } = await submit(rick, commandId, payload(rickRow.id));
    assert.ifError(error);
    result = data;

    assert.match(result.job_ref, /^SS-[A-HJ-NP-Z]{4}-\d{4}$/);
    assert.equal(result.workflow_stage, 'Prebooking');
    assert.equal(result.replay, false);
    assert.deepEqual(result.customer, {
      display_name: 'Pat Example',
      postcode: 'EX1 1AA'
    });

    const after = await snapshot();
    assert.equal(after.customers, before.customers + 1);
    assert.equal(after.jobs, before.jobs + 1);
    assert.equal(after.presales, before.presales + 1);
    assert.equal(after.tasks, before.tasks + 4);
    assert.equal(after.commands, before.commands + 1);
  });

  test('tasks follow the finance route with explicit, deterministic owners', () => {
    const byCode = Object.fromEntries(result.tasks.map((t) => [t.code, t]));
    assert.deepEqual(Object.keys(byCode).sort(), [
      'PRE01',
      'PRE02',
      'PRE03',
      'PRE04'
    ]);
    assert.equal(byCode.PRE01.title, 'Send deposit invoice');
    for (const code of ['PRE01', 'PRE02', 'PRE04']) {
      assert.equal(byCode[code].owner_name, 'Tanya Harris');
      assert.equal(byCode[code].backup_name, null);
    }
    assert.equal(byCode.PRE03.owner_name, 'Ben Quick');
    assert.equal(byCode.PRE03.backup_name, 'Dan Barnes');
    assert.deepEqual(
      ['PRE01', 'PRE02', 'PRE03', 'PRE04'].map((c) => byCode[c].priority),
      [1, 1, 2, 2]
    );

    // PRE01/PRE02 are due at the submit instant; PRE04 has no due date.
    for (const code of ['PRE01', 'PRE02']) {
      const due = new Date(byCode[code].due_at);
      assert.ok(Math.abs(due - started) < 60_000, `${code} due at creation`);
    }
    assert.equal(byCode.PRE04.due_at, null);
    // PRE03: next staffed day, 09:00 Europe/London (not a literal 09:00Z).
    assert.equal(
      new Date(byCode.PRE03.due_at).toISOString(),
      nextStaffedDayLondon(started).toISOString()
    );
  });

  test('stored rows are transformed, attributed to the actor and snapshotted', async () => {
    const { data: job } = await service
      .from('jobs')
      .select('*, customers(*), presales(*)')
      .eq('id', result.job_id)
      .single();
    assert.equal(job.customers.first_name, 'Pat');
    assert.equal(job.customers.postcode, 'EX1 1AA');
    assert.equal(job.customers.email, 'pat.example@example.com');
    assert.equal(job.display_name, 'Example – EX1 1AA');
    assert.equal(job.finance_route, 'Standard');
    assert.equal(job.original_gross_pence, 1250000);
    assert.equal(job.current_contract_gross_pence, 1250000);
    assert.equal(job.salesperson_id, rickRow.id);
    assert.equal(job.created_by, rickRow.id);
    assert.equal(job.version, 1);
    const presale = Array.isArray(job.presales)
      ? job.presales[0]
      : job.presales;
    assert.equal(presale.agreed_price_pence, 1250000);
    assert.equal(presale.computed_total_pence, 1249900);
    assert.equal(presale.net_panels, 10);
    assert.equal(presale.design.slopes[0].label, 'Primary Elevation');

    const { data: tasks } = await service
      .from('tasks')
      .select('*')
      .eq('job_id', result.job_id);
    assert.ok(
      tasks.every(
        (t) =>
          t.status === 'Open' &&
          t.assignment_rule_id &&
          t.created_by === rickRow.id
      )
    );
    assert.ok(
      tasks.every(
        (t) =>
          t.instance_key === `${t.template_code}-${result.job_id}-ROOT-nodue`
      )
    );
    const pre03 = tasks.find((t) => t.template_code === 'PRE03');
    assert.equal(pre03.owner_id, benRow.id);
    assert.equal(pre03.backup_id, danRow.id);
  });

  test('every created entity is audited to the person and the command', async () => {
    const { data: events } = await service
      .from('audit_events')
      .select('entity_type, action, initiating_person_id, executing_service')
      .eq('command_id', commandId);
    const byType = events.reduce(
      (acc, e) => ({ ...acc, [e.entity_type]: (acc[e.entity_type] ?? 0) + 1 }),
      {}
    );
    // Since document generation (20260920280000), recording a sale also queues
    // the customer documents: app.document_queue_on_presale is an AFTER INSERT
    // trigger on presales that enqueues exactly one revision per configured
    // document type, in the sale's own transaction. So they are audited under
    // the same command and the same person as everything else the sale created.
    assert.deepEqual(byType, {
      customers: 1,
      jobs: 1,
      presales: 1,
      tasks: 4,
      document_revisions: 2
    });
    assert.ok(events.every((e) => e.action === 'INSERT'));
    assert.ok(events.every((e) => e.initiating_person_id === rickRow.id));
    assert.ok(
      events.every((e) => e.executing_service === 'command:SOLD_INTAKE')
    );
  });

  // Asserted as the named set with their per-row invariants, not as a bare
  // count, so the two events above cannot pass for the wrong reason. The set is
  // app.document_types(), which is not client-readable, so it is named here; if
  // a third type is configured, this fails and says so.
  test('the sale queues exactly one Queued revision per document type', async () => {
    const { data: revisions } = await service
      .from('document_revisions')
      .select('document_type, revision_number, status, source, evidence_id')
      .eq('job_id', result.job_id);
    assert.deepEqual(
      revisions.map((r) => r.document_type).sort(),
      ['QuotationContract', 'ROI'],
      'app.document_types() - update this list if a type is added'
    );
    for (const r of revisions) {
      assert.equal(r.revision_number, 1, 'the first revision of each');
      assert.equal(r.status, 'Queued', 'queued by the sale, rendered later');
      assert.equal(r.source, 'system', 'the sale asked, not a person');
      assert.equal(r.evidence_id, null, 'nothing is claimed before rendering');
    }
  });

  test('a duplicate submit returns the same result and creates nothing', async () => {
    const before = await snapshot();
    const { data, error } = await submit(rick, commandId, payload(rickRow.id));
    assert.ifError(error);
    assert.equal(data.replay, true);
    assert.equal(data.job_ref, result.job_ref);
    assert.deepEqual({ ...data, replay: false }, result);
    assert.deepEqual(await snapshot(), before);
  });

  test('reusing the command id with different content, or as someone else, is refused', async () => {
    const before = await snapshot();
    const changed = await submit(
      rick,
      commandId,
      payload(rickRow.id, { sale: { agreed_price_pence: 1 } })
    );
    assert.match(changed.error?.message ?? '', /COMMAND_ID_CONFLICT/);
    const otherActor = await submit(tanya, commandId, payload(rickRow.id));
    assert.match(otherActor.error?.message ?? '', /COMMAND_ID_CONFLICT/);
    assert.deepEqual(await snapshot(), before);
  });
});

describe('finance route drives the PRE tasks', () => {
  for (const route of ['Phoenix', 'OtherReview']) {
    test(`${route} creates PRE02, PRE04 and PRE05 - no deposit tasks`, async () => {
      const { data, error } = await submit(
        rick,
        randomUUID(),
        payload(rickRow.id, { sale: { finance_route: route } })
      );
      assert.ifError(error);
      assert.deepEqual(
        data.tasks.map((t) => t.code),
        ['PRE02', 'PRE04', 'PRE05']
      );
      assert.equal(
        data.tasks.find((t) => t.code === 'PRE05').owner_name,
        'Tanya Harris'
      );
    });
  }
});

describe('rejected commands leave no partial state', () => {
  const cases = [
    [
      'invalid postcode',
      { customer: { postcode: 'ZZ99 9Z' } },
      /INVALID_POSTCODE/
    ],
    [
      'missing first name',
      { customer: { first_name: '   ' } },
      /REQUIRED_FIRST_NAME/
    ],
    [
      'no phone and no email',
      { customer: { phone: null, email: null } },
      /CONTACT_METHOD_REQUIRED/
    ],
    ['bad email', { customer: { email: 'nope' } }, /INVALID_EMAIL/],
    ['zero price', { sale: { agreed_price_pence: 0 } }, /INVALID_GROSS_AMOUNT/],
    [
      'fractional pence',
      { sale: { agreed_price_pence: 10.5 } },
      /INVALID_GROSS_AMOUNT/
    ],
    [
      'unknown finance route',
      { sale: { finance_route: 'Maybe' } },
      /INVALID_FINANCE_ROUTE/
    ],
    ['unknown field', { customer: { actor_id: 'x' } }, /INVALID_FIELDS/],
    ['client-supplied actor', { submitted_by: 'someone' }, /INVALID_FIELDS/],
    [
      'scope flag missing',
      { scope: { roof_required: null } },
      /REQUIRED_ROOF_REQUIRED/
    ]
  ];
  for (const [name, overrides, expected] of cases) {
    test(name, async () => {
      const before = await snapshot();
      const { error } = await submit(
        rick,
        randomUUID(),
        payload(rickRow.id, overrides)
      );
      assert.match(error?.message ?? '', expected);
      assert.deepEqual(await snapshot(), before);
    });
  }

  test('a rejected command id can be corrected and reused', async () => {
    const id = randomUUID();
    const bad = await submit(
      rick,
      id,
      payload(rickRow.id, { customer: { postcode: 'x' } })
    );
    assert.ok(bad.error);
    const good = await submit(rick, id, payload(rickRow.id));
    assert.ifError(good.error);
    assert.equal(good.data.replay, false);
  });
});

describe('who may submit', () => {
  test('a Surveyor can only sell as themselves', async () => {
    const { error } = await submit(rick, randomUUID(), payload(daveRow.id));
    assert.match(error?.message ?? '', /SALESPERSON_MUST_BE_SELF/);
  });

  test('Office and Admin may submit on behalf of an active Surveyor', async () => {
    for (const client of [tanya, lenny]) {
      const { data, error } = await submit(
        client,
        randomUUID(),
        payload(daveRow.id)
      );
      assert.ifError(error);
      const { data: job } = await service
        .from('jobs')
        .select('salesperson_id, created_by')
        .eq('id', data.job_id)
        .single();
      assert.equal(job.salesperson_id, daveRow.id);
      assert.notEqual(job.created_by, daveRow.id);
    }
  });

  test('the salesperson must be an active Surveyor', async () => {
    const { error } = await submit(tanya, randomUUID(), payload(tanyaRow.id));
    assert.match(error?.message ?? '', /SALESPERSON_NOT_FOUND/);
  });

  test('Director, Installer, unmapped and anonymous callers are refused', async () => {
    const before = await snapshot();
    assert.match(
      (await submit(ben, randomUUID(), payload(rickRow.id))).error?.message ??
        '',
      /PERMISSION_DENIED/
    );
    assert.match(
      (await submit(john, randomUUID(), payload(rickRow.id))).error?.message ??
        '',
      /PERMISSION_DENIED/
    );
    assert.match(
      (await submit(stranger, randomUUID(), payload(rickRow.id))).error
        ?.message ?? '',
      /NOT_AUTHENTICATED/
    );
    assert.ok((await submit(anon, randomUUID(), payload(rickRow.id))).error);
    assert.deepEqual(await snapshot(), before);
  });
});

describe('RLS', () => {
  test('Surveyors see only their own jobs, customers and presales', async () => {
    const mine = await rick.from('jobs').select('salesperson_id, created_by');
    assert.ok(mine.data.length >= 3);
    assert.ok(
      mine.data.every(
        (j) => j.salesperson_id === rickRow.id || j.created_by === rickRow.id
      )
    );
    const daves = await dave.from('jobs').select('salesperson_id');
    assert.ok(daves.data.length >= 2);
    assert.ok(daves.data.every((j) => j.salesperson_id === daveRow.id));
    assert.equal(
      (await rick.from('customers').select('id')).data.length,
      mine.data.length
    );
    assert.equal(
      (await rick.from('presales').select('id')).data.length,
      mine.data.length
    );
    // Task authorization is assignment-based: a Surveyor owns none of these.
    assert.deepEqual((await rick.from('tasks').select('id')).data, []);
  });

  test('Office, Director and Admin see every job; an Installer sees none', async () => {
    const total = await count('jobs');
    for (const client of [tanya, lucy, ben, lenny]) {
      assert.equal((await client.from('jobs').select('id')).data.length, total);
    }
    assert.deepEqual((await john.from('jobs').select('id')).data, []);
    assert.deepEqual((await john.from('customers').select('id')).data, []);
    assert.ok((await ben.from('tasks').select('id')).data.length > 0);
  });

  test('nobody - not even an Admin - can write core tables directly', async () => {
    const anyJob = (
      await service.from('jobs').select('id, customer_id').limit(1).single()
    ).data;
    for (const client of [rick, tanya, lenny]) {
      const insert = await client
        .from('jobs')
        .insert({ job_ref: 'SS-AAAA-0001', customer_id: anyJob.customer_id });
      assert.equal(insert.error?.code, '42501');
      const update = await client
        .from('jobs')
        .update({ workflow_stage: 'Booked' })
        .eq('id', anyJob.id);
      assert.equal(update.error?.code, '42501');
      assert.equal(
        (await client.from('tasks').delete().eq('job_id', anyJob.id)).error
          ?.code,
        '42501'
      );
      assert.equal(
        (
          await client
            .from('customers')
            .update({ first_name: 'X' })
            .eq('id', anyJob.customer_id)
        ).error?.code,
        '42501'
      );
      assert.equal(
        (await client.from('commands').insert({ command_id: randomUUID() }))
          .error?.code,
        '42501'
      );
    }
  });
});

describe('constraints', () => {
  test('job references are unique and immutable; presales are immutable', async () => {
    const { data: job } = await service
      .from('jobs')
      .select('*')
      .limit(1)
      .single();
    const { id: _id, ...copy } = job;
    assert.equal(
      (await service.from('jobs').insert(copy)).error?.code,
      '23505'
    );
    const rename = await service
      .from('jobs')
      .update({ job_ref: 'SS-ZZZZ-9999' })
      .eq('id', job.id);
    assert.match(rename.error?.message ?? '', /JOB_REF_IS_IMMUTABLE/);
    const bad = await service
      .from('jobs')
      .insert({ ...copy, job_ref: 'SS-OIOI-0000' });
    assert.equal(bad.error?.code, '23514');
    const edit = await service
      .from('presales')
      .update({ agreed_price_pence: 1 })
      .eq('job_id', job.id);
    assert.match(edit.error?.message ?? '', /PRESALES_IS_IMMUTABLE/);
  });

  test('a task instance key can never be reused', async () => {
    const { data: task } = await service
      .from('tasks')
      .select('*')
      .limit(1)
      .single();
    const { id: _id, ...copy } = task;
    assert.equal(
      (await service.from('tasks').insert({ ...copy, status: 'Cancelled' }))
        .error?.code,
      '23505'
    );
  });
});

// Keep last: changes configuration used above.
describe('task assignment configuration fails visibly', () => {
  test('an ineligible backup resolves to nobody, never somebody else', async () => {
    await lenny.from('people').update({ active: false }).eq('id', danRow.id);
    const { data, error } = await submit(
      rick,
      randomUUID(),
      payload(rickRow.id)
    );
    assert.ifError(error);
    const pre03 = data.tasks.find((t) => t.code === 'PRE03');
    assert.equal(pre03.owner_name, 'Ben Quick');
    assert.equal(pre03.backup_name, null);
    await lenny.from('people').update({ active: true }).eq('id', danRow.id);
  });

  test('an unavailable owner fails the whole sale - no fallback, no partial state', async () => {
    await lenny.from('people').update({ active: false }).eq('id', benRow.id);
    const before = await snapshot();
    const standard = await submit(rick, randomUUID(), payload(rickRow.id));
    assert.match(standard.error?.message ?? '', /TASK_ASSIGNMENT_CONFIG/);
    assert.deepEqual(await snapshot(), before);
    // A finance sale needs no PRE03, so it is unaffected.
    assert.ifError(
      (
        await submit(
          rick,
          randomUUID(),
          payload(rickRow.id, { sale: { finance_route: 'Phoenix' } })
        )
      ).error
    );
    await lenny.from('people').update({ active: true }).eq('id', benRow.id);
  });

  test('a missing template fails the sale', async () => {
    await lenny
      .from('task_templates')
      .update({ active: false })
      .eq('code', 'PRE04');
    const before = await snapshot();
    const { error } = await submit(rick, randomUUID(), payload(rickRow.id));
    assert.match(error?.message ?? '', /TASK_TEMPLATE_CONFIG/);
    assert.deepEqual(await snapshot(), before);
    await lenny
      .from('task_templates')
      .update({ active: true })
      .eq('code', 'PRE04');
  });
});
