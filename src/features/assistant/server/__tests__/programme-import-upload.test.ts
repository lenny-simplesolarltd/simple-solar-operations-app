import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Attaching Dan's property list in SimpleBot.
 *
 * The thing being protected here is simple: a 1,400-row property register must
 * never travel inside a model request. Before this route existed, the only way
 * a CSV reached the assistant was features/assistant/lib/attachments.ts, which
 * reads the file in the browser and inlines it, truncated at 200KB - so the
 * model would have held a partial copy of somebody's housing stock, and any
 * "import" from it would have been the model retyping rows.
 *
 * So these tests assert three separable promises: the file is staged through
 * the same commands the import screen uses, what comes back is bounded and
 * contains no cell of the file, and someone without programme.manage is turned
 * away before anything is staged.
 */

const auth = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/auth', () => auth);

const guard = vi.hoisted(() => ({
  previewWriteBlock: vi.fn<() => Promise<string | null>>()
}));
vi.mock('@/lib/preview/guard', () => guard);

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

const queries = vi.hoisted(() => ({
  programmesEnabled: vi.fn(async () => true),
  programmeAccess: vi.fn(),
  listProgrammes: vi.fn(),
  getImport: vi.fn(),
  importRows: vi.fn()
}));
vi.mock('@/features/programmes/server/queries', () => queries);

const backend = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('@/lib/backend/command', () => backend);

import { POST } from '@/app/api/assistant/programme-import/route';
import { readAttachments } from '@/features/assistant/lib/attachments';
import { IMPORT_KEY_LABEL } from '@/features/programmes/labels';
import type { ImportKey } from '@/features/programmes/types';
import {
  guessMapping,
  IMPORT_CHUNK,
  importChunks,
  mappingPayload,
  planImport
} from '@/features/programmes/server/import-plan';
import type { CommandRequest } from '@/lib/backend/types';
import { z } from 'zod';
import {
  PROGRAMME_IMPORT_MUTATION_TOOLS,
  PROGRAMME_IMPORT_READ_TOOLS
} from '../tools/programme-imports';

const PROGRAMME_ID = '1b2c3d4e-5f60-4a7b-8c8d-9e0f1a2b3c4e';
const ROWS = 1400;

const HEADER = [
  'PCH Property Ref',
  'Address Line 1',
  'Address Line 2',
  'Town',
  'Postcode',
  'Meter Serial Number',
  'SIM ICCID',
  'Notes'
];

/**
 * A synthetic property list, generated rather than committed: a fixture file of
 * 1,400 addresses is both noise in the repository and a temptation to commit a
 * real one. Three deliberate faults, one of each kind the database judges.
 */
function bigCsv(): string {
  const lines = [HEADER.join(',')];
  for (let i = 1; i <= ROWS; i += 1) {
    const ref = i === 900 ? 'PCH-000500' : `PCH-${String(i).padStart(6, '0')}`;
    const address = i === 1200 ? '' : `${i} Sample Street`;
    lines.push(
      [
        ref,
        address,
        '',
        'Plymouth',
        `PL${(i % 9) + 1} ${(i % 9) + 1}AB`,
        `MSN${100000 + i}`,
        `8944${String(i).padStart(12, '0')}`,
        'Tenanted'
      ].join(',')
    );
  }
  // A completely blank row, which the reader drops and reports.
  lines.push(',,,,,,,');
  return lines.join('\r\n');
}

const CSV = bigCsv();

/** The judgement the database makes during PROGRAMME_IMPORT_MAP, in miniature. */
function judge(rows: string[][], mapping: Record<string, number>) {
  const seen = new Set<string>();
  return rows.map((cells) => {
    const ref = (cells[mapping.external_ref] ?? '').trim();
    const address = (cells[mapping.address_line1] ?? '').trim();
    const problems: { field: string; problem: string }[] = [];
    if (!ref) problems.push({ field: 'external_ref', problem: 'missing' });
    if (!address) problems.push({ field: 'address_line1', problem: 'missing' });
    if (ref && seen.has(ref))
      problems.push({
        field: 'external_ref',
        problem: 'repeated in this file'
      });
    if (ref) seen.add(ref);
    return { problems, action: problems.length ? 'Invalid' : 'Create' };
  });
}

