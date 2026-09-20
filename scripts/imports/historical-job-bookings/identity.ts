/**
 * Import identity: a stable key for a historical source row.
 *
 * `Submission ID` is the obvious key — it is the only column populated on every
 * row — but the export holds 287 distinct values across 303 rows. Ten
 * identifiers are shared by 26 rows, so the key alone is not unique and the
 * second row of a pair would silently vanish on a rerun.
 *
 * What the duplicates actually are
 * --------------------------------
 * Inspected rather than assumed. In all ten groups every row carries the same
 * legacy `Reference` and the same customer identity (surname, postcode, email,
 * phone, submission timestamp). Most are byte-identical across all 94 columns;
 * in three groups one row differs in a non-identity field.
 *
 * So the duplicates are the same submission exported more than once, sometimes
 * after an edit — not different jobs that happen to share an identifier. Any
 * rule that gave them separate job records would create duplicate jobs for one
 * real household, which is precisely the failure the import must not have.
 *
 * The rule therefore branches on evidence rather than on the count:
 *
 *   one row with this Submission ID
 *       key = the Submission ID, unchanged.
 *
 *   several rows, all with the same identity fingerprint
 *       one job. They collapse to a single candidate keyed on the Submission
 *       ID, and every contributing source row is recorded in provenance, so
 *       nothing is discarded — it is reconciled.
 *
 *   several rows with different identity fingerprints
 *       genuinely different jobs sharing a reused identifier. Each keeps the
 *       Submission ID verbatim and gains its identity fingerprint as a
 *       discriminator, so both remain independently addressable.
 *
 * Stability
 * ---------
 * The discriminator is derived from the row's own identity fields, never from
 * its position, so reordering or re-exporting the CSV cannot change any key.
 * Editing a non-identity field does not change the key either: it changes the
 * payload hash, which is what makes a changed re-export detectable as an
 * update instead of appearing as a new record.
 */

import { createHash } from 'node:crypto';
import { cell } from './csv';
import { nameKey, emailKey, normaliseSpace } from './normalise';

const SEP = '';

/** Columns that identify *which household and sale* a row is about. */
const IDENTITY_COLUMNS = {
  lastName: [63, 5],
  postcode: [61, 3],
  email: [6],
  phone: [37],
  submittedAt: [41]
} as const;

function firstPopulated(row: string[], indices: readonly number[]): string {
  for (const i of indices) {
    const v = cell(row, i);
    if (v !== '') return v;
  }
  return '';
}

/**
 * A fingerprint of who the row is about, normalised so that formatting drift
 * between exports does not read as a different household.
 */
export function identityFingerprint(row: string[]): string {
  const parts = [
    nameKey(firstPopulated(row, IDENTITY_COLUMNS.lastName)),
    firstPopulated(row, IDENTITY_COLUMNS.postcode)
      .toUpperCase()
      .replace(/\s+/g, ''),
    emailKey(firstPopulated(row, IDENTITY_COLUMNS.email)),
    firstPopulated(row, IDENTITY_COLUMNS.phone).replace(/\D/g, ''),
    normaliseSpace(firstPopulated(row, IDENTITY_COLUMNS.submittedAt))
  ];
  return createHash('sha256').update(parts.join(SEP)).digest('hex');
}

/** A hash of the whole row, so a changed re-export is detectable. */
export function payloadHash(row: string[]): string {
  return createHash('sha256')
    .update(row.map((c) => c.trim()).join(SEP))
    .digest('hex');
}

/** How many cells the row actually carries. Used to pick the fullest version. */
function populatedCount(row: string[]): number {
  return row.reduce((n, c) => (c.trim() !== '' ? n + 1 : n), 0);
}

export type SourceRowRef = {
  rowNumber: number;
  payloadHash: string;
  populated: number;
};

export type ImportIdentity = {
  /** The Submission ID exactly as exported. Never modified. */
  submissionId: string;
  /** Submission ID, plus a discriminator only where one is genuinely needed. */
  importKey: string;
  /** True when a discriminator was appended. */
  discriminated: boolean;
  identityFingerprint: string;
  payloadHash: string;
  /** The source row this candidate was built from. */
  primaryRow: number;
  /** Every source row that collapsed into this candidate, including the primary. */
  contributingRows: SourceRowRef[];
  /** Set when other rows collapsed in and their content differed. */
  supersededPayloadHashes: string[];
  notes: string[];
};

/**
 * Resolves identity for the whole export in one pass, because a row's key
 * depends on what else shares its Submission ID.
 *
 * Returns one entry per *job*, not per source row: collapsed duplicates appear
 * once, with their siblings listed in `contributingRows`.
 */
export function resolveIdentities(rows: string[][]): ImportIdentity[] {
  const bySubmission = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const id = cell(row, 92);
    const list = bySubmission.get(id) ?? [];
    list.push(index);
    bySubmission.set(id, list);
  });

  const out: ImportIdentity[] = [];

  for (const [submissionId, indices] of Array.from(bySubmission.entries())) {
    // Group the rows sharing this identifier by who they are about.
    const byIdentity = new Map<string, number[]>();
    for (const index of indices) {
      const fp = identityFingerprint(rows[index]);
      const list = byIdentity.get(fp) ?? [];
      list.push(index);
      byIdentity.set(fp, list);
    }

    const needsDiscriminator = byIdentity.size > 1;

    for (const [fingerprint, groupIndices] of Array.from(
      byIdentity.entries()
    )) {
      const refs: SourceRowRef[] = groupIndices.map((index) => ({
        rowNumber: index + 1,
        payloadHash: payloadHash(rows[index]),
        populated: populatedCount(rows[index])
      }));

      // The fullest version wins. Ties break on the payload hash rather than on
      // position, so the winner does not change if the export is reordered.
      const primary = refs
        .slice()
        .sort(
          (a, b) =>
            b.populated - a.populated ||
            (a.payloadHash < b.payloadHash ? 1 : -1)
        )[0];

      const superseded = refs
        .filter((r) => r.payloadHash !== primary.payloadHash)
        .map((r) => r.payloadHash);

      const notes: string[] = [];
      if (refs.length > 1) {
        notes.push(
          superseded.length === 0
            ? `${refs.length} identical source rows share this Submission ID and describe one job; collapsed to one record`
            : `${refs.length} source rows share this Submission ID and describe one job; ${superseded.length} differ in non-identity fields and were superseded by the fullest version`
        );
      }
      if (needsDiscriminator) {
        notes.push(
          'this Submission ID is reused by a different customer, so the key carries an identity discriminator and both records remain addressable'
        );
      }
      if (submissionId === '') {
        notes.push(
          'no Submission ID on this row; identity rests on the fingerprint alone'
        );
      }

      out.push({
        submissionId,
        importKey: needsDiscriminator
          ? `${submissionId}#${fingerprint.slice(0, 12)}`
          : submissionId,
        discriminated: needsDiscriminator,
        identityFingerprint: fingerprint,
        payloadHash: primary.payloadHash,
        primaryRow: primary.rowNumber,
        contributingRows: refs.sort((a, b) => a.rowNumber - b.rowNumber),
        supersededPayloadHashes: superseded,
        notes
      });
    }
  }

  return out.sort((a, b) => a.primaryRow - b.primaryRow);
}
