import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolvePendingAction } from '../confirm';
import {
  issuePendingAction,
  PENDING_ACTION_TTL_MS,
  PendingActionSigner,
  type PendingActionPayload
} from '../pending-actions';
import { ToolRegistry } from '../registry';
import { PLANNED_TOOLS } from '../tools/planned';
import {
  fakeCompleteTask,
  makeActor,
  makePendingActions,
  OTHER_PERSON,
  silentAudit,
  THREAD
} from './helpers';

const TASK_ID = '5a0e4a3c-98a1-4f0b-8f43-0c6f0a1d2e3f';
const OTHER_TASK = '6b1f5b4d-a9b2-4a1c-9a54-1d7a1b2e3f40';

async function setup(permissions: string[] = []) {
  const mutation = fakeCompleteTask(permissions);
  const registry = new ToolRegistry().register(mutation.tool);
  const pendingActions = makePendingActions();
  const actor = makeActor({ permissions });
  const prepared = await mutation.prepare();
  const action = await issuePendingAction(pendingActions, {
    tool: mutation.tool.name,
    args: { taskId: TASK_ID },
    actorPersonId: actor.user.id,
    threadId: THREAD,
    preview: prepared.preview
  });
  const audit = silentAudit();
  const confirm = (
    overrides: Partial<Parameters<typeof resolvePendingAction>[0]> = {}
  ) =>
    resolvePendingAction({
      actor,
      decision: 'confirm',
      token: action.token,
      registry,
      pendingActions,
      audit: audit.sink,
      ...overrides
    });
  return { mutation, registry, pendingActions, actor, action, confirm, audit };
}

const decode = (token: string): PendingActionPayload =>
  JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
