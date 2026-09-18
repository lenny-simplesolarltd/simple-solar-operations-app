import 'server-only';

import { getSessionState } from '@/lib/auth';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { PREVIEW_COOKIE, getPreviewRuntime, mayStartPreview } from './config';
import { mintPreviewJwt, verifyPreviewCookie } from './token';

export interface ActivePreview {
  targetPersonId: string;
  realAuthUserId: string;
  /** Short-lived, server-held token that makes the local database evaluate RLS as the target. */
  jwt: string;
}

/**
 * The preview request for this HTTP request, or null. Re-decided from scratch
 * every time, server-side: runtime allowed -> REAL session -> real user is an
 * authorized developer-Admin -> cookie signature/expiry bound to that user.
 * Nothing from the browser other than that signed cookie is consulted, and the
 * cookie can only name a person - never roles or permissions.
 */
export const getActivePreview = cache(
  async (): Promise<ActivePreview | null> => {
    const runtime = getPreviewRuntime();
    if (!runtime.allowed) return null;

    const session = await getSessionState();
    if (session.status !== 'signed-in') return null;
    if (!mayStartPreview(runtime, session.user)) return null;

    const cookie = (await cookies()).get(PREVIEW_COOKIE)?.value;
    const verified = verifyPreviewCookie(
      runtime.jwtSecret,
      session.authUserId,
      cookie
    );
    if (!verified) return null;
    if (verified.targetPersonId === session.user.id) return null;

    return {
      targetPersonId: verified.targetPersonId,
      realAuthUserId: session.authUserId,
      jwt: mintPreviewJwt(
        runtime.jwtSecret,
        session.authUserId,
        verified.targetPersonId
      )
    };
  }
);
