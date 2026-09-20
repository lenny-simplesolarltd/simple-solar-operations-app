import 'server-only';

import { readOps } from '@/lib/backend/read';
import type { ReadResult } from '@/lib/backend/types';
import type { DocumentType, RevisionStatus } from '../types';

// Read models for the Documents card and the Operations view.
//
// Both go through the registry read path, so job visibility and roles are
// decided in the database and this file only names the shape.

export interface RevisionDetails {
  template_id: string;
  template_version: string;
  renderer_version: string;
  master_sha256: string;
  input_sha256: string | null;
  content_sha256: string | null;
  presale_id: string;
  source: string;
  claimed_at: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
}

export interface OmittedPage {
  page: number;
  reason: string;
}

export interface DocumentRevisionRead {
  revision_id: string;
  document_type: DocumentType;
  revision_number: number;
  status: RevisionStatus;
  generated_at: string | null;
  requested_at: string;
  evidence_id: string | null;
  filename: string | null;
  size_bytes: number | null;
  page_count: number | null;
  omitted_pages: OmittedPage[];
  error_code: string | null;
  error_detail: { message?: string; unresolved?: unknown[] } | null;
  attempt_count: number;
  next_attempt: string | null;
  details: RevisionDetails;
}

export interface JobDocumentRead {
  document_type: DocumentType;
  current: DocumentRevisionRead | null;
  history: DocumentRevisionRead[];
}

export interface JobDocumentsRead {
  job_id: string;
  job_reference: string;
  is_historical_import: boolean;
  has_presale: boolean;
  documents: JobDocumentRead[];
}

export interface DocumentOperationRow {
  revision_id: string;
  job_id: string;
  job_reference: string;
  customer: string;
  document_type: DocumentType;
  revision_number: number;
  status: RevisionStatus;
  attempt_count: number;
  next_attempt: string | null;
  claimed_at: string | null;
  requested_at: string;
  generated_at: string | null;
  error_code: string | null;
  error_detail: { message?: string } | null;
}

export interface DocumentOperationsRead {
  revisions: DocumentOperationRow[];
  counts: Partial<Record<RevisionStatus, number>>;
}

export function getJobDocuments(
  jobId: string
): Promise<ReadResult<JobDocumentsRead>> {
  return readOps<JobDocumentsRead>('JOB_DOCUMENTS', { job_id: jobId });
}

export function getDocumentOperations(): Promise<
  ReadResult<DocumentOperationsRead>
> {
  return readOps<DocumentOperationsRead>('DOCUMENT_OPERATIONS', {});
}
