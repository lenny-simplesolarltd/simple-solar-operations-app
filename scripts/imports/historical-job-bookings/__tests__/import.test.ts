/**
 * Tests for the historical Job Booking importer.
 *
 * Every fixture here is synthetic. No value is copied from the real export:
 * the names, addresses, postcodes and emails below are invented, and the tests
 * that need realistic shapes build them rather than quoting them.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { parseCsv, cell } from '../csv';
import {
  parsePostcode,
  parseEmail,
  parseMoneyPence,
  parseBoolean,
  parseInteger,
  parseList,
  parseWorkDate,
  parseSubmissionTimestamp,
  parseScaffoldCompany,
  eraForSubmission,
  nameKey,
  normaliseSpace
} from '../normalise';
import {
  COLUMNS,
  EXPECTED_COLUMN_COUNT,
  verifyRegistry,
  GENERATION_PAIRS
} from '../columns';
import { matchPerson, matchJob, isUsablePerson } from '../match';
import { parseStaffSeed, type Directory } from '../directory';
import { transformRow, SOURCE_FORM_ID } from '../transform';
import { validate, FORBIDDEN_TABLES } from '../validate';
import { resolveIdentities } from '../identity';
import {
  maskEmail,
  maskPostcode,
  maskName,
  scrubFreeText,
  token
} from '../redact';

const ROOT = path.resolve(__dirname, '../../../..');

// --- Synthetic directory -----------------------------------------------------

const PEOPLE = [
  {
    legacyId: 'PERSON-a',
    email: 'ada@example.test',
    displayName: 'Ada Bell',
    active: true
  },
  {
    legacyId: 'PERSON-b',
    email: 'bob@example.test',
    displayName: 'Bob Carr',
    active: true
  },
  {
    legacyId: 'PERSON-c',
    email: 'bob2@example.test',
    displayName: 'Bob Dunn',
    active: true
  },
  {
    legacyId: 'PERSON-d',
    email: 'zed@example.test',
    displayName: 'Zed Bell',
    active: false
  },
  {
    legacyId: 'PERSON-info',
    email: 'info@example.test',
    displayName: 'Shared Inbox',
    active: true
  }
];

const emptyDirectory: Directory = {
  people: PEOPLE,
  companies: [],
  jobs: [],
  intakeKeys: [],
  source: 'staff-seed',
  jobsAuthoritative: false,
  salt: null
};

/** Builds a 94-wide row with only the named columns set. */
function row(values: Record<number, string>): string[] {
  return Array.from(
    { length: EXPECTED_COLUMN_COUNT },
    (_, i) => values[i] ?? ''
  );
}

/** A row that satisfies every NOT NULL the schema imposes. */
function completeRow(overrides: Record<number, string> = {}): string[] {
  return row({
    1: '1 Test Lane',
    2: 'Testville',
    6: 'customer@example.test',
    37: '01000 000000',
    28: '12000',
    41: '2025-03-07 9:48:24',
    47: 'Ada Bell',
    56: 'No',
    61: 'ZZ1 1ZZ',
    62: 'Pat',
    63: 'Quinn',
    92: 'SUB-0001',
    ...overrides
  });
}

// --- CSV parsing -------------------------------------------------------------

describe('csv parsing', () => {
  it('keeps embedded newlines inside quoted fields', () => {
    const table = parseCsv('a,b\n"one\ntwo",three\n');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0][0]).toBe('one\ntwo');
    expect(table.rows[0][1]).toBe('three');
  });

  it('unescapes doubled quotes and handles CRLF', () => {
    const table = parseCsv('a,b\r\n"say ""hi""",2\r\n');
    expect(table.rows[0][0]).toBe('say "hi"');
    expect(table.rows[0][1]).toBe('2');
  });

  it('strips a byte order mark from the first header', () => {
    expect(parseCsv('﻿a,b\n1,2\n').header[0]).toBe('a');
  });

  it('drops wholly blank rows and reports the count', () => {
    const table = parseCsv('a,b\n1,2\n,\n3,4\n');
    expect(table.rows).toHaveLength(2);
    expect(table.blankRowsDropped).toBe(1);
  });

  it('pads short rows so a blank trailing cell is never a missing column', () => {
    const table = parseCsv('a,b,c\n1\n');
    expect(table.rows[0]).toEqual(['1', '', '']);
    expect(table.raggedRows).toEqual([{ row: 2, width: 1 }]);
  });

  it('addresses duplicate header labels positionally, not by name', () => {
    const table = parseCsv('dup,dup\nleft,right\n');
    expect(table.header).toEqual(['dup', 'dup']);
    expect(cell(table.rows[0], 0)).toBe('left');
    expect(cell(table.rows[0], 1)).toBe('right');
  });
});

