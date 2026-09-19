import 'server-only';

import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { previewWriteBlock } from '@/lib/preview/guard';
import { getSiteUrl } from '@/lib/site-url';
import { createDataClient } from '@/lib/supabase/data';
import { createClient } from '@/lib/supabase/server';
import {
  applyOperations,
  questionCount,
  type DraftOperation,
  type FormDefinition
} from '../definition';
import { formsMessage } from '../errors';
import type {
  FormDetail,
  FormKind,
  FormLinkStatus,
  FormRevision,
  FormSummary,
  InvitationSummary,
  ResponseDetail
} from '../types';
import { linksConfigured, linkToken, tokenHash } from './tokens';

/**
 * The Forms domain service. The manual builder (server actions), the recipient
 * page and SimpleBot's tools all call these functions - there is no second set
 * of rules. Reads run as the signed-in user under RLS (forms.read /
 * forms.responses.read); every change is a registered command through
 * public.execute_command, which authorizes (forms.* permissions), checks the
 * expected version, audits and makes retries idempotent on command_id.
 */

// -- Outcomes ---------------------------------------------------------------------

export type FormsOutcome<T> =
  | { ok: true; result: T; replayed: boolean }
  | { ok: false; code: string; message: string; field?: string };

type RpcError = {
  code?: string;
  message: string;
  details?: string | null;
} | null;

function refusal(error: NonNullable<RpcError>): FormsOutcome<never> {
  const code =
    error.code === 'P0001' ? error.message.split(':')[0].trim() : 'UNEXPECTED';
  let field: string | undefined;
  let problem: string | undefined;
  try {
    const detail = error.details ? JSON.parse(error.details) : null;
    field = detail?.field ?? undefined;
    problem = detail?.problem ?? undefined;
  } catch {
    // Detail is optional.
  }
  if (code === 'UNEXPECTED') {
    // eslint-disable-next-line no-console -- server-side diagnostics
    console.error('forms command failed', error);
  }
  const message =
    code === 'FORMS_INVALID_DEFINITION' && problem
      ? `${formsMessage(code)} ${field ? `Question "${field}": ` : ''}${problem}.`
      : formsMessage(code);
  return { ok: false, code, message, field };
}

const COMMAND_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one write path. `commandId` makes a retry a replay, never a second change. */
async function command<T>(
  type: string,
  payload: Record<string, unknown>,
  options: { commandId: string; expectedVersion?: number | null }
): Promise<FormsOutcome<T>> {
  const blocked = await previewWriteBlock();
  if (blocked)
    return { ok: false, code: 'PREVIEW_MODE_READ_ONLY', message: blocked };
  if (!COMMAND_ID.test(options.commandId)) {
    return {
      ok: false,
      code: 'INVALID_COMMAND_ID',
      message: formsMessage('UNEXPECTED')
    };
  }
  const supabase = await createClient();
  const request: Record<string, unknown> = {
    command_id: options.commandId,
    command_type: type,
    payload
  };
  if (options.expectedVersion != null)
    request.expected_version = options.expectedVersion;
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: unknown
    ) => Promise<{
      data: { result: T; replayed: boolean } | null;
      error: RpcError;
    }>
  )('execute_command', { p_request: request });
  if (error) return refusal(error);
  return { ok: true, result: data!.result, replayed: data!.replayed };
}

// -- Release gate -----------------------------------------------------------------

/**
 * Whether Forms is switched on (release_modes FN-21 = Manual). Fails closed:
 * an error, or a database without the function, counts as off.
 */
