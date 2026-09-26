'use server';

import { runCommand } from '@/lib/backend/command';
import type { CommandResponse } from '@/lib/backend/types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * Ad-hoc email: the wording people save, and the messages they send.
 *
 * Every one of these validates its arguments here and forwards to a command.
 * The database decides: FN-24, the sending mailbox, whether a placeholder
 * resolved. Nothing in this file is the authority on any of it.
 */

const uuid = z.uuid();
const invalid = {
  ok: false as const,
  outcome: {
    status: 'Failed' as const,
    heading: 'COULD NOT COMPLETE',
    message: 'Something about that request was not valid. Nothing was changed.'
  }
};

const refresh = () => {
  revalidatePath('/dashboard/communications', 'layout');
};

const recipientSchema = z.strictObject({
  name: z.string().trim().max(200).nullish(),
  email: z.email().max(320)
});

/**
 * Writes and sends one email from the office mailbox.
 *
 * There is no approval step: the person composing it is the approver, which is
 * the owner's decision and is why the command creates the row already
 * Approved. The worker is driven straight after, so "Send" means now rather
 * than whenever the sweep next runs - the same fault the reports button had.
 */
export async function sendAdhocEmailAction(
  input: {
    recipients: { name?: string | null; email: string }[];
    subject: string;
    body: string;
    jobId?: string;
    customerId?: string;
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      recipients: z.array(recipientSchema).min(1).max(50),
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20000),
      jobId: uuid.optional(),
      customerId: uuid.optional()
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const d = parsed.data;

  const response = await runCommand({
    command_id: commandId,
    command_type: 'ADHOC_EMAIL_SEND',
    payload: {
      recipients: d.recipients.map((r) => ({
        name: r.name?.trim() || null,
        email: r.email.trim().toLowerCase()
      })),
      subject: d.subject,
      body: d.body,
      ...(d.jobId ? { job_id: d.jobId } : {}),
      ...(d.customerId ? { customer_id: d.customerId } : {})
    }
  });
  if (!response.ok) return response;

  // Queued is not sent. Drive the worker for this one type so the screen can
  // say which happened, rather than reporting a hope as a fact.
  const built = response.result as { status?: string } | null;
  if (built?.status !== 'Queued') {
    refresh();
    return response;
  }
  const { sendQueuedNow } = await import('./send-now');
  const delivery = await sendQueuedNow('EmailAdhoc');
  refresh();
  return { ...response, result: { ...response.result, delivery } };
}

/** Creates or updates one saved template. */
export async function setEmailTemplateAction(
  input: {
    id?: string;
    name: string;
    subject: string;
    body: string;
    description?: string | null;
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      id: uuid.optional(),
      name: z.string().trim().min(1).max(120),
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20000),
      description: z.string().trim().max(500).nullish()
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const d = parsed.data;

  const response = await runCommand({
    command_id: commandId,
    command_type: 'EMAIL_TEMPLATE_SET',
    payload: {
      ...(d.id ? { id: d.id } : {}),
      name: d.name,
      subject: d.subject,
      body: d.body,
      ...(d.description ? { description: d.description } : {})
    }
  });
  if (response.ok) refresh();
  return response;
}

/**
 * Removes a saved template. Nothing cascades: an email already sent from this
 * wording keeps its own copy of the text, because it is a record of something
 * that happened.
 */
export async function deleteEmailTemplateAction(
  input: { id: string },
  commandId: string
): Promise<CommandResponse> {
  if (!uuid.safeParse(input?.id).success || !uuid.safeParse(commandId).success)
    return invalid;

  const response = await runCommand({
    command_id: commandId,
    command_type: 'EMAIL_TEMPLATE_DELETE',
    payload: { id: input.id }
  });
  if (response.ok) refresh();
  return response;
}