// --- Column registry ---------------------------------------------------------

describe('column registry', () => {
  it('describes every column exactly once', () => {
    expect(COLUMNS).toHaveLength(EXPECTED_COLUMN_COUNT);
    expect(new Set(COLUMNS.map((c) => c.index)).size).toBe(
      EXPECTED_COLUMN_COUNT
    );
  });

  it('gives every column a disposition, so none can silently disappear', () => {
    for (const c of COLUMNS) {
      expect(['IMPORT', 'PRESERVE_ONLY', 'IGNORE']).toContain(c.disposition);
      if (c.disposition !== 'IMPORT') {
        expect(
          c.noDestinationReason,
          `column ${c.index} needs a reason`
        ).toBeTruthy();
      }
    }
  });

  it('rejects a file whose shape does not match the registry', () => {
    expect(verifyRegistry(['wrong'])).not.toHaveLength(0);
  });

  it('matches the real export header when it is present', () => {
    const source = path.join(
      ROOT,
      'data-import/historical-job-bookings/source/job-booking-form-responses.csv'
    );
    let text: string;
    try {
      text = readFileSync(source, 'utf8');
    } catch {
      return; // The source file is never committed; skip when absent.
    }
    expect(verifyRegistry(parseCsv(text).header)).toEqual([]);
  });

  it('prefers the later generation in every generation pair', () => {
    for (const pair of GENERATION_PAIRS) {
      expect(pair.primary).not.toBe(pair.fallback);
    }
  });
});

// --- Normalisers -------------------------------------------------------------

describe('postcode', () => {
  it('reformats to the shape the schema check requires', () => {
    expect(parsePostcode('zz11zz')).toMatchObject({
      ok: true,
      value: 'ZZ1 1ZZ'
    });
    expect(parsePostcode('ZZ9 9ZZ')).toMatchObject({
      ok: true,
      value: 'ZZ9 9ZZ'
    });
    // The inward code is always three characters, so re-spacing is determinate.
    expect(parsePostcode('  zz2  2zz  ')).toMatchObject({
      ok: true,
      value: 'ZZ2 2ZZ'
    });
  });

  it('refuses anything the schema would reject rather than storing it', () => {
    expect(parsePostcode('not a postcode').ok).toBe(false);
    expect(parsePostcode('').ok).toBe(false);
  });
});

describe('money', () => {
  it('converts pounds to pence', () => {
    expect(parseMoneyPence('£12,345.67')).toMatchObject({
      ok: true,
      value: 1234567
    });
    expect(parseMoneyPence('9000')).toMatchObject({ ok: true, value: 900000 });
  });

  it('refuses zero, because jobs.original_gross_pence must be > 0', () => {
    expect(parseMoneyPence('0').ok).toBe(false);
    expect(parseMoneyPence('tbc').ok).toBe(false);
  });
});

describe('booleans and lists', () => {
  it('reads the yes/no and 1/0 forms the export uses', () => {
    expect(parseBoolean('Yes')).toMatchObject({ ok: true, value: true });
    expect(parseBoolean('no')).toMatchObject({ ok: true, value: false });
    expect(parseBoolean('1')).toMatchObject({ ok: true, value: true });
  });

  it('refuses "Not sure" instead of forcing it to false', () => {
    expect(parseBoolean('Not sure').ok).toBe(false);
  });

  it('splits newline multi-selects and drops blank entries', () => {
    expect(parseList('One\n\nTwo\n')).toEqual(['One', 'Two']);
  });
});

describe('blank handling', () => {
  it('treats blanks as absent, never as a value', () => {
    expect(parseInteger('').ok).toBe(false);
    expect(parseEmail('   ').ok).toBe(false);
    expect(parseList('')).toEqual([]);
    expect(parseScaffoldCompany('')).toEqual({ kind: 'blank' });
  });
});

// --- Dates -------------------------------------------------------------------

