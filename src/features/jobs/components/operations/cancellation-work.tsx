'use client';

import { SimpleCommand } from '@/features/operations/simple-command';
import type {
  OpsCancellation,
  OpsCancellationTask,
  OpsFlag
} from '@/lib/backend/models';
import { IconCheck, IconClipboardCheck, IconLock } from '@tabler/icons-react';
import { flagText } from './labels';

// The person's side of an S15 cancellation (20260919147000): resolve each
// cancellation task with evidence, close the cancellation (the job becomes
// Cancelled), and after a reinstatement complete the reopen review so normal
// work can resume. The server re-checks role, assignment, release modes,
// versions and every confirmation rule.

const gate = (flag: OpsFlag) => ({
  disabled: !flag.available,
  disabledReason: flagText(flag)
});

/** CANCELLATION_RESOLVE: one cancellation task, with evidence. */
export function ResolveCancellationTask({
  jobId,
  jobVersion,
  task,
  flag
}: {
  jobId: string;
  jobVersion: number;
  task: OpsCancellationTask;
  flag: OpsFlag;
}) {
  return (
    <SimpleCommand
      label='Resolve'
      icon={<IconCheck />}
      title={task.title}
      description={
        task.confirmation
          ? `Record that the other party confirmed the cancellation (revision ${task.confirm_revision ?? '-'}). Sent is not confirmed.`
          : 'Record how this was dealt with and where the proof is kept.'
      }
      request={{
        command_type: 'CANCELLATION_RESOLVE',
        job_id: jobId,
        task_id: task.id,
        expected_version: jobVersion
      }}
      {...gate(flag)}
      fields={[
        ...(task.confirmation
          ? [
              {
                key: 'outcome',
                label: 'Outcome',
                kind: 'select' as const,
                required: true,
                options: [{ value: 'Confirmed', label: 'Confirmed by them' }]
              }
            ]
          : []),
        ...(task.needs_actual_date
          ? [
              {
                key: 'actual_date',
                label: 'Date struck',
                kind: 'date' as const,
                required: true
              }
            ]
          : []),
        {
          key: 'evidence_reference',
          label: 'Evidence reference',
          required: true,
          hint: 'Email, call note or document that proves it'
        },
        { key: 'reason', label: 'What was done', kind: 'note', required: true }
      ]}
      payload={(v) => ({
        reason: v.reason.trim(),
        task_version: task.version,
        evidence_reference: v.evidence_reference.trim(),
        ...(task.confirmation
          ? { outcome: v.outcome, confirmed_revision: task.confirm_revision }
          : {}),
        ...(task.needs_actual_date ? { actual_date: v.actual_date } : {})
      })}
    />
  );
}

/**
 * CANCELLATION_CLOSE: the job becomes Cancelled. Every task still open must be
 * tracked with a reference and a reason; confirmations must be resolved first.
 */
export function CloseCancellation({
  jobId,
  jobVersion,
  tasks,
  flag
}: {
  jobId: string;
  jobVersion: number;
  tasks: OpsCancellationTask[];
  flag: OpsFlag;
}) {
  const tracked = tasks.filter((t) => !t.confirmation);
  return (
    <SimpleCommand
      label='Close cancellation'
      icon={<IconLock />}
      variant='default'
      title='Close the cancellation'
      description={
        tracked.length
          ? 'The job becomes Cancelled. Each task still open stays with its owner: say where it is tracked and why it is still open.'
          : 'The job becomes Cancelled. It can be reinstated later.'
      }
      request={{
        command_type: 'CANCELLATION_CLOSE',
        job_id: jobId,
        expected_version: jobVersion
      }}
      {...gate(flag)}
      fields={[
        { key: 'reason', label: 'Reason', kind: 'note', required: true },
        ...tracked.flatMap((t) => [
          {
            key: `reference:${t.id}`,
            label: `${t.title} - tracked where`,
            required: true
          },
          {
            key: `reason:${t.id}`,
            label: `${t.title} - why still open`,
            required: true
          }
        ])
      ]}
      payload={(v) => ({
        reason: v.reason.trim(),
        tracked_obligations: tracked.map((t) => ({
          task_id: t.id,
          reference: v[`reference:${t.id}`].trim(),
          reason: v[`reason:${t.id}`].trim()
        }))
      })}
    />
  );
}

/** REOPEN_REVIEW_COMPLETE: normal work on a reinstated job resumes. */
export function CompleteReopenReview({
  jobId,
  review,
  flag
}: {
  jobId: string;
  review: NonNullable<OpsCancellation['reopen_review']>;
  flag: OpsFlag;
}) {
  return (
    <SimpleCommand
      label='Complete reopen review'
      icon={<IconClipboardCheck />}
      variant='default'
      title='Complete the reopen review'
      description='Confirm the fresh dates, booking gates, retained obligations and any invoice or order reuse were reviewed. Normal work on the job resumes; run the booking checks again before booking.'
      request={{
        command_type: 'REOPEN_REVIEW_COMPLETE',
        job_id: jobId,
        task_id: review.id,
        expected_version: review.version
      }}
      {...gate(flag)}
      fields={[
        {
          key: 'note',
          label: 'What was reviewed',
          kind: 'note',
          required: true
        }
      ]}
    />
  );
}
