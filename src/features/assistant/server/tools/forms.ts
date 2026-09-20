import 'server-only';

import {
  applyOperations,
  draftOperationSchema,
  EMPTY_DEFINITION,
  FIELD_TYPE_INFO,
  fieldInputSchema,
  isInputType,
  questionCount,
  type DraftOperation,
  type FormDefinition,
  type FormField
} from '@/features/forms/definition';
import { formsMessage } from '@/features/forms/errors';
import * as forms from '@/features/forms/server/service';
import type {
  FormDetail,
  FormSummary,
  InvitationSummary
} from '@/features/forms/types';
import { LINK_STATUS_LABEL, RECIPIENT_LABEL } from '@/features/forms/types';
import { z } from 'zod';
import type { FormCardData, FormLinkCardData } from '../../protocol';
import type {
  ActionPreview,
  MutationTool,
  ReadTool,
  ToolResult
} from '../registry';

/**
 * SimpleBot's Forms tools. They are adapters over the Forms service - the
 * same functions the manual builder calls - so there is one set of rules.
 * Reads run under RLS as the staff member; every change is prepared (no
 * writes), confirmed by the staff member, then executed as a Forms command
 * whose command_id is the confirmed action's id (a retried confirmation is a
 * replay, never a second form or link). The model never receives a link or
 * token, and response answers that are contact details are withheld from it.
 */

const ENFORCED =
  'forms.* permissions in the Forms commands (execute_command) and RLS on the forms tables';
const uuid = z.uuid();

// -- Shaping --------------------------------------------------------------------------

export const formCard = (f: FormSummary): FormCardData => ({
  id: f.id,
  kind: f.kind,
  title: f.title,
  status: f.status,
  revision: f.revision,
  questionCount: f.questionCount,
  hasUnpublishedChanges: f.hasUnpublishedChanges,
  jobRef: f.jobRef
});

const linkCard = (l: InvitationSummary): FormLinkCardData => ({
  invitationId: l.id,
  formId: l.formId,
  formTitle: l.formTitle,
  recipient: `${RECIPIENT_LABEL[l.recipientType]}: ${l.recipientName}`,
  jobRef: l.jobRef,
  revision: l.revision,
  status: l.status,
  expiresAt: l.expiresAt,
  submissionId: l.submissionId
});

const questionForModel = (f: FormField) => ({
  id: f.id,
  type: f.type,
  label: f.label,
  ...(f.required !== undefined && { required: f.required }),
  ...(f.help && { help: f.help }),
  ...(f.options && {
    options: f.options.map((o) => ({ id: o.id, label: o.label }))
  }),
  ...(f.min !== undefined && { min: f.min }),
  ...(f.max !== undefined && { max: f.max }),
  ...(f.condition && { shown_when: f.condition })
});

const formForModel = (f: FormDetail) => ({
  form_id: f.id,
  kind: f.kind,
  title: f.title,
  description: f.description,
  status: f.status,
  published_version: f.revision || null,
  draft_has_unpublished_changes:
    f.kind === 'form' ? f.hasUnpublishedChanges : undefined,
  job_ref: f.jobRef,
  record_version: f.version,
  questions: f.definition.fields.map(questionForModel),
  read_at: new Date().toISOString()
});

const fail = (code: string, message = formsMessage(code)): ToolResult => ({
  ok: false,
  code,
  message
});
const refuse = (code: string, message = formsMessage(code)) => ({
  ok: false as const,
  code,
  message
});

async function formResult(formId: string, note?: string): Promise<ToolResult> {
  const form = await forms.getForm(formId);
  if (!form) return fail('FORMS_NOT_FOUND');
  return {
    ok: true,
    data: formForModel(form),
    display: { kind: 'form', form: formCard(form), ...(note && { note }) }
  };
}

const describeField = (f: {
  type: string;
  label: string;
  required?: boolean;
}) =>
  `${f.label} — ${FIELD_TYPE_INFO[f.type as keyof typeof FIELD_TYPE_INFO]?.label ?? f.type}${f.required ? ', required' : ''}`;

