import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// Each assertion re-decides the preview from scratch, exactly as a fresh HTTP
// request would; React's per-request memoisation would hide that.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <T>(fn: T) => fn
}));

const SECRET = 'a-preview-only-signing-secret-of-good-length';
const REAL_UID = '7f3d996b-1ae1-498c-b44a-7d6c62f0b256';
const REAL_PERSON = '99999999-9999-4999-8999-999999999999';
const TARGET = '11111111-1111-4111-8111-111111111111';
const DEVELOPER_EMAIL = 'lenny@simplesolarltd.co.uk';

/** The signed-in developer, as the server resolves them. Mutated per test. */
const session = {
  email: DEVELOPER_EMAIL,
  roles: ['Admin'] as string[]
};

const jar = new Map<string, { value: string; options: CookieOptions }>();
interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  path?: string;
  maxAge?: number;
}

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)!.value } : undefined,
    set: (name: string, value: string, options: CookieOptions = {}) =>
      jar.set(name, { value, options }),
    delete: (name: string) => jar.delete(name)
  }),
  headers: async () => new Headers()
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  getSessionState: async () => ({
    status: 'signed-in' as const,
    authUserId: REAL_UID,
    user: {
      id: REAL_PERSON,
      email: session.email,
      fullName: 'Lenny',
      roles: session.roles
    }
  })
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: TARGET, active: true, person_roles: [{ active: true }] }
          })
        })
      })
    })
  })
}));

import { PREVIEW_COOKIE, PREVIEW_TTL_MS } from '@/lib/preview/config';
import { getActivePreview } from '@/lib/preview/context';
import { endPreview, startPreview } from '../actions';

/** A deployed production runtime with production preview explicitly enabled. */
const HOSTED_ENV = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ocpwrrajskywpqpatwea.supabase.co',
  DEV_USER_PREVIEW_ENABLED: 'true',
  DEV_USER_PREVIEW_ALLOW_PRODUCTION: 'true',
  DEV_USER_PREVIEW_JWT_SECRET: SECRET,
  DEV_USER_PREVIEW_ALLOWED_EMAILS: `${DEVELOPER_EMAIL}, other@example.com`
};

beforeEach(() => {
  jar.clear();
  session.email = DEVELOPER_EMAIL;
  session.roles = ['Admin'];
  Object.assign(process.env, HOSTED_ENV);
});

describe('starting a production preview', () => {
  it('21. sets an HttpOnly, Secure, SameSite=Lax, path-/ , short-lived cookie', async () => {
    expect(await startPreview(TARGET)).toEqual({ ok: true });
    const cookie = jar.get(PREVIEW_COOKIE)!;
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/'
    });
    expect(cookie.options.maxAge).toBe(PREVIEW_TTL_MS.hosted / 1000);
    // and it names a person and an expiry, nothing else
    expect(cookie.value.startsWith(`${TARGET}.`)).toBe(true);
    expect(cookie.value).not.toMatch(/role|admin|perm/i);
    expect(cookie.value).not.toContain(SECRET);
  });

  it('local development keeps a non-Secure cookie, or the browser would drop it', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      VERCEL_ENV: '',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
      DEV_USER_PREVIEW_ALLOW_PRODUCTION: 'false'
    });
    expect(await startPreview(TARGET)).toEqual({ ok: true });
    expect(jar.get(PREVIEW_COOKIE)!.options).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax'
    });
  });

  it('refuses a request to preview yourself or a non-uuid', async () => {
    expect((await startPreview(REAL_PERSON)).ok).toBe(false);
    expect((await startPreview('../../etc/passwd')).ok).toBe(false);
    expect(jar.has(PREVIEW_COOKIE)).toBe(false);
  });

  it('refuses, and sets no cookie, for an Admin who is not named', async () => {
    session.email = 'another.admin@simplesolarltd.co.uk';
    expect(await startPreview(TARGET)).toEqual({
      ok: false,
      message: 'Your account is not allowed to use preview mode.'
    });
    expect(jar.has(PREVIEW_COOKIE)).toBe(false);
  });
});

describe('an active preview is re-authorized on every request', () => {
  const start = async () => {
    expect(await startPreview(TARGET)).toEqual({ ok: true });
    expect(await getActivePreview()).toMatchObject({
      targetPersonId: TARGET,
      realAuthUserId: REAL_UID,
      mode: 'hosted'
    });
  };

  it('18. dropping the developer from the allow-list ends it at once', async () => {
    await start();
    process.env.DEV_USER_PREVIEW_ALLOWED_EMAILS = 'someone.else@example.com';
    expect(await getActivePreview()).toBeNull();
  });

  it('19. removing the developer Admin role ends it at once', async () => {
    await start();
    session.roles = ['Office', 'Director', 'Manager'];
    expect(await getActivePreview()).toBeNull();
  });

  it('turning either flag off ends it at once', async () => {
    await start();
    process.env.DEV_USER_PREVIEW_ALLOW_PRODUCTION = 'false';
    expect(await getActivePreview()).toBeNull();
    process.env.DEV_USER_PREVIEW_ALLOW_PRODUCTION = 'true';
    expect(await getActivePreview()).not.toBeNull();
    process.env.DEV_USER_PREVIEW_ENABLED = 'false';
    expect(await getActivePreview()).toBeNull();
  });

  it('16. a cookie edited in the browser is ignored', async () => {
    await start();
    const good = jar.get(PREVIEW_COOKIE)!.value;
    const [, expires, signature] = good.split('.');
    const other = '22222222-2222-4222-8222-222222222222';
    for (const forged of [
      `${other}.${expires}.${signature}`,
      `${TARGET}.${Number(expires) + 60_000}.${signature}`,
      `${TARGET}.${expires}.${signature.slice(0, -2)}`,
      `${good}.roles=Admin`,
      TARGET
    ]) {
      jar.set(PREVIEW_COOKIE, { value: forged, options: {} });
      expect(await getActivePreview()).toBeNull();
    }
  });

  it('carries a signed proof for the database, never the secret', async () => {
    await start();
    const preview = await getActivePreview();
    expect(preview?.header).toMatch(/^v1\./);
    expect(preview?.header).not.toContain(SECRET);
    expect(preview?.jwt).toBeUndefined();
  });
});

describe('20. ending a preview restores the real identity immediately', () => {
  it('deletes the cookie, and the next request is the developer again', async () => {
    expect(await startPreview(TARGET)).toEqual({ ok: true });
    expect(await getActivePreview()).not.toBeNull();

    expect(await endPreview()).toEqual({ ok: true });
    expect(jar.has(PREVIEW_COOKIE)).toBe(false);
    expect(await getActivePreview()).toBeNull();
  });

  it('works even when the runtime has since been switched off entirely', async () => {
    expect(await startPreview(TARGET)).toEqual({ ok: true });
    process.env.DEV_USER_PREVIEW_ENABLED = 'false';
    expect(await endPreview()).toEqual({ ok: true });
    expect(jar.has(PREVIEW_COOKIE)).toBe(false);
  });
});
