import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// The database (public.list_evidence / public.search_evidence) decides which
// files the signed-in person may see; these tests stand in for its answer and
// check what the tools send it and what reaches the model.
const rpc = vi.fn();
const createDataClient = vi.fn(async () => ({ rpc }));
vi.mock('@/lib/supabase/data', () => ({
  createDataClient: () => createDataClient()
}));
const searchVisibleJobs = vi.fn();
vi.mock('@/features/jobs/server/search', () => ({
  searchVisibleJobs: (q: string) => searchVisibleJobs(q)
}));

import { DevRouterProvider } from '../providers/dev-router';
import { resolveToolCall } from '../registry';
import { stableSystemPrompt } from '../system-prompt';
import { createToolRegistry } from '../tools';
import { JOB_ID, makeActor, THREAD } from './helpers';

const registry = createToolRegistry({ forms: false });

async function call(name: string, args: unknown, actor = makeActor()) {
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) return resolved;
  if (resolved.tool.kind !== 'read') throw new Error('expected a read tool');
  return resolved.tool.execute(resolved.input, { actor, threadId: THREAD });
}

const EV = (n: number) => `0b0e1f1c-5d0a-4f7e-9a53-3c2f4b6d7e8${n}`;

const listed = (over: Record<string, unknown>) => ({
  id: EV(0),
  job_id: JOB_ID,
  task_id: null,
  work_package_id: null,
  submission_id: null,
  issue_id: null,
  category: 'Other',
  filename: 'file.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1000,
  upload_status: 'Uploaded',
  added_at: '2026-09-19T10:00:00Z',
  added_by_name: 'Tanya Office',
  task_title: null,
  current: null,
  can_open: true,
  ...over
});

const searched = (over: Record<string, unknown>) => ({
  id: EV(5),
  job_id: JOB_ID,
  job_ref: 'SS-TEST-0001',
  workflow_stage: 'Presale',
  customer_name: 'Dolly Parton',
  postcode: 'AB1 2CD',
  category: 'DeliveryNote',
  filename: 'delivery-note.pdf',
  mime_type: 'application/pdf',
  size_bytes: 2000,
  added_at: '2026-09-18T09:00:00Z',
  added_by_name: 'Store Person',
  task_id: null,
  task_title: null,
  issue_id: null,
  submission_id: null,
  work_package_id: null,
  context_type: 'Delivery',
  ...over
});

const hit = {
  id: JOB_ID,
  jobRef: 'SS-TEST-0001',
  customerName: 'Dolly Parton',
  postcode: 'AB1 2CD',
  workflowStage: 'Presale',
  soldAt: '2026-09-01T10:00:00Z'
};

type Ok = {
  ok: true;
  data: Record<string, unknown> & { files: Record<string, unknown>[] };
  display: { kind: string; files: { id: string; group: string }[] };
};

