'use server';

import { runCommand } from '@/lib/backend/command';
import { previewWriteBlock } from '@/lib/preview/guard';
import { revalidatePath } from 'next/cache';
import type { DocumentType } from '../types';
import { kickDocumentWorker } from './kick';

// Asking for a document, and starting it.
//
// Two steps, deliberately separate. The COMMAND queues a revision - audited,
// authorised, idempotent through the commands ledger, and instant. The WORKER
// then renders it. Kicking the worker inline means a person who presses
// Generate sees it start rather than waiting for a scheduler, but the queue
// row is already committed: if this process dies mid-render the stall sweep
// picks the work up, and nothing was lost.
//
// Nothing here decides whether generation is allowed. That is the command's
// job, and the worker's claim refuses anything the database will not release.

export interface GenerateResult {
  ok: boolean;
  message?: string;
  code?: string;
}

/**
 * Queue a generation and start it.
 *
 * `commandId` is minted by the caller when the button is rendered, so a double
 * click or a retried request is answered by the ledger instead of making a
 * second revision.
 */
export async function generateDocuments(
  commandId: string,
  jobId: string,
  documentType?: DocumentType
): Promise<GenerateResult> {
  const blocked = await previewWriteBlock();
  if (blocked)
    return { ok: false, message: blocked, code: 'PREVIEW_MODE_READ_ONLY' };

  const response = await runCommand({
    command_id: commandId,
    command_type: 'DOCUMENT_GENERATE',
    job_id: jobId,
    ...(documentType ? { payload: { document_type: documentType } } : {})
  });

  if (!response.ok) {
    return {
      ok: false,
      message: response.outcome.message,
      code: response.outcome.code
    };
  }

  // Start the work now. A failure to start is not a failure to queue: the row
  // is committed, so the person is told it is queued rather than told it broke.
  await kickDocumentWorker();

  revalidatePath(`/dashboard/jobs/${jobId}`);
  return { ok: true };
}

/** Retry a failed revision: a new attempt, which means a new revision. */
export async function retryDocument(
  commandId: string,
  jobId: string,
  documentType: DocumentType
): Promise<GenerateResult> {
  return generateDocuments(commandId, jobId, documentType);
}

export interface ComposeResult {
  ok: boolean;
  communicationId?: string;
  message?: string;
}

/**
 * Compose a customer email carrying one stored revision.
 *
 * The command does the work: it resolves the recipient, builds the default
 * subject and body, and captures the revision's evidence id as the
 * attachment. Nothing is sent - the draft goes to Communications, which owns
 * approval, dispatch and the audit of both.
 */
export async function composeDocumentEmail(
  commandId: string,
  jobId: string,
  revisionId: string,
  fields: { to: string; subject: string; body: string }
): Promise<ComposeResult> {
  const blocked = await previewWriteBlock();
  if (blocked) return { ok: false, message: blocked };

  const response = await runCommand({
    command_id: commandId,
    command_type: 'COMMUNICATION_COMPOSE',
    job_id: jobId,
    payload: {
      revision_id: revisionId,
      to: fields.to,
      subject: fields.subject,
      body: fields.body
    }
  });

  if (!response.ok) {
    return { ok: false, message: response.outcome.message };
  }
  const result = response.result as { communication_id?: string } | undefined;
  return { ok: true, communicationId: result?.communication_id };
}

/**
 * Poll for progress.
 *
 * The card re-reads while anything is in flight. This also nudges the worker,
 * so a revision left Queued by a process that died is picked up by whoever is
 * looking at the page rather than waiting for a scheduled sweep.
 */
export async function pokeDocumentWorker(): Promise<void> {
  if (await previewWriteBlock()) return;
  await kickDocumentWorker(3);
}
