import 'server-only';

import {
  dueState,
  FINANCE_LABEL,
  formatDate,
  pounds
} from '@/features/jobs/format';
import {
  getJobDetail,
  OPEN_TASK_STATUSES
} from '@/features/jobs/server/queries';
import { searchVisibleJobs } from '@/features/jobs/server/search';
import { z } from 'zod';
import type { ReadTool } from '../registry';
import { toTaskCard, taskForModel } from './tasks';

const RLS =
  'RLS on jobs/customers/presales/tasks (session-bound Supabase client)';

const isOpen = (status: string) =>
  (OPEN_TASK_STATUSES as readonly string[]).includes(status);

export const findJobTool: ReadTool<{ query: string }> = {
  name: 'find_job',
  summary: 'Find a job by reference, customer name or postcode',
  description:
    'Search the jobs the signed-in staff member can see, by job reference (e.g. SS-ABCD-0001), customer name, or postcode. Returns up to 8 matches with reference, customer, postcode and workflow stage. Use it to turn a name the staff member mentions into a job id before calling other job tools.',
  domain: 'jobs',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    query: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .describe('Job reference, customer name, or postcode')
  }),
  authorization: { permissions: [], enforcedBy: RLS },
  async execute({ query }) {
    const { hits, total } = await searchVisibleJobs(query);
    return {
      ok: true,
      data: {
        query,
        matches: hits.map((h) => ({
          job_id: h.id,
          job_ref: h.jobRef,
          customer_name: h.customerName,
          postcode: h.postcode,
          workflow_stage: h.workflowStage,
          sold_at: h.soldAt,
          // Stated so the assistant never presents finished history as live
          // work. A historical record has no open tasks and nobody scheduled.
          record_type: h.isHistorical
            ? 'historical_import (archived; imported from the previous system, no active work)'
            : 'live',
          ...(h.sourceReference
            ? { previous_system_reference: h.sourceReference }
            : {})
        })),
        total_matches: total,
        note:
          hits.length === 0
            ? 'No visible job matched. The job may not exist, or this staff member may not have access to it.'
            : undefined
      },
      display: {
        kind: 'job_list',
        query,
        total,
        jobs: hits.map((h) => ({
          id: h.id,
          jobRef: h.jobRef,
          customerName: h.customerName,
          postcode: h.postcode,
          workflowStage: h.workflowStage,
          soldAt: h.soldAt
        }))
      }
    };
  }
};

const jobIdInput = z.strictObject({
  jobId: z.uuid().describe('The job id (UUID) returned by find_job')
});

