import 'server-only';

import { runCommand } from '@/lib/backend/command';
import { readR1 } from '@/lib/backend/read';
import type { JobAvailabilityRead } from '@/lib/backend/models';
import { getJobDetail } from '@/features/jobs/server/queries';
import { searchVisibleJobs } from '@/features/jobs/server/search';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ToolResult
} from '../registry';

/**
 * Two job operations the assistant can carry out: moving the planned work, and
 * raising an issue against a job.
 *
 * Both were already commands - MOVE_JOB and ISSUE_CREATE have existed since
 * R1 - so nothing here decides anything. Each tool resolves the job, reads
 * ACTION_AVAILABILITY to find out whether the command may run at all and to
 * take the job's current version, describes the change, and on confirmation
 * hands the request to public.execute_command through runCommand. Stage rules,
 * assignment, release gates, the date checks and the audit trail stay in the
 * database.
 *
 * These two were chosen because everything they need is something a person can
 * say: activities, dates, a reason, a title. The rest of the job surface -
 * changing an installer, requesting scaffolding, adding materials - needs
 * identifiers (a person, a scaffolding company, a product, a merchant) that
 * the model has no honest way to supply yet. Those are deliberately absent
 * rather than half-built: list_job_operations still reports them, with the
 * database's own reason, so staff are told what is possible rather than left
 * with a tool that fails on an invented id.
 */

/** app.is_office - the roles the backend lets run these commands. */
const OFFICE = [
  'Admin',
  'Manager',
  'Director',
  'Office',
  'VariationApprover'
] as const;

const ENFORCED =
  'public.execute_command (app.authorize_command: role, assignment, release mode; stage and date rules in the handler; expected_version on the job) - session-bound, audited by jobs_audit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jobInput = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .describe(
    'The job: its reference (e.g. SS-ABCD-0001), its id from find_job, a postcode, or a customer name that identifies exactly one job'
  );

/** An ISO date (YYYY-MM-DD). The backend stores planned work by date, not time. */
const dateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form');

type Located = {
  jobId: string;
  jobRef: string;
  version: number;
  stage: string;
  flag: { available: boolean; reason?: string } | undefined;
};

type Lookup =
  | { ok: true; job: Located }
  | { ok: false; code: string; message: string };

/**
 * Resolves the job and asks the database whether this command may run on it.
 *
 * The availability read is the same one the job screens use, so a refusal here
 * is the refusal staff would see, with the reason the backend gives - never a
 * guess, and never a cheerful proposal for something that cannot happen.
 */
async function locate(job: string, command: string): Promise<Lookup> {
  let jobId = job;
  if (!UUID.test(job)) {
    const { hits } = await searchVisibleJobs(job);
    const exact = hits.filter(
      (h) => h.jobRef.toUpperCase() === job.toUpperCase()
    );
    const match =
      exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
    if (!match) {
      return {
        ok: false,
        code: hits.length > 1 ? 'AMBIGUOUS_JOB' : 'NOT_FOUND',
        message:
          hits.length > 1
            ? `"${job}" matches ${hits.length} jobs (${hits
                .slice(0, 5)
                .map((h) => `${h.jobRef} ${h.customerName}`)
                .join('; ')}). Ask which one they mean, or use find_job.`
            : 'No job the signed-in staff member can see matched. It may not exist, or they may not have access to it.'
      };
    }
    jobId = match.id;
  }

  // An imported historical record is an archive, not work. Refuse it here and
  // by name: the command would refuse it too, but as "not actionable", which
  // reads like a stage problem somebody could work around.
  const detail = await getJobDetail(jobId);
  if (detail?.job?.record_class === 'HistoricalImport') {
    return {
      ok: false,
      code: 'HISTORICAL_IMPORT',
      message: `${detail.job.job_ref} is an imported historical record, not live work. Imported records are an archive of what the previous system held and cannot be changed. Say so rather than trying another way.`
    };
  }

  const availability = await readR1<JobAvailabilityRead>(
    'ACTION_AVAILABILITY',
    { job_id: jobId }
  );
  if (!availability.ok) {
    return {
      ok: false,
      code: availability.error.code,
      message: availability.error.message
    };
  }
  const data = availability.data;
  if (!data) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'No job with that id is visible to the signed-in staff member.'
    };
  }
  const flag = data.commands?.[command];
  if (flag && !flag.available) {
    return {
      ok: false,
      code: 'NOT_AVAILABLE',
      message: `${data.job_ref} cannot have this done right now: ${
        flag.reason ?? 'the system refused it without giving a reason'
      }. Tell them that, and do not suggest another way round it.`
    };
  }
  return {
    ok: true,
    job: {
      jobId,
      jobRef: data.job_ref,
      version: data.version,
      stage: data.workflow_stage,
      flag
    }
  };
}

