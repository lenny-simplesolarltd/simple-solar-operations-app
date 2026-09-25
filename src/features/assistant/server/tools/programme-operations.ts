import 'server-only';

import {
  checkAnswers,
  fieldSchema,
  isBlank,
  isInputType,
  visibleFieldIds,
  type Answers,
  type AnswerValue,
  type FormDefinition,
  type FormField
} from '@/features/forms/definition';
import {
  DISPOSITION_LABEL,
  OUTCOME_LABEL,
  PORTAL_LABEL,
  SIGNAL_LABEL,
  reviewReason
} from '@/features/programmes/labels';
import {
  reviewVisitAction,
  startVisitAction,
  submitVisitAction
} from '@/features/programmes/server/actions';
import {
  getProperty,
  getVisit,
  visitForm
} from '@/features/programmes/server/queries';
import { compareSerials } from '@/features/programmes/serial';
import {
  DISPOSITIONS,
  PORTAL_VERIFICATIONS,
  type Disposition,
  type PortalVerification,
  type ProgrammeProperty,
  type ProgrammeVisit
} from '@/features/programmes/types';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ReadTool,
  ToolResult
} from '../registry';

/**
 * The two things the Programmes module asks a person to do: the office review of
 * a submitted visit, and the installer's record-a-visit workflow.
 *
 * Nothing here is a second implementation of either. Each tool calls the SAME
 * server action the screens call, which calls the same canonical command:
 * PROGRAMME_VISIT_REVIEW for the review (the board's drag-and-drop and the
 * review panel's buttons share it), PROGRAMME_VISIT_START then
 * PROGRAMME_VISIT_SUBMIT for the visit. The permission, the version check, the
 * answer validation against the published revision, the evidence ownership
 * check and the audit trail are the database's, exactly as they are for a
 * member of staff using the screen.
 *
 * Nothing is named after PCH. The questions, their conditions and which of them
 * are required come from the programme's ACTIVE form revision, read at the
 * moment of asking, so republishing the form - or standing up a second
 * programme with a different form - needs no change here.
 *
 * The rule these tools exist to protect: a property is finished only when the
 * OFFICE has confirmed the meter live in the client's portal. A good CSQ is a
 * signal reading taken at the doorstep; it proves the SIM can hear the network,
 * not that the meter is reporting. See the refusal in `portalProblem`.
 */

// belongs to the module's own workstream). 'installation' is the nearest true
const DOMAIN = 'programmes' as const;

const REVIEW_ENFORCED =
  'public.execute_command PROGRAMME_VISIT_REVIEW (app.programme_require: programme.review; ' +
  'expected_version on the visit; CompleteAndWorking refused unless portal_verification = ConfirmedLive, ' +
  'by the command and again by the programme_visits_complete_needs_portal table constraint) - ' +
  'session-bound, audited by app.audit(programme_visit)';

const SUBMIT_ENFORCED =
  'public.execute_command PROGRAMME_VISIT_START then PROGRAMME_VISIT_SUBMIT ' +
  '(app.programme_require: programme.visit.submit; the draft must be this actor’s own - ' +
  'PROGRAMME_VISIT_NOT_YOURS; answers re-validated against the revision by app.forms_validate_answers; ' +
  'every photograph re-checked by app.programme_attach_evidence as this visit’s, this person’s and ' +
  'actually stored; the outcome’s own required values and evidence re-applied from ' +
  'app.programme_outcome_requirements; expected_version on the visit) - session-bound, audited';

const READ_ENFORCED =
  'RLS on public.programme_visits / programme_properties and public.programme_visit_form() - ' +
  'this person sees only the visits and properties their programme policy allows';

const uuid = z.uuid();

/** How a value reads in a confirmation card when there isn't one. */
const shown = (v: string | null | undefined) =>
  v && v.trim() !== '' ? v : 'not recorded';

