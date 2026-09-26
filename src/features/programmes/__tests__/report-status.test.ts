import { describe, expect, it } from 'vitest';
import { reportLifecycle } from '../report-status';

/**
 * The one lie this feature must never tell is "Sent".
 */
describe('a built report is not a sent report', () => {
  it('says Built when nothing has been prepared', () => {
    const out = reportLifecycle({ status: 'Built' });
    expect(out.state).toBe('Built');
    expect(out.delivered).toBe(false);
  });

  it('says Ready to send for an Approved communication, never Sent', () => {
    const out = reportLifecycle({
      status: 'Built',
      communicationStatus: 'Approved'
    });
    expect(out.state).toBe('Ready to send');
    expect(out.state).not.toBe('Sent');
    expect(out.delivered).toBe(false);
    expect(out.detail).toMatch(/nothing has been sent/i);
  });

  it('says Queued once the outbox holds it', () => {
    expect(
      reportLifecycle({
        status: 'Built',
        communicationStatus: 'Queued',
        outboxStatus: 'Pending'
      }).state
    ).toBe('Queued');
  });

  it('says Sending while the worker has it', () => {
    expect(
      reportLifecycle({ status: 'Built', outboxStatus: 'Processing' }).state
    ).toBe('Sending');
  });

  it('claims Sent only when a canonical row records when it went', () => {
    expect(
      reportLifecycle({ status: 'Built', communicationStatus: 'Sent' }).state
    ).not.toBe('Sent');
    const sent = reportLifecycle({
      status: 'Built',
      communicationStatus: 'Sent',
      sentAt: '2026-09-26T09:00:00Z'
    });
    expect(sent.state).toBe('Sent');
    expect(sent.delivered).toBe(true);
    // Submission is not receipt, and it says so.
    expect(sent.detail).toMatch(/not receipt/i);
  });

  it('says Not sent when the run refused, with the reason', () => {
    const out = reportLifecycle({
      status: 'Refused',
      detail: 'no recipients configured'
    });
    expect(out.state).toBe('Not sent');
    expect(out.detail).toBe('no recipients configured');
  });
});

describe('failure is shown safely', () => {
  it('shows our own summary, never a provider payload', () => {
    const out = reportLifecycle({
      status: 'Built',
      communicationStatus: 'Failed',
      deliveryDetail: 'rejected: recipient not allow-listed'
    });
    expect(out.state).toBe('Failed');
    expect(out.detail).toBe('rejected: recipient not allow-listed');
    expect(out.delivered).toBe(false);
  });

  it('will not guess when the provider never answered', () => {
    const out = reportLifecycle({
      status: 'Built',
      communicationStatus: 'Uncertain'
    });
    expect(out.state).toBe('Unconfirmed');
    expect(out.detail).toMatch(/not known whether/i);
    expect(out.delivered).toBe(false);
  });

  it('counts retries without claiming delivery', () => {
    const out = reportLifecycle({
      status: 'Built',
      outboxStatus: 'RetryDue',
      outboxAttempts: 3
    });
    expect(out.state).toBe('Queued');
    expect(out.detail).toContain('3 attempts');
    expect(out.delivered).toBe(false);
  });
});
