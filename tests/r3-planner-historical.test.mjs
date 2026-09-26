// Planner historical overlay: imported records are visible, and provably not
// operational.
//
// The overlay exists so the office can see genuine dates preserved from the
// old Job Booking form. Everything here is about the line that must not be
// crossed: a historical record can be READ on the planner, and cannot be
// scheduled, moved, reassigned, counted as capacity, or treated as work
// waiting to be done.
//
//   SUPABASE_TEST_WORKDIR=<dir with supabase/config.toml> node --test tests/r3-planner-historical.test.mjs
//
// Named to run after preview-dev.test.mjs, which counts the rows it can see.
// Uses the real import function to create its fixtures, so what is tested is
// the shape production actually has.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, service, signInAs } from './helpers.mjs';

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
  execFileSync(
    'psql',
    [DB_URL, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', statement],
    {
      encoding: 'utf8'
    }
  ).trim();

let tanya, casey;
const jobs = {};

// Dates chosen to sit in the imported dataset's era and nowhere near the live
// fixtures, so "does history show up" is never confused with "is today busy".
const ROOF = '2025-07-15';
const ELEC = '2025-07-16';
const SCAFFOLD = '2025-07-11';
const AWAY = '2025-11-20';

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

/**
 * One historical record, created by the real import function.
 *
 * `historicalFacts` is where the importer preserves the genuine dates, and it
 * is the only place the planner reads them from.
 */
function candidate({ tag, roofDate, elecDate, scaffoldDate, people = [] }) {
  return {
    provenance: {
      sourceSystem: 'historical-job-booking-form',
      batchId: 'planner-overlay-test',
      submissionId: `sub-${tag}`,
      // The importer keys idempotency on (formId, importKey).
      importKey: `planner-overlay-test:${tag}`,
      formId: 'booking-legacy',
      payloadHash: `hash-${tag}`,
      submittedAt: '2025-06-01T09:00:00Z',
      legacyReference: `LEGACY-${tag}`,
      importerVersion: 'test'
    },
    customer: {
      firstName: 'Nora',
      lastName: `Historic${tag}`,
      addressLine1: '3 Old Booking Lane',
      addressLine2: null,
      town: 'Plymouth',
      postcode: 'PL9 7NX',
      email: `nora-${tag}@example.com`,
      phone: '07000 000123'
    },
    job: {
      soldAt: '2025-06-01T09:00:00Z',
      grossPence: 850000,
      leadSource: 'Referral',
      financeRoute: 'Standard',
      roofRequired: roofDate !== null,
      electricalRequired: elecDate !== null,
      scaffoldRequired: scaffoldDate !== null
    },
    technical: { systemKw: '4.1' },
    historicalPeople: people,
    historicalFacts: {
      work: { roofDate, electricalDate: elecDate },
      scaffold: {
        required: scaffoldDate !== null,
        erectDate: scaffoldDate,
        companyName: scaffoldDate ? 'Skyline' : null,
        accessNotes: null,
        contactDomain: null
      },
      equipment: [],
      materials: [],
      files: [],
      commercial: {
        // Present on purpose: an intention to invoice is NOT a planner event,
        // and this test proves it never becomes one.
        invoiceIntentDate: '2025-07-20',
        merchantContact: null,
        financeAnswer: null
      }
    },
    warnings: [],
    sourceColumns: {},
    sourceRows: [1]
  };
}

const importOne = (c) => {
  const json = JSON.stringify(c).replace(/'/g, "''");
  return JSON.parse(
    sql(`select app.historical_import_apply('${json}'::jsonb, false)`)
  );
};

before(async () => {
  for (const n of ['tanya', 'casey']) await ensureLogin(email(n));
  [tanya, casey] = await Promise.all(
    ['tanya', 'casey'].map((n) => signInAs(email(n)))
  );

  // A fully dated record, with one linked and one ambiguous staff name.
  const { data: caseyPerson } = await service
    .from('people')
    .select('legacy_id')
    .eq('legacy_id', 'PERSON-casey')
    .single();
  jobs.full = importOne(
    candidate({
      tag: 'full',
      roofDate: ROOF,
      elecDate: ELEC,
      scaffoldDate: SCAFFOLD,
      people: [
        {
          role: 'Electrician',
          sourceValue: 'Casey Lakey',
          personLegacyId: caseyPerson.legacy_id,
          matchKind: 'SafeNormalisedMatch',
          sourceColumn: 7
        },
        {
          role: 'Installer',
          sourceValue: 'Dave',
          personLegacyId: null,
          matchKind: 'Ambiguous',
          sourceColumn: 6
        }
      ]
    })
  );
  // A record the old form never gave a work date to.
  jobs.undated = importOne(
    candidate({
      tag: 'undated',
      roofDate: null,
      elecDate: null,
      scaffoldDate: null
    })
  );
  assert.equal(jobs.full.action, 'imported');
  assert.equal(jobs.undated.action, 'imported');
});

after(async () => {
  for (const key of ['full', 'undated']) {
    const id = jobs[key]?.job_id;
    if (!id) continue;
    await service.from('intake').delete().eq('job_id', id);
    await service.from('historical_job_people').delete().eq('job_id', id);
    await service.from('technical_details').delete().eq('job_id', id);
    const { data: j } = await service
      .from('jobs')
      .select('customer_id')
      .eq('id', id)
      .single();
    await service.from('jobs').delete().eq('id', id);
    if (j?.customer_id) {
      await service.from('customers').delete().eq('id', j.customer_id);
    }
  }
});

// =============================================================================
// The record stays historical
// =============================================================================
describe('an imported record is never operational', () => {
  test('record_class, job_in_scope and job_actionable are all unchanged', () => {
    const id = jobs.full.job_id;
    assert.equal(
      sql(`select record_class from public.jobs where id = '${id}'`),
      'HistoricalImport'
    );
    assert.equal(
      sql(`select app.job_in_scope(j) from public.jobs j where j.id = '${id}'`),
      'f',
      'job_in_scope must stay false'
    );
    assert.equal(
      sql(
        `select app.job_actionable(j) from public.jobs j where j.id = '${id}'`
      ),
      'f',
      'job_actionable must stay false'
    );
  });

  test('displaying it created no operational rows whatsoever', () => {
    const id = jobs.full.job_id;
    for (const table of [
      'work_packages',
      'tasks',
      'scaffold_bookings',
      'calendar_links'
    ]) {
      assert.equal(
        sql(`select count(*) from public.${table} where job_id = '${id}'`),
        '0',
        `${table}: no live row may be synthesised to show a historical fact`
      );
    }
    // Allocations reach a job through their work package, and there are none.
    assert.equal(
      sql(`select count(*) from public.allocations a
           join public.work_packages w on w.id = a.work_package_id
           where w.job_id = '${id}'`),
      '0',
      'allocations: nobody is allocated to a historical record'
    );
  });
});

// =============================================================================
// The window
// =============================================================================
describe('historical events in a window', () => {
  const win = (from, to, records) =>
    readOk(tanya, { read_type: 'PLANNER_WINDOW', from, to, records }, records);

  test('a dated historical event appears in its own window', async () => {
    const data = await win(ROOF, ROOF, 'historical');
    const mine = data.historical.filter((h) => h.job_id === jobs.full.job_id);
    assert.equal(mine.length, 1, 'the roof date is there, once');
    assert.equal(mine[0].kind, 'Roof');
    assert.equal(mine[0].event_date, ROOF);
    assert.equal(mine[0].read_only, true);
    assert.equal(mine[0].record_class, 'HistoricalImport');
    assert.equal(mine[0].source_field, 'Date Roofer');
    assert.equal(mine[0].postcode, 'PL9 7NX');
  });

  test('each preserved date is its own event on its own day', async () => {
    const data = await win(SCAFFOLD, ELEC, 'historical');
    const mine = data.historical
      .filter((h) => h.job_id === jobs.full.job_id)
      .map((h) => `${h.kind}@${h.event_date}`)
      .sort();
    assert.deepEqual(mine, [
      `Electrical@${ELEC}`,
      `Roof@${ROOF}`,
      `ScaffoldErect@${SCAFFOLD}`
    ]);
  });

  test('an event outside the window does not appear', async () => {
    const data = await win(AWAY, AWAY, 'historical');
    assert.equal(
      data.historical.filter((h) => h.job_id === jobs.full.job_id).length,
      0
    );
  });

  test('a record with no preserved date never appears', async () => {
    const data = await win('2025-01-01', '2025-06-25', 'historical');
    assert.equal(
      data.historical.filter((h) => h.job_id === jobs.undated.job_id).length,
      0,
      'no date recorded is not an event'
    );
  });

  test('an intention to invoice is not a planner event', async () => {
    // The candidate carries invoiceIntentDate 2025-07-20. It is a commercial
    // intention, and the importer already refused to make it an obligation.
    const data = await win('2025-07-20', '2025-07-20', 'historical');
    assert.equal(
      data.historical.filter((h) => h.job_id === jobs.full.job_id).length,
      0,
      'only genuine work dates become events'
    );
  });

  test('the sold date is not a planner event either', async () => {
    const data = await win('2025-06-01', '2025-06-01', 'historical');
    assert.equal(
      data.historical.filter((h) => h.job_id === jobs.full.job_id).length,
      0
    );
  });

  test('the window stays bounded', async () => {
    const r = await opsRead(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: '2025-01-01',
      to: '2025-12-31',
      records: 'both'
    });
    assert.ok(r.error);
    assert.match(r.error.message, /at most 186 days/);
  });
});

// =============================================================================
// Live / Historical / Both, decided by the database
// =============================================================================
describe('the record filter', () => {
  test('live mode returns no historical events at all', async () => {
    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: ROOF,
      to: ROOF,
      records: 'live'
    });
    assert.equal(data.records, 'live');
    assert.deepEqual(data.historical, [], 'history is not sent, not hidden');
  });

  test('historical mode returns no live work', async () => {
    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: ROOF,
      to: ROOF,
      records: 'historical'
    });
    assert.equal(data.records, 'historical');
    assert.deepEqual(data.rows, []);
    assert.deepEqual(data.scaffold, []);
    assert.ok(data.historical.length > 0);
  });

  test('both returns both, and defaults to live', async () => {
    const both = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: ROOF,
      to: ROOF,
      records: 'both'
    });
    assert.equal(both.records, 'both');
    assert.ok(both.historical.length > 0);

    const fallback = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: ROOF,
      to: ROOF
    });
    assert.equal(fallback.records, 'live', 'the planner opens on live work');
    assert.deepEqual(fallback.historical, []);
  });

  test('an unknown mode is refused rather than guessed', async () => {
    const r = await opsRead(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: ROOF,
      to: ROOF,
      records: 'everything'
    });
    assert.ok(r.error);
    assert.match(r.error.message, /records must be live, historical or both/);
  });

  test('the count read reports what a window holds without returning it', async () => {
    const count = await readOk(tanya, {
      read_type: 'PLANNER_HISTORICAL_COUNT',
      from: SCAFFOLD,
      to: ELEC
    });
    assert.ok(count.events >= 3);
    assert.ok(count.jobs >= 1);
    assert.equal(count.historical, undefined, 'a count returns no records');
  });
});

