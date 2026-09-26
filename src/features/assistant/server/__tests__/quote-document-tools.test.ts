import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The capabilities that used to sit in planned.ts: finding a customer, reading
 * and comparing quote versions, the documents the app generates, and attaching
 * a signed contract that is already on file.
 *
 * Everything below stands in for the database. What is being checked is what
 * each tool ASKS it for, what reaches the model, and - for the two mutations -
 * that the confirmation card says what will really happen.
 */

// -- The database ------------------------------------------------------------

/** Rows each table returns, per test. */
const tables: Record<string, Record<string, unknown>[]> = {};
const rpc = vi.fn();

/** A query builder that ignores filters: each test sets the rows it wants. */
function builder(table: string) {
  const rows = () => tables[table] ?? [];
  const q: Record<string, unknown> = {
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown
    ) =>
      Promise.resolve({
        data: rows(),
        error: null,
        count: rows().length
      }).then(resolve, reject)
  };
  for (const method of ['select', 'eq', 'in', 'is', 'or', 'order', 'limit'])
    q[method] = () => q;
  return q;
}

const createDataClient = vi.fn(async () => ({
  rpc,
  from: (table: string) => builder(table)
}));
vi.mock('@/lib/supabase/data', () => ({
  createDataClient: () => createDataClient()
}));

const searchVisibleJobs = vi.fn(async (_q?: string) => ({
  hits: [
    {
      id: JOB_ID,
      jobRef: 'SS-ABCD-0001',
      customerName: 'Parton',
      postcode: 'DL12 8AA',
      workflowStage: 'Sold',
      soldAt: '2026-09-01T09:00:00Z',
      isHistorical: false,
      sourceReference: null
    }
  ],
  total: 1
}));
vi.mock('@/features/jobs/server/search', () => ({
  searchVisibleJobs: (q: string) => searchVisibleJobs(q),
  searchTerms: (q: string) => q.split(/\s+/).filter((t: string) => t.length > 0)
}));

const getJobDetail = vi.fn(async (_id?: string) => ({
  job: { id: JOB_ID, job_ref: 'SS-ABCD-0001', record_class: 'Live' },
  tasks: []
}));
vi.mock('@/features/jobs/server/queries', () => ({
  getJobDetail: (id: string) => getJobDetail(id),
  OPEN_TASK_STATUSES: ['Open', 'Waiting', 'InProgress', 'Blocked']
}));

const getJobDocuments = vi.fn();
vi.mock('@/features/documents/server/queries', () => ({
  getJobDocuments: (id: string) => getJobDocuments(id)
}));

const kickDocumentWorker = vi.fn(async () => {});
vi.mock('@/features/documents/server/kick', () => ({
  kickDocumentWorker: () => kickDocumentWorker()
}));

const runCommand = vi.fn();
vi.mock('@/lib/backend/command', () => ({
  runCommand: (req: unknown) => runCommand(req)
}));

import { resolveToolCall } from '../registry';
import { createToolRegistry } from '../tools';
import { JOB_ID, makeActor, THREAD } from './helpers';

const registry = createToolRegistry({ forms: false, programmes: false });
const OFFICE = makeActor({ roles: ['Office'] });

async function read(name: string, args: unknown, actor = OFFICE) {
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) return resolved;
  if (resolved.tool.kind !== 'read') throw new Error('expected a read tool');
  return resolved.tool.execute(resolved.input, { actor, threadId: THREAD });
}

async function prepare(name: string, args: unknown, actor = OFFICE) {
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) throw new Error(`not resolvable: ${resolved.message}`);
  if (resolved.tool.kind !== 'mutation')
    throw new Error('expected a mutation tool');
  return resolved.tool.prepare(resolved.input, { actor, threadId: THREAD });
}

const COMMAND_ID = '7c0b9f3a-1d2e-4f5a-8b6c-0d1e2f3a4b5c';

