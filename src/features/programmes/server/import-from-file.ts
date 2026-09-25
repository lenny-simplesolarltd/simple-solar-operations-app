import 'server-only';

import { getCurrentUser } from '@/lib/auth';
import { previewWriteBlock } from '@/lib/preview/guard';
import { IMPORT_KEY_LABEL } from '../labels';
import type { ImportKey } from '../types';
import {
  addImportRowsAction,
  createImportAction,
  mapImportAction
} from './actions';
import {
  importChunks,
  mappingPayload,
  MAX_IMPORT_BYTES,
  planImport
} from './import-plan';
import {
  getImport,
  importRows,
  listProgrammes,
  programmeAccess,
  programmesEnabled
} from './queries';

/**
 * Staging a property list that arrived as a file, on the server.
 *
 * Why this exists: the import screen parses the file in the browser because
 * that is where the file is, and that is fine for a person sitting in front of
 * the screen. A file attached in SimpleBot has no such place to go. The chat
 * attachment path (features/assistant/lib/attachments.ts) reads a text file in
 * the browser and inlines it into the model request, capped at 200KB - so a
 * 1,400-row property list would arrive at the model truncated, and the model
 * would then be the thing "reading" somebody's property register. Retyped rows
 * from a language model are not an import.
 *
 * So the bytes come here instead. This module parses them with the SAME
 * parseCsv and the SAME column guesses the wizard uses (import-plan.ts), stages
 * them through the canonical PROGRAMME_IMPORT_CREATE / _ADD_ROWS / _MAP
 * commands, and hands back a BOUNDED summary - counts, column headings, the
 * mapping and the import id. No cell of anybody's data goes back to the caller,
 * and therefore none can reach the model. Applying stays where it was: the
 * existing apply_programme_import tool, behind a human confirmation.
 */

/** Columns listed back, so a 200-column file cannot bloat the summary. */
const MAX_COLUMNS_LISTED = 25;
/** Longest heading echoed back. Headings are labels, not data, but not unbounded. */
const MAX_HEADING = 60;
/** Distinct problem types described before the remainder is merely counted. */
const MAX_PROBLEM_TYPES = 6;
/** Warnings carried in the summary. */
const MAX_WARNINGS = 8;
/** Invalid rows read back to describe the problems and count duplicates. */
const ROW_SCAN_CAP = 2000;

export interface ProgrammeImportSummary {
  import_id: string;
  programme: { id: string; name: string };
  filename: string;
  /** Rows of data in the file, after completely blank rows were dropped. */
  row_count: number;
  columns: string[];
  columns_omitted: number;
  /** Which heading was taken to mean which property field. */
  mapping: Record<string, string>;
  valid_rows: number;
  invalid_rows: number;
  /** Invalid because the same property reference appears earlier in the file. */
  duplicate_rows: number;
  warnings: string[];
  status: string;
  record_version: number;
  next_step: string;
}

export type ProgrammeImportRefusal = {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** Offered when the file could be imported but nobody said into which programme. */
  programmes?: { id: string; name: string }[];
};

export type ProgrammeImportResult =
  | { ok: true; summary: ProgrammeImportSummary }
  | ProgrammeImportRefusal;

const refuse = (
  status: number,
  code: string,
  message: string,
  extra: Partial<ProgrammeImportRefusal> = {}
): ProgrammeImportRefusal => ({ ok: false, status, code, message, ...extra });

const trim = (value: string) =>
  value.length > MAX_HEADING ? `${value.slice(0, MAX_HEADING - 1)}…` : value;

export interface StageProgrammeImportInput {
  filename: string;
  /** The file's own bytes, decoded. Never seen by the model. */
  text: string;
  sizeBytes: number;
  /** Optional: which programme. Resolved from the actor's own programmes when absent. */
  programmeId?: string;
}

