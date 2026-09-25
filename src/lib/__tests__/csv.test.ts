import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '../csv';

// The reader has to survive what real exports actually contain, and the writer
// has to produce a file that a spreadsheet opens without changing the data.

describe('parseCsv', () => {
  it('keeps columns positional, so a repeated header name loses nothing', () => {
    const table = parseCsv('Ref,Address,Ref\n1,High Street,2\n');
    expect(table.header).toEqual(['Ref', 'Address', 'Ref']);
    expect(table.rows).toEqual([['1', 'High Street', '2']]);
  });

  it('reads a newline inside a quoted field as part of the field', () => {
    const table = parseCsv('A,B\n"line one\nline two",x\n');
    expect(table.rows).toEqual([['line one\nline two', 'x']]);
  });

  it('reads an escaped quote', () => {
    expect(parseCsv('A\n"say ""hi"""\n').rows).toEqual([['say "hi"']]);
  });

  it('handles CRLF and a UTF-8 BOM', () => {
    const table = parseCsv('﻿A,B\r\n1,2\r\n');
    expect(table.header).toEqual(['A', 'B']);
    expect(table.rows).toEqual([['1', '2']]);
  });

  it('drops wholly blank rows and reports them', () => {
    const table = parseCsv('A,B\n1,2\n , \n3,4\n');
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ]);
    expect(table.blankRowsDropped).toBe(1);
  });

  it('reports a ragged row and pads it, rather than losing it', () => {
    const table = parseCsv('A,B,C\n1,2\n');
    expect(table.raggedRows).toEqual([{ row: 2, width: 2 }]);
    expect(table.rows).toEqual([['1', '2', '']]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual({
      header: [],
      rows: [],
      blankRowsDropped: 0,
      raggedRows: []
    });
  });

  it('round-trips what it writes', () => {
    const header = ['Ref', 'Notes'];
    const rows = [['A-1', 'has, a comma and a "quote"\nand a newline']];
    const table = parseCsv(toCsv(header, rows));
    expect(table.header).toEqual(header);
    expect(table.rows).toEqual(rows);
  });
});

describe('toCsv', () => {
  it('quotes only what needs it', () => {
    expect(toCsv(['a'], [['plain']])).toContain('plain');
    expect(toCsv(['a'], [['has,comma']])).toContain('"has,comma"');
  });

  it('renders nothing for null and undefined', () => {
    expect(
      toCsv(['a', 'b'], [[null, undefined]])
        .trimEnd()
        .endsWith(',')
    ).toBe(true);
  });

  it('never lets a cell become a spreadsheet formula', () => {
    // A value beginning =, +, - or @ is data, not a calculation to run.
    for (const value of ['=1+1', '+SUM(A1)', '-2', '@x']) {
      expect(toCsv(['a'], [[value]])).toContain(`'${value}`);
    }
  });

  it('starts with a BOM, so a spreadsheet reads it as UTF-8', () => {
    expect(toCsv(['a'], [['é']]).charCodeAt(0)).toBe(0xfeff);
  });
});
