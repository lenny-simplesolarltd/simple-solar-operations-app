import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySvixSignature } from '../server/svix-signature';

const SECRET = `whsec_${Buffer.from('a-signing-secret-of-some-length').toString('base64')}`;
const NOW = 1_780_000_000_000;

const sign = (id: string, ts: string, body: string, secret = SECRET) =>
  createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
    .update(`${id}.${ts}.${body}`)
    .digest('base64');

const call = (
  over: Partial<Parameters<typeof verifySvixSignature>[0]> = {}
) => {
  const id = 'msg_1';
  const timestamp = String(Math.floor(NOW / 1000));
  const rawBody = '{"type":"email.received"}';
  return verifySvixSignature({
    secret: SECRET,
    id,
    timestamp,
    rawBody,
    signature: `v1,${sign(id, timestamp, rawBody)}`,
    now: NOW,
    ...over
  });
};

describe('Svix signature verification', () => {
  it('accepts a correctly signed request', () => {
    expect(call()).toEqual({ ok: true });
  });

  it('accepts one of several signatures, so a rotating secret still works', () => {
    const id = 'msg_1';
    const timestamp = String(Math.floor(NOW / 1000));
    const rawBody = '{"type":"email.received"}';
    expect(
      call({
        signature: `v1,AAAAnotthisone= v1,${sign(id, timestamp, rawBody)}`
      })
    ).toEqual({ ok: true });
  });

  it('rejects a body that changed by one byte', () => {
    // The whole point: a re-serialised JSON body must not verify, because an
    // attacker who can alter the body can alter who the email came from.
    expect(call({ rawBody: '{"type":"email.received" }' }).ok).toBe(false);
  });

  it('rejects a replay from outside the tolerance', () => {
    const old = String(Math.floor(NOW / 1000) - 600);
    const rawBody = '{"type":"email.received"}';
    expect(
      call({
        timestamp: old,
        signature: `v1,${sign('msg_1', old, rawBody)}`
      })
    ).toEqual({ ok: false, reason: 'timestamp outside tolerance' });
  });

  it('rejects a signature made with a different secret', () => {
    const id = 'msg_1';
    const timestamp = String(Math.floor(NOW / 1000));
    const rawBody = '{"type":"email.received"}';
    const other = `whsec_${Buffer.from('a-completely-different-secret').toString('base64')}`;
    expect(
      call({ signature: `v1,${sign(id, timestamp, rawBody, other)}` }).ok
    ).toBe(false);
  });

  it('rejects missing headers rather than treating them as absent proof', () => {
    expect(call({ signature: null })).toEqual({
      ok: false,
      reason: 'missing svix headers'
    });
    expect(call({ id: null }).ok).toBe(false);
  });

  it('ignores signature versions it does not understand', () => {
    expect(call({ signature: 'v2,anything' }).ok).toBe(false);
  });
});
