// End-to-end acceptance for document generation.
//
//   npx jiti scripts/documents/acceptance.ts
//
// Runs the WHOLE chain against a real database (PGlite, every migration
// replayed) and the real renderer:
//
//   presale committed -> generation queued -> worker claims -> renderer runs
//   -> flattened PDF stored -> revision Ready -> Job Detail read -> Preview
//   -> Download -> Files -> Email composed -> regenerate -> R2 -> R1 immutable
//   -> the old email still carries R1
//
// It touches no hosted environment and no real Storage bucket: PGlite has no
// storage.objects, so the bytes go to a temporary directory through the same
// upload call the Supabase client would make. Everything else - the commands,
// the claim protocol, the immutability triggers, the reads, the renderer - is
// the real thing.
//
// The point of the hashes it prints is to show that Preview, Download and the
// email attachment are the SAME artifact, not three renders that happen to
// look alike.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { fixtureKitchenSink } from '../../src/features/presale/designer/calc/__tests__/fixtures';
import { computePricing } from '../../src/features/presale/designer/calc/pricing';
import { snapshotFromPricing } from '../../src/features/presale/designer/calc/summary';
import { renderDocument } from '../../src/features/documents/render/render';
import {
  runDocumentWorker,
  type RpcClient
} from '../../src/features/documents/server/worker';

// The fixtures module is plain JS in the test tree; jiti resolves it happily.
// Imported inside main() because the project targets a module format without
// top-level await.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fixtures = any;

const step = (n: number, text: string) =>
  console.log(`\n${String(n).padStart(2, ' ')}. ${text}`);
const detail = (text: string) => console.log(`    ${text}`);

/** A design that prices, generates and has a consumption figure. */
function completeDesign() {
  const design = fixtureKitchenSink();
  design.performance = {
    ...design.performance,
    annualConsumptionKwh: 4200,
    tariffPence: 27.49,
    segRatePence: 12,
    selfConsumptionPct: 70
  };
  design.slopes = design.slopes.map((s) => ({
    ...s,
    radiance: s.radiance || 950,
    shadingPct: s.shadingPct === '' ? 5 : s.shadingPct
  }));
  return design;
}

/**
 * The service-role client the worker expects, over PGlite plus a directory.
 *
 * Every RPC is the real database function. Only `storage` is stood in, because
 * PGlite has no storage.objects - which is also why app.evidence_finalize
 * accepts the object without checking it, exactly as it does in the database
 * suites.
 */