describe('date era', () => {
  it('splits the eras at the changeover submission date', () => {
    expect(eraForSubmission('2025-08-20T00:00:00.000Z')).toBe('month-first');
    expect(eraForSubmission('2025-08-21T00:00:00.000Z')).toBe('day-first');
    expect(eraForSubmission(null)).toBeNull();
  });

  it('reads an ambiguous value using the row era', () => {
    expect(parseWorkDate('05-06-2025', 'month-first')).toMatchObject({
      ok: true,
      value: { iso: '2025-05-06' }
    });
    expect(parseWorkDate('05-06-2025', 'day-first')).toMatchObject({
      ok: true,
      value: { iso: '2025-06-05' }
    });
  });

  it('lets a self-evident value override the era, and says so', () => {
    const parsed = parseWorkDate('17-09-2025', 'month-first');
    expect(parsed).toMatchObject({
      ok: true,
      value: { iso: '2025-09-17', selfEvident: true, contradictsEra: true }
    });
  });

  it('refuses an ambiguous value when the era is unknown', () => {
    expect(parseWorkDate('05-06-2025', null).ok).toBe(false);
  });

  it('refuses impossible dates under either reading', () => {
    expect(parseWorkDate('31-31-2025', 'day-first').ok).toBe(false);
    expect(parseWorkDate('02-30-2025', 'month-first').ok).toBe(false);
    expect(parseWorkDate('13-13-2025', null).ok).toBe(false);
  });

  it('accepts all three submission timestamp generations', () => {
    expect(parseSubmissionTimestamp('24-Feb-2025')).toMatchObject({
      ok: true,
      value: '2025-02-24T00:00:00.000Z'
    });
    expect(parseSubmissionTimestamp('3-Mar-2025')).toMatchObject({
      ok: true,
      value: '2025-03-03T00:00:00.000Z'
    });
    expect(parseSubmissionTimestamp('2025-03-07 9:48:24')).toMatchObject({
      ok: true,
      value: '2025-03-07T09:48:24.000Z'
    });
    expect(parseSubmissionTimestamp('nonsense').ok).toBe(false);
  });
});

// --- People ------------------------------------------------------------------

describe('person matching', () => {
  it('normalises whitespace and case before comparing', () => {
    expect(nameKey('  ADA   bell ')).toBe('ada bell');
    expect(normaliseSpace(' a  b ')).toBe('a b');
  });

  it('matches an exact display name', () => {
    const m = matchPerson('  ada bell ', PEOPLE);
    expect(m.kind).toBe('EXACT_MATCH');
    expect(m.legacyId).toBe('PERSON-a');
  });

  it('matches a unique first name as a safe normalised match', () => {
    expect(matchPerson('Ada', PEOPLE)).toMatchObject({
      kind: 'SAFE_NORMALISED_MATCH',
      legacyId: 'PERSON-a'
    });
  });

  it('refuses a first name shared by two active people', () => {
    const m = matchPerson('Bob', PEOPLE);
    expect(m.kind).toBe('AMBIGUOUS');
    expect(m.candidates).toEqual(['Bob Carr', 'Bob Dunn']);
    expect(isUsablePerson(m)).toBe(false);
  });

  it('refuses a bare surname rather than guessing who was meant', () => {
    expect(matchPerson('Carr', PEOPLE).kind).toBe('AMBIGUOUS');
  });

  it('never matches the shared inbox identity', () => {
    expect(matchPerson('info@example.test', PEOPLE).kind).toBe('NO_MATCH');
  });

  it('ignores inactive people', () => {
    expect(matchPerson('Zed', PEOPLE).kind).toBe('NO_MATCH');
  });

  it('classifies placeholders as non-person values', () => {
    expect(matchPerson('N/A', PEOPLE).kind).toBe('NON_PERSON_VALUE');
    expect(matchPerson('TBC', PEOPLE).kind).toBe('NON_PERSON_VALUE');
  });

  it('reads the real staff seed without inventing rows', () => {
    const sql = readFileSync(
      path.join(ROOT, 'supabase/seeds/001_staff.sql'),
      'utf8'
    );
    const people = parseStaffSeed(sql);
    expect(people.length).toBeGreaterThan(10);
    expect(people.every((p) => p.displayName.trim() !== '')).toBe(true);
  });
});

// --- Job deduplication -------------------------------------------------------

