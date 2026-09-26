import 'server-only';

import { searchVisibleJobs } from '@/features/jobs/server/search';
import type { ToolResult } from '../registry';

/**
 * One job, from whatever the staff member called it.
 *
 * The job-scoped tools all take "SS-ABCD-0001", a uuid from find_job, or a
 * customer name, and they must all answer an ambiguous name the same way -
 * by naming the candidates and asking, never by picking the first hit.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolvedJob =
  | { ok: true; jobId: string; jobRef: string | null }
  | { ok: false; result: ToolResult };

export async function resolveJobReference(job: string): Promise<ResolvedJob> {
  if (UUID.test(job)) return { ok: true, jobId: job, jobRef: null };

  const { hits } = await searchVisibleJobs(job);
  const exact = hits.filter(
    (h) => h.jobRef.toUpperCase() === job.toUpperCase()
  );
  const match =
    exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (match) return { ok: true, jobId: match.id, jobRef: match.jobRef };

  if (hits.length > 1) {
    return {
      ok: false,
      result: {
        ok: false,
        code: 'AMBIGUOUS_JOB',
        message: `"${job}" matches ${hits.length} jobs (${hits
          .slice(0, 5)
          .map((h) => `${h.jobRef} ${h.customerName}`)
          .join('; ')}). Ask which one they mean.`
      }
    };
  }
  return {
    ok: false,
    result: {
      ok: false,
      code: 'NOT_FOUND',
      message:
        'No job the signed-in staff member can see matched. It may not exist, or they may not have access to it.'
    }
  };
}

export const money = (pence: number): string =>
  `£${(pence / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
