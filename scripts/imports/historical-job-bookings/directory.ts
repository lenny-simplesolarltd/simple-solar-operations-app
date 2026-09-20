/**
 * The current-system reference data the matchers compare against.
 *
 * Analysis runs offline by default: people come from the controlled staff seed
 * (`supabase/seeds/001_staff.sql`), which is the same list the hosted database
 * was seeded from. A hosted read-only snapshot can be supplied instead via
 * `--snapshot`, and `snapshot.ts` writes one using SELECTs only.
 */

import { readFileSync } from 'node:fs';

export type DirectoryPerson = {
  legacyId: string | null;
  email: string | null;
  displayName: string;
  active: boolean;
};

export type DirectoryCompany = {
  name: string;
  type: 'Merchant' | 'Scaffolder' | 'FinanceProvider' | 'Other';
};

/**
 * Existing jobs, for deduplication. Only the fields the matcher needs; never
 * the whole customer record.
 */
export type DirectoryJob = {
  jobRef: string;
  customerPostcode: string | null;
  customerEmail: string | null;
  customerLastName: string | null;
  soldAt: string | null;
};

export type Directory = {
  people: DirectoryPerson[];
  companies: DirectoryCompany[];
  jobs: DirectoryJob[];
  /** Existing (form_id, submission_id) pairs already in public.intake. */
  intakeKeys: string[];
  source: 'staff-seed' | 'hosted-snapshot';
  /** True when the job list is known to be complete. */
  jobsAuthoritative: boolean;
  /**
   * Per-run salt used to hash customer identifiers inside the database. When
   * present, the CSV side must be hashed the same way before comparison, and
   * the snapshot holds no plaintext customer data.
   */
  salt: string | null;
  counts?: Record<string, number>;
};

const PEOPLE_ROW =
  /\(\s*'([^']*)'\s*,\s*(?:'([^']*)'|null)\s*,\s*'([^']*)'\s*,\s*(true|false)\s*,/gi;

/**
 * Parses the staff seed's people insert. Deliberately narrow: it reads only
 * the one statement shape the seed uses, and reports zero rows if that changes
 * rather than silently matching against an empty directory.
 */
export function parseStaffSeed(sql: string): DirectoryPerson[] {
  const start = sql.indexOf('insert into public.people');
  if (start === -1) return [];
  const end = sql.indexOf(';', start);
  const block = sql.slice(start, end === -1 ? undefined : end);

  const people: DirectoryPerson[] = [];
  let m: RegExpExecArray | null;
  PEOPLE_ROW.lastIndex = 0;
  while ((m = PEOPLE_ROW.exec(block))) {
    people.push({
      legacyId: m[1] || null,
      email: m[2] ? m[2].toLowerCase() : null,
      displayName: m[3],
      active: m[4].toLowerCase() === 'true'
    });
  }
  return people;
}

export function loadDirectoryFromSeed(seedPath: string): Directory {
  const people = parseStaffSeed(readFileSync(seedPath, 'utf8'));
  return {
    people,
    companies: [],
    jobs: [],
    intakeKeys: [],
    source: 'staff-seed',
    jobsAuthoritative: false,
    salt: null
  };
}

export function loadDirectoryFromSnapshot(snapshotPath: string): Directory {
  const raw = JSON.parse(
    readFileSync(snapshotPath, 'utf8')
  ) as Partial<Directory> & {
    salt?: string;
    counts?: Record<string, number>;
  };
  return {
    people: raw.people ?? [],
    companies: raw.companies ?? [],
    jobs: raw.jobs ?? [],
    intakeKeys: raw.intakeKeys ?? [],
    source: 'hosted-snapshot',
    jobsAuthoritative: true,
    salt: typeof raw.salt === 'string' ? raw.salt : null,
    counts: raw.counts
  };
}

/**
 * Identities that exist as contact mailboxes rather than as people who do
 * work. `info@` is explicitly not an actor in this system, so it must never be
 * the result of a match.
 */
export const NON_ACTOR_LEGACY_IDS = new Set(['PERSON-info']);
