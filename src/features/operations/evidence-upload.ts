'use server';

import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';

// Evidence files go to the private `evidence` bucket under `<job id>/...`.
// Storage RLS (app.can_access_job_files) decides who may upload for a job;
// this only mints a one-off signed upload URL under the caller's session. The
// uploaded path is then handed to a command (TASK_COMPLETE evidence_path,
// TASK_EVIDENCE_ATTACH ...), which validates it before recording evidence.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 120;

export type EvidenceUploadTicket =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string };

export async function createEvidenceUpload(
  jobId: string,
  filename: string
): Promise<EvidenceUploadTicket> {
  const blocked = await previewWriteBlock();
  if (blocked) return { ok: false, message: blocked };
  if (!UUID.test(jobId))
    return { ok: false, message: 'That job could not be found.' };

  const safe = filename
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(-MAX_NAME);
  if (!safe) return { ok: false, message: 'Choose a file with a name.' };
  const path = `${jobId.toLowerCase()}/${Date.now()}-${safe}`;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('evidence')
    .createSignedUploadUrl(path);
  if (error || !data) {
    return {
      ok: false,
      message: 'You can’t upload files for this job, or storage is unavailable.'
    };
  }
  return { ok: true, path: data.path, token: data.token };
}
