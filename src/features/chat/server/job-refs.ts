import 'server-only';

import { createDataClient } from '@/lib/supabase/data';

/**
 * Job reference -> job id, for the ids the database already resolved on each
 * message.
 *
 * This looks up nothing the reader could not already see: app.chat_job_refs
 * only stored ids the AUTHOR may open, and this query runs under RLS as the
 * reader, so a reference stored for one member is still dropped here for
 * another who cannot see that job. The UI links what survives both.
 */
export async function resolveJobRefs(
  jobIds: string[]
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(jobIds)).filter(Boolean);
  if (unique.length === 0) return {};
  const supabase = await createDataClient();
  const { data } = await supabase
    .from('jobs')
    .select('id, job_ref')
    .in('id', unique);
  return Object.fromEntries(
    (data ?? []).map((j) => [String(j.job_ref).toUpperCase(), String(j.id)])
  );
}
