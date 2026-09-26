import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runEmailWorker, type RpcClient } from '../server/email-worker';
import type {
  EmailToSend,
  EmailTransport,
  SendOutcome
} from '../server/transport';

// A fake database that records what the worker called, and a fake transport
// whose answer each test chooses. Nothing here touches Resend or Postgres.

type Call = { fn: string; args: Record<string, unknown> };

function fakeClient(claimed: unknown[], opts: { error?: string } = {}) {
  const calls: Call[] = [];
  const client: RpcClient = {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'outbox_claim') {
        if (opts.error)
          return Promise.resolve({
            data: null,
            error: { message: opts.error }
          });
        return Promise.resolve({
          data: { claimed, settled: [], skipped: [] },
          error: null
        });
      }
      return Promise.resolve({ data: {}, error: null });
    }
  };
  return { client, calls };
}

function fakeTransport(
  outcome: SendOutcome,
  over: Partial<EmailTransport> = {}
): EmailTransport & { sent: number } {
  const t = {
    name: 'fake',
    canReconcile: false,
    sent: 0,
    async send() {
      t.sent += 1;
      return outcome;
    },
    ...over
  };
  return t as EmailTransport & { sent: number };
}

const row = (
  work: Record<string, unknown> = {},
  over: Record<string, unknown> = {}
) => ({
  outbox_id: '11111111-1111-4111-8111-111111111111',
  action_type: 'EmailOrder',
  attempt: 1,
  work: {
    from: 'orders@example.com',
    to: ['merchant@example.com'],
    subject: 'Order SS-0001',
    body: 'Please supply the following.',
    dedupe_tag: '[SSO-COMM:abc]',
    reconcile_first: false,
    ...work
  },
  ...over
});

const find = (calls: Call[], fn: string) => calls.find((c) => c.fn === fn);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a shut gate', () => {
  it('is reported, not treated as a fault, and sends nothing', async () => {
    const { client } = fakeClient([], {
      error: 'OUTBOX_REFUSED: FN-03 must be Automated'
    });
    const transport = fakeTransport({ kind: 'sent', externalId: 'x' });
    const report = await runEmailWorker({ client, transport });

    expect(report.refused).toMatch(/must be Automated/);
    expect(report.claimed).toBe(0);
    expect(transport.sent).toBe(0);
  });
});

describe('a clean send', () => {
  it('records success without claiming delivery', async () => {
    const { client, calls } = fakeClient([row()]);
    const transport = fakeTransport({ kind: 'sent', externalId: 'resend-1' });
    const report = await runEmailWorker({ client, transport });

    expect(report.sent).toBe(1);
    const success = find(calls, 'outbox_record_success');
    expect(success?.args.p_external_id).toBe('resend-1');
    expect(String(success?.args.p_summary)).toMatch(/delivery not confirmed/i);
    expect(String(success?.args.p_summary)).not.toMatch(/delivered|received/i);
  });
});

describe('the duplicate-send trap', () => {
  it('refuses to re-send a row the database wants reconciled', async () => {
    const { client, calls } = fakeClient([row({ reconcile_first: true })]);
    const transport = fakeTransport({ kind: 'sent', externalId: 'resend-2' });
    const report = await runEmailWorker({ client, transport });

    // The whole point: nothing was sent.
    expect(transport.sent).toBe(0);
    expect(report.uncertain).toBe(1);
    expect(report.needsPerson).toHaveLength(1);
    expect(
      String(find(calls, 'outbox_record_uncertain')?.args.p_summary)
    ).toMatch(/RECONCILE REQUIRED/);
    expect(find(calls, 'outbox_record_success')).toBeUndefined();
  });

  it('does send it when the transport can actually reconcile', async () => {
    const { client } = fakeClient([row({ reconcile_first: true })]);
    const transport = fakeTransport(
      { kind: 'sent', externalId: 'resend-3' },
      { canReconcile: true }
    );
    const report = await runEmailWorker({ client, transport });

    expect(transport.sent).toBe(1);
    expect(report.sent).toBe(1);
  });
});

