import 'server-only';

import {
  getBatchProgress,
  getBatches,
  preflightBatch,
  retryBatch,
  submitBatch
} from '@/features/tasks/server/batch';
import type {
  BatchOperation,
  BatchPlanItem,
  BatchPreflightRead
} from '@/lib/backend/models';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationTool,
  ReadTool,
  ToolResult
} from '../registry';

/**
 * SimpleBot's bulk task tools.
 *
 * There is no bot-only path here. Every one of these builds the SAME selector
 * the Tasks screen builds, calls the SAME BATCH_PREFLIGHT read to resolve it,
 * and submits the SAME TASK_BATCH_SUBMIT command. The permissions, the
 * requirement policy, the idempotency, the audit and the processing centre are
 * all the ones the screen already uses.
 *
 * What the model may decide is narrow and typed: which registered tool, a job
 * it has already read, a task-code prefix, an owner name, a status, and the
 * words of a reason. It cannot choose a table, a command, an actor, a
 * permission or a mode, and it cannot widen a selection after the preflight -
 * the confirmed action carries the resolved ids, not the question.
 */

const ENFORCED =
  'app.authorize_command (office roles) + task.override_complete / task.complete.cross_owner, re-checked per item in the batch executor';

/**
 * The coarse pre-check for offering these at all. The authoritative gate is
 * the command's own role list (Admin/Manager/Director/Office/VariationApprover
 * via app.command_registry), which the registry here cannot express - it
 * understands permissions, not roles. task.read.all is the closest real,
 * enforced permission: it is held by exactly the roles that run the office
 * task queues, and it is the same permission that opens the team task lists
 * these actions operate on. Anyone it wrongly excludes is refused a tool they
 * could have used, never given one they could not - and the command re-checks
 * everything regardless.
 */
const OFFICE_TASKS = ['task.read.all'] as const;

const uuid = z.uuid();

const codePrefix = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9-]{0,15}$/)
  .optional()
  .describe(
    "Task code prefix, e.g. 'PRE' for the prebooking tasks or 'PRE01' for one. Omit for every task matching the other filters."
  );

const statusFilter = z
  .enum(['open', 'closed', 'all'])
  .default('open')
  .describe(
    "'open' is work still to do; 'closed' is completed/cancelled work (what you reopen)"
  );

/**
 * The selector the TASKS read model accepts, plus the code prefix. Indexed so
 * it satisfies the batch module's selector shape without a cast: every value
 * here is a plain string the read model validates.
 */
type TaskSelector = Record<string, string>;

const buildSelector = (input: {
  jobId?: string;
  status?: 'open' | 'closed' | 'all';
  codePrefix?: string;
  ownerId?: string;
}): TaskSelector => ({
  scope: 'all',
  status: input.status ?? 'open',
  ...(input.jobId ? { job_id: input.jobId } : {}),
  ...(input.ownerId ? { owner_id: input.ownerId } : {}),
  ...(input.codePrefix ? { code_prefix: input.codePrefix } : {})
});

const planForModel = (i: BatchPlanItem) => ({
  task_id: i.task_id,
  code: i.template_code,
  title: i.title,
  job_ref: i.job_ref ?? null,
  owner: i.owner_name,
  status: i.status,
  outcome: i.outcome,
  ...(i.outcome !== 'ready' && {
    why: i.blocking[0]?.detail ?? null
  }),
  ...(i.bypassed.length > 0 && {
    would_bypass: i.bypassed.map((b) => b.detail)
  })
});

const OPERATION_VERB: Record<BatchOperation, string> = {
  TASK_BATCH_COMPLETE: 'Complete',
  TASK_BATCH_OVERRIDE_COMPLETE: 'Complete by override',
  TASK_BATCH_REOPEN: 'Reopen',
  TASK_BATCH_REASSIGN: 'Reassign'
};

const refuse = (code: string, message: string) => ({
  ok: false as const,
  code,
  message
});

/**
 * Resolves the request and describes what would happen. Shared by the read
 * tool and by every mutation's prepare(), so the person is never shown one
 * count and given another.
 */