/**
 * Which programme the file belongs to. Named explicitly, or - when the person
 * has exactly one programme open - that one. Never guessed from the file's
 * contents, and never taken on trust: an id from the request is only accepted
 * if the session can already see that programme.
 */
async function resolveProgramme(
  programmeId: string | undefined
): Promise<
  { ok: true; programme: { id: string; name: string } } | ProgrammeImportRefusal
> {
  const programmes = await listProgrammes();
  if (programmeId) {
    const found = programmes.find((p) => p.id === programmeId);
    if (!found)
      return refuse(
        404,
        'PROGRAMME_NOT_FOUND',
        'No programme with that id is visible to the signed-in staff member.'
      );
    return { ok: true, programme: { id: found.id, name: found.name } };
  }
  const open = programmes.filter((p) => p.status !== 'Closed');
  if (open.length === 1)
    return { ok: true, programme: { id: open[0].id, name: open[0].name } };
  if (open.length === 0)
    return refuse(
      409,
      'NO_PROGRAMME',
      'There is no open programme to import this list into.'
    );
  return refuse(
    409,
    'PROGRAMME_NOT_CHOSEN',
    'Say which programme this list is for; nothing was staged.',
    { programmes: open.map((p) => ({ id: p.id, name: p.name })) }
  );
}

/**
 * Staged rows, read back from the database, described without quoting one.
 *
 * The database judged every row during PROGRAMME_IMPORT_MAP; this only counts
 * what it decided. Duplicates are not a separate state in the schema - a row
 * whose reference appears earlier in the same file is Invalid with the problem
 * "repeated in this file" - so the count is taken from the problems rather than
 * recomputed here, which would be a second opinion.
 */
