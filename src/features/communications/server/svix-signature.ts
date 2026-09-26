import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a Svix-signed webhook, which is what Resend sends.
 *
 * Hand-rolled rather than pulling in the SDK: this codebase already talks to
 * Resend over plain fetch (see resend-transport.ts), and the scheme is four
 * lines of HMAC. One dependency fewer on the path that decides whether a
 * stranger can write rows into this database.
 *
 * The scheme: sign `${id}.${timestamp}.${rawBody}` with the secret (base64,
 * after the `whsec_` prefix), and compare against any of the space-separated
 * versioned signatures in `svix-signature`.
 */

/** How far out of step with the sender's clock a request may be. */
const TOLERANCE_SECONDS = 5 * 60;

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySvixSignature({
  secret,
  id,
  timestamp,
  signature,
  rawBody,
  now = Date.now()
}: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  /** The bytes exactly as received. Re-serialised JSON will not verify. */
  rawBody: string;
  now?: number;
}): SignatureCheck {
  if (!id || !timestamp || !signature)
    return { ok: false, reason: 'missing svix headers' };

  // Replay: an attacker who captures one valid delivery must not be able to
  // repeat it for ever. Checked before any HMAC work.
  const sent = Number(timestamp);
  if (!Number.isFinite(sent))
    return { ok: false, reason: 'timestamp is not a number' };
  if (Math.abs(now / 1000 - sent) > TOLERANCE_SECONDS)
    return { ok: false, reason: 'timestamp outside tolerance' };

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (key.length === 0) return { ok: false, reason: 'secret is empty' };

  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  // The header carries one or more `v1,<sig>` pairs: a secret being rotated
  // produces two, and either is valid.
  for (const part of signature.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) continue;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    // Constant time, so a signature cannot be guessed a byte at a time.
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
  }
  return { ok: false, reason: 'no matching signature' };
}
