import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { runDocumentWorker, type RpcClient } from './worker';

// Starting the generation worker from an ordinary request.
//
// Queuing and rendering are separate on purpose: the presale trigger commits
// two Queued revisions with the sale, and this renders them. If it never runs
// - no service key, a crash, a dropped connection - the rows are still there,
// still Queued, and the next thing to look at the job picks them up.

/**
 * Service-role, because the claim/ready/failed protocol is granted to
 * service_role only. Authorisation for the REQUEST already happened under the
 * person's own identity; this is the worker, which has no actor.
 *
 * Null rather than throwing when the key is absent: generation stays queued,
 * and nothing that called us should fail because of it.
 */
export function documentWorkerClient(): RpcClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  }) as unknown as RpcClient;
}

/**
 * Run one pass, and never let it break the caller.
 *
 * Every caller has already done the thing that mattered - committed a sale,
 * queued a revision - and a failure to render right now is not a reason to
 * report that as failed.
 */
export async function kickDocumentWorker(limit = 5): Promise<void> {
  const client = documentWorkerClient();
  if (!client) return;
  try {
    await runDocumentWorker(client, limit);
  } catch (error) {
    console.error('document worker failed', error);
  }
}
