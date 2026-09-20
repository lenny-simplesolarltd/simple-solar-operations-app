import 'server-only';

/**
 * Whether "View as user" may exist in this runtime. Fails closed: every
 * condition must hold. None of these is a NEXT_PUBLIC_* value, so none reaches
 * the browser or can be influenced from it.
 *
 * Two modes, with different database mechanisms (see `mode`):
 *
 *  - 'local'  - development against a LOCAL Supabase stack. The secret is the
 *               local stack's JWT secret, used to mint a short-lived token whose
 *               `preview_person_id` claim the dev-only hook honours. That hook
 *               is NOT a migration and never reaches hosted.
 *  - 'hosted' - the deployed app against hosted Supabase. Requires the extra,
 *               server-only DEV_USER_PREVIEW_ALLOW_PRODUCTION=true. The secret
 *               is a preview-only secret (NOT Supabase's JWT secret) shared with
 *               the database, which uses it to authenticate a signed request
 *               header. See supabase/migrations/*_dev_preview_hosted.sql.
 *
 * Without DEV_USER_PREVIEW_ALLOW_PRODUCTION, a production runtime or deployment
 * is refused exactly as before, and Supabase must still be a local stack.
 */
export type PreviewMode = 'local' | 'hosted';

export interface PreviewRuntime {
  allowed: boolean;
  reason: string | null;
  mode: PreviewMode;
  jwtSecret: string;
  allowedEmails: string[];
}

const LOCAL_SUPABASE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

/**
 * Strictly `'true'`. Absent, empty, malformed, '1', 'TRUE' or anything else is
 * not an opt-in: a typo must never be what enables production preview.
 */
const optedIn = (value: string | undefined) => value === 'true';

export function getPreviewRuntime(
  env: NodeJS.ProcessEnv = process.env
): PreviewRuntime {
  const jwtSecret = env.DEV_USER_PREVIEW_JWT_SECRET ?? '';
  const allowedEmails = (env.DEV_USER_PREVIEW_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const refuse = (reason: string): PreviewRuntime => ({
    allowed: false,
    reason,
    mode: 'local',
    jwtSecret: '',
    allowedEmails: []
  });

  // The ONLY door to production, and it is server-only. Both flags are needed:
  // DEV_USER_PREVIEW_ENABLED alone still refuses production, and
  // DEV_USER_PREVIEW_ALLOW_PRODUCTION alone enables nothing at all.
  const allowProduction = optedIn(env.DEV_USER_PREVIEW_ALLOW_PRODUCTION);
  const isProduction =
    env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';

  if (!optedIn(env.DEV_USER_PREVIEW_ENABLED))
    return refuse('DEV_USER_PREVIEW_ENABLED is not true');
  if (isProduction && !allowProduction)
    return refuse(
      'production runtime without DEV_USER_PREVIEW_ALLOW_PRODUCTION'
    );

  const local = LOCAL_SUPABASE.test(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  // Hosted Supabase is reachable only under the explicit production opt-in.
  if (!local && !allowProduction)
    return refuse('Supabase is not a local stack');
  const mode: PreviewMode = local ? 'local' : 'hosted';

  if (jwtSecret.length < 32)
    return refuse('DEV_USER_PREVIEW_JWT_SECRET is missing');
  if (allowedEmails.length === 0)
    return refuse('DEV_USER_PREVIEW_ALLOWED_EMAILS is empty');
  return { allowed: true, reason: null, mode, jwtSecret, allowedEmails };
}

/** Only named developers who are ALSO Admin may preview. Being Admin alone is not enough. */
export function mayStartPreview(
  runtime: PreviewRuntime,
  realUser: { email: string; roles: readonly string[] } | null
): boolean {
  if (!runtime.allowed || !realUser) return false;
  return (
    realUser.roles.includes('Admin') &&
    runtime.allowedEmails.includes(realUser.email.toLowerCase())
  );
}

export const PREVIEW_COOKIE = 'ss_dev_preview';

/**
 * Request header carrying the hosted-mode proof. The database re-derives its
 * HMAC with the secret it holds; a browser cannot forge one, and a captured one
 * is bound to the real user's auth id and expires in minutes.
 */
export const PREVIEW_HEADER = 'x-ss-dev-preview';

/** How long a started preview lasts before the developer must re-choose. */
export const PREVIEW_TTL_MS = {
  local: 8 * 60 * 60 * 1000,
  hosted: 30 * 60 * 1000
} as const satisfies Record<PreviewMode, number>;

export const PREVIEW_READ_ONLY_MESSAGE =
  'Preview mode is read-only. Return to your own account to make changes.';
