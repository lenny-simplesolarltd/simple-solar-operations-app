import 'server-only';

import { IMPORT_KEY_LABEL } from '@/features/programmes/labels';
import {
  getImport,
  getProgramme,
  importRows,
  listImports,
  programmesEnabled
} from '@/features/programmes/server/queries';
import type {
  ImportKey,
  ImportRow,
  ImportSummary
} from '@/features/programmes/types';
import { runCommand } from '@/lib/backend/command';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ReadTool,
  ToolResult
} from '../registry';

/**
 * SimpleBot's property-import tools.
 *
 * These are adapters over the SAME pipeline the import screen uses: a file is
 * parsed and staged in the browser, the columns are mapped, the database judges
 * every row, and only then can the import be applied. The model gets three of
 * those steps to read and two to propose - it never gets a shortcut past the
 * validation, and it never supplies a row.
 *
 * Nothing here is programme-specific. An import is a file of properties against
 * a programme id; the meter-replacement programme is simply the first one.
 */

/**
 * Staging rows cannot come from chat.
 *
 * An attachment reaches the server as text the MODEL has read (and truncated at
 * MAX_ATTACHMENT_TEXT), and a spreadsheet is refused outright by
 * lib/attachments.ts. Staging from that text would mean the model retyping
 * somebody's property list - inventing rows with complete confidence. So there
 * is deliberately no tool for PROGRAMME_IMPORT_CREATE, _ADD_ROWS or _MAP: the
 * file is uploaded and mapped on the import screen, where the browser parses the
 * real bytes, and these tools take over from there.
 */
const UPLOAD_ROUTE =
  'Files are uploaded and their columns mapped on the programme import screen, ' +
  'which parses the file itself. SimpleBot cannot stage a file from chat.';

const ENFORCED =
  'programme.manage in the PROGRAMME_IMPORT_* commands (execute_command) and RLS on programme_imports';

/**
 * The registry's ToolDomain has no programmes member and the registry is owned
 * elsewhere; field programme work sits closest to installation. Change this to
 * 'programmes' when the union gains it.
 */
const DOMAIN = 'programmes' as const;

const uuid = z.uuid();

/** How many staged rows are read back to count Create against Update. */
const ROW_SCAN_CAP = 2000;
/** How many example rows the model is shown per problem type. */
const SAMPLE_ROWS = 3;
/** How many distinct problem types are described before the rest are counted. */
const MAX_PROBLEM_TYPES = 8;

const refuse = (code: string, message: string) => ({
  ok: false as const,
  code,
  message
});
const fail = (code: string, message: string): ToolResult => ({
  ok: false,
  code,
  message
});

const MODULE_OFF = refuse(
  'PROGRAMMES_NOT_ENABLED',
  'The programmes module is switched off, so imports cannot be read or applied.'
);

const NOT_FOUND = refuse(
  'PROGRAMME_IMPORT_NOT_FOUND',
  'No import with that id is visible to the signed-in staff member.'
);

const PROGRAMME_NOT_FOUND = refuse(
  'PROGRAMME_NOT_FOUND',
  'No programme with that id is visible to the signed-in staff member.'
);

// -- Shaping ----------------------------------------------------------------------------

const STATUS_NOTE: Record<ImportSummary['status'], string> = {
  Draft:
    'Staged, but the columns have not been mapped or the rows checked yet.',
  Mapped: 'Checked and waiting to be imported.',
  Applied: 'Imported.',
  Discarded: 'Discarded.'
};

const importForModel = (i: ImportSummary) => ({
  import_id: i.id,
  programme_id: i.programmeId,
  file: i.filename,
  status: i.status,
  status_means: STATUS_NOTE[i.status],
  rows_detected: i.rowCount,
  valid_rows: i.validRows,
  invalid_rows: i.invalidRows,
  created_properties: i.createdCount,
  updated_properties: i.updatedCount,
  applied_at: i.appliedAt,
  staged_at: i.createdAt,
  record_version: i.version
});

/** The mapping as words: which heading was taken to mean which property field. */
function mappingForModel(i: ImportSummary) {
  if (!i.mapping) return null;
  const out: Record<string, string> = {};
  for (const [key, column] of Object.entries(i.mapping)) {
    const label = IMPORT_KEY_LABEL[key as ImportKey] ?? key;
    out[label] = i.header[column] ?? `column ${column + 1}`;
  }
  return out;
}

interface RowCounts {
  create: number;
  update: number;
  invalid: number;
  /** False when the file is longer than ROW_SCAN_CAP, so the split is of the rows read. */
  complete: boolean;
  scanned: number;
}