const addressOf = (p: { addressLine1: string; town: string | null }) =>
  [p.addressLine1, p.town].filter(Boolean).join(', ');

/**
 * A second command id for the same confirmed action, derived from the first.
 *
 * Recording a visit is two commands, and the confirmation endpoint issues one
 * command id. Deriving the second deterministically keeps the replay protection
 * that id exists for: if the response to a retry is lost, the retry replays the
 * same START and the same SUBMIT rather than opening a second draft for the
 * same property or writing a second submission.
 */
function derivedId(seed: string, purpose: string): string {
  const h = createHash('sha256').update(`${purpose}:${seed}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `${variant}${h.slice(17, 20)}`,
    h.slice(20, 32)
  ].join('-');
}

type Failure = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Failure => ({
  ok: false,
  code,
  message
});

// -- The published form, and what is still missing from an answer set ---------

interface LoadedForm {
  formId: string;
  revisionId: string;
  revision: number;
  title: string;
  definition: FormDefinition;
  /** Which question carries which canonical value. Programme configuration. */
  fieldMap: Record<string, unknown>;
}

/**
 * The programme's active visit revision.
 *
 * A definition that will not parse is reported rather than treated as an empty
 * form: "nothing is missing" from a form nobody could read is the one answer
 * that would let an incomplete visit through.
 */
async function loadForm(
  programmeId: string
): Promise<{ ok: true; form: LoadedForm } | Failure> {
  const served = await visitForm(programmeId);
  if (served.state !== 'open') {
    return fail(
      'PROGRAMME_FORM_UNAVAILABLE',
      served.state === 'error'
        ? `The programme's visit form could not be read: ${served.message}`
        : 'This programme has no published visit form, so a visit cannot be recorded against it yet. Say so rather than trying another way.'
    );
  }
  const parsed = z
    .strictObject({ fields: z.array(fieldSchema) })
    .safeParse(served.definition);
  if (!parsed.success) {
    return fail(
      'PROGRAMME_FORM_UNREADABLE',
      'The programme’s published visit form could not be read, so what it asks for cannot be checked. Tell them to open the visit form on the screen.'
    );
  }
  return {
    ok: true,
    form: {
      formId: served.formId,
      revisionId: served.revisionId,
      revision: served.revision,
      title: served.title,
      definition: parsed.data,
      fieldMap: served.fieldMap
    }
  };
}

const first = (spec: unknown): string | undefined =>
  Array.isArray(spec)
    ? typeof spec[0] === 'string'
      ? spec[0]
      : undefined
    : typeof spec === 'string'
      ? spec
      : undefined;

/** Which photo questions the field map points at, so evidence can be named as such. */
function evidenceFieldIds(fieldMap: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const evidence = fieldMap.evidence;
  if (evidence && typeof evidence === 'object') {
    for (const spec of Object.values(evidence as Record<string, unknown>)) {
      for (const id of Array.isArray(spec) ? spec : [spec])
        if (typeof id === 'string') out.add(id);
    }
  }
  return out;
}

interface QuestionState {
  id: string;
  label: string;
  type: string;
  required: boolean;
  /** A photo question: its answer is a list of evidence ids already uploaded. */
  evidence: boolean;
  answered: boolean;
  problem?: string;
}

/**
 * What the ACTIVE revision asks for, given the answers so far.
 *
 * Conditions are evaluated with the form's own `visibleFieldIds`, and the
 * answers are checked with the form's own `checkAnswers` - the same two
 * functions the renderer uses and the same rules app.forms_validate_answers
 * applies again in the database. A question hidden by a condition is not asked
 * for, so SimpleBot never chases an answer the person would never be shown.
 */
