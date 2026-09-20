import 'server-only';

import { getJobDetail } from '@/features/jobs/server/queries';
import {
  getHistoricalPeople,
  historicalPersonNote
} from '@/features/jobs/server/historical';
import { readOps, readR1 } from '@/lib/backend/read';
import type {
  AuditHistoryRead,
  JobAvailabilityRead,
  JobOperationsRead
} from '@/lib/backend/models';
import { z } from 'zod';
import type { ReadTool } from '../registry';

// Two reads over the ported backend's own read entry points. They add no
// business logic: execute_read / execute_operations_read resolve the actor
// from the session, apply the role and visibility rules, and honour the
// release controls that gate the read. A job this staff member may not see
// simply refuses, exactly as it does on the job screens.
const BACKEND =
  'public.execute_read / public.execute_operations_read (actor from the session, role + release checks in the database)';

const HISTORICAL_RECORD_TYPE =
  'historical_import (archived; imported from the previous system, no active work)';

type HistoricalJob = {
  id: string;
  job_ref: string;
  sold_at: string | null;
  source_reference: string | null;
  source_system: string | null;
  workflow_stage: string;
  archived_at: string | null;
};

/**
 * Whether this job is an archived historical import.
 *
 * Returns the job when it is, false when it is live, and 'NOT_FOUND' when the
 * signed-in person cannot see it. The lookup is the same RLS-bound read the
 * job screen uses, so it grants no extra visibility.
 */
async function historicalJob(
  jobId: string
): Promise<HistoricalJob | false | 'NOT_FOUND'> {
  const detail = await getJobDetail(jobId);
  if (!detail) return 'NOT_FOUND';
  const j = detail.job as unknown as HistoricalJob & { record_class: string };
  if (j.record_class !== 'HistoricalImport') return false;
  return j;
}

/**
 * What an imported job can honestly be said to have a history of.
 *
 * The old Job Booking form recorded a submission and some facts about the
 * work; it recorded no workflow events, so there are no task, issue or command
 * events to report and the answer says so rather than implying a quiet job.
 */
async function historicalTimeline(job: HistoricalJob) {
  const people = await getHistoricalPeople(job.id);
  const events = [
    job.sold_at && {
      when: job.sold_at,
      kind: 'historical_fact',
      what: 'Recorded as sold in the previous system',
      source: 'the imported Job Booking form'
    },
    job.archived_at && {
      when: job.archived_at,
      kind: 'import',
      what: 'Imported into this system as an archived historical record',
      source: 'the historical import'
    }
  ].filter(Boolean);

  return {
    ok: true as const,
    data: {
      job_id: job.id,
      job_ref: job.job_ref,
      record_type: HISTORICAL_RECORD_TYPE,
      previous_system_reference: job.source_reference ?? undefined,
      events,
      workflow_history_available: false,
      workflow_history_note:
        'The previous system recorded no workflow events, so this job has no task, issue or ' +
        'command history in this application. That is a limit of the imported source, not a ' +
        'quiet job.',
      people_recorded_on_the_job: people.map((p) => ({
        role: p.role,
        recorded_as: p.source_value,
        linked_person: p.person?.display_name ?? null,
        note: historicalPersonNote(p.match_kind)
      })),
      people_note:
        'These are the names the old form recorded. They are historical facts, not current ' +
        'allocations - nobody is scheduled on an archived job. A name is linked only where it ' +
        'matched exactly one member of staff; an ambiguous name is left unlinked, not guessed.'
    }
  };
}

const jobIdInput = z.strictObject({
  jobId: z.uuid().describe('The job id (UUID) returned by find_job')
});

/** Turns a read refusal into something the model can repeat honestly. */
function refusal(code: string, message: string) {
  return { ok: false as const, code, message };
}

export const getJobTimelineTool: ReadTool<{ jobId: string }> = {
  name: 'get_job_timeline',
  summary: 'Summarise what has happened on a job, most recent first',
  description:
    "Read the recorded history of one job: command and record changes, task events and issue events, each with when it happened, who did it and the reason or note they gave. Use it to answer 'what happened to this job', 'who changed this' or 'when was this done'. It reports only what was recorded - it is not an explanation of why the business did something. Returns the 40 most recent events.",
  domain: 'jobs',
  kind: 'read',
  status: 'available',
  inputSchema: jobIdInput,
  authorization: { permissions: [], enforcedBy: BACKEND },
  async execute({ jobId }) {
    const historical = await historicalJob(jobId);
    if (historical === 'NOT_FOUND') {
      return refusal(
        'NOT_FOUND',
        'No job with that id is visible to the signed-in staff member.'
      );
    }
    if (historical) return historicalTimeline(historical);

    const read = await readR1<AuditHistoryRead>('AUDIT_HISTORY', {
      job_id: jobId
    });
    if (!read.ok) {
      return refusal(read.error.code, read.error.message);
    }
    const history = read.data;
    if (!history) {
      return refusal(
        'NOT_FOUND',
        'No job with that id is visible to the signed-in staff member.'
      );
    }
    const events = history.events.slice(0, 40);
    return {
      ok: true,
      data: {
        job_id: jobId,
        total_events: history.total_events,
        showing: events.length,
        events: events.map((e) => ({
          when: e.timestamp,
          kind: e.type,
          action: e.action,
          actor: e.actor,
          reason: e.reason ?? null,
          note: e.note ?? null,
          status_change:
            e.old_status || e.new_status
              ? { from: e.old_status ?? null, to: e.new_status ?? null }
              : null
        })),
        note:
          history.total_events > events.length
            ? `Only the ${events.length} most recent of ${history.total_events} events are shown.`
            : undefined
      }
    };
  }
};

