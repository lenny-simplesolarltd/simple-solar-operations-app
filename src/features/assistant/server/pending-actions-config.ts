import 'server-only';

import {
  getPendingActionService,
  type PendingActionService
} from './pending-actions';
import { SupabasePendingActionStore } from './pending-actions-db';

/**
 * ASSISTANT_PENDING_ACTIONS = 'database' (default) | 'memory'.
 *
 * 'database' is the durable store (BD-07). 'memory' is for development
 * without the table; production refuses to propose or confirm through it
 * (see canHandleMutations).
 */
export function resolvePendingActions(
  env: Record<string, string | undefined> = process.env
): PendingActionService | null {
  const memory =
    env.ASSISTANT_PENDING_ACTIONS?.trim().toLowerCase() === 'memory';
  return getPendingActionService(
    memory ? undefined : () => new SupabasePendingActionStore()
  );
}