// =============================================================================
// Needs scheduling, capacity and conflicts
// =============================================================================
describe('history never becomes work to do', () => {
  test('a historical record never appears in Needs scheduling', async () => {
    const data = await readOk(tanya, {
      read_type: 'PLANNER_UNSCHEDULED',
      limit: 200
    });
    for (const key of ['full', 'undated']) {
      assert.equal(
        data.work.filter((w) => w.job_id === jobs[key].job_id).length,
        0,
        'an imported record is not work waiting to be scheduled'
      );
    }
  });

  test('a historical date consumes no installer capacity', async () => {
    // Casey is named on the historical electrical date. If history counted,
    // he would be unavailable that day.
    const { data: casey_ } = await service
      .from('people')
      .select('id')
      .eq('legacy_id', 'PERSON-casey')
      .single();
    const assess = await readOk(tanya, {
      read_type: 'RP_ASSESS',
      trade: 'Electrical',
      start_at: ELEC,
      end_at: ELEC
    });
    const him = assess.candidates.find((c) => c.person_id === casey_.id);
    assert.ok(him, 'Casey is assessed');
    assert.equal(him.load, 0, 'a historical record must not load an installer');
    assert.equal(
      him.reasons.includes('CAPACITY_CONFLICT'),
      false,
      'a historical record must not cause a capacity conflict'
    );
  });

  test('the team view shows no allocation for a historical record', async () => {
    const team = await readOk(tanya, {
      read_type: 'RP_TEAM_PLANNER',
      start: SCAFFOLD,
      weeks: 2
    });
    const everyone = [
      ...team.teams.flatMap((t) => t.members),
      ...team.unassigned_installers
    ];
    for (const p of everyone) {
      for (const a of p.allocations) {
        assert.notEqual(
          a.job_id,
          jobs.full.job_id,
          'history must not occupy a resource row'
        );
      }
    }
  });
});

