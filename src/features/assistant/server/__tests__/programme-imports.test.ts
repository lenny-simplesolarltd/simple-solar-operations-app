import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The programme queries and the command runner are the seams: replacing them
 * shows exactly what the import tools ask of the application, and what they
 * refuse to ask. Nothing here touches a database.
 */
const queries = vi.hoisted(() => ({
  programmesEnabled: vi.fn(),
  getProgramme: vi.fn(),
  getImport: vi.fn(),
  listImports: vi.fn(),
  importRows: vi.fn()
}));
vi.mock('@/features/programmes/server/queries', () => queries);

const backend = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock('@/lib/backend/command', () => backend);

import type {
  ImportRow,
  ImportSummary,
  ProgrammeSummary
} from '@/features/programmes/types';
import { isPermitted, type MutationContext } from '../registry';
import {
  applyProgrammeImportTool,
  discardProgrammeImportTool,
  explainProgrammeImportTool,
  listProgrammeImportsTool
} from '../tools/programme-imports';
import { makeActor, THREAD } from './helpers';

const IMPORT_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PROGRAMME_ID = '1b2c3d4e-5f60-4a7b-8c8d-9e0f1a2b3c4e';
const COMMAND_ID = '2c3d4e5f-6071-4a8b-8c9d-0e1f2a3b4c5f';

const manager = makeActor({
  roles: ['Manager'],
  permissions: ['programme.manage', 'programme.read.all']
});
/** Office holds the reading permissions but not programme.manage. */
const office = makeActor({
  roles: ['Office'],
  permissions: ['programme.read', 'programme.read.all']
});

const programme: ProgrammeSummary = {
  id: PROGRAMME_ID,
  code: 'MTR-01',
  name: 'Meter SIM replacement',
  importIdentityKey: 'external_ref',
  clientName: 'A client',
  status: 'Active',
  startsOn: null,
  endsOn: null,
  visitFormId: null,
  signalConfig: {},
  propertyVisibility: 'Assigned',
  synthetic: false,
  notes: null,
  version: 3
};

const staged = (over: Partial<ImportSummary> = {}): ImportSummary => ({
  id: IMPORT_ID,
  programmeId: PROGRAMME_ID,
  filename: 'properties.csv',
  header: ['Property ID', 'Address 1', 'Postcode'],
  rowCount: 10,
  mapping: { external_ref: 0, address_line1: 1, postcode: 2 },
  status: 'Mapped',
  validRows: 8,
  invalidRows: 2,
  createdCount: null,
  updatedCount: null,
  appliedAt: null,
  createdAt: '2026-09-25T09:00:00Z',
  version: 4,
  ...over
});

const row = (
  rowIndex: number,
  action: ImportRow['action'],
  problems: ImportRow['problems'] = []
): ImportRow => ({
  rowIndex,
  cells: [`REF-${rowIndex}`, '1 High Street', 'AA1 1AA'],
  mapped: { external_ref: `REF-${rowIndex}`, address_line1: '1 High Street' },
  problems,
  action
});

const ctx = { actor: manager, threadId: THREAD };
const mutationCtx: MutationContext = {
  ...ctx,
  commandId: COMMAND_ID,
  expectedVersion: 4,
  initiatedVia: 'assistant'
};

beforeEach(() => {
  vi.clearAllMocks();
  queries.programmesEnabled.mockResolvedValue(true);
  queries.getProgramme.mockResolvedValue(programme);
  queries.getImport.mockResolvedValue(staged());
  queries.listImports.mockResolvedValue([staged()]);
  queries.importRows.mockResolvedValue([
    row(1, 'Create'),
    row(2, 'Create'),
    row(3, 'Update'),
    row(4, 'Invalid', [{ field: 'external_ref', problem: 'missing' }])
  ]);
  backend.runCommand.mockResolvedValue({
    ok: true,
    replayed: false,
    outcome: { status: 'Succeeded', heading: 'DONE', message: 'Imported.' },
    result: { created: 6, updated: 2, invalid_rows: 2 }
  });
});