/**
 * How many rows would be created and how many updated.
 *
 * The totals (valid, invalid) are the database's own counts on the import; only
 * the create/update SPLIT has to be counted over the rows, because nothing
 * stores it before the import runs. A file longer than the cap is reported as a
 * split of the rows read rather than quietly presented as the whole truth.
 */
async function countRows(i: ImportSummary): Promise<RowCounts> {
  const rows = await importRows(i.id, { limit: ROW_SCAN_CAP });
  const count = (action: ImportRow['action']) =>
    rows.filter((r) => r.action === action).length;
  return {
    create: count('Create'),
    update: count('Update'),
    invalid: i.invalidRows ?? count('Invalid'),
    complete: rows.length >= i.rowCount,
    scanned: rows.length
  };
}

/**
 * The invalid rows, summarised.
 *
 * Hundreds of rejected rows would drown the model (and the answer) in detail it
 * cannot use, so they are grouped by what is actually wrong with them, each
 * group carrying a count and a few examples. Bounded twice over: the number of
 * groups, and the examples per group.
 */
async function invalidSummary(importId: string) {
  const rows = await importRows(importId, {
    invalidOnly: true,
    limit: ROW_SCAN_CAP
  });
  const groups = new Map<string, { count: number; examples: string[] }>();
  for (const row of rows) {
    for (const problem of row.problems) {
      const label =
        IMPORT_KEY_LABEL[problem.field as ImportKey] ?? problem.field;
      const key = `${label}: ${problem.problem}`;
      const group = groups.get(key) ?? { count: 0, examples: [] };
      group.count += 1;
      if (group.examples.length < SAMPLE_ROWS) {
        // The row number and the client's reference are enough to find the row
        // in the file; the rest of the row is not the model's business.
        const ref = row.mapped?.external_ref;
        group.examples.push(
          ref ? `row ${row.rowIndex} (${ref})` : `row ${row.rowIndex}`
        );
      }
      groups.set(key, group);
    }
  }
  const sorted = Array.from(groups.entries()).sort(
    (a, b) => b[1].count - a[1].count
  );
  return {
    problems: sorted.slice(0, MAX_PROBLEM_TYPES).map(([problem, g]) => ({
      problem,
      rows_affected: g.count,
      examples: g.examples
    })),
    other_problem_types: Math.max(0, sorted.length - MAX_PROBLEM_TYPES),
    rows_examined: rows.length
  };
}

/** One import, with the programme it belongs to, or a refusal. */
async function locate(importId: string) {
  if (!(await programmesEnabled())) return MODULE_OFF;
  const summary = await getImport(importId);
  if (!summary) return NOT_FOUND;
  const programme = await getProgramme(summary.programmeId);
  return { ok: true as const, summary, programme };
}

// -- Reads ------------------------------------------------------------------------------

export const listProgrammeImportsTool: ReadTool<{ programme_id: string }> = {
  name: 'list_programme_imports',
  summary: 'List recent property imports for a programme',
  description:
    'List the recent property-list imports for one programme, newest first, with their status (staged, checked and waiting, imported), how many rows were detected, how many are valid or invalid, and what an applied import created and updated. Use it to find the import id to explain or apply.',
  domain: DOMAIN,
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    programme_id: uuid.describe('The programme whose imports to list')
  }),
  authorization: { permissions: ['programme.manage'], enforcedBy: ENFORCED },
  async execute({ programme_id }) {
    if (!(await programmesEnabled()))
      return fail(MODULE_OFF.code, MODULE_OFF.message);
    const programme = await getProgramme(programme_id);
    if (!programme)
      return fail(PROGRAMME_NOT_FOUND.code, PROGRAMME_NOT_FOUND.message);
    const imports = await listImports(programme_id);
    return {
      ok: true,
      data: {
        programme: programme.name,
        total: imports.length,
        note: UPLOAD_ROUTE,
        imports: imports.map(importForModel)
      }
    };
  }
};

