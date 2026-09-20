/**
 * Value normalisers for the historical Job Booking export.
 *
 * Every normaliser is total: it returns a discriminated result rather than
 * throwing or guessing, because an unparseable historical value must surface
 * as a warning on the candidate instead of silently becoming null.
 */

export type Parsed<T> =
  | { ok: true; value: T; raw: string }
  | { ok: false; reason: string; raw: string };

const ok = <T>(value: T, raw: string): Parsed<T> => ({ ok: true, value, raw });
const bad = <T>(reason: string, raw: string): Parsed<T> => ({
  ok: false,
  reason,
  raw
});

/** Collapses whitespace runs and trims. Used before any comparison. */
export function normaliseSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Comparison key for names: space-normalised, case-folded, punctuation-stripped. */
export function nameKey(value: string): string {
  return normaliseSpace(value)
    .toLowerCase()
    .replace(/[.,'`’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Comparison key for emails. Does not attempt to repair malformed addresses. */
export function emailKey(value: string): string {
  return value.trim().toLowerCase();
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(value: string): Parsed<string> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);
  const lowered = raw.toLowerCase();
  if (!EMAIL_SHAPE.test(lowered)) return bad('not an email shape', raw);
  return ok(lowered, raw);
}

/**
 * UK postcode. `customers.postcode` enforces
 * `^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$` — uppercase with exactly one
 * space — so historical values are reformatted to that shape or rejected.
 */
const POSTCODE_CORE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

export function parsePostcode(value: string): Parsed<string> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);
  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const m = POSTCODE_CORE.exec(compact);
  if (!m)
    return bad('does not match the UK postcode shape the schema requires', raw);
  return ok(`${m[1]} ${m[2]}`, raw);
}

/** Splits a multi-select cell. The export separates choices with newlines. */
export function parseList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((part) => normaliseSpace(part))
    .filter((part) => part !== '');
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Which component of a `dd-mm-yyyy`-shaped cell is the month.
 *
 * The work-date columns are not one format. Across `Date Roofer`,
 * `Date Sparky` and `Date Scaffolding` the export changes over from
 * month-first to day-first at submission date 2025-08-21, with no overlap:
 * every cell whose first component exceeds 12 (so it cannot be a month) sits
 * on or after that date, and every cell whose second component exceeds 12 sits
 * before it. The era is therefore read from the row's submission date, not
 * guessed per value.
 *
 * `Date for invoice` (column 58) did not change over and stays month-first.
 */
export type DateEra = 'month-first' | 'day-first';

/** Submissions from this instant onward use day-first work dates. */
export const DAY_FIRST_FROM = Date.UTC(2025, 7, 21);

export function eraForSubmission(
  submittedAtIso: string | null
): DateEra | null {
  if (!submittedAtIso) return null;
  const t = Date.parse(submittedAtIso);
  if (Number.isNaN(t)) return null;
  return t >= DAY_FIRST_FROM ? 'day-first' : 'month-first';
}

export type WorkDate = {
  iso: string;
  /** True when the value itself proved the era, rather than the row's date. */
  selfEvident: boolean;
  /** True when the cell could only be read against the era we were given. */
  contradictsEra: boolean;
};

/**
 * Parses a work date against a known era.
 *
 * A cell that is impossible under the era but valid under the other one is
 * read the other way and flagged: the value is unambiguous evidence, and
 * discarding it in favour of the era would lose a real date. A cell that is
 * valid both ways is read using the era. A cell that is valid neither way, or
 * whose era is unknown and which is ambiguous, is refused.
 */
export function parseWorkDate(
  value: string,
  era: DateEra | null
): Parsed<WorkDate> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);

  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(raw);
  if (!m) return bad('unrecognised date format', raw);

  const a = Number(m[1]);
  const b = Number(m[2]);
  const year = Number(m[3]);

  const monthFirst = isoDate(year, a, b);
  const dayFirst = isoDate(year, b, a);

  if (!monthFirst && !dayFirst) {
    return bad('impossible date read either day-first or month-first', raw);
  }

  // Only one reading is possible: the value proves its own era.
  if (monthFirst && !dayFirst) {
    return ok(
      {
        iso: monthFirst,
        selfEvident: true,
        contradictsEra: era === 'day-first'
      },
      raw
    );
  }
  if (dayFirst && !monthFirst) {
    return ok(
      {
        iso: dayFirst,
        selfEvident: true,
        contradictsEra: era === 'month-first'
      },
      raw
    );
  }

  // Both readings are possible; only the era can decide.
  if (era === null) {
    return bad(
      'both day-first and month-first are possible and the row has no usable submission date to fix the era',
      raw
    );
  }
  return ok(
    {
      iso:
        era === 'month-first' ? (monthFirst as string) : (dayFirst as string),
      selfEvident: false,
      contradictsEra: false
    },
    raw
  );
}

