import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { runEmailWorker, type RpcClient } from './email-worker';
import { createResendTransport } from './resend-transport';

/**
 * Drive the email worker for one action type, immediately.
 *
 * "Send now" queued a report and then waited for a scheduled worker, which on
 * the current plan runs once a day. A button that says Send now and means
 * "some time in the next 24 hours" is simply wrong, and no amount of accurate
 * wording elsewhere fixes it.
 *
 * Deliberately NARROW: it claims only the type it was asked for. Draining the
 * whole outbox because somebody pressed Send now on a report would put
 * merchant and scaffolder email on the wire that nobody chose to send.
 *
 * Every gate still decides. This opens nothing - it only stops the queue
 * waiting for a clock. If the server has no service key or no transport
 * credentials the report stays queued, which is what used to happen anyway,
 * so the button degrades rather than failing.
 */
export async function sendQueuedNow(
  actionType: string
): Promise<{ sent: number; failed: number; reason?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!url || !serviceKey)
    return { sent: 0, failed: 0, reason: 'this server cannot send email yet' };
  if (!apiKey)
    return { sent: 0, failed: 0, reason: 'no email provider is configured' };

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  }) as unknown as RpcClient;

  try {
    const report = await runEmailWorker({
      client,
      transport: createResendTransport(apiKey),
      actionTypes: [actionType],
      limit: 5
    });
    if (report.refused)
      // A shut gate reads as a refusal rather than a fault: the report is
      // queued and truthfully says so.
      return {
        sent: report.sent,
        failed: report.failed,
        reason: report.refused
      };
    if (report.sent === 0 && report.claimed === 0)
      return {
        sent: 0,
        failed: report.failed,
        reason: 'nothing was waiting to be sent'
      };
    return { sent: report.sent, failed: report.failed };
  } catch (err) {
    // The report is queued; the scheduled worker will try again. Never let a
    // transport problem turn a successful queue into a failed command.
    //
    // The real message travels with it. A generic "could not be attempted"
    // leaves the only evidence in a log nobody reads, and this is staff-facing
    // - the person who pressed the button is the person who can act on it.
    return {
      sent: 0,
      failed: 0,
      reason:
        err instanceof Error && err.message
          ? err.message
          : 'the send could not be attempted'
    };
  }
}