async function execute(name: string, args: unknown, actor = OFFICE) {
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) throw new Error(`not resolvable: ${resolved.message}`);
  if (resolved.tool.kind !== 'mutation')
    throw new Error('expected a mutation tool');
  return resolved.tool.execute(resolved.input, {
    actor,
    threadId: THREAD,
    commandId: COMMAND_ID,
    expectedVersion: 3,
    initiatedVia: 'assistant'
  });
}

const PRESALE_1 = '00000000-0000-4000-8000-0000000000a1';
const PRESALE_2 = '00000000-0000-4000-8000-0000000000a2';

/** PRESALE_VERSIONS as app.read_presale_versions returns it: newest first. */
const versionsRead = (
  versions: Record<string, unknown>[] = [
    {
      presale_id: PRESALE_2,
      quote_number: 2,
      correction_number: 1,
      quote_label: 'Quote 2',
      is_current: true,
      submitted_at: '2026-09-20T10:00:00Z',
      system_kwp: '4.80',
      net_panels: 12,
      agreed_price_pence: 950000,
      revision_reason: 'Customer added a battery',
      superseded_at: null,
      surveyor: 'Sam Surveyor'
    },
    {
      presale_id: PRESALE_1,
      quote_number: 1,
      correction_number: 1,
      quote_label: 'Quote 1',
      is_current: false,
      submitted_at: '2026-09-01T10:00:00Z',
      system_kwp: '4.00',
      net_panels: 10,
      agreed_price_pence: 800000,
      revision_reason: null,
      superseded_at: '2026-09-20T10:00:00Z',
      surveyor: 'Sam Surveyor'
    }
  ]
) => ({ data: { ok: true, data: { versions } }, error: null });

const presaleRows = [
  {
    id: PRESALE_2,
    computed_total_pence: 960000,
    price_breakdown: [
      { key: 'panels', label: 'Panels', pence: 500000 },
      { key: 'battery', label: 'Battery', pence: 200000 }
    ],
    roof_notes: 'South facing',
    electrical_notes: null,
    catalogue_version: '2026.3',
    design_schema_version: 1
  },
  {
    id: PRESALE_1,
    computed_total_pence: 810000,
    price_breakdown: [{ key: 'panels', label: 'Panels', pence: 500000 }],
    roof_notes: 'South facing',
    electrical_notes: null,
    catalogue_version: '2026.2',
    design_schema_version: 1
  }
];

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  rpc.mockReset();
  runCommand.mockReset();
  kickDocumentWorker.mockClear();
  getJobDocuments.mockReset();
  getJobDetail.mockClear();
  searchVisibleJobs.mockClear();
});

// -- find_customer -----------------------------------------------------------

