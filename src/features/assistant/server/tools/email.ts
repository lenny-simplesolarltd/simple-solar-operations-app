import 'server-only';

import {
  sendAdhocEmailAction,
  setEmailTemplateAction
} from '@/features/communications/server/actions';
import { getEmailTemplates } from '@/features/communications/server/templates';
import {
  groupRoleFor,
  listPeopleInRole,
  listReportPeople
} from '@/features/programmes/server/recipients';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ReadTool
} from '../registry';

/**
 * SimpleBot writing email from the office mailbox.
 *
 * "Email the scaffolder and tell them Tuesday is off" is a real errand, and
 * this is an adapter over the SAME command the Communications screen uses -
 * ADHOC_EMAIL_SEND. There is no SimpleBot-side sending path: FN-24, the
 * sending mailbox and every gate between composed and delivered are untouched,
 * and a person still confirms the card before a byte moves.
 *
 * Three rules the model cannot talk its way past:
 *
 *   * A name is never an address. "Email Dan" resolves through People, and an
 *     ambiguous or unknown name is a question for the person, not a guess.
 *   * The preview shows the FULL text that will be sent, not a summary of it.
 *     A confirmation card that paraphrases what is about to reach a customer
 *     is asking somebody to approve something they have not read.
 *   * Placeholders are resolved by the DATABASE at send time, against a job or
 *     customer. The model never fills one in from memory - that is how a
 *     plausible wrong name reaches a real customer.
 */

const DOMAIN = 'communications' as const;
const uuid = z.uuid();

const ENFORCED =
  'communication.send in ADHOC_EMAIL_SEND and communication.template.manage in EMAIL_TEMPLATE_SET (execute_command), plus FN-24 and RLS on email_templates';

const fail = (code: string, message: string) =>
  ({ ok: false, code, message }) as const;

/** Names to addresses, the same way the reporting tools do it. */
async function resolveRecipients(
  wanted: string[]
): Promise<
  | { ok: true; recipients: { name: string | null; email: string }[] }
  | { ok: false; problem: string }
> {
  const out: { name: string | null; email: string }[] = [];
  const seen = new Set<string>();
  const add = (r: { name: string | null; email: string }) => {
    if (seen.has(r.email)) return;
    seen.add(r.email);
    out.push(r);
  };

  for (const raw of wanted) {
    const value = raw.trim();
    if (!value) continue;

    if (value.includes('@')) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
        return { ok: false, problem: `"${value}" is not an email address.` };
      add({ name: null, email: value.toLowerCase() });
      continue;
    }

    const role = groupRoleFor(value);
    if (role) {
      const { people } = await listPeopleInRole(role);
      if (people.length === 0)
        return { ok: false, problem: `Nobody in "${value}" has an address.` };
      for (const p of people)
        add({ name: p.displayName ?? null, email: p.email.toLowerCase() });
      continue;
    }

    const { people } = await listReportPeople(value);
    const needle = value.toLowerCase();
    const matches = people.filter((p) =>
      (p.displayName ?? '').toLowerCase().includes(needle)
    );
    if (matches.length === 0)
      return {
        ok: false,
        problem: `I could not find anybody called "${value}". Give me their email address.`
      };
    if (matches.length > 1)
      return {
        ok: false,
        // Naming them is the difference between a question and a guess.
        problem: `"${value}" matches ${matches.map((m) => m.displayName).join(', ')}. Which one?`
      };
    add({
      name: matches[0].displayName ?? null,
      email: matches[0].email.toLowerCase()
    });
  }

  if (out.length === 0)
    return { ok: false, problem: 'There is nobody to send this to.' };
  return { ok: true, recipients: out };
}

interface SendInput {
  to: string[];
  subject: string;
  body: string;
  job_id?: string;
  customer_id?: string;
}