describe('the import tools are for people who may manage a programme', () => {
  it('offers all four to a programme manager', () => {
    for (const tool of [
      listProgrammeImportsTool,
      explainProgrammeImportTool,
      applyProgrammeImportTool,
      discardProgrammeImportTool
    ]) {
      expect(tool.authorization.permissions).toEqual(['programme.manage']);
      expect(isPermitted(tool, manager)).toBe(true);
    }
  });

  it('refuses an actor without programme.manage, however they ask', () => {
    for (const tool of [
      listProgrammeImportsTool,
      explainProgrammeImportTool,
      applyProgrammeImportTool,
      discardProgrammeImportTool
    ]) {
      expect(isPermitted(tool, office)).toBe(false);
    }
  });
});

describe('explaining a staged import', () => {
  it('says what would be created, updated and skipped, and how the columns were read', async () => {
    const result = await explainProgrammeImportTool.execute(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as Record<string, unknown>;
    expect(data.can_be_imported).toBe(true);
    expect(data.would_create).toBe(2);
    expect(data.would_update).toBe(1);
    expect(data.would_skip).toBe(2);
    expect(data.column_mapping).toMatchObject({
      'Address line 1': 'Address 1'
    });
  });

  it('will not pretend to explain an import whose columns are not mapped', async () => {
    queries.getImport.mockResolvedValue(
      staged({
        status: 'Draft',
        mapping: null,
        validRows: null,
        invalidRows: null
      })
    );
    const result = await explainProgrammeImportTool.execute(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as Record<string, unknown>;
    expect(data.can_be_imported).toBe(false);
    expect(String(data.still_needed)).toMatch(/columns have not been mapped/i);
    // Nothing was read row by row, because nothing has been judged.
    expect(queries.importRows).not.toHaveBeenCalled();
  });

  it('summarises invalid rows by problem instead of listing them all', async () => {
    const invalid = Array.from({ length: 300 }, (_, i) =>
      row(i + 1, 'Invalid', [
        {
          field: 'external_ref',
          problem: i % 2 ? 'missing' : 'repeated in this file'
        }
      ])
    );
    queries.getImport.mockResolvedValue(
      staged({ rowCount: 300, validRows: 0, invalidRows: 300 })
    );
    queries.importRows.mockResolvedValue(invalid);

    const result = await explainProgrammeImportTool.execute(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const explained = (result.data as Record<string, unknown>)
      .invalid_rows_explained as {
      problems: {
        problem: string;
        rows_affected: number;
        examples: string[];
      }[];
    };
    // Two problem types, not 300 rows, and only a handful of examples each.
    expect(explained.problems).toHaveLength(2);
    expect(explained.problems.length).toBeLessThanOrEqual(8);
    for (const p of explained.problems) {
      expect(p.examples.length).toBeLessThanOrEqual(3);
      expect(p.rows_affected).toBe(150);
    }
    // The rows themselves never reach the model.
    expect(JSON.stringify(result.data)).not.toContain('1 High Street');
  });

  it('reads nothing when the programmes module is switched off', async () => {
    queries.programmesEnabled.mockResolvedValue(false);
    const result = await explainProgrammeImportTool.execute(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(result).toMatchObject({ ok: false, code: 'PROGRAMMES_NOT_ENABLED' });
  });
});

describe('applying an import', () => {
  it('refuses an import that has not been mapped and validated', async () => {
    queries.getImport.mockResolvedValue(
      staged({
        status: 'Draft',
        mapping: null,
        validRows: null,
        invalidRows: null
      })
    );
    const prepared = await applyProgrammeImportTool.prepare(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(prepared).toMatchObject({
      ok: false,
      code: 'PROGRAMME_IMPORT_NOT_MAPPED'
    });
    if (!prepared.ok) {
      expect(prepared.message).toMatch(/import screen/i);
    }
    expect(backend.runCommand).not.toHaveBeenCalled();
  });

  it('refuses an import that is already applied', async () => {
    queries.getImport.mockResolvedValue(staged({ status: 'Applied' }));
    const prepared = await applyProgrammeImportTool.prepare(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(prepared).toMatchObject({
      ok: false,
      code: 'PROGRAMME_IMPORT_ALREADY_APPLIED'
    });
  });

  it('states created, updated and invalid counts in the preview, and writes nothing', async () => {
    const prepared = await applyProgrammeImportTool.prepare(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const { changes, warnings, expectedVersion, summary } = prepared.preview;
    expect(changes).toEqual(
      expect.arrayContaining([
        { label: 'Properties created', to: '2' },
        { label: 'Properties updated', to: '1' },
        { label: 'Rows skipped (invalid)', to: '2' }
      ])
    );
    expect(summary).toMatch(/2 properties created, 1 updated, 2 skipped/);
    expect(warnings.some((w) => /no undo/i.test(w))).toBe(true);
    expect(warnings.some((w) => /skipped, not guessed at/i.test(w))).toBe(true);
    expect(expectedVersion).toBe(4);
    expect(backend.runCommand).not.toHaveBeenCalled();
  });

  it('warns when the created/updated split covers only part of a long file', async () => {
    queries.getImport.mockResolvedValue(
      staged({ rowCount: 5000, validRows: 4800, invalidRows: 200 })
    );
    const prepared = await applyProgrammeImportTool.prepare(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(
      prepared.preview.warnings.some((w) => /first 4 of 5000 rows/.test(w))
    ).toBe(true);
  });

  it('passes the confirmed action id as the command id, with the expected version', async () => {
    const result = await applyProgrammeImportTool.execute(
      { import_id: IMPORT_ID },
      mutationCtx
    );
    expect(backend.runCommand).toHaveBeenCalledWith({
      command_id: COMMAND_ID,
      command_type: 'PROGRAMME_IMPORT_APPLY',
      expected_version: 4,
      payload: { import_id: IMPORT_ID }
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        created_properties: 6,
        updated_properties: 2,
        skipped_invalid_rows: 2
      }
    });
  });

  it('refuses to import when no version was captured', async () => {
    const result = await applyProgrammeImportTool.execute(
      { import_id: IMPORT_ID },
      { ...mutationCtx, expectedVersion: null }
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'PROGRAMME_STALE_VERSION'
    });
    expect(backend.runCommand).not.toHaveBeenCalled();
  });
});

describe('discarding an import', () => {
  it('says that no property changes, and carries the version', async () => {
    const prepared = await discardProgrammeImportTool.prepare(
      { import_id: IMPORT_ID, reason: 'Wrong file' },
      ctx
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.preview.summary).toMatch(/No property is created, changed/);
    expect(prepared.preview.changes).toEqual(
      expect.arrayContaining([{ label: 'Reason', to: 'Wrong file' }])
    );
    expect(prepared.preview.expectedVersion).toBe(4);
  });

  it('refuses to discard an import that has already been applied', async () => {
    queries.getImport.mockResolvedValue(staged({ status: 'Applied' }));
    const prepared = await discardProgrammeImportTool.prepare(
      { import_id: IMPORT_ID },
      ctx
    );
    expect(prepared).toMatchObject({
      ok: false,
      code: 'PROGRAMME_IMPORT_ALREADY_APPLIED'
    });
  });

  it('passes the confirmed action id as the command id', async () => {
    await discardProgrammeImportTool.execute(
      { import_id: IMPORT_ID, reason: 'Wrong file' },
      mutationCtx
    );
    expect(backend.runCommand).toHaveBeenCalledWith({
      command_id: COMMAND_ID,
      command_type: 'PROGRAMME_IMPORT_DISCARD',
      expected_version: 4,
      payload: { import_id: IMPORT_ID, reason: 'Wrong file' }
    });
  });
});

describe('listing imports', () => {
  it('returns each import with its status and counts, and says where files are uploaded', async () => {
    const result = await listProgrammeImportsTool.execute(
      { programme_id: PROGRAMME_ID },
      ctx
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      total: number;
      note: string;
      imports: Record<string, unknown>[];
    };
    expect(data.total).toBe(1);
    expect(data.imports[0]).toMatchObject({
      import_id: IMPORT_ID,
      status: 'Mapped',
      rows_detected: 10,
      valid_rows: 8,
      invalid_rows: 2
    });
    expect(data.note).toMatch(/cannot stage a file from chat/i);
  });
});
