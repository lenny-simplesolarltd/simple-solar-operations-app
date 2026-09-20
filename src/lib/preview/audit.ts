import 'server-only';

import { headers } from 'next/headers';
import type { PreviewMode } from './config';

export interface PreviewEvent {
  action: 'start' | 'end' | 'refused';
  /** The REAL developer. Always recorded - preview never hides who acted. */
  realPersonId: string | null;
  realAuthUserId: string | null;
  realEmail: string | null;
  previewPersonId: string | null;
  mode: PreviewMode;
  /** Why a start was refused. Never contains a secret or a token. */
  reason?: string;
}

/**
 * Structured, server-side record of preview start/end, written to the platform
 * log (Vercel runtime logs / log drain) rather than to the application's audit
 * trail. That separation is deliberate: `audit_events` records changes to
 * business data, and a preview never changes any - so no audit event may imply
 * the previewed person did something.
 *
 * Never logs the preview cookie, the proof header or the signing secret; the
 * identifiers recorded are exactly what an investigation needs to answer
 * "who looked at whose screens, from where, and when".
 */
export async function logPreviewEvent(event: PreviewEvent): Promise<void> {
  const h = await headers();
  // eslint-disable-next-line no-console -- the platform log IS the record here
  console.info(
    JSON.stringify({
      event: 'dev_user_preview',
      at: new Date().toISOString(),
      ...event,
      requestIp: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent') ?? null
    })
  );
}
