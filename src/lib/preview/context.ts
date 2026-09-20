import 'server-only';

import { getSessionState } from '@/lib/auth';
import { cookies } from 'next/headers';
import { cache } from 'react';
import {
  PREVIEW_COOKIE,
  type PreviewMode,
  getPreviewRuntime,
  mayStartPreview
} from './config';
import {
  mintPreviewJwt,
  signPreviewHeader,
  verifyPreviewCookie
} from './token';

export interface ActivePreview {
  targetPersonId: string;
  realAuthUserId: string;
  mode: PreviewMode;
  /** local mode: a token whose claim the dev-only hook honours. */
  jwt?: string;
  /** hosted mode: a signed proof the database re-derives for itself. */
  header?: string;
}

/**
 * The preview request for this HTTP request, or null. Re-decided from scratch
 * every time, server-side: runtime allowed -> REAL session -> real user is an
 * authorized developer-Admin -> cookie signature/expiry bound to that user.
 * Nothing from the browser other than that signed cookie is consulted, and the
 * cookie can only name a person - never roles or permissions.
 *
 * Because the whole chain is re-evaluated per request, dropping the developer
 * from DEV_USER_PREVIEW_ALLOWED_EMAILS or removing their Admin role ends any
 * preview already in flight on the very next request - no cookie to revoke.
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

    const base = {
      targetPersonId: verified.targetPersonId,
      realAuthUserId: session.authUserId,
      mode: runtime.mode
    };
    return runtime.mode === 'hosted'
      ? {
          ...base,
          header: signPreviewHeader(
            runtime.jwtSecret,
            session.authUserId,
            verified.targetPersonId
          )
        }
      : {
          ...base,
          jwt: mintPreviewJwt(
            runtime.jwtSecret,
            session.authUserId,
            verified.targetPersonId
          )
        };
  }
);
