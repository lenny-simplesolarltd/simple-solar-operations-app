'use server';

import { getSessionState } from '@/lib/auth';
import { logPreviewEvent } from '@/lib/preview/audit';
import {
  PREVIEW_COOKIE,
  PREVIEW_TTL_MS,
  getPreviewRuntime,
  mayStartPreview
} from '@/lib/preview/config';
import { signPreviewCookie } from '@/lib/preview/token';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

export interface PreviewActionResult {
  ok: boolean;
  message?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The browser may only ASK to preview a person id. Everything else is decided
 * here: runtime allowed, REAL session, authorized developer-Admin, target exists
 * and is active with a role (read from the database as the real user). The
 * cookie it sets names the person only; roles/permissions are never stored.
 */
export async function startPreview(
  targetPersonId: string
): Promise<PreviewActionResult> {
  const runtime = getPreviewRuntime();
  if (!runtime.allowed)
    return {
      ok: false,
      message: 'Preview mode is not available in this environment.'
    };

  const session = await getSessionState();
  if (session.status !== 'signed-in')
    return { ok: false, message: 'Sign in first.' };
  if (!mayStartPreview(runtime, session.user)) {
    await logPreviewEvent({
      action: 'refused',
      realPersonId: null,
      realAuthUserId: session.authUserId,
      realEmail: session.user.email,
      previewPersonId: null,
      mode: runtime.mode,
      reason: 'not an allow-listed Admin developer'
    });
    return {
      ok: false,
      message: 'Your account is not allowed to use preview mode.'
    };
  }
  if (!UUID.test(targetPersonId) || targetPersonId === session.user.id) {
    return { ok: false, message: 'Choose another member of staff to preview.' };
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from('people')
    .select('id, active, person_roles!person_roles_person_id_fkey(active)')
    .eq('id', targetPersonId)
    .maybeSingle();
  if (!target || !target.active || !target.person_roles.some((r) => r.active)) {
    return {
      ok: false,
      message: 'That person is not an active member of staff with a role.'
    };
  }

  (await cookies()).set(
    PREVIEW_COOKIE,
    signPreviewCookie(
      runtime.jwtSecret,
      session.authUserId,
      target.id,
      Date.now() + PREVIEW_TTL_MS[runtime.mode]
    ),
    {
      httpOnly: true,
      sameSite: 'lax',
      // Hosted preview is served over HTTPS only; local development is
      // http://localhost, where Secure would stop the cookie being stored.
      secure: runtime.mode === 'hosted',
      path: '/',
      maxAge: PREVIEW_TTL_MS[runtime.mode] / 1000
    }
  );
  await logPreviewEvent({
    action: 'start',
    realPersonId: session.user.id,
    realAuthUserId: session.authUserId,
    realEmail: session.user.email,
    previewPersonId: target.id,
    mode: runtime.mode
  });
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Always available, and never blocked by the read-only guard: returning to your
 * own account must not depend on anything except deleting the cookie.
 */
export async function endPreview(): Promise<PreviewActionResult> {
  const cookieStore = await cookies();
  const wasPreviewing = Boolean(cookieStore.get(PREVIEW_COOKIE));
  cookieStore.delete(PREVIEW_COOKIE);
  if (wasPreviewing) {
    const session = await getSessionState();
    await logPreviewEvent({
      action: 'end',
      realPersonId: session.status === 'signed-in' ? session.user.id : null,
      realAuthUserId:
        session.status === 'signed-in' ? session.authUserId : null,
      realEmail: session.status === 'signed-in' ? session.user.email : null,
      previewPersonId: null,
      mode: getPreviewRuntime().mode
    });
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
