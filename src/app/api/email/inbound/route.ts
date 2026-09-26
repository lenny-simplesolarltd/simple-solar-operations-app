import { verifySvixSignature } from '@/features/communications/server/svix-signature';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Resend's email.received webhook.
 *
 *   POST /api/email/inbound   svix-id / svix-timestamp / svix-signature
 *
 * Google Workspace still owns operations@ and still delivers to it; it also
 * forwards a copy to a receiving subdomain whose MX points at Resend, which
 * calls this. See 20260926260000 for why it cannot be done any other way -
 * MX is per domain, so receiving operations@ AT Resend would mean taking the
 * whole company's mail off Google.
 *
 * The webhook body carries metadata only, so the message itself is fetched
 * from Resend before anything is stored: a row with a subject and no body
 * would look like a received email and be useless as evidence.
 *
 * Failure semantics are Svix's: a non-2xx is retried with backoff, so a
 * transient fetch failure returns 500 and is redelivered, while anything that
 * cannot improve on a retry (a bad signature, an event we do not handle)
 * returns 2xx or 4xx and is dropped. Recording is idempotent on the provider's
 * message id, so a redelivery cannot duplicate a message.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret)
    return Response.json(
      { error: 'RESEND_WEBHOOK_SECRET is not set; this endpoint is closed' },
      { status: 503 }
    );

  // The raw bytes. Parsing and re-serialising would change them and the
  // signature would never verify.
  const rawBody = await request.text();
  const check = verifySvixSignature({
    secret,
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
    rawBody
  });
  if (!check.ok) return Response.json({ error: check.reason }, { status: 401 });

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'body is not JSON' }, { status: 400 });
  }

  // Other event types may be pointed here by mistake. Accept and ignore, so
  // Svix stops retrying something we will never handle.
  if (event.type !== 'email.received')
    return Response.json({ ignored: event.type ?? 'unknown' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!url || !serviceKey || !apiKey)
    return Response.json(
      { error: 'the server is not configured to receive email' },
      { status: 503 }
    );

  const data = event.data ?? {};
  const messageId = String(data.email_id ?? data.id ?? '');
  if (!messageId)
    return Response.json(
      { error: 'no message id on the event' },
      { status: 400 }
    );

  const full = await fetchReceived(messageId, apiKey);
  // Retryable: the message exists, we just could not read it this time.
  if (!full.ok) return Response.json({ error: full.reason }, { status: 500 });

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: result, error } = await supabase.rpc('inbound_email_record', {
    p: full.message
  });
  if (error) {
    console.error('inbound email could not be recorded', error);
    return Response.json({ error: 'could not record' }, { status: 500 });
  }
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

/** The full message, in the shape app.inbound_email_record expects. */
async function fetchReceived(
  id: string,
  apiKey: string
): Promise<
  { ok: true; message: Record<string, unknown> } | { ok: false; reason: string }
> {
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com/emails/receiving/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000)
    });
  } catch (cause) {
    return { ok: false, reason: `could not reach Resend: ${String(cause)}` };
  }
  if (!response.ok)
    return { ok: false, reason: `Resend returned ${response.status}` };

  const m = (await response.json()) as Record<string, unknown>;
  const from = m.from as
    | string
    | { address?: string; name?: string }
    | undefined;
  const addressOf = (v: unknown): string =>
    typeof v === 'string'
      ? // "Name <a@b.c>" and a bare address are both possible.
        (v.match(/<([^>]+)>/)?.[1] ?? v).trim()
      : String((v as { address?: string })?.address ?? '');

  return {
    ok: true,
    message: {
      provider_message_id: id,
      from_address: addressOf(from),
      from_name:
        typeof from === 'string'
          ? (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? null)
          : ((from as { name?: string })?.name ?? null),
      to_addresses: Array.isArray(m.to) ? m.to.map(addressOf) : [],
      subject: m.subject ?? null,
      text_body: m.text ?? null,
      html_body: m.html ?? null,
      headers: m.headers ?? {},
      attachment_count: Array.isArray(m.attachments) ? m.attachments.length : 0,
      received_at: m.created_at ?? new Date().toISOString()
    }
  };
}