/** A fake command runner that stages rows the way the database does. */
function stagingBackend() {
  const state = {
    importId: '',
    header: [] as string[],
    rows: [] as string[][],
    validRows: 0,
    invalidRows: 0,
    judged: [] as { problems: { field: string; problem: string }[] }[],
    chunks: [] as number[],
    // Every command on an import raises its version, exactly as the database
    // does. Without this the mock let a caller map with a stale version and the
    // real staging refused what the test called a pass.
    version: 0
  };
  backend.runCommand.mockImplementation(async (request: CommandRequest) => {
    const payload = request.payload as Record<string, unknown>;
    if (request.command_type === 'PROGRAMME_IMPORT_CREATE') {
      state.importId = payload.import_id as string;
      state.header = payload.header as string[];
      state.version += 1;
      return {
        ok: true,
        outcome: { status: 'Succeeded', heading: 'SUCCESS', message: 'Saved.' },
        result: {
          import_id: state.importId,
          status: 'Draft',
          version: state.version
        }
      };
    }
    if (request.command_type === 'PROGRAMME_IMPORT_ADD_ROWS') {
      const rows = payload.rows as string[][];
      const from = payload.from_index as number;
      state.chunks.push(rows.length);
      expect(from).toBe(state.rows.length + 1);
      for (const row of rows) expect(row).toHaveLength(state.header.length);
      state.rows.push(...rows);
      state.version += 1;
      return {
        ok: true,
        outcome: { status: 'Succeeded', heading: 'SUCCESS', message: 'Saved.' },
        result: { row_count: state.rows.length, version: state.version }
      };
    }
    if (request.command_type === 'PROGRAMME_IMPORT_MAP') {
      // The database refuses a stale version; so does this.
      if (request.expected_version !== state.version) {
        return {
          ok: false,
          outcome: {
            status: 'Failed',
            heading: 'COULD NOT COMPLETE',
            code: 'PROGRAMME_STALE_VERSION',
            message:
              'This record changed after you opened the form. Go back, refresh, and try again.'
          }
        };
      }
      state.version += 1;
      const mapping = payload.mapping as Record<string, number>;
      state.judged = judge(state.rows, mapping);
      state.invalidRows = state.judged.filter(
        (r) => r.problems.length > 0
      ).length;
      state.validRows = state.rows.length - state.invalidRows;
      return {
        ok: true,
        outcome: { status: 'Succeeded', heading: 'SUCCESS', message: 'Saved.' },
        result: {
          valid_rows: state.validRows,
          invalid_rows: state.invalidRows,
          version: state.version
        }
      };
    }
    throw new Error(`unexpected command ${request.command_type}`);
  });
  queries.getImport.mockImplementation(async () => ({
    id: state.importId,
    programmeId: PROGRAMME_ID,
    filename: 'dan-properties.csv',
    header: state.header,
    rowCount: state.rows.length,
    mapping: null,
    status: 'Mapped',
    validRows: state.validRows,
    invalidRows: state.invalidRows,
    createdCount: null,
    updatedCount: null,
    appliedAt: null,
    createdAt: '2026-09-25T09:00:00.000Z',
    version: state.version
  }));
  queries.importRows.mockImplementation(async () =>
    state.judged
      .map((row, index) => ({ ...row, rowIndex: index + 1 }))
      .filter((row) => row.problems.length > 0)
      .map((row) => ({
        rowIndex: row.rowIndex,
        // Deliberately populated: the summary must not carry these through.
        cells: ['PCH-000900', '900 Sample Street'],
        mapped: { external_ref: 'PCH-000900' },
        problems: row.problems,
        action: 'Invalid' as const
      }))
  );
  return state;
}

const upload = (csv: string, filename = 'dan-properties.csv') => {
  const body = new FormData();
  body.append('file', new File([csv], filename, { type: 'text/csv' }));
  return new Request('http://localhost/api/assistant/programme-import', {
    method: 'POST',
    body
  });
};

const manager = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ben@example.test',
  fullName: 'Ben Director',
  roles: ['Manager']
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.getCurrentUser.mockResolvedValue(manager);
  guard.previewWriteBlock.mockResolvedValue(null);
  queries.programmesEnabled.mockResolvedValue(true);
  queries.programmeAccess.mockResolvedValue({
    read: true,
    readAll: true,
    submit: false,
    review: true,
    manage: true,
    report: true
  });
  queries.listProgrammes.mockResolvedValue([
    { id: PROGRAMME_ID, name: 'PCH Meter SIM Replacement', status: 'Active' }
  ]);
});

