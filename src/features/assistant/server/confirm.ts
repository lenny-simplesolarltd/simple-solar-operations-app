import 'server-only';

import type { ActionResponse } from '../protocol';
import { consoleAuditSink, type AssistantAuditSink } from './audit';
import type { PendingActionService } from './pending-actions';
import { canHandleMutations, hashArgs } from './pending-actions';
import { resolveToolCall, type ToolActor, type ToolRegistry } from './registry';

const reject = (
  code: string,
  message: string,
  retryable = false
): ActionResponse => ({ ok: false, error: { code, message, retryable } });

const NOTHING_CHANGED = 'Nothing was changed.';

export interface ResolveActionInput {
  /** Resolved on the server from the session - the ONLY identity used. */
  actor: ToolActor;
  decision: 'confirm' | 'cancel';
  token: string;
  registry: ToolRegistry;
  pendingActions: PendingActionService | null;
  audit?: AssistantAuditSink;
}

/**
 * Confirms or cancels a pending action. The browser supplies only the opaque
 * token; tool, arguments, actor binding, version and expiry all come from the
 * server-signed payload, and every gate a fresh request would pass is passed
 * again (registered, available, permitted, valid) before the domain command
 * runs - as the signed-in user, with the action id as its command_id.
 */
export async function resolvePendingAction(
  input: ResolveActionInput
): Promise<ActionResponse> {
  const { actor, registry, pendingActions, decision } = input;
  const audit = input.audit ?? consoleAuditSink;

  if (!canHandleMutations(pendingActions)) {
    return reject(
      'CONFIRMATION_UNAVAILABLE',
      `Changes cannot be confirmed in this environment yet (confirmation is not fully configured on the server). ${NOTHING_CHANGED}`
    );
  }

  const verified = pendingActions.signer.verify(input.token);
  if (!verified.ok) {
    return verified.reason === 'EXPIRED'
      ? reject(
          'ACTION_EXPIRED',
          `This proposal has expired. Ask the assistant to prepare it again. ${NOTHING_CHANGED}`
        )
      : reject(
          'ACTION_INVALID',
          `This proposal could not be verified. ${NOTHING_CHANGED}`
        );
  }
  const action = verified.payload;
  const base = {
    initiatedVia: 'assistant' as const,
    actorPersonId: actor.user.id,
    threadId: action.threadId,
    tool: action.tool,
    commandId: action.id
  };

  // A proposal belongs to the person it was made for. Checked before the
  // action is claimed, so a stranger's attempt cannot burn it either.
  if (action.actorPersonId !== actor.user.id) {
    void audit.record({
      ...base,
      event: 'action_rejected',
      outcome: 'error',
      code: 'ACTION_NOT_YOURS'
    });
    return reject(
      'ACTION_NOT_YOURS',
      `This proposal was prepared for a different staff member. ${NOTHING_CHANGED}`
    );
  }

  if (decision === 'cancel') {
    // Claiming it is what makes a cancelled proposal unusable afterwards.
    await pendingActions.store.consume(action.id, 'cancel');
    void audit.record({ ...base, event: 'action_cancelled', outcome: 'ok' });
    return {
      ok: true,
      decision: 'cancel',
      commandId: action.id,
      message: `Cancelled. ${NOTHING_CHANGED}`,
      transcript: [
        {
          role: 'event',
          text: `The staff member CANCELLED proposed action ${action.id} (${action.tool}). It was not executed and nothing was changed.`
        }
      ]
    };
  }

  const resolved = resolveToolCall(registry, actor, action.tool, action.args);
  if (!resolved.ok) {
    void audit.record({
      ...base,
      event: 'action_rejected',
      outcome: 'error',
      code: resolved.code
    });
    return reject(resolved.code, `${resolved.message} ${NOTHING_CHANGED}`);
  }
  const { tool, input: args } = resolved;
  if (tool.kind !== 'mutation' || hashArgs(action.args) !== action.argsHash) {
    return reject(
      'ACTION_INVALID',
      `This proposal could not be verified. ${NOTHING_CHANGED}`
    );
  }

  const claim = await pendingActions.store.consume(action.id, 'confirm');
  if (claim !== 'ok') {
    void audit.record({
      ...base,
      event: 'action_rejected',
      outcome: 'error',
      code: claim === 'already_used' ? 'ACTION_ALREADY_USED' : 'ACTION_UNKNOWN'
    });
    return claim === 'already_used'
      ? reject(
          'ACTION_ALREADY_USED',
          'This proposal has already been confirmed or cancelled. It was not run again.'
        )
      : reject(
          'ACTION_UNKNOWN',
          `This proposal is no longer available. Ask the assistant to prepare it again. ${NOTHING_CHANGED}`
        );
  }

  try {
    const result = await tool.execute(args, {
      actor,
      threadId: action.threadId,
      commandId: action.id,
      expectedVersion: action.expectedVersion,
      initiatedVia: 'assistant'
    });
    if (!result.ok) {
      // A business rejection (stale version, permission, validation) is final for this proposal.
      void audit.record({
        ...base,
        event: 'action_confirmed',
        outcome: 'error',
        code: result.code
      });
      return {
        ok: false,
        error: { code: result.code, message: result.message, retryable: false }
      };
    }
    void audit.record({ ...base, event: 'action_confirmed', outcome: 'ok' });
    return {
      ok: true,
      decision: 'confirm',
      commandId: action.id,
      message: 'Done.',
      display: result.display,
      transcript: [
        {
          role: 'event',
          text: `The staff member CONFIRMED action ${action.id} (${action.tool}) and the application completed it. Result: ${JSON.stringify(result.data).slice(0, 2000)}`
        }
      ]
    };
  } catch (error) {
    // Transport failure: outcome unknown. The command is idempotent on
    // command_id, so the same proposal may safely be confirmed again.
    // eslint-disable-next-line no-console -- server-side diagnostics
    console.error(`assistant action ${action.tool} failed`, error);
    await pendingActions.store.release(action.id);
    return reject(
      'ACTION_FAILED',
      'The application could not complete this action. You can try confirming again.',
      true
    );
  }
}