export const explainProgrammeImportTool: ReadTool<{ import_id: string }> = {
  name: 'explain_programme_import',
  summary: 'Explain what a staged import would do, before it is applied',
  description:
    'Read ONE staged import and say exactly what importing it would do: how many rows were detected, how many are valid, how many properties would be created and how many updated, which spreadsheet column was taken to mean which property field, and what is wrong with the invalid rows - grouped by problem with a few example row numbers, never the whole list. Always call this before proposing to apply an import.',
  domain: DOMAIN,
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ import_id: uuid }),
  authorization: { permissions: ['programme.manage'], enforcedBy: ENFORCED },
  async execute({ import_id }) {
    const located = await locate(import_id);
    if (!located.ok) return fail(located.code, located.message);
    const { summary, programme } = located;

    // An unmapped import has been judged by nobody: there is nothing to explain
    // beyond what is still needed of it.
    if (summary.status === 'Draft') {
      return {
        ok: true,
        data: {
          ...importForModel(summary),
          programme: programme?.name ?? null,
          can_be_imported: false,
          still_needed:
            'The columns have not been mapped, so no row has been checked. Map the columns on the import screen; the rows are then validated and this can say what importing would do.',
          note: UPLOAD_ROUTE
        }
      };
    }

    const counts =
      summary.status === 'Mapped' ? await countRows(summary) : null;
    const invalid =
      (summary.invalidRows ?? 0) > 0 ? await invalidSummary(summary.id) : null;

    return {
      ok: true,
      data: {
        ...importForModel(summary),
        programme: programme?.name ?? null,
        column_mapping: mappingForModel(summary),
        can_be_imported: summary.status === 'Mapped',
        ...(counts && {
          would_create: counts.create,
          would_update: counts.update,
          would_skip: counts.invalid,
          counts_cover: counts.complete
            ? 'every staged row'
            : `the first ${counts.scanned} of ${summary.rowCount} staged rows; the valid and invalid totals are exact`
        }),
        ...(invalid && { invalid_rows_explained: invalid }),
        note: 'Invalid rows are skipped, never guessed at. Fixing them and importing the file again updates what is already there.'
      }
    };
  }
};

// -- Mutations --------------------------------------------------------------------------

/** Why this import cannot be applied, in the words the staff member needs. */
function applyBlocked(summary: ImportSummary) {
  if (summary.status === 'Draft') {
    return refuse(
      'PROGRAMME_IMPORT_NOT_MAPPED',
      `This import is staged but its columns have not been mapped, so no row has been checked. Nothing can be imported until that is done. ${UPLOAD_ROUTE}`
    );
  }
  if (summary.status === 'Applied') {
    return refuse(
      'PROGRAMME_IMPORT_ALREADY_APPLIED',
      'This import has already been applied.'
    );
  }
  if (summary.status === 'Discarded') {
    return refuse(
      'PROGRAMME_IMPORT_DISCARDED',
      'This import was discarded. Upload the file again on the import screen.'
    );
  }
  if ((summary.validRows ?? 0) === 0) {
    return refuse(
      'PROGRAMME_IMPORT_NO_VALID_ROWS',
      'Every row in this import has a problem, so importing it would change nothing. Fix the file and upload it again.'
    );
  }
  return null;
}

export const applyProgrammeImportTool: MutationTool<{ import_id: string }> = {
  name: 'apply_programme_import',
  summary: 'Import the valid rows of a checked property import',
  description:
    'Prepare importing a property list that has already been staged, mapped and checked: valid rows create or update properties, invalid rows are skipped. The staff member sees how many would be created, updated and skipped and confirms before anything is written. An import that has not been mapped and checked cannot be applied - say what is still needed instead. Call explain_programme_import first.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({ import_id: uuid }),
  authorization: { permissions: ['programme.manage'], enforcedBy: ENFORCED },

  async prepare({ import_id }) {
    const located = await locate(import_id);
    if (!located.ok) return located;
    const { summary, programme } = located;
    const blocked = applyBlocked(summary);
    if (blocked) return blocked;

    const counts = await countRows(summary);
    const changes: ActionPreview['changes'] = [
      { label: 'File', to: `${summary.filename} (${summary.rowCount} rows)` },
      { label: 'Programme', to: programme?.name ?? summary.programmeId },
      { label: 'Properties created', to: String(counts.create) },
      { label: 'Properties updated', to: String(counts.update) },
      { label: 'Rows skipped (invalid)', to: String(counts.invalid) }
    ];
    const mapping = mappingForModel(summary);
    if (mapping) {
      for (const [field, column] of Object.entries(mapping)) {
        changes.push({ label: field, to: `column "${column}"` });
      }
    }

    const warnings = [
      'This changes many properties at once and there is no undo: updated properties keep the imported details.'
    ];
    if (counts.invalid > 0) {
      warnings.push(
        `${counts.invalid} ${counts.invalid === 1 ? 'row is' : 'rows are'} invalid and will be skipped, not guessed at.`
      );
    }
    if (!counts.complete) {
      // Be explicit that the split was counted over part of the file rather than
      // presenting a number that looks exact and is not.
      warnings.push(
        `Created and updated were counted over the first ${counts.scanned} of ${summary.rowCount} rows. In total ${summary.validRows ?? 0} valid rows will be imported.`
      );
    }

    return {
      ok: true,
      preview: {
        title: `Import ${summary.validRows ?? counts.create + counts.update} properties from ${summary.filename}`,
        summary: `${counts.create} properties created, ${counts.update} updated, ${counts.invalid} skipped${programme ? ` in ${programme.name}` : ''}.`,
        changes,
        warnings,
        confirmLabel: 'Import the valid rows',
        expectedVersion: summary.version
      }
    };
  },

  async execute({ import_id }, ctx: MutationContext) {
    // The version was captured when this was proposed. Without it the command
    // cannot tell an approved import from one that has changed since, so this
    // refuses rather than importing whatever is there now.
    if (ctx.expectedVersion == null) {
      return fail(
        'PROGRAMME_STALE_VERSION',
        'This import has changed since it was proposed. Read it again and confirm the new figures.'
      );
    }
    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'PROGRAMME_IMPORT_APPLY',
      expected_version: ctx.expectedVersion,
      payload: { import_id }
    });
    if (!response.ok) {
      return fail(
        response.outcome.code ?? 'COMMAND_FAILED',
        response.outcome.message
      );
    }
    const result = response.result as {
      created?: number;
      updated?: number;
      invalid_rows?: number;
    };
    return {
      ok: true,
      data: {
        import_id,
        created_properties: result.created ?? 0,
        updated_properties: result.updated ?? 0,
        skipped_invalid_rows: result.invalid_rows ?? 0,
        note: 'Skipped rows can be fixed and the file imported again; rows already imported are updated rather than duplicated.'
      }
    };
  }
};