function assess(form: LoadedForm, answers: Answers) {
  const visible = visibleFieldIds(form.definition, answers);
  const { errors } = checkAnswers(form.definition, answers);
  const evidenceIds = evidenceFieldIds(form.fieldMap);

  const questions: QuestionState[] = form.definition.fields
    .filter((f: FormField) => isInputType(f.type) && visible.has(f.id))
    .map((f: FormField) => {
      const value = answers[f.id];
      // A confirmation left un-ticked is `false`, which is a value but not an
      // answer; the form treats it as unanswered and so must this.
      const answered =
        !isBlank(value) && !(f.type === 'confirmation' && value === false);
      return {
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required === true,
        evidence: f.type === 'photo' || evidenceIds.has(f.id),
        answered,
        ...(errors[f.id] ? { problem: errors[f.id] } : {})
      };
    });

  return {
    questions,
    missing: questions.filter((q) => q.required && !q.answered),
    invalid: questions.filter((q) => q.answered && q.problem),
    /** Answers sent for questions this revision does not show. */
    unknown: Object.keys(answers).filter((id) => !visible.has(id))
  };
}

const nameQuestion = (q: QuestionState) =>
  `${q.id} (${q.label})${q.evidence ? ' - photographs' : ''}`;

// -- 1. Office review ---------------------------------------------------------

interface ReviewInput {
  visit_id: string;
  disposition: (typeof DISPOSITIONS)[number];
  portal_verification?: (typeof PORTAL_VERIFICATIONS)[number];
  note?: string;
  reopen?: boolean;
}

/**
 * The portal rule, in words, before the database says it in a refusal.
 *
 * `CompleteAndWorking` is the only disposition that finishes a property, and it
 * is reachable only with the office's own portal confirmation. The check is
 * repeated here so a person gets a useful answer - which confirmation is
 * missing, and that a CSQ reading is not it - instead of a bare refusal after
 * confirming an action that was never going to run. The command and the table
 * constraint remain the authority; this is never allowed to be the reason
 * something IS permitted.
 */
function portalProblem(
  visit: ProgrammeVisit,
  input: ReviewInput
): Failure | null {
  const effective = input.portal_verification ?? visit.portalVerification;
  if (input.disposition !== 'CompleteAndWorking') return null;
  if (effective === 'ConfirmedLive') return null;
  const current = visit.portalVerification
    ? `The portal result recorded is "${PORTAL_LABEL[visit.portalVerification]}".`
    : 'No portal result has been recorded for this visit yet.';
  return fail(
    'PROGRAMME_PORTAL_CONFIRMATION_REQUIRED',
    `${visit.property.externalRef} cannot be marked "${DISPOSITION_LABEL.CompleteAndWorking}": office portal confirmation is still required. ${current} ` +
      'A property is finished only when the office has confirmed in the client portal that the meter is live and reporting. ' +
      'A good CSQ is a signal reading taken at the doorstep and proves nothing about the meter reporting, so do not treat one as the confirmation. ' +
      'Ask whoever is reviewing to check the portal and say what it shows; if it is live, run this again with portal_verification "ConfirmedLive".'
  );
}

async function loadVisit(
  visitId: string
): Promise<{ ok: true; visit: ProgrammeVisit } | Failure> {
  const visit = await getVisit(visitId);
  if (!visit) {
    return fail(
      'NOT_FOUND',
      'No visit with that id is visible to the signed-in staff member. It may not exist, or they may not have access to this programme.'
    );
  }
  return { ok: true, visit };
}

/** The mismatch the office is reviewing, when there is one. */
function serialNote(visit: ProgrammeVisit): string | null {
  const state = compareSerials(
    visit.property.expectedMeterSerial,
    visit.actualMeterSerial
  );
  if (state === 'mismatch')
    return `The serial recorded (${shown(visit.actualMeterSerial)}) is not the one expected here (${shown(visit.property.expectedMeterSerial)}).`;
  if (state === 'no-expected' && visit.actualMeterSerial)
    return 'No expected serial was imported for this property, so the recorded serial could not be compared.';
  return null;
}