describe('find_customer', () => {
  it('returns each person with the jobs of theirs this staff member can see', async () => {
    tables.customers = [
      {
        id: 'c1',
        first_name: 'Jean',
        last_name: 'Parton',
        address_line1: '13 Rivendell Way',
        address_line2: null,
        town: 'Barnard Castle',
        postcode: 'DL12 8AA',
        phone: '07700900123',
        email: 'jean@example.test',
        alternate_contact: null
      }
    ];
    tables.jobs = [
      {
        id: JOB_ID,
        job_ref: 'SS-ABCD-0001',
        customer_id: 'c1',
        workflow_stage: 'Sold',
        sold_at: '2026-09-01T09:00:00Z',
        record_class: 'Live'
      }
    ];

    const result = await read('find_customer', { query: 'Parton' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      customers: { name: string; phone: string; jobs: unknown[] }[];
    };
    expect(data.customers).toHaveLength(1);
    expect(data.customers[0].name).toBe('Jean Parton');
    // A call handler with a name and no number has not been helped.
    expect(data.customers[0].phone).toBe('07700900123');
    expect(data.customers[0].jobs).toHaveLength(1);
    // The card is the jobs, because that is what staff click through to.
    expect(result.display).toMatchObject({ kind: 'job_list', total: 1 });
  });

  it('says nothing matched rather than that the person is not a customer', async () => {
    tables.customers = [];
    const result = await read('find_customer', { query: 'Nobody' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { note: string; visibility_note: string };
    expect(data.note).toMatch(/No customer this staff member can see/);
    expect(data.visibility_note).toMatch(/does not prove/);
  });
});

// -- get_current_quote -------------------------------------------------------

describe('get_current_quote', () => {
  it('reads the current version with its price breakdown, and counts the earlier ones', async () => {
    rpc.mockResolvedValue(versionsRead());
    tables.presales = presaleRows;

    const result = await read('get_current_quote', { job: 'SS-ABCD-0001' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      quote: {
        quote: string;
        agreed_price: string;
        price_breakdown: { label: string; amount: string }[];
      };
      earlier_versions: number;
      design_note: string;
    };
    expect(data.quote.quote).toBe('Quote 2');
    expect(data.quote.agreed_price).toBe('£9,500.00');
    expect(data.quote.price_breakdown).toEqual([
      { label: 'Panels', amount: '£5,000.00' },
      { label: 'Battery', amount: '£2,000.00' }
    ]);
    expect(data.earlier_versions).toBe(1);
    // The designer state is not paraphrased into a specification.
    expect(data.design_note).toMatch(/not readable here/);
    expect(JSON.stringify(result.data)).not.toContain('design_schema_version');
  });

  it('refuses an imported historical record by name, not as "no quote found"', async () => {
    getJobDetail.mockResolvedValueOnce({
      job: {
        id: JOB_ID,
        job_ref: 'SS-HIST-0001',
        record_class: 'HistoricalImport'
      },
      tasks: []
    } as never);

    const result = await read('get_current_quote', { job: 'SS-HIST-0001' });
    expect(result).toMatchObject({ ok: false, code: 'HISTORICAL_IMPORT' });
    // It never asked the database for versions it knows do not exist.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says a job has no presale rather than inventing one', async () => {
    rpc.mockResolvedValue(versionsRead([]));
    const result = await read('get_current_quote', { job: 'SS-ABCD-0001' });
    expect(result).toMatchObject({ ok: false, code: 'PRESALE_NOT_FOUND' });
  });
});

// -- compare_quote_revisions -------------------------------------------------

describe('compare_quote_revisions', () => {
  beforeEach(() => {
    rpc.mockResolvedValue(versionsRead());
    tables.presales = presaleRows;
  });

  it('compares the version before the current one with the current one by default', async () => {
    const result = await read('compare_quote_revisions', {
      job: 'SS-ABCD-0001'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      from: { quote: string };
      to: { quote: string; reason_this_version_exists: string };
      changes: { field: string; from: string; to: string }[];
    };
    expect(data.from.quote).toBe('Quote 1');
    expect(data.to.quote).toBe('Quote 2');
    expect(data.to.reason_this_version_exists).toBe('Customer added a battery');
    expect(data.changes).toEqual([
      { field: 'Agreed price', from: '£8,000.00', to: '£9,500.00' },
      { field: 'System size', from: '4.00 kWp', to: '4.80 kWp' },
      { field: 'Panels', from: '10', to: '12' },
      // A line that exists on one quote only is reported, not skipped.
      { field: 'Battery', from: 'not on this quote', to: '£2,000.00' }
    ]);
    // Notes are identical on both versions, so they are not listed as changed.
    expect(data.changes.some((c) => c.field === 'Roof notes')).toBe(false);
  });

  it('names the versions it does have when asked for one it does not', async () => {
    const result = await read('compare_quote_revisions', {
      job: 'SS-ABCD-0001',
      from: 'Quote 7'
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'UNKNOWN_QUOTE_VERSION'
    });
    if (result.ok) return;
    expect(result.message).toMatch(/Quote 2, Quote 1/);
  });

  it('refuses to compare a version with itself', async () => {
    const result = await read('compare_quote_revisions', {
      job: 'SS-ABCD-0001',
      from: 'Quote 2',
      to: 'Quote 2'
    });
    expect(result).toMatchObject({ ok: false, code: 'SAME_QUOTE_VERSION' });
  });
});

// -- get_generated_documents -------------------------------------------------

const revision = (over: Record<string, unknown> = {}) => ({
  revision_id: 'r1',
  document_type: 'QuotationContract',
  revision_number: 2,
  status: 'Ready',
  generated_at: '2026-09-20T11:00:00Z',
  requested_at: '2026-09-20T10:59:00Z',
  evidence_id: 'e1',
  filename: 'quotation.pdf',
  size_bytes: 1024,
  page_count: 21,
  omitted_pages: [],
  error_code: null,
  error_detail: null,
  attempt_count: 1,
  next_attempt: null,
  details: {},
  ...over
});

const documentsRead = (over: Record<string, unknown> = {}) => ({
  ok: true as const,
  data: {
    job_id: JOB_ID,
    job_reference: 'SS-ABCD-0001',
    is_historical_import: false,
    has_presale: true,
    documents: [
      {
        document_type: 'QuotationContract',
        current: revision(),
        history: [
          revision({
            revision_id: 'r0',
            revision_number: 1,
            status: 'Superseded'
          })
        ]
      },
      {
        document_type: 'ROI',
        current: revision({
          revision_id: 'r2',
          document_type: 'ROI',
          revision_number: 1,
          status: 'Failed',
          evidence_id: null,
          filename: null,
          generated_at: null,
          error_code: 'MISSING_CONSUMPTION',
          error_detail: { message: 'No annual consumption recorded' }
        }),
        history: []
      }
    ],
    ...over
  }
});

describe('get_generated_documents', () => {
  it('reports each document with its status, and links only what is actually stored', async () => {
    getJobDocuments.mockResolvedValue(documentsRead());
    const result = await read('get_generated_documents', {
      job: 'SS-ABCD-0001'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      documents: {
        document: string;
        current: {
          status: string;
          open_url: string | null;
          error: string | null;
          what_that_means: string;
        };
        earlier_revisions: unknown[];
      }[];
      regeneration_note: string;
    };
    expect(data.documents[0].document).toBe('Quotation & Contract');
    expect(data.documents[0].current.open_url).toBe('/api/evidence/e1');
    expect(data.documents[0].current.what_that_means).toMatch(/ready to open/);
    // A superseded revision is kept, not dropped.
    expect(data.documents[0].earlier_revisions).toHaveLength(1);
    // Nothing was rendered for the failed one, so there is no link to it.
    expect(data.documents[1].current.status).toBe('Failed');
    expect(data.documents[1].current.open_url).toBeNull();
    expect(data.documents[1].current.error).toBe(
      'No annual consumption recorded'
    );
    expect(data.regeneration_note).toMatch(/never rewrites/);
  });

  it('narrows to one document type when asked', async () => {
    getJobDocuments.mockResolvedValue(documentsRead());
    const result = await read('get_generated_documents', {
      job: 'SS-ABCD-0001',
      document_type: 'ROI'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { documents: { document_type: string }[] };
    expect(data.documents.map((d) => d.document_type)).toEqual(['ROI']);
  });

  it('sends an imported historical record to the stored files instead', async () => {
    getJobDocuments.mockResolvedValue(
      documentsRead({ is_historical_import: true })
    );
    const result = await read('get_generated_documents', {
      job: 'SS-HIST-0001'
    });
    expect(result).toMatchObject({ ok: false, code: 'HISTORICAL_IMPORT' });
    if (result.ok) return;
    expect(result.message).toMatch(/list_job_files/);
  });
});

// -- generate_document_pack --------------------------------------------------

describe('generate_document_pack', () => {
  it('says on the card that the old revision is kept, not overwritten', async () => {
    getJobDocuments.mockResolvedValue(documentsRead());
    const proposal = await prepare('generate_document_pack', {
      job: 'SS-ABCD-0001'
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.preview.changes).toEqual([
      {
        label: 'Quotation & Contract',
        from: 'Revision 2 (Ready)',
        to: 'New revision 3, queued'
      },
      {
        label: 'ROI Report',
        from: 'Revision 1 (Failed)',
        to: 'New revision 2, queued'
      }
    ]);
    expect(proposal.preview.warnings.join(' ')).toMatch(
      /KEPT and marked Superseded/
    );
    expect(proposal.preview.warnings.join(' ')).toMatch(/emails no one/);
    // Nothing to go stale: a generation inserts.
    expect(proposal.preview.expectedVersion).toBeNull();
  });

  it('refuses a job with no presale rather than queueing something empty', async () => {
    getJobDocuments.mockResolvedValue(
      documentsRead({ has_presale: false, documents: [] })
    );
    const proposal = await prepare('generate_document_pack', {
      job: 'SS-ABCD-0001'
    });
    expect(proposal).toMatchObject({ ok: false, code: 'PRESALE_NOT_FOUND' });
  });

  it('warns when one is already being generated', async () => {
    const read = documentsRead();
    read.data.documents[0].current = revision({ status: 'Generating' });
    getJobDocuments.mockResolvedValue(read);
    const proposal = await prepare('generate_document_pack', {
      job: 'SS-ABCD-0001',
      document_type: 'QuotationContract'
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.preview.warnings.join(' ')).toMatch(
      /already being generated/
    );
  });

  it('runs DOCUMENT_GENERATE with the confirmation id, starts the worker, and says it is queued', async () => {
    getJobDocuments.mockResolvedValue(documentsRead());
    runCommand.mockResolvedValue({
      ok: true,
      result: {
        job_id: JOB_ID,
        revisions: [
          {
            document_type: 'QuotationContract',
            revision_number: 3,
            status: 'Queued'
          }
        ]
      }
    });

    const result = await execute('generate_document_pack', {
      job: 'SS-ABCD-0001',
      document_type: 'QuotationContract'
    });
    expect(runCommand).toHaveBeenCalledWith({
      // The pending action's id, so the commands ledger answers a replay.
      command_id: COMMAND_ID,
      command_type: 'DOCUMENT_GENERATE',
      job_id: JOB_ID,
      payload: { document_type: 'QuotationContract', source: 'assistant' }
    });
    expect(kickDocumentWorker).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { queued: unknown[]; note: string };
    expect(data.queued).toEqual([
      { document: 'Quotation & Contract', revision: 3, status: 'Queued' }
    ]);
    expect(data.note).toMatch(/not ready yet/);
  });
});

// -- attach_task_evidence ----------------------------------------------------

const CONTRACT_FILE = '00000000-0000-4000-8000-0000000000f1';
const STORAGE_PATH = `${JOB_ID}/${CONTRACT_FILE}/signed-contract.pdf`;

function jobWithContractTask(
  task: Record<string, unknown> = {},
  evidence: Record<string, unknown>[] = [
    {
      id: CONTRACT_FILE,
      storage_path: STORAGE_PATH,
      filename: 'signed-contract.pdf',
      category: 'Contract',
      upload_status: 'Uploaded',
      created_at: '2026-09-19T12:00:00Z'
    }
  ]
) {
  tables.jobs = [{ id: JOB_ID, job_ref: 'SS-ABCD-0001', record_class: 'Live' }];
  tables.tasks = [
    {
      id: 't1',
      version: 3,
      status: 'Open',
      evidence_id: null,
      revision_required: false,
      ...task
    }
  ];
  tables.evidence = evidence;
}

describe('attach_task_evidence', () => {
  it('proposes attaching a file that is already on the job, and says it does not complete the task', async () => {
    jobWithContractTask();
    const proposal = await prepare('attach_task_evidence', {
      job: 'SS-ABCD-0001',
      file: 'signed-contract'
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.preview.changes).toEqual([
      {
        label: 'Signed contract',
        from: 'Nothing attached',
        to: 'signed-contract.pdf'
      }
    ]);
    expect(proposal.preview.warnings.join(' ')).toMatch(/Nothing is uploaded/);
    expect(proposal.preview.warnings.join(' ')).toMatch(/not completed/);
    // The task's own version, so a concurrent change is refused.
    expect(proposal.preview.expectedVersion).toBe(3);
    // The storage path never leaves the server.
    expect(JSON.stringify(proposal.preview)).not.toContain(STORAGE_PATH);
  });

  it('will not attach a file that is not stored on the job', async () => {
    jobWithContractTask({}, []);
    const proposal = await prepare('attach_task_evidence', {
      job: 'SS-ABCD-0001',
      file: 'signed-contract.pdf'
    });
    expect(proposal).toMatchObject({ ok: false, code: 'FILE_NOT_FOUND' });
    if (proposal.ok) return;
    // It sends them to upload it rather than offering to produce one.
    expect(proposal.message).toMatch(/uploaded on the job first/);
  });

  it('asks which file when the name matches more than one', async () => {
    jobWithContractTask({}, [
      {
        id: CONTRACT_FILE,
        storage_path: STORAGE_PATH,
        filename: 'contract-page1.pdf',
        category: 'Contract',
        upload_status: 'Uploaded',
        created_at: null
      },
      {
        id: '00000000-0000-4000-8000-0000000000f2',
        storage_path: `${JOB_ID}/x/contract-page2.pdf`,
        filename: 'contract-page2.pdf',
        category: 'Contract',
        upload_status: 'Uploaded',
        created_at: null
      }
    ]);
    const proposal = await prepare('attach_task_evidence', {
      job: 'SS-ABCD-0001',
      file: 'contract'
    });
    expect(proposal).toMatchObject({ ok: false, code: 'AMBIGUOUS_FILE' });
  });

  it('does not attach a second contract over an existing one', async () => {
    jobWithContractTask({ evidence_id: 'already-there' });
    const proposal = await prepare('attach_task_evidence', {
      job: 'SS-ABCD-0001',
      file: 'signed-contract'
    });
    expect(proposal).toMatchObject({
      ok: false,
      code: 'EVIDENCE_ALREADY_ATTACHED'
    });
  });

  it('refuses an imported historical record', async () => {
    jobWithContractTask();
    tables.jobs = [
      {
        id: JOB_ID,
        job_ref: 'SS-HIST-0001',
        record_class: 'HistoricalImport'
      }
    ];
    const proposal = await prepare('attach_task_evidence', {
      job: 'SS-HIST-0001',
      file: 'signed-contract'
    });
    expect(proposal).toMatchObject({ ok: false, code: 'HISTORICAL_IMPORT' });
  });

  it('sends the registered path and the task version to TASK_EVIDENCE_ATTACH', async () => {
    jobWithContractTask();
    runCommand.mockResolvedValue({ ok: true, result: {} });
    const result = await execute('attach_task_evidence', {
      job: 'SS-ABCD-0001',
      file: CONTRACT_FILE
    });
    expect(runCommand).toHaveBeenCalledWith({
      command_id: COMMAND_ID,
      command_type: 'TASK_EVIDENCE_ATTACH',
      task_id: 't1',
      expected_version: 3,
      payload: { evidence_path: STORAGE_PATH }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { attached: string; note: string };
    expect(data.attached).toBe('signed-contract.pdf');
    expect(data.note).toMatch(/still open/);
  });

  it('says the prebooking checks were re-run when it repairs a completed task', async () => {
    jobWithContractTask({ status: 'Complete', evidence_id: null });
    runCommand.mockResolvedValue({ ok: true, result: {} });
    const proposal = await prepare('attach_task_evidence', {
      job: 'SS-ABCD-0001',
      file: 'signed-contract'
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.preview.warnings.join(' ')).toMatch(/re-evaluates/);

    const result = await execute('attach_task_evidence', {
      job: 'SS-ABCD-0001',
      file: 'signed-contract'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { note: string }).note).toMatch(/re-evaluated/);
  });

  it('is not offered to somebody outside the office', async () => {
    const installer = makeActor({ roles: ['Installer'] });
    expect(registry.availableFor(installer).map((t) => t.name)).not.toContain(
      'attach_task_evidence'
    );
    expect(
      resolveToolCall(registry, installer, 'attach_task_evidence', {
        job: 'SS-ABCD-0001',
        file: 'x'
      })
    ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });
});
