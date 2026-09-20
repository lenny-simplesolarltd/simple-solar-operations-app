import { createDataClient } from '@/lib/supabase/data';
import type { AppUser } from '@/lib/auth';

/** Permissions held through the user's roles. RLS and the database functions remain the enforcement point. */
export async function getPermissions(user: AppUser): Promise<Set<string>> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_code')
    .in('role_code', user.roles);
  if (error) throw new Error(`role_permissions: ${error.message}`);
  return new Set(data.map((row) => row.permission_code));
}

/** Active Surveyors the current user is allowed to see (a Surveyor sees only themselves). */
export async function getSalespeople(): Promise<
  { id: string; displayName: string }[]
> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('person_roles')
    .select('people!person_roles_person_id_fkey(id, display_name, active)')
    .eq('role_code', 'Surveyor')
    .eq('active', true);
  if (error) throw new Error(`salespeople: ${error.message}`);
  return data
    .map((row) => row.people)
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, displayName: p.display_name }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export interface JobListItem {
  id: string;
  jobRef: string;
  displayName: string;
  customerName: string;
  postcode: string;
  soldAt: string;
  workflowStage: string;
  // Null only on an imported historical record, where the legacy source did
  // not capture these. Every live job still carries all three.
  financeRoute: string | null;
  agreedPricePence: number | null;
  systemKwp: number | null;
  netPanels: number | null;
  salespersonId: string | null;
}

/** Jobs visible to the current user under RLS (a Surveyor: their own; office: all), newest first. */
export async function getVisibleJobs(): Promise<JobListItem[]> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, job_ref, display_name, sold_at, workflow_stage, finance_route, original_gross_pence, salesperson_id, customers(first_name, last_name, postcode), presales(system_kwp, net_panels)'
    )
    .order('sold_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`jobs: ${error.message}`);
  return data.map((job) => {
    const presale = Array.isArray(job.presales)
      ? job.presales[0]
      : job.presales;
    return {
      id: job.id,
      jobRef: job.job_ref,
      displayName: job.display_name,
      customerName: `${job.customers.first_name} ${job.customers.last_name}`,
      postcode: job.customers.postcode,
      soldAt: job.sold_at,
      workflowStage: job.workflow_stage,
      financeRoute: job.finance_route,
      agreedPricePence: job.original_gross_pence,
      systemKwp: presale?.system_kwp ?? null,
      netPanels: presale?.net_panels ?? null,
      salespersonId: job.salesperson_id
    };
  });
}
