import {
  fetchInbox,
  type InboundMessage
} from '@/features/communications/server/gmail-inbox';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reads the office mailbox and records what arrived.
 *
 *   POST /api/email/inbox   Authorization: Bearer <EMAIL_INBOX_SECRET>
 *   GET  /api/email/inbox   Authorization: Bearer <CRON_SECRET>
 *
 * Two doors, for the same reason /api/email-worker has two: Vercel Cron only
 * issues GET and only sends CRON_SECRET, and a mailbox nobody polls is a
 * mailbox whose replies never arrive - which looks exactly like the feature
 * not working. Each door needs its own secret set; an unset secret closes that
 * door rather than opening it.
 *
 * Nothing here decides anything. Threading, idempotency and who may read the
 * result are all in app.inbound_email_record and its RLS policy, so a second
 * ingestion path could never thread a reply differently.
 */
export async function POST(request: Request) {
  return run(request, process.env.EMAIL_INBOX_SECRET, 'EMAIL_INBOX_SECRET');
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
      { error: `${secretName} is not set; this endpoint is closed` },
      { status: 503 }
    );
  if (!authorized(request, secret))
    return Response.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken)
    return Response.json(
      {
        error:
          'the office mailbox is not authorised yet: set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REFRESH_TOKEN'
      },
      { status: 503 }
    );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return Response.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY must be set on the server' },
      { status: 503 }
    );

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // The address the system sends FROM is the one whose own mail is not
  // "received". Read rather than assumed, so it follows the setting.
  const { data: setting } = await supabase
    .from('settings')
    .select('typed_value')
    .eq('key', 'email.from_mailbox')
    .eq('scope', 'Global')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ownAddress =
    typeof setting?.typed_value === 'string' ? setting.typed_value : null;

  let messages: InboundMessage[];
  try {
    messages = await fetchInbox({
      credentials: { clientId, clientSecret, refreshToken },
      excludeFrom: ownAddress
    });
  } catch (cause) {
    // Retryable: the scheduler will come back. A refused refresh token is the
    // one that needs a person, and it says so.
    return Response.json({ error: String(cause) }, { status: 502 });
  }

  let recorded = 0;
  let alreadyKnown = 0;
  const problems: string[] = [];
  for (const message of messages) {
    const { data, error } = await supabase.rpc('inbound_email_record', {
      p: message
    });
    if (error) {
      problems.push(`${message.provider_message_id}: ${error.message}`);
      continue;
    }
    if ((data as { already_recorded?: boolean })?.already_recorded)
      alreadyKnown += 1;
    else recorded += 1;
  }

  // 200 with a report, like the email worker: the run succeeded even when an
  // individual message did not, and a scheduler must not retry the batch.
  return Response.json(
    { seen: messages.length, recorded, alreadyKnown, problems },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Constant-time compare, so the secret cannot be guessed a byte at a time. */
function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
