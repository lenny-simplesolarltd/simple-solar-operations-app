'use server';

import { previewWriteBlock } from '@/lib/preview/guard';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fieldSchema } from '../definition';
import { formsMessage } from '../errors';
import * as forms from './service';
import { submitPublicForm } from './public';

// Server actions for the Forms screens: thin wrappers over the Forms service,
// the same functions SimpleBot's tools call. Inputs are re-validated here
// (server actions are callable with any arguments); the database validates
// again and decides authorization. Each change carries a command id minted
// when the staff member started the action, so a retry is a replay.

const uuid = z.uuid();
const definition = z.strictObject({ fields: z.array(fieldSchema).max(100) });
const invalid = {
  ok: false as const,
  code: 'INVALID_REQUEST',
  message: formsMessage('UNEXPECTED')
};

const refreshed = <T extends { ok: boolean }>(outcome: T): T => {
  if (outcome.ok) revalidatePath('/dashboard/forms', 'layout');
  return outcome;
};

export async function createFormAction(
  input: {
    kind: 'form' | 'template';
    title: string;
    sourceTemplateId?: string;
    sourceFormId?: string;
    jobId?: string | null;
  },
  commandId: string
) {
  const parsed = z
    .strictObject({
      kind: z.enum(['form', 'template']),
      title: z.string().trim().min(1).max(200),
      sourceTemplateId: uuid.optional(),
      sourceFormId: uuid.optional(),
      jobId: uuid.nullable().optional()
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  return refreshed(await forms.createForm(parsed.data, commandId));
}

export async function saveDraftAction(
  formId: string,
  expectedVersion: number,
  draft: {
    title: string;
    description: string | null;
    definition: unknown;
    jobId?: string | null;
  },
  commandId: string
) {
  const parsed = z
    .strictObject({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(4000).nullable(),
      definition,
      jobId: uuid.nullable().optional()
    })
    .safeParse(draft);
  if (
    !parsed.success ||
    !uuid.safeParse(formId).success ||
    !uuid.safeParse(commandId).success
  ) {
    return invalid;
  }
  return refreshed(
    await forms.saveDraft(formId, expectedVersion, parsed.data, commandId)
  );
}

export async function publishFormAction(
  formId: string,
  expectedVersion: number,
  commandId: string
) {
  if (!uuid.safeParse(formId).success || !uuid.safeParse(commandId).success)
    return invalid;
  return refreshed(await forms.publishForm(formId, expectedVersion, commandId));
}

export async function setFormStatusAction(
  formId: string,
  status: forms.StatusChange,
  expectedVersion: number,
  commandId: string
) {
  const ok = z
    .enum(['closed', 'published', 'archived', 'restore', 'active'])
    .safeParse(status).success;
  if (
    !ok ||
    !uuid.safeParse(formId).success ||
    !uuid.safeParse(commandId).success
  )
    return invalid;
  return refreshed(
    await forms.setFormStatus(formId, status, expectedVersion, commandId)
  );
}

export async function createInvitationAction(
  input: forms.InvitationInput,
  commandId: string
) {
  const parsed = z
    .strictObject({
      formId: uuid,
      recipientType: z.enum(['customer', 'surveyor', 'other']),
      jobId: uuid.nullable().optional(),
      personId: uuid.nullable().optional(),
      recipientLabel: z.string().trim().max(200).nullable().optional(),
      expiresAt: z.iso.datetime().nullable().optional()
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const created = await forms.createInvitation(parsed.data, commandId);
  if (!created.ok) return created;
  revalidatePath('/dashboard/forms', 'layout');
  const link = await forms.invitationLink(created.result.invitation_id);
  return { ...created, url: link.ok ? link.result.url : null };
}

export async function revokeInvitationAction(
  invitationId: string,
  reason: string | null,
  commandId: string
) {
  if (
    !uuid.safeParse(invitationId).success ||
    !uuid.safeParse(commandId).success
  )
    return invalid;
  return refreshed(
    await forms.revokeInvitation(
      invitationId,
      reason?.trim() || null,
      commandId
    )
  );
}

export async function invitationLinkAction(invitationId: string) {
  if (!uuid.safeParse(invitationId).success) return invalid;
  return forms.invitationLink(invitationId);
}

export async function searchJobsAction(query: string) {
  return forms.searchJobs(String(query).slice(0, 40));
}

export async function listSurveyorsAction() {
  return forms.listSurveyors();
}

/**
 * The recipient page's submit. No staff session is needed or used - but a
 * developer who is previewing must not be able to write a real response either,
 * even holding a valid recipient token.
 */
export async function submitPublicFormAction(
  token: string,
  submissionId: string,
  answers: unknown
) {
  const blocked = await previewWriteBlock();
  if (blocked) {
    return { ok: false as const, state: 'open' as const, message: blocked };
  }
  if (
    typeof answers !== 'object' ||
    answers === null ||
    Array.isArray(answers)
  ) {
    return {
      ok: false as const,
      state: 'open' as const,
      message: formsMessage('FORMS_INVALID_ANSWER')
    };
  }
  return submitPublicForm(
    String(token),
    String(submissionId),
    answers as Record<string, never>
  );
}
