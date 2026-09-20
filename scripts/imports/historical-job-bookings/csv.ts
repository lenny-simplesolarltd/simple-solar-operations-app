/**
 * RFC 4180 CSV reader.
 *
 * The export contains embedded newlines inside quoted fields and repeated
 * header names, so a split-on-comma reader loses rows and a name-keyed reader
 * loses columns. Rows are therefore kept positional: a header name is a label,
 * the column index is the identity.
 */

export type CsvTable = {
  /** Header labels, in file order. Duplicates are preserved verbatim. */
  header: string[];
  /** Data rows, each padded/truncated to header.length. */
  rows: string[][];
  /** Rows that were dropped because every cell was blank. */
  blankRowsDropped: number;
  /** Rows whose raw width differed from the header width, by 1-based row number. */
  raggedRows: Array<{ row: number; width: number }>;
};

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
  if (raw.length === 0) {
    return { header: [], rows: [], blankRowsDropped: 0, raggedRows: [] };
  }

  const header = raw[0];
  const width = header.length;
  const rows: string[][] = [];
  const raggedRows: Array<{ row: number; width: number }> = [];
  let blankRowsDropped = 0;

  raw.slice(1).forEach((r, index) => {
    if (r.every((cell) => cell.trim() === '')) {
      blankRowsDropped += 1;
      return;
    }
    if (r.length !== width)
      raggedRows.push({ row: index + 2, width: r.length });
    const padded = Array.from({ length: width }, (_, c) => r[c] ?? '');
    rows.push(padded);
  });

  return { header, rows, blankRowsDropped, raggedRows };
}

/** Reads a cell by column index and trims it. Out-of-range reads give ''. */
export function cell(row: string[], index: number): string {
  return (row[index] ?? '').trim();
}
