/**
 * What actually happened to a report, said truthfully.
 *
 * A report run existing means a report was BUILT. It does not mean anybody
 * received it, and the screen must never imply otherwise: with the outbound
 * gates as they stand, a scheduled report reaches "Approved" and stops there,
 * which is the system working. Telling somebody their client report was "Sent"
 * when it is sitting unqueued would be the single most damaging lie this
 * feature could tell.
 *
 * So the state is derived from the canonical rows in order of certainty:
 * the outbox knows whether a message left, the communication knows whether it
 * was approved, and the run only knows that it was built.
 */

export type ReportState =
  | 'Not sent'
  | 'Built'
  | 'Ready to send'
  | 'Queued'
  | 'Sending'
  | 'Sent'
  | 'Unconfirmed'
  | 'Failed';

export interface ReportLifecycle {
  state: ReportState;
  /** One sentence a person can act on. Never a provider payload. */
  detail: string;
  /** True only when a canonical row proves delivery was attempted and accepted. */
  delivered: boolean;
}

export function reportLifecycle(run: {
  status: string;
  detail?: string | null;
  communicationStatus?: string | null;
  outboxStatus?: string | null;
  outboxAttempts?: number | null;
  deliveryDetail?: string | null;
  sentAt?: string | null;
}): ReportLifecycle {
  const attempts = run.outboxAttempts ?? 0;

  // The run refused before anything was written. Nothing is pending.
  if (run.status === 'Refused')
    return {
      state: 'Not sent',
      detail: run.detail ?? 'The report was built but not queued.',
      delivered: false
    };

  // Sent is the only state that claims delivery, and only a communication that
  // records when it went can justify it.
  if (run.communicationStatus === 'Sent' && run.sentAt)
    return {
      state: 'Sent',
      detail: 'Accepted by the mail provider. That is submission, not receipt.',
      delivered: true
    };

  if (
    run.communicationStatus === 'Failed' ||
    run.outboxStatus === 'NeedsReview'
  )
    return {
      state: 'Failed',
      // The outbox summary is our own wording, never the provider's payload.
      detail:
        run.deliveryDetail ?? 'Sending failed and needs a person to look.',
      delivered: false
    };

  if (run.communicationStatus === 'Uncertain')
    return {
      state: 'Unconfirmed',
      detail:
        'The provider never answered, so it is not known whether this was sent. A person must check before resending.',
      delivered: false
    };

  if (run.outboxStatus === 'Processing')
    return { state: 'Sending', detail: 'Being sent now.', delivered: false };

  if (run.outboxStatus === 'RetryDue')
    return {
      state: 'Queued',
      detail: `Waiting to be retried (${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} so far).`,
      delivered: false
    };

  if (run.outboxStatus === 'Pending' || run.communicationStatus === 'Queued')
    return {
      state: 'Queued',
      detail:
        'Queued for the email worker. It will only leave once sending is switched on for this server.',
      delivered: false
    };

  if (run.communicationStatus === 'Approved')
    return {
      state: 'Ready to send',
      detail:
        'The email is prepared and approved, but has not been queued. Nothing has been sent.',
      delivered: false
    };

  return {
    state: 'Built',
    detail: 'The report was built. No email has been prepared yet.',
    delivered: false
  };
}
