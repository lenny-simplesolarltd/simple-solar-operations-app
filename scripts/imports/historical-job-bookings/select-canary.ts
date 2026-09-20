/**
 * Canary selection: pick a handful of representative importable candidates and
 * describe them WITHOUT naming anybody.
 *
 * Read-only. It builds the same candidates the dry run builds, using the same
 * reviewed pipeline, and prints one line per candidate: the import key (a
 * Jotform submission id, not customer data) and a set of yes/no facts. No
 * customer name, address, postcode, email, phone or MPAN is ever printed.
 *
 *   npx jiti scripts/imports/historical-job-bookings/select-canary.ts
 *   npx jiti scripts/imports/historical-job-bookings/select-canary.ts --keys A,B
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { parseCsv } from './csv';
import { verifyRegistry } from './columns';
import { loadDirectoryFromSeed, loadDirectoryFromSnapshot } from './directory';
import { transformRow, SOURCE_FORM_ID, IMPORTER_VERSION } from './transform';
import { resolveIdentities } from './identity';
import { matchJob } from './match';
import { validate, type Validated } from './validate';

const ROOT = process.cwd();
const BASE = path.join(ROOT, 'data-import/historical-job-bookings');

export function buildValidated(opts: {
  source?: string;
  snapshot?: string | null;
}): { validated: Validated[]; batchId: string } {
  const source =
    opts.source ?? path.join(BASE, 'source/job-booking-form-responses.csv');
  const table = parseCsv(readFileSync(source, 'utf8'));
  const problems = verifyRegistry(table.header);
  if (problems.length > 0) {
    throw new Error(
      `source does not match the column registry:\n${problems.join('\n')}`
    );
  }
  const directory = opts.snapshot
    ? loadDirectoryFromSnapshot(opts.snapshot)
    : loadDirectoryFromSeed(path.join(ROOT, 'supabase/seeds/001_staff.sql'));
  const batchId = createHash('sha256')
    .update(`${SOURCE_FORM_ID}:${IMPORTER_VERSION}:${table.rows.length}`)
    .digest('hex')
    .slice(0, 12);
  const identities = resolveIdentities(table.rows);
  const validated = identities.map((identity) => {
    const candidate = transformRow(
      table.rows[identity.primaryRow - 1],
      identity.primaryRow,
      directory,
      batchId,
      identity
    );
    const jobMatch = matchJob(
      {
        intakeKey: candidate.provenance.intakeKey,
        postcode: candidate.customer.postcode,
        email: candidate.customer.email,
        lastName: candidate.customer.lastName,
        soldAt: candidate.job.soldAt
      },
      directory
    );
    return validate(candidate, jobMatch);
  });
  return { validated, batchId };
}

/** Facts a reviewer needs to choose a representative sample. Never identity. */
function facts(v: Validated) {
  const c = v.candidate;
  const staff = [...c.people.installers, ...c.people.electricians];
  const t = c.technical;
  return {
    importKey: c.provenance.importKey,
    legacyRef: c.provenance.legacyReference ?? '-',
    classification: v.classification,
    priceKnown: c.job.grossPence !== null,
    financeKnown: c.job.financeRoute !== null,
    soldAtKnown: c.job.soldAt !== null,
    salesperson: c.job.salesperson ? c.job.salesperson.kind : 'NONE',
    staffAmbiguous: staff.some((p) => p.kind === 'AMBIGUOUS'),
    staffResolved: staff.some(
      (p) => p.kind === 'EXACT_MATCH' || p.kind === 'SAFE_NORMALISED_MATCH'
    ),
    staffCount: staff.length,
    technicalFields: [
      t.systemKw,
      t.batteryKwh,
      t.annualGenerationKwh,
      t.annualConsumptionKwh,
      t.fuseRatingAmps,
      t.roofType,
      t.g99Status
    ].filter((x) => x !== null && x !== '').length,
    equipment: c.equipment.length,
    scaffoldKnown: c.job.scaffoldRequired !== null,
    workDates: [c.work.roofDate, c.work.electricalDate].filter(Boolean).length,
    warnings: c.warnings.length,
    operations: v.operations.length
  };
}

function main() {
  const argv = process.argv.slice(2);
  const keysArg = argv.indexOf('--keys');
  const wanted =
    keysArg !== -1 && argv[keysArg + 1]
      ? new Set(argv[keysArg + 1].split(',').map((s) => s.trim()))
      : null;

  const { validated, batchId } = buildValidated({});
  const importable = validated.filter(
    (v) =>
      v.classification === 'READY' || v.classification === 'READY_WITH_WARNINGS'
  );

  console.log(`batch ${batchId}  importer ${IMPORTER_VERSION}`);
  console.log(
    `candidates ${validated.length}  importable ${importable.length}  ` +
      `review ${validated.filter((v) => v.classification === 'OWNER_REVIEW_REQUIRED').length}  ` +
      `rejected ${validated.filter((v) => v.classification === 'REJECTED').length}`
  );
  console.log('');

  const rows = (
    wanted
      ? importable.filter((v) => wanted.has(v.candidate.provenance.importKey))
      : importable
  ).map(facts);

  if (wanted) {
    for (const r of rows) console.log(JSON.stringify(r));
    console.log(`\nmatched ${rows.length} of ${wanted.size} requested keys`);
    return;
  }

  // Candidate pools for each case the canary needs to cover.
  const pool = {
    rich: rows
      .filter(
        (r) =>
          r.priceKnown &&
          r.financeKnown &&
          r.salesperson !== 'NONE' &&
          r.salesperson !== 'AMBIGUOUS' &&
          r.technicalFields >= 4 &&
          r.staffResolved
      )
      .sort(
        (a, b) =>
          b.technicalFields + b.equipment - (a.technicalFields + a.equipment)
      ),
    ambiguousSales: rows.filter((r) => r.salesperson === 'AMBIGUOUS'),
    noFinance: rows.filter((r) => !r.financeKnown),
    noPrice: rows.filter((r) => !r.priceKnown),
    ambiguousStaff: rows
      .filter((r) => r.staffAmbiguous)
      .sort((a, b) => b.technicalFields - a.technicalFields)
  };

  for (const [name, list] of Object.entries(pool)) {
    console.log(`--- ${name}: ${list.length} available`);
    for (const r of list.slice(0, 4)) console.log(`    ${JSON.stringify(r)}`);
  }
}

if (process.argv[1] && process.argv[1].includes('select-canary')) main();
