// LOCAL Supabase stack only (helpers.mjs asserts it).
//
// A programme says which canonical import field identifies a property in its
// source data. These prove what that means where it matters: re-importing a
// revised register must correct the properties already there, never fork them,
// and never disturb the visits recorded against them.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, service, signInAs } from './helpers.mjs';

let lenny;
const made = [];

const command = async (client, type, payload, envelope = {}) => {
  const { data, error } = await client.rpc('execute_command', {
    p_request: {
      command_id: randomUUID(),
      command_type: type,
      payload,
      ...envelope
    }
  });
  return { result: data?.result, error };
};
const ok = (r) => {
  assert.ifError(r.error);
  return r.result;
};
const refusal = (r) => r.error?.message?.match(/[A-Z_]{4,}/)?.[0];

const version = async (table, id) =>
  (await service.from(table).select('version').eq('id', id).single()).data
    .version;

/** Creates a programme with the given identity field. Test fixture, service role. */
async function programme(identityKey) {
  const id = randomUUID();
  const { error } = await service.from('programmes').insert({
    id,
    code: `ID-${id.slice(0, 8).toUpperCase()}`,
    name: `Identity fixture ${identityKey}`,
    status: 'Active',
    import_identity_key: identityKey
  });
  assert.ifError(error);
  made.push(id);
  return id;
}

/** Stages, maps and applies one file. Returns what the importer decided. */
async function importFile(programmeId, header, rows, mapping) {
  const importId = randomUUID();
  ok(
    await command(lenny, 'PROGRAMME_IMPORT_CREATE', {
      import_id: importId,
      programme_id: programmeId,
      filename: 'register.csv',
      header
    })
  );
  ok(
    await command(lenny, 'PROGRAMME_IMPORT_ADD_ROWS', {
      import_id: importId,
      from_index: 1,
      rows
    })
  );
  const mapped = ok(
    await command(
      lenny,
      'PROGRAMME_IMPORT_MAP',
      { import_id: importId, mapping },
      { expected_version: await version('programme_imports', importId) }
    )
  );
  const applied = ok(
    await command(
      lenny,
      'PROGRAMME_IMPORT_APPLY',
      { import_id: importId },
      { expected_version: await version('programme_imports', importId) }
    )
  );
  const { data: rowsOut } = await service
    .from('programme_import_rows')
    .select('action, problems')
    .eq('import_id', importId);
  return { importId, mapped, applied, rows: rowsOut };
}

const properties = async (programmeId) => {
  const { data } = await service
    .from('programme_properties')
    .select(
      'id, source_identity, external_ref, address_line1, expected_meter_serial, existing_sim_serial, existing_sim_type'
    )
    .eq('programme_id', programmeId)
    .order('source_identity');
  return data;
};

const METER_HEADER = ['Address', 'Meter No', 'Sim Type', 'ICCID'];
const METER_MAP = {
  address_line1: 0,
  expected_meter_serial: 1,
  existing_sim_type: 2,
  existing_sim_serial: 3
};

before(async () => {
  await ensureLogin(email('lenny'));
  lenny = await signInAs(email('lenny'));
  // This file sets up its own preconditions rather than inheriting them from
  // whichever suite happened to run first: FN-22 gates every programme command,
  // and a test that only passes in one file order is not a passing test.
  const modes = await service
    .from('release_modes')
    .update({ mode: 'Manual', authorised_job_scope: 'Pilot' })
    .eq('function_id', 'FN-22');
  assert.ifError(modes.error);
});

after(async () => {
  for (const id of made) {
    await service.from('programme_properties').delete().eq('programme_id', id);
    await service
      .from('programme_import_rows')
      .delete()
      .in(
        'import_id',
        (
          (
            await service
              .from('programme_imports')
              .select('id')
              .eq('programme_id', id)
          ).data ?? []
        ).map((r) => r.id)
      );
    await service.from('programme_imports').delete().eq('programme_id', id);
    await service.from('programmes').delete().eq('id', id);
  }
});

