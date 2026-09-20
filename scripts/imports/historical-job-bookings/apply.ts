/**
 * Write mode.
 *
 * Separate from `run.ts` on purpose: the dry run has no write path at all, and
 * this file cannot be reached by adding a flag to it. Running this file is a
 * deliberate act, and even then it refuses unless every one of these holds:
 *
 *   1. `--target <url>` names the database explicitly. There is no default.
 *   2. The target is not hosted production. The hosted host is read from .env
 *      and refused by name, so a copied-and-pasted production URL fails here
 *      rather than at the first insert.
 *   3. `--confirm <token>` matches a token derived from the target and the
 *      candidate count, printed by a preceding `--plan` run. A token from a
 *      different database or a different batch does not match.
 *   4. Production would additionally require HISTORICAL_IMPORT_ALLOW_PRODUCTION,
 *      which is not implemented in this file: the constant below is `false` and
 *      the production branch refuses unconditionally. Enabling it is a separate,
 *      separately reviewed change.
 *
 * The importer never issues SQL built from source data. It sends each candidate
 * as one jsonb parameter to app.historical_import_apply, which does the writing.
 *
 *   npx jiti scripts/.../apply.ts --target <url> --plan
 *   npx jiti scripts/.../apply.ts --target <url> --confirm <token>
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { parseCsv } from './csv';
import { verifyRegistry } from './columns';
import {
  loadDirectoryFromSeed,
  loadDirectoryFromSnapshot,
  type Directory
} from './directory';
import { transformRow, SOURCE_FORM_ID, IMPORTER_VERSION } from './transform';
import { resolveIdentities } from './identity';
import { matchJob } from './match';
import { validate } from './validate';
import { buildImportDocument, type ImportDocument } from './document';

/**
 * Production import is not implemented. This is not a runtime switch: the
 * branch that would need it refuses regardless, and no code path sets it.
 */
const PRODUCTION_IMPORT_IMPLEMENTED = false;

const ROOT = process.cwd();
const BASE = path.join(ROOT, 'data-import/historical-job-bookings');

type Options = {
  source: string;
  snapshot: string | null;
  target: string | null;
  confirm: string | null;
  plan: boolean;
};

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')
      ? argv[i + 1]
      : null;
  };
  return {
    source:
      get('--source') ??
      path.join(BASE, 'source/job-booking-form-responses.csv'),
    snapshot: get('--snapshot'),
    target: get('--target'),
    confirm: get('--confirm'),
    plan: argv.includes('--plan')
  };
}

/** The hosted host, read from .env so it is refused by name and not by guess. */
function hostedHost(): string | null {
  try {
    const env = readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = /^NEXT_PUBLIC_SUPABASE_URL=.*?([a-z0-9]+)\.supabase\.co/m.exec(
      env
    );
    return m ? `db.${m[1]}.supabase.co` : null;
  } catch {
    return null;
  }
}

function isProduction(target: string): boolean {
  const hosted = hostedHost();
  const lowered = target.toLowerCase();
  if (hosted && lowered.includes(hosted.toLowerCase())) return true;
  // Any Supabase-managed host is treated as production unless it is a local
  // stack, because a pooler URL does not name the project the same way.
  if (
    /\.supabase\.(co|com)/.test(lowered) &&
    !/127\.0\.0\.1|localhost/.test(lowered)
  )
    return true;
  return false;
}

/** Ties a confirmation to one target and one exact batch. */
function confirmationToken(target: string, doc: ImportDocument): string {
  return createHash('sha256')
    .update(
      `${target}${doc.batchId}${doc.candidates.length}${IMPORTER_VERSION}`
    )
    .digest('hex')
    .slice(0, 16);
}

/** Escapes one JSON document for a COPY text-format line. */
function copyEscape(json: string): string {
  return json.replace(/\\/g, '\\\\');
}

