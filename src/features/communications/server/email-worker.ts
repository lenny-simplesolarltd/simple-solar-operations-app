import type { EmailToSend, EmailTransport } from './transport';

// The email worker: claim, send, record. It is the ONLY thing in the system
// that talks to a mail provider, and it is deliberately stupid - every
// decision was already made in the database.
//
// What it must never do, in order of how much damage it causes:
//
//   1. Send twice. A retry after an ambiguous answer is the classic way to
//      post a merchant two identical orders. The database marks such a row
//      `reconcile_first`; a transport that cannot search the sent mailbox does
//      NOT get to guess, so the row is recorded uncertain for a person.
//   2. Report a success it cannot evidence. No id back means uncertain, not
//      Succeeded.
//   3. Invent recipients. `to` comes from the work payload, which came through
//      app.outbound_guard against outbound.allowed_recipients.
//
// Nothing here can open a gate. public.outbox_claim refuses unless the action
// type's function is Automated and email.mode is LIVE, so with the settings as
// shipped this worker claims nothing and sends nothing - it is safe to deploy
// and schedule long before anyone decides to go live.

/** The action types this worker is responsible for. Calendar has its own. */
export const EMAIL_ACTION_TYPES = ['EmailOrder', 'EmailScaffold'] as const;

type Json = Record<string, unknown>;

export interface RpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
}

export interface WorkerReport {
  claimed: number;
  sent: number;
  failed: number;
  uncertain: number;
  skipped: number;
  /** Rows a person must look at, with the reason in words. */
  needsPerson: { outboxId: string; why: string }[];
  /** Set when the claim itself was refused - usually a closed gate. */
  refused?: string;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * One pass of the worker.
 *
 * `limit` is the claim batch size; the database caps it at 200. Call this on a
 * schedule - it is safe to run concurrently, because the claim locks rows with
 * `for update skip locked`.
 */
export async function runEmailWorker({
  client,
  transport,
  limit = 20
}: {
  client: RpcClient;
  transport: EmailTransport;
  limit?: number;
}): Promise<WorkerReport> {
  const report: WorkerReport = {
    claimed: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    skipped: 0,
    needsPerson: []
  };

  const claim = await client.rpc('outbox_claim', {
    p_action_types: [...EMAIL_ACTION_TYPES],
    p_limit: limit
  });

  if (claim.error) {
    // A shut gate raises here (OUTBOX_REFUSED: FN-03 must be Automated). That
    // is the system working, not a fault: report it and stop.
    report.refused = claim.error.message;
    return report;
  }

  const envelope = (claim.data ?? {}) as Json;
  const claimed = Array.isArray(envelope.claimed) ? envelope.claimed : [];
  report.skipped = Array.isArray(envelope.skipped)
    ? envelope.skipped.length
    : 0;
  report.claimed = claimed.length;

  for (const raw of claimed) {
    const row = raw as Json;
    const outboxId = str(row.outbox_id);
    if (!outboxId) continue;
    const work = (row.work ?? {}) as Json;

    // A row the database wants reconciled, on a transport that cannot look.
    // Recording uncertain leaves it for a person and the existing Resolve
    // action on the System page. Sending would risk a duplicate.
    if (work.reconcile_first === true && !transport.canReconcile) {
      await record(client, 'outbox_record_uncertain', {
        p_outbox_id: outboxId,
        p_summary: `RECONCILE REQUIRED: attempt ${row.attempt ?? '?'} after an unsettled send. ${transport.name} cannot search the sent mailbox. Look for ${str(work.dedupe_tag) ?? 'the message'} before sending again.`
      });
      report.uncertain += 1;
      report.needsPerson.push({
        outboxId,
        why: 'a previous attempt was never settled; check the mailbox before it is sent again'
      });
      continue;
    }

    const email = toEmail(work);
    if (!email) {
      // The payload is not something we can send. Not a transport failure, so
      // it must not consume retries silently.
      await record(client, 'outbox_record_failure', {
        p_outbox_id: outboxId,
        p_transient: false,
        p_error: 'WORK_PAYLOAD_INCOMPLETE: from, to or subject missing'
      });
      report.failed += 1;
      report.needsPerson.push({
        outboxId,
        why: 'the queued message had no usable sender, recipients or subject'
      });
      continue;
    }

    const outcome = await transport.send(email);
    switch (outcome.kind) {
      case 'sent':
        await record(client, 'outbox_record_success', {
          p_outbox_id: outboxId,
          p_external_id: outcome.externalId,
          // Worded so nobody reads this as proof of receipt.
          p_summary: `SUBMITTED via ${transport.name}; delivery not confirmed`
        });
        report.sent += 1;
        break;
      case 'transient':
        await record(client, 'outbox_record_failure', {
          p_outbox_id: outboxId,
          p_transient: true,
          p_error: outcome.error
        });
        report.failed += 1;
        break;
      case 'rejected':
        await record(client, 'outbox_record_failure', {
          p_outbox_id: outboxId,
          p_transient: false,
          p_error: outcome.error
        });
        report.failed += 1;
        report.needsPerson.push({ outboxId, why: outcome.error });
        break;
      case 'uncertain':
        await record(client, 'outbox_record_uncertain', {
          p_outbox_id: outboxId,
          p_summary: outcome.summary
        });
        report.uncertain += 1;
        report.needsPerson.push({ outboxId, why: outcome.summary });
        break;
    }
  }

  return report;
}

/** The work payload as something sendable, or null if it is not complete. */
function toEmail(work: Json): EmailToSend | null {
  const from = str(work.from);
  const to = strings(work.to);
  const subject = str(work.subject);
  if (!from || to.length === 0 || !subject) return null;
  return {
    from,
    to,
    subject,
    body: str(work.body) ?? '',
    dedupeTag: str(work.dedupe_tag) ?? ''
  };
}

/**
 * Recording the result must not be skipped because it threw: a row left in
 * Processing is invisible until the stalled sweep releases it. The error is
 * surfaced, never swallowed into a pretended success.
 */
async function record(
  client: RpcClient,
  fn: string,
  args: Record<string, unknown>
): Promise<void> {
  const { error } = await client.rpc(fn, args);
  if (error)
    // eslint-disable-next-line no-console -- the row is stranded in Processing until the stalled sweep releases it; a server log is the only signal
    console.error(
      `email worker: ${fn} failed for ${String(args.p_outbox_id)}`,
      error
    );
}
