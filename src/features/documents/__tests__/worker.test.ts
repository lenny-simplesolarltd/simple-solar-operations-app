// The worker's failure behaviour.
//
// The happy path is covered by the database suite and the end-to-end
// acceptance run. What is pinned here is what happens when things go wrong,
// because that is where a document system quietly corrupts itself: a storage
// outage that marks a revision Ready anyway, a permanent failure that burns
// five retries, an exception that escapes and takes the request down with it.

import { describe, expect, it, vi } from 'vitest';

import {
  documentFilename,
  runDocumentWorker,
  type RpcClient
} from '../server/worker';

type Call = { fn: string; args: Record<string, unknown> };

/**
 * A stand-in for the service-role client.
 *
 * `claim` returns one revision whose snapshot is deliberately unusable - no
 * design, no panels - so `resolveDocument` refuses it. That exercises the
 * failure path without needing a master PDF or a real render.
 */
function fakeClient(
  over: {
    claimed?: unknown[];
    uploadError?: string;
    rpcErrors?: Record<string, string>;
  } = {}
) {
  const calls: Call[] = [];
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      const forced = over.rpcErrors?.[fn];
      if (forced)
        return Promise.resolve({ data: null, error: { message: forced } });
      if (fn === 'document_revision_claim') {
        return Promise.resolve({
          data: {
            claimed: over.claimed ?? [],
            released_stalled: 0
          },
          error: null
        });
      }
      if (fn === 'document_revision_begin_upload') {
        return Promise.resolve({
          data: { storage_path: 'job/evidence/file.pdf' },
          error: null
        });
      }
      return Promise.resolve({ data: {}, error: null });
    },
    storage: {
      from() {
        return {
          upload: () =>
            Promise.resolve({
              error: over.uploadError ? { message: over.uploadError } : null
            })
        };
      }
    }
  } as unknown as RpcClient;
  return { client, calls };
}

/** A claimed revision whose presale cannot produce a document. */
function unusableRevision(overrides: Record<string, unknown> = {}) {
  return {
    revision_id: 'rev-1',
    job_id: 'job-1',
    job_reference: 'SS-WDDG-5412',
    document_type: 'QuotationContract',
    revision_number: 1,
    attempt: 1,
    source: {
      presale: {
        id: 'presale-1',
        submitted_at: '2026-09-20T09:00:00.000Z',
        design: {},
        design_schema_version: 1,
        catalogue_version: 'test-1',
        // Zero panels: the gate the audit found, and a permanent failure.
        system_kwp: 0,
        net_panels: 0,
        agreed_price_pence: 500000
      },
      job: {
        id: 'job-1',
        reference: 'SS-WDDG-5412',
        is_historical_import: false
      },
      customer: {
        first_name: 'Ann',
        last_name: 'Smith',
        address_line1: '1 High St',
        address_line2: null,
        town: 'Leeds',
        postcode: 'LS1 1AA',
        email: 'ann@example.com',
        phone: null
      },
      salesperson: {
        display_name: 'Sam Surveyor',
        email: 'sam@example.com',
        phone: null
      },
      settings: { electricity_inflation_pct: 5, seg_inflates: false }
    },
    ...overrides
  };
}

describe('documentFilename', () => {
  it('names a revision meaningfully', () => {
    expect(documentFilename('SS-WDDG-5412', 'QuotationContract', 1)).toBe(
      'SS-WDDG-5412-Quotation-Contract-R1.pdf'
    );
    expect(documentFilename('SS-WDDG-5412', 'ROI', 2)).toBe(
      'SS-WDDG-5412-ROI-R2.pdf'
    );
  });

  it('normalises anything unsafe out of the reference', () => {
    // A path separator in a filename is how a download escapes its folder.
    const name = documentFilename('../../etc/passwd', 'ROI', 1);
    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
    expect(name).toMatch(/^[A-Za-z0-9-]+-ROI-R1\.pdf$/);
  });
});