describe('a programme identified by the meter', () => {
  test('imports a register that has no property reference at all', async () => {
    const id = await programme('expected_meter_serial');
    const out = await importFile(
      id,
      METER_HEADER,
      [
        [
          '9 Northampton Close, Plymouth PL5 4JT',
          'EML1409032559',
          'Velos',
          '8944502106211700645'
        ],
        [
          '12 Northampton Close, Plymouth PL5 4JT',
          'EML1409032560',
          'Velos',
          '8944502106211658207'
        ]
      ],
      METER_MAP
    );
    assert.equal(out.mapped.invalid_rows, 0);
    assert.equal(out.applied.created, 2);
    const p = await properties(id);
    assert.equal(p.length, 2);
    // The client issued no reference, and none was invented for them.
    assert.deepEqual(
      p.map((r) => r.external_ref),
      [null, null]
    );
    assert.deepEqual(
      p.map((r) => r.source_identity),
      ['EML1409032559', 'EML1409032560']
    );
  });

  test('two meters at one address stay two properties', async () => {
    const id = await programme('expected_meter_serial');
    const out = await importFile(
      id,
      METER_HEADER,
      [
        [
          '31 Hornchurch Road, Plymouth PL5 2TF',
          'EML1528109348',
          'Velos',
          '8944502106211706535'
        ],
        [
          '31 Hornchurch Road, Plymouth PL5 2TF',
          'EML2508465949',
          '1N',
          '8988228066620375076'
        ]
      ],
      METER_MAP
    );
    assert.equal(out.applied.created, 2);
    assert.equal(out.mapped.invalid_rows, 0);
    assert.equal((await properties(id)).length, 2);
  });

  test('the same meter twice in one file is refused as a repeat', async () => {
    const id = await programme('expected_meter_serial');
    const out = await importFile(
      id,
      METER_HEADER,
      [
        ['1 A Street, Plymouth PL1 1AA', 'EML0001', 'Velos', '8944'],
        ['2 B Street, Plymouth PL1 1AB', 'EML0001', 'Velos', '8945']
      ],
      METER_MAP
    );
    assert.equal(out.mapped.invalid_rows, 1);
    assert.equal(out.applied.created, 1);
    const problem = out.rows.flatMap((r) => r.problems).find(Boolean);
    assert.equal(problem.field, 'expected_meter_serial');
    assert.equal(problem.problem, 'repeated in this file');
  });

  test('a row with no meter serial is invalid, and nothing else is', async () => {
    const id = await programme('expected_meter_serial');
    const out = await importFile(
      id,
      METER_HEADER,
      [
        ['3 C Street, Plymouth PL1 1AC', '', 'Velos', '8944'],
        ['4 D Street, Plymouth PL1 1AD', 'EML0002', '', '']
      ],
      METER_MAP
    );
    assert.equal(out.mapped.invalid_rows, 1);
    // A missing SIM serial or type is baseline data the client omitted, not a
    // reason to refuse the property: the installer records what is there.
    assert.equal(out.applied.created, 1);
    const [p] = await properties(id);
    assert.equal(p.existing_sim_serial, null);
    assert.equal(p.existing_sim_type, null);
  });

  test('SIM type and serial survive the round trip exactly as supplied', async () => {
    const id = await programme('expected_meter_serial');
    await importFile(
      id,
      METER_HEADER,
      [
        ['5 E Street, Plymouth PL1 1AE', 'EML0003', '1N', '8988228066620375076']
      ],
      METER_MAP
    );
    const [p] = await properties(id);
    assert.equal(p.existing_sim_type, '1N');
    assert.equal(p.existing_sim_serial, '8988228066620375076');
  });
});