// -- Reads ----------------------------------------------------------------------------

export const listFormsTool: ReadTool<{
  kind?: 'form' | 'template';
  include_archived?: boolean;
}> = {
  name: 'list_forms',
  summary: 'List forms or templates',
  description:
    'List the forms (default) or templates the staff member can see, most recently changed first, with status, published version and question count. Use it to find a form id from a title.',
  domain: 'forms',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    kind: z.enum(['form', 'template']).optional(),
    include_archived: z.boolean().optional()
  }),
  authorization: { permissions: ['forms.read'], enforcedBy: ENFORCED },
  async execute({ kind = 'form', include_archived }) {
    const current = await forms.listForms({ kind });
    const all = include_archived
      ? [...current, ...(await forms.listForms({ kind, archived: true }))]
      : current;
    return {
      ok: true,
      data: {
        kind,
        total: all.length,
        forms: all.slice(0, 50).map((f) => ({
          form_id: f.id,
          title: f.title,
          status: f.status,
          published_version: f.revision || null,
          questions: f.questionCount,
          job_ref: f.jobRef
        }))
      },
      display: {
        kind: 'form_list',
        title: kind === 'template' ? 'Templates' : 'Forms',
        forms: all.slice(0, 20).map(formCard),
        total: all.length
      }
    };
  }
};

export const getFormTool: ReadTool<{ form_id: string }> = {
  name: 'get_form',
  summary: 'Read a form or template and its questions',
  description:
    'Read one form or template as it is NOW: title, status, published version, record version and every question with its id, type, options and conditions. Always call this before proposing edits, and use the question ids it returns.',
  domain: 'forms',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ form_id: uuid }),
  authorization: { permissions: ['forms.read'], enforcedBy: ENFORCED },
  async execute({ form_id }) {
    return formResult(form_id);
  }
};

export const listFormResponsesTool: ReadTool<{
  form_id?: string;
  status?: string;
}> = {
  name: 'list_form_responses',
  summary: 'List recipient links and whether they have been answered',
  description:
    'List recipient links (optionally for one form) with recipient, job, version, status (ready to send, submitted, expired, revoked, form closed) and dates. Does not include answers.',
  domain: 'forms',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    form_id: uuid.optional(),
    status: z
      .enum(['ready', 'submitted', 'expired', 'revoked', 'closed'])
      .optional()
  }),
  authorization: { permissions: ['forms.read'], enforcedBy: ENFORCED },
  async execute({ form_id, status }) {
    const links = await forms.listInvitations({
      formId: form_id,
      status: status as InvitationSummary['status']
    });
    return {
      ok: true,
      data: {
        total: links.length,
        links: links.slice(0, 50).map((l) => ({
          invitation_id: l.id,
          form_id: l.formId,
          form: l.formTitle,
          recipient: `${RECIPIENT_LABEL[l.recipientType]}: ${l.recipientName}`,
          job_ref: l.jobRef,
          version: l.revision,
          status: LINK_STATUS_LABEL[l.status],
          submitted_at: l.submittedAt,
          submission_id: l.submissionId
        }))
      },
      display: {
        kind: 'form_links',
        title: 'Recipient links',
        links: links.slice(0, 20).map(linkCard),
        total: links.length
      }
    };
  }
};

const WITHHELD = new Set(['email', 'phone', 'address']);