beforeEach(() => {
  rpc.mockReset();
  searchVisibleJobs.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('file tools are registered as read tools any staff member can use', () => {
  it('offers list_job_files and search_files without extra permissions', () => {
    const names = registry.availableFor(makeActor()).map((t) => t.name);
    expect(names).toContain('list_job_files');
    expect(names).toContain('search_files');
    for (const name of ['list_job_files', 'search_files']) {
      const tool = registry.get(name);
      expect(tool).toMatchObject({ kind: 'read', status: 'available' });
    }
  });

  it('steers document questions to the file tools, and keeps stored files apart from generated ones', () => {
    const prompt = stableSystemPrompt(registry.planned());
    expect(prompt).toContain('list_job_files');
    expect(prompt).toContain('search_files');
    expect(prompt).toMatch(/signed contract/);
    // Nothing about quotes or documents is planned any more. (This registry
    // has Forms switched off, so its tools are still planned - that is a
    // release gate, not a missing backend.)
    expect(registry.planned().filter((t) => t.domain !== 'forms')).toEqual([]);
    // The two kinds of document are both real and must stay distinguishable:
    // files people uploaded, and documents the app generates from the quote.
    const generated = registry.get('get_generated_documents');
    expect(generated).toMatchObject({ kind: 'read', status: 'available' });
    expect(prompt).toContain('get_generated_documents');
    expect(prompt).toContain('generate_document_pack');
    expect(prompt).toMatch(/queued/i);
    expect(registry.get('attach_task_evidence')?.status).toBe('available');
  });
});

describe('list_job_files', () => {
  it('resolves a job reference and lists its stored files, grouped, without storage paths', async () => {
    searchVisibleJobs.mockResolvedValue({ hits: [hit], total: 1 });
    rpc.mockResolvedValue({
      data: {
        evidence: [
          listed({
            id: EV(1),
            category: 'Contract',
            filename: 'signed-contract.pdf',
            storage_path: `${JOB_ID}/${EV(1)}/signed-contract.pdf`
          }),
          listed({ id: EV(2), category: 'Progress', filename: 'roof.jpg' }),
          listed({ id: EV(3), can_open: false, upload_status: 'Pending' })
        ]
      },
      error: null
    });

    const result = (await call('list_job_files', {
      job: 'ss-test-0001'
    })) as Ok;
    expect(searchVisibleJobs).toHaveBeenCalledWith('ss-test-0001');
    expect(rpc).toHaveBeenCalledWith('list_evidence', {
      p_request: { job_id: JOB_ID }
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ job_id: JOB_ID, total: 2 });
    expect(result.data.files[0]).toEqual({
      filename: 'signed-contract.pdf',
      category: 'Signed contract',
      category_code: 'Contract',
      group: 'Contracts',
      added_at: '2026-09-19T10:00:00Z',
      added_by: 'Tanya Office',
      task_title: null,
      // Where staff would look for it, so an answer can say where it lives.
      folder: 'Top level',
      open_url: `/api/evidence/${EV(1)}`,
      download_url: `/api/evidence/${EV(1)}?download=1`
    });
    expect(result.data.files[1]).toMatchObject({
      group: 'Photos & installation'
    });
    expect(JSON.stringify(result)).not.toContain('storage_path');
    expect(JSON.stringify(result)).not.toContain(`${JOB_ID}/${EV(1)}`);
    expect(result.display.kind).toBe('file_list');
  });

  it('narrows to a group ("what photos are on this job") by job id', async () => {
    rpc.mockResolvedValue({
      data: {
        evidence: [
          listed({ id: EV(1), category: 'Contract' }),
          listed({ id: EV(2), category: 'Completion' }),
          listed({ id: EV(4), category: 'Variation' })
        ]
      },
      error: null
    });
    const result = (await call('list_job_files', {
      job: JOB_ID,
      group: 'photos'
    })) as Ok;
    expect(searchVisibleJobs).not.toHaveBeenCalled();
    expect(result.data.total).toBe(2);
    expect(result.display.files.map((f) => f.id)).toEqual([EV(2), EV(4)]);
  });

  it('asks which job when a name matches several, and never guesses', async () => {
    searchVisibleJobs.mockResolvedValue({
      hits: [hit, { ...hit, id: EV(9), jobRef: 'SS-TEST-0002' }],
      total: 2
    });
    expect(await call('list_job_files', { job: 'Parton' })).toMatchObject({
      ok: false,
      code: 'AMBIGUOUS_JOB'
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a job the person cannot see (or whose files are refused) as not found', async () => {
    searchVisibleJobs.mockResolvedValue({ hits: [], total: 0 });
    rpc.mockResolvedValue({ data: { files: [], total: 0 }, error: null });
    expect(await call('list_job_files', { job: 'SS-NOPE-0001' })).toMatchObject(
      { ok: false, code: 'NOT_FOUND' }
    );

    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'R1A_JOB_ACCESS_DENIED' }
    });
    expect(await call('list_job_files', { job: JOB_ID })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND'
    });
  });

  it('lets someone who cannot see the job find their own allocated files by reference', async () => {
    searchVisibleJobs.mockResolvedValue({ hits: [], total: 0 });
    rpc.mockResolvedValue({
      data: {
        total: 1,
        limit: 200,
        offset: 0,
        files: [searched({ category: 'Progress', filename: 'panels.jpg' })]
      },
      error: null
    });
    const result = (await call(
      'list_job_files',
      { job: 'SS-TEST-0001' },
      makeActor({ roles: ['Installer'] })
    )) as Ok;
    expect(rpc).toHaveBeenCalledWith('search_evidence', {
      p_request: { q: 'SS-TEST-0001', limit: 200 }
    });
    expect(result.data.files).toHaveLength(1);
  });

  it('accepts no identity or storage fields', async () => {
    for (const extra of [
      { person_id: EV(1) },
      { storage_path: 'x/y.pdf' },
      { role: 'Admin' }
    ]) {
      expect(
        await call('list_job_files', { job: JOB_ID, ...extra })
      ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
    }
  });
});

describe('search_files', () => {
  it('searches across jobs through search_evidence and returns job ref and customer', async () => {
    rpc.mockResolvedValue({
      data: { total: 1, limit: 40, offset: 0, files: [searched({})] },
      error: null
    });
    const result = (await call('search_files', {
      query: 'Parton',
      category: 'DeliveryNote'
    })) as Ok;
    expect(rpc).toHaveBeenCalledWith('search_evidence', {
      p_request: { q: 'Parton', category: 'DeliveryNote', limit: 40 }
    });
    expect(result.data.files[0]).toMatchObject({
      filename: 'delivery-note.pdf',
      category: 'Delivery note',
      group: 'Materials & delivery',
      job_ref: 'SS-TEST-0001',
      customer: 'Dolly Parton',
      open_url: `/api/evidence/${EV(5)}`,
      download_url: `/api/evidence/${EV(5)}?download=1`
    });
  });

  it('searches every category of a group and merges newest first', async () => {
    rpc.mockImplementation(
      async (
        _fn: string,
        { p_request }: { p_request: { category: string } }
      ) => ({
        data: {
          total: 1,
          limit: 40,
          offset: 0,
          files: [
            searched({
              id: `${EV(0).slice(0, -1)}${p_request.category.length % 10}`,
              category: p_request.category,
              added_at:
                p_request.category === 'Completion'
                  ? '2026-09-19T12:00:00Z'
                  : '2026-09-01T12:00:00Z'
            })
          ]
        },
        error: null
      })
    );
    const result = (await call('search_files', { group: 'photos' })) as Ok;
    expect(
      rpc.mock.calls.map((c) => (c[1] as { p_request: object }).p_request)
    ).toEqual([
      { category: 'Progress', limit: 40 },
      { category: 'Completion', limit: 40 },
      { category: 'Variation', limit: 40 },
      { category: 'Return', limit: 40 }
    ]);
    expect(result.data.total).toBe(4);
    expect(result.data.files[0]).toMatchObject({ category_code: 'Completion' });
  });

  it('scopes to one resolved job', async () => {
    searchVisibleJobs.mockResolvedValue({ hits: [hit], total: 1 });
    rpc.mockResolvedValue({
      data: { total: 0, limit: 40, offset: 0, files: [] },
      error: null
    });
    const result = (await call('search_files', {
      job: 'SS-TEST-0001',
      category: 'Commissioning'
    })) as Ok;
    expect(rpc).toHaveBeenCalledWith('search_evidence', {
      p_request: { category: 'Commissioning', job_id: JOB_ID, limit: 40 }
    });
    expect(result.data.note).toMatch(/No stored file/);
  });

  it('needs something to search for, and reports a failed search honestly', async () => {
    expect(await call('search_files', {})).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS'
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'boom' }
    });
    expect(await call('search_files', { query: 'Parton' })).toMatchObject({
      ok: false,
      code: 'SEARCH_FAILED'
    });
  });
});

