'use server';

import { newCommandId } from '@/features/presale/lib/draft';
import { runCommand } from '@/lib/backend/command';
import type {
  BatchDetailRead,
  BatchesRead,
  BatchOperation,
  BatchPreflightRead,
  BatchProgress
} from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import type { CommandOutcome, ReadResult } from '@/lib/backend/types';
import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import { after } from 'next/server';

/**
 * Bulk task operations, from the screen's point of view.
 *
 * Submitting and executing are separate on purpose. TASK_BATCH_SUBMIT writes
 * the batch and its frozen items and returns - so the person gets an
 * acknowledgement in one round trip however many tasks they picked. Execution
 * then runs in bounded chunks:
 *
 *   1. the first chunk runs inline, so a small batch is usually finished by
 *      the time the dialog closes;
 *   2. the rest drains in after(), once the response has been sent;
 *   3. anything still unfinished is picked up by the pg_cron recovery sweep.
 *
 * Only (3) survives the browser closing, and only (3) can run without a
 * session - which is why public.run_batch_chunk refuses a caller who is not
 * the batch's own actor, and why the recovery path re-derives the actor from
 * the batch instead of borrowing anyone's identity.
 */

/** Rows per chunk. Each item is its own transaction; this bounds the round trip, not the batch. */
const CHUNK = 25;
/** How many chunks one after() drain will run before leaving the rest to the sweep. */
const MAX_DRAIN_CHUNKS = 40;

type Selector = Record<string, unknown>;

interface Target {
  taskIds?: string[];
  selector?: Selector;
}

export interface BatchSubmission {
  operation: BatchOperation;
  /** Shared arguments: completion_note / override_reason / reopen_reason / owner_id + reason. */
  args: Record<string, unknown>;
  target: Target;
  source?: 'ui' | 'simplebot';
  /**
   * The command_id to submit under. SimpleBot passes its confirmed pending
   * action's id, so a retried confirmation is answered by the commands ledger
   * instead of creating a second batch.
   */
  commandId?: string;
}

export type BatchSubmitResult =
  | {
      ok: true;
      batchId: string;
      queued: number;
      progress: BatchProgress;
      outcome: CommandOutcome;
    }
  | { ok: false; outcome: CommandOutcome };

const targetPayload = (target: Target) =>
  target.taskIds?.length
    ? { task_ids: target.taskIds }
    : { selector: target.selector ?? {} };

/** What the operation would do to each task. Writes nothing. */
export async function preflightBatch(
  operation: BatchOperation,
  target: Target
): Promise<ReadResult<BatchPreflightRead>> {
  return readOps<BatchPreflightRead>('BATCH_PREFLIGHT', {
    operation,
    ...targetPayload(target)
  });
}

/**
 * Submits the batch and starts it. Returns as soon as the work is recorded -
 * never after it has all run.
 */
export async function submitBatch(
  submission: BatchSubmission
): Promise<BatchSubmitResult> {
  const response = await runCommand({
    command_id: submission.commandId ?? newCommandId(),
    command_type: 'TASK_BATCH_SUBMIT',
    payload: {
      operation: submission.operation,
      source: submission.source ?? 'ui',
      ...submission.args,
      ...targetPayload(submission.target)
    }
  });
  if (!response.ok) return { ok: false, outcome: response.outcome };

  const result = response.result as {
    batch_id: string;
    queued: number;
    progress: BatchProgress;
  };

  // Start it now: one bounded chunk inline, the rest after the response.
  let progress = result.progress;
  if (result.queued > 0) {
    const first = await runChunk(result.batch_id);
    if (first) progress = first;
    after(async () => {
      await drain(result.batch_id);
    });
  }

  return {
    ok: true,
    batchId: result.batch_id,
    queued: result.queued,
    progress,
    outcome: response.outcome
  };
}

/**
 * Runs one chunk. Safe to call concurrently with the drain and the sweep: the
 * claim is a single skip-locked statement, so no item is ever run twice.
 */
export async function driveBatch(
  batchId: string
): Promise<BatchProgress | null> {
  return runChunk(batchId);
}

// public.run_batch_chunk is newer than the generated database types; the read
// and command boundaries cast the same way rather than regenerating types
// against a stack that other work is using.
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

async function runChunk(batchId: string): Promise<BatchProgress | null> {
  if (await previewWriteBlock()) return null;
  const supabase = (await createClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('run_batch_chunk', {
    p_batch_id: batchId,
    p_limit: CHUNK
  });
  if (error) {
    // A refusal here does not lose the work: the items stay claimable and the
    // recovery sweep will finish them.
    console.error('run_batch_chunk failed', batchId, error.message);
    return null;
  }
  return (data as { progress: BatchProgress })?.progress ?? null;
}

/** Keeps running chunks until nothing is left to run (or the cap is reached). */
async function drain(batchId: string): Promise<void> {
  for (let i = 0; i < MAX_DRAIN_CHUNKS; i += 1) {
    const progress = await runChunk(batchId);
    if (!progress) return;
    if (progress.pending === 0 && progress.retrying === 0) return;
  }
}

/** Progress for the poller. Cheap, and safe to call from any page. */
export async function getBatchProgress(
  batchId: string
): Promise<ReadResult<BatchDetailRead>> {
  return readOps<BatchDetailRead>('BATCH_DETAIL', { batch_id: batchId });
}

export async function getBatches(
  params: { limit?: number; all?: boolean; active?: boolean } = {}
): Promise<ReadResult<BatchesRead>> {
  return readOps<BatchesRead>('BATCHES', params);
}

/** Re-queues the items a person may safely retry (NeedsReview only). */
export async function retryBatch(
  batchId: string,
  itemIds?: string[]
): Promise<BatchSubmitResult> {
  const response = await runCommand({
    command_id: newCommandId(),
    command_type: 'BATCH_RETRY',
    payload: {
      batch_id: batchId,
      ...(itemIds?.length ? { item_ids: itemIds } : {})
    }
  });
  if (!response.ok) return { ok: false, outcome: response.outcome };
  const result = response.result as {
    requeued: number;
    progress: BatchProgress;
  };
  if (result.requeued > 0) {
    const progress = await runChunk(batchId);
    after(async () => {
      await drain(batchId);
    });
    return {
      ok: true,
      batchId,
      queued: result.requeued,
      progress: progress ?? result.progress,
      outcome: response.outcome
    };
  }
  return {
    ok: true,
    batchId,
    queued: 0,
    progress: result.progress,
    outcome: response.outcome
  };
}

/** Cancels what has not started. Committed items stay committed. */
export async function cancelBatch(batchId: string): Promise<BatchSubmitResult> {
  const response = await runCommand({
    command_id: newCommandId(),
    command_type: 'BATCH_CANCEL',
    payload: { batch_id: batchId }
  });
  if (!response.ok) return { ok: false, outcome: response.outcome };
  const result = response.result as { progress: BatchProgress };
  return {
    ok: true,
    batchId,
    queued: 0,
    progress: result.progress,
    outcome: response.outcome
  };
}