export const getFormResponseTool: ReadTool<{ submission_id: string }> = {
  name: 'get_form_response',
  summary: 'Read one submitted response',
  description:
    'Read the answers of ONE submitted response, interpreted with the exact version that was answered. Only call this when the staff member asks about that response. Contact details (email, phone, address answers) are withheld from you; say they can be seen in the app.',
  domain: 'forms',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ submission_id: uuid }),
  authorization: {
    permissions: ['forms.responses.read'],
    enforcedBy: ENFORCED
  },
  async execute({ submission_id }) {
    const response = await forms.getResponse(submission_id);
    if (!response)
      return fail(
        'FORMS_NOT_FOUND',
        'No response with that id is visible to the signed-in staff member.'
      );
    const { revision, invitation } = response;
    return {
      ok: true,
      data: {
        submission_id: response.id,
        form: revision.title,
        answered_version: revision.number,
        recipient: `${RECIPIENT_LABEL[invitation.recipientType]}: ${invitation.recipientName}`,
        job_ref: invitation.jobRef,
        submitted_at: response.submittedAt,
        answers: revision.definition.fields
          .filter((f) => isInputType(f.type))
          .map((f) => ({
            question: f.label,
            answer: WITHHELD.has(f.type)
              ? response.answers[f.id] === undefined
                ? null
                : '(contact detail - shown in the app only)'
              : (response.answers[f.id] ?? null)
          }))
      },
      display: {
        kind: 'form_links',
        title: 'Response',
        links: [linkCard(invitation)],
        total: 1
      }
    };
  }
};

// -- Mutations ------------------------------------------------------------------------

const createInput = z.strictObject({
  kind: z
    .enum(['form', 'template'])
    .default('form')
    .describe('"template" creates a reusable template'),
  title: z.string().trim().min(1).max(200),
  description: z
    .string()
    .max(4000)
    .optional()
    .describe('Instructions shown to the recipient'),
  template_id: uuid
    .optional()
    .describe('Start from this template (copies its questions)'),
  fields: z
    .array(fieldInputSchema)
    .max(40)
    .optional()
    .describe('Questions, in order (ignored when template_id is given)'),
  job_ref: z
    .string()
    .trim()
    .max(20)
    .optional()
    .describe('Link the form to this job reference, e.g. SS-ABCD-1234')
});

export const createFormTool: MutationTool<z.infer<typeof createInput>> = {
  name: 'create_form',
  summary: 'Create a draft form or template',
  description:
    'Prepare a new DRAFT form (or template): from a list of questions, or as a copy of a template. The staff member sees a confirmation card; nothing is created until they confirm. Afterwards they can preview and edit it in Forms.',
  domain: 'forms',
  kind: 'mutation',
  status: 'available',
  inputSchema: createInput,
  authorization: { permissions: ['forms.create'], enforcedBy: ENFORCED },
  async prepare(input, ctx) {
    if (
      input.kind === 'template' &&
      !ctx.actor.permissions.has('forms.templates.manage')
    ) {
      return refuse('FORMS_PERMISSION_DENIED');
    }
    let definition: FormDefinition = EMPTY_DEFINITION;
    const changes: ActionPreview['changes'] = [];
    if (input.template_id) {
      const template = await forms.getForm(input.template_id);
      if (!template || template.kind !== 'template')
        return refuse('FORMS_SOURCE_NOT_TEMPLATE');
      definition = template.definition;
      changes.push({
        label: 'Copied from',
        to: `Template "${template.title}"`
      });
    } else if (input.fields?.length) {
      const built = applyOperations(
        {
          title: input.title,
          description: input.description ?? null,
          definition: EMPTY_DEFINITION
        },
        input.fields.map(
          (field) => ({ op: 'add_field', field }) as DraftOperation
        )
      );
      if (!built.ok) return refuse('FORMS_INVALID_DEFINITION', built.problem);
      definition = built.state.definition;
    }
    if (input.job_ref) {
      if (input.kind === 'template') return refuse('FORMS_TEMPLATE_NO_JOB');
      if (!(await forms.jobByRef(input.job_ref)))
        return refuse('FORMS_JOB_NOT_FOUND');
      changes.push({ label: 'Job', to: input.job_ref.toUpperCase() });
    }
    definition.fields.forEach((f, i) =>
      changes.push({ label: `Question ${i + 1}`, to: describeField(f) })
    );
    return {
      ok: true,
      preview: {
        title: `Create ${input.kind === 'template' ? 'template' : 'form'} "${input.title}"`,
        summary: `A new draft ${input.kind} with ${questionCount(definition)} questions. Nobody receives anything: it stays a draft until it is published and a link is created.`,
        changes,
        warnings: [],
        confirmLabel: `Create ${input.kind}`,
        expectedVersion: null
      }
    };
  },
  async execute(input, ctx) {
    let definition: FormDefinition | undefined;
    if (!input.template_id && input.fields?.length) {
      const built = applyOperations(
        {
          title: input.title,
          description: input.description ?? null,
          definition: EMPTY_DEFINITION
        },
        input.fields.map(
          (field) => ({ op: 'add_field', field }) as DraftOperation
        )
      );
      if (!built.ok) return fail('FORMS_INVALID_DEFINITION', built.problem);
      definition = built.state.definition;
    }
    const job = input.job_ref ? await forms.jobByRef(input.job_ref) : null;
    if (input.job_ref && !job) return fail('FORMS_JOB_NOT_FOUND');
    const created = await forms.createForm(
      {
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        definition,
        sourceTemplateId: input.template_id,
        jobId: job?.id ?? null
      },
      ctx.commandId
    );
    if (!created.ok) return fail(created.code, created.message);
    return formResult(created.result.form_id, 'Created as a draft.');
  }
};

