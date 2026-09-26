import 'server-only';

import { previewWriteBlock } from '@/lib/preview/guard';
import type { OpenPendingAction } from './pending-actions';
import { createClient } from '@/lib/supabase/server';
import type {
  ClaimResult,
  PendingActionDecision,
  PendingActionPayload,
  PendingActionStore
} from './pending-actions';

/**
 * Durable pending-action store (BD-07): public.assistant_pending_actions,
 * migration 20260919185000_assistant_pending_actions.sql.
 *
 *   assistant_register_pending_action(id, thread, tool, args, args_hash, expected_version, preview, expires_at)
 *   assistant_claim_pending_action(id, decision) -> {outcome, tool?, args?, args_hash?, expected_version?, thread_id?}
 *   assistant_release_pending_action(id)
 *   assistant_complete_pending_action(id, succeeded, code)
 *
 * Every call runs as the signed-in user: the database derives the actor from
 * the session, so a claim can only ever succeed for the person the proposal was
 * made for, once, before it expires. If the functions are missing or error,
 * every call fails - proposals are then unavailable (fail closed).
 */
export type PendingActionRpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function sessionRpc(): Promise<PendingActionRpc> {
  // Every function in this store writes, so the whole store is closed under
  // preview - registering, claiming, releasing and completing alike.
  const blocked = await previewWriteBlock();
  if (blocked) throw new Error(blocked);
  const supabase = await createClient();
  return (fn, args) =>
    (supabase.rpc as unknown as PendingActionRpc).call(supabase, fn, args);
}

export class SupabasePendingActionStore implements PendingActionStore {
  readonly kind = 'database';
  readonly durable = true;

  constructor(
    private readonly rpcFactory: () => Promise<PendingActionRpc> = sessionRpc
  ) {}

  private async call(fn: string, args: Record<string, unknown>) {
    const rpc = await this.rpcFactory();
    const { data, error } = await rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  }

  async register(action: PendingActionPayload, preview: unknown) {
    await this.call('assistant_register_pending_action', {
      p_id: action.id,
      p_thread_id: action.threadId,
      p_tool: action.tool,
      // The validated, normalised arguments: confirmation executes these.
      p_args: action.args ?? {},
      p_args_hash: action.argsHash,
      p_expected_version: action.expectedVersion,
      p_preview: preview ?? {},
      p_expires_at: new Date(action.expiresAt).toISOString()
    });
  }

  /**
   * Proposals on this thread still waiting for an answer.
   *
   * A plain select, not an RPC: the table grants select to authenticated behind
   * an owner-only policy, so this returns the caller's own open proposals and
   * nobody else's without a function having to decide that again.
   */
  async openFor(
    threadId: string,
    now = Date.now()
  ): Promise<OpenPendingAction[]> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('assistant_pending_actions')
      .select(
        'id, tool, args, args_hash, expected_version, preview, created_at, expires_at, person_id'
      )
      .eq('thread_id', threadId)
      .eq('status', 'Open')
      .gt('expires_at', new Date(now).toISOString())
      .order('created_at');
    if (error) throw new Error(`open pending actions: ${error.message}`);
    return (data ?? []).map((row) => ({
      payload: {
        v: 1 as const,
        id: row.id,
        tool: row.tool,
        args: row.args,
        argsHash: row.args_hash,
        actorPersonId: row.person_id,
        threadId,
        expectedVersion: row.expected_version,
        issuedAt: new Date(row.created_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime()
      },
      preview: row.preview
    }));
  }

  async claim(
    id: string,
    decision: PendingActionDecision
  ): Promise<ClaimResult> {
    const data = (await this.call('assistant_claim_pending_action', {
      p_id: id,
      p_decision: decision
    })) as {
      outcome?: string;
      tool?: string;
      args?: unknown;
      args_hash?: string;
      expected_version?: number | null;
      thread_id?: string;
    } | null;
    if (
      data?.outcome === 'ok' &&
      data.tool &&
      data.args_hash &&
      data.thread_id
    ) {
      return {
        outcome: 'ok',
        action: {
          tool: data.tool,
          args: data.args,
          argsHash: data.args_hash,
          expectedVersion: data.expected_version ?? null,
          threadId: data.thread_id
        }
      };
    }
    // Anything unexpected is treated as not claimable.
    return data?.outcome === 'already_used' || data?.outcome === 'expired'
      ? { outcome: data.outcome }
      : { outcome: 'unknown' };
  }

  async release(id: string) {
    await this.call('assistant_release_pending_action', { p_id: id });
  }

  async complete(id: string, succeeded: boolean, code?: string) {
    await this.call('assistant_complete_pending_action', {
      p_id: id,
      p_succeeded: succeeded,
      p_code: code ?? null
    });
  }
}
