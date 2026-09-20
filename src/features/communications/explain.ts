import type { CommunicationRow, CommunicationStatus } from './types';

// Plain words for what a message's state actually means. The rule this file
// exists to hold: NOTHING here may imply the system delivered anything.
//
// 'Sent' means one of two quite different things, and the screen must not blur
// them: either a person sent it from their own mailbox (external_message_id
// starts with 'manual:'), or a worker reported a successful submission. Even
// the second is submission, never receipt — receipt lives in acknowledgements,
// recorded by a person.

export interface StatusNote {
  label: string;
  /** One sentence, in the office's words, about what has actually happened. */
  detail: string;
  tone: 'neutral' | 'progress' | 'done' | 'attention';
}

/** True when a person sent this themselves, rather than any transport. */
export function isManualSend(comm: {
  externalMessageId: string | null;
}): boolean {
  return (comm.externalMessageId ?? '').startsWith('manual:');
}

/** The person's own reference, without the 'manual:' prefix the database adds. */
export function manualReference(comm: {
  externalMessageId: string | null;
}): string | null {
  const id = comm.externalMessageId ?? '';
  return id.startsWith('manual:') ? id.slice('manual:'.length) || null : null;
}

export function describeStatus(comm: {
  status: CommunicationStatus;
  externalMessageId: string | null;
}): StatusNote {
  switch (comm.status) {
    case 'Draft':
      return {
        label: 'Draft',
        detail:
          'Captured by the system. Nobody has approved it and nothing has been sent.',
        tone: 'neutral'
      };
    case 'Approved':
      return {
        label: 'Approved',
        detail: 'Someone has signed off the wording. Still not sent.',
        tone: 'progress'
      };
    case 'Queued':
      return {
        label: 'Queued',
        detail:
          'Waiting for the email worker. Nothing has left the system yet.',
        tone: 'progress'
      };
    case 'Sent':
      return isManualSend(comm)
        ? {
            label: 'Sent by a person',
            detail:
              'A member of staff sent this from their own mailbox and recorded it here. The system did not send it and cannot confirm it arrived.',
            tone: 'done'
          }
        : {
            label: 'Submitted',
            detail:
              'The mail service accepted it. That proves submission, not that anyone received or read it.',
            tone: 'done'
          };
    case 'Uncertain':
      return {
        label: 'Needs checking',
        detail:
          'The send could not be confirmed either way. Check the mailbox before sending again, then resolve it on the System page.',
        tone: 'attention'
      };
    case 'Failed':
      return {
        label: 'Failed',
        detail: 'It was not sent. Nothing reached the recipient.',
        tone: 'attention'
      };
  }
}

/**
 * Why "Queue to send" is not on offer, in words the office can act on. Returns
 * null when queueing is genuinely available.
 *
 * These mirror app.cmd_communication_queue. The gates it cannot see from here
 * (email.mode, from_mailbox, the allow-list) are checked later, at claim time,
 * so a message can queue and still never leave.
 */
export function whyNotDispatchable(comm: CommunicationRow): string | null {
  if (!comm.dispatchable)
    return 'This kind of message is sent by a person, not by the system. Send it from your own mailbox, then record it here.';
  if (comm.status === 'Draft') return 'Approve it first.';
  if (comm.status === 'Queued')
    return 'Already queued. The email worker has not taken it yet.';
  if (comm.status === 'Sent' || comm.status === 'Failed')
    return 'Nothing left to queue.';
  if (comm.status === 'Uncertain')
    return 'Resolve the integration item on the System page first.';
  return null;
}
