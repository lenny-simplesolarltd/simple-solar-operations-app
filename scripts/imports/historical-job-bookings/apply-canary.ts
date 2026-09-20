/**
 * PRODUCTION CANARY import — five named historical jobs, and nothing else.
 *
 * This is deliberately NOT a production switch on `apply.ts`. That file still
 * refuses production unconditionally, and this one cannot import anything but
 * the five candidates named in CANARY_KEYS below. There is no flag, argument or
 * environment variable that widens it: to import a sixth job somebody has to
 * edit this file and have that edit reviewed.
 *
 * Every one of these must hold or nothing is written:
 *
 *   1. `--target <url>` names the database explicitly. There is no default.
 *   2. If the target is production, its project ref must be exactly
 *      ALLOWED_PROJECT_REF. Any other Supabase project is refused by name.
 *   3. Every candidate is filtered against CANARY_KEYS. A candidate that is not
 *      on the list cannot be submitted even if the source file changes.
 *   4. The batch is refused if it is not exactly the expected five, or if any
 *      listed key is missing, or if it exceeds MAX_CANARY_BATCH.
 *   5. Only READY / READY_WITH_WARNINGS candidates are eligible, so an owner
 *      review or rejected row can never arrive here.
 *   6. `--confirm <token>` must match a token bound to the project ref, the
 *      sorted candidate keys, the candidate count and the source batch id.
 *      A token from another database, another batch or another set of keys
 *      does not match.
 *   7. Writing goes through the reviewed app.historical_import_apply only, as
 *      one jsonb parameter per candidate. No SQL is ever built from source data.
 *
 * The function is owner-only in the database (no grant to anon, authenticated
 * or service_role), so this administrative path is the only way to reach it:
 * there is no browser route and no service-role API bypass.
 *
 * Output never carries customer identity: candidates are named by import key.
 *
 *   npx jiti scripts/.../apply-canary.ts --target <url> --plan
 *   npx jiti scripts/.../apply-canary.ts --target <url> --confirm <token>
 *   npx jiti scripts/.../apply-canary.ts --target <url> --confirm <token> --only <importKey>
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

import { IMPORTER_VERSION } from './transform';
import { buildImportDocument } from './document';
import { buildValidated } from './select-canary';

/** The only production project this file may ever write to. */
const ALLOWED_PROJECT_REF = 'ocpwrrajskywpqpatwea';

/**
 * The canary. Five representative importable candidates, chosen to cover a
 * rich record, an ambiguous salesperson, an unknown finance route, an unknown
 * price, and unresolved historical installers. Import keys are Jotform
 * submission ids - not customer data.
 */
const CANARY_KEYS: readonly string[] = Object.freeze([
  '6328760046558613709', // A rich: price, finance, salesperson, technical, scaffold, work dates
  '6230106450468461297', // B ambiguous salesperson
  '6171501048389011787', // C finance unknown, price known
  '6201901791355126243', // D price unknown
  '6181958023281562382' // E every historical installer ambiguous, otherwise rich
]);

const MAX_CANARY_BATCH = 5;

type Options = {
  target: string | null;
  confirm: string | null;
  only: string | null;
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
    target: get('--target'),
    confirm: get('--confirm'),
    only: get('--only'),
    plan: argv.includes('--plan')
  };
}

const redact = (target: string) => target.replace(/:[^:@/]*@/, ':***@');

function isLocal(target: string): boolean {
  return /@(127\.0\.0\.1|localhost):\d+\//.test(target);
}

/**
 * The project ref as it appears in a Supabase connection string: either the
 * direct host `db.<ref>.supabase.co` or the pooler user `postgres.<ref>`.
 */
function projectRef(target: string): string | null {
  const host = /db\.([a-z0-9]{16,})\.supabase\.(co|com)/i.exec(target);
  if (host) return host[1].toLowerCase();
  const pooler = /postgres\.([a-z0-9]{16,})(?::|@)/i.exec(target);
  if (pooler) return pooler[1].toLowerCase();
  return null;
}

/** Ties a confirmation to one project, one key set and one source batch. */
function confirmationToken(
  ref: string,
  keys: readonly string[],
  batchId: string
): string {
  return createHash('sha256')
    .update(
      `canary:${ref}:${[...keys].sort().join(',')}:${keys.length}:${batchId}:${IMPORTER_VERSION}`
    )
    .digest('hex')
    .slice(0, 16);
}