const editInput = z.strictObject({
  form_id: uuid,
  operations: z.array(draftOperationSchema).min(1).max(30)
});

export const editFormDraftTool: MutationTool<z.infer<typeof editInput>> = {
  name: 'edit_form_draft',
  summary: "Change a form's or template's draft",
  description:
    'Prepare changes to the DRAFT of a form or template: set the title or description, add, update, remove or move questions (by the ids get_form returns; positions are 1-based). Published versions and links already sent are never changed - publish again to use the new draft. Call get_form first.',
  domain: 'forms',
  kind: 'mutation',
  status: 'available',
  inputSchema: editInput,
  authorization: { permissions: ['forms.edit'], enforcedBy: ENFORCED },
  async prepare({ form_id, operations }, ctx) {
    const form = await forms.getForm(form_id);
    if (!form) return refuse('FORMS_NOT_FOUND');
    if (
      form.kind === 'template' &&
      !ctx.actor.permissions.has('forms.templates.manage')
    ) {
      return refuse('FORMS_PERMISSION_DENIED');
    }
    if (form.status === 'archived') return refuse('FORMS_ARCHIVED');
    const applied = applyOperations(
      {
        title: form.title,
        description: form.description,
        definition: form.definition
      },
      operations
    );
    if (!applied.ok) return refuse('FORMS_INVALID_DEFINITION', applied.problem);
    const before = new Map(form.definition.fields.map((f) => [f.id, f]));
    const changes: ActionPreview['changes'] = [];
    if (applied.state.title !== form.title)
      changes.push({
        label: 'Title',
        from: form.title,
        to: applied.state.title
      });
    if (applied.state.description !== form.description)
      changes.push({
        label: 'Instructions',
        to: applied.state.description ?? '(none)'
      });
    for (const op of operations) {
      if (op.op === 'add_field')
        changes.push({ label: 'Add question', to: describeField(op.field) });
      if (op.op === 'remove_field')
        changes.push({
          label: 'Remove question',
          from: before.get(op.field_id)?.label,
          to: '(removed)'
        });
      if (op.op === 'move_field')
        changes.push({
          label: 'Move question',
          from: before.get(op.field_id)?.label,
          to: `to position ${op.position}`
        });
      if (op.op === 'update_field') {
        const after = applied.state.definition.fields.find(
          (f) => f.id === op.field_id
        );
        const old = before.get(op.field_id);
        if (old && after)
          changes.push({
            label: `Change "${old.label}"`,
            from: describeField(old),
            to: describeField(after)
          });
      }
    }
    return {
      ok: true,
      preview: {
        title: `Edit the draft of "${form.title}"`,
        summary: `${questionCount(applied.state.definition)} questions after this change. ${form.kind === 'form' && form.revision > 0 ? `Version ${form.revision} and any links already created stay exactly as they are until the form is published again.` : 'This only changes the draft.'}`,
        changes,
        warnings: [],
        confirmLabel: 'Save draft',
        expectedVersion: form.version
      }
    };
  },
  async execute({ form_id, operations }, ctx) {
    const saved = await forms.editDraft(
      form_id,
      operations,
      ctx.commandId,
      ctx.expectedVersion
    );
    if (!saved.ok) return fail(saved.code, saved.message);
    return formResult(form_id, 'Draft updated.');
  }
};