export const getJobTool: ReadTool<{ jobId: string }> = {
  name: 'get_job',
  summary: 'Read a job: customer, sale, system, scope and task counts',
  description:
    'Read one job by id: customer name and location, workflow stage, sale details (agreed price, payment route, salesperson, quote reference), the sold system (kWp, panels), required scope, surveyor notes, and counts of open / blocked / overdue tasks. Does not return quote revisions - those are not available yet. For what has happened on the job use get_job_timeline; for what is holding it up use get_job_blockers. For the stored files of a job (contracts, photos, commissioning records) use list_job_files.',
  domain: 'jobs',
  kind: 'read',
  status: 'available',
  inputSchema: jobIdInput,
  authorization: { permissions: [], enforcedBy: RLS },
  async execute({ jobId }) {
    // RLS decides visibility: a job this user may not see is simply not found.
    const detail = await getJobDetail(jobId);
    if (!detail) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'No job with that id is visible to the signed-in staff member.'
      };
    }
    const { job, tasks } = detail;
    const customer = job.customers;
    const presale = Array.isArray(job.presales)
      ? job.presales[0]
      : job.presales;
    const customerName = `${customer.first_name} ${customer.last_name}`;
    const scope = [
      job.roof_required && 'Roof',
      job.electrical_required && 'Electrical',
      job.scaffold_required && 'Scaffold'
    ].filter(Boolean) as string[];
    const open = tasks.filter((t) => isOpen(t.status));
    const taskCounts = {
      open: open.length,
      blocked: open.filter((t) => t.status === 'Blocked').length,
      overdue: open.filter((t) => dueState(t.dueAt) === 'overdue').length
    };
    // A historical import may carry no finance route, no price and no
    // salesperson: the legacy form did not record them. The assistant must say
    // "not recorded", never "no" and never "£0.00" - the difference between
    // unknown and false is exactly what it must not blur.
    const historical = job.record_class === 'HistoricalImport';
    const NOT_RECORDED = 'Not recorded in the historical source';
    const finance =
      job.finance_route === null
        ? historical
          ? NOT_RECORDED
          : 'Unknown'
        : (FINANCE_LABEL[job.finance_route] ?? job.finance_route);

    return {
      ok: true,
      data: {
        job_id: job.id,
        job_ref: job.job_ref,
        workflow_stage: job.workflow_stage,
        sold_at: job.sold_at,
        record_type: historical
          ? 'historical_import (archived; imported from the previous system, no active work)'
          : 'live',
        ...(historical
          ? {
              historical_note:
                'This is an imported record of a job completed before this system. It has no open tasks, ' +
                'nobody is scheduled on it, and any staff names on it are historical facts, not current allocations. ' +
                'Fields shown as not recorded were never captured by the old form - that is not the same as "no".',
              previous_system_reference: job.source_reference ?? undefined
            }
          : {}),
        // Contact details are deliberately left out of what the model reads.
        customer: {
          name: customerName,
          town: customer.town,
          postcode: customer.postcode
        },
        sale: {
          agreed_price_pence: job.original_gross_pence,
          current_contract_pence: job.current_contract_gross_pence,
          payment_route: finance,
          salesperson: job.salesperson?.display_name ?? null,
          lead_source: job.lead_source,
          quote_reference: job.quote_reference
        },
        system: presale
          ? {
              kwp: Number(presale.system_kwp),
              panels: presale.net_panels,
              catalogue_version: presale.catalogue_version
            }
          : null,
        scope_required: scope,
        surveyor_notes: {
          roof: presale?.roof_notes ?? null,
          electrical: presale?.electrical_notes ?? null
        },
        task_counts: taskCounts,
        record_version: job.version
      },
      display: {
        kind: 'job_summary',
        job: {
          id: job.id,
          jobRef: job.job_ref,
          customerName,
          postcode: customer.postcode,
          workflowStage: job.workflow_stage,
          soldAt: job.sold_at
        },
        facts: [
          { label: 'Sold', value: formatDate(job.sold_at) },
          {
            label: 'Agreed price',
            value:
              job.original_gross_pence === null
                ? historical
                  ? NOT_RECORDED
                  : 'Unknown'
                : pounds.format(job.original_gross_pence / 100)
          },
          { label: 'Payment', value: finance },
          ...(presale
            ? [
                {
                  label: 'System',
                  value: `${Number(presale.system_kwp).toFixed(2)} kWp · ${presale.net_panels} panels`
                }
              ]
            : []),
          { label: 'Scope', value: scope.length ? scope.join(', ') : '-' }
        ],
        taskCounts
      }
    };
  }
};

export const getJobTasksTool: ReadTool<{
  jobId: string;
  include: 'open' | 'all';
}> = {
  name: 'get_job_tasks',
  summary:
    "List a job's tasks with owner, due date, status and blocking reason",
  description:
    "List the tasks on one job: code, title, status (Open, Waiting, InProgress, Blocked, ...), owner and backup, due date, and the recorded blocking reason if any. This lists what each task's own record says. It is not a readiness assessment: for issues, work state and why an action is refused, use get_job_blockers.",
  domain: 'tasks',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    jobId: jobIdInput.shape.jobId,
    include: z
      .enum(['open', 'all'])
      .default('open')
      .describe("'open' (default) or 'all' including completed tasks")
  }),
  authorization: { permissions: [], enforcedBy: RLS },
  async execute({ jobId, include }) {
    const detail = await getJobDetail(jobId);
    if (!detail) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'No job with that id is visible to the signed-in staff member.'
      };
    }
    const tasks =
      include === 'all'
        ? detail.tasks
        : detail.tasks.filter((t) => isOpen(t.status));
    return {
      ok: true,
      data: {
        job_id: detail.job.id,
        job_ref: detail.job.job_ref,
        include,
        tasks: tasks.map(taskForModel),
        visibility_note:
          'Only tasks visible to this staff member are listed; others may exist.'
      },
      display: {
        kind: 'task_list',
        title: `${include === 'all' ? 'Tasks' : 'Open tasks'} · ${detail.job.job_ref}`,
        total: tasks.length,
        tasks: tasks.slice(0, 12).map(toTaskCard)
      }
    };
  }
};