async function resolve(
  operation: BatchOperation,
  selector: TaskSelector,
  taskIds?: string[]
): Promise<
  | { ok: true; plan: BatchPreflightRead; ready: BatchPlanItem[] }
  | { ok: false; code: string; message: string }
> {
  const result = await preflightBatch(
    operation,
    taskIds?.length ? { taskIds } : { selector }
  );
  if (!result.ok) {
    return refuse(result.error.code, result.error.message);
  }
  return {
    ok: true,
    plan: result.data,
    ready: result.data.items.filter((i) => i.outcome === 'ready')
  };
}

/** The preview a staff member confirms. Says the count, and says what will not happen. */
function previewFor(
  operation: BatchOperation,
  plan: BatchPreflightRead,
  ready: BatchPlanItem[],
  reason: string | null
): ActionPreview {
  const changes: ActionPreview['changes'] = ready.slice(0, 12).map((i) => ({
    label: `${i.template_code} · ${i.job_ref ?? 'no job'}`,
    to: `${OPERATION_VERB[operation]} (owner ${i.owner_name ?? 'unassigned'})`
  }));
  if (ready.length > changes.length) {
    changes.push({
      label: 'and more',
      to: `${ready.length - changes.length} further tasks`
    });
  }

  const warnings: string[] = [];
  for (const [outcome, count] of Object.entries(plan.counts)) {
    if (outcome === 'ready') continue;
    const example = plan.items.find((i) => i.outcome === outcome);
    warnings.push(
      `${count} will not be touched: ${example?.blocking[0]?.detail ?? outcome}`
    );
  }
  if (operation === 'TASK_BATCH_OVERRIDE_COMPLETE') {
    const unrecorded = new Set<string>();
    for (const i of ready) {
      for (const b of i.bypassed)
        if (b.kind === 'normal') unrecorded.add(b.detail);
    }
    if (unrecorded.size > 0) {
      warnings.push(
        `Nothing will be recorded for: ${Array.from(unrecorded).join(', ')}. The job's booking checks will still report these as outstanding.`
      );
    }
  }

  return {
    title: `${OPERATION_VERB[operation]} ${ready.length} ${ready.length === 1 ? 'task' : 'tasks'}`,
    summary:
      ready.length === 0
        ? 'Nothing in this selection can be done.'
        : `${ready.length} of ${plan.total} selected tasks will be processed.${reason ? ` Reason: ${reason}` : ''}`,
    changes,
    warnings,
    confirmLabel: `${OPERATION_VERB[operation]} ${ready.length}`,
    expectedVersion: null
  };
}

/** Submits the resolved set. The ids are the preflight's, never re-resolved. */
async function submit(
  operation: BatchOperation,
  args: Record<string, unknown>,
  taskIds: string[],
  commandId: string
): Promise<ToolResult> {
  const result = await submitBatch({
    operation,
    args,
    target: { taskIds },
    source: 'simplebot',
    commandId
  });
  if (!result.ok) {
    return {
      ok: false,
      code: result.outcome.code ?? 'BATCH_REFUSED',
      message: result.outcome.message
    };
  }
  return {
    ok: true,
    data: {
      operation_id: result.batchId,
      queued: result.queued,
      progress: result.progress,
      note: 'Processing continues in the background. The staff member can close this chat; progress is on the Operations screen, and you can read it with get_operation_status.'
    }
  };
}

// -- The preflight read ---------------------------------------------------------------

const planInput = z.strictObject({
  action: z
    .enum(['complete', 'override_complete', 'reopen', 'reassign'])
    .describe('Which bulk action you are considering'),
  jobId: uuid
    .optional()
    .describe(
      'The job, from find_job / get_job. Omit only for a whole-team action.'
    ),
  codePrefix,
  status: statusFilter,
  ownerId: uuid
    .optional()
    .describe("Limit to one person's tasks, by their id from get_job")
});

const ACTION_TO_OPERATION: Record<string, BatchOperation> = {
  complete: 'TASK_BATCH_COMPLETE',
  override_complete: 'TASK_BATCH_OVERRIDE_COMPLETE',
  reopen: 'TASK_BATCH_REOPEN',
  reassign: 'TASK_BATCH_REASSIGN'
};