// -- Move the planned work ----------------------------------------------------

const ACTIVITIES = ['Roof', 'Electrical', 'Return', 'Scaffold'] as const;

interface MoveInput {
  job: string;
  activities: (typeof ACTIVITIES)[number][];
  reason: string;
  planned_start?: string;
  planned_end?: string;
  scaffold_erect?: string;
  scaffold_strip?: string;
}

function movePayload(input: MoveInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    activities: input.activities,
    reason: input.reason.trim()
  };
  for (const key of [
    'planned_start',
    'planned_end',
    'scaffold_erect',
    'scaffold_strip'
  ] as const) {
    if (input[key]) payload[key] = input[key];
  }
  return payload;
}

export const moveJobTool: MutationTool<MoveInput> = {
  name: 'move_job',
  summary: 'Move a job’s planned work to different dates',
  description:
    "Move the planned dates for work on a job - 'push the roof work to the 14th', 'move the install out a week', 'bring the scaffold forward'. Say which activities move (Roof, Electrical, Return, Scaffold) and the new dates. A reason is required and is recorded: use the staff member's own words for why it is moving, and ask them if they have not said. Dates are days (YYYY-MM-DD). Scaffold dates move with scaffold_erect / scaffold_strip. Read the job first so you can say what the dates are now.",
  domain: 'calendar',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    activities: z
      .array(z.enum(ACTIVITIES))
      .min(1)
      .describe('Which work moves. At least one.'),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .describe('Why it is moving, in the staff member’s own words. Recorded.'),
    planned_start: dateInput.optional(),
    planned_end: dateInput.optional(),
    scaffold_erect: dateInput.optional(),
    scaffold_strip: dateInput.optional()
  }),
  authorization: { permissions: [], roles: OFFICE, enforcedBy: ENFORCED },

  async prepare(input) {
    const located = await locate(input.job, 'MOVE_JOB');
    if (!located.ok)
      return { ok: false, code: located.code, message: located.message };
    const { job } = located;

    const changes = [
      { label: 'Work moving', to: input.activities.join(', ') },
      ...(input.planned_start
        ? [{ label: 'Planned start', to: input.planned_start }]
        : []),
      ...(input.planned_end
        ? [{ label: 'Planned end', to: input.planned_end }]
        : []),
      ...(input.scaffold_erect
        ? [{ label: 'Scaffold erect', to: input.scaffold_erect }]
        : []),
      ...(input.scaffold_strip
        ? [{ label: 'Scaffold strip', to: input.scaffold_strip }]
        : []),
      { label: 'Reason', to: input.reason.trim() }
    ];

    const preview: ActionPreview = {
      title: 'Move planned work',
      summary: `Move ${input.activities.join(' and ')} on ${job.jobRef}.`,
      changes,
      warnings: [
        'Moving planned work affects the planner and anyone already scheduled on it.'
      ],
      confirmLabel: 'Move the work',
      expectedVersion: job.version
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const located = await locate(input.job, 'MOVE_JOB');
    if (!located.ok)
      return { ok: false, code: located.code, message: located.message };
    const { job } = located;
    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'MOVE_JOB',
      job_id: job.jobId,
      expected_version: ctx.expectedVersion ?? job.version,
      payload: movePayload(input)
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }
    return {
      ok: true,
      data: {
        job_ref: job.jobRef,
        moved: input.activities,
        note: 'Moved. The planner and anyone scheduled on it will see the new dates.'
      }
    };
  }
};