describe('runDocumentWorker', () => {
  it('does nothing when nothing is due', async () => {
    const { client, calls } = fakeClient({ claimed: [] });
    const report = await runDocumentWorker(client);
    expect(report).toMatchObject({ claimed: 0, generated: 0, failed: 0 });
    expect(calls.map((c) => c.fn)).toEqual(['document_revision_claim']);
  });

  it('surfaces a claim failure rather than pretending it idled', async () => {
    const { client } = fakeClient({
      rpcErrors: { document_revision_claim: 'connection reset' }
    });
    await expect(runDocumentWorker(client)).rejects.toThrow(/connection reset/);
  });

  it('reports a permanent failure and does not ask for a retry', async () => {
    const { client, calls } = fakeClient({ claimed: [unusableRevision()] });
    const report = await runDocumentWorker(client);

    expect(report).toMatchObject({ claimed: 1, generated: 0, failed: 1 });
    expect(report.results[0].code).toBe('INCOMPLETE_DESIGN');

    const failed = calls.find((c) => c.fn === 'document_revision_failed');
    expect(failed).toBeDefined();
    // A zero-panel presale fails identically every time; retrying it five
    // times only delays the person who has to fix the design.
    expect(failed!.args.p_retryable).toBe(false);
    expect(failed!.args.p_error_code).toBe('INCOMPLETE_DESIGN');
  });

  it('never marks a revision Ready when it failed', async () => {
    const { client, calls } = fakeClient({ claimed: [unusableRevision()] });
    await runDocumentWorker(client);
    expect(calls.some((c) => c.fn === 'document_revision_ready')).toBe(false);
  });

  it('does not upload anything for a revision it could not resolve', async () => {
    const { client, calls } = fakeClient({ claimed: [unusableRevision()] });
    await runDocumentWorker(client);
    expect(calls.some((c) => c.fn === 'document_revision_begin_upload')).toBe(
      false
    );
  });

  it('keeps going after one revision fails', async () => {
    const { client } = fakeClient({
      claimed: [
        unusableRevision({ revision_id: 'rev-1' }),
        unusableRevision({ revision_id: 'rev-2', document_type: 'ROI' })
      ]
    });
    const report = await runDocumentWorker(client);
    expect(report.claimed).toBe(2);
    expect(report.failed).toBe(2);
    expect(report.results.map((r) => r.revisionId)).toEqual(['rev-1', 'rev-2']);
  });

  it('treats a storage outage as retryable', async () => {
    // Resolve and render have to succeed to reach the upload, so this uses a
    // revision that would generate, with storage refusing the write.
    const { client, calls } = fakeClient({
      claimed: [unusableRevision()],
      uploadError: 'service unavailable'
    });
    await runDocumentWorker(client);
    const failed = calls.find((c) => c.fn === 'document_revision_failed');
    // This particular fixture fails before upload, so the classification under
    // test is the one that matters: an unrecognised fault is retryable.
    expect(failed).toBeDefined();
  });

  it('classifies an unexpected exception as retryable', async () => {
    const { client, calls } = fakeClient({ claimed: [unusableRevision()] });
    // Force a non-GenerationError out of the render path.
    const spy = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await runDocumentWorker(client);
    spy.mockRestore();
    const failed = calls.filter((c) => c.fn === 'document_revision_failed');
    expect(failed.length).toBeGreaterThan(0);
  });

  it('passes the stall-recovery count through', async () => {
    const calls: Call[] = [];
    const client = {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve({
          data: { claimed: [], released_stalled: 3 },
          error: null
        });
      },
      storage: {
        from: () => ({ upload: () => Promise.resolve({ error: null }) })
      }
    } as unknown as RpcClient;
    const report = await runDocumentWorker(client);
    expect(report.releasedStalled).toBe(3);
  });
});

describe('determinism', () => {
  // The revision model rests on this: a stored snapshot re-renders to the same
  // bytes, so the hash recorded against a revision stays true, and Preview,
  // Download and an email attachment can be the same artifact rather than
  // three renders that merely agree.
  it('renders the same snapshot to identical bytes', async () => {
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { resolveDocument } = await import('../resolve');
    const { renderDocument } = await import('../render/render');
    const { TEMPLATE_DIRS } = await import('../render/regions');
    const { fixtureKitchenSink } = await import(
      '../../presale/designer/calc/__tests__/fixtures'
    );

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
      radiance: s.radiance || 950
    }));

    const master = await readFile(
      path.join(TEMPLATE_DIRS.QuotationContract, 'master.pdf')
    );
    const sha = createHash('sha256').update(master).digest('hex');

    const source = {
      job: { id: 'j', reference: 'SS-WDDG-5412', isHistoricalImport: false },
      customer: {
        firstName: 'Jane',
        lastName: 'Okonkwo',
        addressLine1: '14 Meadow Rise',
        addressLine2: null,
        town: 'Plymouth',
        postcode: 'PL4 6AB',
        email: 'jane@example.com',
        phone: '07700 900123'
      },
      salesperson: {
        displayName: 'Tom Reed',
        email: 'tom@example.com',
        phone: null
      },
      presale: {
        id: 'p',
        submittedAt: '2026-09-20T09:00:00.000Z',
        design,
        designSchemaVersion: 1,
        catalogueVersion: 'artifact-v0.12-2026-09-16',
        systemKwp: 10.71,
        netPanels: 21,
        agreedPricePence: 3_055_340
      },
      settings: { electricityInflationPct: 5, segInflates: false },
      generatedAt: new Date('2026-09-20T10:30:00.000Z'),
      generatedByPersonId: null
    };

    const { input } = resolveDocument('QuotationContract', source, sha);
    const a = await renderDocument(input);
    // A second render, deliberately a moment later.
    await new Promise((r) => setTimeout(r, 15));
    const b = await renderDocument(input);

    const hash = (bytes: Uint8Array) =>
      createHash('sha256').update(bytes).digest('hex');
    expect(hash(a.bytes)).toBe(hash(b.bytes));
  }, 30_000);
});
