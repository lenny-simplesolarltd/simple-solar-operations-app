'use server';

import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import type {
  JobSoldResult,
  PresaleSubmission,
  SubmitResult
} from '../contract';
import { messageFor } from './messages';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Submits a sale. This action decides nothing: it forwards the payload to
 * public.submit_presale(), which derives the actor from the session
 * (auth.uid()), validates, and commits customer + job + presale + tasks + audit
 * in one transaction. Retrying with the same commandId is safe (idempotent).
 */
export async function submitPresale(
  commandId: string,
  submission: PresaleSubmission
): Promise<SubmitResult> {
  const blocked = await previewWriteBlock();
  if (blocked)
    return { ok: false, code: 'PREVIEW_MODE_READ_ONLY', message: blocked };

  if (!UUID.test(commandId)) {
    return {
      ok: false,
      code: 'INVALID_COMMAND_ID',
      message: messageFor('INVALID_COMMAND_ID')
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('submit_presale', {
    p_command_id: commandId,
    // The database function is the validator; this cast only satisfies the generated Json type.
    p_payload: JSON.parse(JSON.stringify(submission))
  });

  if (error) {
    // Business rejections are raised as P0001 with the code as the message and
    // the offending field (e.g. "customer.postcode") as the hint.
    const code = error.code === 'P0001' ? error.message : 'UNEXPECTED';
    if (code === 'UNEXPECTED') console.error('submit_presale failed', error);
    return {
      ok: false,
      code,
      message: messageFor(code),
      ...(error.hint ? { field: error.hint } : {})
    };
  }

  return { ok: true, result: data as unknown as JobSoldResult };
}
