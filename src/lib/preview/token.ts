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
