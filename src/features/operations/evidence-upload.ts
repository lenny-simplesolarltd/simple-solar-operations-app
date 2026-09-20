'use server';

import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import {
  EVIDENCE_UUID,
  evidenceFileProblem,
  evidenceMimeType,
  type EvidenceContext
} from './evidence-rules';

// Evidence uploads, in three server-checked steps:
//
//   1. beginEvidenceUpload    public.evidence_upload_begin registers the file
//      against the task / work package / delivery the person may act on. The
//      database derives the job, validates category, type, size and name, and
//      decides the storage path. Nothing here names a job or a person.
//   2. the browser sends the bytes to the one-off signed upload URL minted
//      below under the person's own session. Storage only accepts the exact
//      path of their own Pending registration.
//   3. completeEvidenceUpload public.evidence_upload_complete checks the
//      stored object and marks the evidence Uploaded.
//
// The registered path is then handed to a command (TASK_COMPLETE
// evidence_path, IW_* evidence, GOODS_IN_RECEIVE delivery_note_path), which
// accepts it only for its own job. A retry with the same uploadId resumes the
// same registration instead of creating a second one.

const BUCKET = 'evidence';
const FALLBACK = 'The upload could not be started. Try again.';

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

type Registration = {
  evidence_id: string;
  storage_path: string;
  upload_status: 'Pending' | 'Uploaded' | 'Referenced';
};

export type EvidenceUploadTicket =
  | { ok: true; evidenceId: string; path: string; token: string | null }
  | { ok: false; message: string };

export type EvidenceUploadResult =
  | { ok: true; evidenceId: string; path: string }
  | { ok: false; message: string };

async function refusal(
  supabase: RpcClient,
  error: { code?: string; message: string },
  fallback: string
): Promise<string> {
  if (error.code !== 'P0001') {
    console.error('evidence upload failed', error);
    return fallback;
  }
  const { data } = await supabase.rpc('describe_command_error', {
    p_error: error.message,
    p_command_id: null,
    p_field: null
  });
  return (data as { message?: string } | null)?.message ?? fallback;
}

export async function beginEvidenceUpload(input: {
  uploadId: string;
  context: EvidenceContext;
  category?: string;
  /** The folder it is being dropped into. Filing only; the path is unaffected. */
  folderId?: string | null;
  file: { name: string; type: string; size: number };
}): Promise<EvidenceUploadTicket> {
  const blocked = await previewWriteBlock();
  if (blocked) return { ok: false, message: blocked };
  const library = input.context?.type === 'Library';
  if (
    !EVIDENCE_UUID.test(input.uploadId) ||
    (!library && !EVIDENCE_UUID.test(input.context?.id ?? '')) ||
    (input.folderId != null && !EVIDENCE_UUID.test(input.folderId))
  )
    return { ok: false, message: FALLBACK };
  const problem = evidenceFileProblem(input.file);
  if (problem) return { ok: false, message: problem };

  const supabase = await createClient();
  const rpc = supabase as unknown as RpcClient;
  const { data, error } = await rpc.rpc('evidence_upload_begin', {
    p_request: {
      upload_id: input.uploadId,
      context_type: input.context.type,
      // A company document has no context object; the database refuses one.
      ...(library ? {} : { context_id: input.context.id }),
      ...(input.category ? { category: input.category } : {}),
      ...(input.folderId ? { folder_id: input.folderId } : {}),
      filename: input.file.name,
      mime_type: evidenceMimeType(input.file),
      size_bytes: input.file.size
    }
  });
  if (error) return { ok: false, message: await refusal(rpc, error, FALLBACK) };

  const reg = data as Registration;
  // A retry of an upload that already finished: nothing left to send.
  if (reg.upload_status !== 'Pending')
    return {
      ok: true,
      evidenceId: reg.evidence_id,
      path: reg.storage_path,
      token: null
    };

  const signed = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(reg.storage_path);
  if (signed.error || !signed.data) {
    // The bytes may already be there from an attempt whose answer was lost.
    const done = await completeEvidenceUpload(reg.evidence_id);
    if (done.ok) return { ...done, token: null };
    console.error('evidence signed upload url failed', signed.error);
    return { ok: false, message: 'Storage is unavailable. Try again.' };
  }
  return {
    ok: true,
    evidenceId: reg.evidence_id,
    path: reg.storage_path,
    token: signed.data.token
  };
}

export async function completeEvidenceUpload(
  evidenceId: string
): Promise<EvidenceUploadResult> {
  const blocked = await previewWriteBlock();
  if (blocked) return { ok: false, message: blocked };
  if (!EVIDENCE_UUID.test(evidenceId))
    return { ok: false, message: 'The upload failed. Try again.' };

  const rpc = (await createClient()) as unknown as RpcClient;
  const { data, error } = await rpc.rpc('evidence_upload_complete', {
    p_evidence_id: evidenceId
  });
  if (error)
    return {
      ok: false,
      message: await refusal(rpc, error, 'The upload failed. Try again.')
    };
  const row = data as Registration;
  return { ok: true, evidenceId: row.evidence_id, path: row.storage_path };
}