describe('job matching', () => {
  const directory: Directory = {
    ...emptyDirectory,
    jobsAuthoritative: true,
    jobs: [
      {
        jobRef: 'SS-ABCD-0001',
        customerPostcode: 'ZZ1 1ZZ',
        customerEmail: 'one@example.test',
        customerLastName: 'Quinn',
        soldAt: '2025-03-01T00:00:00.000Z'
      },
      {
        jobRef: 'SS-ABCD-0002',
        customerPostcode: 'ZZ1 1ZZ',
        customerEmail: 'two@example.test',
        customerLastName: 'Quinn',
        soldAt: '2025-03-02T00:00:00.000Z'
      },
      {
        jobRef: 'SS-ABCD-0003',
        customerPostcode: 'ZZ9 9ZZ',
        customerEmail: null,
        customerLastName: 'Reed',
        soldAt: '2025-04-01T00:00:00.000Z'
      }
    ],
    intakeKeys: [`${SOURCE_FORM_ID}:SEEN-1`]
  };

  const signals = (over: Partial<Parameters<typeof matchJob>[0]> = {}) => ({
    intakeKey: `${SOURCE_FORM_ID}:NEW-1`,
    postcode: null,
    email: null,
    lastName: null,
    soldAt: null,
    ...over
  });

  it('treats an already-recorded submission as a replay', () => {
    expect(
      matchJob(signals({ intakeKey: `${SOURCE_FORM_ID}:SEEN-1` }), directory)
        .kind
    ).toBe('ALREADY_IMPORTED');
  });

  it('matches exactly on customer email', () => {
    expect(
      matchJob(signals({ email: 'one@example.test' }), directory)
    ).toMatchObject({
      kind: 'EXACT_EXISTING_JOB',
      jobRef: 'SS-ABCD-0001'
    });
  });

  it('calls postcode plus surname plus a near sale date probable, not exact', () => {
    expect(
      matchJob(
        signals({
          postcode: 'ZZ9 9ZZ',
          lastName: 'Reed',
          soldAt: '2025-04-10T00:00:00.000Z'
        }),
        directory
      )
    ).toMatchObject({ kind: 'PROBABLE_EXISTING_JOB', jobRef: 'SS-ABCD-0003' });
  });

  it('refuses when two existing jobs share the postcode and surname', () => {
    const m = matchJob(
      signals({
        postcode: 'ZZ1 1ZZ',
        lastName: 'Quinn',
        soldAt: '2025-03-01T00:00:00.000Z'
      }),
      directory
    );
    expect(m.kind).toBe('AMBIGUOUS');
    expect(m.candidates).toHaveLength(2);
  });

  it('never matches on customer name alone', () => {
    expect(matchJob(signals({ lastName: 'Reed' }), directory).kind).toBe(
      'NEW_HISTORICAL_JOB'
    );
  });

  it('does not match when the sale dates are far apart', () => {
    expect(
      matchJob(
        signals({
          postcode: 'ZZ9 9ZZ',
          lastName: 'Reed',
          soldAt: '2026-04-01T00:00:00.000Z'
        }),
        directory
      ).kind
    ).toBe('NEW_HISTORICAL_JOB');
  });

  it('is idempotent: the same submission id resolves the same way twice', () => {
    const s = signals({ intakeKey: `${SOURCE_FORM_ID}:SEEN-1` });
    expect(matchJob(s, directory).kind).toBe(matchJob(s, directory).kind);
  });
});

// --- Transformation ----------------------------------------------------------

