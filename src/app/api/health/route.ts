import {
  buildLiveness,
  type PingResult
} from '@/features/system/operational-health';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 5000;

/**
 * Liveness for an external monitor (nothing in this repo polls it - see
 * docs/OPERATIONAL_HEALTH.md). Unauthenticated on purpose, so it answers only:
 * is the app up, did the database answer, and the coarse state of each
 * operational check. No names, references or details.
 *
 *   GET /api/health           200 when app + database respond, else 503
 *   GET /api/health?strict=1  200 only when every check is Verified
 */
export async function GET(request: Request) {
  const strict = new URL(request.url).searchParams.get('strict') === '1';
  const ping = await pingDatabase();
  const { status, body } = buildLiveness(ping, { strict, now: new Date() });
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

async function pingDatabase(): Promise<PingResult> {
  try {
    const { url, anonKey } = getSupabaseEnv();
    // Anonymous on purpose: the monitor has no session, and public.health_ping
    // is the only thing anon may call.
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await supabase
      .rpc('health_ping')
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) {
      return error.code === 'PGRST202' || error.code === '42883'
        ? { kind: 'not_deployed' }
        : { kind: 'error' };
    }
    return { kind: 'ok', data };
  } catch {
    return { kind: 'error' };
  }
}