describe('the development router', () => {
  const route = async (text: string, volatile = '') => {
    const provider = new DevRouterProvider();
    const turn = await provider.generate({
      system: { stable: '', volatile },
      messages: [{ role: 'user', text }],
      tools: registry
        .availableFor(makeActor())
        .map((t) => ({ name: t.name, description: '', inputSchema: {} }))
    } as unknown as Parameters<DevRouterProvider['generate']>[0]);
    return turn.toolCalls[0];
  };

  it('routes file questions to the file tools', async () => {
    expect(
      await route('Where is the signed contract for SS-TEST-0001?')
    ).toMatchObject({
      name: 'list_job_files',
      args: { job: 'SS-TEST-0001', group: 'contracts' }
    });
    expect(
      await route(
        'What photos are on this job?',
        `Page hint: {"route":"/x","page":{"kind":"job","jobId":"${JOB_ID}"}}`
      )
    ).toMatchObject({
      name: 'list_job_files',
      args: { job: JOB_ID, group: 'photos' }
    });
    expect(await route('Find the delivery note for Parton')).toMatchObject({
      name: 'search_files',
      args: { query: 'Parton', group: 'materials' }
    });
    expect(await route('How do I upload a contract?')).toMatchObject({
      name: 'search_help_articles'
    });
  });
});
