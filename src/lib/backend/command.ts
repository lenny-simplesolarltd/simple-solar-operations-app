'use server';

import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { CommandOutcome, CommandRequest, CommandResponse } from './types';

// The ONE write path for operational screens. It decides nothing: it forwards
// the request to public.execute_command(), which resolves the actor from the
// session, authorises (role, job assignment, release mode), checks the
// expected version, runs the command in one transaction and records it for
// idempotency. Retrying with the same command_id returns the stored result.
// The wording shown to staff comes from the database catalogue.

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: {
      code?: string;
      message: string;
      details?: string | null;
      hint?: string | null;
    } | null;
  }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENVELOPE = new Set([
  'command_id',
  'command_type',
  'job_id',
  'task_id',
  'issue_id',
  'work_package_id',
  'old_allocation_id',
  'expected_version',
  'payload'
]);

const FALLBACK: CommandOutcome = {
  status: 'Failed',
  heading: 'COULD NOT COMPLETE',
  message: 'Something went wrong. Nothing was changed. Try again.'
};

async function describeError(
  supabase: RpcClient,
  raw: string,
  commandId: string,
  field?: string | null
): Promise<CommandOutcome> {
  const { data, error } = await supabase.rpc('describe_command_error', {
    p_error: raw,
    p_command_id: commandId,
    p_field: field ?? null
  });
  return error || !data ? { ...FALLBACK, code: raw } : (data as CommandOutcome);
}

/**
 * Runs one backend command. Call from client components with a command_id the
 * dialog minted when it opened, so a retry after a dropped connection is a
 * replay rather than a second action.
 */
export async function runCommand(
  request: CommandRequest
): Promise<CommandResponse> {
  const blocked = await previewWriteBlock();
  if (blocked) {
    return {
      ok: false,
      outcome: {
        status: 'Failed',
        heading: 'PREVIEW',
        message: blocked,
        code: 'PREVIEW_MODE_READ_ONLY'
      }
    };
  }
  if (
    !UUID.test(request.command_id) ||
    Object.keys(request).some((k) => !ENVELOPE.has(k))
  ) {
    return { ok: false, outcome: { ...FALLBACK, code: 'R1A_INVALID_FIELDS' } };
  }

  const supabase = (await createClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc('execute_command', {
    p_request: request
  });

  if (error) {
    if (error.code !== 'P0001') {
      console.error(`execute_command ${request.command_type} failed`, error);
      return { ok: false, outcome: FALLBACK };
    }
    // Refusals carry the reference code (optionally "CODE: detail") as the message.
    const outcome = await describeError(
      supabase,
      error.message,
      request.command_id,
      error.hint
    );
    return {
      ok: false,
      outcome: error.details ? { ...outcome, detail: error.details } : outcome
    };
  }

  const response = data as {
    result: Record<string, unknown>;
    replayed: boolean;
  };
  const described = await supabase.rpc('describe_command_result', {
    p_command_type: request.command_type,
    p_result: data
  });
  const outcome =
    !described.error && described.data
      ? (described.data as CommandOutcome)
      : { status: 'Succeeded', heading: 'SUCCESS', message: 'Saved.' };

  // Every operational list is derived from the database; refresh them.
  revalidatePath('/dashboard', 'layout');
  return {
    ok: true,
    outcome,
    result: response.result,
    replayed: response.replayed
  };
}