describe('transform', () => {
  const build = (values: Record<number, string>) =>
    transformRow(row(values), 1, emptyDirectory, 'batch-test');

  it('derives the idempotency key from the submission id', () => {
    const c = build({ 92: 'SUB-42' });
    expect(c.provenance.intakeKey).toBe(`${SOURCE_FORM_ID}:SUB-42`);
    expect(c.provenance.sourceSystem).toBe('historical-job-booking-form');
  });

  it('preserves every populated column in the raw payload', () => {
    const c = build({
      29: 'Invoice\nSend pre sale',
      91: 'someone@example.test',
      92: 'S1'
    });
    expect(c.rawPayload['29']).toBe('Invoice\nSend pre sale');
    // Column 91 is IGNORE, but provenance still keeps it.
    expect(c.rawPayload['91']).toBe('someone@example.test');
  });

  it('prefers the later generation of the customer name columns', () => {
    const c = build({ 4: 'Old', 5: 'Name', 62: 'New', 63: 'Name2', 92: 'S1' });
    expect(c.customer.firstName).toBe('New');
    expect(c.customer.lastName).toBe('Name2');
    expect(c.customer.generation).toBe('later');
  });

  it('falls back to the earlier generation when the later one is blank', () => {
    const c = build({ 4: 'Old', 5: 'Name', 92: 'S1' });
    expect(c.customer.firstName).toBe('Old');
    expect(c.customer.generation).toBe('earlier');
  });

  it('flags a row whose identity fields straddle two generations', () => {
    const c = build({ 4: 'Old', 63: 'New', 92: 'S1' });
    expect(c.customer.generation).toBe('mixed');
    expect(c.warnings.map((w) => w.code)).toContain('MIXED_NAME_GENERATION');
  });

  it('turns component quantities into described materials lines', () => {
    const c = build({ 14: '12', 72: '4', 92: 'S1' });
    const descriptions = c.materials.map((m) => m.description);
    expect(descriptions).toContain('Roof hooks (historical)');
    expect(descriptions).toContain(
      'Renusol REN-420081-B end clamps (historical)'
    );
    expect(c.materials.every((m) => m.quantity > 0)).toBe(true);
  });

  it('treats a recorded zero as "none required", not as a line', () => {
    expect(build({ 14: '0', 92: 'S1' }).materials).toHaveLength(0);
  });

  it('never invents a materials line from free text it cannot read', () => {
    const c = build({ 14: 'a few', 92: 'S1' });
    expect(c.materials).toHaveLength(0);
    expect(c.warnings.map((w) => w.code)).toContain('BAD_QUANTITY');
  });

  it('does not import the form totals as well as their parts', () => {
    const c = build({ 64: '5', 71: '3', 73: '8', 92: 'S1' });
    expect(
      c.materials.filter((m) => m.description.includes('R420181'))
    ).toHaveLength(2);
    expect(c.materials.reduce((n, m) => n + m.quantity, 0)).toBe(8);
  });

  it('reports a total that disagrees with its parts instead of reconciling it', () => {
    const c = build({ 64: '5', 71: '3', 73: '99', 92: 'S1' });
    expect(c.warnings.map((w) => w.code)).toContain('TOTAL_DISAGREES');
  });

  it('refuses to read a date out of the repurposed panel column', () => {
    const c = build({ 90: '8/12/2026', 92: 'S1' });
    expect(c.materials).toHaveLength(0);
    expect(c.warnings.map((w) => w.code)).toContain('REPURPOSED_COLUMN');
  });

  it('keeps ambiguous equipment text rather than parsing counts out of prose', () => {
    const c = build({ 21: 'FoxESS EP5 x 3', 92: 'S1' });
    expect(c.equipment[0]).toMatchObject({
      equipmentType: 'Battery',
      descriptor: 'FoxESS EP5 x 3',
      branch: 'standard'
    });
  });

  it('uses the SunPower branch only when the standard column is blank', () => {
    expect(
      build({ 32: 'SunPower Reserve 5kW', 92: 'S1' }).equipment[0].branch
    ).toBe('sunpower');
    expect(
      build({ 20: 'Fox ESS H1-5.0-G2', 32: 'x', 92: 'S1' }).equipment[0].branch
    ).toBe('standard');
  });

  it('reads "no scaffold" answers as not-required instead of a company name', () => {
    expect(build({ 55: 'NOT REQUIRED', 92: 'S1' }).scaffold).toMatchObject({
      required: false,
      companyName: null
    });
    expect(build({ 55: 'no scaff', 92: 'S1' }).scaffold.required).toBe(false);
  });

  it('records a scaffold company without proposing a live booking', () => {
    const c = build({
      55: 'Skyline',
      12: '03-14-2025',
      41: '2025-03-01 10:00:00',
      92: 'S1'
    });
    expect(c.scaffold).toMatchObject({
      required: true,
      companyName: 'Skyline',
      erectDate: '2025-03-14'
    });
  });

  it('flags an undecided scaffold company', () => {
    expect(
      build({ 55: 'scaff comp tbc', 92: 'S1' }).warnings.map((w) => w.code)
    ).toContain('SCAFFOLD_COMPANY_TBC');
  });

  it('records file links as host and status only, and downloads nothing', () => {
    const c = build({ 83: 'https://www.example.test/a/b.pdf', 92: 'S1' });
    expect(c.files).toEqual([
      { column: 83, host: 'www.example.test', status: 'UNKNOWN' }
    ]);
  });

  it('marks a signed link as requiring auth without echoing the token', () => {
    const c = build({
      83: 'https://files.example.test/x.pdf?token=SECRETVALUE',
      92: 'S1'
    });
    expect(c.files[0].status).toBe('REQUIRES_AUTH');
    expect(JSON.stringify(c.files)).not.toContain('SECRETVALUE');
  });

  it('leaves finance_route unknown when the form only said finance was used', () => {
    const c = build({ 56: 'Yes', 92: 'S1' });
    expect(c.job.financeRoute).toBeNull();
    expect(c.warnings.map((w) => w.code)).toContain(
      'FINANCE_USED_ROUTE_UNKNOWN'
    );
    // The original answer is still recoverable.
    expect(c.rawPayload['56']).toBe('Yes');
  });

  it('maps an explicit No to Standard, which is a real route decision', () => {
    expect(build({ 56: 'No', 92: 'S1' }).job.financeRoute).toBe('Standard');
  });

  it('rejects a non-integer fuse rating rather than rounding it', () => {
    const c = build({ 34: '3.68', 92: 'S1' });
    expect(c.technical.fuseRatingAmps).toBeNull();
    expect(c.warnings.map((w) => w.code)).toContain('BAD_FUSE_RATING');
  });

  it('is deterministic: the same row produces the same candidate twice', () => {
    const values = { 1: 'x', 14: '3', 41: '2025-03-07 9:48:24', 92: 'S1' };
    expect(JSON.stringify(build(values))).toBe(JSON.stringify(build(values)));
  });
});

// --- Validation and historical state ----------------------------------------

