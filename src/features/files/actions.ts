'use server';

import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getFileDetails } from './queries';
import type { FileActionResult, FileDetails } from './types';

/**
 * One document's metadata, where it lives and its history, for the details
 * panel. A read, not a mutation - public.file_details authorizes it exactly as
 * opening the document would, so an id someone guessed returns nothing.
 */
export async function fetchFileDetails(
  fileId: string
): Promise<FileDetails | null> {
  if (!UUID.test(fileId)) return null;
  return getFileDetails(fileId);
}

// Every file-manager mutation, as one shape.
//
// Nothing here authorizes anything. Each function is a thin call onto a
// SECURITY DEFINER command that resolves the actor itself and applies the
// same rules whoever calls it - the browser, SimpleBot or a test. A person who
// guesses a document id, a folder id or a storage path gets the same refusal
// as one who guesses nothing, and hiding a button in React has never been part
// of it.
//
// Refusals come back as codes; app.describe_command_error turns a code into the
// sentence staff read, so the wording lives in the database beside the rule.

const FALLBACK = 'That could not be done. Try again.';

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const codeOf = (error: { code?: string; message: string }) =>
  error.code === 'P0001' ? error.message.split(':')[0].trim() : '';

/** The database's own staff wording for a refusal code. */
async function refusal(
  rpc: RpcClient,
  error: { code?: string; message: string }
): Promise<FileActionResult<never>> {
  const code = codeOf(error);
  if (!code) {
    console.error('file command failed', error.code, error.message);
    return { ok: false, code: 'UNAVAILABLE', message: FALLBACK };
  }
  const { data } = await rpc.rpc('describe_command_error', {
    p_error: error.message,
    p_command_id: null,
    p_field: null
  });
  return {
    ok: false,
    code,
    message: (data as { message?: string } | null)?.message ?? FALLBACK
  };
}

/**
 * Runs one command. Refreshes the pages that show filing so a move made in one
 * place is not still shown in another.
 */
async function command<T>(
  fn: string,
  request: Record<string, unknown>
): Promise<FileActionResult<T>> {
  const blocked = await previewWriteBlock();
  if (blocked) return { ok: false, code: 'PREVIEW', message: blocked };

  const supabase = await createClient();
  const rpc = supabase as unknown as RpcClient;
  const { data, error } = await rpc.rpc(fn, { p_request: request });
  if (error) return refusal(rpc, error);

  revalidatePath('/dashboard/files');
  revalidatePath('/dashboard/jobs', 'layout');
  return { ok: true, data: data as T } as FileActionResult<T>;
}

const badRequest = (): FileActionResult<never> => ({
  ok: false,
  code: 'R1A_INVALID_FIELDS',
  message: FALLBACK
});

const ids = (values: string[]) =>
  values.filter((v) => UUID.test(v)).filter((v, i, a) => a.indexOf(v) === i);

// -- Folders ------------------------------------------------------------------

export async function createFolder(input: {
  scope: 'Job' | 'Library';
  jobId?: string | null;
  parentId?: string | null;
  name: string;
}) {
  if (input.scope === 'Job' && !UUID.test(input.jobId ?? ''))
    return badRequest();
  if (input.parentId && !UUID.test(input.parentId)) return badRequest();
  return command<{ folder: { id: string } }>('file_folder_create', {
    scope: input.scope,
    ...(input.jobId ? { job_id: input.jobId } : {}),
    ...(input.parentId ? { parent_id: input.parentId } : {}),
    name: input.name
  });
}

export async function renameFolder(input: {
  folderId: string;
  name: string;
  expectedVersion?: number;
}) {
  if (!UUID.test(input.folderId)) return badRequest();
  return command('file_folder_rename', {
    folder_id: input.folderId,
    name: input.name,
    ...(input.expectedVersion !== undefined
      ? { expected_version: input.expectedVersion }
      : {})
  });
}