// -- Raise an issue -----------------------------------------------------------

const ISSUE_TYPES = ['Variation', 'Remedial', 'Complaint'] as const;
const SEVERITIES = ['Normal', 'Medium'] as const;

interface IssueInput {
  job: string;
  issue_type: (typeof ISSUE_TYPES)[number];
  title: string;
  description: string;
  severity?: (typeof SEVERITIES)[number];
  customer_impact?: string;
}

export const raiseIssueTool: MutationTool<IssueInput> = {
  name: 'raise_issue',
  summary: 'Raise a variation, remedial or complaint against a job',
  description:
    "Record an issue on a job: a Variation (work beyond what was sold), a Remedial (something needs putting right) or a Complaint (the customer is unhappy). Use the staff member's own account of what happened for the description - do not summarise away detail or soften it. Ask which of the three it is rather than choosing for them when it is genuinely unclear. Raising an issue can block the job's operational completion, so say that when you propose it.",
  domain: 'jobs',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    job: jobInput,
    issue_type: z
      .enum(ISSUE_TYPES)
      .describe(
        'Variation: extra work. Remedial: something to put right. Complaint: the customer is unhappy.'
      ),
    title: z.string().trim().min(3).max(120).describe('A short heading'),
    description: z
      .string()
      .trim()
      .min(3)
      .max(4000)
      .describe('What happened, in the staff member’s own words'),
    severity: z.enum(SEVERITIES).optional().describe('Defaults to Normal'),
    customer_impact: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe('How it affects the customer, if they said')
  }),
  authorization: { permissions: [], roles: OFFICE, enforcedBy: ENFORCED },

  async prepare(input) {
    const located = await locate(input.job, 'ISSUE_CREATE');
    if (!located.ok)
      return { ok: false, code: located.code, message: located.message };
    const { job } = located;

    const preview: ActionPreview = {
      title: `Raise a ${input.issue_type.toLowerCase()}`,
      summary: `Record a ${input.issue_type.toLowerCase()} against ${job.jobRef}.`,
      changes: [
        { label: 'Type', to: input.issue_type },
        { label: 'Title', to: input.title.trim() },
        { label: 'Severity', to: input.severity ?? 'Normal' },
        { label: 'What happened', to: input.description.trim() },
        ...(input.customer_impact
          ? [{ label: 'Effect on the customer', to: input.customer_impact }]
          : [])
      ],
      warnings: [
        'An open issue can stop this job being marked operationally complete until it is resolved.'
      ],
      confirmLabel: `Raise the ${input.issue_type.toLowerCase()}`,
      expectedVersion: job.version
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const located = await locate(input.job, 'ISSUE_CREATE');
    if (!located.ok)
      return { ok: false, code: located.code, message: located.message };
    const { job } = located;
    const payload: Record<string, unknown> = {
      issue_type: input.issue_type,
      title: input.title.trim(),
      description: input.description.trim()
    };
    if (input.severity) payload.severity = input.severity;
    if (input.customer_impact)
      payload.customer_impact = input.customer_impact.trim();

    const response = await runCommand({
      command_id: ctx.commandId,
      command_type: 'ISSUE_CREATE',
      job_id: job.jobId,
      expected_version: ctx.expectedVersion ?? job.version,
      payload
    });
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }
    return {
      ok: true,
      data: {
        job_ref: job.jobRef,
        issue_type: input.issue_type,
        title: input.title.trim(),
        note: 'Raised. It is now on the job and may block operational completion until resolved.'
      }
    };
  }
};

export const JOB_OPERATION_TOOLS: MutationTool<never>[] = [
  moveJobTool as unknown as MutationTool<never>,
  raiseIssueTool as unknown as MutationTool<never>
];

export type { ToolResult };