describe('a 1,400-row property list attached in chat', () => {
  it('stages every row through the canonical commands, in wizard-sized chunks', async () => {
    const state = stagingBackend();
    const response = await POST(upload(CSV));
    expect(response.status).toBe(200);

    const plan = planImport({ filename: 'dan-properties.csv', text: CSV });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(state.rows).toHaveLength(ROWS);
    expect(state.rows).toEqual(plan.table.rows);
    expect(state.chunks).toEqual(
      importChunks(plan.table.rows).map((c) => c.rows.length)
    );
    expect(state.chunks.every((n) => n <= IMPORT_CHUNK)).toBe(true);
  });

  it('answers with a bounded summary that contains no cell of the file', async () => {
    stagingBackend();
    const { summary } = await (await POST(upload(CSV))).json();
    const serialised = JSON.stringify(summary);

    expect(serialised.length).toBeLessThan(8 * 1024);
    // Every kind of cell the file contains, none of which may be echoed back.
    expect(serialised).not.toContain('Sample Street');
    expect(serialised).not.toContain('PCH-000001');
    expect(serialised).not.toContain('MSN100001');
    expect(serialised).not.toContain('8944');
    expect(serialised).not.toContain('Plymouth');

    expect(summary.import_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(summary.filename).toBe('dan-properties.csv');
    expect(summary.row_count).toBe(ROWS);
    expect(summary.columns).toEqual(HEADER);
    expect(summary.status).toBe('Mapped');
    expect(summary.warnings.length).toBeLessThanOrEqual(8);
  });

  it('reports the totals the import screen would reach for the same bytes', async () => {
    stagingBackend();
    const { summary } = await (await POST(upload(CSV))).json();

    const plan = planImport({ filename: 'dan-properties.csv', text: CSV });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The wizard's own first offer at the columns, from the shared module.
    expect(plan.mapping).toEqual(guessMapping(HEADER));
    const wizard = judge(plan.table.rows, mappingPayload(plan.mapping));
    const invalid = wizard.filter((r) => r.problems.length > 0);

    // The mapping is words, not column numbers: which heading was taken to
    // mean which property field.
    const expectedMapping: Record<string, string> = {};
    for (const [key, column] of Object.entries(mappingPayload(plan.mapping)))
      expectedMapping[IMPORT_KEY_LABEL[key as ImportKey]] = HEADER[column];
    expect(summary.mapping).toEqual(expectedMapping);
    expect(Object.keys(expectedMapping)).toHaveLength(HEADER.length);
    expect(summary.row_count).toBe(plan.table.rows.length);
    expect(summary.invalid_rows).toBe(invalid.length);
    expect(summary.valid_rows).toBe(plan.table.rows.length - invalid.length);
    expect(summary.duplicate_rows).toBe(
      invalid.filter((r) =>
        r.problems.some((p) => p.problem === 'repeated in this file')
      ).length
    );
    // The blank trailing row is reported as a count, never as a row.
    expect(summary.warnings.join(' ')).toContain('blank row was skipped');
  });
});

describe('who may import', () => {
  it('refuses an actor without programme.manage before anything is staged', async () => {
    stagingBackend();
    queries.programmeAccess.mockResolvedValue({
      read: true,
      readAll: true,
      submit: true,
      review: false,
      manage: false,
      report: false
    });
    const response = await POST(upload(CSV));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN');
    expect(backend.runCommand).not.toHaveBeenCalled();
  });

  it('refuses when there is no session', async () => {
    stagingBackend();
    auth.getCurrentUser.mockResolvedValue(null);
    const response = await POST(upload(CSV));
    expect(response.status).toBe(401);
    expect(backend.runCommand).not.toHaveBeenCalled();
  });

  it('refuses while the programmes module is switched off (FN-22)', async () => {
    stagingBackend();
    queries.programmesEnabled.mockResolvedValue(false);
    const response = await POST(upload(CSV));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('PROGRAMMES_NOT_ENABLED');
    expect(backend.runCommand).not.toHaveBeenCalled();
  });

  it('refuses a developer preview, which holds a real session', async () => {
    stagingBackend();
    guard.previewWriteBlock.mockResolvedValue('Preview is read-only.');
    const response = await POST(upload(CSV));
    expect(response.status).toBe(403);
    expect(backend.runCommand).not.toHaveBeenCalled();
  });

  it('asks which programme rather than guessing when several are open', async () => {
    stagingBackend();
    queries.listProgrammes.mockResolvedValue([
      { id: PROGRAMME_ID, name: 'PCH Meter SIM Replacement', status: 'Active' },
      {
        id: '2c3d4e5f-6071-4a8b-8c9d-0e1f2a3b4c5f',
        name: 'Another programme',
        status: 'Active'
      }
    ]);
    const response = await POST(upload(CSV));
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error.code).toBe('PROGRAMME_NOT_CHOSEN');
    expect(error.programmes).toHaveLength(2);
    expect(backend.runCommand).not.toHaveBeenCalled();
  });
});