describe('validation', () => {
  const run = (r: string[], directory: Directory = emptyDirectory) => {
    const c = transformRow(r, 1, directory, 'batch-test');
    const m = matchJob(
      {
        intakeKey: c.provenance.intakeKey,
        postcode: c.customer.postcode,
        email: c.customer.email,
        lastName: c.customer.lastName,
        soldAt: c.job.soldAt
      },
      directory
    );
    return validate(c, m);
  };

  it('classifies a fully resolvable row as ready', () => {
    expect(run(completeRow()).classification).toBe('READY');
  });

  it('records an unknown salesperson as unknown, and still imports the row', () => {
    const v = run(completeRow({ 47: '' }));
    expect(v.classification).toBe('READY_WITH_WARNINGS');
    expect(v.blockers).toEqual([]);
    expect(v.candidate.job.salesperson).toBeNull();
    expect(v.candidate.warnings.map((w) => w.code)).toContain(
      'MISSING_SALESPERSON'
    );
  });

  it('never substitutes a stand-in person for an unknown salesperson', () => {
    const v = run(completeRow({ 47: '' }));
    const jobOp = v.operations.find((o) => o.table === 'jobs');
    expect(jobOp?.summary).toContain('HistoricalImport');
    expect(JSON.stringify(v.candidate.job.salesperson)).not.toContain(
      'PERSON-'
    );
  });

  it('keeps an ambiguous salesperson as unlinked historical text, not a rejection', () => {
    const v = run(completeRow({ 47: 'Bob' }));
    expect(v.blockers).toEqual([]);
    expect(v.candidate.job.salesperson?.kind).toBe('AMBIGUOUS');
    expect(v.candidate.job.salesperson?.legacyId).toBeNull();
    expect(v.operations.some((o) => o.table === 'historical_job_people')).toBe(
      true
    );
  });

  it('records unknown finance as unknown rather than defaulting it to Standard', () => {
    const v = run(completeRow({ 56: '' }));
    expect(v.blockers).toEqual([]);
    expect(v.candidate.job.financeRoute).toBeNull();
  });

  it('records an unknown price as unknown rather than inventing one', () => {
    const v = run(completeRow({ 28: '' }));
    expect(v.blockers).toEqual([]);
    expect(v.candidate.job.grossPence).toBeNull();
  });

  it('still refuses to read a zero price as a price', () => {
    const v = run(completeRow({ 28: '0' }));
    expect(v.candidate.job.grossPence).toBeNull();
    expect(v.candidate.warnings.map((w) => w.code)).toContain('BAD_COST');
  });

  it('sends a row missing required customer fields to review, inventing nothing', () => {
    const v = run(completeRow({ 61: 'not a postcode' }));
    expect(v.classification).toBe('OWNER_REVIEW_REQUIRED');
    expect(v.candidate.customer.postcode).toBeNull();
    expect(v.reviewReasons.join(' ')).toContain('postcode');
  });

  it('rejects a row that identifies no customer at all', () => {
    const v = run(
      completeRow({ 1: '', 2: '', 6: '', 37: '', 61: '', 62: '', 63: '' })
    );
    expect(v.classification).toBe('REJECTED');
    expect(v.blockers.map((b) => b.code)).toContain('CUSTOMER_UNIDENTIFIABLE');
  });

  it('rejects a row with no sale date, which history cannot be placed without', () => {
    expect(run(completeRow({ 41: '' })).blockers.map((b) => b.code)).toContain(
      'JOB_SOLD_AT'
    );
  });

  it('keeps an unresolved installer as preserved text with no allocation', () => {
    const v = run(completeRow({ 7: 'Nobody' }));
    expect(v.blockers).toEqual([]);
    expect(v.candidate.people.installers[0].kind).toBe('NO_MATCH');
    expect(v.candidate.people.installers[0].raw).toBe('Nobody');
    expect(v.operations.some((o) => o.table === 'allocations')).toBe(false);
  });

  it('sends a probable existing job to owner review, never merging it', () => {
    const directory: Directory = {
      ...emptyDirectory,
      jobsAuthoritative: true,
      jobs: [
        {
          jobRef: 'SS-ABCD-0009',
          customerPostcode: 'ZZ1 1ZZ',
          customerEmail: null,
          customerLastName: 'Quinn',
          soldAt: '2025-03-07T00:00:00.000Z'
        }
      ]
    };
    const v = run(completeRow({ 6: '' }), directory);
    expect(v.jobMatch.kind).toBe('PROBABLE_EXISTING_JOB');
    expect(v.classification).toBe('OWNER_REVIEW_REQUIRED');
    expect(
      v.operations.some((o) => o.table === 'jobs' && o.action === 'insert')
    ).toBe(false);
  });

  it('proposes only a link, never a field change, for an exact existing job', () => {
    const directory: Directory = {
      ...emptyDirectory,
      jobsAuthoritative: true,
      jobs: [
        {
          jobRef: 'SS-ABCD-0010',
          customerPostcode: null,
          customerEmail: 'customer@example.test',
          customerLastName: null,
          soldAt: null
        }
      ]
    };
    const v = run(completeRow(), directory);
    expect(v.jobMatch.kind).toBe('EXACT_EXISTING_JOB');
    expect(v.operations.map((o) => `${o.table}.${o.action}`)).toEqual([
      'intake.insert',
      'jobs.link'
    ]);
  });

  it('proposes nothing beyond the intake row for a replay', () => {
    const directory: Directory = {
      ...emptyDirectory,
      jobsAuthoritative: true,
      intakeKeys: [`${SOURCE_FORM_ID}:SUB-0001`]
    };
    const v = run(completeRow(), directory);
    expect(v.jobMatch.kind).toBe('ALREADY_IMPORTED');
    expect(v.operations).toHaveLength(1);
  });
});

