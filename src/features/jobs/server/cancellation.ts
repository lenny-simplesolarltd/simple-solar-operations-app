'use server';

import { createDataClient } from '@/lib/supabase/data';

// Read-only cancellation preview (public.cancellation_preview -> s15 preview):
// what CANCEL_JOB would change on this job, before anyone confirms. The
// database checks the role and job assignment; this only forwards.

export interface CancellationPreview {
  can_cancel: boolean;
  risks: string[];
  would: Record<string, number>;
}

export type CancellationPreviewResult =
  | { ok: true; preview: CancellationPreview }
  | { ok: false; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getCancellationPreview(
  jobId: string,
  effectiveDate?: string
): Promise<CancellationPreviewResult> {
  if (!UUID.test(jobId)) return { ok: false, message: 'Job not found.' };
  const supabase = (await createDataClient()) as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await supabase.rpc('cancellation_preview', {
    p_job_id: jobId,
    ...(effectiveDate && DATE.test(effectiveDate)
      ? { p_effective_date: effectiveDate }
      : {})
  });
  if (error) {
    const code = error.message.split(':')[0].trim();
    return {
      ok: false,
      message:
        code === 'R1A_ROLE_DENIED' || code === 'R1A_JOB_ACCESS_DENIED'
          ? 'You can’t cancel this job.'
          : 'The cancellation preview could not be loaded.'
    };
  }
  return { ok: true, preview: data as CancellationPreview };
}
