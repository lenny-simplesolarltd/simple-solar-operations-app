// Shapes for the communications screen. Safe to import from client components
// (no server code here).
//
// A communication is an outbound message the system CAPTURED. Capturing is not
// sending: app.mat_capture and app.scf_communication write a Draft and stop.
// Three commands move it on, and only one of them involves the system sending
// anything at all:
//
//   COMMUNICATION_APPROVE      Draft -> Approved. A named person takes
//                              responsibility for the content. Sends nothing.
//   COMMUNICATION_QUEUE        Approved -> Queued, plus one outbox row. Refused
//                              unless the type's function (FN-03 / FN-04) is
//                              Automated. Still sends nothing: a worker does
//                              that, and only when every gate is open.
//   COMMUNICATION_RECORD_SENT  A person sent it from their own mailbox. Records
//                              the fact, creates no outbox row, claims no
//                              delivery.
//
// FN-18 and FN-20 are recorded as Manual on purpose, so their messages are
// never dispatchable and RECORD_SENT is their only route. That is a decision,
// not a gap.

export type CommunicationStatus =
  | 'Draft'
  | 'Approved'
  | 'Queued'
  | 'Sent'
  | 'Uncertain'
  | 'Failed';

export const COMMUNICATION_STATUSES: CommunicationStatus[] = [
  'Draft',
  'Approved',
  'Queued',
  'Sent',
  'Uncertain',
  'Failed'
];

/** One row of the COMMUNICATIONS list read. */
export interface CommunicationRow {
  id: string;
  jobId: string | null;
  companyId: string | null;
  type: string;
  subject: string;
  status: CommunicationStatus;
  revision: number;
  version: number;
  approvedAt: string | null;
  approvedBy: string | null;
  sentAt: string | null;
  /** 'manual:<ref>' when a person recorded the send themselves. */
  externalMessageId: string | null;
  outboxId: string | null;
  outboxStatus: string | null;
  outboxSummary: string | null;
  /** False when the type has no action_type: a person sends it, the system records it. */
  dispatchable: boolean;
  actionType: string | null;
  functionId: string | null;
  createdAt: string | null;
}

/** A recipient list the database parsed out of recipients_snapshot. */
export interface CommunicationRecipients {
  ok: boolean;
  code: string | null;
  detail: string | null;
  to: string[];
}

export interface CommunicationJobLink {
  jobId: string | null;
  orderId: string | null;
  scaffoldBookingId: string | null;
  entityRevision: number | null;
}

export interface CommunicationAcknowledgement {
  id: string;
  response: string;
  responseText: string | null;
  acknowledgedRevision: number | null;
  receivedAt: string | null;
  recordedBy: string | null;
}

/** The COMMUNICATION detail read: one message, everything attached to it. */
export interface CommunicationDetail extends CommunicationRow {
  body: string | null;
  attachmentIds: string[];
  recipients: CommunicationRecipients;
  /** sha256 of the approved content. Queueing refuses if the body changed after approval. */
  payloadHash: string | null;
  jobs: CommunicationJobLink[];
  acknowledgements: CommunicationAcknowledgement[];
  outbox: {
    id: string;
    status: string;
    attemptCount: number | null;
    nextAttempt: string | null;
    responseSummary: string | null;
    externalId: string | null;
  } | null;
}

export interface CommunicationsList {
  jobId: string | null;
  status: CommunicationStatus | null;
  communications: CommunicationRow[];
  retrievedAt: string | null;
}