export const discardProgrammeImportTool: MutationTool<{
  import_id: string;
  reason?: string;
}> = {
  name: 'discard_programme_import',
  summary: 'Discard a staged property import',
  description:
    'Prepare discarding a staged import so its rows are thrown away and it stops appearing as outstanding. No property is created, changed or removed by this. An import that has already been applied cannot be discarded.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    import_id: uuid,
    reason: z.string().trim().max(500).optional().describe('Why, if they said')
  }),
  authorization: { permissions: ['programme.manage'], enforcedBy: ENFORCED },

  async prepare({ import_id, reason }) {
    const located = await locate(import_id);
    if (!located.ok) return located;
    const { summary, programme } = located;
    if (summary.status === 'Applied') {
      return refuse(
        'PROGRAMME_IMPORT_ALREADY_APPLIED',
        'This import has already been applied and cannot be discarded.'
      );
    }
    if (summary.status === 'Discarded') {
      return refuse(
        'PROGRAMME_IMPORT_DISCARDED',
        'This import has already been discarded.'
      );
    }
    return {
      ok: true,
      preview: {
        title: `Discard the import of ${summary.filename}`,
        summary:
          'The staged rows are thrown away. No property is created, changed or removed.',
        changes: [
          {
            label: 'File',
            to: `${summary.filename} (${summary.rowCount} rows)`
          },
          { label: 'Programme', to: programme?.name ?? summary.programmeId },
          { label: 'Status', from: summary.status, to: 'Discarded' },
          ...(reason ? [{ label: 'Reason', to: reason }] : [])
        ],
        warnings: [
          'The staged rows cannot be recovered; the file would have to be uploaded again.'
        ],
        confirmLabel: 'Discard the import',
        expectedVersion: summary.version
      }
    };
  },

  async execute({ import_id, reason }, ctx: MutationContext) {
    if (ctx.expectedVersion == null) {
      return fail(
        'PROGRAMME_STALE_VERSION',
        'This import has changed since it was proposed. Read it again and confirm.'
      );
    }
    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'PROGRAMME_IMPORT_DISCARD',
      expected_version: ctx.expectedVersion,
      payload: { import_id, ...(reason ? { reason } : {}) }
    });
    if (!response.ok) {
      return fail(
        response.outcome.code ?? 'COMMAND_FAILED',
        response.outcome.message
      );
    }
    return {
      ok: true,
      data: {
        import_id,
        status: 'Discarded',
        note: 'The staged rows were thrown away. No property was changed.'
      }
    };
  }
};

export const PROGRAMME_IMPORT_READ_TOOLS = [
  listProgrammeImportsTool,
  explainProgrammeImportTool
];

export const PROGRAMME_IMPORT_MUTATION_TOOLS = [
  applyProgrammeImportTool,
  discardProgrammeImportTool
];

export const PROGRAMME_IMPORT_TOOL_LABELS: Record<string, string> = {
  list_programme_imports: 'Reading property imports',
  explain_programme_import: 'Reading the staged import',
  apply_programme_import: 'Preparing the import',
  discard_programme_import: 'Preparing to discard the import'
};