/**
 * `Submission Date` has three generations: `24-Feb-2025`, `3-Mar-2025` and
 * `2025-03-07 9:48:24`. All three are unambiguous, so all three are accepted.
 * Returns a UTC instant; the export carries no timezone.
 */
export function parseSubmissionTimestamp(value: string): Parsed<string> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);

  const named = /^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})$/.exec(raw);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (!month) return bad('unknown month name', raw);
    const iso = isoDate(Number(named[3]), month, Number(named[1]));
    return iso ? ok(`${iso}T00:00:00.000Z`, raw) : bad('impossible date', raw);
  }

  const stamp = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})$/.exec(
    raw
  );
  if (stamp) {
    const iso = isoDate(Number(stamp[1]), Number(stamp[2]), Number(stamp[3]));
    const h = Number(stamp[4]);
    const min = Number(stamp[5]);
    const s = Number(stamp[6]);
    if (!iso) return bad('impossible date', raw);
    if (h > 23 || min > 59 || s > 59) return bad('impossible time', raw);
    const pad = (n: number) => String(n).padStart(2, '0');
    return ok(`${iso}T${pad(h)}:${pad(min)}:${pad(s)}.000Z`, raw);
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const iso = isoDate(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3])
    );
    return iso ? ok(`${iso}T00:00:00.000Z`, raw) : bad('impossible date', raw);
  }

  return bad('unrecognised timestamp format', raw);
}

/** True when a cell looks like a date. Used to detect repurposed columns. */
export function looksLikeDate(value: string): boolean {
  const raw = value.trim();
  return (
    /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(raw) || /^\d{4}-\d{2}-\d{2}/.test(raw)
  );
}

/** Non-negative decimal, e.g. solar kW / battery kWh / generation. */
export function parseDecimal(value: string): Parsed<number> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);
  const cleaned = raw.replace(/[,\s]/g, '').replace(/^£/, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return bad('not a plain decimal', raw);
  return ok(Number(cleaned), raw);
}

/** Non-negative integer, e.g. component quantities. */
export function parseInteger(value: string): Parsed<number> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);
  const cleaned = raw.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return bad('not a plain integer', raw);
  return ok(Number(cleaned), raw);
}

/**
 * Money to pence. `jobs.original_gross_pence` is `bigint > 0`, so zero and
 * negative values are rejected rather than coerced.
 */
export function parseMoneyPence(value: string): Parsed<number> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);
  const cleaned = raw.replace(/[£$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned))
    return bad('not a plain money amount', raw);
  const pence = Math.round(Number(cleaned) * 100);
  if (pence <= 0) return bad('not greater than zero', raw);
  return ok(pence, raw);
}

/**
 * Historical yes/no. The export uses `Yes`/`No` and bare `1`/`0`; anything
 * else (including `Not sure`) is not a boolean and must not be forced into one.
 */
export function parseBoolean(value: string): Parsed<boolean> {
  const raw = value.trim();
  if (raw === '') return bad('blank', raw);
  const key = raw.toLowerCase();
  if (key === 'yes' || key === 'y' || key === 'true' || key === '1')
    return ok(true, raw);
  if (key === 'no' || key === 'n' || key === 'false' || key === '0')
    return ok(false, raw);
  return bad('not a recognised boolean', raw);
}

/**
 * Scaffold company cells double as a "no scaffold" answer
 * (`NA`, `no scaff`, `NOT REQUIRED`, ...). Returns null for those so the row
 * records "scaffold not required" rather than inventing a company named "NA".
 */
const NO_SCAFFOLD = new Set([
  'na',
  'n/a',
  'none',
  'no scaff',
  'no scaffolding',
  'no scaff required',
  'not required',
  'no',
  'nil'
]);

export type ScaffoldCompany =
  | { kind: 'company'; name: string }
  | { kind: 'not-required' }
  | { kind: 'undecided'; raw: string }
  | { kind: 'blank' };

export function parseScaffoldCompany(value: string): ScaffoldCompany {
  const raw = normaliseSpace(value);
  if (raw === '') return { kind: 'blank' };
  const key = raw.toLowerCase();
  if (NO_SCAFFOLD.has(key)) return { kind: 'not-required' };
  if (/\btbc\b/i.test(raw)) return { kind: 'undecided', raw };
  return { kind: 'company', name: raw };
}

/** A URL-bearing cell, for the file inventory. Never logged in full. */
export function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s,"']+/gi);
  return matches ? matches.map((u) => u.trim()) : [];
}
