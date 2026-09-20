/**
 * Matching historical values against current records.
 *
 * Both matchers fail closed. A value that could mean two people, or a row that
 * could be two jobs, returns AMBIGUOUS and is never resolved by picking the
 * first or the closest candidate — the cost of a wrong merge here is a
 * corrupted live job, and the cost of refusing is one line in a review file.
 */

import { nameKey, emailKey, normaliseSpace } from './normalise';
import type { Directory, DirectoryPerson, DirectoryJob } from './directory';
import { NON_ACTOR_LEGACY_IDS } from './directory';

// --- People ------------------------------------------------------------------

export type PersonMatchKind =
  | 'EXACT_MATCH'
  | 'SAFE_NORMALISED_MATCH'
  | 'AMBIGUOUS'
  | 'NO_MATCH'
  | 'NON_PERSON_VALUE';

export type PersonMatch = {
  raw: string;
  kind: PersonMatchKind;
  /** legacy_id of the matched person, when a single one was resolved. */
  legacyId: string | null;
  displayName: string | null;
  /** Populated for AMBIGUOUS: every person the value could mean. */
  candidates: string[];
  reason: string;
};

/**
 * Values that appear in a staff column but do not name a member of staff.
 * Kept explicit rather than inferred so the list is reviewable.
 */
const NON_PERSON_VALUES = new Set([
  'na',
  'n/a',
  'none',
  'no',
  'tbc',
  'tbd',
  'n/a',
  'not sure',
  'unknown',
  '-',
  '?'
]);

/**
 * Historical aliases the owner has confirmed, keyed by the normalised source
 * value. Nothing is added here by inference: each entry is a decision recorded
 * in analysis/owner-decisions.md, and an entry still has to resolve to exactly
 * one active person or it is treated as unmatched.
 *
 * `Ben Q` -> Ben Quick, approved 2026-09-20.
 */
const APPROVED_ALIASES: Record<string, string> = {
  'ben q': 'Ben Quick'
};

function firstNameKey(displayName: string): string {
  return nameKey(displayName).split(' ')[0] ?? '';
}

/**
 * Resolves one historical staff value.
 *
 * Order matters: an exact full-name or email hit is taken before any
 * first-name reasoning, so a person whose full name happens to collide with
 * another person's first name is still resolved exactly.
 */
export function matchPerson(
  raw: string,
  people: DirectoryPerson[]
): PersonMatch {
  const value = normaliseSpace(raw);
  const base: Omit<PersonMatch, 'kind' | 'reason'> = {
    raw: value,
    legacyId: null,
    displayName: null,
    candidates: []
  };

  if (value === '') {
    return { ...base, kind: 'NO_MATCH', reason: 'blank' };
  }
  if (NON_PERSON_VALUES.has(value.toLowerCase())) {
    return {
      ...base,
      kind: 'NON_PERSON_VALUE',
      reason: 'placeholder, not a name'
    };
  }

  const actors = people.filter(
    (p) => !NON_ACTOR_LEGACY_IDS.has(p.legacyId ?? '') && p.active
  );

  // 1. Exact email.
  if (value.includes('@')) {
    const key = emailKey(value);
    const byEmail = actors.filter((p) => p.email === key);
    if (byEmail.length === 1) {
      return {
        ...base,
        kind: 'EXACT_MATCH',
        legacyId: byEmail[0].legacyId,
        displayName: byEmail[0].displayName,
        reason: 'email equals people.email'
      };
    }
    return {
      ...base,
      kind: 'NO_MATCH',
      reason: 'email is not a current person'
    };
  }

  const key = nameKey(value);

  // 2. An alias the owner has explicitly confirmed.
  const alias = APPROVED_ALIASES[key];
  if (alias) {
    const byAlias = actors.filter(
      (p) => nameKey(p.displayName) === nameKey(alias)
    );
    if (byAlias.length === 1) {
      return {
        ...base,
        kind: 'EXACT_MATCH',
        legacyId: byAlias[0].legacyId,
        displayName: byAlias[0].displayName,
        reason: `owner-confirmed alias for ${byAlias[0].displayName}`
      };
    }
  }

  // 3. Exact display name, case- and whitespace-insensitive.
  const byName = actors.filter((p) => nameKey(p.displayName) === key);
  if (byName.length === 1) {
    return {
      ...base,
      kind: 'EXACT_MATCH',
      legacyId: byName[0].legacyId,
      displayName: byName[0].displayName,
      reason: 'display name equals people.display_name after trim and case fold'
    };
  }
  if (byName.length > 1) {
    return {
      ...base,
      kind: 'AMBIGUOUS',
      candidates: byName.map((p) => p.displayName),
      reason: 'more than one current person shares this display name'
    };
  }

  // 4. First name only. The historical form recorded first names, so this is
  //    the common case — and the one that must refuse on a collision.
  const byFirst = actors.filter((p) => firstNameKey(p.displayName) === key);
  if (byFirst.length === 1) {
    return {
      ...base,
      kind: 'SAFE_NORMALISED_MATCH',
      legacyId: byFirst[0].legacyId,
      displayName: byFirst[0].displayName,
      reason: 'unique first-name match among active people'
    };
  }
  if (byFirst.length > 1) {
    return {
      ...base,
      kind: 'AMBIGUOUS',
      candidates: byFirst.map((p) => p.displayName),
      reason: `first name "${value}" matches ${byFirst.length} active people`
    };
  }

  // 5. A bare surname. Reported as ambiguous rather than matched: a surname
  //    that equals nobody's first name is still not evidence of who was meant.
  const bySurname = actors.filter((p) =>
    nameKey(p.displayName).split(' ').slice(1).includes(key)
  );
  if (bySurname.length >= 1) {
    return {
      ...base,
      kind: 'AMBIGUOUS',
      candidates: bySurname.map((p) => p.displayName),
      reason: `"${value}" matches only as a surname; the form recorded first names, so this is not safe to resolve`
    };
  }

  return {
    ...base,
    kind: 'NO_MATCH',
    reason: 'no active person with this name'
  };
}