function psql(target: string, sqlFile: string): string {
  return execFileSync(
    'psql',
    [target, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-f', sqlFile],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.target) {
    console.error(
      'Refused: --target is required and has no default.\n' +
        'Write mode never guesses which database it is writing to.'
    );
    process.exitCode = 2;
    return;
  }

  if (isProduction(opts.target)) {
    console.error(
      'Refused: the target looks like hosted production.\n' +
        (PRODUCTION_IMPORT_IMPLEMENTED
          ? 'Production import requires a separate authorisation step.'
          : 'Production import is not implemented in this importer. It is a separate,\n' +
            'separately reviewed change, and no flag in this file enables it.')
    );
    process.exitCode = 3;
    return;
  }

  // --- Build the batch -------------------------------------------------------
  const table = parseCsv(readFileSync(opts.source, 'utf8'));
  const problems = verifyRegistry(table.header);
  if (problems.length > 0) {
    console.error(
      'Refused: the source file does not match the column registry.'
    );
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exitCode = 1;
    return;
  }

  const directory: Directory = opts.snapshot
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

  const doc = buildImportDocument(validated, batchId);

  if (opts.plan) {
    console.log(`target        ${opts.target.replace(/:[^:@/]*@/, ':***@')}`);
    console.log(`batch         ${doc.batchId}`);
    console.log(`candidates    ${identities.length}`);
    console.log(`importable    ${doc.candidates.length}`);
    console.log(`held back     ${identities.length - doc.candidates.length}`);
    console.log('');
    console.log('To apply, re-run with:');
    console.log(`  --confirm ${confirmationToken(opts.target, doc)}`);
    return;
  }

  const expected = confirmationToken(opts.target, doc);
  if (opts.confirm !== expected) {
    console.error(
      opts.confirm
        ? 'Refused: the confirmation token does not match this target and batch.\n' +
            'Re-run with --plan to get the current token.'
        : 'Refused: --confirm is required. Re-run with --plan to get the token.'
    );
    process.exitCode = 4;
    return;
  }

  // --- Apply -----------------------------------------------------------------
  // One transaction. Each candidate is a jsonb parameter, never interpolated
  // SQL. app.historical_import_apply decides per candidate whether it is new.
  const work =
    mkdirSync(path.join(os.tmpdir(), `hist-import-${doc.batchId}`), {
      recursive: true
    }) ?? path.join(os.tmpdir(), `hist-import-${doc.batchId}`);
  const dataFile = path.join(work as string, 'candidates.txt');
  const sqlFile = path.join(work as string, 'apply.sql');

  writeFileSync(
    dataFile,
    `${doc.candidates.map((c) => copyEscape(JSON.stringify(c))).join('\n')}\n`
  );

  writeFileSync(
    sqlFile,
    [
      'begin;',
      'create temp table _hist_batch (doc jsonb) on commit drop;',
      `\\copy _hist_batch (doc) from '${dataFile}'`,
      "select coalesce(jsonb_agg(r), '[]'::jsonb)::text",
      '  from (select app.historical_import_apply(doc, false) r from _hist_batch) s;',
      'commit;'
    ].join('\n')
  );

  const out = psql(opts.target, sqlFile).trim();
  const results = JSON.parse(
    out
      .split('\n')
      .filter((l) => l.trim() !== '')
      .pop() ?? '[]'
  ) as Array<{
    ok: boolean;
    action?: string;
    job_ref?: string;
    source_changed?: boolean;
    writes?: number;
  }>;

  const imported = results.filter((r) => r.action === 'imported').length;
  const skipped = results.filter((r) => r.action === 'skipped').length;
  const changed = results.filter((r) => r.source_changed).length;
  const failed = results.filter((r) => !r.ok).length;
  const writes = results.reduce((n, r) => n + (r.writes ?? 0), 0);

  const summary = {
    batchId: doc.batchId,
    importerVersion: IMPORTER_VERSION,
    target: opts.target.replace(/:[^:@/]*@/, ':***@'),
    finishedAt: new Date().toISOString(),
    candidates: identities.length,
    submitted: doc.candidates.length,
    heldBack: identities.length - doc.candidates.length,
    imported,
    skippedAlreadyImported: skipped,
    sourceChangedSincePreviousImport: changed,
    failed,
    rowsWritten: writes
  };

  mkdirSync(path.join(BASE, 'analysis'), { recursive: true });
  writeFileSync(
    path.join(BASE, 'analysis', 'import-run-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`
  );

  console.log(JSON.stringify(summary, null, 2));
}

main();
