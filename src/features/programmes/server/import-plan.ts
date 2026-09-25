// Reading a property list, before anything is staged.
//
// This is the ONE place that decides what a property file is: which file types
// are accepted, how big one may be, which column looks like which field, and
// what to say about blank or ragged rows. It has no imports from React, from
// Next or from the database, so the import screen (in the browser) and the
// assistant's upload route (on the server) can both use it.
//
// It exists because the same judgements were previously written inside
// import-wizard.tsx. A second caller would have meant a second copy of
// guessMapping, and two copies drift: the wizard would guess one column and the
// route another for the same file, and nobody would be able to say which was
// right. Nothing here is duplicated anywhere else.
//
// CSV only, deliberately. The import screen accepts `.csv,text/csv` and parses
// with parseCsv; a spreadsheet binary is not parsed anywhere in the
// application, so accepting one here would be a promise the pipeline cannot
// keep.

import { parseCsv, type CsvTable } from '@/lib/csv';
import { IMPORT_KEYS, IMPORT_KEY_REQUIRED, type ImportKey } from '../types';

/** What the file picker offers, and what an upload is checked against. */
export const IMPORT_FILE_ACCEPT = '.csv,text/csv';

/** Bigger than any property list seen so far, and small enough to parse in one go. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * Rows per PROGRAMME_IMPORT_ADD_ROWS call. Chunked so a 1,400-row file is not
 * one enormous request, and so a failure part-way through leaves the rows that
 * did arrive (the command is idempotent per (import_id, row_index), so the same
 * chunk sent twice cannot double a row).
 */
export const IMPORT_CHUNK = 200;

/**
 * True for a file the import pipeline can actually read. The extension is the
 * test, not the media type: a .csv dragged out of a spreadsheet arrives with an
 * empty or an Excel type more often than not.
 */
export function isImportFilename(name: string): boolean {
  return name.toLowerCase().endsWith('.csv');
}

/** A first offer at which column means what, from the header's wording. */
export function guessMapping(
  header: string[]
): Partial<Record<ImportKey, number>> {
  const patterns: [ImportKey, RegExp][] = [
    [
      'external_ref',
      /\b(pch|property|prop|uprn|asset)\b.*\b(id|ref|no|number)\b|^(id|ref|reference)$/i
    ],
    ['address_line1', /address\s*(line)?\s*1|^address$|^street/i],
    ['address_line2', /address\s*(line)?\s*2/i],
    ['town', /town|city|locality/i],
    ['postcode', /post\s*code|postal/i],
    [
      'expected_meter_serial',
      /meter.*(serial|msn|no|number)|(serial|msn).*meter/i
    ],
    ['existing_sim_serial', /sim.*(serial|iccid|no|number)|iccid/i],
    ['notes', /note|comment|remark/i]
  ];
  const out: Partial<Record<ImportKey, number>> = {};
  const taken = new Set<number>();
  for (const [key, pattern] of patterns) {
    const index = header.findIndex(
      (h, i) => !taken.has(i) && pattern.test(h.trim())
    );
    if (index >= 0) {
      out[key] = index;
      taken.add(index);
    }
  }
  return out;
}

/** Which required fields the mapping still has no column for. */
export function missingRequiredKeys(
  mapping: Partial<Record<ImportKey, number>>
): ImportKey[] {
  return IMPORT_KEY_REQUIRED.filter((k) => mapping[k] === undefined);
}

/**
 * What to tell a person about the file's shape before they map it. Counts and
 * row numbers only - never a cell, because these notes are shown in chat as
 * well as on the import screen.
 */
export function tableNotes(table: CsvTable): string[] {
  const said: string[] = [];
  if (table.blankRowsDropped)
    said.push(
      `${table.blankRowsDropped} completely blank ${table.blankRowsDropped === 1 ? 'row was' : 'rows were'} skipped.`
    );
  if (table.raggedRows.length)
    said.push(
      `${table.raggedRows.length} ${table.raggedRows.length === 1 ? 'row has' : 'rows have'} a different number of columns from the header (first: row ${table.raggedRows[0].row}). They were padded to the header's width; check them in the preview.`
    );
  return said;
}

export type ImportPlanRefusal =
  | 'FILE_TOO_LARGE'
  | 'NOT_A_CSV'
  | 'NO_ROWS'
  | 'TOO_MANY_COLUMNS'
  | 'NOT_A_PROPERTY_LIST';

export interface ImportPlan {
  table: CsvTable;
  header: string[];
  mapping: Partial<Record<ImportKey, number>>;
  notes: string[];
}

export type ImportPlanResult =
  | ({ ok: true } & ImportPlan)
  | { ok: false; code: ImportPlanRefusal; message: string };

/**
 * Parse a property list and work out what it means, or say why it cannot be
 * one. `requireMapping` is what separates the two callers: on the import screen
 * a person maps the columns by hand afterwards, so a file whose headings are
 * unfamiliar is still worth staging; an upload from chat has nobody to do that,
 * so it must recognise the required columns itself or be left alone.
 */
export function planImport(
  input: { filename: string; text: string; sizeBytes?: number },
  options: { requireMapping?: boolean } = {}
): ImportPlanResult {
  if ((input.sizeBytes ?? 0) > MAX_IMPORT_BYTES)
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: 'That file is larger than 20 MB. Split it and try again.'
    };
  if (!isImportFilename(input.filename))
    return {
      ok: false,
      code: 'NOT_A_CSV',
      message:
        'Property lists are imported as CSV. Save the sheet as CSV and attach that.'
    };

  const table = parseCsv(input.text);
  if (table.header.length === 0 || table.rows.length === 0)
    return {
      ok: false,
      code: 'NO_ROWS',
      message: 'That file has no header row or no data rows.'
    };
  // The command refuses a header outside 1..200 columns; saying so here avoids
  // creating an import that cannot then be given its rows.
  if (table.header.length > 200)
    return {
      ok: false,
      code: 'TOO_MANY_COLUMNS',
      message:
        'That file has more than 200 columns, which is not a property list.'
    };

  const mapping = guessMapping(table.header);
  if (options.requireMapping) {
    const missing = missingRequiredKeys(mapping);
    if (missing.length)
      return {
        ok: false,
        code: 'NOT_A_PROPERTY_LIST',
        message:
          'This file has no column that reads as a property reference and an address, so it was not treated as a property list.'
      };
  }
  return {
    ok: true,
    table,
    header: table.header,
    mapping,
    notes: tableNotes(table)
  };
}

/** The staged rows in ADD_ROWS chunks, each with the 1-based index it starts at. */
export function importChunks(
  rows: string[][],
  size: number = IMPORT_CHUNK
): { fromIndex: number; rows: string[][] }[] {
  const chunks: { fromIndex: number; rows: string[][] }[] = [];
  for (let i = 0; i < rows.length; i += size)
    chunks.push({ fromIndex: i + 1, rows: rows.slice(i, i + size) });
  return chunks;
}

/** The mapping as the command wants it: every chosen key, as a column number. */
export function mappingPayload(
  mapping: Partial<Record<ImportKey, number>>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of IMPORT_KEYS)
    if (mapping[key] !== undefined) out[key] = mapping[key] as number;
  return out;
}
