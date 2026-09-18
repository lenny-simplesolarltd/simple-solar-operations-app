import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ToolRegistry } from '@/features/assistant/server/registry';
import {
  fakeCompleteTask,
  fakeReadTool,
  makeActor
} from '@/features/assistant/server/__tests__/helpers';
import {
  PREVIEW_READ_ONLY_MESSAGE,
  getPreviewRuntime,
  mayStartPreview
} from '../config';
import {
  mintPreviewJwt,
  signPreviewCookie,
  verifyPreviewCookie
} from '../token';

const SECRET = 'local-stack-jwt-secret-with-at-least-32-chars';
const GOOD_ENV = {
  NODE_ENV: 'development',
  DEV_USER_PREVIEW_ENABLED: 'true',
  DEV_USER_PREVIEW_JWT_SECRET: SECRET,
  DEV_USER_PREVIEW_ALLOWED_EMAILS:
    'Lenny@SimpleSolarLtd.co.uk, other@example.com',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321'
} as unknown as NodeJS.ProcessEnv;
const LENNY = { email: 'lenny@simplesolarltd.co.uk', roles: ['Admin'] };
const REAL_UID = '7f3d996b-1ae1-498c-b44a-7d6c62f0b256';
const TARGET = '11111111-1111-4111-8111-111111111111';

describe('runtime gate (fails closed)', () => {
  it('allows only a fully configured non-production runtime on a local stack', () => {
    expect(getPreviewRuntime(GOOD_ENV).allowed).toBe(true);
  });

  it('refuses production even when everything else says yes', () => {
    expect(
      getPreviewRuntime({ ...GOOD_ENV, NODE_ENV: 'production' }).allowed
    ).toBe(false);
    expect(
      getPreviewRuntime({
        ...GOOD_ENV,
        VERCEL_ENV: 'production'
      } as NodeJS.ProcessEnv).allowed
    ).toBe(false);
    // and a refused runtime exposes no secret and no allow-list
    expect(
      getPreviewRuntime({ ...GOOD_ENV, NODE_ENV: 'production' })
    ).toMatchObject({ jwtSecret: '', allowedEmails: [] });
  });

  it('refuses when not explicitly enabled, not local, or without a secret / allow-list', () => {
    expect(
      getPreviewRuntime({ ...GOOD_ENV, DEV_USER_PREVIEW_ENABLED: undefined })
        .allowed
    ).toBe(false);
    expect(
      getPreviewRuntime({ ...GOOD_ENV, DEV_USER_PREVIEW_ENABLED: '1' }).allowed
    ).toBe(false);
    expect(
      getPreviewRuntime({
        ...GOOD_ENV,
        NEXT_PUBLIC_SUPABASE_URL: 'https://ocpwrrajskywpqpatwea.supabase.co'
      }).allowed
    ).toBe(false);
    expect(
      getPreviewRuntime({ ...GOOD_ENV, DEV_USER_PREVIEW_JWT_SECRET: 'short' })
        .allowed
    ).toBe(false);
    expect(
      getPreviewRuntime({ ...GOOD_ENV, DEV_USER_PREVIEW_ALLOWED_EMAILS: ' ' })
        .allowed
    ).toBe(false);
  });

  it('a NEXT_PUBLIC_* flag is not an enablement control', () => {
    const env = {
      ...GOOD_ENV,
      DEV_USER_PREVIEW_ENABLED: undefined,
      NEXT_PUBLIC_DEV_USER_PREVIEW_ENABLED: 'true'
    };
    expect(getPreviewRuntime(env as unknown as NodeJS.ProcessEnv).allowed).toBe(
      false
    );
  });
});