export const reviewVisitTool: MutationTool<ReviewInput> = {
  name: 'programme_review_visit',
  summary: 'Office review: set a programme visit’s disposition',
  description:
    "Review a submitted programme visit and set where it lands: awaiting review, no access - rebook, action required, meter requires changing, or complete & working. Use the visit's id from a programme read tool. " +
    '"Complete & working" finishes a property and is only possible when the office has confirmed in the client portal that the meter is live and reporting - pass portal_verification "ConfirmedLive" when they have checked it and it is live. ' +
    'Never infer that from a CSQ reading or from the installer saying the meter looked to be working: those are doorstep observations, not the portal. If nobody has checked the portal, say so and ask them to check it. ' +
    'Putting a visit back into the review queue (awaiting review) needs reopen: true, because it undoes a review somebody made.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    visit_id: uuid.describe('The visit’s id, from a programme read tool'),
    // Built from the module's own constant: the model cannot invent a
    // disposition, and a value the board does not have cannot be proposed.
    disposition: z
      .enum(DISPOSITIONS)
      .describe('Where this visit lands after review'),
    portal_verification: z
      .enum(PORTAL_VERIFICATIONS)
      .optional()
      .describe(
        'What the office saw in the client portal: ConfirmedLive, NotLive or UnableToVerify. Only when they have actually looked.'
      ),
    note: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe('The office note recorded against the visit'),
    reopen: z
      .boolean()
      .optional()
      .describe('Required to put a reviewed visit back into the queue')
  }),
  authorization: {
    permissions: ['programme.review'],
    enforcedBy: REVIEW_ENFORCED
  },

  async prepare(input) {
    const loaded = await loadVisit(input.visit_id);
    if (!loaded.ok) return loaded;
    const { visit } = loaded;

    if (visit.reviewStatus === 'Draft') {
      return fail(
        'PROGRAMME_VISIT_NOT_SUBMITTED',
        'That visit is still a draft: the installer has not submitted it, so there is nothing to review yet.'
      );
    }
    if (input.disposition === 'AwaitingReview' && !input.reopen) {
      return fail(
        'PROGRAMME_REOPEN_REQUIRED',
        'Putting a visit back into the review queue undoes a review somebody made. Ask them to confirm that is what they want, then run this again with reopen: true.'
      );
    }
    if (input.portal_verification && !visit.portalCheckRequired) {
      return fail(
        'PROGRAMME_PORTAL_NOT_APPLICABLE',
        'A portal result cannot be recorded for this visit: there was no SIM change to verify, so there is nothing live in the portal to confirm.'
      );
    }
    const portal = portalProblem(visit, input);
    if (portal) return portal;

    const note = input.note?.trim();
    const unchanged =
      input.disposition === visit.disposition &&
      (input.portal_verification ?? visit.portalVerification) ===
        visit.portalVerification &&
      (note === undefined || note === (visit.actionNote ?? ''));
    if (unchanged) {
      return fail(
        'PROGRAMME_NO_CHANGE',
        `${visit.property.externalRef} is already recorded as "${DISPOSITION_LABEL[visit.disposition]}" with that portal result. Say so rather than running anything.`
      );
    }

    const mismatch = serialNote(visit);
    const preview: ActionPreview = {
      title: 'Review a programme visit',
      summary: `Set ${visit.property.externalRef}, ${addressOf(visit.property)}, to "${DISPOSITION_LABEL[input.disposition]}".`,
      changes: [
        {
          label: 'Property',
          to: `${visit.property.externalRef} — ${addressOf(visit.property)}${visit.property.postcode ? ` ${visit.property.postcode}` : ''}`
        },
        { label: 'Installer', to: shown(visit.installerName) },
        {
          label: 'Disposition',
          from: DISPOSITION_LABEL[visit.disposition],
          to: DISPOSITION_LABEL[input.disposition]
        },
        {
          label: 'Portal result',
          from: visit.portalVerification
            ? PORTAL_LABEL[visit.portalVerification]
            : 'not checked',
          to: input.portal_verification
            ? PORTAL_LABEL[input.portal_verification]
            : visit.portalVerification
              ? PORTAL_LABEL[visit.portalVerification]
              : 'not checked'
        },
        ...(note !== undefined ? [{ label: 'Office note', to: note }] : []),
        ...(mismatch ? [{ label: 'Meter serial', to: mismatch }] : [])
      ],
      warnings: [
        ...(input.disposition === 'CompleteAndWorking'
          ? [
              'This finishes the property. It is counted as complete in the client reporting.'
            ]
          : []),
        ...(input.reopen
          ? [
              'This puts the visit back into the review queue and clears who reviewed it.'
            ]
          : []),
        ...(mismatch ? [mismatch] : [])
      ],
      confirmLabel: 'Save the review',
      expectedVersion: visit.version
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const loaded = await loadVisit(input.visit_id);
    if (!loaded.ok) return loaded;
    const { visit } = loaded;
    // Re-checked on the way out as well as in prepare: the portal result could
    // have been cleared between the proposal and the confirmation.
    const portal = portalProblem(visit, input);
    if (portal) return portal;

    const response = await reviewVisitAction(
      {
        visitId: visit.id,
        programmeId: visit.programmeId,
        disposition: input.disposition,
        portalVerification: input.portal_verification ?? null,
        ...(input.note !== undefined ? { actionNote: input.note.trim() } : {}),
        ...(input.reopen ? { reopen: true } : {}),
        expectedVersion: ctx.expectedVersion ?? visit.version
      },
      ctx.commandId
    );
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }
    const result = response.result as {
      disposition?: string;
      portal_verification?: string | null;
      review_status?: string;
    };
    const disposition = (result.disposition ??
      input.disposition) as Disposition;
    const portalNow = (result.portal_verification ??
      input.portal_verification ??
      visit.portalVerification) as PortalVerification | null;
    return {
      ok: true,
      data: {
        visit_id: visit.id,
        property_ref: visit.property.externalRef,
        disposition: result.disposition ?? input.disposition,
        portal_verification: result.portal_verification ?? null,
        review_status: result.review_status ?? 'Reviewed',
        note: 'Saved. The board and the client reporting show the new state, and the review is in the audit trail.'
      },
      // A record of the review that has just been saved, not something to act
      // on: the command has already run and the card carries no authority to
      // run another. Evidence is deliberately absent rather than shown as
      // none - this path never read it, and a card must not guess.
      display: {
        kind: 'programme_review_item',
        visit: {
          // The id rides here so the drawer can identify the visit; what a
          // person reads is the address, the reference and the postcode.
          id: visit.id,
          reference: visit.property.externalRef,
          address: addressOf(visit.property),
          postcode: visit.property.postcode,
          installer: visit.installerName,
          visitDate: visit.visitDate,
          submittedAt: visit.submittedAt,
          outcome: visit.outcome ? OUTCOME_LABEL[visit.outcome] : null,
          // From the command's own answer, not from what was asked for.
          disposition: DISPOSITION_LABEL[disposition] ?? disposition,
          portalVerification: portalNow
            ? (PORTAL_LABEL[portalNow] ?? null)
            : null,
          csq: visit.csq,
          csqBand: visit.signalClassification
            ? SIGNAL_LABEL[visit.signalClassification]
            : null,
          serialMismatch: visit.meterSerialMatches === false
        },
        reviewStatus: result.review_status ?? 'Reviewed',
        reviewReasons: visit.reviewReasons.map(reviewReason)
      }
    };
  }
};