async function describeProblems(importId: string, invalidRows: number) {
  if (invalidRows === 0) return { duplicates: 0, warnings: [] as string[] };
  const rows = await importRows(importId, {
    invalidOnly: true,
    limit: ROW_SCAN_CAP
  });
  let duplicates = 0;
  const counts = new Map<string, number>();
  for (const row of rows) {
    let duplicated = false;
    for (const problem of row.problems) {
      const key = `${IMPORT_KEY_LABEL[problem.field as ImportKey] ?? problem.field} ${problem.problem}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (problem.problem === 'repeated in this file') duplicated = true;
    }
    if (duplicated) duplicates += 1;
  }
  const ordered = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const warnings = ordered
    .slice(0, MAX_PROBLEM_TYPES)
    .map(([what, n]) => `${n} ${n === 1 ? 'row' : 'rows'}: ${what}.`);
  if (ordered.length > MAX_PROBLEM_TYPES)
    warnings.push(
      `${ordered.length - MAX_PROBLEM_TYPES} other kinds of problem were found.`
    );
  if (rows.length === ROW_SCAN_CAP)
    warnings.push(
      `Only the first ${ROW_SCAN_CAP} skipped rows were described; the counts above cover every row.`
    );
  return { duplicates, warnings };
}

export async function stageProgrammeImport(
  input: StageProgrammeImportInput
): Promise<ProgrammeImportResult> {
  const user = await getCurrentUser();
  if (!user)
    return refuse(
      401,
      'NOT_AUTHENTICATED',
      'Sign in to import a property list.'
    );

  // FN-22: the module gate comes before anything else, so a switched-off
  // programmes module cannot be reached sideways through chat.
  if (!(await programmesEnabled()))
    return refuse(
      403,
      'PROGRAMMES_NOT_ENABLED',
      'The programmes module is switched off, so property lists cannot be imported.'
    );

  // Authorisation from the session, never from the request. The PROGRAMME_IMPORT_*
  // commands check programme.manage again in the database; refusing here as well
  // means an Office, Installer or Surveyor upload is turned away before a single
  // row of somebody's property list is parsed, let alone staged.
  const access = await programmeAccess(user);
  if (!access.manage)
    return refuse(
      403,
      'FORBIDDEN',
      'Importing a property list needs programme management permission.'
    );

  const blocked = await previewWriteBlock();
  if (blocked) return refuse(403, 'PREVIEW_MODE_READ_ONLY', blocked);

  if (input.sizeBytes > MAX_IMPORT_BYTES)
    return refuse(
      413,
      'FILE_TOO_LARGE',
      'That file is larger than 20 MB. Split it and try again.'
    );

  // requireMapping: an upload from chat has nobody standing at the mapping step,
  // so a file whose headings do not read as a property reference and an address
  // is left alone rather than staged as an import nobody asked for.
  const plan = planImport(input, { requireMapping: true });
  if (!plan.ok) return refuse(422, plan.code, plan.message);

  const programme = await resolveProgramme(input.programmeId);
  if (!programme.ok) return programme;

  const importId = crypto.randomUUID();
  const created = await createImportAction(
    {
      importId,
      programmeId: programme.programme.id,
      filename: input.filename,
      header: plan.header
    },
    crypto.randomUUID()
  );
  if (!created.ok)
    return refuse(
      409,
      created.outcome.code ?? 'PROGRAMME_IMPORT_CREATE_FAILED',
      created.outcome.message
    );

  // Chunked exactly as the wizard chunks it: 1,400 rows in one request is both
  // a large body and an all-or-nothing failure, and the command is idempotent
  // per row index so a resent chunk cannot double a row.
  for (const chunk of importChunks(plan.table.rows)) {
    const added = await addImportRowsAction(
      { importId, fromIndex: chunk.fromIndex, rows: chunk.rows },
      crypto.randomUUID()
    );
    if (!added.ok)
      return refuse(
        409,
        added.outcome.code ?? 'PROGRAMME_IMPORT_ADD_ROWS_FAILED',
        added.outcome.message
      );
  }

  const createdResult = created.result as { version?: number } | undefined;
  const mapped = await mapImportAction(
    {
      importId,
      programmeId: programme.programme.id,
      mapping: mappingPayload(plan.mapping),
      expectedVersion: createdResult?.version ?? 1
    },
    crypto.randomUUID()
  );
  if (!mapped.ok)
    return refuse(
      409,
      mapped.outcome.code ?? 'PROGRAMME_IMPORT_MAP_FAILED',
      mapped.outcome.message
    );

  // The counts are read back from the import itself rather than from the map
  // result, so the summary says what the database holds, not what this function
  // believes it asked for.
  const summary = await getImport(importId);
  const mapResult = mapped.result as {
    valid_rows?: number;
    invalid_rows?: number;
    version?: number;
  };
  const validRows = summary?.validRows ?? mapResult.valid_rows ?? 0;
  const invalidRows = summary?.invalidRows ?? mapResult.invalid_rows ?? 0;
  const { duplicates, warnings } = await describeProblems(
    importId,
    invalidRows
  );

  const mappingWords: Record<string, string> = {};
  for (const [key, column] of Object.entries(mappingPayload(plan.mapping))) {
    mappingWords[IMPORT_KEY_LABEL[key as ImportKey] ?? key] = trim(
      plan.header[column] ?? `column ${column + 1}`
    );
  }

  return {
    ok: true,
    summary: {
      import_id: importId,
      programme: programme.programme,
      filename: input.filename,
      row_count: summary?.rowCount ?? plan.table.rows.length,
      columns: plan.header.slice(0, MAX_COLUMNS_LISTED).map(trim),
      columns_omitted: Math.max(0, plan.header.length - MAX_COLUMNS_LISTED),
      mapping: mappingWords,
      valid_rows: validRows,
      invalid_rows: invalidRows,
      duplicate_rows: duplicates,
      warnings: [...plan.notes, ...warnings].slice(0, MAX_WARNINGS),
      status: summary?.status ?? 'Mapped',
      record_version: summary?.version ?? mapResult.version ?? 1,
      next_step:
        'Nothing has been imported. Read the import with explain_programme_import, then apply it with apply_programme_import once a person confirms.'
    }
  };
}