export const planTaskActionTool: ReadTool<z.infer<typeof planInput>> = {
  name: 'plan_task_action',
  summary: 'See which tasks a bulk action would affect, and what it would skip',
  description:
    'Resolve a bulk task request BEFORE doing it: returns the exact tasks that match, which of them the action can actually do, and why each of the others cannot. Use it whenever the staff member describes tasks in words ("all the prebooking tasks for this job") rather than naming them, and tell them the result before acting. Writes nothing.',
  domain: 'tasks',
  kind: 'read',
  status: 'available',
  inputSchema: planInput,
  authorization: { permissions: OFFICE_TASKS, enforcedBy: ENFORCED },
  async execute(input) {
    const operation = ACTION_TO_OPERATION[input.action];
    const resolved = await resolve(operation, buildSelector(input));
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      data: {
        action: input.action,
        total_matching: resolved.plan.total,
        can_do_now: resolved.ready.length,
        by_outcome: resolved.plan.counts,
        tasks: resolved.plan.items.slice(0, 40).map(planForModel),
        truncated: resolved.plan.items.length > 40
      }
    };
  }
};

// -- Mutations ------------------------------------------------------------------------

const targetInput = z.strictObject({
  jobId: uuid
    .optional()
    .describe(
      'The job, from find_job / get_job. Required unless taskIds is given.'
    ),
  taskIds: z
    .array(uuid)
    .min(1)
    .max(200)
    .optional()
    .describe('Exact task ids, when the staff member named particular tasks'),
  codePrefix,
  ownerId: uuid.optional().describe("Limit to one person's tasks")
});

const completeInput = targetInput.extend({
  note: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe('The completion note recorded against every task')
});

export const completeTasksTool: MutationTool<z.infer<typeof completeInput>> = {
  name: 'complete_tasks',
  summary: 'Complete tasks normally, in bulk',
  description:
    'Complete one or more tasks the ordinary way. Tasks that need a file or extra details (most prebooking tasks) CANNOT be completed this way and are reported back untouched - say so rather than pretending. Run plan_task_action first when the request is described in words.',
  domain: 'tasks',
  kind: 'mutation',
  status: 'available',
  inputSchema: completeInput,
  authorization: { permissions: OFFICE_TASKS, enforcedBy: ENFORCED },
  async prepare(input) {
    if (!input.jobId && !input.taskIds?.length) {
      return refuse(
        'TASK_TARGET_REQUIRED',
        'Say which job, or which tasks. Find the job first.'
      );
    }
    const resolved = await resolve(
      'TASK_BATCH_COMPLETE',
      buildSelector({ ...input, status: 'open' }),
      input.taskIds
    );
    if (!resolved.ok) return resolved;
    if (resolved.ready.length === 0) {
      // Say what else exists. Without this the answer stops at "cannot be done
      // here", and the staff member is left to know on their own that an
      // administrative override is the way through.
      return refuse(
        'TASK_NOTHING_TO_DO',
        `None of the ${resolved.plan.total} matching tasks can be completed this way. ${
          resolved.plan.items[0]?.blocking[0]?.detail ?? ''
        } These tasks record business facts that only their own screen can capture. ` +
          'If the staff member wants them closed anyway, override_complete_tasks can do it - ' +
          'tell them that is available and what it means: the task stops being asked for, ' +
          "nothing about the underlying work is recorded, and the job's checks still report " +
          'those requirements as outstanding. Do not run it unless they ask for it.'
      );
    }
    return {
      ok: true,
      preview: previewFor(
        'TASK_BATCH_COMPLETE',
        resolved.plan,
        resolved.ready,
        input.note
      )
    };
  },
  async execute(input, ctx) {
    const resolved = await resolve(
      'TASK_BATCH_COMPLETE',
      buildSelector({ ...input, status: 'open' }),
      input.taskIds
    );
    if (!resolved.ok) return resolved;
    return submit(
      'TASK_BATCH_COMPLETE',
      { completion_note: input.note },
      resolved.ready.map((i) => i.task_id),
      ctx.commandId
    );
  }
};

const overrideInput = targetInput.extend({
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe('Why the override is being used. Recorded against every task.')
});

export const overrideCompleteTasksTool: MutationTool<
  z.infer<typeof overrideInput>
