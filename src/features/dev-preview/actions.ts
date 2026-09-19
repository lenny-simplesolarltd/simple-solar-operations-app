'use server';

import { getSessionState } from '@/lib/auth';
import {
  PREVIEW_COOKIE,
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
const EIGHT_HOURS = 8 * 60 * 60 * 1000;

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
      Date.now() + EIGHT_HOURS
    ),
    { httpOnly: true, sameSite: 'lax', secure: false, path: '/' } // session cookie; http://localhost only
  );
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function endPreview(): Promise<PreviewActionResult> {
  (await cookies()).delete(PREVIEW_COOKIE);
  revalidatePath('/', 'layout');
  return { ok: true };
}