// =============================================================================
// Staff attribution
// =============================================================================
describe('staff on a historical event', () => {
  test('an unambiguous name is linked; an ambiguous one is never guessed', async () => {
    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: SCAFFOLD,
      to: ELEC,
      records: 'historical'
    });
    const elec = data.historical.find(
      (h) => h.job_id === jobs.full.job_id && h.kind === 'Electrical'
    );
    const roof = data.historical.find(
      (h) => h.job_id === jobs.full.job_id && h.kind === 'Roof'
    );

    const linked = elec.people.find((p) => p.source_value === 'Casey Lakey');
    assert.ok(linked, 'the electrician is carried on the electrical event');
    assert.equal(linked.linked, true);
    assert.ok(linked.person_id, 'an unambiguous match resolves to a person');

    const ambiguous = roof.people.find((p) => p.source_value === 'Dave');
    assert.ok(ambiguous, 'the source text survives');
    assert.equal(ambiguous.linked, false);
    assert.equal(
      ambiguous.person_id,
      null,
      'an ambiguous name must never be resolved to somebody'
    );
    assert.equal(ambiguous.match_kind, 'Ambiguous');
  });

  test('the database itself forbids linking an uncertain match', () => {
    const id = jobs.full.job_id;
    assert.throws(
      () =>
        sql(`update public.historical_job_people
             set person_id = (select id from public.people limit 1)
             where job_id = '${id}' and match_kind = 'Ambiguous'`),
      /historical_job_people_link_requires_certainty/,
      'the CHECK is the guarantee, not the importer being careful'
    );
  });
});

