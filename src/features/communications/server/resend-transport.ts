import 'server-only';

import type { EmailToSend, EmailTransport, SendOutcome } from './transport';

// Resend, over plain fetch. No SDK: one POST, and the mapping from its answer
// to our four outcomes is the entire point of this file.
//
// Resend is send-only. It cannot tell us whether a message with a given tag
// already left the mailbox, so canReconcile is false and the worker refuses to
// re-send a row the database flagged for reconciliation.

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;

export function createResendTransport(apiKey: string): EmailTransport {
  return {
    name: 'resend',
    canReconcile: false,
    async send(email: EmailToSend): Promise<SendOutcome> {
      // The tag goes in the body, not the subject: staff read the subject, and
      // it has already been approved word for word. A person searching the
      // mailbox can still find the message by this string.
      const body = `${email.body}\n\n${email.dedupeTag}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // Resend de-duplicates on this for 24h, which makes a retry after
            // an ambiguous timeout safe rather than a second copy.
            'Idempotency-Key': email.dedupeTag
          },
          body: JSON.stringify({
            from: email.from,
            ...(email.replyTo ? { reply_to: email.replyTo } : {}),
            to: email.to,
            subject: email.subject,
            text: body
          }),
          signal: controller.signal
        });
      } catch (err) {
        // The request may or may not have reached them. This is the case that
        // must never be guessed: aborting on timeout lands here too.
        return {
          kind: 'uncertain',
          summary: `no answer from resend: ${err instanceof Error ? err.message : 'unknown'}`
        };
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) {
        const id = await readId(response);
        return id
          ? { kind: 'sent', externalId: id }
          : // Accepted, but we cannot name what was accepted. Treat as
            // uncertain rather than recording a success we cannot evidence.
            {
              kind: 'uncertain',
              summary: 'resend accepted it but returned no id'
            };
      }

      const detail = await readError(response);
      if (response.status === 429 || response.status >= 500)
        return {
          kind: 'transient',
          error: `resend ${response.status}: ${detail}`
        };
      if (response.status === 401 || response.status === 403)
        // Not the message's fault, and retrying cannot fix a bad key.
        return {
          kind: 'rejected',
          error: `resend auth failed (${response.status}): ${detail}`
        };
      return {
        kind: 'rejected',
        error: `resend ${response.status}: ${detail}`
      };
    }
  };
}

async function readId(response: Response): Promise<string | null> {
  try {
    const json = (await response.json()) as { id?: unknown };
    return typeof json.id === 'string' && json.id.length > 0 ? json.id : null;
  } catch {
    return null;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300) || response.statusText;
  } catch {
    return response.statusText;
  }
}