export const publishFormTool: MutationTool<{ form_id: string }> = {
  name: 'publish_form',
  summary: 'Publish a form draft as a new version',
  description:
    'Prepare publishing the current draft as the next version. Links already created keep the version they were made with; new links use this one.',
  domain: 'forms',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({ form_id: uuid }),
  authorization: { permissions: ['forms.publish'], enforcedBy: ENFORCED },
  async prepare({ form_id }) {
    const form = await forms.getForm(form_id);
    if (!form) return refuse('FORMS_NOT_FOUND');
    if (form.kind === 'template')
      return refuse('FORMS_TEMPLATE_NOT_PUBLISHABLE');
    if (!['draft', 'published'].includes(form.status))
      return refuse('FORMS_NOT_PUBLISHABLE_STATUS');
    if (questionCount(form.definition) === 0)
      return refuse('FORMS_NO_QUESTIONS');
    if (form.revision > 0 && !form.hasUnpublishedChanges)
      return refuse('FORMS_NO_CHANGES');
    return {
      ok: true,
      preview: {
        title: `Publish "${form.title}" as version ${form.revision + 1}`,
        summary: `${questionCount(form.definition)} questions. New links will use version ${form.revision + 1}.`,
        changes: [
          {
            label: 'Published version',
            from: form.revision ? `v${form.revision}` : 'none',
            to: `v${form.revision + 1}`
          }
        ],
        warnings: form.revision
          ? [`Links already created keep version ${form.revision}.`]
          : [],
        confirmLabel: 'Publish',
        expectedVersion: form.version
      }
    };
  },
  async execute({ form_id }, ctx) {
    if (ctx.expectedVersion == null) return fail('FORMS_STALE_VERSION');
    const published = await forms.publishForm(
      form_id,
      ctx.expectedVersion,
      ctx.commandId
    );
    if (!published.ok) return fail(published.code, published.message);
    return formResult(
      form_id,
      `Published as version ${published.result.revision}.`
    );
  }
};

export const saveFormAsTemplateTool: MutationTool<{
  form_id: string;
  title?: string;
}> = {
  name: 'save_form_as_template',
  summary: 'Save a form (or copy a template) as a new template',
  description:
    "Prepare a new template copied from a form's current draft, or a duplicate of a template. The copy is independent: later edits to either never change the other.",
  domain: 'forms',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    form_id: uuid,
    title: z.string().trim().min(1).max(200).optional()
  }),
  authorization: {
    permissions: ['forms.templates.manage'],
    enforcedBy: ENFORCED
  },
  async prepare({ form_id, title }) {
    const form = await forms.getForm(form_id);
    if (!form) return refuse('FORMS_NOT_FOUND');
    const name =
      title ?? (form.kind === 'template' ? `${form.title} (copy)` : form.title);
    return {
      ok: true,
      preview: {
        title: `Save template "${name}"`,
        summary: `A reusable template with the ${questionCount(form.definition)} questions of "${form.title}".`,
        changes: [
          {
            label: 'Copied from',
            to: `${form.kind === 'template' ? 'Template' : 'Form'} "${form.title}"`
          }
        ],
        warnings: [],
        confirmLabel: 'Save template',
        expectedVersion: null
      }
    };
  },
  async execute({ form_id, title }, ctx) {
    const form = await forms.getForm(form_id);
    if (!form) return fail('FORMS_NOT_FOUND');
    const created = await forms.createForm(
      {
        kind: 'template',
        title:
          title ??
          (form.kind === 'template' ? `${form.title} (copy)` : form.title),
        ...(form.kind === 'template'
          ? { sourceTemplateId: form.id }
          : { sourceFormId: form.id })
      },
      ctx.commandId
    );
    if (!created.ok) return fail(created.code, created.message);
    return formResult(created.result.form_id, 'Template saved.');
  }
};