const encode = (payload: unknown, signature: string) =>
  `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));

describe('confirming a pending action', () => {
  it('runs the domain command once, as the confirming actor, with the action id as command_id and the proposed version', async () => {
    const { mutation, action, actor, confirm, audit } = await setup();
    const result = await confirm();

    expect(result).toMatchObject({
      ok: true,
      decision: 'confirm',
      commandId: action.actionId
    });
    expect(mutation.execute).toHaveBeenCalledTimes(1);
    const [args, ctx] = mutation.execute.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>
    ];
    expect(args).toEqual({ taskId: TASK_ID });
    expect(ctx).toMatchObject({
      actor,
      commandId: action.actionId,
      expectedVersion: 7,
      initiatedVia: 'assistant',
      threadId: THREAD
    });
    expect(audit.records.at(-1)).toMatchObject({
      event: 'action_confirmed',
      initiatedVia: 'assistant',
      commandId: action.actionId
    });
  });

  it('cannot be replayed', async () => {
    const { mutation, confirm } = await setup();
    expect((await confirm()).ok).toBe(true);

    const replay = await confirm();
    expect(replay).toMatchObject({
      ok: false,
      error: { code: 'ACTION_ALREADY_USED' }
    });
    expect(mutation.execute).toHaveBeenCalledTimes(1);
  });

  it('runs at most once when confirmed twice at the same moment', async () => {
    const { mutation, confirm } = await setup();
    const results = await Promise.all([confirm(), confirm()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(mutation.execute).toHaveBeenCalledTimes(1);
  });

  it('cannot be confirmed by a different staff member - and is not burned by their attempt', async () => {
    const { mutation, confirm } = await setup();
    const intruder = makeActor({ id: OTHER_PERSON, roles: ['Admin'] });

    const stolen = await confirm({ actor: intruder });
    expect(stolen).toMatchObject({
      ok: false,
      error: { code: 'ACTION_NOT_YOURS' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();

    expect((await confirm()).ok).toBe(true);
  });

  it('rejects tampered arguments', async () => {
    const { mutation, action, confirm } = await setup();
    const [, signature] = action.token.split('.');
    const forged = encode(
      { ...decode(action.token), args: { taskId: OTHER_TASK } },
      signature
    );

    expect(await confirm({ token: forged })).toMatchObject({
      ok: false,
      error: { code: 'ACTION_INVALID' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it('rejects a token re-pointed at another person or signed with another key', async () => {
    const { mutation, action, confirm } = await setup();
    const [, signature] = action.token.split('.');
    const reassigned = encode(
      { ...decode(action.token), actorPersonId: OTHER_PERSON },
      signature
    );
    const intruder = makeActor({ id: OTHER_PERSON });
    expect((await confirm({ token: reassigned, actor: intruder })).ok).toBe(
      false
    );

    const foreign = new PendingActionSigner(
      'another-key-another-key-another-key-99'
    ).sign(decode(action.token));
    expect(await confirm({ token: foreign })).toMatchObject({
      ok: false,
      error: { code: 'ACTION_INVALID' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it('expires', async () => {
    const { mutation, pendingActions, action, confirm } = await setup();
    const late = Date.now() + PENDING_ACTION_TTL_MS + 1;
    expect(pendingActions.signer.verify(action.token, late)).toEqual({
      ok: false,
      reason: 'EXPIRED'
    });

    vi.useFakeTimers({ now: late });
    try {
      expect(await confirm()).toMatchObject({
        ok: false,
        error: { code: 'ACTION_EXPIRED' }
      });
    } finally {
      vi.useRealTimers();
    }
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it('fails closed for an action this server did not issue', async () => {
    const { mutation, pendingActions, action, confirm } = await setup();
    const elsewhere = {
      signer: pendingActions.signer,
      store: makePendingActions().store
    };

    expect(await confirm({ pendingActions: elsewhere })).toMatchObject({
      ok: false,
      error: { code: 'ACTION_UNKNOWN' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
    expect(decode(action.token).id).toBe(action.actionId);
  });

  it('re-checks permission at confirmation time', async () => {
    const { mutation, confirm, actor } = await setup(['task.complete']);
    const demoted = { ...actor, permissions: new Set<string>() };

    expect(await confirm({ actor: demoted })).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it('refuses when the tool is no longer available', async () => {
    const { mutation, confirm } = await setup();
    const registry = new ToolRegistry();
    for (const tool of PLANNED_TOOLS) registry.register(tool);

    expect((await confirm({ registry })).ok).toBe(false);
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it('cancelling makes the proposal unusable', async () => {
    const { mutation, confirm } = await setup();
    expect(await confirm({ decision: 'cancel' })).toMatchObject({
      ok: true,
      decision: 'cancel'
    });
    expect(await confirm()).toMatchObject({
      ok: false,
      error: { code: 'ACTION_ALREADY_USED' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
  });

  it('reports a business rejection from the domain command without retrying', async () => {
    const { mutation, confirm } = await setup();
    mutation.execute.mockResolvedValueOnce({
      ok: false,
      code: 'VERSION_CONFLICT',
      message: 'This task changed since the proposal was made.'
    } as never);

    expect(await confirm()).toMatchObject({
      ok: false,
      error: { code: 'VERSION_CONFLICT', retryable: false }
    });
    expect((await confirm()).ok).toBe(false);
    expect(mutation.execute).toHaveBeenCalledTimes(1);
  });

  it('lets an idempotent command be retried after a transport failure, with the same command_id', async () => {
    const { mutation, action, confirm } = await setup();
    mutation.execute.mockRejectedValueOnce(new Error('fetch failed'));

    expect(await confirm()).toMatchObject({
      ok: false,
      error: { code: 'ACTION_FAILED', retryable: true }
    });
    expect((await confirm()).ok).toBe(true);
    const ids = mutation.execute.mock.calls.map(
      (call) =>
        (call as unknown as [unknown, { commandId: string }])[1].commandId
    );
    expect(ids).toEqual([action.actionId, action.actionId]);
  });

  it('does nothing when signing is not configured', async () => {
    const { mutation, confirm } = await setup();
    expect(await confirm({ pendingActions: null })).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_UNAVAILABLE' }
    });
    expect(mutation.execute).not.toHaveBeenCalled();
  });
});