export const getJobBlockersTool: ReadTool<{ jobId: string }> = {
  name: 'get_job_blockers',
  summary: 'Explain what is holding a job up and what can be done next',
  description:
    "Read what is currently stopping a job progressing: open issues (and whether they block), the state of each piece of work, whether the job is ready to be marked operationally complete and the reasons if not, and which actions are available on the job right now with the reason each unavailable one is refused. Use it for 'why can't this job be completed', 'what is blocking this job', 'what can I do on this job'. Prefer it over get_job_tasks when the staff member asks why something cannot happen.",
  domain: 'jobs',
  kind: 'read',
  status: 'available',
  inputSchema: jobIdInput,
  authorization: { permissions: [], enforcedBy: BACKEND },
  async execute({ jobId }) {
    const historical = await historicalJob(jobId);
    if (historical === 'NOT_FOUND') {
      return refusal(
        'NOT_FOUND',
        'No job with that id is visible to the signed-in staff member.'
      );
    }
    // An archived import has no workflow, so the operational blocker reads are
    // not merely empty for it - they do not apply. Running them would also be
    // refused: they authorise through app.read_authorize_job, which rejects
    // anything outside operational scope with R1A_OUTSIDE_PILOT.
    if (historical) {
      return {
        ok: true,
        data: {
          job_id: historical.id,
          job_ref: historical.job_ref,
          record_type: HISTORICAL_RECORD_TYPE,
          applicable: false,
          not_applicable_reason:
            'This is an archived record of a job completed before this system. It has no active ' +
            'workflow, so open tasks, blocking issues and next actions do not apply to it. This is ' +
            'not the same as a live job having nothing outstanding.',
          open_issues: [],
          blocking_issue_count: null,
          work: [],
          completion: null,
          actions_unavailable: [],
          guidance:
            'Do not describe this job as clear, unblocked or ready. Say that it is a historical ' +
            'record and that blockers do not apply.'
        }
      };
    }

    const [ops, availability] = await Promise.all([
      readOps<JobOperationsRead>('JOB_OPERATIONS', { job_id: jobId }),
      readR1<JobAvailabilityRead>('ACTION_AVAILABILITY', { job_id: jobId })
    ]);
    if (!ops.ok) {
      return refusal(ops.error.code, ops.error.message);
    }
    const data = ops.data;
    if (!data) {
      return refusal(
        'NOT_FOUND',
        'No job with that id is visible to the signed-in staff member.'
      );
    }
    const openIssues = data.issues.filter((i) => i.status !== 'Closed');
    // ACTION_AVAILABILITY is a separate read; if it refuses, the rest still answers.
    const commands = availability.ok ? (availability.data?.commands ?? {}) : {};
    const unavailable = Object.entries(commands)
      .filter(([, flag]) => !flag.available)
      .map(([command, flag]) => ({ command, reason: flag.reason ?? null }));

    return {
      ok: true,
      data: {
        job_id: data.job.id,
        job_ref: data.job.job_ref,
        workflow_stage: data.job.workflow_stage,
        cancelled_at: data.job.cancellation_at,
        operationally_complete_at: data.job.operational_complete_at,
        open_issues: openIssues.map((i) => ({
          type: i.type,
          category: i.category,
          description: i.description,
          severity: i.severity,
          status: i.status,
          blocks_completion: i.blocks_completion,
          owner: i.owner_name ?? null
        })),
        blocking_issue_count: openIssues.filter((i) => i.blocks_completion)
          .length,
        work: data.packages.map((p) => ({
          trade: p.trade,
          status: p.status,
          required: p.required,
          planned_start: p.planned_start,
          installer_confirmed_at: p.installer_confirmation_at
        })),
        completion: {
          status: data.completion.gate.status,
          ready: data.completion.gate.ready,
          reasons: data.completion.gate.reasons
        },
        actions_unavailable: unavailable,
        availability_note: availability.ok
          ? undefined
          : 'The action availability read refused; the rest of this answer is still accurate.'
      }
    };
  }
};
