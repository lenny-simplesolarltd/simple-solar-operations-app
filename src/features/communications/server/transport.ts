// The transport boundary.
//
// The worker knows how to send an email and nothing else. It does not decide
// who may receive one, what the message says, or whether a function is allowed
// to dispatch: app.email_claim_decision settled all of that, behind
// app.outbound_guard, before this code ever sees a row. The work payload is an
// instruction that has already been authorised.
//
// The four outcomes below exist because "it failed" is not one thing. Getting
// this wrong is how a system sends a customer the same email five times, or
// quietly drops one and reports success:
//
//   sent       the provider accepted it and gave us an id. SUBMISSION, not
//              receipt - nobody has read anything yet.
//   rejected   permanently wrong (bad address, refused content). Retrying
//              cannot help, so do not burn attempts on it.
//   transient  rate limited, provider 5xx, DNS. Worth another go on backoff.
//   uncertain  we do not know whether it went. A timeout after the request was
//              written to the socket looks exactly like this. NEVER guess:
//              a person checks the mailbox and resolves it.

export interface EmailToSend {
  from: string;
  to: string[];
  subject: string;
  body: string;
  /** '[SSO-COMM:<id>]' - findable in the sending mailbox, so a human can reconcile. */
  dedupeTag: string;
}

export type SendOutcome =
  | { kind: 'sent'; externalId: string }
  | { kind: 'rejected'; error: string }
  | { kind: 'transient'; error: string }
  | { kind: 'uncertain'; summary: string };

export interface EmailTransport {
  /** A short name recorded in the outbox summary, so the log says who sent it. */
  readonly name: string;
  send(email: EmailToSend): Promise<SendOutcome>;
  /**
   * Whether this transport can look in the sending mailbox for a dedupe tag
   * and tell us if a message already went.
   *
   * A send-only HTTP API cannot. When it cannot, a row the database marked
   * `reconcile_first` is NOT re-sent: the worker records it uncertain and a
   * person checks. Sending again would be the worse failure - the recipient
   * gets two orders and we would never know we caused it.
   */
  readonly canReconcile: boolean;
}
