import 'server-only';

import { createDataClient } from '@/lib/supabase/data';
import { classifyReadFailure, READ_FAILURE_MESSAGES } from './read-failures';
import type { ReadFailure, ReadResult } from './types';

// The read side of the ported backend. Every operational screen reads through
// these two database functions, which resolve the actor from the session
// (auth.uid()), apply the role/visibility rules and return the reference read
// models. Nothing here decides who may see what.
//
//   execute_read            R1 reads (OFFICE_HOME, JOB_OVERVIEW, PLANNER_3_WEEKS ...)
//   execute_operations_read registry reads (TASKS, JOBS, MATERIAL_REQUIREMENTS ...)
//
// Both run through createDataClient(), so "View as user" previews read with the
// preview target's identity and still cannot write.

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string; details?: string | null } | null;
  }>;
};

const MESSAGES = READ_FAILURE_MESSAGES;

async function call<T>(
  fn: 'execute_read' | 'execute_operations_read',
  request: Record<string, unknown>
): Promise<ReadResult<T>> {
  const supabase = (await createDataClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc(fn, { p_request: request });
  if (error) {
    // The read function (or a read it dispatches to) is not deployed on this
    // database yet: say so instead of pretending the list is empty.
    if (
      error.code === 'PGRST202' ||
      error.code === '42883' ||
      /R1A_UNKNOWN_READ/.test(error.message)
    ) {
      return {
        ok: false,
        error: {
          kind: 'unavailable',
          code: 'READ_NOT_DEPLOYED',
          message: MESSAGES.unavailable
        }
      };
    }
    // Business refusals are raised as P0001 with the reference code as the message.
    const code =
      error.code === 'P0001'
        ? error.message.split(':')[0].trim()
        : 'UNEXPECTED';
    const kind = code === 'UNEXPECTED' ? 'error' : classifyReadFailure(code);
    if (kind === 'error')
      console.error(`${fn} ${String(request.read_type)} failed`, error);
    const failure: ReadFailure = { kind, code, message: MESSAGES[kind] };
    return { ok: false, error: failure };
  }
  const envelope = data as { ok?: boolean; data?: T } | null;
  return { ok: true, data: (envelope?.data ?? null) as T };
}

/** An R1 read from public.execute_read (OFFICE_HOME, JOB_OVERVIEW, AUDIT_HISTORY, ...). */
export function readR1<T>(
  readType: string,
  params: Record<string, unknown> = {}
) {
  return call<T>('execute_read', { read_type: readType, ...compact(params) });
}

/** A registry read from public.execute_operations_read (TASKS, JOBS, TASK_DETAIL, ...). */
export function readOps<T>(
  readType: string,
  params: Record<string, unknown> = {}
) {
  return call<T>('execute_operations_read', {
    read_type: readType,
    ...compact(params)
  });
}

/** Drops empty filter values so the database sees only what the user chose. */
function compact(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== ''
    )
  );
}
