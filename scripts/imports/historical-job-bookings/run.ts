/**
 * The historical Job Booking import runner.
 *
 * Dry run is not a flag you remember to pass: it is the only mode this file
 * implements. There is no database client in this module, no Supabase import
 * anywhere in this directory, and `--write` is recognised only so that it can
 * be refused with an explanation. Write mode is a later, separately reviewed
 * change.
 *
 *   npm run import:historical-bookings -- --analyse
 *   npm run import:historical-bookings -- --dry-run
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { parseCsv, cell } from './csv';
import {
  COLUMNS,
  GENERATION_PAIRS,
  CONDITIONAL_BRANCHES,
  verifyRegistry,
  type ColumnSpec
} from './columns';
import {
  loadDirectoryFromSeed,
  loadDirectoryFromSnapshot,
  type Directory
} from './directory';
import {
  transformRow,
  SOURCE_FORM_ID,
  IMPORTER_VERSION,
  type Candidate
} from './transform';
import { resolveIdentities } from './identity';
import { matchJob } from './match';
import { validate, FORBIDDEN_TABLES, type Validated } from './validate';
import { looksLikeDate } from './normalise';
import { token, maskEmail, maskPostcode, maskName, maskPhone } from './redact';

const ROOT = process.cwd();
const BASE = path.join(ROOT, 'data-import/historical-job-bookings');

const DEFAULTS = {
  source: path.join(BASE, 'source/job-booking-form-responses.csv'),
  analysis: path.join(BASE, 'analysis'),
  privateDir: path.join(BASE, 'private'),
  seed: path.join(ROOT, 'supabase/seeds/001_staff.sql')
};

type Options = {
  source: string;
  snapshot: string | null;
  mode: 'analyse' | 'dry-run';
  writeRequested: boolean;
};

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')
      ? argv[i + 1]
      : null;
  };
  return {
    source: get('--source') ?? DEFAULTS.source,
    snapshot: get('--snapshot'),
    mode: argv.includes('--analyse') ? 'analyse' : 'dry-run',
    writeRequested: argv.includes('--write') || argv.includes('--apply')
  };
}

// --- Column profiling --------------------------------------------------------

type ColumnProfile = {
  index: number;
  header: string;
  populated: number;
  blank: number;
  distinct: number;
  inferredType: string;
  /** Redacted or shape-only examples. Never raw customer values. */
  examples: string[];
  anomalies: string[];
  disposition: ColumnSpec['disposition'];
  destination: string | null;
};

/**
 * Columns whose values are customer identity and must never be shown.
 *
 * Column 0 (`Reference`) is included because the legacy reference is built
 * from the customer's postcode plus a counter, so printing it discloses the
 * postcode just as directly as column 3 or 61 would.
 */
const PII_COLUMNS = new Set([0, 1, 2, 3, 4, 5, 6, 37, 40, 61, 62, 63]);

