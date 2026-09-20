/**
 * The document the write path sends to the database.
 *
 * A candidate carries everything the analysis found, including matcher
 * internals and warning prose. What gets written is narrower and explicit, so
 * the shape the database receives is reviewable on its own and does not drift
 * when the analysis gains a field.
 *
 * Only READY and READY_WITH_WARNINGS candidates are included. Anything needing
 * a person's decision is held back, and the import is run again after they
 * decide rather than being coerced through now.
 */

import type { Validated } from './validate';
import type { Candidate } from './transform';
import { isUsablePerson, type PersonMatch } from './match';

export type HistoricalPerson = {
  role: 'Salesperson' | 'Installer' | 'Electrician';
  /** The name exactly as the legacy form recorded it. Always present. */
  sourceValue: string;
  /** legacy_id of a uniquely matched active person, or null. */
  personLegacyId: string | null;
  matchKind:
    | 'ExactMatch'
    | 'SafeNormalisedMatch'
    | 'Ambiguous'
    | 'NoMatch'
    | 'NonPersonValue';
  sourceColumn: number | null;
};

export type ImportCandidateDocument = {
  provenance: Candidate['provenance'];
  customer: Candidate['customer'];
  job: {
    soldAt: string | null;
    grossPence: number | null;
    leadSource: string | null;
    financeRoute: string | null;
    roofRequired: boolean;
    electricalRequired: boolean;
    scaffoldRequired: boolean;
    /** Null unless the salesperson resolved to exactly one active person. */
    salespersonLegacyId: string | null;
  };
  technical: Candidate['technical'];
  historicalPeople: HistoricalPerson[];
  /**
   * Facts with no normalised destination in the current schema. Written to
   * intake.raw_payload_json, so they are queryable without becoming live work.
   */
  historicalFacts: {
    work: Candidate['work'];
    scaffold: Candidate['scaffold'];
    materials: Candidate['materials'];
    equipment: Candidate['equipment'];
    commercial: Candidate['commercial'];
    files: Candidate['files'];
    /** The original Finance answer, verbatim. */
    financeAnswer: string | null;
  };
  /** Every source column, verbatim. Nothing is lost, whatever its disposition. */
  sourceColumns: Record<string, string>;
  /** Source rows that collapsed into this candidate. */
  sourceRows: Array<{
    rowNumber: number;
    payloadHash: string;
    populated: number;
  }>;
  warnings: Array<{ column: number | null; code: string }>;
};

export type ImportDocument = {
  batchId: string;
  candidates: ImportCandidateDocument[];
  heldBack: Array<{
    importKey: string;
    classification: string;
    reasons: string[];
  }>;
};

const PERSON_KIND: Record<PersonMatch['kind'], HistoricalPerson['matchKind']> =
  {
    EXACT_MATCH: 'ExactMatch',
    SAFE_NORMALISED_MATCH: 'SafeNormalisedMatch',
    AMBIGUOUS: 'Ambiguous',
    NO_MATCH: 'NoMatch',
    NON_PERSON_VALUE: 'NonPersonValue'
  };

function historicalPerson(
  match: PersonMatch,
  role: HistoricalPerson['role'],
  sourceColumn: number
): HistoricalPerson {
  return {
    role,
    sourceValue: match.raw,
    // A link only where exactly one active person was resolved. Everything
    // else keeps the text and links to nobody.
    personLegacyId: isUsablePerson(match) ? match.legacyId : null,
    matchKind: PERSON_KIND[match.kind],
    sourceColumn
  };
}

export function toDocument(v: Validated): ImportCandidateDocument {
  const c = v.candidate;

  const people: HistoricalPerson[] = [];
  if (c.job.salesperson && c.job.salesperson.raw !== '') {
    people.push(historicalPerson(c.job.salesperson, 'Salesperson', 47));
  }
  for (const m of c.people.installers) {
    if (m.raw !== '') people.push(historicalPerson(m, 'Installer', 7));
  }
  for (const m of c.people.electricians) {
    if (m.raw !== '') people.push(historicalPerson(m, 'Electrician', 31));
  }

  // The table is unique on (job_id, role, source_value), so a name repeated
  // within one role on one job is one fact, not two.
  const seen = new Set<string>();
  const deduped = people.filter((p) => {
    const key = `${p.role}${p.sourceValue.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    provenance: c.provenance,
    customer: c.customer,
    job: {
      soldAt: c.job.soldAt,
      grossPence: c.job.grossPence,
      leadSource: c.job.leadSource,
      financeRoute: c.job.financeRoute,
      roofRequired: c.job.roofRequired,
      electricalRequired: c.job.electricalRequired,
      // Unknown scaffold is recorded as false on the job (the column is NOT
      // NULL for every class); the truthful three-state value is kept below.
      scaffoldRequired: c.job.scaffoldRequired === true,
      salespersonLegacyId:
        c.job.salesperson && isUsablePerson(c.job.salesperson)
          ? c.job.salesperson.legacyId
          : null
    },
    technical: c.technical,
    historicalPeople: deduped,
    historicalFacts: {
      work: c.work,
      scaffold: c.scaffold,
      materials: c.materials,
      equipment: c.equipment,
      commercial: c.commercial,
      files: c.files,
      financeAnswer: c.commercial.financeAnswer
    },
    sourceColumns: c.rawPayload,
    sourceRows: c.identity ? c.identity.contributingRows : [],
    warnings: c.warnings.map((w) => ({ column: w.column, code: w.code }))
  };
}

export function buildImportDocument(
  results: Validated[],
  batchId: string
): ImportDocument {
  const importable = results.filter(
    (r) =>
      r.classification === 'READY' || r.classification === 'READY_WITH_WARNINGS'
  );
  const heldBack = results
    .filter(
      (r) =>
        r.classification !== 'READY' &&
        r.classification !== 'READY_WITH_WARNINGS'
    )
    .map((r) => ({
      importKey: r.candidate.provenance.importKey,
      classification: r.classification,
      reasons: [...r.blockers.map((b) => b.code), ...r.reviewReasons]
    }));

  return { batchId, candidates: importable.map(toDocument), heldBack };
}