describe('re-importing a revised register', () => {
  test('the identical file again creates nothing and duplicates nothing', async () => {
    const id = await programme('expected_meter_serial');
    const rows = [
      ['6 F Street, Plymouth PL1 1AF', 'EML0010', 'Velos', '8944'],
      ['7 G Street, Plymouth PL1 1AG', 'EML0011', '1N', '8945']
    ];
    const first = await importFile(id, METER_HEADER, rows, METER_MAP);
    assert.equal(first.applied.created, 2);
    const again = await importFile(id, METER_HEADER, rows, METER_MAP);
    assert.equal(again.applied.created, 0);
    assert.equal(again.applied.updated, 2);
    assert.equal((await properties(id)).length, 2);
  });

  test('the same meter with a corrected address updates it, keeping its id', async () => {
    const id = await programme('expected_meter_serial');
    await importFile(
      id,
      METER_HEADER,
      [['8 Wrong Street, Plymouth PL1 1AH', 'EML0020', 'Velos', '8944']],
      METER_MAP
    );
    const [before] = await properties(id);
    const out = await importFile(
      id,
      METER_HEADER,
      [['8 Right Street, Plymouth PL1 1AH', 'EML0020', '1N', '8999']],
      METER_MAP
    );
    assert.equal(out.applied.updated, 1);
    const [after] = await properties(id);
    assert.equal(after.id, before.id, 'the property must not be replaced');
    assert.equal(after.address_line1, '8 Right Street, Plymouth PL1 1AH');
    assert.equal(after.existing_sim_serial, '8999');
    assert.equal(after.existing_sim_type, '1N');
  });

  test('case and spacing in a meter serial do not fork the property', async () => {
    const id = await programme('expected_meter_serial');
    await importFile(
      id,
      METER_HEADER,
      [['9 H Street, Plymouth PL1 1AJ', 'EML0030', 'Velos', '8944']],
      METER_MAP
    );
    const out = await importFile(
      id,
      METER_HEADER,
      [['9 H Street, Plymouth PL1 1AJ', ' eml-0030 ', 'Velos', '8944']],
      METER_MAP
    );
    assert.equal(out.applied.created, 0);
    assert.equal(out.applied.updated, 1);
    assert.equal((await properties(id)).length, 1);
  });

  test('a blank field in the revised file keeps what is on record', async () => {
    const id = await programme('expected_meter_serial');
    await importFile(
      id,
      METER_HEADER,
      [['10 J Street, Plymouth PL1 1AK', 'EML0040', 'Velos', '8944']],
      METER_MAP
    );
    await importFile(
      id,
      METER_HEADER,
      [['10 J Street, Plymouth PL1 1AK', 'EML0040', '', '']],
      METER_MAP
    );
    const [p] = await properties(id);
    assert.equal(p.existing_sim_type, 'Velos');
    assert.equal(p.existing_sim_serial, '8944');
  });
});

describe('programmes identified by the client reference still behave as before', () => {
  const HEADER = ['PCH ID', 'Address'];
  const MAP = { external_ref: 0, address_line1: 1 };

  test('external_ref identifies the property, and is required', async () => {
    const id = await programme('external_ref');
    const out = await importFile(
      id,
      HEADER,
      [
        ['PCH-1', '1 K Street, Plymouth PL1 1AL'],
        ['', '2 L Street, Plymouth PL1 1AM']
      ],
      MAP
    );
    assert.equal(out.mapped.invalid_rows, 1);
    assert.equal(out.applied.created, 1);
    const [p] = await properties(id);
    assert.equal(p.external_ref, 'PCH-1');
    assert.equal(p.source_identity, 'PCH-1');
  });

  test('a file with no reference column is refused at mapping', async () => {
    const id = await programme('external_ref');
    const importId = randomUUID();
    ok(
      await command(lenny, 'PROGRAMME_IMPORT_CREATE', {
        import_id: importId,
        programme_id: id,
        filename: 'no-ref.csv',
        header: METER_HEADER
      })
    );
    ok(
      await command(lenny, 'PROGRAMME_IMPORT_ADD_ROWS', {
        import_id: importId,
        from_index: 1,
        rows: [['1 M Street', 'EML0050', 'Velos', '8944']]
      })
    );
    const r = await command(
      lenny,
      'PROGRAMME_IMPORT_MAP',
      { import_id: importId, mapping: METER_MAP },
      { expected_version: await version('programme_imports', importId) }
    );
    assert.equal(refusal(r), 'PROGRAMME_IMPORT_MAPPING_REQUIRED');
  });
});
