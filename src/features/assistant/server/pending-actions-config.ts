import 'server-only';

import {
  getPendingActionService,
  type PendingActionService
} from './pending-actions';
import { SupabasePendingActionStore } from './pending-actions-db';

/**
 * ASSISTANT_PENDING_ACTIONS = 'database' | 'memory' (default).
 *
 * 'memory' stays the default until the reviewed BD-07 migration is applied. It
 * is never enough for production: see canHandleMutations().
 */
export function resolvePendingActions(
  env: Record<string, string | undefined> = process.env
): PendingActionService | null {
  const durable =
    env.ASSISTANT_PENDING_ACTIONS?.trim().toLowerCase() === 'database';
  return getPendingActionService(
    durable ? () => new SupabasePendingActionStore() : undefined
  );
}