function refuse(message: string, code: number): never {
  console.error(`Refused: ${message}`);
  process.exit(code);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.target) {
    refuse(
      '--target is required and has no default.\n' +
        'The canary never guesses which database it is writing to.',
      2
    );
  }
  const target = opts.target;

  // --- Target identity -------------------------------------------------------
  const local = isLocal(target);
  const ref = projectRef(target);
  if (!local) {
    if (!ref) {
      refuse(
        'the target is neither a local stack nor a recognisable Supabase project.\n' +
          'Refusing rather than writing somewhere unidentified.',
        3
      );
    }
    if (ref !== ALLOWED_PROJECT_REF) {
      refuse(
        `the target project is "${ref}", not "${ALLOWED_PROJECT_REF}".\n` +
          'This file may only ever write to that one project.',
        3
      );
    }
  }
  const tokenRef = local ? 'local' : (ref as string);

  // --- Build and filter to the canary ---------------------------------------
  const { validated, batchId } = buildValidated({});
  const doc = buildImportDocument(validated, batchId);

  const byKey = new Map(doc.candidates.map((c) => [c.provenance.importKey, c]));
  const missing = CANARY_KEYS.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    refuse(
      `these canary keys are not importable in this source file: ${missing.join(', ')}.\n` +
        'The source may have changed. Re-select before importing.',
      5
    );
  }

  let selected = CANARY_KEYS.map((k) => byKey.get(k)!);

  if (opts.only) {
    if (!CANARY_KEYS.includes(opts.only)) {
      refuse(`--only ${opts.only} is not on the canary list.`, 5);
    }
    selected = selected.filter((c) => c.provenance.importKey === opts.only);
  }

  if (selected.length === 0 || selected.length > MAX_CANARY_BATCH) {
    refuse(
      `batch size ${selected.length} is outside 1..${MAX_CANARY_BATCH}.`,
      5
    );
  }
  // Belt and braces: nothing outside the list can be in the batch.
  const stray = selected.filter(
    (c) => !CANARY_KEYS.includes(c.provenance.importKey)
  );
  if (stray.length > 0)
    refuse('a candidate outside the canary list reached the batch.', 5);

  // The token always covers the WHOLE canary, so --only cannot be used to
  // sidestep a confirmation that was issued for the full five.
  const expected = confirmationToken(tokenRef, CANARY_KEYS, batchId);

  // --- Proposed writes -------------------------------------------------------
  console.log('PROPOSED CANARY IMPORT');
  console.log(`  target            ${redact(target)}`);
  console.log(`  project           ${local ? 'LOCAL STACK' : ref}`);
  console.log(`  source batch      ${batchId}`);
  console.log(`  importer          ${IMPORTER_VERSION}`);
  console.log(`  canary list       ${CANARY_KEYS.length} keys`);
  console.log(`  submitting now    ${selected.length}`);
  console.log('');
  for (const c of selected) {
    const p = c.provenance;
    console.log(
      `  ${p.importKey}  soldAt=${c.job.soldAt ?? 'not recorded'}` +
        `  price=${c.job.grossPence === null ? 'not recorded' : 'recorded'}` +
        `  finance=${c.job.financeRoute ?? 'not recorded'}` +
        `  salesperson=${c.job.salespersonLegacyId ?? 'not linked'}` +
        `  historicalPeople=${c.historicalPeople.length}`
    );
  }
  console.log('');

  if (opts.plan) {
    console.log('Nothing was written. To apply, re-run with:');
    console.log(`  --confirm ${expected}`);
    return;
  }

  if (opts.confirm !== expected) {
    refuse(
      opts.confirm
        ? 'the confirmation token does not match this project, key set and batch.\n' +
            'Re-run with --plan to get the current token.'
        : '--confirm is required. Re-run with --plan to get the token.',
      4
    );
  }

  // --- Apply -----------------------------------------------------------------
  // One transaction. Each candidate is a jsonb parameter, never interpolated
  // SQL. app.historical_import_apply decides whether it is new.
  const work = path.join(os.tmpdir(), `hist-canary-${batchId}`);
  mkdirSync(work, { recursive: true });
  const dataFile = path.join(work, 'candidates.txt');
  const sqlFile = path.join(work, 'apply.sql');

  writeFileSync(
    dataFile,
    `${selected
      .map((c) => JSON.stringify(c).replace(/\\/g, '\\\\'))
      .join('\n')}\n`
  );
  writeFileSync(
    sqlFile,
    [
      'begin;',
      'create temp table _hist_canary (doc jsonb) on commit drop;',
      `\\copy _hist_canary (doc) from '${dataFile}'`,
      "select coalesce(jsonb_agg(r), '[]'::jsonb)::text",
      '  from (select app.historical_import_apply(doc, false) r from _hist_canary) s;',
      'commit;'
    ].join('\n')
  );

  const out = execFileSync(
    'psql',
    [target, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-f', sqlFile],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  ).trim();

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

  const summary = {
    mode: 'canary',
    project: local ? 'local' : ref,
    batchId,
    submitted: selected.length,
    imported: results.filter((r) => r.action === 'imported').length,
    skippedAlreadyImported: results.filter((r) => r.action === 'skipped')
      .length,
    sourceChangedSincePreviousImport: results.filter((r) => r.source_changed)
      .length,
    failed: results.filter((r) => !r.ok).length,
    rowsWritten: results.reduce((n, r) => n + (r.writes ?? 0), 0),
    jobRefs: results.map((r) => r.job_ref).filter(Boolean)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

main();
