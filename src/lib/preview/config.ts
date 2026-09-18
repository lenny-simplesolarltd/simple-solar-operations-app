import 'server-only';

/**
 * Whether "View as user" may exist in this runtime. Fails closed: every
 * condition must hold. None of these is a NEXT_PUBLIC_* value, so none reaches
 * the browser or can be influenced from it.
 *
 *  - not a production runtime (`next build && next start`, Vercel => refused)
 *  - DEV_USER_PREVIEW_ENABLED=true
 *  - the app is pointed at a LOCAL Supabase stack (the only place the database
 *    hook is ever installed - it is not a migration)
 *  - the local stack's JWT secret is available to mint preview tokens
 */
export interface PreviewRuntime {
  allowed: boolean;
  reason: string | null;
  jwtSecret: string;
  allowedEmails: string[];
}

const LOCAL_SUPABASE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

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
    jwtSecret: '',
    allowedEmails: []
  });

  if (env.NODE_ENV === 'production') return refuse('production runtime');
  if (env.VERCEL_ENV === 'production') return refuse('production deployment');
  if (env.DEV_USER_PREVIEW_ENABLED !== 'true')
    return refuse('DEV_USER_PREVIEW_ENABLED is not true');
  if (!LOCAL_SUPABASE.test(env.NEXT_PUBLIC_SUPABASE_URL ?? ''))
    return refuse('Supabase is not a local stack');
  if (jwtSecret.length < 32)
    return refuse('DEV_USER_PREVIEW_JWT_SECRET is missing');
  if (allowedEmails.length === 0)
    return refuse('DEV_USER_PREVIEW_ALLOWED_EMAILS is empty');
  return { allowed: true, reason: null, jwtSecret, allowedEmails };
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
export const PREVIEW_READ_ONLY_MESSAGE =
  'Preview mode is read-only. Return to your own account to make changes.';