/**
 * When nobody says who a link is for.
 *
 * public.form_invitations requires an "other" link to carry a label, so a link
 * that is simply asked for still has to say something. This records the truth -
 * that no recipient was named - rather than inventing one, and the link works
 * exactly the same either way.
 */
const UNSPECIFIED_RECIPIENT = 'Not specified';

const linkInput = z.strictObject({
  form_id: uuid,
  recipient: z
    .enum(['customer', 'surveyor', 'other'])
    .default('other')
    .describe(
      'Who the link is for. Leave it out when the staff member just asks for a link: that makes an unattributed link they can share themselves.'
    ),
  job_ref: z
    .string()
    .trim()
    .max(20)
    .optional()
    .describe('Required for a customer: the customer of this job'),
  surveyor_name: z.string().trim().max(100).optional(),
  recipient_name: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      `For "other". Leave it out when nobody was named; it is recorded as "${UNSPECIFIED_RECIPIENT}".`
    ),
  expires_in_days: z
    .number()
    .int()
    .min(0)
    .max(365)
    .optional()
    .describe('0 = never; default 30')
});

/** The label an "other" link is filed under, named or not. */
function otherLabel(input: z.infer<typeof linkInput>) {
  return input.recipient_name?.trim() || UNSPECIFIED_RECIPIENT;
}

async function resolveRecipient(input: z.infer<typeof linkInput>) {
  const job = input.job_ref ? await forms.jobByRef(input.job_ref) : null;
  if (input.job_ref && !job) return refuse('FORMS_JOB_NOT_FOUND');
  if (input.recipient === 'customer' && !job)
    return refuse('FORMS_CUSTOMER_NEEDS_JOB');
  let person: { id: string; name: string } | null = null;
  if (input.recipient === 'surveyor') {
    const wanted = input.surveyor_name?.toLowerCase() ?? '';
    const matches = (await forms.listSurveyors()).filter(
      (s) => wanted && s.name.toLowerCase().includes(wanted)
    );
    if (matches.length !== 1) {
      return refuse(
        'FORMS_SURVEYOR_NOT_FOUND',
        matches.length > 1
          ? `More than one surveyor matches "${input.surveyor_name}". Ask which one.`
          : formsMessage('FORMS_SURVEYOR_NOT_FOUND')
      );
    }
    person = matches[0];
  }
  // An unnamed "other" link is allowed: otherLabel() files it under
  // UNSPECIFIED_RECIPIENT, which satisfies the table's own rule without anyone
  // having to be asked who it is for.
  return { ok: true as const, job, person };
}