export const emailSendTool: MutationTool<SendInput> = {
  name: 'email_send',
  summary: 'Propose writing and sending an email from the office mailbox',
  description:
    'Write an email and send it from the office mailbox, recorded in Communications like every other message. Use for "email the scaffolder and tell them...". Recipients may be email addresses or the names of colleagues; a name that matches nobody, or more than one person, is a question rather than a guess. To personalise it, put {{customer_name}}, {{job_ref}} and the like in the text and name a job or customer - the database fills them in at send time and REFUSES to send if it cannot. Never write a customer name into the text yourself. Nothing is sent by this until a person confirms the card.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    to: z
      .array(z.string().trim().min(1).max(320))
      .min(1)
      .max(50)
      .describe('Email addresses, or the names of colleagues to look up'),
    subject: z.string().trim().min(1).max(300),
    body: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .describe(
        'The full message. May contain {{merge_field}} placeholders, which the database fills in.'
      ),
    job_id: uuid
      .optional()
      .describe('Name a job so job and customer placeholders can be filled'),
    customer_id: uuid
      .optional()
      .describe('Name a customer so customer placeholders can be filled')
  }),
  authorization: {
    permissions: ['communication.send'],
    enforcedBy: ENFORCED
  },

  async prepare(input) {
    const context = await getEmailTemplates();
    if (!context)
      return fail(
        'EMAIL_NOT_AVAILABLE',
        'You do not have permission to send email from this system.'
      );
    if (!context.sendingMailbox)
      return fail(
        'EMAIL_NO_SENDER',
        'No sending mailbox is configured, so nothing can be sent yet.'
      );

    const resolved = await resolveRecipients(input.to);
    if (!resolved.ok)
      return fail('EMAIL_RECIPIENT_UNRESOLVED', resolved.problem);

    // Placeholders the database will not be able to fill: better to say so on
    // the card than to have the send refused after somebody pressed Confirm.
    const used = Array.from(
      `${input.subject} ${input.body}`.matchAll(
        /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g
      ),
      (m) => m[1]
    );
    const named = { job: !!input.job_id, customer: !!input.customer_id };
    const unfillable = Array.from(new Set(used)).filter((key) => {
      const field = context.mergeFields.find((f) => f.key === key);
      if (!field) return true;
      if (field.needs === 'job') return !named.job;
      if (field.needs === 'customer') return !named.customer && !named.job;
      return false;
    });
    if (unfillable.length > 0)
      return fail(
        'EMAIL_MERGE_UNRESOLVED',
        `Nothing can be sent while ${unfillable.map((f) => `{{${f}}}`).join(', ')} cannot be filled in. Name a job or customer, or take the placeholder out.`
      );

    const preview: ActionPreview = {
      title: 'Send an email',
      summary: `Email ${resolved.recipients.length} ${resolved.recipients.length === 1 ? 'person' : 'people'} from ${context.sendingMailbox}.`,
      changes: [
        { label: 'From', to: context.sendingMailbox },
        {
          label: 'To',
          to: resolved.recipients
            .map((r) => (r.name ? `${r.name} (${r.email})` : r.email))
            .join(', ')
        },
        { label: 'Subject', to: input.subject },
        // The whole message, verbatim. A card that summarised it would be
        // asking for approval of something nobody had read.
        { label: 'Message', to: input.body }
      ],
      warnings: [
        'This sends as soon as you confirm. There is no draft step.',
        ...(context.canSend
          ? []
          : [
              'Sending is switched off (FN-24), so this will be saved rather than sent.'
            ])
      ],
      confirmLabel: 'Send it',
      // Nothing existing is being changed, so there is no version to be stale.
      expectedVersion: null
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    // Re-resolved on the way out: the directory could have changed between the
    // proposal and the confirmation.
    const resolved = await resolveRecipients(input.to);
    if (!resolved.ok)
      return fail('EMAIL_RECIPIENT_UNRESOLVED', resolved.problem);

    const response = await sendAdhocEmailAction(
      {
        recipients: resolved.recipients,
        subject: input.subject,
        body: input.body,
        ...(input.job_id ? { jobId: input.job_id } : {}),
        ...(input.customer_id ? { customerId: input.customer_id } : {})
      },
      ctx.commandId
    );
    if (!response.ok)
      return fail(
        response.outcome.code ?? 'EMAIL_SEND_FAILED',
        response.outcome.message
      );

    const result = response.result as {
      status?: string;
      detail?: string;
      delivery?: { sent: number; failed: number; reason?: string };
    };
    const sent = (result.delivery?.sent ?? 0) > 0;
    return {
      ok: true,
      data: {
        sent,
        recipients: resolved.recipients.length,
        // Queued is not sent, and the card must not imply otherwise.
        note: sent
          ? 'Sent.'
          : `Saved but not sent: ${result.delivery?.reason ?? result.detail ?? 'it is on the Communications screen, not yet away'}.`
      }
    };
  }
};

export const emailTemplatesTool: ReadTool<Record<string, never>> = {
  name: 'email_templates',
  summary: 'List the saved email wording and the fields it can fill in',
  description:
    'The saved email templates, and the {{merge_field}} placeholders any email may use. Read this before writing an email so you use wording that already exists rather than inventing it, and so you only use placeholders that can actually be filled.',
  domain: DOMAIN,
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({}),
  authorization: {
    permissions: ['communication.send'],
    enforcedBy:
      'communication.send in EMAIL_TEMPLATES (execute_operations_read)'
  },
  async execute() {
    const data = await getEmailTemplates();
    if (!data)
      return fail(
        'EMAIL_NOT_AVAILABLE',
        'You do not have permission to see email templates.'
      );
    return {
      ok: true,
      data: {
        sendingMailbox: data.sendingMailbox,
        sendingEnabled: data.canSend,
        templates: data.templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          subject: t.subject,
          body: t.body
        })),
        mergeFields: data.mergeFields
      }
    };
  }
};

interface TemplateInput {
  name: string;
  subject: string;
  body: string;
  description?: string;
}

export const emailTemplateSetTool: MutationTool<TemplateInput> = {
  name: 'email_template_set',
  summary: 'Propose saving a reusable email template',
  description:
    'Save wording so it can be reused. Use when somebody asks to keep an email for next time. Placeholders must be real merge fields - read email_templates first. Saving a template sends nothing.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    name: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20000),
    description: z.string().trim().max(500).optional()
  }),
  authorization: {
    permissions: ['communication.template.manage'],
    enforcedBy: ENFORCED
  },

  async prepare(input) {
    const preview: ActionPreview = {
      title: 'Save an email template',
      summary: `Keep "${input.name}" so it can be used again.`,
      changes: [
        { label: 'Name', to: input.name },
        ...(input.description
          ? [{ label: 'What it is for', to: input.description }]
          : []),
        { label: 'Subject', to: input.subject },
        { label: 'Message', to: input.body }
      ],
      warnings: ['A template sends nothing by itself.'],
      confirmLabel: 'Save it',
      expectedVersion: null
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const response = await setEmailTemplateAction(
      {
        name: input.name,
        subject: input.subject,
        body: input.body,
        ...(input.description ? { description: input.description } : {})
      },
      ctx.commandId
    );
    if (!response.ok)
      return fail(
        response.outcome.code ?? 'EMAIL_TEMPLATE_FAILED',
        response.outcome.message
      );
    return { ok: true, data: { saved: true } };
  }
};

export const EMAIL_READ_TOOLS = [emailTemplatesTool];
export const EMAIL_MUTATION_TOOLS = [emailSendTool, emailTemplateSetTool];
