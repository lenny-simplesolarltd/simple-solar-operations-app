/**
 * CSV: an RFC 4180 reader, and a writer for exports.
 *
 * Rows are kept POSITIONALLY. Real exports contain embedded newlines inside
 * quoted fields and repeated header names, so a split-on-comma reader loses
 * rows and a name-keyed reader loses columns: a header name is a label, the
 * column index is the identity.
 *
 * (The same reader exists in scripts/imports/historical-job-bookings/csv.ts,
 * where it was written for the one-off booking import. This is the version the
 * application uses; the script keeps its own copy so a completed import cannot
 * change behaviour when this one does.)
 */

export interface CsvTable {
  /** Header labels, in file order. Duplicates are preserved verbatim. */
  header: string[];
  /** Data rows, each padded or truncated to header.length. */
  rows: string[][];
  /** Rows dropped because every cell was blank. */
  blankRowsDropped: number;
  /** Rows whose raw width differed from the header's, by 1-based file row. */
  raggedRows: { row: number; width: number }[];
}

/** Parses CSV text into fields, honouring quotes, escaped quotes and CRLF. */
function parseFields(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

export function parseCsv(input: string): CsvTable {
  const raw = parseFields(input);
  if (raw.length === 0)
    return { header: [], rows: [], blankRowsDropped: 0, raggedRows: [] };

  const header = raw[0];
  const width = header.length;
  const rows: string[][] = [];
  const raggedRows: { row: number; width: number }[] = [];
  let blankRowsDropped = 0;

  raw.slice(1).forEach((r, index) => {
    if (r.every((cell) => cell.trim() === '')) {
      blankRowsDropped += 1;
      return;
    }
    if (r.length !== width)
      raggedRows.push({ row: index + 2, width: r.length });
    rows.push(Array.from({ length: width }, (_, c) => r[c] ?? ''));
  });

  return { header, rows, blankRowsDropped, raggedRows };
}

/**
 * One CSV cell. Quoted whenever it could otherwise change the file's shape, and
 * a leading =, +, - or @ is prefixed with an apostrophe so a spreadsheet shows
 * the text rather than treating it as a formula.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV file from a header and rows. Excel needs the BOM to read UTF-8. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly unknown[])[]
): string {
  const lines = [header.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