export const createFormLinkTool: MutationTool<z.infer<typeof linkInput>> = {
  name: 'create_form_link',
  summary: 'Create a secure recipient link for a published form',
  description:
    'Prepare a one-recipient link to the current published version of a form. When the staff member just asks for a link, create one straight away with the defaults - unattributed, expiring in 30 days - and do not ask who it is for. Only tie it to a customer (by job reference) or a surveyor (by name) when they say so. SimpleBot cannot email or text it: after confirmation the staff member copies the link from the card. You never see the link itself.',
  domain: 'forms',
  kind: 'mutation',
  status: 'available',
  inputSchema: linkInput,
  authorization: { permissions: ['forms.send'], enforcedBy: ENFORCED },
  async prepare(input) {
    const form = await forms.getForm(input.form_id);
    if (!form) return refuse('FORMS_NOT_FOUND');
    if (form.kind === 'template') return refuse('FORMS_TEMPLATE_NOT_SENDABLE');
    if (form.status !== 'published') return refuse('FORMS_NOT_PUBLISHED');
    const who = await resolveRecipient(input);
    if (!who.ok) return who;
    const days = input.expires_in_days ?? 30;
    return {
      ok: true,
      preview: {
        title: `Create a link to "${form.title}"`,
        summary:
          'A secure link for one recipient. It is not sent anywhere: you copy it and share it yourself.',
        changes: [
          { label: 'Form', to: `${form.title} (version ${form.revision})` },
          {
            label: 'Recipient',
            to:
              input.recipient === 'customer'
                ? `Customer on ${who.job!.jobRef}`
                : input.recipient === 'surveyor'
                  ? `Surveyor ${who.person!.name}`
                  : otherLabel(input)
          },
          ...(who.job ? [{ label: 'Job', to: who.job.jobRef }] : []),
          {
            label: 'Expires',
            to: days === 0 ? 'Never (until revoked)' : `After ${days} days`
          },
          {
            label: 'Delivery',
            to: 'Copy the link from the card and send it yourself'
          }
        ],
        warnings: form.hasUnpublishedChanges
          ? [
              'The draft has unpublished changes; this link uses the published version.'
            ]
          : [],
        confirmLabel: 'Create link',
        expectedVersion: null
      }
    };
  },
  async execute(input, ctx) {
    const who = await resolveRecipient(input);
    if (!who.ok) return fail(who.code, who.message);
    const days = input.expires_in_days ?? 30;
    const created = await forms.createInvitation(
      {
        formId: input.form_id,
        recipientType: input.recipient,
        jobId: who.job?.id ?? null,
        personId: who.person?.id ?? null,
        recipientLabel: input.recipient === 'other' ? otherLabel(input) : null,
        // Whole days, so a retried confirmation sends the identical command and
        // replays the same link instead of creating a second one.
        expiresAt: days === 0 ? null : endOfDayIn(days)
      },
      ctx.commandId
    );
    if (!created.ok) return fail(created.code, created.message);
    const link = await forms.getInvitation(created.result.invitation_id);
    return {
      ok: true,
      data: {
        invitation_id: created.result.invitation_id,
        status: 'ready to send',
        version: created.result.revision,
        expires_at: created.result.expires_at,
        note: 'The staff member copies the link from the card. It has not been sent to anyone.'
      },
      ...(link && {
        display: {
          kind: 'form_links',
          title: 'Link ready to send',
          links: [linkCard(link)],
          total: 1
        }
      })
    };
  }
};

export const revokeFormLinkTool: MutationTool<{
  invitation_id: string;
  reason?: string;
}> = {
  name: 'revoke_form_link',
  summary: 'Revoke a recipient link',
  description:
    'Prepare revoking a link so it stops working immediately. Submitted links cannot be revoked.',
  domain: 'forms',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    invitation_id: uuid,
    reason: z.string().trim().max(500).optional()
  }),
  authorization: { permissions: ['forms.send'], enforcedBy: ENFORCED },
  async prepare({ invitation_id, reason }) {
    const link = await forms.getInvitation(invitation_id);
    if (!link) return refuse('FORMS_INVITATION_NOT_FOUND');
    if (link.status === 'revoked') return refuse('FORMS_ALREADY_REVOKED');
    if (link.status === 'submitted') return refuse('FORMS_ALREADY_SUBMITTED');
    return {
      ok: true,
      preview: {
        title: `Revoke the link to "${link.formTitle}"`,
        summary: 'The link stops working immediately.',
        changes: [
          {
            label: 'Recipient',
            to: `${RECIPIENT_LABEL[link.recipientType]}: ${link.recipientName}`
          },
          ...(reason ? [{ label: 'Reason', to: reason }] : [])
        ],
        warnings: [],
        confirmLabel: 'Revoke link',
        expectedVersion: null
      }
    };
  },
  async execute({ invitation_id, reason }, ctx) {
    const revoked = await forms.revokeInvitation(
      invitation_id,
      reason ?? null,
      ctx.commandId
    );
    if (!revoked.ok) return fail(revoked.code, revoked.message);
    const link = await forms.getInvitation(invitation_id);
    return {
      ok: true,
      data: { invitation_id, status: 'revoked' },
      ...(link && {
        display: {
          kind: 'form_links',
          title: 'Link revoked',
          links: [linkCard(link)],
          total: 1
        }
      })
    };
  }
};

