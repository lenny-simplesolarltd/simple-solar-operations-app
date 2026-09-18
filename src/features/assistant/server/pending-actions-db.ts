import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  ConsumeOutcome,
  PendingActionDecision,
  PendingActionPayload,
  PendingActionStore
} from './pending-actions';

/**
 * Durable pending-action store (BD-07), written against the interface proposed
 * in docs/design/003-quotes-documents-files.md:
 *
 *   assistant_register_pending_action(p_id, p_thread_id, p_tool, p_args_hash, p_expected_version, p_expires_at)
 *   assistant_claim_pending_action(p_id, p_decision)  -> 'ok' | 'already_used' | 'unknown'
 *   assistant_release_pending_action(p_id)
 *
 * Every call runs as the signed-in user: the database derives the actor from
 * the session, so a claim can only ever succeed for the person the proposal was
 * made for. Until the reviewed migration is applied these functions do not
 * exist and every call fails - which leaves proposals unavailable (fail closed).
 */
export type PendingActionRpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function sessionRpc(): Promise<PendingActionRpc> {
  const supabase = await createClient();
  // The generated Database types gain these functions when the migration lands.
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

  async register(action: PendingActionPayload) {
    await this.call('assistant_register_pending_action', {
      p_id: action.id,
      p_thread_id: action.threadId,
      p_tool: action.tool,
      // The hash only: the arguments themselves stay inside the signed token.
      p_args_hash: action.argsHash,
      p_expected_version: action.expectedVersion,
      p_expires_at: new Date(action.expiresAt).toISOString()
    });
  }

  async consume(
    id: string,
    decision: PendingActionDecision
  ): Promise<ConsumeOutcome> {
    const outcome = await this.call('assistant_claim_pending_action', {
      p_id: id,
      p_decision: decision
    });
    // Anything unexpected is treated as not claimable.
    return outcome === 'ok' || outcome === 'already_used' ? outcome : 'unknown';
  }

  async release(id: string) {
    await this.call('assistant_release_pending_action', { p_id: id });
  }
}
