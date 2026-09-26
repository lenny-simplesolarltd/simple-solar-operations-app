import 'server-only';

import { createDataClient } from '@/lib/supabase/data';
import type { EmailTemplates, InboundEmail } from '../types';

/**
 * The saved wording, and the placeholders it may use.
 *
 * One read rather than two: the compose screen needs both together, and a
 * template listing its own fields separately would let the two drift - a
 * template could offer {{install_date}} while the resolver knew nothing of it.
 *
 * A refusal (no communication.send) is "nothing to show", not a crash: the
 * screen renders empty and the nav never offered it in the first place.
 */
export async function getEmailTemplates(): Promise<EmailTemplates | null> {
  const supabase = await createDataClient();
  const { data, error } = await supabase.rpc('execute_operations_read', {
    p_request: { read_type: 'EMAIL_TEMPLATES', payload: {} }
  });
  if (error) {
    if (error.code === 'P0001') return null;
    throw new Error(`EMAIL_TEMPLATES: ${error.message}`);
  }
  return (data as { data: EmailTemplates } | null)?.data ?? null;
}

/**
 * Email received at the office mailbox, newest first.
 *
 * Read under RLS: only somebody who may send email may read what came back.
 * Returns an empty list rather than throwing when the table is not deployed
 * yet, so the screen degrades to "nothing here" instead of a crash.
 */
export async function getInboundEmails(limit = 100): Promise<InboundEmail[]> {
  // inbound_emails is absent from src/types/database.ts because `npm run
  // db:types` cannot run in this environment (see features/programmes/server/
  // db.ts for the whole story). Narrowed to the columns this read uses rather
  // than cast to any, and deleted the moment the generator works again.
  const supabase = (await createDataClient()) as unknown as {
    from(table: 'inbound_emails'): {
      select(columns: string): {
        order(
          column: string,
          options: { ascending: boolean }
        ): {
          limit(n: number): Promise<{
            data: Record<string, unknown>[] | null;
            error: unknown;
          }>;
        };
      };
    };
  };
  const { data, error } = await supabase
    .from('inbound_emails')
    .select(
      'id, from_address, from_name, subject, text_body, received_at, communication_id, matched_by, handled_at, attachment_count'
    )
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    fromAddress: r.from_address as string,
    fromName: (r.from_name as string | null) ?? null,
    subject: (r.subject as string | null) ?? null,
    preview: ((r.text_body as string | null) ?? '').slice(0, 300),
    receivedAt: r.received_at as string,
    communicationId: (r.communication_id as string | null) ?? null,
    matchedBy: (r.matched_by as InboundEmail['matchedBy']) ?? 'None',
    handledAt: (r.handled_at as string | null) ?? null,
    attachmentCount: (r.attachment_count as number | null) ?? 0
  }));
}
