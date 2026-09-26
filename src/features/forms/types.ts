// Read-model shapes shared by the Forms screens, the service and SimpleBot's
// tools. Safe to import anywhere.
import type { FormDefinition } from './definition';

export type FormKind = 'form' | 'template';
export type FormStatus =
  | 'draft'
  | 'published'
  | 'closed'
  | 'archived'
  | 'active';

/** A recipient link's state. There is no "opened" state: nothing reliably records one. */
export type FormLinkStatus =
  | 'ready'
  | 'submitted'
  | 'revoked'
  | 'expired'
  | 'closed';
export type RecipientType = 'customer' | 'surveyor' | 'other';

export interface FormSummary {
  id: string;
  kind: FormKind;
  title: string;
  description: string | null;
  status: FormStatus;
  /** Current published revision number; 0 = never published. */
  revision: number;
  questionCount: number;
  hasUnpublishedChanges: boolean;
  jobId: string | null;
  jobRef: string | null;
  sourceTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic concurrency: send back as expected_version. */
  version: number;
}

export interface FormDetail extends FormSummary {
  definition: FormDefinition;
  currentRevisionId: string | null;
  /**
   * Whether the PUBLISHED version could be sent as a recipient link.
   *
   * A recipient has no account, so they can own no upload and search no
   * table: a form carrying a photo or lookup question can only be completed
   * by somebody signed in. The database refuses such a link, and this is the
   * same fact read ahead of time so the screen can say so before you try.
   *
   * Judged on the CURRENT REVISION, never the draft: an unpublished edit that
   * removes the photo question does not make the live version sendable.
   * null when nothing is published, so there is no link to create anyway.
   */
  linkable: boolean | null;
  revisions: {
    id: string;
    number: number;
    publishedAt: string;
    publishedBy: string | null;
  }[];
}

export interface FormRevision {
  id: string;
  formId: string;
  number: number;
  title: string;
  description: string | null;
  definition: FormDefinition;
  publishedAt: string;
}

export interface InvitationSummary {
  id: string;
  formId: string;
  formTitle: string;
  revisionId: string;
  revision: number;
  recipientType: RecipientType;
  recipientName: string;
  jobId: string | null;
  jobRef: string | null;
  status: FormLinkStatus;
  expiresAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  /** Null when not submitted, or when the reader cannot see responses. */
  submissionId: string | null;
  version: number;
}

export interface ResponseDetail {
  id: string;
  answers: Record<string, unknown>;
  submittedAt: string;
  /** The exact revision that was answered - never today's draft. */
  revision: FormRevision;
  invitation: InvitationSummary;
}

export const STATUS_LABEL: Record<FormStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  closed: 'Closed',
  archived: 'Archived',
  active: 'Active'
};

export const LINK_STATUS_LABEL: Record<FormLinkStatus, string> = {
  ready: 'Ready to send',
  submitted: 'Submitted',
  revoked: 'Revoked',
  expired: 'Expired',
  closed: 'Form closed'
};

export const RECIPIENT_LABEL: Record<RecipientType, string> = {
  customer: 'Customer',
  surveyor: 'Surveyor',
  other: 'Other'
};