// -- 2. What is still missing before a visit can be submitted -----------------

interface StatusInput {
  visit_id?: string;
  programme_id?: string;
  property_id?: string;
  answers?: Record<string, unknown>;
}

/**
 * A read, not a mutation: it answers "what am I still missing?" and writes
 * nothing. It lives beside the submit tool because it is the same reading of
 * the same revision, and the two would drift if they were apart.
 */
export const visitSubmitStatusTool: ReadTool<StatusInput> = {
  name: 'programme_visit_submit_status',
  summary: 'What a programme visit still needs before it can be submitted',
  description:
    "What the programme's current visit form asks for, and what is still outstanding: which questions are being shown (questions hidden by the answers so far are not asked for), which are required, which are answered, and which are still missing - including photographs. " +
    'Give the visit id if a draft has been started, or the programme id with the property id. Pass the answers gathered so far as a map of question id to value; questions that only appear once an earlier answer is given will appear as the answers grow. ' +
    'Use it before proposing to record a visit, so you ask only for what is actually outstanding.',
  domain: DOMAIN,
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    visit_id: uuid.optional().describe('A draft visit already started'),
    programme_id: uuid.optional(),
    property_id: uuid.optional(),
    answers: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Question id to answer, as gathered so far')
  }),
  authorization: {
    permissions: ['programme.read'],
    enforcedBy: READ_ENFORCED
  },

  async execute(input) {
    const answers = (input.answers ?? {}) as Answers;
    let visit: ProgrammeVisit | null = null;
    let programmeId = input.programme_id ?? null;
    let propertyId = input.property_id ?? null;

    if (input.visit_id) {
      const loaded = await loadVisit(input.visit_id);
      if (!loaded.ok) return loaded;
      visit = loaded.visit;
      programmeId = visit.programmeId;
      propertyId = visit.propertyId;
    }
    if (!programmeId) {
      return fail(
        'INVALID_ARGUMENTS',
        'Say which programme this is for: give the visit id of a draft, or the programme id and the property id.'
      );
    }

    const form = await loadForm(programmeId);
    if (!form.ok) return form;

    const property = propertyId ? await getProperty(propertyId) : null;
    const state = assess(form.form, answers);

    return {
      ok: true,
      data: {
        form: {
          title: form.form.title,
          revision: form.form.revision,
          question_count: state.questions.length
        },
        ...(property
          ? {
              property: {
                id: property.id,
                reference: property.externalRef,
                address: addressOf(property),
                postcode: property.postcode,
                expected_meter_serial: property.expectedMeterSerial
              }
            }
          : {}),
        ...(visit
          ? {
              visit: {
                id: visit.id,
                review_status: visit.reviewStatus,
                already_submitted: visit.reviewStatus !== 'Draft'
              }
            }
          : {}),
        questions: state.questions,
        missing_required: state.missing.map((q) => ({
          id: q.id,
          label: q.label,
          evidence: q.evidence
        })),
        answers_with_problems: state.invalid.map((q) => ({
          id: q.id,
          label: q.label,
          problem: q.problem
        })),
        answers_not_on_this_form: state.unknown,
        ready_to_submit:
          state.missing.length === 0 && state.invalid.length === 0,
        note: 'Only the questions this revision shows for these answers are listed. Photographs must already be uploaded against this visit; their ids are the answer to a photo question.'
      }
    };
  }
};