> = {
  name: 'override_complete_tasks',
  summary: 'Complete tasks by administrative override',
  description:
    "Mark tasks complete by override: the task stops being required, but NOTHING is recorded for it - no invoice, no bank confirmation, no evidence, no verification. The job's booking checks still report those as outstanding, so never tell the staff member the underlying work is done or that the job can now progress. Offer it when normal completion has been refused because a task needs information only its own screen can record, and whenever they ask to override or force something through. Only run it when they have asked for it, and only when they hold the permission.",
  domain: 'tasks',
  kind: 'mutation',
  status: 'available',
  inputSchema: overrideInput,
  authorization: {
    permissions: [...OFFICE_TASKS, 'task.override_complete'],
    enforcedBy: ENFORCED
  },
  async prepare(input) {
    if (!input.jobId && !input.taskIds?.length) {
      return refuse(
        'TASK_TARGET_REQUIRED',
        'Say which job, or which tasks. Find the job first.'
      );
    }
    const resolved = await resolve(
      'TASK_BATCH_OVERRIDE_COMPLETE',
      buildSelector({ ...input, status: 'open' }),
      input.taskIds
    );
    if (!resolved.ok) return resolved;
    if (resolved.ready.length === 0) {
      return refuse(
        'TASK_NOTHING_TO_DO',
        `None of the ${resolved.plan.total} matching tasks can be overridden. ${
          resolved.plan.items[0]?.blocking[0]?.detail ?? ''
        }`
      );
    }
    return {
      ok: true,
      preview: previewFor(
        'TASK_BATCH_OVERRIDE_COMPLETE',
        resolved.plan,
        resolved.ready,
        input.reason
      )
    };
  },
  async execute(input, ctx) {
    const resolved = await resolve(
      'TASK_BATCH_OVERRIDE_COMPLETE',
      buildSelector({ ...input, status: 'open' }),
      input.taskIds
    );
    if (!resolved.ok) return resolved;
    return submit(
      'TASK_BATCH_OVERRIDE_COMPLETE',
      { override_reason: input.reason },
      resolved.ready.map((i) => i.task_id),
      ctx.commandId
    );
  }
};

const reopenInput = targetInput.extend({
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe('Why the tasks are being reopened')
});

export const reopenTasksTool: MutationTool<z.infer<typeof reopenInput>> = {
  name: 'reopen_tasks',
  summary: 'Reopen completed tasks, in bulk',
  description:
    'Put completed tasks back on the list. The previous completion, its note and its history are kept; the task simply becomes open again. A job that had advanced may move back a stage.',
  domain: 'tasks',
  kind: 'mutation',
  status: 'available',
  inputSchema: reopenInput,
  authorization: { permissions: OFFICE_TASKS, enforcedBy: ENFORCED },
  async prepare(input) {
    if (!input.jobId && !input.taskIds?.length) {
      return refuse(
        'TASK_TARGET_REQUIRED',
        'Say which job, or which tasks. Find the job first.'
      );
    }
    const resolved = await resolve(
      'TASK_BATCH_REOPEN',
      buildSelector({ ...input, status: 'closed' }),
      input.taskIds
    );
    if (!resolved.ok) return resolved;
    if (resolved.ready.length === 0) {
      return refuse(
        'TASK_NOTHING_TO_DO',
        'None of the matching tasks can be reopened (only completed tasks can).'
      );
    }
    return {
      ok: true,
      preview: previewFor(
        'TASK_BATCH_REOPEN',
        resolved.plan,
        resolved.ready,
        input.reason
      )
    };
  },
  async execute(input, ctx) {
    const resolved = await resolve(
      'TASK_BATCH_REOPEN',
      buildSelector({ ...input, status: 'closed' }),
      input.taskIds
    );
    if (!resolved.ok) return resolved;
    return submit(
      'TASK_BATCH_REOPEN',
      { reopen_reason: input.reason },
      resolved.ready.map((i) => i.task_id),
      ctx.commandId
    );
  }
};

// -- Operation status -----------------------------------------------------------------

const statusInput = z.strictObject({
  operationId: uuid
    .optional()
    .describe(
      'One operation, from a previous bulk action. Omit for the recent ones.'
    )
});

