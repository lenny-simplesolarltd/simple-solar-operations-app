'use client';

import { SimpleCommand } from '@/features/operations/simple-command';
import type { CommunicationRow } from '../types';

// The three commands, each a small form. None of them sends an email:
// approving is a signature, queueing hands the message to a worker that does
// not exist yet, and recording is a person telling the system what they
// already did from their own mailbox.
//
// Every refusal below is also enforced in the database. These guards only stop
// us offering a button that would bounce, and say why in plain words.

/** A local date-time field value as an instant (the server insists on a time zone). */
const toInstant = (local: string) => new Date(local).toISOString();

/** COMMUNICATION_APPROVE: a named person takes responsibility for the content. */
export function ApproveCommunication({ comm }: { comm: CommunicationRow }) {
  return (
    <SimpleCommand
      label='Approve'
      title='Approve this message'
      description='You are signing off the wording and the recipients. Approving sends nothing — it only makes the message ready.'
      variant='default'
      request={{
        command_type: 'COMMUNICATION_APPROVE',
        expected_version: comm.version
      }}
      fields={[{ key: 'reason', label: 'Note (optional)', kind: 'note' }]}
      payload={(v) => ({
        communication_id: comm.id,
        ...(v.reason?.trim() ? { reason: v.reason.trim() } : {})
      })}
    />
  );
}

/**
 * COMMUNICATION_QUEUE: Approved -> Queued, plus one outbox row.
 *
 * The database refuses this unless the type's own function (FN-03 / FN-04) is
 * Automated, and every function ships Disabled. We still show the button for a
 * dispatchable type so the refusal is visible and explicable rather than the
 * action simply being absent.
 */
export function QueueCommunication({ comm }: { comm: CommunicationRow }) {
  return (
    <SimpleCommand
      label='Queue to send'
      title='Queue this message for the email worker'
      description={`This hands the message to the email worker. It does not send it: the worker sends, and only when the release mode for ${comm.functionId ?? 'this function'} is Automated, the mailbox is configured and every recipient is allow-listed.`}
      submitLabel='Queue it'
      request={{
        command_type: 'COMMUNICATION_QUEUE',
        expected_version: comm.version
      }}
      payload={() => ({ communication_id: comm.id })}
    />
  );
}

/**
 * COMMUNICATION_RECORD_SENT: the FN-20 / FN-18 route. A person sent it from
 * their own mailbox; the system records the fact and claims no delivery.
 */
export function RecordCommunicationSent({ comm }: { comm: CommunicationRow }) {
  return (
    <SimpleCommand
      label='I sent this myself'
      title='Record that you sent this'
      description='Use this when you sent the message from your own mailbox. The system records that you did — it does not send anything and cannot confirm it arrived.'
      submitLabel='Record it'
      request={{
        command_type: 'COMMUNICATION_RECORD_SENT',
        expected_version: comm.version
      }}
      fields={[
        {
          key: 'note',
          label: 'What did you send, and to whom?',
          kind: 'note',
          required: true,
          hint: 'In your own words. This is the record.'
        },
        {
          key: 'external_reference',
          label: 'Your reference (optional)',
          hint: 'An email id or subject line, so it can be found again.'
        },
        {
          key: 'sent_at',
          label: 'When did you send it?',
          kind: 'datetime-local',
          hint: 'Leave blank for now.'
        }
      ]}
      payload={(v) => ({
        communication_id: comm.id,
        note: v.note.trim(),
        ...(v.external_reference?.trim()
          ? { external_reference: v.external_reference.trim() }
          : {}),
        ...(v.sent_at ? { sent_at: toInstant(v.sent_at) } : {})
      })}
    />
  );
}

/**
 * Whatever this message can legitimately have done to it now.
 *
 * Mirrors the handlers: approve needs Draft; queue needs Approved AND a
 * dispatchable type; record-sent needs Draft or Approved and no outbox row
 * (once it is queued, the outbox is the thing to resolve, on the system page).
 */
export function CommunicationActions({
  comm,
  can
}: {
  comm: CommunicationRow;
  can: { approve: boolean; send: boolean; recordSend: boolean };
}) {
  const canApprove = can.approve && comm.status === 'Draft';
  const canQueue = can.send && comm.status === 'Approved' && comm.dispatchable;
  const canRecord =
    can.recordSend &&
    (comm.status === 'Draft' || comm.status === 'Approved') &&
    comm.outboxId === null;

  if (!canApprove && !canQueue && !canRecord) return null;

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {canApprove && <ApproveCommunication comm={comm} />}
      {canQueue && <QueueCommunication comm={comm} />}
      {canRecord && <RecordCommunicationSent comm={comm} />}
    </div>
  );
}