// -- 3. Record a visit --------------------------------------------------------

interface SubmitInput {
  programme_id: string;
  property_id: string;
  answers: Record<string, unknown>;
  visit_id?: string;
}

interface SubmitTarget {
  form: LoadedForm;
  property: ProgrammeProperty;
  draft: ProgrammeVisit | null;
}

async function loadSubmitTarget(
  input: SubmitInput
): Promise<{ ok: true; target: SubmitTarget } | Failure> {
  let draft: ProgrammeVisit | null = null;
  if (input.visit_id) {
    const loaded = await loadVisit(input.visit_id);
    if (!loaded.ok) return loaded;
    draft = loaded.visit;
    if (draft.reviewStatus !== 'Draft') {
      return fail(
        'PROGRAMME_VISIT_ALREADY_SUBMITTED',
        'That visit has already been submitted and is with the office. A second submission for the same visit is a mistake, not a retry.'
      );
    }
    if (draft.programmeId !== input.programme_id) {
      return fail(
        'PROGRAMME_VISIT_MISMATCH',
        'That draft belongs to a different programme from the one given.'
      );
    }
    if (draft.propertyId !== input.property_id) {
      return fail(
        'PROGRAMME_PROPERTY_MISMATCH',
        'That draft was started for a different property. Recording a different property is a new visit, not this one.'
      );
    }
  }

  const property = await getProperty(input.property_id);
  if (!property || property.programmeId !== input.programme_id) {
    return fail(
      'NOT_FOUND',
      'No property with that id is visible to the signed-in person in this programme.'
    );
  }
  if (!property.active) {
    return fail(
      'PROGRAMME_PROPERTY_WITHDRAWN',
      `${property.externalRef} has been withdrawn from the programme, so a visit cannot be recorded against it.`
    );
  }

  const form = await loadForm(input.programme_id);
  if (!form.ok) return form;
  return { ok: true, target: { form: form.form, property, draft } };
}

