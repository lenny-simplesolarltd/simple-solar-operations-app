/**
 * BULK historical import — the approved candidates, in controlled batches.
 *
 * This does not replace or weaken `apply-canary.ts`: that file still exists and
 * still refuses anything but its five named jobs. `apply.ts` still refuses
 * production outright. This is a third, separately reviewed path.
 *
 * What it may import is not a parameter. It is exactly the candidates this
 * repository's own pipeline classifies as importable (READY or
 * READY_WITH_WARNINGS) from the approved source file. Everything else is
 * unreachable from here:
 *
 *   - OWNER_REVIEW_REQUIRED and REJECTED candidates are dropped by
 *     buildImportDocument before this file sees them, and are re-checked below.
 *   - Anything already on the target is skipped, so the five canaries are not
 *     re-imported and a repeated batch writes nothing.
 *
 * Every one of these must hold or nothing is written:
 *
 *   1. `--target <url>` names the database explicitly. There is no default.
 *   2. If the target is production, its project ref must be exactly
 *      ALLOWED_PROJECT_REF. Any other Supabase project is refused by name.
 *   3. `--confirm <token>` must match a token bound to the project ref, the
 *      source batch id, the importer version and the full authorised key set.
 *      A token from another database, another export or a changed candidate
 *      set does not match.
 *   4. `--take <n>` is required and capped at MAX_BATCH, so a single run can
 *      never submit the whole remaining population in one transaction.
 *   5. The batch is intersected with the authorised set immediately before
 *      sending. A candidate that is not in it cannot be submitted.
 *
 * Writing goes through the reviewed app.historical_import_apply, one jsonb
 * parameter per candidate, inside one transaction per batch. No SQL is built
 * from source data. That function is owner-only in the database - no grant to
 * anon, authenticated or service_role - so there is no browser route and no
 * service-role bypass. This file grants nothing and alters no permission.
 *
 * Output never carries customer identity: candidates are named by import key.
 *
 *   npx jiti scripts/.../apply-bulk.ts --target <url> --plan
 *   npx jiti scripts/.../apply-bulk.ts --target <url> --take 25 --confirm <token>
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

/** No single run may submit more than this, so the work stays in batches. */
const MAX_BATCH = 100;

type Options = {
  target: string | null;
  confirm: string | null;
  take: number | null;
  plan: boolean;
};

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')
      ? argv[i + 1]
      : null;
  };
  const take = get('--take');
  return {
    target: get('--target'),
    confirm: get('--confirm'),
    take: take === null ? null : Number(take),
    plan: argv.includes('--plan')
  };
}

const redact = (t: string) => t.replace(/:[^:@/]*@/, ':***@');
const isLocal = (t: string) => /@(127\.0\.0\.1|localhost):\d+\//.test(t);

function projectRef(target: string): string | null {
  const host = /db\.([a-z0-9]{16,})\.supabase\.(co|com)/i.exec(target);
  if (host) return host[1].toLowerCase();
  const pooler = /postgres\.([a-z0-9]{16,})(?::|@)/i.exec(target);
  if (pooler) return pooler[1].toLowerCase();
  return null;
}

/** Ties a confirmation to one project and one exact authorised population. */
function confirmationToken(
  ref: string,
  keys: readonly string[],
  batchId: string
): string {
  return createHash('sha256')
    .update(
      `bulk:${ref}:${batchId}:${IMPORTER_VERSION}:${keys.length}:${createHash(
        'sha256'
      )
        .update([...keys].sort().join(','))
        .digest('hex')}`
    )
    .digest('hex')
    .slice(0, 16);
}

function refuse(message: string, code: number): never {
  console.error(`Refused: ${message}`);
  process.exit(code);
}