describe('when the answer is ambiguous', () => {
  it('records uncertain rather than guessing either way', async () => {
    const { client, calls } = fakeClient([row()]);
    const transport = fakeTransport({
      kind: 'uncertain',
      summary: 'no answer from resend: timeout'
    });
    const report = await runEmailWorker({ client, transport });

    expect(report.uncertain).toBe(1);
    expect(find(calls, 'outbox_record_success')).toBeUndefined();
    expect(find(calls, 'outbox_record_failure')).toBeUndefined();
    expect(find(calls, 'outbox_record_uncertain')).toBeDefined();
  });
});

describe('failures', () => {
  it('marks a rate limit transient so backoff retries it', async () => {
    const { client, calls } = fakeClient([row()]);
    const report = await runEmailWorker({
      client,
      transport: fakeTransport({ kind: 'transient', error: 'resend 429' })
    });

    expect(report.failed).toBe(1);
    expect(find(calls, 'outbox_record_failure')?.args.p_transient).toBe(true);
    // Transient problems are not a person's problem yet.
    expect(report.needsPerson).toHaveLength(0);
  });

  it('marks a rejection permanent and asks for a person', async () => {
    const { client, calls } = fakeClient([row()]);
    const report = await runEmailWorker({
      client,
      transport: fakeTransport({
        kind: 'rejected',
        error: 'resend 422: bad address'
      })
    });

    expect(find(calls, 'outbox_record_failure')?.args.p_transient).toBe(false);
    expect(report.needsPerson).toHaveLength(1);
  });

  it('will not send a payload with no recipients', async () => {
    const { client, calls } = fakeClient([row({ to: [] })]);
    const transport = fakeTransport({ kind: 'sent', externalId: 'x' });
    const report = await runEmailWorker({ client, transport });

    expect(transport.sent).toBe(0);
    expect(report.failed).toBe(1);
    expect(String(find(calls, 'outbox_record_failure')?.args.p_error)).toMatch(
      /WORK_PAYLOAD_INCOMPLETE/
    );
  });
});

describe('the recipients it sends to', () => {
  it('are the ones the database authorised, never invented', async () => {
    let seen: string[] = [];
    const { client } = fakeClient([row({ to: ['allowed@example.com'] })]);
    const transport = fakeTransport({ kind: 'sent', externalId: 'x' });
    transport.send = async (email) => {
      seen = email.to;
      return { kind: 'sent', externalId: 'x' };
    };
    await runEmailWorker({ client, transport });

    expect(seen).toEqual(['allowed@example.com']);
  });
});

describe('the claim request', () => {
  it('asks for the email action types and nothing else', async () => {
    // Calendar and Xero have their own workers; claiming their rows here
    // would strand them. EmailReport belongs in this list - it was registered
    // in the database without being added here, so scheduled reports queued
    // correctly, passed every gate, and were then never claimed by anything.
    // EmailAdhoc joined it when people could write their own email.
    const { client, calls } = fakeClient([]);
    await runEmailWorker({
      client,
      transport: fakeTransport({ kind: 'sent', externalId: 'x' })
    });

    expect(find(calls, 'outbox_claim')?.args.p_action_types).toEqual([
      'EmailOrder',
      'EmailScaffold',
      'EmailReport',
      'EmailAdhoc'
    ]);
  });
});

describe('reply-to', () => {
  /** A transport that keeps the last email, so a test can read what was sent. */
  const capturing = () => {
    const seen: EmailToSend[] = [];
    const t: EmailTransport = {
      name: 'capturing',
      canReconcile: false,
      async send(email) {
        seen.push(email);
        return { kind: 'sent', externalId: 'x' };
      }
    };
    return { transport: t, seen };
  };

  it('is carried to the transport when the database supplies one', async () => {
    // Production sends from a subdomain with no inbound mail, so without this
    // a reply would go nowhere - and a reply is the only evidence this system
    // ever has that somebody received anything.
    const { transport, seen } = capturing();
    const { client } = fakeClient([
      row({
        from: 'reports@send.example.com',
        reply_to: 'operations@example.com'
      })
    ]);
    await runEmailWorker({ client, transport });

    expect(seen[0]?.from).toBe('reports@send.example.com');
    expect(seen[0]?.replyTo).toBe('operations@example.com');
  });

  it('is absent on a row queued before it existed, rather than invented', async () => {
    const { transport, seen } = capturing();
    const { client } = fakeClient([row()]);
    await runEmailWorker({ client, transport });

    expect(seen[0]?.replyTo).toBeUndefined();
  });
});