export const submitVisitTool: MutationTool<SubmitInput> = {
  name: 'programme_visit_submit',
  summary: 'Record a programme visit against a property',
  description:
    "Record a field visit: the answers to the programme's visit form for one property. Answers are a map of question id to value, taken from programme_visit_submit_status - use the question ids that tool reports, never invented ones. " +
    'Photograph questions are answered with the ids of evidence already uploaded against this visit by the same person; there is no way to attach somebody else’s file or a file from another visit. ' +
    'Check programme_visit_submit_status first and ask only for what it says is outstanding. A recorded visit goes to the office for review - it is not finished, and it is never you who decides whether the meter is working.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    programme_id: uuid,
    property_id: uuid.describe(
      'The property visited, from a programme read tool'
    ),
    answers: z
      .record(z.string(), z.unknown())
      .describe(
        'Question id to answer, for the programme’s current visit form'
      ),
    visit_id: uuid
      .optional()
      .describe('The draft already started for this property, if there is one')
  }),
  authorization: {
    permissions: ['programme.visit.submit'],
    enforcedBy: SUBMIT_ENFORCED
  },

  async prepare(input) {
    const loaded = await loadSubmitTarget(input);
    if (!loaded.ok) return loaded;
    const { form, property, draft } = loaded.target;
    const answers = input.answers as Answers;
    const state = assess(form, answers);

    // Named specifically, so SimpleBot asks for the two things outstanding
    // rather than starting the whole form again.
    if (state.missing.length > 0) {
      const photos = state.missing.filter((q) => q.evidence);
      return fail(
        'PROGRAMME_ANSWERS_INCOMPLETE',
        `${property.externalRef} cannot be recorded yet: ${state.missing.length} required ${state.missing.length === 1 ? 'question is' : 'questions are'} unanswered - ${state.missing.map(nameQuestion).join('; ')}. ` +
          (photos.length > 0
            ? 'Photographs must be taken and uploaded against this visit first; their ids are the answer to the photo question. '
            : '') +
          'Ask for exactly those and nothing else.'
      );
    }
    if (state.invalid.length > 0) {
      return fail(
        'PROGRAMME_ANSWERS_INVALID',
        `Some answers are not in the form the question expects: ${state.invalid
          .map((q) => `${q.id} (${q.label}) - ${q.problem}`)
          .join('; ')}. Ask for those again.`
      );
    }

    // The form map says which question is the property. An answer naming a
    // different one means the selection changed after the draft was started,
    // which the command refuses outright.
    const propertyFieldId = first(form.fieldMap.property);
    const chosen = propertyFieldId ? answers[propertyFieldId] : undefined;
    if (typeof chosen === 'string' && chosen !== property.id) {
      return fail(
        'PROGRAMME_PROPERTY_MISMATCH',
        'The property named in the answers is not the property this visit is for. Confirm which property they are at.'
      );
    }

    const answered = state.questions.filter((q) => q.answered);
    const photoCount = answered
      .filter((q) => q.evidence)
      .reduce(
        (n, q) =>
          n +
          (Array.isArray(answers[q.id])
            ? (answers[q.id] as AnswerValue[]).length
            : 0),
        0
      );

    const preview: ActionPreview = {
      title: 'Record a programme visit',
      summary: `Record a visit to ${property.externalRef}, ${addressOf(property)}, on the ${form.title} form.`,
      changes: [
        {
          label: 'Property',
          to: `${property.externalRef} — ${addressOf(property)}${property.postcode ? ` ${property.postcode}` : ''}`
        },
        { label: 'Form', to: `${form.title} (version ${form.revision})` },
        {
          label: 'Answers',
          to: `${answered.length} of ${state.questions.length} questions answered`
        },
        ...(photoCount > 0
          ? [
              {
                label: 'Photographs',
                to: `${photoCount} already uploaded against this visit`
              }
            ]
          : []),
        ...(draft
          ? [{ label: 'Draft', to: 'Adding to the draft already started' }]
          : [])
      ],
      warnings: [
        'The visit goes to the office for review. It does not finish the property: only the office’s portal confirmation does that.',
        'The server re-validates every answer against the published form and re-checks every photograph, so anything it refuses is not recorded at all.'
      ],
      confirmLabel: 'Record the visit',
      expectedVersion: draft?.version ?? null
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const loaded = await loadSubmitTarget(input);
    if (!loaded.ok) return loaded;
    const { form, property, draft } = loaded.target;

    // The draft the photographs belong to. Its id is derived from the command
    // id rather than random, so a retry opens no second draft; START itself
    // returns the existing draft when it already exists, and refuses one that
    // belongs to somebody else.
    const visitId = draft?.id ?? derivedId(ctx.commandId, 'visit');
    const started = await startVisitAction(
      {
        visitId,
        programmeId: input.programme_id,
        propertyId: property.id
      },
      derivedId(ctx.commandId, 'start')
    );
    if (!started.ok) {
      return {
        ok: false,
        code: started.outcome.code ?? 'COMMAND_FAILED',
        message: started.outcome.message
      };
    }
    const startResult = started.result as {
      visit_id?: string;
      version?: number;
    };
    const openedId = startResult.visit_id ?? visitId;

    const response = await submitVisitAction(
      {
        visitId: openedId,
        programmeId: input.programme_id,
        formId: form.formId,
        revisionId: form.revisionId,
        submissionId: derivedId(ctx.commandId, 'submission'),
        expectedVersion: ctx.expectedVersion ?? startResult.version ?? 1,
        answers: input.answers
      },
      ctx.commandId
    );
    if (!response.ok) {
      return {
        ok: false,
        code: response.outcome.code ?? 'COMMAND_FAILED',
        message: response.outcome.message
      };
    }
    const result = response.result as {
      outcome?: string;
      disposition?: string;
      review_reasons?: string[];
    };
    return {
      ok: true,
      data: {
        visit_id: openedId,
        property_ref: property.externalRef,
        outcome: result.outcome ?? null,
        disposition: result.disposition ?? 'AwaitingReview',
        review_reasons: result.review_reasons ?? [],
        note: 'Recorded and sent to the office for review. The property is not finished until the office confirms the meter live in the client portal.'
      }
    };
  }
};

export const PROGRAMME_OPERATION_READ_TOOLS = [visitSubmitStatusTool];
export const PROGRAMME_OPERATION_MUTATION_TOOLS: MutationTool<never>[] = [
  reviewVisitTool as unknown as MutationTool<never>,
  submitVisitTool as unknown as MutationTool<never>
];

export type { ToolResult };
