import {
  runEmailWorker,
  type RpcClient
} from '@/features/communications/server/email-worker';
import { createResendTransport } from '@/features/communications/server/resend-transport';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Drives one pass of the email worker.
 *
 *   POST /api/email-worker   Authorization: Bearer <EMAIL_WORKER_SECRET>
 *   GET  /api/email-worker   Authorization: Bearer <CRON_SECRET>
 *
 * Two doors because they have different callers. POST is for a person or an
 * external monitor. GET exists for Vercel Cron, which only issues GET and only
 * sends the CRON_SECRET it is given - it cannot be taught another verb or
 * another header, and an unscheduled worker means a queued email is never
 * sent, which is indistinguishable from the feature not working.
 *
 * Each door needs its own secret to be set, and neither falls back to the
 * other: an unset secret closes that door rather than opening it.
 *
 * The outbox RPCs are granted to service_role only, so this runs with the
 * service key and therefore has to be shut to everyone else: without the
 * secret set, it refuses rather than running unauthenticated.
 *
 * It cannot send anything the database has not already authorised. With the
 * gates as shipped, public.outbox_claim refuses and this returns
 * `refused: FN-03 must be Automated` - which is the system working.
 */
export async function POST(request: Request) {
  return run(request, process.env.EMAIL_WORKER_SECRET, 'EMAIL_WORKER_SECRET');
}

/** Vercel Cron: GET, with the project's CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  return run(request, process.env.CRON_SECRET, 'CRON_SECRET');
}

async function run(
  request: Request,
  secret: string | undefined,
  secretName: string
) {
  if (!secret)
    return Response.json(
      {
        error: `${secretName} is not set; this worker endpoint is closed`
      },
      { status: 503 }
    );
  if (!authorized(request, secret))
    return Response.json({ error: 'unauthorized' }, { status: 401 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey)
    return Response.json(
      { error: 'RESEND_API_KEY is not set' },
      { status: 503 }
    );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return Response.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY must be set on the server' },
      { status: 503 }
    );

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  }) as unknown as RpcClient;

  const report = await runEmailWorker({
    client,
    transport: createResendTransport(apiKey)
  });

  // 200 even when rows need a person: the run itself succeeded, and the
  // scheduler should not retry a batch that is already recorded.
  return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
}

/** Constant-time compare, so the secret cannot be guessed a byte at a time. */
function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
