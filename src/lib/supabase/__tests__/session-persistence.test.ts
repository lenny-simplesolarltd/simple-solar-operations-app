import { describe, expect, it } from 'vitest';
import {
  KEEP_SIGNED_IN_MAX_AGE,
  keepSignedIn,
  markerCookieOptions,
  withPersistence
} from '../session-persistence';

describe('Keep me signed in', () => {
  const supabaseCookie = {
    path: '/',
    sameSite: 'lax',
    maxAge: 400 * 24 * 3600,
    httpOnly: false
  };

  it('keeps Supabase defaults when the person chose to stay signed in', () => {
    expect(withPersistence(supabaseCookie, true)).toEqual(supabaseCookie);
  });

  it('turns auth cookies into browser-session cookies otherwise', () => {
    const out = withPersistence(
      { ...supabaseCookie, expires: new Date(Date.now() + 1e9) },
      false
    );
    expect(out).not.toHaveProperty('maxAge');
    expect(out).not.toHaveProperty('expires');
    expect(out).toMatchObject({ path: '/', sameSite: 'lax' });
  });

  it('never alters a deletion, so sign-out still removes the cookie', () => {
    expect(withPersistence({ path: '/', maxAge: 0 }, false)).toEqual({
      path: '/',
      maxAge: 0
    });
    const past = { path: '/', expires: new Date(0) };
    expect(withPersistence(past, false)).toEqual(past);
  });

  it('defaults to keeping the session unless the marker says otherwise', () => {
    expect(keepSignedIn(undefined)).toBe(true);
    expect(keepSignedIn('1')).toBe(true);
    expect(keepSignedIn('0')).toBe(false);
  });

  it('the marker lives exactly as long as the session it describes', () => {
    expect(markerCookieOptions(true, true)).toMatchObject({
      httpOnly: true,
      secure: true,
      maxAge: KEEP_SIGNED_IN_MAX_AGE
    });
    expect(markerCookieOptions(false, false)).not.toHaveProperty('maxAge');
  });
});
