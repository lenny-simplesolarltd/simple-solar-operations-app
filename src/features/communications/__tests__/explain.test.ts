import { describe, expect, it } from 'vitest';
import {
  describeStatus,
  isManualSend,
  manualReference,
  whyNotDispatchable
} from '../explain';
import type { CommunicationRow } from '../types';

const row = (over: Partial<CommunicationRow> = {}): CommunicationRow => ({
  id: 'c1',
  jobId: null,
  companyId: null,
  type: 'MerchantOrder',
  subject: 'Order SS-0001',
  status: 'Draft',
  revision: 1,
  version: 1,
  approvedAt: null,
  approvedBy: null,
  sentAt: null,
  externalMessageId: null,
  outboxId: null,
  outboxStatus: null,
  outboxSummary: null,
  dispatchable: true,
  actionType: 'EmailOrder',
  functionId: 'FN-03',
  createdAt: null,
  ...over
});

describe('a person sending it themselves', () => {
  it('is recognised by the manual: prefix the database adds', () => {
    expect(isManualSend({ externalMessageId: 'manual:RE: order 12' })).toBe(
      true
    );
    expect(isManualSend({ externalMessageId: 'smtp-abc-123' })).toBe(false);
    expect(isManualSend({ externalMessageId: null })).toBe(false);
  });

  it('shows the reference without the prefix', () => {
    expect(manualReference({ externalMessageId: 'manual:RE: order 12' })).toBe(
      'RE: order 12'
    );
    expect(manualReference({ externalMessageId: 'manual:' })).toBeNull();
    expect(manualReference({ externalMessageId: 'smtp-abc' })).toBeNull();
  });
});

describe('what the status is allowed to claim', () => {
  it('never says the system sent a message a person sent', () => {
    const note = describeStatus(
      row({ status: 'Sent', externalMessageId: 'manual:ref' })
    );
    expect(note.label).toBe('Sent by a person');
    expect(note.detail).toMatch(/did not send it/i);
  });

  it('calls a transport success submission, not delivery', () => {
    const note = describeStatus(
      row({ status: 'Sent', externalMessageId: 'smtp-abc' })
    );
    expect(note.label).toBe('Submitted');
    expect(note.detail).toMatch(/not that anyone received/i);
  });

  it('says nothing has left while a message is only queued', () => {
    expect(describeStatus(row({ status: 'Queued' })).detail).toMatch(
      /nothing has left/i
    );
  });

  it('says approving is not sending', () => {
    expect(describeStatus(row({ status: 'Approved' })).detail).toMatch(
      /still not sent/i
    );
  });

  // The whole screen turns on this: no state may imply delivery.
  it('never claims delivery in any state', () => {
    for (const status of [
      'Draft',
      'Approved',
      'Queued',
      'Sent',
      'Uncertain',
      'Failed'
    ] as const) {
      const note = describeStatus(row({ status }));
      expect(note.detail).not.toMatch(/\bdelivered\b/i);
    }
  });
});

describe('why the system will not queue a message', () => {
  it('points a person-sent type at their own mailbox', () => {
    expect(whyNotDispatchable(row({ dispatchable: false }))).toMatch(
      /sent by a person/i
    );
  });

  it('asks for approval first', () => {
    expect(whyNotDispatchable(row({ status: 'Draft' }))).toMatch(/approve/i);
  });

  it('is silent when queueing really is available', () => {
    expect(whyNotDispatchable(row({ status: 'Approved' }))).toBeNull();
  });

  it('sends an uncertain message to the System page, not round again', () => {
    expect(whyNotDispatchable(row({ status: 'Uncertain' }))).toMatch(
      /System page/i
    );
  });
});