export async function formsEnabled(): Promise<boolean> {
  try {
    const client = await createDataClient();
    const { data, error } = await client.rpc('forms_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}

// -- Reads ------------------------------------------------------------------------

const FORM_COLUMNS =
  'id, kind, title, description, status, definition, current_revision_id, current_revision_number, has_unpublished_changes, source_template_id, source_form_id, job_id, archived_at, created_at, updated_at, version, jobs(job_ref)';

type FormRow = {
  id: string;
  kind: FormKind;
  title: string;
  description: string | null;
  status: string;
  definition: FormDefinition;
  current_revision_id: string | null;
  current_revision_number: number;
  has_unpublished_changes: boolean;
  source_template_id: string | null;
  source_form_id: string | null;
  job_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  jobs: { job_ref: string } | null;
};

const toSummary = (row: FormRow): FormSummary => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  description: row.description,
  status: row.status as FormSummary['status'],
  revision: row.current_revision_number,
  questionCount: questionCount(row.definition),
  hasUnpublishedChanges: row.has_unpublished_changes,
  jobId: row.job_id,
  jobRef: row.jobs?.job_ref ?? null,
  sourceTemplateId: row.source_template_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version
});

const db = createDataClient;

export async function listForms(options: {
  kind: FormKind;
  archived?: boolean;
}): Promise<FormSummary[]> {
  const client = await db();
  let query = client
    .from('forms')
    .select(FORM_COLUMNS)
    .eq('kind', options.kind)
    .order('updated_at', { ascending: false })
    .limit(200);
  query = options.archived
    ? query.eq('status', 'archived')
    : query.neq('status', 'archived');
  const { data, error } = await query;
  if (error) throw new Error(`forms: ${error.message}`);
  return (data as unknown as FormRow[]).map(toSummary);
}

export async function getForm(id: string): Promise<FormDetail | null> {
  const client = await db();
  const { data, error } = await client
    .from('forms')
    .select(FORM_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`form: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as FormRow;
  const { data: revisions, error: revError } = await client
    .from('form_revisions')
    .select(
      'id, revision_number, published_at, people:published_by(display_name)'
    )
    .eq('form_id', id)
    .order('revision_number', { ascending: false });
  if (revError) throw new Error(`form revisions: ${revError.message}`);
  return {
    ...toSummary(row),
    definition: row.definition,
    currentRevisionId: row.current_revision_id,
    revisions: (
      revisions as unknown as {
        id: string;
        revision_number: number;
        published_at: string;
        people: { display_name: string } | null;
      }[]
    ).map((r) => ({
      id: r.id,
      number: r.revision_number,
      publishedAt: r.published_at,
      publishedBy: r.people?.display_name ?? null
    }))
  };
}

export async function getRevision(id: string): Promise<FormRevision | null> {
  const client = await db();
  const { data, error } = await client
    .from('form_revisions')
    .select(
      'id, form_id, revision_number, title, description, definition, published_at'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`form revision: ${error.message}`);
  if (!data) return null;
  const r = data as unknown as {
    id: string;
    form_id: string;
    revision_number: number;
    title: string;
    description: string | null;
    definition: FormDefinition;
    published_at: string;
  };
  return {
    id: r.id,
    formId: r.form_id,
    number: r.revision_number,
    title: r.title,
    description: r.description,
    definition: r.definition,
    publishedAt: r.published_at
  };
}

const INVITATION_COLUMNS =
  'id, form_id, revision_id, recipient_type, job_id, person_id, recipient_label, expires_at, revoked_at, submitted_at, created_at, version, forms(title, status), form_revisions(revision_number), jobs(job_ref, customers(first_name, last_name)), people:person_id(display_name), form_submissions(id)';

type InvitationRow = {
  id: string;
  form_id: string;
  revision_id: string;
  recipient_type: InvitationSummary['recipientType'];
  job_id: string | null;
  person_id: string | null;
  recipient_label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  submitted_at: string | null;
  created_at: string;
  version: number;
  forms: { title: string; status: string } | null;
  form_revisions: { revision_number: number } | null;
  jobs: {
    job_ref: string;
    customers: { first_name: string; last_name: string } | null;
  } | null;
  people: { display_name: string } | null;
  form_submissions: { id: string }[] | { id: string } | null;
};

export function linkStatus(row: {
  submitted_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  formStatus?: string;
}): FormLinkStatus {
  if (row.submitted_at) return 'submitted';
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at) <= new Date())
    return 'expired';
  if (row.formStatus === 'closed' || row.formStatus === 'archived')
    return 'closed';
  return 'ready';
}

const toInvitation = (row: InvitationRow): InvitationSummary => {
  const submission = Array.isArray(row.form_submissions)
    ? row.form_submissions[0]
    : row.form_submissions;
  const customer = row.jobs?.customers;
  return {
    id: row.id,
    formId: row.form_id,
    formTitle: row.forms?.title ?? 'Form',
    revisionId: row.revision_id,
    revision: row.form_revisions?.revision_number ?? 0,
    recipientType: row.recipient_type,
    recipientName:
      row.recipient_type === 'customer'
        ? customer
          ? `${customer.first_name} ${customer.last_name}`
          : 'Customer'
        : row.recipient_type === 'surveyor'
          ? (row.people?.display_name ?? 'Surveyor')
          : (row.recipient_label ?? 'Recipient'),
    jobId: row.job_id,
    jobRef: row.jobs?.job_ref ?? null,
    status: linkStatus({ ...row, formStatus: row.forms?.status }),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    submissionId: submission?.id ?? null,
    version: row.version
  };
};

export interface ResponseFilters {
  formId?: string;
  status?: FormLinkStatus | 'all';
  recipientType?: InvitationSummary['recipientType'];
  jobRef?: string;
  from?: string;
  to?: string;
}

/**
 * Links and their responses. Staff without forms.responses.read still see link
 * status, but no submission ids (RLS hides form_submissions from them).
 */
export async function listInvitations(
  filters: ResponseFilters = {}
): Promise<InvitationSummary[]> {
  const client = await db();
  let query = client
    .from('form_invitations')
    .select(INVITATION_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(300);
  if (filters.formId) query = query.eq('form_id', filters.formId);
  if (filters.recipientType)
    query = query.eq('recipient_type', filters.recipientType);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to)
    query = query.lte('created_at', `${filters.to}T23:59:59.999Z`);
  const { data, error } = await query;
  if (error) throw new Error(`form links: ${error.message}`);
  let rows = (data as unknown as InvitationRow[]).map(toInvitation);
  if (filters.status && filters.status !== 'all')
    rows = rows.filter((r) => r.status === filters.status);
  if (filters.jobRef) {
    const q = filters.jobRef.trim().toUpperCase();
    rows = rows.filter((r) => r.jobRef?.toUpperCase().includes(q));
  }
  return rows;
}

export async function getInvitation(
  id: string
): Promise<InvitationSummary | null> {
  const client = await db();
  const { data, error } = await client
    .from('form_invitations')
    .select(INVITATION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`form link: ${error.message}`);
  return data ? toInvitation(data as unknown as InvitationRow) : null;
}

/** One response, read against the exact revision that was answered. */
export async function getResponse(
  submissionId: string
): Promise<ResponseDetail | null> {
  const client = await db();
  const { data, error } = await client
    .from('form_submissions')
    .select('id, invitation_id, revision_id, answers, submitted_at')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw new Error(`form response: ${error.message}`);
  if (!data) return null;
  const s = data as unknown as {
    id: string;
    invitation_id: string;
    revision_id: string;
    answers: Record<string, unknown>;
    submitted_at: string;
  };
  const [revision, invitation] = await Promise.all([
    getRevision(s.revision_id),
    getInvitation(s.invitation_id)
  ]);
  if (!revision || !invitation) return null;
  return {
    id: s.id,
    answers: s.answers,
    submittedAt: s.submitted_at,
    revision,
    invitation
  };
}

/** The recipient link, re-derived on demand. Only for staff who may send forms. */
export async function invitationLink(
  id: string
): Promise<FormsOutcome<{ url: string }>> {
  const user = await getCurrentUser();
  if (!user)
    return { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sign in again.' };
  if (user.preview)
    return {
      ok: false,
      code: 'PREVIEW_MODE_READ_ONLY',
      message: formsMessage('PREVIEW_MODE_READ_ONLY')
    };
  const permissions = await getPermissions(user);
  if (!permissions.has('forms.send')) {
    return {
      ok: false,
      code: 'FORMS_PERMISSION_DENIED',
      message: formsMessage('FORMS_PERMISSION_DENIED')
    };
  }
  const invitation = await getInvitation(id);
  if (!invitation)
    return {
      ok: false,
      code: 'FORMS_INVITATION_NOT_FOUND',
      message: formsMessage('FORMS_INVITATION_NOT_FOUND')
    };
  if (!linksConfigured()) {
    return {
      ok: false,
      code: 'FORMS_LINKS_NOT_CONFIGURED',
      message: formsMessage('FORMS_LINKS_NOT_CONFIGURED')
    };
  }
  return {
    ok: true,
    replayed: false,
    result: { url: `${await getSiteUrl()}/f/${linkToken(id)}` }
  };
}

// -- Commands ------------------------------------------------------------------------

type FormResult = {
  form_id: string;
  kind: FormKind;
  status: string;
  revision: number;
  version: number;
};

export function createForm(
  input: {
    kind: FormKind;
    title: string;
    description?: string | null;
    definition?: FormDefinition;
    sourceTemplateId?: string;
    sourceFormId?: string;
    jobId?: string | null;
  },
  commandId: string
) {
  return command<FormResult>(
    'FORMS_CREATE',
    {
      kind: input.kind,
      title: input.title,
      ...(input.description && { description: input.description }),
      ...(input.definition && { definition: input.definition }),
      ...(input.sourceTemplateId && {
        source_template_id: input.sourceTemplateId
      }),
      ...(input.sourceFormId && { source_form_id: input.sourceFormId }),
      ...(input.jobId && { job_id: input.jobId })
    },
    { commandId }
  );
}

export function saveDraft(
  formId: string,
  expectedVersion: number,
  draft: {
    title: string;
    description: string | null;
    definition: FormDefinition;
    jobId?: string | null;
  },
  commandId: string
) {
  return command<FormResult>(
    'FORMS_UPDATE_DRAFT',
    {
      form_id: formId,
      title: draft.title,
      description: draft.description ?? '',
      definition: draft.definition,
      ...(draft.jobId !== undefined && { job_id: draft.jobId ?? '' })
    },
    { commandId, expectedVersion }
  );
}

/**
 * Applies editing operations to the CURRENT draft (read now, not from any
 * conversation) and saves it with that version, so a concurrent edit is
 * refused rather than overwritten.
 */
export async function editDraft(
  formId: string,
  operations: DraftOperation[],
  commandId: string,
  expectedVersion?: number | null
): Promise<FormsOutcome<FormResult>> {
  const form = await getForm(formId);
  if (!form)
    return {
      ok: false,
      code: 'FORMS_NOT_FOUND',
      message: formsMessage('FORMS_NOT_FOUND')
    };
  if (expectedVersion != null && expectedVersion !== form.version) {
    return {
      ok: false,
      code: 'FORMS_STALE_VERSION',
      message: formsMessage('FORMS_STALE_VERSION')
    };
  }
  const applied = applyOperations(
    {
      title: form.title,
      description: form.description,
      definition: form.definition
    },
    operations
  );
  if (!applied.ok)
    return {
      ok: false,
      code: 'FORMS_INVALID_DEFINITION',
      message: applied.problem
    };
  return saveDraft(formId, form.version, applied.state, commandId);
}

export function publishForm(
  formId: string,
  expectedVersion: number,
  commandId: string
) {
  return command<FormResult & { revision_id: string }>(
    'FORMS_PUBLISH',
    { form_id: formId },
    { commandId, expectedVersion }
  );
}

export type StatusChange =
  | 'closed'
  | 'published'
  | 'archived'
  | 'restore'
  | 'active';

export function setFormStatus(
  formId: string,
  status: StatusChange,
  expectedVersion: number,
  commandId: string
) {
  return command<FormResult>(
    'FORMS_SET_STATUS',
    { form_id: formId, status },
    { commandId, expectedVersion }
  );
}

export interface InvitationInput {
  formId: string;
  recipientType: InvitationSummary['recipientType'];
  jobId?: string | null;
  personId?: string | null;
  recipientLabel?: string | null;
  expiresAt?: string | null;
}

/**
 * Creates a recipient link. The command id doubles as the link's id, so a
 * retried request replays to the same link; the token is derived from it and
 * only its hash reaches the database.
 */
export async function createInvitation(
  input: InvitationInput,
  commandId: string
): Promise<
  FormsOutcome<{
    invitation_id: string;
    revision: number;
    expires_at: string | null;
  }>
> {
  if (!linksConfigured()) {
    return {
      ok: false,
      code: 'FORMS_LINKS_NOT_CONFIGURED',
      message: formsMessage('FORMS_LINKS_NOT_CONFIGURED')
    };
  }
  return command(
    'FORMS_INVITATION_CREATE',
    {
      invitation_id: commandId,
      token_hash: tokenHash(linkToken(commandId)),
      form_id: input.formId,
      recipient_type: input.recipientType,
      ...(input.jobId && { job_id: input.jobId }),
      ...(input.personId && { person_id: input.personId }),
      ...(input.recipientLabel && { recipient_label: input.recipientLabel }),
      ...(input.expiresAt && { expires_at: input.expiresAt })
    },
    { commandId }
  );
}

export function revokeInvitation(
  invitationId: string,
  reason: string | null,
  commandId: string
) {
  return command<{ invitation_id: string }>(
    'FORMS_INVITATION_REVOKE',
    { invitation_id: invitationId, ...(reason && { reason }) },
    { commandId }
  );
}

// -- Pickers for the link dialog (read under RLS) ------------------------------------

export async function searchJobs(
  query: string
): Promise<{ id: string; jobRef: string; customerName: string }[]> {
  const client = await db();
  const q = query.trim();
  let request = client
    .from('jobs')
    .select('id, job_ref, customers(first_name, last_name)')
    .order('sold_at', { ascending: false })
    .limit(20);
  if (q) request = request.ilike('job_ref', `%${q.replace(/[%_]/g, '')}%`);
  const { data, error } = await request;
  if (error) throw new Error(`jobs: ${error.message}`);
  return (
    data as unknown as {
      id: string;
      job_ref: string;
      customers: { first_name: string; last_name: string } | null;
    }[]
  ).map((j) => ({
    id: j.id,
    jobRef: j.job_ref,
    customerName: j.customers
      ? `${j.customers.first_name} ${j.customers.last_name}`
      : ''
  }));
}

export async function listSurveyors(): Promise<{ id: string; name: string }[]> {
  const client = await db();
  const { data, error } = await client
    .from('person_roles')
    .select('people!person_roles_person_id_fkey(id, display_name, active)')
    .eq('role_code', 'Surveyor')
    .eq('active', true);
  if (error) throw new Error(`surveyors: ${error.message}`);
  return (
    data as unknown as {
      people: { id: string; display_name: string; active: boolean } | null;
    }[]
  )
    .map((r) => r.people)
    .filter(
      (p): p is { id: string; display_name: string; active: boolean } =>
        !!p?.active
    )
    .map((p) => ({ id: p.id, name: p.display_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A job id from its reference, if the signed-in user can see it. */
export async function jobByRef(
  jobRef: string
): Promise<{ id: string; jobRef: string } | null> {
  const client = await db();
  const { data } = await client
    .from('jobs')
    .select('id, job_ref')
    .eq('job_ref', jobRef.trim().toUpperCase())
    .maybeSingle();
  const row = data as unknown as { id: string; job_ref: string } | null;
  return row ? { id: row.id, jobRef: row.job_ref } : null;
}
