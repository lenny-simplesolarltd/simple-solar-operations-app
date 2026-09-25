import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { canSee, visibleNavGroups } from '@/components/layout/nav-visibility';
import { navGroups } from '@/constants/data';
import type { AppUser } from '@/lib/auth';
import {
  PREVIEW_HEADER,
  PREVIEW_TTL_MS,
  getPreviewRuntime,
  mayStartPreview
} from '../config';
import {
  signPreviewCookie,
  signPreviewHeader,
  verifyPreviewCookie,
  verifyPreviewHeader
} from '../token';

const SECRET = 'a-preview-only-signing-secret-of-good-length';
const REAL_UID = '7f3d996b-1ae1-498c-b44a-7d6c62f0b256';
const TARGET = '11111111-1111-4111-8111-111111111111';
const HOSTED_SUPABASE = 'https://ocpwrrajskywpqpatwea.supabase.co';

/** A deployed production runtime with everything except the two flags. */
const PRODUCTION = {
  NODE_ENV: 'production',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: HOSTED_SUPABASE,
  DEV_USER_PREVIEW_JWT_SECRET: SECRET,
  DEV_USER_PREVIEW_ALLOWED_EMAILS: 'Lenny@SimpleSolarLtd.co.uk'
} as unknown as NodeJS.ProcessEnv;

const production = (extra: Record<string, string | undefined> = {}) =>
  getPreviewRuntime({ ...PRODUCTION, ...extra } as NodeJS.ProcessEnv);

const BOTH_FLAGS = {
  DEV_USER_PREVIEW_ENABLED: 'true',
  DEV_USER_PREVIEW_ALLOW_PRODUCTION: 'true'
};

const DEVELOPER = { email: 'lenny@simplesolarltd.co.uk', roles: ['Admin'] };