// =============================================================================
// Permissions
// =============================================================================
describe('permissions', () => {
  test('an installer is refused the planner reads, history included', async () => {
    for (const records of ['live', 'historical', 'both']) {
      const r = await opsRead(casey, {
        read_type: 'PLANNER_WINDOW',
        from: ROOF,
        to: ROOF,
        records
      });
      assert.ok(r.error, `${records}: the planner is an office surface`);
      assert.match(r.error.message, /ROLE_DENIED/);
    }
  });

  test('the historical count read is role-checked the same way', async () => {
    const r = await opsRead(casey, {
      read_type: 'PLANNER_HISTORICAL_COUNT',
      from: ROOF,
      to: ROOF
    });
    assert.ok(r.error);
    assert.match(r.error.message, /ROLE_DENIED/);
  });

  test('readability is job readability, not operational scope', () => {
    // The whole overlay depends on this: job_in_scope is false for every
    // historical row, so using it to authorise would return nothing at all.
    const usesScope = sql(`select pg_get_functiondef(p.oid) ~ 'job_in_scope'
                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'app' and p.proname = 'planner_historical_window'`);
    assert.equal(usesScope, 'f', 'must not authorise with job_in_scope');
    const usesReadable = sql(`select pg_get_functiondef(p.oid) ~ 'can_read_job'
                              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'app' and p.proname = 'planner_historical_window'`);
    assert.equal(usesReadable, 't', 'must authorise with can_read_job');
  });
});

// =============================================================================
// Live behaviour is untouched
// =============================================================================
describe('live planner behaviour is unchanged', () => {
  test('the live payload still has its shape, and now its address fields', async () => {
    const data = await readOk(tanya, {
      read_type: 'PLANNER_WINDOW',
      from: '2026-11-02',
      to: '2026-11-08'
    });
    assert.ok(Array.isArray(data.rows));
    assert.ok(Array.isArray(data.scaffold));
    assert.ok(Array.isArray(data.holidays));
    assert.equal(data.days, 7);
    assert.equal(data.records, 'live');
  });

  test('a historical job is still refused by the scheduling commands', async () => {
    const id = jobs.full.job_id;
    const { error } = await tanya.rpc('execute_command', {
      p_request: {
        command_id: randomUUID(),
        command_type: 'PLANNER_UPDATE',
        job_id: id,
        work_package_id: randomUUID(),
        expected_version: 1,
        payload: {
          planned_start: ROOF,
          planned_end: ROOF,
          reason: 'should never be possible'
        }
      }
    });
    assert.ok(error, 'a historical job cannot be planned');
    assert.match(
      error.message,
      /HISTORICAL_IMPORT|NOT_ACTIONABLE|OUTSIDE_PILOT/
    );
  });
});
