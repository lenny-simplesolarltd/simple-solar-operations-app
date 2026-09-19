/**
 * "Keep me signed in".
 *
 * Supabase stores the session in cookies that last 400 days by default. When a
 * person signs in WITHOUT "Keep me signed in", we record that choice in a
 * marker cookie and every Supabase auth cookie we write from then on (sign-in,
 * token refresh) is made a browser-session cookie instead: it disappears when
 * the browser is closed. Deletions (maxAge 0) are never altered.
 *
 * Safe to import on the server and in the browser.
 */
export const KEEP_SIGNED_IN_COOKIE = 'ss_keep_signed_in';
export const KEEP_SIGNED_IN_MAX_AGE = 400 * 24 * 60 * 60;

type CookieOptions = {
  maxAge?: number;
  expires?: Date | string | number;
  [key: string]: unknown;
};

/** True unless the person explicitly chose a browser-session login. */
export function keepSignedIn(markerValue: string | undefined): boolean {
  return markerValue !== '0';
}

export function withPersistence<T extends CookieOptions | undefined>(
  options: T,
  keep: boolean
): T {
  if (keep || !options) return options;
  const isDeletion =
    (typeof options.maxAge === 'number' && options.maxAge <= 0) ||
    (options.expires !== undefined &&
      new Date(options.expires as string | number | Date).getTime() <=
        Date.now());
  if (isDeletion) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return rest as T;
}

/** Marker cookie options: it lives exactly as long as the session it describes. */
export function markerCookieOptions(keep: boolean, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    ...(keep ? { maxAge: KEEP_SIGNED_IN_MAX_AGE } : {})
  };
}