describe('historical state', () => {
  const v = (() => {
    const c = transformRow(
      completeRow({
        7: 'Ada',
        31: 'Ada',
        55: 'Skyline',
        12: '03-14-2025',
        14: '10'
      }),
      1,
      emptyDirectory,
      'b'
    );
    return validate(
      c,
      matchJob(
        {
          intakeKey: c.provenance.intakeKey,
          postcode: null,
          email: null,
          lastName: null,
          soldAt: null
        },
        emptyDirectory
      )
    );
  })();

  it('never proposes a write to a table that carries live obligations', () => {
    const touched = v.operations.map((o) => o.table);
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(
        touched,
        `historical import must not write ${forbidden}`
      ).not.toContain(forbidden);
    }
  });

  it('proposes no tasks, calls, communications or invoice stages', () => {
    const touched = v.operations.map((o) => o.table);
    expect(touched).not.toContain('tasks');
    expect(touched).not.toContain('calls');
    expect(touched).not.toContain('communications');
    expect(touched).not.toContain('invoice_stages');
    expect(touched).not.toContain('outbox');
  });

  it('marks the historical job so live sweeps exclude it', () => {
    const jobOp = v.operations.find((o) => o.table === 'jobs');
    expect(jobOp?.summary).toContain('archived');
  });

  it('gives every proposed operation an idempotency key', () => {
    expect(v.operations.length).toBeGreaterThan(0);
    for (const op of v.operations) {
      expect(op.idempotencyKey).toContain(SOURCE_FORM_ID);
    }
  });
});

// --- Privacy -----------------------------------------------------------------

describe('PII-safe output', () => {
  it('masks emails, postcodes and names', () => {
    expect(maskEmail('someone@example.test')).toBe('s******@e******.test');
    expect(maskPostcode('ZZ1 1ZZ')).toBe('ZZ1');
    expect(maskName('Quinn')).toBe('Q****');
  });

  it('scrubs contact detail out of free text', () => {
    const scrubbed = scrubFreeText(
      'call 07700 900123 or a@b.test, see https://x.test/y'
    );
    expect(scrubbed).not.toContain('900123');
    expect(scrubbed).not.toContain('a@b.test');
    expect(scrubbed).toContain('<url>');
  });

  it('produces a stable, non-reversible correlation token', () => {
    expect(token('Quinn')).toBe(token('  quinn  '));
    expect(token('Quinn')).not.toContain('uinn');
    expect(token('Quinn')).toHaveLength(8);
  });
});

// --- The write boundary ------------------------------------------------------