function endOfDayIn(days: number): string {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

const STATUS_WORDS = {
  closed: 'Close',
  published: 'Reopen',
  archived: 'Archive',
  restore: 'Restore'
} as const;

export const setFormStatusTool: MutationTool<{
  form_id: string;
  status: keyof typeof STATUS_WORDS;
}> = {
  name: 'set_form_status',
  summary: 'Close, reopen, archive or restore a form or template',
  description:
    'Prepare closing a published form (no new responses), reopening it, archiving it (hidden; responses kept) or restoring it.',
  domain: 'forms',
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    form_id: uuid,
    status: z.enum(['closed', 'published', 'archived', 'restore'])
  }),
  authorization: { permissions: ['forms.edit'], enforcedBy: ENFORCED },
  async prepare({ form_id, status }, ctx) {
    const form = await forms.getForm(form_id);
    if (!form) return refuse('FORMS_NOT_FOUND');
    if (
      form.kind === 'template' &&
      !ctx.actor.permissions.has('forms.templates.manage')
    )
      return refuse('FORMS_PERMISSION_DENIED');
    return {
      ok: true,
      preview: {
        title: `${STATUS_WORDS[status]} "${form.title}"`,
        summary:
          status === 'closed'
            ? 'Open links stop accepting answers. Responses already received are kept.'
            : status === 'archived'
              ? 'It is hidden from the lists. Its versions and responses are kept.'
              : 'It becomes available again.',
        changes: [
          {
            label: 'Status',
            from: form.status,
            to: status === 'restore' ? 'restored' : status
          }
        ],
        warnings: [],
        confirmLabel: STATUS_WORDS[status],
        expectedVersion: form.version
      }
    };
  },
  async execute({ form_id, status }, ctx) {
    if (ctx.expectedVersion == null) return fail('FORMS_STALE_VERSION');
    const form = await forms.getForm(form_id);
    const target =
      form?.kind === 'template' && status === 'restore' ? 'active' : status;
    const changed = await forms.setFormStatus(
      form_id,
      target,
      ctx.expectedVersion,
      ctx.commandId
    );
    if (!changed.ok) return fail(changed.code, changed.message);
    return formResult(form_id);
  }
};

export const FORMS_READ_TOOLS = [
  listFormsTool,
  getFormTool,
  listFormResponsesTool,
  getFormResponseTool
];
export const FORMS_MUTATION_TOOLS = [
  createFormTool,
  editFormDraftTool,
  publishFormTool,
  saveFormAsTemplateTool,
  createFormLinkTool,
  revokeFormLinkTool,
  setFormStatusTool
];

export const FORMS_TOOL_LABELS: Record<string, string> = {
  list_forms: 'Reading forms',
  get_form: 'Reading the form',
  list_form_responses: 'Reading form links',
  get_form_response: 'Reading the response',
  create_form: 'Preparing a new form',
  edit_form_draft: 'Preparing form changes',
  publish_form: 'Preparing to publish',
  save_form_as_template: 'Preparing a template',
  create_form_link: 'Preparing a link',
  revoke_form_link: 'Preparing to revoke a link',
  set_form_status: 'Preparing a status change'
};
