import { createDataClient } from '@/lib/supabase/data';

export interface JobSearchHit {
  id: string;
  jobRef: string;
  customerName: string;
  postcode: string;
  workflowStage: string;
  soldAt: string;
}

const JOB_SELECT =
  'id, job_ref, sold_at, workflow_stage, customers!inner(first_name, last_name, postcode)';

type JobRow = {
  id: string;
  job_ref: string;
  sold_at: string;
  workflow_stage: string;
  customers: { first_name: string; last_name: string; postcode: string };
};

const HONORIFICS = new Set(['mr', 'mrs', 'miss', 'ms', 'mx', 'dr']);

/**
 * Search terms safe to place inside a PostgREST filter: letters, digits,
 * apostrophes and hyphens only, so user text can never add filter syntax.
 * Honorifics ("Miss Parton") are dropped - customers are stored by name.
 */
export function searchTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((term) => term.replace(/[^A-Za-z0-9\u00C0-\u024F'-]/g, ''))
    .filter((term) => term.length > 0 && !HONORIFICS.has(term.toLowerCase()))
    .slice(0, 5);
}

const toHit = (job: JobRow): JobSearchHit => ({
  id: job.id,
  jobRef: job.job_ref,
  customerName: `${job.customers.first_name} ${job.customers.last_name}`,
  postcode: job.customers.postcode,
  workflowStage: job.workflow_stage,
  soldAt: job.sold_at
});

/**
 * Jobs matching a reference, customer name or postcode - only among the jobs
 * the current user can see under RLS (a Surveyor: their own; office: all).
 * Every term must match the job reference or one of the customer fields.
 */
export async function searchVisibleJobs(
  query: string,
  limit = 8
): Promise<{ hits: JobSearchHit[]; total: number }> {
  const terms = searchTerms(query);
  if (terms.length === 0) return { hits: [], total: 0 };

  const supabase = await createDataClient();

  // A full job reference is an exact lookup.
  const compact = query.trim().toUpperCase();
  if (/^SS-[A-Z0-9]{2,8}-\d{2,6}$/.test(compact)) {
    const { data, error } = await supabase
      .from('jobs')
      .select(JOB_SELECT)
      .eq('job_ref', compact)
      .limit(1);
    if (error) throw new Error(`job search: ${error.message}`);
    const hits = (data as unknown as JobRow[]).map(toHit);
    if (hits.length > 0) return { hits, total: hits.length };
  }

  let byCustomer = supabase
    .from('jobs')
    .select(JOB_SELECT, { count: 'exact' })
    .order('sold_at', { ascending: false })
    .limit(limit);
  for (const term of terms) {
    const like = `*${term}*`;
    byCustomer = byCustomer.or(
      `first_name.ilike.${like},last_name.ilike.${like},postcode.ilike.${like}`,
      { referencedTable: 'customers' }
    );
  }

  let byRef = supabase
    .from('jobs')
    .select(JOB_SELECT, { count: 'exact' })
    .order('sold_at', { ascending: false })
    .limit(limit);
  for (const term of terms) {
    byRef = byRef.ilike('job_ref', `%${term}%`);
  }

  const [customerMatch, refMatch] = await Promise.all([byCustomer, byRef]);
  if (customerMatch.error) {
    throw new Error(`job search: ${customerMatch.error.message}`);
  }
  if (refMatch.error) throw new Error(`job search: ${refMatch.error.message}`);

  const seen = new Set<string>();
  const hits: JobSearchHit[] = [];
  for (const row of [
    ...(refMatch.data as unknown as JobRow[]),
    ...(customerMatch.data as unknown as JobRow[])
  ]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    hits.push(toHit(row));
  }
  return {
    hits: hits.slice(0, limit),
    // A lower bound when either query hit its limit - enough to say "there are more".
    total: Math.max(hits.length, customerMatch.count ?? 0, refMatch.count ?? 0)
  };
}