export async function moveFolder(input: {
  folderId: string;
  /** Null moves it to the top level of its own job or the library. */
  parentId: string | null;
  expectedVersion?: number;
}) {
  if (!UUID.test(input.folderId)) return badRequest();
  if (input.parentId !== null && !UUID.test(input.parentId))
    return badRequest();
  return command('file_folder_move', {
    folder_id: input.folderId,
    parent_id: input.parentId,
    ...(input.expectedVersion !== undefined
      ? { expected_version: input.expectedVersion }
      : {})
  });
}

export async function trashFolder(input: {
  folderId: string;
  expectedVersion?: number;
}) {
  if (!UUID.test(input.folderId)) return badRequest();
  return command<{ folders_trashed: number; files_trashed: number }>(
    'file_folder_trash',
    {
      folder_id: input.folderId,
      ...(input.expectedVersion !== undefined
        ? { expected_version: input.expectedVersion }
        : {})
    }
  );
}

export async function restoreFolder(input: { folderId: string }) {
  if (!UUID.test(input.folderId)) return badRequest();
  return command<{ folders_restored: number; files_restored: number }>(
    'file_folder_restore',
    { folder_id: input.folderId }
  );
}

// -- Documents ----------------------------------------------------------------

export async function renameFile(input: {
  fileId: string;
  name: string;
  expectedVersion?: number;
}) {
  if (!UUID.test(input.fileId)) return badRequest();
  return command('file_rename', {
    file_id: input.fileId,
    name: input.name,
    ...(input.expectedVersion !== undefined
      ? { expected_version: input.expectedVersion }
      : {})
  });
}

export async function moveFiles(input: {
  fileIds: string[];
  /** Null moves them to the top level of their own job or the library. */
  folderId: string | null;
  /** fileId -> the filing version the person was looking at. */
  expected?: Record<string, number>;
}) {
  const fileIds = ids(input.fileIds);
  if (fileIds.length === 0) return badRequest();
  if (input.folderId !== null && !UUID.test(input.folderId))
    return badRequest();
  return command<{ moved: number; unchanged: number }>('file_move', {
    file_ids: fileIds,
    folder_id: input.folderId,
    ...(input.expected ? { expected: input.expected } : {})
  });
}

export async function trashFiles(input: {
  fileIds: string[];
  expected?: Record<string, number>;
}) {
  const fileIds = ids(input.fileIds);
  if (fileIds.length === 0) return badRequest();
  return command<{ trashed: number; already_trashed: number }>('file_trash', {
    file_ids: fileIds,
    ...(input.expected ? { expected: input.expected } : {})
  });
}

export async function restoreFiles(input: { fileIds: string[] }) {
  const fileIds = ids(input.fileIds);
  if (fileIds.length === 0) return badRequest();
  return command<{ restored: number; already_restored: number }>(
    'file_restore',
    { file_ids: fileIds }
  );
}

/**
 * Permanent deletion. The command decides whether it may happen at all (the
 * file.purge permission, only from the trash, never for a document that is
 * evidence of recorded work) and leaves a tombstone row so the audit outlives
 * the file. Only then are the bytes removed, and only by a caller the command
 * has already authorized.
 */
export async function purgeFiles(input: { fileIds: string[] }) {
  const fileIds = ids(input.fileIds);
  if (fileIds.length === 0) return badRequest();

  const result = await command<{
    destroyed: number;
    objects: { file_id: string; storage_path: string }[];
  }>('file_purge', { file_ids: fileIds });
  if (!result.ok) return result;

  const paths = (result.data?.objects ?? [])
    .map((o) => o.storage_path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (paths.length > 0) {
    // Staff have no storage delete policy - by design, so a stored file cannot
    // be removed behind the command's back. Removing the bytes therefore needs
    // the service role, and happens only after the command said yes.
    try {
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const { error } = await createAdminClient()
        .storage.from('evidence')
        .remove(paths);
      if (error) console.error('purge: storage remove failed', error.message);
    } catch (error) {
      // The row is already a tombstone and the document is unreachable. The
      // leftover object is reported by public.evidence_consistency.
      console.error('purge: storage remove unavailable', error);
    }
  }
  return result;
}
