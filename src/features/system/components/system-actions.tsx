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
