import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// get_job_timeline and get_job_blockers read through the ported backend's own
// entry points (public.execute_read / public.execute_operations_read), which
// resolve the actor from the session and apply the role, visibility and
// release rules. These tests stand in for the database's answer and check
// what the tools ask it for, what reaches the model, and that a refusal is
// repeated honestly instead of being turned into an empty success.
const rpc = vi.fn();
const createDataClient = vi.fn(async () => ({ rpc }));
vi.mock('@/lib/supabase/data', () => ({
  createDataClient: () => createDataClient()
}));

import { resolveToolCall } from '../registry';
import { createToolRegistry } from '../tools';
import { JOB_ID, makeActor, THREAD } from './helpers';

const registry = createToolRegistry({ forms: false });

async function call(name: string, args: unknown, actor = makeActor()) {
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) return resolved;
  if (resolved.tool.kind !== 'read') throw new Error('expected a read tool');
  return resolved.tool.execute(resolved.input, { actor, threadId: THREAD });
}

/** The envelope public.execute_read / execute_operations_read return. */
const ok = (data: unknown) => ({ data: { ok: true, data }, error: null });
const refused = (message: string) => ({
  data: null,
  error: { code: 'P0001', message }
});

/** Routes each stubbed RPC call by its read_type. */
function answerWith(map: Record<string, ReturnType<typeof ok>>) {
  rpc.mockImplementation(
    async (_fn: string, args: { p_request: { read_type: string } }) =>
      map[args.p_request.read_type] ?? ok(null)
  );
}

beforeEach(() => {
  rpc.mockReset();
  createDataClient.mockClear();
});

describe('get_job_timeline', () => {
  const history = {
    total_events: 3,
    audit_events: 2,
    task_events: 1,
    issue_events: 0,
    events: [
      {
        type: 'audit',
        timestamp: '2026-09-20T10:00:00Z',
        action: 'JobBooked',
        actor: 'Tanya Harris',
        reason: 'Customer agreed the dates'
      },
      {
        type: 'task_event',
        timestamp: '2026-09-19T09:00:00Z',
        action: 'TaskCompleted',
        actor: 'Tanya Harris',
        old_status: 'Open',
        new_status: 'Completed',
        note: 'Contract received'
      }
    ]
  };

  it('reads AUDIT_HISTORY for the job and returns what was recorded', async () => {
    answerWith({ AUDIT_HISTORY: ok(history) });
    const result = await call('get_job_timeline', { jobId: JOB_ID });

    expect(rpc).toHaveBeenCalledWith('execute_read', {
      p_request: { read_type: 'AUDIT_HISTORY', job_id: JOB_ID }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      total_events: number;
      events: { action: string; actor: string; status_change: unknown }[];
    };
    expect(data.total_events).toBe(3);
    expect(data.events[0]).toMatchObject({
      action: 'JobBooked',
      actor: 'Tanya Harris',
      reason: 'Customer agreed the dates',
      status_change: null
    });
    expect(data.events[1].status_change).toEqual({
      from: 'Open',
      to: 'Completed'
    });
  });

  it('repeats a refusal instead of reporting an empty history', async () => {
    rpc.mockResolvedValue(refused('R1A_FORBIDDEN: not your job'));
    const result = await call('get_job_timeline', { jobId: JOB_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('R1A_FORBIDDEN');
  });

  it('says so when the job is not visible', async () => {
    answerWith({ AUDIT_HISTORY: ok(null) });
    const result = await call('get_job_timeline', { jobId: JOB_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});

describe('get_job_blockers', () => {
  const operations = {
    job: {
      id: JOB_ID,
      job_ref: 'SS-ABCD-0001',
      version: 4,
      workflow_stage: 'Installation',
      operational_complete_at: null,
      operational_complete_by_name: null,
      customer_happy_at: null,
      archived_at: null,
      cancellation_at: null,
      cancellation_reason: null,
      cancellation_by_name: null,
      open_cancellation_tasks: 0
    },
    packages: [
      {
        trade: 'Roof',
        status: 'Completed',
        required: true,
        planned_start: '2026-10-01',
        installer_confirmation_at: '2026-09-30T08:00:00Z'
      }
    ],
    issues: [
      {
        id: 'i1',
        type: 'Remedial',
        category: 'Roof',
        description: 'Tile cracked',
        severity: 'High',
        status: 'Open',
        blocks_completion: true,
        owner_name: 'Rosie Ashley'
      },
      {
        id: 'i2',
        type: 'Variation',
        category: 'Electrical',
        description: 'Extra socket',
        severity: 'Low',
        status: 'Closed',
        blocks_completion: false,
        owner_name: null
      }
    ],
    calls: [],
    installers: [],
    completion: {
      gate: {
        status: 'NeedsReview',
        ready: false,
        reasons: ['An open issue blocks completion']
      },
      action: { available: false, denied: 'STATE' }
    },
    actions: {}
  };

  const availability = {
    job_id: JOB_ID,
    job_ref: 'SS-ABCD-0001',
    workflow_stage: 'Installation',
    version: 4,
    assigned: true,
    commands: {
      OPERATIONAL_COMPLETE: {
        available: false,
        denied: 'STATE',
        reason: 'An open issue blocks completion'
      },
      CALL_RECORD: { available: true }
    }
  };

  it('combines the operations read with action availability', async () => {
    answerWith({
      JOB_OPERATIONS: ok(operations),
      ACTION_AVAILABILITY: ok(availability)
    });
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      open_issues: { description: string }[];
      blocking_issue_count: number;
      completion: { ready: boolean; reasons: string[] };
      actions_unavailable: { command: string; reason: string }[];
    };
    // Only the still-open issue; the closed one is not a blocker.
    expect(data.open_issues).toHaveLength(1);
    expect(data.open_issues[0].description).toBe('Tile cracked');
    expect(data.blocking_issue_count).toBe(1);
    expect(data.completion).toMatchObject({
      ready: false,
      reasons: ['An open issue blocks completion']
    });
    // Available commands are not listed; refused ones carry the database's reason.
    expect(data.actions_unavailable).toEqual([
      {
        command: 'OPERATIONAL_COMPLETE',
        reason: 'An open issue blocks completion'
      }
    ]);
  });

  it('still answers when only the availability read refuses', async () => {
    rpc.mockImplementation(
      async (fn: string, args: { p_request: { read_type: string } }) =>
        args.p_request.read_type === 'JOB_OPERATIONS'
          ? ok(operations)
          : refused('R1A_FORBIDDEN: no')
    );
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      actions_unavailable: unknown[];
      availability_note?: string;
    };
    expect(data.actions_unavailable).toEqual([]);
    expect(data.availability_note).toMatch(/refused/);
  });

  it('repeats a refusal from the operations read', async () => {
    rpc.mockResolvedValue(refused('R1A_FORBIDDEN: not your job'));
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('R1A_FORBIDDEN');
  });
});

describe('the registry no longer claims these are unavailable', () => {
  it('registers both as available reads, not planned', () => {
    for (const name of ['get_job_timeline', 'get_job_blockers']) {
      const tool = registry.get(name);
      expect(tool, name).toBeDefined();
      expect(tool?.status, name).toBe('available');
      expect(tool?.kind, name).toBe('read');
    }
  });
});