function psql(target: string, args: string[]): string {
  return execFileSync(
    'psql',
    [target, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', ...args],
    {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    }
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.target) {
    refuse('--target is required and has no default.', 2);
  }
  const target = opts.target;

  const local = isLocal(target);
  const ref = projectRef(target);
  if (!local) {
    if (!ref)
      refuse(
        'the target is neither a local stack nor a recognisable Supabase project.',
        3
      );
    if (ref !== ALLOWED_PROJECT_REF) {
      refuse(
        `the target project is "${ref}", not "${ALLOWED_PROJECT_REF}".\n` +
          'This file may only ever write to that one project.',
        3
      );
    }
  }
  const tokenRef = local ? 'local' : (ref as string);

  // --- The authorised population --------------------------------------------
  const { validated, batchId } = buildValidated({});
  const doc = buildImportDocument(validated, batchId);
  const authorised = doc.candidates;
  const authorisedKeys = authorised.map((c) => c.provenance.importKey);

  // Re-check rather than trust: nothing held back may be in the batch.
  const heldBack = new Set(doc.heldBack.map((h) => h.importKey));
  if (authorisedKeys.some((k) => heldBack.has(k))) {
    refuse('a held-back candidate reached the authorised set.', 5);
  }

  const expected = confirmationToken(tokenRef, authorisedKeys, batchId);

  // --- What is already on the target ----------------------------------------
  const already = new Set(
    psql(target, [
      '-c',
      "select submission_id from public.intake where form_type = 'Booking'"
    ])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const remaining = authorised.filter(
    (c) => !already.has(c.provenance.importKey)
  );

  console.log('BULK HISTORICAL IMPORT');
  console.log(`  target            ${redact(target)}`);
  console.log(`  project           ${local ? 'LOCAL STACK' : ref}`);
  console.log(`  source batch      ${batchId}   importer ${IMPORTER_VERSION}`);
  console.log(`  authorised        ${authorised.length} importable candidates`);
  console.log(
    `  held back         ${doc.heldBack.length} (owner review / rejected) - unreachable here`
  );
  console.log(`  already on target ${already.size}`);
  console.log(`  remaining         ${remaining.length}`);

  if (opts.plan) {
    console.log('');
    console.log('Nothing was written. To import a batch, re-run with:');
    console.log(`  --take <n>  --confirm ${expected}`);
    return;
  }

  if (opts.confirm !== expected) {
    refuse(
      opts.confirm
        ? 'the confirmation token does not match this project and candidate set.\nRe-run with --plan to get the current token.'
        : '--confirm is required. Re-run with --plan to get the token.',
      4
    );
  }
  if (opts.take === null || !Number.isInteger(opts.take) || opts.take < 1) {
    refuse('--take <n> is required and must be a positive whole number.', 5);
  }
  if (opts.take > MAX_BATCH) {
    refuse(`--take ${opts.take} exceeds the maximum batch of ${MAX_BATCH}.`, 5);
  }

  // Deterministic order, so batches are reproducible and reviewable.
  const batch = remaining
    .slice()
    .sort((a, b) =>
      a.provenance.importKey.localeCompare(b.provenance.importKey)
    )
    .slice(0, opts.take);

  if (batch.length === 0) {
    console.log('\nNothing left to import.');
    return;
  }
  // Belt and braces, immediately before sending.
  const authorisedSet = new Set(authorisedKeys);
  if (batch.some((c) => !authorisedSet.has(c.provenance.importKey))) {
    refuse('a candidate outside the authorised set reached the batch.', 5);
  }

  console.log(`\n  submitting        ${batch.length}`);
  console.log(
    `  first / last key  ${batch[0].provenance.importKey} / ${batch[batch.length - 1].provenance.importKey}`
  );

  const work = path.join(os.tmpdir(), `hist-bulk-${batchId}`);
  mkdirSync(work, { recursive: true });
  const dataFile = path.join(work, `batch-${Date.now()}.txt`);
  const sqlFile = path.join(work, 'apply.sql');
  writeFileSync(
    dataFile,
    `${batch.map((c) => JSON.stringify(c).replace(/\\/g, '\\\\')).join('\n')}\n`
  );
  writeFileSync(
    sqlFile,
    [
      'begin;',
      'create temp table _hist_bulk (doc jsonb) on commit drop;',
      `\\copy _hist_bulk (doc) from '${dataFile}'`,
      "select coalesce(jsonb_agg(r), '[]'::jsonb)::text",
      '  from (select app.historical_import_apply(doc, false) r from _hist_bulk) s;',
      'commit;'
    ].join('\n')
  );

  const out = psql(target, ['-f', sqlFile]).trim();
  const results = JSON.parse(
    out
      .split('\n')
      .filter((l) => l.trim() !== '')
      .pop() ?? '[]'
  ) as Array<{ ok: boolean; action?: string; writes?: number }>;

  console.log(
    JSON.stringify(
      {
        project: local ? 'local' : ref,
        submitted: batch.length,
        imported: results.filter((r) => r.action === 'imported').length,
        skippedAlreadyImported: results.filter((r) => r.action === 'skipped')
          .length,
        failed: results.filter((r) => !r.ok).length,
        rowsWritten: results.reduce((n, r) => n + (r.writes ?? 0), 0)
      },
      null,
      2
    )
  );
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main();
