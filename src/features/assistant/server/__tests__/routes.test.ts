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

  it('reports an unconfigured assistant through capabilities, with real and planned tools', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', '');
    const body = await (await capabilities()).json();
    expect(body.configured).toBe(false);
    expect(body.notice).toBeTruthy();
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      'find_job',
      'get_job',
      'get_job_tasks',
      'get_my_tasks',
      'get_presale_workflow'
    ]);
    expect(body.planned.map((t: { name: string }) => t.name)).toContain(
      'create_quote_amendment'
    );
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
});
