import 'server-only';

import { readOps } from '@/lib/backend/read';
import type { ReadResult } from '@/lib/backend/types';
import type {
  CommunicationAcknowledgement,
  CommunicationDetail,
  CommunicationJobLink,
  CommunicationRecipients,
  CommunicationRow,
  CommunicationStatus,
  CommunicationsList
} from './types';

// Reads for the communications screen. Both go through
// public.execute_operations_read, which resolves the signed-in person and
// applies the same role list the communications_select RLS policy uses
// (app.is_office_class()). Nothing here decides who may see what.

type Json = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const bool = (v: unknown): boolean => v === true;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function toRow(raw: Json): CommunicationRow {
  return {
    id: String(raw.communication_id ?? raw.id),
    jobId: str(raw.job_id),
    companyId: str(raw.company_id),
    type: str(raw.type) ?? 'Message',
    subject: str(raw.subject) ?? '(no subject)',
    status: (str(raw.status) ?? 'Draft') as CommunicationStatus,
    revision: num(raw.revision) ?? 1,
    version: num(raw.version) ?? 1,
    approvedAt: str(raw.approved_at),
    approvedBy: str(raw.approved_by),
    sentAt: str(raw.sent_at),
    externalMessageId: str(raw.external_message_id),
    outboxId: str(raw.outbox_id),
    outboxStatus: str(raw.outbox_status),
    outboxSummary: str(raw.outbox_summary),
    dispatchable: bool(raw.dispatchable),
    actionType: str(raw.action_type),
    functionId: str(raw.function_id),
    createdAt: str(raw.created_at)
  };
}

function toRecipients(raw: unknown): CommunicationRecipients {
  const r = (raw ?? {}) as Json;
  return {
    ok: bool(r.ok),
    code: str(r.code),
    detail: str(r.detail),
    to: strings(r.to)
  };
}

/**
 * Captured and sent messages, newest first. Both filters are optional; the
 * database caps the page at 200 and defaults to 50.
 */
export async function listCommunications(params: {
  jobId?: string;
  status?: CommunicationStatus;
  limit?: number;
}): Promise<ReadResult<CommunicationsList>> {
  const result = await readOps<Json>('COMMUNICATIONS', {
    job_id: params.jobId,
    status: params.status,
    limit: params.limit
  });
  if (!result.ok) return result;
  const data = result.data ?? {};
  const rows = Array.isArray(data.communications) ? data.communications : [];
  return {
    ok: true,
    data: {
      jobId: str(data.job_id),
      status: str(data.status) as CommunicationStatus | null,
      communications: rows.map((r) => toRow(r as Json)),
      retrievedAt: str(data.retrieved_at)
    }
  };
}

/** One message with its jobs, acknowledgements, recipients and outbox row. */
export async function getCommunication(
  communicationId: string
): Promise<ReadResult<CommunicationDetail>> {
  const result = await readOps<Json>('COMMUNICATION', {
    communication_id: communicationId
  });
  if (!result.ok) return result;
  const data = result.data ?? {};
  const comm = (data.communication ?? {}) as Json;
  const outbox = data.outbox as Json | null | undefined;

  // The detail read returns the row itself rather than the list's flattened
  // shape, so the shared fields are rebuilt here from the same column names.
  const base = toRow({
    ...comm,
    communication_id: comm.id,
    dispatchable: data.dispatchable,
    action_type: data.action_type,
    function_id: data.function_id,
    outbox_status: outbox?.status,
    outbox_summary: outbox?.response_summary
  });

  const jobs = (Array.isArray(data.jobs) ? data.jobs : []).map((j) => {
    const raw = j as Json;
    return {
      jobId: str(raw.job_id),
      orderId: str(raw.order_id),
      scaffoldBookingId: str(raw.scaffold_booking_id),
      entityRevision: num(raw.entity_revision)
    } satisfies CommunicationJobLink;
  });

  const acknowledgements = (
    Array.isArray(data.acknowledgements) ? data.acknowledgements : []
  ).map((a) => {
    const raw = a as Json;
    return {
      id: String(raw.acknowledgement_id),
      response: str(raw.response) ?? 'Unknown',
      responseText: str(raw.response_text),
      acknowledgedRevision: num(raw.acknowledged_revision),
      receivedAt: str(raw.received_at),
      recordedBy: str(raw.recorded_by)
    } satisfies CommunicationAcknowledgement;
  });

  return {
    ok: true,
    data: {
      ...base,
      body: str(comm.body_snapshot),
      attachmentIds: strings(comm.attachment_ids),
      recipients: toRecipients(data.recipients),
      payloadHash: str(data.payload_hash),
      jobs,
      acknowledgements,
      outbox: outbox
        ? {
            id: String(outbox.id),
            status: str(outbox.status) ?? 'Pending',
            attemptCount: num(outbox.attempt_count),
            nextAttempt: str(outbox.next_attempt),
            responseSummary: str(outbox.response_summary),
            externalId: str(outbox.external_id)
          }
        : null
    }
  };
}
