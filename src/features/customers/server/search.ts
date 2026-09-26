import 'server-only';

import { searchTerms } from '@/features/jobs/server/search';
import { createDataClient } from '@/lib/supabase/data';

/**
 * Finding a customer without going through a job.
 *
 * Until now the only way in was find_job, which is the wrong shape for half
 * the questions staff actually ask - "have we ever done anything for the
 * Partons", "who is on 07700 900123", "do we have two Mrs Smiths in DL12".
 *
 * There is no new read model and no new grant. public.customers already
 * carries a SELECT policy tied to job visibility (customers_select: a customer
 * is readable when a job of theirs is), and public.jobs carries its own. So a
 * session-bound query returns exactly the customers whose jobs this person may
 * already see, and the job list under each customer is the same list they
 * would get from find_job. A Surveyor sees their own; the office sees all.
 */

export interface CustomerJobSummary {
  id: string;
  jobRef: string;
  workflowStage: string;
  soldAt: string | null;
  isHistorical: boolean;
}

export interface CustomerSearchHit {
  id: string;
  name: string;
  postcode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  alternateContact: string | null;
  /** Every job of theirs this person can see, newest sale first. */
  jobs: CustomerJobSummary[];
}

type CustomerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  alternate_contact: string | null;
};

type JobRow = {
  id: string;
  job_ref: string;
  customer_id: string;
  workflow_stage: string;
  sold_at: string | null;
  record_class: string;
};

const CUSTOMER_SELECT =
  'id, first_name, last_name, address_line1, address_line2, town, postcode, phone, email, alternate_contact';

/**
 * Terms safe to place inside a PostgREST filter, plus the digits of a phone
 * number. People type "07700 900123" and the column holds "07700900123" as
 * often as not, so a number is searched both as typed and compacted.
 */
function phoneVariants(query: string): string[] {
  const digits = query.replace(/[^0-9]/g, '');
  return digits.length >= 6 ? [digits] : [];
}

const nameOf = (c: CustomerRow) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'Unnamed';

const addressOf = (c: CustomerRow) =>
  [c.address_line1, c.address_line2, c.town].filter(Boolean).join(', ') || null;

/**
 * Customers matching a name, postcode, address, phone number or email address,
 * among the customers this person can already see.
 *
 * Every term must match somewhere on the customer, the same "all terms" rule
 * job search uses, so "Parton DL12" narrows rather than widens.
 */
export async function searchVisibleCustomers(
  query: string,
  limit = 8
): Promise<{ hits: CustomerSearchHit[]; total: number }> {
  const terms = searchTerms(query);
  const phones = phoneVariants(query);
  if (terms.length === 0 && phones.length === 0) return { hits: [], total: 0 };

  const supabase = await createDataClient();

  let byFields = supabase
    .from('customers')
    .select(CUSTOMER_SELECT, { count: 'exact' })
    .order('last_name')
    .limit(limit);
  for (const term of terms) {
    const like = `*${term}*`;
    byFields = byFields.or(
      `first_name.ilike.${like},last_name.ilike.${like},postcode.ilike.${like},` +
        `address_line1.ilike.${like},town.ilike.${like},` +
        `phone.ilike.${like},email.ilike.${like},alternate_contact.ilike.${like}`
    );
  }

  const queries = [byFields];
  // A phone number typed with spaces never matches a compacted column, so it
  // gets its own query rather than being ANDed into the one above.
  for (const digits of phones) {
    queries.push(
      supabase
        .from('customers')
        .select(CUSTOMER_SELECT, { count: 'exact' })
        .or(`phone.ilike.%${digits}%,alternate_contact.ilike.%${digits}%`)
        .limit(limit)
    );
  }

  const results = await Promise.all(queries);
  for (const r of results) {
    if (r.error) throw new Error(`customer search: ${r.error.message}`);
  }

  const seen = new Set<string>();
  const rows: CustomerRow[] = [];
  for (const row of results.flatMap(
    (r) => (r.data ?? []) as unknown as CustomerRow[]
  )) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  const page = rows.slice(0, limit);
  if (page.length === 0) {
    return { hits: [], total: 0 };
  }

  // Their jobs, in one round trip. RLS decides which of them come back, so a
  // customer reachable through one visible job does not leak the others.
  const { data: jobData, error: jobError } = await supabase
    .from('jobs')
    .select('id, job_ref, customer_id, workflow_stage, sold_at, record_class')
    .in(
      'customer_id',
      page.map((c) => c.id)
    )
    .order('sold_at', { ascending: false });
  if (jobError) throw new Error(`customer search jobs: ${jobError.message}`);

  const jobsByCustomer = new Map<string, CustomerJobSummary[]>();
  for (const job of (jobData ?? []) as unknown as JobRow[]) {
    const list = jobsByCustomer.get(job.customer_id) ?? [];
    list.push({
      id: job.id,
      jobRef: job.job_ref,
      workflowStage: job.workflow_stage,
      soldAt: job.sold_at,
      isHistorical: job.record_class === 'HistoricalImport'
    });
    jobsByCustomer.set(job.customer_id, list);
  }

  return {
    hits: page.map((c) => ({
      id: c.id,
      name: nameOf(c),
      postcode: c.postcode,
      address: addressOf(c),
      phone: c.phone,
      email: c.email,
      alternateContact: c.alternate_contact,
      jobs: jobsByCustomer.get(c.id) ?? []
    })),
    // A lower bound when the query hit its limit - enough to say "there are more".
    total: Math.max(rows.length, ...results.map((r) => r.count ?? 0))
  };
}