describe('who may start a preview', () => {
  const runtime = getPreviewRuntime(GOOD_ENV);
  it('an allow-listed Admin may', () =>
    expect(mayStartPreview(runtime, LENNY)).toBe(true));
  it('nobody unauthenticated may', () =>
    expect(mayStartPreview(runtime, null)).toBe(false));
  it('ordinary staff may not, even if allow-listed by email', () => {
    for (const roles of [
      ['Office'],
      ['Surveyor'],
      ['Director'],
      ['Manager'],
      []
    ]) {
      expect(mayStartPreview(runtime, { email: LENNY.email, roles })).toBe(
        false
      );
    }
  });
  it('being Admin is not enough: the developer must be named', () => {
    expect(
      mayStartPreview(runtime, {
        email: 'someone.else@simplesolarltd.co.uk',
        roles: ['Admin']
      })
    ).toBe(false);
  });
  it('nobody may when the runtime refuses', () => {
    expect(
      mayStartPreview(
        getPreviewRuntime({ ...GOOD_ENV, NODE_ENV: 'production' }),
        LENNY
      )
    ).toBe(false);
  });
});

describe('preview cookie cannot be forged', () => {
  const exp = Date.now() + 60_000;
  const good = signPreviewCookie(SECRET, REAL_UID, TARGET, exp);

  it('round-trips for the user it was issued to, and carries no roles or permissions', () => {
    expect(verifyPreviewCookie(SECRET, REAL_UID, good)).toEqual({
      targetPersonId: TARGET
    });
    expect(good.split('.')).toHaveLength(3);
    expect(good).not.toMatch(/role|perm|admin/i);
  });

  it('rejects hand-made, edited, re-targeted, expired or borrowed cookies', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const [, , sig] = good.split('.');
    expect(verifyPreviewCookie(SECRET, REAL_UID, undefined)).toBeNull();
    expect(verifyPreviewCookie(SECRET, REAL_UID, TARGET)).toBeNull();
    expect(
      verifyPreviewCookie(SECRET, REAL_UID, `${TARGET}.${exp}.`)
    ).toBeNull();
    expect(
      verifyPreviewCookie(SECRET, REAL_UID, `${other}.${exp}.${sig}`)
    ).toBeNull(); // swap the person
    expect(
      verifyPreviewCookie(SECRET, REAL_UID, `${TARGET}.${exp + 1}.${sig}`)
    ).toBeNull(); // extend it
    expect(
      verifyPreviewCookie(SECRET, REAL_UID, `${good}.roles=Admin`)
    ).toBeNull(); // smuggle roles
    expect(verifyPreviewCookie(SECRET, other, good)).toBeNull(); // another account's cookie
    expect(
      verifyPreviewCookie(
        'a-different-secret-of-sufficient-length!!',
        REAL_UID,
        good
      )
    ).toBeNull();
    expect(
      verifyPreviewCookie(
        SECRET,
        REAL_UID,
        signPreviewCookie(SECRET, REAL_UID, TARGET, Date.now() - 1)
      )
    ).toBeNull();
  });

  it('the database token keeps the REAL user as sub and is short-lived', () => {
    const payload = JSON.parse(
      Buffer.from(
        mintPreviewJwt(SECRET, REAL_UID, TARGET).split('.')[1],
        'base64url'
      ).toString()
    );
    expect(payload).toMatchObject({
      sub: REAL_UID,
      preview_person_id: TARGET,
      role: 'authenticated'
    });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(120);
    expect(Object.keys(payload)).not.toContain('roles');
  });
});

describe('assistant in preview', () => {
  const registry = new ToolRegistry()
    .register(fakeReadTool().tool)
    .register(fakeCompleteTask().tool);

  it('offers read tools but no mutation tool while previewing', () => {
    const permissions = registry
      .all()
      .flatMap((t) =>
        t.status === 'available' ? t.authorization.permissions : []
      );
    const actor = makeActor({ permissions });
    const normal = registry.availableFor(actor).map((t) => t.kind);
    const previewing = registry
      .availableFor({ ...actor, previewing: true })
      .map((t) => t.kind);
    expect(normal).toContain('mutation');
    expect(previewing).toContain('read');
    expect(previewing).not.toContain('mutation');
  });
});

describe('the write boundary speaks plainly', () => {
  it('uses the agreed message', () => {
    expect(PREVIEW_READ_ONLY_MESSAGE).toBe(
      'Preview mode is read-only. Return to your own account to make changes.'
    );
  });
});
