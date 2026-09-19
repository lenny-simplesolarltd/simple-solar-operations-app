import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    throw new Error('no session client in unit tests');
  }
}));

import { resolvePendingAction } from '../confirm';
import { runAssistantTurn } from '../orchestrator';
import {
  canHandleMutations,
  issuePendingAction,
  MemoryPendingActionStore,
  PendingActionSigner,
  type PendingActionService
} from '../pending-actions';
import {
  SupabasePendingActionStore,
  type PendingActionRpc
} from '../pending-actions-db';
import { ToolRegistry } from '../registry';
import {
  collector,
  fakeCompleteTask,
  makeActor,
  scriptedProvider,
  silentAudit,
  THREAD
} from './helpers';

const TASK_ID = '5a0e4a3c-98a1-4f0b-8f43-0c6f0a1d2e3f';
const signer = () =>
  new PendingActionSigner('test-secret-test-secret-test-secret-123');

/** An in-memory stand-in for the database functions, with the same contract. */
function fakeDatabase() {
  const rows = new Map<
    string,
    {
      actor: string;
      status: 'pending' | 'claimed' | 'succeeded' | 'failed' | 'cancelled';
      tool: string;
      args: unknown;
      argsHash: string;
      expectedVersion: number | null;
      threadId: string;
      expiresAt: number;
      code: string | null;
    }
  >();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpcFor =
    (sessionPersonId: string): PendingActionRpc =>
    async (fn, args) => {
      calls.push({ fn, args });
      const id = args.p_id as string;
      const row = rows.get(id);
      const mine = row && row.actor === sessionPersonId;
      if (fn === 'assistant_register_pending_action') {
        rows.set(id, {
          actor: sessionPersonId,
          status: 'pending',
          tool: args.p_tool as string,
          args: structuredClone(args.p_args),
          argsHash: args.p_args_hash as string,
          expectedVersion: args.p_expected_version as number | null,
          threadId: args.p_thread_id as string,
          expiresAt: Date.parse(args.p_expires_at as string),
          code: null
        });
        return { data: null, error: null };
      }
      if (fn === 'assistant_claim_pending_action') {
        if (!mine) return { data: { outcome: 'unknown' }, error: null };
        if (row.status !== 'pending')
          return { data: { outcome: 'already_used' }, error: null };
        if (row.expiresAt <= Date.now())
          return { data: { outcome: 'expired' }, error: null };
        row.status = args.p_decision === 'confirm' ? 'claimed' : 'cancelled';
        return {
          data: {
            outcome: 'ok',
            tool: row.tool,
            args: row.args,
            args_hash: row.argsHash,
            expected_version: row.expectedVersion,
            thread_id: row.threadId
          },
          error: null
        };
      }
      if (fn === 'assistant_release_pending_action') {
        if (mine && row.status === 'claimed') row.status = 'pending';
        return { data: null, error: null };
      }
      if (fn === 'assistant_complete_pending_action') {
        if (mine && row.status === 'claimed') {
          row.status = args.p_succeeded ? 'succeeded' : 'failed';
          row.code = (args.p_code as string | null) ?? null;
        }
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unknown function ${fn}` } };
    };
  return { rows, calls, rpcFor };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.unstubAllEnvs());

describe('production requires a durable pending-action store', () => {
  const memory = (): PendingActionService => ({
    signer: signer(),
    store: new MemoryPendingActionStore()
  });

  it('knows which stores are durable', () => {
    expect(new MemoryPendingActionStore().durable).toBe(false);
    expect(new SupabasePendingActionStore().durable).toBe(true);
    expect(canHandleMutations(memory(), { NODE_ENV: 'development' })).toBe(
      true
    );
    expect(canHandleMutations(memory(), { NODE_ENV: 'production' })).toBe(
      false
    );
    expect(canHandleMutations(null, { NODE_ENV: 'development' })).toBe(false);
  });

  it('refuses to PROPOSE a change in production through the in-memory store', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const mutation = fakeCompleteTask();
    const { provider } = scriptedProvider([
      {
        toolCalls: [
          { id: 'c1', name: 'test_complete_task', args: { taskId: TASK_ID } }
        ]
      },
      { text: 'I can’t do that here.' }
    ]);
    const out = collector();
    await runAssistantTurn({
      actor: makeActor(),
      threadId: THREAD,
      message: 'complete it',
      transcript: [],
      provider,
      registry: new ToolRegistry().register(mutation.tool),
      pendingActions: memory(),
      audit: silentAudit().sink,
      emit: out.emit
    });
    expect(mutation.prepare).not.toHaveBeenCalled();
    expect(out.ofType('proposal')).toHaveLength(0);
    expect(out.ofType('tool_result')[0].error?.code).toBe(
      'CONFIRMATION_UNAVAILABLE'
    );
  });

  it('refuses to CONFIRM in production through the in-memory store', async () => {
    const mutation = fakeCompleteTask();
    const service = memory();
    const actor = makeActor();
    const action = await issuePendingAction(service, {
      tool: mutation.tool.name,
      args: { taskId: TASK_ID },
      actorPersonId: actor.user.id,
      threadId: THREAD,
      preview: (await mutation.prepare()).preview
    });
    vi.stubEnv('NODE_ENV', 'production');
    const result = await resolvePendingAction({
      actor,
      decision: 'confirm',
      token: action.token,
      registry: new ToolRegistry().register(mutation.tool),
      pendingActions: service,
      audit: silentAudit().sink
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_UNAVAILABLE' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
  });
});

describe('database-backed store', () => {
  function setup() {
    const db = fakeDatabase();
    const me = makeActor();
    const other = makeActor({ id: '22222222-2222-4222-8222-222222222222' });
    // Each server instance / request gets its own store object over the same database.
    const storeFor = (personId: string) =>
      new SupabasePendingActionStore(async () => db.rpcFor(personId));
    const serviceFor = (personId: string): PendingActionService => ({
      signer: signer(),
      store: storeFor(personId)
    });
    return { db, me, other, serviceFor };
  }

  it('records the validated arguments and the preview server-side, with no identity parameter', async () => {
    const { db, me, serviceFor } = setup();
    const mutation = fakeCompleteTask();
    await issuePendingAction(serviceFor(me.user.id), {
      tool: mutation.tool.name,
      args: { taskId: TASK_ID, note: 'Customer confirmed by phone' },
      actorPersonId: me.user.id,
      threadId: THREAD,
      preview: (await mutation.prepare()).preview
    });
    const [call] = db.calls;
    expect(call.fn).toBe('assistant_register_pending_action');
    expect(Object.keys(call.args).sort()).toEqual([
      'p_args',
      'p_args_hash',
      'p_expected_version',
      'p_expires_at',
      'p_id',
      'p_preview',
      'p_thread_id',
      'p_tool'
    ]);
    expect(call.args.p_args).toEqual({
      taskId: TASK_ID,
      note: 'Customer confirmed by phone'
    });
    expect(call.args.p_args_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.args.p_expected_version).toBe(7);
    expect(call.args.p_preview).toMatchObject({ title: 'Mark PRE02 complete' });
    // No identity parameter exists: the database derives the actor from the session.
    expect(Object.keys(call.args).join()).not.toMatch(/actor|person/i);
  });

  it('executes the arguments the server stored, and refuses if they do not match the proposal', async () => {
    const { db, me, serviceFor } = setup();
    const mutation = fakeCompleteTask();
    const registry = new ToolRegistry().register(mutation.tool);
    const action = await issuePendingAction(serviceFor(me.user.id), {
      tool: mutation.tool.name,
      args: { taskId: TASK_ID },
      actorPersonId: me.user.id,
      threadId: THREAD,
      preview: (await mutation.prepare()).preview
    });
    // Someone altered the stored row: the hashes no longer agree.
    db.rows.get(action.actionId)!.args = {
      taskId: '6b1e5b4d-a9b2-4c1f-9e54-1d7f1b2e3f40'
    };
    const result = await resolvePendingAction({
      actor: me,
      decision: 'confirm',
      token: action.token,
      registry,
      pendingActions: serviceFor(me.user.id),
      audit: silentAudit().sink
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ACTION_INVALID' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
    expect(db.rows.get(action.actionId)!.status).toBe('failed');
  });

  it('refuses an expired proposal without running it', async () => {
    const { db, me, serviceFor } = setup();
    const mutation = fakeCompleteTask();
    const registry = new ToolRegistry().register(mutation.tool);
    const action = await issuePendingAction(serviceFor(me.user.id), {
      tool: mutation.tool.name,
      args: { taskId: TASK_ID },
      actorPersonId: me.user.id,
      threadId: THREAD,
      preview: (await mutation.prepare()).preview
    });
    db.rows.get(action.actionId)!.expiresAt = Date.now() - 1000;
    const result = await resolvePendingAction({
      actor: me,
      decision: 'confirm',
      token: action.token,
      registry,
      pendingActions: serviceFor(me.user.id),
      audit: silentAudit().sink
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ACTION_EXPIRED' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it('is single-use across server instances, and only for its own actor', async () => {
    const { db, me, other, serviceFor } = setup();
    const mutation = fakeCompleteTask();
    const registry = new ToolRegistry().register(mutation.tool);
    const action = await issuePendingAction(serviceFor(me.user.id), {
      tool: mutation.tool.name,
      args: { taskId: TASK_ID },
      actorPersonId: me.user.id,
      threadId: THREAD,
      preview: (await mutation.prepare()).preview
    });
    const confirm = (actor: typeof me) =>
      resolvePendingAction({
        actor,
        decision: 'confirm',
        token: action.token,
        registry,
        // A different store object each time = a different server instance.
        pendingActions: serviceFor(actor.user.id),
        audit: silentAudit().sink
      });

    vi.stubEnv('NODE_ENV', 'production');
    expect(await confirm(other)).toMatchObject({
      ok: false,
      error: { code: 'ACTION_NOT_YOURS' }
    });
    expect((await confirm(me)).ok).toBe(true);
    expect(await confirm(me)).toMatchObject({
      ok: false,
      error: { code: 'ACTION_ALREADY_USED' }
    });
    expect(mutation.execute).toHaveBeenCalledTimes(1);
    expect(db.rows.get(action.actionId)!.status).toBe('succeeded');
  });

  it('fails closed when the database functions are missing or error', async () => {
    const broken = new SupabasePendingActionStore(async () => async () => ({
      data: null,
      error: {
        message:
          'function public.assistant_register_pending_action does not exist'
      }
    }));
    const mutation = fakeCompleteTask();
    const { provider } = scriptedProvider([
      {
        toolCalls: [
          { id: 'c1', name: 'test_complete_task', args: { taskId: TASK_ID } }
        ]
      },
      { text: 'That could not be prepared.' }
    ]);
    const out = collector();
    await runAssistantTurn({
      actor: makeActor(),
      threadId: THREAD,
      message: 'complete it',
      transcript: [],
      provider,
      registry: new ToolRegistry().register(mutation.tool),
      pendingActions: { signer: signer(), store: broken },
      audit: silentAudit().sink,
      emit: out.emit
    });
    expect(out.ofType('proposal')).toHaveLength(0);
    expect(mutation.execute).not.toHaveBeenCalled();
    const [result] = out.ofType('tool_result');
    expect(result.ok).toBe(false);
    expect(result.error?.message).not.toContain('does not exist');
  });

  it('treats any unexpected claim outcome as not claimable', async () => {
    const odd = new SupabasePendingActionStore(async () => async () => ({
      data: 'yes please',
      error: null
    }));
    expect(await odd.claim('x', 'confirm')).toEqual({ outcome: 'unknown' });
  });
});