describe('the importer cannot write', () => {
  const dir = path.resolve(__dirname, '..');
  const files = [
    'csv.ts',
    'columns.ts',
    'normalise.ts',
    'directory.ts',
    'match.ts',
    'transform.ts',
    'validate.ts',
    'run.ts',
    'redact.ts',
    'identity.ts'
  ];

  it('imports no database client anywhere in the importer', () => {
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source, `${file} must not import a Supabase client`).not.toMatch(
        /@supabase\//
      );
      expect(source, `${file} must not import pg`).not.toMatch(/from 'pg'/);
    }
  });

  it('calls nothing that could execute a statement', () => {
    // The importer names SQL in comments, and directory.ts searches the staff
    // seed for its insert statement, so scanning for SQL text proves nothing.
    // What matters is that no call site exists that could run one.
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source, `${file} must not call .rpc()`).not.toMatch(/\.rpc\s*\(/);
      expect(source, `${file} must not build a query`).not.toMatch(
        /\.from\s*\(\s*['"`]/
      );
      expect(source, `${file} must not open a client`).not.toMatch(
        /createClient|new\s+Client|new\s+Pool/
      );
      expect(source, `${file} must not reach the network`).not.toMatch(
        /\bfetch\s*\(|axios|node-fetch|https?\.request/
      );
    }
  });

  it('writes only to the two known output paths', () => {
    const source = readFileSync(path.join(dir, 'run.ts'), 'utf8');
    const writes = source.match(/writeFileSync\(/g) ?? [];
    expect(writes).toHaveLength(2);
    expect(source).toMatch(/dry-run-report\.json/);
    expect(source).toMatch(/review-required\.csv/);
  });

  it('the hosted snapshot reads only, and never ships plaintext customer data', () => {
    const sh = readFileSync(path.join(dir, 'snapshot.sh'), 'utf8');
    expect(sh).toMatch(/set default_transaction_read_only = on/);
    for (const verb of [
      'insert into',
      'update ',
      'delete from',
      'alter ',
      'drop ',
      'truncate',
      'grant '
    ]) {
      expect(
        sh.toLowerCase(),
        `snapshot.sh must not contain "${verb}"`
      ).not.toContain(verb);
    }
    // Customer identifiers leave the database already hashed.
    for (const column of ['c.email', 'c.postcode', 'c.last_name']) {
      const plain = new RegExp(
        `'customer\\w+',\\s*${column.replace('.', '\\.')}\\b`
      );
      expect(sh).not.toMatch(plain);
    }
    expect(sh).toMatch(/md5\(:'salt'/);
  });

  it('the runner refuses an explicit write request', () => {
    const source = readFileSync(path.join(dir, 'run.ts'), 'utf8');
    expect(source).toMatch(/writeRequested/);
    expect(source).toMatch(/Refused: this importer has no write mode/);
  });
});

// --- Import identity ---------------------------------------------------------

describe('import identity', () => {
  const withSubmission = (id: string, over: Record<number, string> = {}) =>
    row({
      6: 'a@example.test',
      41: '2025-03-07 9:48:24',
      61: 'ZZ1 1ZZ',
      63: 'Quinn',
      92: id,
      ...over
    });

  it('uses the Submission ID unchanged when it is unique', () => {
    const [a] = resolveIdentities([withSubmission('SUB-1')]);
    expect(a.importKey).toBe('SUB-1');
    expect(a.submissionId).toBe('SUB-1');
    expect(a.discriminated).toBe(false);
  });

  it('collapses rows that share an ID and describe the same customer', () => {
    const ids = resolveIdentities([
      withSubmission('SUB-D'),
      withSubmission('SUB-D')
    ]);
    expect(ids).toHaveLength(1);
    expect(ids[0].contributingRows.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(ids[0].importKey).toBe('SUB-D');
  });

  it('keeps the fullest version when collapsed rows differ', () => {
    const sparse = withSubmission('SUB-D');
    const full = withSubmission('SUB-D', {
      43: 'roof notes',
      44: 'electrical notes'
    });
    const ids = resolveIdentities([sparse, full]);
    expect(ids).toHaveLength(1);
    expect(ids[0].primaryRow).toBe(2);
    expect(ids[0].supersededPayloadHashes).toHaveLength(1);
  });

  it('discriminates when one ID is reused by a different customer', () => {
    const ids = resolveIdentities([
      withSubmission('SUB-R', { 63: 'Quinn' }),
      withSubmission('SUB-R', { 63: 'Other', 6: 'b@example.test' })
    ]);
    expect(ids).toHaveLength(2);
    expect(ids.every((i) => i.discriminated)).toBe(true);
    expect(ids[0].importKey).not.toBe(ids[1].importKey);
    // The Submission ID itself is never altered.
    expect(ids.every((i) => i.submissionId === 'SUB-R')).toBe(true);
    expect(ids.every((i) => i.importKey.startsWith('SUB-R#'))).toBe(true);
  });

  it('is stable when the export is reordered', () => {
    const a = withSubmission('SUB-R', { 63: 'Quinn' });
    const b = withSubmission('SUB-R', { 63: 'Other', 6: 'b@example.test' });
    const forward = resolveIdentities([a, b])
      .map((i) => i.importKey)
      .sort();
    const reversed = resolveIdentities([b, a])
      .map((i) => i.importKey)
      .sort();
    expect(forward).toEqual(reversed);
  });

  it('keeps the key stable when a non-identity field is edited', () => {
    const before = resolveIdentities([withSubmission('SUB-E')])[0];
    const after = resolveIdentities([
      withSubmission('SUB-E', { 43: 'new notes' })
    ])[0];
    expect(after.importKey).toBe(before.importKey);
    // ... but the change is detectable.
    expect(after.payloadHash).not.toBe(before.payloadHash);
  });

  it('running the same export twice yields identical identities', () => {
    const rows = [withSubmission('SUB-1'), withSubmission('SUB-2')];
    expect(JSON.stringify(resolveIdentities(rows))).toBe(
      JSON.stringify(resolveIdentities(rows))
    );
  });
});
