'use client';

import { SimpleCommand } from '@/features/operations/simple-command';

/** OUTBOX_RESOLVE: a person decides what happened to an uncertain external call. */
export function ResolveOutbox({ outboxId }: { outboxId: string }) {
  return (
    <SimpleCommand
      label='Resolve'
      title='Resolve integration item'
      description='Check the other system first. Mark it done only if it really happened there (give its reference); retry to send again; cancel to drop it.'
      request={{ command_type: 'OUTBOX_RESOLVE' }}
      fields={[
        {
          key: 'decision',
          label: 'Decision',
          kind: 'select',
          required: true,
          initial: 'Retry',
          options: [
            { value: 'Retry', label: 'Try again' },
            { value: 'MarkSucceeded', label: 'It did happen' },
            { value: 'Cancel', label: 'Cancel it' }
          ]
        },
        {
          key: 'external_id',
          label: 'Reference in the other system (if it happened)'
        },
        { key: 'reason', label: 'Reason', kind: 'note', required: true }
      ]}
      payload={(v) => ({
        outbox_id: outboxId,
        decision: v.decision,
        reason: v.reason,
        ...(v.external_id ? { external_id: v.external_id } : {})
      })}
    />
  );
}

/** CALENDAR_REVIEW_RESOLVE for a calendar entry the sync could not settle. */
export function ResolveCalendar({ outboxId }: { outboxId: string }) {
  return (
    <SimpleCommand
      label='Resolve'
      title='Resolve calendar entry'
      request={{ command_type: 'CALENDAR_REVIEW_RESOLVE' }}
      fields={[
        {
          key: 'resolution',
          label: 'Resolution',
          kind: 'select',
          required: true,
          initial: 'Retry',
          options: [
            { value: 'Retry', label: 'Try again' },
            { value: 'AdoptEvent', label: 'Use the existing calendar event' },
            { value: 'Retarget', label: 'Move to the shared calendar' },
            { value: 'MarkCancelled', label: 'Cancel it' }
          ]
        },
        {
          key: 'external_event_id',
          label: 'Existing event id (when adopting)'
        },
        { key: 'reason', label: 'Reason', kind: 'note', required: true }
      ]}
      payload={(v) => ({
        outbox_id: outboxId,
        resolution: v.resolution,
        reason: v.reason,
        ...(v.external_event_id
          ? { external_event_id: v.external_event_id }
          : {})
      })}
    />
  );
}

const EVIDENCE_KINDS = [
  { value: 'DatabaseBackup', label: 'Database backup checked' },
  { value: 'DatabaseRestoreDrill', label: 'Database recovery tested' },
  { value: 'StorageBackup', label: 'File storage backup checked' },
  { value: 'StorageRestoreDrill', label: 'File storage recovery tested' }
];

/** A local date-time field value as an instant (the server insists on a time zone). */
const toInstant = (local: string) => new Date(local).toISOString();

/**
 * OPS_EVIDENCE_RECORD: a named person vouches that a backup was checked or a
 * recovery was rehearsed. The app cannot see the platform's backups itself, so
 * this record - not an assumption - is what System health reports.
 */
export function RecordOperationalEvidence({
  monitoringEnabled
}: {
  monitoringEnabled: boolean;
}) {
  return (
    <SimpleCommand
      label='Record a check'
      disabled={!monitoringEnabled}
      disabledReason='Health monitoring (FN-14) is not switched on yet, so checks cannot be recorded.'
      title='Record a backup or recovery check'
      description='Record only what you have checked yourself. Say where the proof is kept - never paste passwords, keys or connection strings.'
      request={{ command_type: 'OPS_EVIDENCE_RECORD' }}
      fields={[
        {
          key: 'kind',
          label: 'What was checked',
          kind: 'select',
          required: true,
          initial: 'DatabaseBackup',
          options: EVIDENCE_KINDS
        },
        {
          key: 'outcome',
          label: 'Result',
          kind: 'select',
          required: true,
          initial: 'Verified',
          options: [
            {
              value: 'Verified',
              label: 'Verified - it was there / it restored'
            },
            {
              value: 'Failed',
              label: 'Failed - missing, incomplete or did not restore'
            }
          ]
        },
        {
          key: 'performed_at',
          label: 'When you checked',
          kind: 'datetime-local',
          required: true
        },
        {
          key: 'subject_at',
          label: 'Time of the backup you checked or restored',
          kind: 'datetime-local',
          hint: 'As shown by the platform. Needed unless a backup check failed.'
        },
        {
          key: 'method',
          label: 'How it was checked',
          required: true,
          hint: 'For example: Supabase dashboard backups list; restored into a scratch project.'
        },
        {
          key: 'evidence_reference',
          label: 'Where the proof is kept',
          required: true,
          hint: 'A ticket, document or backup id.'
        },
        { key: 'notes', label: 'Notes', kind: 'note' }
      ]}
      payload={(v) => ({
        kind: v.kind,
        outcome: v.outcome,
        performed_at: toInstant(v.performed_at),
        ...(v.subject_at ? { subject_at: toInstant(v.subject_at) } : {}),
        method: v.method.trim(),
        evidence_reference: v.evidence_reference.trim(),
        ...(v.notes?.trim() ? { notes: v.notes.trim() } : {})
      })}
    />
  );
}