export const getOperationStatusTool: ReadTool<z.infer<typeof statusInput>> = {
  name: 'get_operation_status',
  summary: 'Check how a bulk operation is getting on',
  description:
    "Answer 'is it still processing?', 'what failed?' and 'what succeeded?' for bulk task operations. With no id it lists the staff member's recent operations; with one it returns that operation's per-task results.",
  domain: 'tasks',
  kind: 'read',
  status: 'available',
  inputSchema: statusInput,
  authorization: { permissions: OFFICE_TASKS, enforcedBy: ENFORCED },
  async execute({ operationId }) {
    if (!operationId) {
      const list = await getBatches({ limit: 10 });
      if (!list.ok) return refuse(list.error.code, list.error.message);
      return {
        ok: true,
        data: {
          operations: list.data.batches.map((b) => ({
            operation_id: b.batch_id,
            action: b.operation,
            status: b.status,
            started: b.started_at ?? b.created_at,
            progress: b.progress,
            asked_for_in: b.source
          }))
        }
      };
    }
    const detail = await getBatchProgress(operationId);
    if (!detail.ok) return refuse(detail.error.code, detail.error.message);
    const d = detail.data;
    return {
      ok: true,
      data: {
        operation_id: d.batch_id,
        action: d.operation,
        status: d.status,
        progress: d.progress,
        can_retry: d.items.some((i) => i.retryable),
        tasks: d.items.map((i) => ({
          code: i.template_code,
          job_ref: i.job_ref,
          owner: i.owner_name,
          result: i.status,
          ...(i.error_detail && { why: i.error_detail }),
          ...(i.completion_mode === 'override' && {
            completed_by_override: true
          })
        }))
      }
    };
  }
};

const retryInput = z.strictObject({
  operationId: uuid.describe(
    'The operation to retry, from get_operation_status'
  )
});

export const retryOperationTool: MutationTool<z.infer<typeof retryInput>> = {
  name: 'retry_operation',
  summary: 'Retry the items of an operation that need review',
  description:
    'Re-queue the tasks of a bulk operation that stopped needing review (for example because someone else changed the task while it was running). Tasks refused for a permanent reason - not allowed, historical record, a rule that cannot be bypassed - are never re-queued, and retrying will not change them.',
  domain: 'tasks',
  kind: 'mutation',
  status: 'available',
  inputSchema: retryInput,
  authorization: { permissions: OFFICE_TASKS, enforcedBy: ENFORCED },
  async prepare({ operationId }) {
    const detail = await getBatchProgress(operationId);
    if (!detail.ok) return refuse(detail.error.code, detail.error.message);
    const retryable = detail.data.items.filter((i) => i.retryable);
    if (retryable.length === 0) {
      const permanent = detail.data.items.filter((i) => i.status === 'Failed');
      return refuse(
        'NOTHING_RETRYABLE',
        permanent.length > 0
          ? `Nothing can be retried. ${permanent.length} were refused for a reason retrying will not change: ${permanent[0].error_detail ?? ''}`
          : 'Nothing in that operation needs retrying.'
      );
    }
    return {
      ok: true,
      preview: {
        title: `Retry ${retryable.length} tasks`,
        summary: `${retryable.length} tasks of this operation stopped needing review and will be tried again.`,
        changes: retryable.slice(0, 12).map((i) => ({
          label: `${i.template_code} · ${i.job_ref ?? 'no job'}`,
          to: i.error_detail ?? 'Retry'
        })),
        warnings: [],
        confirmLabel: `Retry ${retryable.length}`,
        expectedVersion: null
      }
    };
  },
  async execute({ operationId }) {
    const result = await retryBatch(operationId);
    if (!result.ok) {
      return refuse(
        result.outcome.code ?? 'BATCH_REFUSED',
        result.outcome.message
      );
    }
    return {
      ok: true,
      data: {
        operation_id: result.batchId,
        requeued: result.queued,
        progress: result.progress
      }
    };
  }
};

export const BULK_TASK_READ_TOOLS = [
  planTaskActionTool,
  getOperationStatusTool
];
export const BULK_TASK_MUTATION_TOOLS = [
  completeTasksTool,
  overrideCompleteTasksTool,
  reopenTasksTool,
  retryOperationTool
];