function inferType(values: string[]): string {
  if (values.length === 0) return 'empty';
  const all = (fn: (v: string) => boolean) => values.every(fn);
  const some = (fn: (v: string) => boolean) => values.some(fn);

  if (all((v) => /^\d+$/.test(v))) return 'integer';
  if (all((v) => /^\d+(\.\d+)?$/.test(v))) return 'decimal';
  if (all(looksLikeDate)) return 'date';
  if (all((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return 'email';
  if (all((v) => /^(yes|no|1|0)$/i.test(v))) return 'boolean';
  if (some((v) => v.includes('\n'))) return 'multi-select (newline separated)';
  if (some(looksLikeDate) && some((v) => /^\d+$/.test(v)))
    return 'MIXED: dates and integers';
  return 'text';
}

function exampleFor(index: number, value: string): string {
  if (!PII_COLUMNS.has(index)) {
    return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  }
  if (index === 6) return maskEmail(value);
  if (index === 37) return maskPhone(value);
  if (index === 3 || index === 61) return `${maskPostcode(value)} ***`;
  if (index === 4 || index === 5 || index === 62 || index === 63)
    return maskName(value);
  // The legacy reference embeds a full postcode; keep the shape only.
  if (index === 0) return value.replace(/[A-Za-z]/g, 'A').replace(/\d/g, '9');
  // Address and MPAN: shape only.
  return value
    .replace(/[A-Za-z]/g, 'A')
    .replace(/\d/g, '9')
    .slice(0, 24);
}

function profileColumns(header: string[], rows: string[][]): ColumnProfile[] {
  return COLUMNS.map((spec) => {
    const values = rows.map((r) => cell(r, spec.index)).filter((v) => v !== '');
    const distinct = new Set(values);
    const anomalies: string[] = [];

    const dateish = values.filter(looksLikeDate).length;
    if (dateish > 0 && dateish < values.length && !/date/i.test(spec.header)) {
      anomalies.push(
        `${dateish} of ${values.length} values look like dates in a column that is not a date column`
      );
    }
    if (values.length > 0 && distinct.size === 1) {
      anomalies.push('single constant value across every populated row');
    }
    const duplicateLabel = header.filter((h) => h === spec.header).length;
    if (duplicateLabel > 1) {
      anomalies.push(
        `header label is shared with ${duplicateLabel - 1} other column(s)`
      );
    }
    if (/\s$/.test(spec.header))
      anomalies.push('header has trailing whitespace');

    return {
      index: spec.index,
      header: spec.header,
      populated: values.length,
      blank: rows.length - values.length,
      distinct: distinct.size,
      inferredType: inferType(values),
      examples: Array.from(distinct)
        .slice(0, 3)
        .map((v) => exampleFor(spec.index, v)),
      anomalies,
      disposition: spec.disposition,
      destination: spec.destinationTable
    };
  });
}

// --- Report ------------------------------------------------------------------

function summarise(results: Validated[]) {
  const count = (fn: (r: Validated) => boolean) => results.filter(fn).length;
  const peopleValues = new Map<
    string,
    { kind: string; candidates: string[]; rows: number }
  >();

  for (const r of results) {
    const all = [
      ...(r.candidate.job.salesperson ? [r.candidate.job.salesperson] : []),
      ...r.candidate.people.installers,
      ...r.candidate.people.electricians
    ];
    for (const m of all) {
      const existing = peopleValues.get(m.raw);
      if (existing) existing.rows += 1;
      else
        peopleValues.set(m.raw, {
          kind: m.kind,
          candidates: m.candidates,
          rows: 1
        });
    }
  }

  const warningCodes = new Map<string, number>();
  for (const r of results) {
    for (const w of r.candidate.warnings) {
      warningCodes.set(w.code, (warningCodes.get(w.code) ?? 0) + 1);
    }
  }

  const blockerCodes = new Map<string, number>();
  for (const r of results) {
    for (const b of r.blockers)
      blockerCodes.set(b.code, (blockerCodes.get(b.code) ?? 0) + 1);
  }

  return {
    totals: {
      rows: results.length,
      ready: count((r) => r.classification === 'READY'),
      readyWithWarnings: count(
        (r) => r.classification === 'READY_WITH_WARNINGS'
      ),
      ownerReviewRequired: count(
        (r) => r.classification === 'OWNER_REVIEW_REQUIRED'
      ),
      rejected: count((r) => r.classification === 'REJECTED')
    },
    jobMatching: {
      alreadyImported: count((r) => r.jobMatch.kind === 'ALREADY_IMPORTED'),
      exactExisting: count((r) => r.jobMatch.kind === 'EXACT_EXISTING_JOB'),
      probableExisting: count(
        (r) => r.jobMatch.kind === 'PROBABLE_EXISTING_JOB'
      ),
      ambiguous: count((r) => r.jobMatch.kind === 'AMBIGUOUS'),
      newHistorical: count((r) => r.jobMatch.kind === 'NEW_HISTORICAL_JOB')
    },
    people: {
      distinctValues: peopleValues.size,
      exact: Array.from(peopleValues.values()).filter(
        (v) => v.kind === 'EXACT_MATCH'
      ).length,
      safeNormalised: Array.from(peopleValues.values()).filter(
        (v) => v.kind === 'SAFE_NORMALISED_MATCH'
      ).length,
      ambiguous: Array.from(peopleValues.values()).filter(
        (v) => v.kind === 'AMBIGUOUS'
      ).length,
      noMatch: Array.from(peopleValues.values()).filter(
        (v) => v.kind === 'NO_MATCH'
      ).length,
      nonPerson: Array.from(peopleValues.values()).filter(
        (v) => v.kind === 'NON_PERSON_VALUE'
      ).length,
      values: Array.from(peopleValues.entries())
        .map(([raw, v]) => ({
          value: raw,
          kind: v.kind,
          candidates: v.candidates,
          rows: v.rows
        }))
        .sort((a, b) => b.rows - a.rows)
    },
    coverage: {
      rowsWithMaterials: count((r) => r.candidate.materials.length > 0),
      materialLines: results.reduce(
        (n, r) => n + r.candidate.materials.length,
        0
      ),
      rowsWithScaffoldCompany: count(
        (r) => r.candidate.scaffold.companyName !== null
      ),
      rowsScaffoldNotRequired: count(
        (r) => r.candidate.scaffold.required === false
      ),
      rowsWithRoofDate: count((r) => r.candidate.work.roofDate !== null),
      rowsWithElectricalDate: count(
        (r) => r.candidate.work.electricalDate !== null
      ),
      rowsWithEquipment: count((r) => r.candidate.equipment.length > 0),
      rowsWithTechnical: count((r) => r.candidate.technical.systemKw !== null),
      rowsWithMpan: count((r) => r.candidate.technical.mpan !== null),
      rowsWithCost: count((r) => r.candidate.job.grossPence !== null),
      rowsWithFinanceAnswer: count(
        (r) => r.candidate.job.financeRoute !== null
      ),
      rowsWithFiles: count((r) => r.candidate.files.length > 0)
    },
    files: results
      .flatMap((r) => r.candidate.files)
      .reduce<Record<string, number>>((acc, f) => {
        const key = `${f.status}:${f.host}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    warningCodes: Object.fromEntries(
      Array.from(warningCodes.entries()).sort((a, b) => b[1] - a[1])
    ),
    blockerCodes: Object.fromEntries(
      Array.from(blockerCodes.entries()).sort((a, b) => b[1] - a[1])
    ),
    proposedOperations: results
      .flatMap((r) => r.operations)
      .reduce<Record<string, number>>((acc, op) => {
        acc[`${op.table}.${op.action}`] =
          (acc[`${op.table}.${op.action}`] ?? 0) + 1;
        return acc;
      }, {})
  };
}

// --- Entry point -------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.writeRequested) {
    console.error(
      'Refused: this importer has no write mode.\n' +
        'It contains no database client, and hosted writes are blocked by an\n' +
        'outstanding schema gap (see analysis/owner-decisions.md, decision 1).'
    );
    process.exitCode = 2;
    return;
  }

  if (!existsSync(opts.source)) {
    console.error(`Source CSV not found: ${opts.source}`);
    process.exitCode = 1;
    return;
  }

  const text = readFileSync(opts.source, 'utf8');
  const table = parseCsv(text);

  const problems = verifyRegistry(table.header);
  if (problems.length > 0) {
    console.error('The source file does not match the column registry:');
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exitCode = 1;
    return;
  }

  const directory: Directory = opts.snapshot
    ? loadDirectoryFromSnapshot(opts.snapshot)
    : loadDirectoryFromSeed(DEFAULTS.seed);

  const batchId = createHash('sha256')
    .update(`${SOURCE_FORM_ID}:${IMPORTER_VERSION}:${table.rows.length}`)
    .digest('hex')
    .slice(0, 12);

  const profiles = profileColumns(table.header, table.rows);

  // Identity is resolved across the whole export before any row is
  // transformed, because a row's key depends on what else shares its
  // Submission ID. Rows that describe the same job collapse to one candidate.
  const identities = resolveIdentities(table.rows);
  const collapsed = identities.filter((i) => i.contributingRows.length > 1);
  const discriminated = identities.filter((i) => i.discriminated);

  const candidates: Candidate[] = identities.map((identity) =>
    transformRow(
      table.rows[identity.primaryRow - 1],
      identity.primaryRow,
      directory,
      batchId,
      identity
    )
  );

  // A salted snapshot holds hashed customer identifiers, so the CSV side is
  // hashed identically before comparison. Equality is all the matcher needs,
  // so this changes no result - it only keeps plaintext customer data out of
  // the snapshot file.
  const salt = directory.salt;
  const hashed = (value: string | null, normalise: (v: string) => string) => {
    if (value === null) return null;
    if (!salt) return value;
    return createHash('md5')
      .update(salt + normalise(value))
      .digest('hex');
  };

  const results: Validated[] = candidates.map((c) => {
    const jobMatch = matchJob(
      {
        intakeKey: c.provenance.intakeKey,
        postcode: hashed(c.customer.postcode, (v) =>
          v.toUpperCase().replace(/ /g, '')
        ),
        email: hashed(c.customer.email, (v) => v.trim().toLowerCase()),
        lastName: hashed(c.customer.lastName, (v) => v.trim().toLowerCase()),
        soldAt: c.job.soldAt
      },
      directory
    );
    return validate(c, jobMatch);
  });

  const summary = summarise(results);

  if (opts.mode === 'analyse') {
    console.log(`rows ${table.rows.length}  columns ${table.header.length}`);
    console.log(
      `blank rows dropped ${table.blankRowsDropped}  ragged rows ${table.raggedRows.length}`
    );
    const ids = resolveIdentities(table.rows);
    console.log(
      `import candidates: ${ids.length} (from ${table.rows.length} source rows)`
    );
    for (const p of profiles) {
      const flags =
        p.anomalies.length > 0 ? `  !! ${p.anomalies.join('; ')}` : '';
      console.log(
        `${String(p.index).padStart(2)} ${p.header.padEnd(62).slice(0, 62)} ` +
          `pop=${String(p.populated).padStart(3)} uniq=${String(p.distinct).padStart(3)} ` +
          `${p.inferredType.padEnd(30)} ${p.disposition}${flags}`
      );
    }
    return;
  }

  mkdirSync(DEFAULTS.analysis, { recursive: true });
  mkdirSync(DEFAULTS.privateDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    importerVersion: IMPORTER_VERSION,
    batchId,
    mode: 'dry-run',
    hostedWrites: 0,
    directorySource: directory.source,
    jobMatchingAuthoritative: directory.jobsAuthoritative,
    hostedCounts: directory.counts ?? null,
    identifiersHashed: directory.salt !== null,
    forbiddenTables: FORBIDDEN_TABLES,
    source: {
      rows: table.rows.length,
      columns: table.header.length,
      blankRowsDropped: table.blankRowsDropped,
      raggedRows: table.raggedRows,
      importCandidates: identities.length,
      duplicateSubmissionIds: collapsed.map((i) => ({
        submissionIdToken: token(i.submissionId),
        rows: i.contributingRows.map((r) => r.rowNumber),
        distinctContent: new Set(i.contributingRows.map((r) => r.payloadHash))
          .size,
        resolution: i.discriminated ? 'discriminated' : 'collapsed to one job',
        notes: i.notes
      })),
      reusedAcrossCustomers: discriminated.length
    },
    mapping: {
      totalColumns: COLUMNS.length,
      imported: COLUMNS.filter((c) => c.disposition === 'IMPORT').length,
      preserveOnly: COLUMNS.filter((c) => c.disposition === 'PRESERVE_ONLY')
        .length,
      ignored: COLUMNS.filter((c) => c.disposition === 'IGNORE').length,
      unmapped: COLUMNS.filter((c) => !c.disposition).length,
      generationPairs: GENERATION_PAIRS,
      conditionalBranches: CONDITIONAL_BRANCHES,
      byReason: COLUMNS.reduce<Record<string, number>>((acc, c) => {
        if (c.noDestinationReason)
          acc[c.noDestinationReason] = (acc[c.noDestinationReason] ?? 0) + 1;
        return acc;
      }, {})
    },
    columns: profiles,
    summary,
    rows: results.map((r) => ({
      row: r.candidate.rowNumber,
      submissionIdToken: token(r.candidate.provenance.submissionId),
      customerToken: token(
        `${r.candidate.customer.lastName ?? ''}|${r.candidate.customer.postcode ?? ''}`
      ),
      classification: r.classification,
      jobMatch: r.jobMatch.kind,
      jobMatchRef: r.jobMatch.jobRef,
      blockers: r.blockers.map((b) => b.code),
      reviewReasons: r.reviewReasons,
      warnings: r.candidate.warnings.map((w) => ({
        column: w.column,
        code: w.code
      })),
      operations: r.operations.map((o) => `${o.table}.${o.action}`)
    }))
  };

  const reportPath = path.join(DEFAULTS.analysis, 'dry-run-report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  // Local-only reconciliation file. The gitignore covers the whole directory.
  const reviewRows = results.filter(
    (r) =>
      r.classification === 'OWNER_REVIEW_REQUIRED' ||
      r.classification === 'REJECTED'
  );
  const csvEscape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const reviewCsv = [
    [
      'row',
      'submission_id',
      'classification',
      'customer_name',
      'postcode',
      'email',
      'reasons'
    ].join(','),
    ...reviewRows.map((r) =>
      [
        r.candidate.rowNumber,
        csvEscape(r.candidate.provenance.submissionId),
        r.classification,
        csvEscape(
          `${r.candidate.customer.firstName ?? ''} ${r.candidate.customer.lastName ?? ''}`.trim()
        ),
        csvEscape(r.candidate.customer.postcode ?? ''),
        csvEscape(r.candidate.customer.email ?? ''),
        csvEscape(
          [...r.blockers.map((b) => b.message), ...r.reviewReasons].join(' | ')
        )
      ].join(',')
    )
  ].join('\n');
  writeFileSync(
    path.join(DEFAULTS.privateDir, 'review-required.csv'),
    `${reviewCsv}\n`
  );

  console.log(`dry run complete — hosted writes: 0`);
  console.log(
    `source rows ${table.rows.length} -> ${identities.length} import candidates ` +
      `(${table.rows.length - identities.length} duplicate source rows collapsed)`
  );
  console.log(
    `candidates ${summary.totals.rows}  ready ${summary.totals.ready}  ` +
      `ready+warnings ${summary.totals.readyWithWarnings}  ` +
      `review ${summary.totals.ownerReviewRequired}  rejected ${summary.totals.rejected}`
  );
  console.log(`report  ${path.relative(ROOT, reportPath)}`);
  console.log(
    `private ${path.relative(ROOT, path.join(DEFAULTS.privateDir, 'review-required.csv'))} (gitignored, ${reviewRows.length} rows)`
  );
}

main();
