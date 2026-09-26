import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const resolveAssistantActor = vi.fn();
vi.mock('../actor', () => ({
  resolveAssistantActor: () => resolveAssistantActor()
}));
// The real tools read through the session-bound Supabase client; not needed here.
vi.mock('@/features/jobs/server/queries', () => ({
  OPEN_TASK_STATUSES: ['Open', 'Waiting', 'InProgress', 'Blocked'],
  getOpenTasks: vi.fn(async () => []),
  getJobDetail: vi.fn(async () => null)
}));
vi.mock('@/features/jobs/server/search', () => ({
  searchVisibleJobs: vi.fn(async () => ({ hits: [], total: 0 }))
}));

import { POST as actions } from '@/app/api/assistant/actions/route';
import { GET as capabilities } from '@/app/api/assistant/capabilities/route';
import { POST as chat } from '@/app/api/assistant/chat/route';
import { makeActor, THREAD } from './helpers';

const post = (body: unknown) =>
  new Request('http://localhost/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

const validChat = {
  threadId: THREAD,
  message: 'Find John Smith',
  transcript: []
};

beforeEach(() => {
  resolveAssistantActor.mockReset();
  vi.unstubAllEnvs();
});

describe('unauthenticated access', () => {
  beforeEach(() => resolveAssistantActor.mockResolvedValue(null));

  it('rejects chat before reading the body', async () => {
    const response = await chat(post(validChat));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('NOT_AUTHENTICATED');
  });

  it('rejects confirmations', async () => {
    const response = await actions(
      post({ decision: 'confirm', token: 'x'.repeat(40) })
    );
    expect(response.status).toBe(401);
  });

  it('rejects capability discovery', async () => {
    expect((await capabilities()).status).toBe(401);
  });
});

import { FORMS_MUTATION_TOOLS, FORMS_READ_TOOLS } from '../tools/forms';
import {
  PROGRAMME_IMPORT_MUTATION_TOOLS,
  PROGRAMME_IMPORT_READ_TOOLS
} from '../tools/programme-imports';
import {
  PROGRAMME_OPERATION_MUTATION_TOOLS,
  PROGRAMME_OPERATION_READ_TOOLS
} from '../tools/programme-operations';
import { PROGRAMME_READ_TOOLS } from '../tools/programmes';
import { REPORT_MUTATION_TOOLS, REPORT_READ_TOOLS } from '../tools/reports';

describe('signed in', () => {
  beforeEach(() => resolveAssistantActor.mockResolvedValue(makeActor()));

  it('fails gracefully when no provider is configured', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', '');
    const response = await chat(post(validChat));
    expect(response.status).toBe(503);
    const { error } = await response.json();
    expect(error.code).toBe('NOT_CONFIGURED');
    expect(error.message).toMatch(/not switched on/i);
  });

  it('reports an unconfigured assistant through capabilities, listing what this staff member can actually use', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', '');
    const body = await (await capabilities()).json();
    expect(body.configured).toBe(false);
    expect(body.notice).toBeTruthy();
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      'find_job',
      'get_job',
      'get_job_tasks',
      'get_job_timeline',
      'get_job_blockers',
      'list_job_operations',
      'get_my_tasks',
      'get_presale_workflow',
      'find_customer',
      'get_customer_contact',
      'move_job',
      'raise_issue',
      'get_quote_versions',
      'revise_quote',
      'get_current_quote',
      'compare_quote_revisions',
      'get_generated_documents',
      'generate_document_pack',
      'attach_task_evidence',
      'list_job_files',
      'search_files',
      'list_file_folders',
      'search_help_articles',
      'get_help_article',
      'get_help_for_route',
      'get_related_help'
    ]);
    // No backend gap is left. What is still listed as unavailable here is
    // release-gated - Forms (FN-21) and Programmes (FN-22) are switched off in
    // this test environment - not a capability waiting on a backend, so no
    // quote or document tool appears.
    const plannedNames = body.planned.map((t: { name: string }) => t.name);
    for (const name of [
      'find_customer',
      'get_current_quote',
      'compare_quote_revisions',
      'get_generated_documents',
      'generate_document_pack',
      'attach_task_evidence',
      'create_quote_amendment',
      'update_quote_draft',
      'approve_quote_revision'
    ]) {
      expect(plannedNames, name).not.toContain(name);
    }
    // Everything still listed says it is switched off, not that it is waiting
    // on a backend.
    for (const tool of body.planned) {
      expect(
        [...FORMS_READ_TOOLS, ...FORMS_MUTATION_TOOLS].some(
          (t) => t.name === tool.name
        ) ||
          [
            ...PROGRAMME_READ_TOOLS,
            ...PROGRAMME_IMPORT_READ_TOOLS,
            ...PROGRAMME_IMPORT_MUTATION_TOOLS,
            ...REPORT_READ_TOOLS,
            ...REPORT_MUTATION_TOOLS,
            ...PROGRAMME_OPERATION_READ_TOOLS,
            ...PROGRAMME_OPERATION_MUTATION_TOOLS
          ].some((t) => t.name === tool.name),
        tool.name
      ).toBe(true);
    }
  });

  it('offers team tasks only to staff who hold task.read.all', async () => {
    resolveAssistantActor.mockResolvedValue(
      makeActor({ permissions: ['task.read.all'] })
    );
    const body = await (await capabilities()).json();
    expect(body.tools.map((t: { name: string }) => t.name)).toContain(
      'get_team_tasks'
    );
  });

  it('tells the browser whether the override switch may be shown at all', async () => {
    // Nobody is offered the toggle by default; it appears only for the
    // permission the override tool itself asks for.
    resolveAssistantActor.mockResolvedValue(
      makeActor({ permissions: ['task.read.all'] })
    );
    expect((await (await capabilities()).json()).canOverride).toBe(false);

    resolveAssistantActor.mockResolvedValue(
      makeActor({ permissions: ['task.read.all', 'task.override_complete'] })
    );
    expect((await (await capabilities()).json()).canOverride).toBe(true);
  });

  it('rejects identity fields and malformed bodies', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', 'dev-router');
    for (const body of [
      'not json',
      { ...validChat, actor_id: '22222222-2222-4222-8222-222222222222' },
      { ...validChat, role: 'Admin' },
      {
        ...validChat,
        context: {
          route: '/dashboard',
          page: { kind: 'dashboard' },
          permissions: ['*']
        }
      },
      {
        ...validChat,
        context: { route: '/x', page: { kind: 'job', jobId: 'not-a-uuid' } }
      },
      { ...validChat, message: '' }
    ]) {
      expect((await chat(post(body))).status).toBe(400);
    }
  });

  it('streams a turn as newline-delimited events', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', 'dev-router');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await chat(post({ ...validChat, message: 'find Parton' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(
      'application/x-ndjson'
    );

    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'tool_start',
      'tool_result',
      'text_delta',
      'turn_end'
    ]);
    expect(events[2]).toMatchObject({ tool: 'find_job', ok: true });
  });

  it('rejects a forged confirmation token', async () => {
    const response = await actions(
      post({
        decision: 'confirm',
        token: `${'a'.repeat(40)}.${'b'.repeat(43)}`
      })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('ACTION_INVALID');
  });

  it('shows the active provider and model to developers only, and never a key', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', 'gemini');
    vi.stubEnv('GEMENI_API_KEY', 'super-secret-value');
    vi.stubEnv('GEMINI_MODEL', '');

    vi.stubEnv('NODE_ENV', 'development');
    const dev = await (await capabilities()).json();
    expect(dev.diagnostics).toMatchObject({
      provider: 'gemini',
      model: 'gemini-flash-latest'
    });
    expect(JSON.stringify(dev)).not.toContain('super-secret-value');

    vi.stubEnv('NODE_ENV', 'production');
    const prod = await (await capabilities()).json();
    expect(prod.configured).toBe(true);
    expect(prod.diagnostics).toBeUndefined();
  });
});
