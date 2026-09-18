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
    { actor: string; status: 'pending' | 'claimed'; resolution: string | null }
  >();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpcFor =
    (sessionPersonId: string): PendingActionRpc =>
    async (fn, args) => {
      calls.push({ fn, args });
      const id = args.p_id as string;
      const row = rows.get(id);
      if (fn === 'assistant_register_pending_action') {
        rows.set(id, {
          actor: sessionPersonId,
          status: 'pending',
          resolution: null
        });
        return { data: null, error: null };
      }
      if (fn === 'assistant_claim_pending_action') {
        if (!row || row.actor !== sessionPersonId)
          return { data: 'unknown', error: null };
        if (row.status === 'claimed')
          return { data: 'already_used', error: null };
        row.status = 'claimed';
        row.resolution = args.p_decision as string;
        return { data: 'ok', error: null };
      }
      if (fn === 'assistant_release_pending_action') {
        if (
          row &&
          row.actor === sessionPersonId &&
          row.resolution === 'confirm'
        ) {
          row.status = 'pending';
          row.resolution = null;
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

  it('registers only a hash of the arguments, never the arguments', async () => {
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
      'p_args_hash',
      'p_expected_version',
      'p_expires_at',
      'p_id',
      'p_thread_id',
      'p_tool'
    ]);
    expect(JSON.stringify(call.args)).not.toContain('Customer confirmed');
    expect(call.args.p_args_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.args.p_expected_version).toBe(7);
    // No identity parameter exists: the database derives the actor from the session.
    expect(JSON.stringify(call.args)).not.toMatch(/actor|person/i);
  });

  it('is single-use across server instances, and only for its own actor', async () => {
    const { me, other, serviceFor } = setup();
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
    expect(await odd.consume('x', 'confirm')).toBe('unknown');
  });
});