// -----------------------------------------------------------------------------
// 1-6: the production gate
// -----------------------------------------------------------------------------
describe('production preview needs BOTH server-only flags', () => {
  it('1. refuses production when the feature is disabled', () => {
    expect(production().allowed).toBe(false);
    expect(production({ DEV_USER_PREVIEW_ENABLED: 'false' }).allowed).toBe(
      false
    );
  });

  it('2. refuses production with DEV_USER_PREVIEW_ENABLED alone', () => {
    const runtime = production({ DEV_USER_PREVIEW_ENABLED: 'true' });
    expect(runtime.allowed).toBe(false);
    expect(runtime.reason).toMatch(/ALLOW_PRODUCTION/);
    // ...and a refused runtime hands out neither the secret nor the allow-list.
    expect(runtime).toMatchObject({ jwtSecret: '', allowedEmails: [] });
  });

  it('3. refuses production with DEV_USER_PREVIEW_ALLOW_PRODUCTION alone', () => {
    expect(
      production({ DEV_USER_PREVIEW_ALLOW_PRODUCTION: 'true' }).allowed
    ).toBe(false);
  });

  it('a malformed, empty or nearly-right ALLOW_PRODUCTION is not an opt-in', () => {
    for (const value of ['', ' ', '1', 'TRUE', 'True', 'yes', 'true ', 'on']) {
      expect(
        production({
          DEV_USER_PREVIEW_ENABLED: 'true',
          DEV_USER_PREVIEW_ALLOW_PRODUCTION: value
        }).allowed
      ).toBe(false);
    }
  });

  it('is not controllable from the browser: no NEXT_PUBLIC_* equivalent works', () => {
    expect(
      production({
        NEXT_PUBLIC_DEV_USER_PREVIEW_ENABLED: 'true',
        NEXT_PUBLIC_DEV_USER_PREVIEW_ALLOW_PRODUCTION: 'true'
      }).allowed
    ).toBe(false);
  });

  it('6. permits production with both flags, and reports hosted mode', () => {
    const runtime = production(BOTH_FLAGS);
    expect(runtime.allowed).toBe(true);
    expect(runtime.mode).toBe('hosted');
    expect(mayStartPreview(runtime, DEVELOPER)).toBe(true);
  });

  it('4. refuses a non-allow-listed Admin even with both flags', () => {
    const runtime = production(BOTH_FLAGS);
    expect(
      mayStartPreview(runtime, {
        email: 'ben@simplesolarltd.co.uk',
        roles: ['Admin']
      })
    ).toBe(false);
  });

  it('5. refuses an allow-listed NON-Admin even with both flags', () => {
    const runtime = production(BOTH_FLAGS);
    for (const roles of [
      ['Office'],
      ['Director'],
      ['Manager'],
      ['Installer'],
      []
    ]) {
      expect(mayStartPreview(runtime, { email: DEVELOPER.email, roles })).toBe(
        false
      );
    }
  });

  it('still needs a real secret and a non-empty allow-list in production', () => {
    expect(
      production({ ...BOTH_FLAGS, DEV_USER_PREVIEW_JWT_SECRET: 'too-short' })
        .allowed
    ).toBe(false);
    expect(
      production({ ...BOTH_FLAGS, DEV_USER_PREVIEW_ALLOWED_EMAILS: ' , ' })
        .allowed
    ).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 22: local development is unchanged
// -----------------------------------------------------------------------------
describe('22. local development preview still works, unchanged', () => {
  const LOCAL = {
    NODE_ENV: 'development',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321',
    DEV_USER_PREVIEW_ENABLED: 'true',
    DEV_USER_PREVIEW_JWT_SECRET: SECRET,
    DEV_USER_PREVIEW_ALLOWED_EMAILS: DEVELOPER.email
  } as unknown as NodeJS.ProcessEnv;

  it('is allowed in local mode without the production flag', () => {
    const runtime = getPreviewRuntime(LOCAL);
    expect(runtime).toMatchObject({ allowed: true, mode: 'local' });
    expect(mayStartPreview(runtime, DEVELOPER)).toBe(true);
  });

  it('a development runtime pointed at hosted Supabase is still refused', () => {
    expect(
      getPreviewRuntime({
        ...LOCAL,
        NEXT_PUBLIC_SUPABASE_URL: HOSTED_SUPABASE
      } as NodeJS.ProcessEnv).allowed
    ).toBe(false);
  });

  it('local sessions last longer than hosted ones', () => {
    expect(PREVIEW_TTL_MS.hosted).toBeLessThan(PREVIEW_TTL_MS.local);
    expect(PREVIEW_TTL_MS.hosted).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});

// -----------------------------------------------------------------------------
// 7-8: who is offered the switcher at all
// -----------------------------------------------------------------------------
describe('7-8. the switcher is offered to nobody but named developer-Admins', () => {
  const runtime = production(BOTH_FLAGS);

  it('7. ordinary staff never see it, whatever their role', () => {
    for (const roles of [
      ['Office'],
      ['Director'],
      ['Manager'],
      ['Surveyor'],
      ['Installer'],
      ['Store'],
      ['Finance'],
      ['ReadOnly']
    ]) {
      expect(
        mayStartPreview(runtime, {
          email: 'tanya@simplesolarltd.co.uk',
          roles
        })
      ).toBe(false);
    }
  });

  it('8. a non-allow-listed Admin never sees it', () => {
    expect(
      mayStartPreview(runtime, {
        email: 'another.admin@simplesolarltd.co.uk',
        roles: ['Admin', 'Manager']
      })
    ).toBe(false);
  });

  it('nobody signed out sees it', () =>
    expect(mayStartPreview(runtime, null)).toBe(false));
});

// -----------------------------------------------------------------------------
// 9-10: navigation is the PREVIEW identity's, never the developer's
// -----------------------------------------------------------------------------
describe('9-10. navigation follows the previewed person', () => {
  const asUser = (roles: string[]): AppUser => ({
    id: TARGET,
    email: 'tanya@simplesolarltd.co.uk',
    fullName: 'Tanya Harris',
    roles: roles as AppUser['roles']
  });
  const titles = (user: AppUser, permissions: string[] = []) =>
    visibleNavGroups(navGroups, user, new Set(permissions), {
      forms: true,
      programmes: false
    }).flatMap((g) => g.items.map((i) => i.title));

  it('9. an Office preview gets the Office menu, an Installer the Installer one', () => {
    const office = titles(asUser(['Office']), ['task.read.all']);
    const installer = titles(asUser(['Installer']));
    expect(office).not.toEqual(installer);
    expect(canSee('office', asUser(['Office']), new Set())).toBe(true);
    expect(canSee('office', asUser(['Installer']), new Set())).toBe(false);
    expect(canSee('installer', asUser(['Installer']), new Set())).toBe(true);
  });

  it('10. Admin-only entries do not leak into a preview of a non-Admin', () => {
    const adminOnly = ['admin', 'stock'] as const;
    const previewed = asUser(['Office']);
    for (const access of adminOnly) {
      expect(canSee(access, previewed, new Set())).toBe(false);
      expect(
        canSee(access, { ...previewed, roles: ['Admin'] }, new Set())
      ).toBe(true);
    }
    // The previewed AppUser carries the target's roles only - the real
    // developer's Admin role is recorded separately and grants nothing here.
    const withRealDeveloper: AppUser = {
      ...previewed,
      preview: {
        realPersonId: 'real-person',
        realName: 'Lenny',
        realEmail: DEVELOPER.email
      }
    };
    expect(withRealDeveloper.roles).not.toContain('Admin');
    expect(canSee('admin', withRealDeveloper, new Set())).toBe(false);
    expect(titles(withRealDeveloper)).toEqual(titles(previewed));
  });

  it('release gating still applies to the previewed person', () => {
    const office = asUser(['Office']);
    expect(
      canSee('forms', office, new Set(['forms.read']), {
        forms: false,
        programmes: false
      })
    ).toBe(false);
    expect(
      canSee('forms', office, new Set(['forms.read']), {
        forms: true,
        programmes: false
      })
    ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 16-17, 21: the hosted proof and cookie
// -----------------------------------------------------------------------------
describe('16-17. the hosted proof cannot be forged, replayed or stretched', () => {
  const proof = signPreviewHeader(SECRET, REAL_UID, TARGET);

  it('round-trips only for the exact user, target and secret it names', () => {
    expect(verifyPreviewHeader(SECRET, REAL_UID, proof)).toEqual({
      targetPersonId: TARGET
    });
    expect(PREVIEW_HEADER).toBe('x-ss-dev-preview');
  });

  it('16. rejects a tampered, re-targeted, borrowed or hand-made proof', () => {
    const other = '22222222-2222-4222-8222-222222222222';
    const [, , expires, signature] = proof.split('.');
    expect(verifyPreviewHeader(SECRET, REAL_UID, undefined)).toBeNull();
    expect(verifyPreviewHeader(SECRET, REAL_UID, TARGET)).toBeNull();
    // swap the person, keeping the signature
    expect(
      verifyPreviewHeader(
        SECRET,
        REAL_UID,
        `v1.${other}.${expires}.${signature}`
      )
    ).toBeNull();
    // extend the expiry
    expect(
      verifyPreviewHeader(
        SECRET,
        REAL_UID,
        `v1.${TARGET}.${Number(expires) + 60_000}.${signature}`
      )
    ).toBeNull();
    // flip one byte of the signature
    expect(
      verifyPreviewHeader(
        SECRET,
        REAL_UID,
        `v1.${TARGET}.${expires}.${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`
      )
    ).toBeNull();
    // another developer's session
    expect(verifyPreviewHeader(SECRET, other, proof)).toBeNull();
    // a different secret
    expect(
      verifyPreviewHeader(
        'some-other-secret-of-sufficient-length!!',
        REAL_UID,
        proof
      )
    ).toBeNull();
    // a version nobody issues
    expect(
      verifyPreviewHeader(
        SECRET,
        REAL_UID,
        `v2.${TARGET}.${expires}.${signature}`
      )
    ).toBeNull();
  });

  it('17. rejects an expired proof, and issues only short-lived ones', () => {
    const issuedAt = Date.now();
    const short = signPreviewHeader(SECRET, REAL_UID, TARGET, issuedAt);
    const expiry = Number(short.split('.')[2]);
    expect(expiry - issuedAt).toBeLessThanOrEqual(2 * 60 * 1000);
    expect(verifyPreviewHeader(SECRET, REAL_UID, short, expiry + 1)).toBeNull();
  });

  it('carries no roles, permissions or secret material', () => {
    expect(proof).not.toMatch(/role|perm|admin/i);
    expect(proof).not.toContain(SECRET);
  });
});

describe('17. an expired production cookie is refused', () => {
  it('a cookie past its expiry verifies as nothing', () => {
    const expired = signPreviewCookie(
      SECRET,
      REAL_UID,
      TARGET,
      Date.now() - 1000
    );
    expect(verifyPreviewCookie(SECRET, REAL_UID, expired)).toBeNull();
    const live = signPreviewCookie(
      SECRET,
      REAL_UID,
      TARGET,
      Date.now() + PREVIEW_TTL_MS.hosted
    );
    expect(verifyPreviewCookie(SECRET, REAL_UID, live)).toEqual({
      targetPersonId: TARGET
    });
  });
});
