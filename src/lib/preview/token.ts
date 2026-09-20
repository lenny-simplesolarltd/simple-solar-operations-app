import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url');
const hmac = (secret: string, data: string) =>
  createHmac('sha256', secret).update(data).digest();

/**
 * The preview cookie carries ONLY "which person, until when", signed with a key
 * bound to the real signed-in auth user. It never carries roles or permissions:
 * those are always loaded from the database for the target. A cookie copied to
 * another account, edited, expired or hand-made fails verification.
 */
export function signPreviewCookie(
  secret: string,
  realAuthUserId: string,
  targetPersonId: string,
  expiresAt: number
) {
  const body = `${targetPersonId}.${expiresAt}`;
  return `${body}.${b64(hmac(`${secret}:cookie:${realAuthUserId}`, body))}`;
}

export function verifyPreviewCookie(
  secret: string,
  realAuthUserId: string,
  value: string | undefined,
  now = Date.now()
) {
  if (!value) return null;
  const [targetPersonId, expires, signature, ...rest] = value.split('.');
  if (!targetPersonId || !expires || !signature || rest.length) return null;
  if (!/^[0-9a-f-]{36}$/i.test(targetPersonId) || !/^\d{10,16}$/.test(expires))
    return null;
  const expected = hmac(
    `${secret}:cookie:${realAuthUserId}`,
    `${targetPersonId}.${expires}`
  );
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  if (Number(expires) <= now) return null;
  return { targetPersonId };
}

/**
 * HOSTED mode proof, carried in the PREVIEW_HEADER on read requests.
 *
 * The request still authenticates as the REAL user's Supabase session, so
 * PostgREST validates that session exactly as always; this header only asks the
 * database to resolve identity as `targetPersonId` for the duration of one
 * read-only transaction. The database re-derives this same HMAC with the secret
 * it holds and refuses anything it cannot reproduce, so the browser - which
 * never sees the secret - cannot mint or edit one. The message is bound to the
 * real auth user, so a proof is useless in anyone else's session, and it expires
 * in minutes.
 *
 * Hex, not base64url, because the database recomputes it with
 * `encode(hmac(...), 'hex')`.
 */
const proofMessage = (
  realAuthUserId: string,
  targetPersonId: string,
  expiresAt: number
) => `ss-preview:v1:${realAuthUserId}:${targetPersonId}:${expiresAt}`;

export function signPreviewHeader(
  secret: string,
  realAuthUserId: string,
  targetPersonId: string,
  now = Date.now()
) {
  const expiresAt = now + 2 * 60 * 1000;
  const signature = createHmac('sha256', secret)
    .update(proofMessage(realAuthUserId, targetPersonId, expiresAt))
    .digest('hex');
  return `v1.${targetPersonId}.${expiresAt}.${signature}`;
}

/** The app-side mirror of the database check, used by tests and defence in depth. */
export function verifyPreviewHeader(
  secret: string,
  realAuthUserId: string,
  value: string | undefined,
  now = Date.now()
) {
  if (!value) return null;
  const [version, targetPersonId, expires, signature, ...rest] =
    value.split('.');
  if (version !== 'v1' || !targetPersonId || !expires || !signature)
    return null;
  if (rest.length) return null;
  if (!/^[0-9a-f-]{36}$/i.test(targetPersonId) || !/^\d{10,16}$/.test(expires))
    return null;
  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(proofMessage(realAuthUserId, targetPersonId, Number(expires)))
      .digest('hex')
  );
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  if (Number(expires) <= now) return null;
  return { targetPersonId };
}

/**
 * Short-lived JWT for the LOCAL stack. `sub` stays the REAL auth user; the
 * target travels as a separate claim, so the database always knows both.
 */
export function mintPreviewJwt(
  secret: string,
  realAuthUserId: string,
  targetPersonId: string,
  now = Date.now()
) {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const iat = Math.floor(now / 1000);
  const payload = b64(
    JSON.stringify({
      iss: 'dev-user-preview',
      aud: 'authenticated',
      role: 'authenticated',
      sub: realAuthUserId,
      preview_person_id: targetPersonId,
      iat,
      exp: iat + 120
    })
  );
  return `${header}.${payload}.${b64(hmac(secret, `${header}.${payload}`))}`;
}