/** A resolved match that may be used to write a person_id. */
export function isUsablePerson(match: PersonMatch): boolean {
  return match.kind === 'EXACT_MATCH' || match.kind === 'SAFE_NORMALISED_MATCH';
}

// --- Jobs --------------------------------------------------------------------

export type JobMatchKind =
  | 'EXACT_EXISTING_JOB'
  | 'PROBABLE_EXISTING_JOB'
  | 'AMBIGUOUS'
  | 'NEW_HISTORICAL_JOB'
  | 'ALREADY_IMPORTED';

export type JobMatchSignals = {
  /** (form_id, submission_id) already present in public.intake. */
  intakeKey: string;
  postcode: string | null;
  email: string | null;
  lastName: string | null;
  soldAt: string | null;
};

export type JobMatch = {
  kind: JobMatchKind;
  jobRef: string | null;
  candidates: string[];
  reason: string;
  /** Which signals agreed, for the report. */
  matchedOn: string[];
};

const DAY_MS = 86_400_000;

function withinDays(a: string | null, b: string | null, days: number): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= days * DAY_MS;
}

/**
 * Decides whether a historical row is a job the system already holds.
 *
 * The levels, strongest first:
 *
 *  ALREADY_IMPORTED      this exact submission is already in `intake`. The
 *                        run is a replay; nothing is proposed.
 *  EXACT_EXISTING_JOB    customer email matches an existing job's customer.
 *                        Email is the only single field strong enough alone.
 *  PROBABLE_EXISTING_JOB postcode and surname both match, and the sale dates
 *                        are within 90 days. Two independent identity signals
 *                        plus time — still surfaced for review, never merged
 *                        automatically.
 *  AMBIGUOUS             more than one existing job satisfies the above.
 *  NEW_HISTORICAL_JOB    nothing matched.
 *
 * Name alone never matches, at any level.
 */
export function matchJob(
  signals: JobMatchSignals,
  directory: Directory
): JobMatch {
  if (directory.intakeKeys.includes(signals.intakeKey)) {
    return {
      kind: 'ALREADY_IMPORTED',
      jobRef: null,
      candidates: [],
      matchedOn: ['intake.submission_id'],
      reason:
        'this submission is already recorded in intake; re-running changes nothing'
    };
  }

  if (!directory.jobsAuthoritative) {
    return {
      kind: 'NEW_HISTORICAL_JOB',
      jobRef: null,
      candidates: [],
      matchedOn: [],
      reason:
        'no authoritative job list available offline; treated as new for planning only, and re-checked against hosted data before any write'
    };
  }

  const byEmail = signals.email
    ? directory.jobs.filter(
        (j) => j.customerEmail && j.customerEmail === signals.email
      )
    : [];

  if (byEmail.length === 1) {
    return {
      kind: 'EXACT_EXISTING_JOB',
      jobRef: byEmail[0].jobRef,
      candidates: [],
      matchedOn: ['customer email'],
      reason: 'customer email matches exactly one existing job'
    };
  }
  if (byEmail.length > 1) {
    return {
      kind: 'AMBIGUOUS',
      jobRef: null,
      candidates: byEmail.map((j) => j.jobRef),
      matchedOn: ['customer email'],
      reason: 'customer email matches more than one existing job'
    };
  }

  const probable = directory.jobs.filter(
    (j: DirectoryJob) =>
      signals.postcode !== null &&
      signals.lastName !== null &&
      j.customerPostcode === signals.postcode &&
      j.customerLastName !== null &&
      nameKey(j.customerLastName) === nameKey(signals.lastName) &&
      withinDays(j.soldAt, signals.soldAt, 90)
  );

  if (probable.length === 1) {
    return {
      kind: 'PROBABLE_EXISTING_JOB',
      jobRef: probable[0].jobRef,
      candidates: [],
      matchedOn: ['postcode', 'surname', 'sold date within 90 days'],
      reason:
        'postcode and surname agree and the sale dates are close; needs confirmation before any link'
    };
  }
  if (probable.length > 1) {
    return {
      kind: 'AMBIGUOUS',
      jobRef: null,
      candidates: probable.map((j) => j.jobRef),
      matchedOn: ['postcode', 'surname'],
      reason: 'more than one existing job shares this postcode and surname'
    };
  }

  return {
    kind: 'NEW_HISTORICAL_JOB',
    jobRef: null,
    candidates: [],
    matchedOn: [],
    reason: 'no existing job matched on email, or on postcode plus surname'
  };
}