describe('files that are not property lists', () => {
  it('leaves a CSV of something else alone, so it can still be read in chat', async () => {
    stagingBackend();
    const rota = 'Day,Installer\r\nMonday,Dan';
    const response = await POST(upload(rota, 'rota.csv'));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('NOT_A_PROPERTY_LIST');
    expect(backend.runCommand).not.toHaveBeenCalled();
  });

  it('refuses a spreadsheet binary by name: the pipeline parses CSV only', async () => {
    stagingBackend();
    const response = await POST(upload('irrelevant', 'properties.xlsx'));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('NOT_A_CSV');
    expect(backend.runCommand).not.toHaveBeenCalled();
  });
});

describe('what the model is given', () => {
  it('has no tool that accepts rows, cells or a file', () => {
    const surface = JSON.stringify(
      [...PROGRAMME_IMPORT_READ_TOOLS, ...PROGRAMME_IMPORT_MUTATION_TOOLS].map(
        (tool) => ({
          name: tool.name,
          description: tool.description,
          input: z.toJSONSchema(tool.inputSchema, { io: 'input' })
        })
      )
    );
    expect(surface).not.toContain('"rows"');
    expect(surface).not.toContain('"cells"');
    expect(surface).not.toContain('"file_contents"');
  });

  it('sends the bytes to the route and attaches only the summary', async () => {
    const summary = {
      import_id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      filename: 'dan-properties.csv',
      row_count: ROWS,
      valid_rows: ROWS - 3,
      invalid_rows: 3
    };
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(JSON.stringify({ ok: true, summary }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([CSV], 'dan-properties.csv', { type: 'text/csv' });
    const { attachments, rejected } = await readAttachments([file], 0, {
      programmeImport: { programmeId: PROGRAMME_ID }
    });

    expect(rejected).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect((init.body as FormData).get('file')).toBe(file);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].data).not.toContain('Sample Street');
    expect(attachments[0].data).toContain(summary.import_id);
    vi.unstubAllGlobals();
  });

  it('still reads an ordinary CSV in the message when it is not a property list', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'NOT_A_PROPERTY_LIST', message: 'not one' }
          }),
          { status: 422 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['Day,Installer\nMonday,Dan'], 'rota.csv', {
      type: 'text/csv'
    });
    const { attachments } = await readAttachments([file], 0, {
      programmeImport: {}
    });
    expect(attachments[0].data).toContain('Monday,Dan');
    vi.unstubAllGlobals();
  });

  /**
   * The real failure of 2026-09-25: a 1,468-row PCH property register whose
   * header was Address,Meter No,Sim Type,ICCID. It has no reference column, so
   * it was refused - and the refusal fell through to the ordinary reading path,
   * which put the whole register into the model request. The refusal now stops
   * there instead.
   */
  it('never reads a property list that was refused for having no reference', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: 'PROPERTY_LIST_NO_REF',
              message: 'no column giving each property its own reference'
            }
          }),
          { status: 422 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(
      [
        'Address,Meter No,Sim Type,ICCID\r\n' +
          '"9 Northampton Close, Plymouth, Devon PL5 4JT",EML1409032559,Velos,8944502106211700645'
      ],
      'DEC MET Meters.csv',
      { type: 'text/csv' }
    );
    const { attachments, rejected } = await readAttachments([file], 0, {
      programmeImport: {}
    });
    expect(attachments).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('reference');
    // The bytes must not have reached the message under any shape.
    expect(JSON.stringify(attachments)).not.toContain('Northampton');
    expect(JSON.stringify(attachments)).not.toContain('8944502106211700645');
    vi.unstubAllGlobals();
  });

  it('recognises the real PCH header once the programme is keyed by meter', () => {
    const plan = planImport(
      {
        filename: 'DEC MET Meters.csv',
        text:
          'Address,Meter No,Sim Type,ICCID\r\n' +
          '"9 Northampton Close, Plymouth, Devon PL5 4JT",EML1409032559,Velos,8944502106211700645'
      },
      { requireMapping: true, identityKey: 'expected_meter_serial' }
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Every column has a canonical destination; none is dropped or shoved into notes.
    expect(plan.mapping).toEqual({
      address_line1: 0,
      expected_meter_serial: 1,
      existing_sim_type: 2,
      existing_sim_serial: 3
    });
  });

  it('still refuses that header for a programme keyed by property reference', () => {
    const plan = planImport(
      {
        filename: 'DEC MET Meters.csv',
        text: 'Address,Meter No,Sim Type,ICCID\r\n"1 A Street, Plymouth PL1 1AA",EML1,Velos,894450'
      },
      { requireMapping: true, identityKey: 'external_ref' }
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('PROPERTY_LIST_NO_REF');
    expect(plan.message).toContain('reference');
  });

  it('does not touch the route at all for a caller that cannot import', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['Day,Installer\nMonday,Dan'], 'rota.csv', {
      type: 'text/csv'
    });
    const { attachments } = await readAttachments([file]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attachments).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

/**
 * Which column identifies a property is the TARGET PROGRAMME'S configuration,
 * not a universal rule. The same bytes are a property list for one programme
 * and not for another, and the detector has to say so.
 */
describe('recognition follows the programme, not a fixed column', () => {
  const PCH =
    'Address,Meter No,Sim Type,ICCID\r\nX,EML123,Velos,8944502106211700645';
  const REFERENCED = 'Property ID,Address,Meter No\r\nPCH123,X,EML123';

  it('accepts the PCH register for a programme keyed by meter, with no reference column', () => {
    const plan = planImport(
      { filename: 'DEC MET Meters.csv', text: PCH },
      { requireMapping: true, identityKey: 'expected_meter_serial' }
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mapping).toEqual({
      address_line1: 0,
      expected_meter_serial: 1,
      existing_sim_type: 2,
      existing_sim_serial: 3
    });
    expect(plan.mapping.external_ref).toBeUndefined();
  });

  it('refuses those same bytes for a programme keyed by property reference', () => {
    const plan = planImport(
      { filename: 'DEC MET Meters.csv', text: PCH },
      { requireMapping: true, identityKey: 'external_ref' }
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('PROPERTY_LIST_NO_REF');
  });

  it('accepts a file that does carry the reference for that programme', () => {
    const plan = planImport(
      { filename: 'register.csv', text: REFERENCED },
      { requireMapping: true, identityKey: 'external_ref' }
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mapping.external_ref).toBe(0);
  });
});

/**
 * The meter-reading export (PCH Dec Meters ful list): an unnamed numeric first
 * column, then Serial, Type, Location, Last read, Total. None of those headings
 * are recognised, so it used to take the fall-through path and be read into the
 * message - 1,445 rows of somebody's register in front of the model, with no
 * refusal shown to explain why nothing was staged.
 */
describe('a large CSV whose columns mean nothing to us', () => {
  const header = ',Serial,Type,Location,Last read,Total,\r\n';
  const row = (n: number) =>
    `${58000 + n},EML14090${n},MC,${n} Northampton Close Plymouth,2025-10-18T04:36:33.000Z,32992.3,Offline`;
  const big =
    header + Array.from({ length: 150 }, (_, i) => row(i)).join('\r\n');
  const small =
    header + Array.from({ length: 5 }, (_, i) => row(i)).join('\r\n');

  it('is refused rather than read, whichever field identifies the programme', () => {
    for (const identityKey of [
      'external_ref',
      'expected_meter_serial'
    ] as const) {
      const plan = planImport(
        { filename: 'readings.csv', text: big },
        { requireMapping: true, identityKey }
      );
      expect(plan.ok).toBe(false);
      if (plan.ok) return;
      expect(plan.code).toBe('UNRECOGNISED_CSV_TOO_LARGE');
      // It says how many rows and what the headings were, so the refusal is
      // actionable rather than a flat "no".
      expect(plan.message).toContain('150');
      expect(plan.message).toContain('Serial');
    }
  });

  it('never invents a reference out of an unnamed numeric column', () => {
    const plan = planImport(
      { filename: 'readings.csv', text: small },
      { requireMapping: false }
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mapping.external_ref).toBeUndefined();
    expect(plan.mapping).toEqual({});
  });

  it('still lets a small unrecognised table be read in chat', () => {
    const plan = planImport(
      { filename: 'rota.csv', text: 'Day,Installer\r\nMonday,Dan' },
      { requireMapping: true, identityKey: 'external_ref' }
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    // NOT_A_PROPERTY_LIST is the one code the caller may ignore and read anyway.
    expect(plan.code).toBe('NOT_A_PROPERTY_LIST');
  });
});