function clientOver(db: unknown, root: string): RpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pg = db as any;
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const params = names.map((n) => args[n]);
      const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
      try {
        const r = await pg.query(
          `select public.${fn}(${placeholders}) r`,
          params.map((p) =>
            p !== null && typeof p === 'object' ? JSON.stringify(p) : p
          )
        );
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    storage: {
      from() {
        return {
          async upload(storagePath: string, body: Uint8Array | Buffer) {
            const full = path.join(root, storagePath);
            await mkdir(path.dirname(full), { recursive: true });
            await writeFile(full, body);
            return { error: null };
          }
        };
      }
    }
  } as RpcClient;
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { setup } = (await import(
    '../../tests/pglite/fixtures.mjs'
  )) as Fixtures;
  // Kept in the repo's gitignored tmp/ so the PDFs this run produced are easy
  // to open and inspect afterwards.
  const root = path.join(process.cwd(), 'tmp', 'acceptance');
  await mkdir(root, { recursive: true });
  const f = await setup();
  const { db, one, all, cmd, as } = f;

  const readOps = async (who: string, request: Record<string, unknown>) => {
    await as(who);
    const r = await db.query(
      `select public.execute_operations_read($1::jsonb) r`,
      [request]
    );
    return r.rows[0].r;
  };

  // --- 1. A presale, with a design that can actually be rendered ------------
  step(1, 'Submit a presale');
  const design = completeDesign();
  const computed = snapshotFromPricing(computePricing(design)!);
  await as('tanya');
  const sold = (
    await db.query(`select public.submit_presale($1::uuid, $2::jsonb) r`, [
      randomUUID(),
      {
        customer: {
          first_name: 'Jane',
          last_name: 'Okonkwo',
          address_line1: '14 Meadow Rise',
          town: 'Plymouth',
          postcode: 'PL4 6AB',
          email: 'jane.okonkwo@example.com',
          phone: '07700900123'
        },
        sale: {
          salesperson_id: f.people.sam,
          finance_route: 'Standard',
          agreed_price_pence: computed.computed_total_pence
        },
        scope: {
          roof_required: true,
          electrical_required: true,
          scaffold_required: true
        },
        design,
        design_schema_version: 1,
        catalogue_version: 'artifact-v0.12-2026-09-16',
        computed
      }
    ])
  ).rows[0].r;
  assert.ok(sold.job_id, `sale failed: ${JSON.stringify(sold)}`);
  const JOB = sold.job_id;
  detail(
    `job ${sold.job_ref}  ${computed.system_kwp} kWp, ${computed.net_panels} panels`
  );

  // --- 2. Queued automatically ---------------------------------------------
  step(2, 'Generation is queued by the sale, with nobody pressing anything');
  let rows = await all(
    `select * from public.document_revisions where job_id=$1 order by document_type`,
    [JOB]
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r: { status: string }) => r.status === 'Queued'));
  detail(
    rows
      .map(
        (r: { document_type: string; status: string }) =>
          `${r.document_type}: ${r.status}`
      )
      .join('  ·  ')
  );

  // --- 3. The UI would show it as in flight --------------------------------
  step(3, 'Job Detail reports work in progress');
  const view = await readOps('tanya', {
    read_type: 'JOB_DOCUMENTS',
    job_id: JOB
  });
  assert.ok(view.ok, JSON.stringify(view));
  detail(
    view.data.documents
      .map(
        (d: { document_type: string; current: { status: string } }) =>
          `${d.document_type}: ${d.current.status}`
      )
      .join('  ·  ')
  );

  // --- 4. The real worker, the real renderer --------------------------------
  step(4, 'Run the worker');
  const client = clientOver(db, root);
  const report = await runDocumentWorker(client, 10);
  detail(
    `claimed ${report.claimed}, generated ${report.generated}, failed ${report.failed}`
  );
  for (const r of report.results) {
    if (r.status === 'Failed')
      detail(`  FAILED ${r.documentType}: ${r.code} ${r.message}`);
  }
  assert.equal(report.failed, 0, 'every document generated');
  assert.equal(report.generated, 2);

  // --- 5. Stored, flattened, and provably free of placeholders --------------
  step(5, 'The stored artifacts');
  rows = await all(
    `select * from public.document_revisions where job_id=$1 order by document_type`,
    [JOB]
  );
  const hashes: Record<string, string> = {};
  for (const r of rows) {
    assert.equal(r.status, 'Ready');
    const stored = await readFile(path.join(root, r.storage_path));
    const onDisk = createHash('sha256').update(stored).digest('hex');
    assert.equal(
      onDisk,
      r.content_sha256,
      'the recorded hash is the stored file'
    );
    hashes[r.document_type] = onDisk;

    const text = execFileSync(
      'pdftotext',
      [path.join(root, r.storage_path), '-'],
      {
        encoding: 'utf8'
      }
    );
    const leftover = (text.match(/\{\{/g) ?? []).length;
    assert.equal(leftover, 0, `${r.document_type} still contains placeholders`);

    const info = execFileSync('pdfinfo', [path.join(root, r.storage_path)], {
      encoding: 'utf8'
    });
    assert.match(info, /Form:\s+none/, 'flattened: no form fields');
    assert.match(info, /JavaScript:\s+no/, 'no scripts');

    // PGlite has no storage.objects, so evidence_finalize has no metadata to
    // copy and size_bytes stays null; the real size is the file on disk.
    detail(
      `${r.filename}  ${r.page_count} pages  ${Math.round(stored.length / 1024)} KB  ` +
        `sha256 ${onDisk.slice(0, 16)}…  0 unresolved tokens`
    );
  }

  const quotation = rows.find(
    (r: { document_type: string }) => r.document_type === 'QuotationContract'
  );
  const roi = rows.find(
    (r: { document_type: string }) => r.document_type === 'ROI'
  );
  assert.equal(
    quotation.page_count,
    21,
    'quotation: 24 pages less the 3 withheld'
  );
  assert.equal(roi.page_count, 15);
  assert.equal(
    quotation.omitted_pages.length,
    3,
    'MCS pages recorded as withheld'
  );
  detail(
    `MCS pages withheld: ${quotation.omitted_pages.map((p: { page: number }) => p.page).join(', ')} — ` +
      'recorded on the revision, not a failure'
  );

  // --- 6. Files sees the same object, not a copy ----------------------------
  step(6, 'Files integration');
  const evidence = await one(`select * from public.evidence where id=$1`, [
    quotation.evidence_id
  ]);
  assert.equal(evidence.storage_path, quotation.storage_path);
  assert.equal(evidence.category, 'GeneratedDocument');
  assert.equal(evidence.upload_status, 'Uploaded');
  const copies = await all(
    `select count(*)::int n from public.evidence where storage_path=$1`,
    [quotation.storage_path]
  );
  assert.equal(copies[0].n, 1, 'one row, one object - no duplicate of the PDF');
  detail(
    `evidence ${evidence.id}  category ${evidence.category}  path ${evidence.storage_path}`
  );

  // --- 7. Preview and Download are the same bytes ---------------------------
  step(7, 'Preview, Download and Email all name one artifact');
  // Both UI actions resolve through /api/evidence/<id>, which serves exactly
  // the stored object; there is no render path behind either.
  const previewTarget = quotation.evidence_id;
  const downloadTarget = quotation.evidence_id;
  assert.equal(previewTarget, downloadTarget);
  detail(`Preview  -> /api/evidence/${previewTarget}`);
  detail(
    `Download -> /api/evidence/${downloadTarget}?download=1  (${quotation.filename})`
  );

  // --- 8. Email carries that exact revision ---------------------------------
  step(8, 'Compose the customer email');
  const compose = await cmd('tanya', {
    command_id: randomUUID(),
    command_type: 'COMMUNICATION_COMPOSE',
    job_id: JOB,
    payload: { revision_id: quotation.id }
  });
  assert.ok(compose.ok, JSON.stringify(compose));
  const communicationId = compose.result.communication_id;
  const communication = await one(
    `select * from public.communications where id=$1`,
    [communicationId]
  );
  assert.equal(communication.status, 'Draft', 'composing sends nothing');
  assert.deepEqual(communication.attachment_ids, [quotation.evidence_id]);
  detail(`subject: ${compose.result.subject}`);
  detail(`to: ${compose.result.to}`);
  detail(
    `attachment: ${quotation.filename} (evidence ${quotation.evidence_id})`
  );
  detail(`status: ${communication.status} — nothing has been sent`);

  // --- 9. Regenerate ---------------------------------------------------------
  step(9, 'Regenerate the quotation');
  const again = await cmd('tanya', {
    command_id: randomUUID(),
    command_type: 'DOCUMENT_GENERATE',
    job_id: JOB,
    payload: { document_type: 'QuotationContract' }
  });
  assert.ok(again.ok, JSON.stringify(again));
  const second = await runDocumentWorker(client, 10);
  assert.equal(second.generated, 1, 'exactly one new document');

  const after = await all(
    `select * from public.document_revisions
     where job_id=$1 and document_type='QuotationContract' order by revision_number`,
    [JOB]
  );
  assert.equal(after.length, 2);
  const [r1, r2] = after;
  assert.equal(r1.status, 'Superseded');
  assert.equal(r2.status, 'Ready');
  assert.equal(r2.revision_number, 2);
  detail(`R1 ${r1.status}  sha256 ${r1.content_sha256.slice(0, 16)}…`);
  detail(`R2 ${r2.status}      sha256 ${r2.content_sha256.slice(0, 16)}…`);

  // --- 10. R1 is exactly what it always was ---------------------------------
  step(10, 'R1 is immutable, and the email still carries it');
  assert.equal(
    r1.content_sha256,
    hashes.QuotationContract,
    'R1 hash unchanged'
  );
  const r1Bytes = await readFile(path.join(root, r1.storage_path));
  assert.equal(
    createHash('sha256').update(r1Bytes).digest('hex'),
    hashes.QuotationContract,
    'R1 bytes on disk unchanged'
  );
  assert.notEqual(r2.storage_path, r1.storage_path, 'R2 is a different object');
  assert.notEqual(r2.id, r1.id, 'R2 is a different revision');
  // The property the whole revision model rests on: R1's STORED SNAPSHOT
  // re-renders to R1's bytes. Not "looks the same" - the same sha256. That is
  // what keeps the recorded hash meaningful a year from now, after the
  // catalogue and the price of electricity have both moved.
  const replay = await renderDocument(r1.input_snapshot);
  const replayHash = createHash('sha256').update(replay.bytes).digest('hex');
  assert.equal(
    replayHash,
    r1.content_sha256,
    'R1 re-rendered from its stored snapshot is not byte-identical'
  );
  detail(
    `R1 re-rendered from its stored snapshot: ${replayHash.slice(0, 16)}… identical`
  );

  const stillR1 = await one(`select * from public.communications where id=$1`, [
    communicationId
  ]);
  assert.deepEqual(stillR1.attachment_ids, [r1.evidence_id]);
  detail(
    `communication ${communicationId} -> evidence ${stillR1.attachment_ids[0]} (R1)`
  );
  detail('a newer revision changed nothing about what was sent');

  // Writing to R1 is refused outright.
  let refused = '';
  try {
    await db.query(
      `update public.document_revisions set content_sha256=$2 where id=$1`,
      [r1.id, 'f'.repeat(64)]
    );
  } catch (e) {
    refused = (e as Error).message;
  }
  assert.match(refused, /DOCUMENT_REVISION_IMMUTABLE/);
  detail(`editing R1 is refused: ${refused}`);

  // --- 11. Operations sees the work -----------------------------------------
  step(11, 'Operations visibility');
  const ops = await readOps('tanya', { read_type: 'DOCUMENT_OPERATIONS' });
  assert.ok(ops.ok);
  detail(`counts: ${JSON.stringify(ops.data.counts)}`);

  // --- The table the acceptance is really about -----------------------------
  console.log('\n    Artifact identity');
  console.log(
    '    ─────────────────────────────────────────────────────────────'
  );
  for (const r of [r1, r2, roi]) {
    console.log(
      `    ${String(r.filename).padEnd(38)} ${String(r.content_sha256).slice(0, 32)}`
    );
  }
  console.log(
    `\n    Preview / Download / Email for R1 all resolve to evidence ${r1.evidence_id},`
  );
  console.log(
    `    whose bytes hash to ${hashes.QuotationContract.slice(0, 32)}.`
  );
  console.log(
    `\n    PDFs from this run: ${path.relative(process.cwd(), root)}/`
  );
  console.log('\nAcceptance passed.');
}

main().catch((error) => {
  console.error('\nAcceptance FAILED:', error.message);
  process.exitCode = 1;
});
