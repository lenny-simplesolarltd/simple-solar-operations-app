import { createDataClient } from '@/lib/supabase/data';

export const OPEN_TASK_STATUSES = [
  'Open',
  'Waiting',
  'InProgress',
  'Blocked'
] as const;

export interface TaskListItem {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: number;
  dueAt: string | null;
  blockingReason: string | null;
  ownerId: string;
  ownerName: string;
  backupId: string | null;
  backupName: string | null;
  jobId: string | null;
  jobRef: string | null;
  jobName: string | null;
}

const TASK_SELECT =
  'id, template_code, title, status, priority, due_at, blocking_reason, owner_id, backup_id, job_id, jobs(job_ref, display_name), owner:people!tasks_owner_id_fkey(display_name), backup:people!tasks_backup_id_fkey(display_name)';

type TaskRow = {
  id: string;
  template_code: string;
  title: string;
  status: string;
  priority: number;
  due_at: string | null;
  blocking_reason: string | null;
  owner_id: string;
  backup_id: string | null;
  job_id: string | null;
  jobs: { job_ref: string; display_name: string } | null;
  owner: { display_name: string } | null;
  backup: { display_name: string } | null;
};

const toItem = (t: TaskRow): TaskListItem => ({
  id: t.id,
  code: t.template_code,
  title: t.title,
  status: t.status,
  priority: t.priority,
  dueAt: t.due_at,
  blockingReason: t.blocking_reason,
  ownerId: t.owner_id,
  ownerName: t.owner?.display_name ?? 'Unknown',
  backupId: t.backup_id,
  backupName: t.backup?.display_name ?? null,
  jobId: t.job_id,
  jobRef: t.jobs?.job_ref ?? null,
  jobName: t.jobs?.display_name ?? null
});

/** Open tasks visible to the current user under RLS: their own/backup tasks, or every task with task.read.all. */
export async function getOpenTasks(): Promise<TaskListItem[]> {
  const supabase = await createDataClient();
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .in('status', [...OPEN_TASK_STATUSES])
    .order('priority', { ascending: true })
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(`tasks: ${error.message}`);
  return (data as unknown as TaskRow[]).map(toItem);
}

export async function getJobDetail(jobId: string) {
  const supabase = await createDataClient();
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      'id, job_ref, display_name, sold_at, workflow_stage, record_class, source_system, source_reference, archived_at, finance_route, original_gross_pence, current_contract_gross_pence, lead_source, quote_reference, roof_required, electrical_required, scaffold_required, version, customers(first_name, last_name, address_line1, address_line2, town, postcode, phone, email), presales(submitted_at, system_kwp, net_panels, computed_total_pence, agreed_price_pence, price_breakdown, catalogue_version, roof_notes, electrical_notes), salesperson:people!jobs_salesperson_id_fkey(display_name)'
    )
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(`job: ${error.message}`);
  if (!job) return null;

  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('job_id', jobId)
    .order('template_code');
  if (taskError) throw new Error(`job tasks: ${taskError.message}`);

  return { job, tasks: (tasks as unknown as TaskRow[]).map(toItem) };
}
