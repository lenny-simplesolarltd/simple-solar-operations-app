'use server';

import {
  beginEvidenceUpload,
  completeEvidenceUpload
} from '@/features/operations/evidence-upload';
import { runCommand } from '@/lib/backend/command';
import type { CommandResponse } from '@/lib/backend/types';
import { toCsv } from '@/lib/csv';
import { previewWriteBlock } from '@/lib/preview/guard';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  DISPOSITION_LABEL,
  OUTCOME_LABEL,
  PORTAL_LABEL,
  reviewReason
} from '../labels';
import {
  DISPOSITIONS,
  IMPORT_KEYS,
  PORTAL_VERIFICATIONS,
  type VisitFilters
} from '../types';
import { getDailyReport, listAllVisits } from './queries';

/**
 * Server actions for the Programmes screens.
 *
 * Every change goes through runCommand -> public.execute_command, which resolves
 * the actor from the session, checks the programme.* permission, checks the
 * expected version, audits, and makes a retry with the same command id a replay
 * rather than a second action. These functions decide nothing: they validate
 * their arguments (a server action is callable with anything) and forward.
 *
 * The board's drag-and-drop calls reviewVisitAction, the same function the review
 * screen's buttons call, so a drag cannot bypass a rule.
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

function refresh(programmeId: string) {
  revalidatePath(`/dashboard/operations/programmes/${programmeId}`, 'layout');
}

// -- The field visit -------------------------------------------------------------

/** Opens the draft that a visit's photographs will belong to. */
export async function startVisitAction(
  input: { visitId: string; programmeId: string; propertyId: string },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({ visitId: uuid, programmeId: uuid, propertyId: uuid })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  return runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_VISIT_START',
    payload: {
      visit_id: parsed.data.visitId,
      programme_id: parsed.data.programmeId,
      property_id: parsed.data.propertyId
    }
  });
}

/**
 * Submits the filled-in form. The answers are passed through untouched: the
 * database validates them against the revision, derives every canonical value
 * through the programme's field map and applies the outcome's own requirements.
 * Nothing is computed here that the server would then have to trust.
 */
export async function submitVisitAction(
  input: {
    visitId: string;
    programmeId: string;
    formId: string;
    revisionId: string;
    submissionId: string;
    expectedVersion: number;
    answers: unknown;
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      visitId: uuid,
      programmeId: uuid,
      formId: uuid,
      revisionId: uuid,
      submissionId: uuid,
      expectedVersion: z.number().int().min(1),
      answers: z.record(z.string(), z.unknown())
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;

  const response = await runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_VISIT_SUBMIT',
    expected_version: parsed.data.expectedVersion,
    payload: {
      visit_id: parsed.data.visitId,
      form_id: parsed.data.formId,
      revision_id: parsed.data.revisionId,
      submission_id: parsed.data.submissionId,
      answers: parsed.data.answers
    }
  });
  if (response.ok) refresh(parsed.data.programmeId);
  return response;
}

// -- Office review ---------------------------------------------------------------

/**
 * The ONE transition for a visit's disposition. The review screen and a
 * drag-and-drop on the board both call this, so "Complete & working" needs the
 * portal confirmation either way - the database refuses it otherwise, and the
 * table constraint refuses it even if a future caller forgets.
 */
export async function reviewVisitAction(
  input: {
    visitId: string;
    programmeId: string;
    disposition: string;
    portalVerification?: string | null;
    actionNote?: string | null;
    reopen?: boolean;
    expectedVersion: number;
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      visitId: uuid,
      programmeId: uuid,
      disposition: z.enum(DISPOSITIONS),
      portalVerification: z.enum(PORTAL_VERIFICATIONS).nullish(),
      actionNote: z.string().max(2000).nullish(),
      reopen: z.boolean().optional(),
      expectedVersion: z.number().int().min(1)
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const { data } = parsed;

  const response = await runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_VISIT_REVIEW',
    expected_version: data.expectedVersion,
    payload: {
      visit_id: data.visitId,
      disposition: data.disposition,
      ...(data.portalVerification
        ? { portal_verification: data.portalVerification }
        : {}),
      ...(data.actionNote !== undefined
        ? { action_note: data.actionNote?.trim() || null }
        : {}),
      ...(data.reopen ? { reopen: true } : {})
    }
  });
  if (response.ok) refresh(data.programmeId);
  return response;
}

// -- Evidence --------------------------------------------------------------------

/**
 * A photograph for a visit, through the canonical evidence upload: register,
 * send the bytes to a one-off signed URL, confirm. There is no programme bucket
 * and no second upload path - `beginEvidenceUpload` is the same function the
 * task and installer screens use, with a ProgrammeVisit context.
 */
export async function beginVisitPhotoAction(input: {
  uploadId: string;
  visitId: string;
  category: string;
  file: { name: string; type: string; size: number };
}) {
  const parsed = z
    .strictObject({
      uploadId: uuid,
      visitId: uuid,
      category: z.enum([
        'MeterPhoto',
        'SimSerialPhoto',
        'CsqPhoto',
        'CallingCard',
        'ProgrammeOther'
      ]),
      file: z.strictObject({
        name: z.string().min(1).max(300),
        type: z.string().max(120),
        size: z.number().int().positive()
      })
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, message: 'That file could not be added.' };
  return beginEvidenceUpload({
    uploadId: parsed.data.uploadId,
    context: { type: 'ProgrammeVisit', id: parsed.data.visitId },
    category: parsed.data.category,
    file: parsed.data.file
  });
}

export async function completeVisitPhotoAction(evidenceId: string) {
  if (!uuid.safeParse(evidenceId).success)
    return {
      ok: false as const,
      message: 'That upload could not be finished.'
    };
  return completeEvidenceUpload(evidenceId);
}

// -- Property import -------------------------------------------------------------

const importRows = z.array(z.array(z.string().max(4000)).max(200)).max(500);

export async function createImportAction(
  input: {
    importId: string;
    programmeId: string;
    filename: string;
    header: string[];
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      importId: uuid,
      programmeId: uuid,
      filename: z.string().trim().min(1).max(300),
      header: z.array(z.string().max(500)).min(1).max(200)
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  return runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_IMPORT_CREATE',
    payload: {
      import_id: parsed.data.importId,
      programme_id: parsed.data.programmeId,
      filename: parsed.data.filename,
      header: parsed.data.header
    }
  });
}

/** One chunk of staged rows. Chunking keeps a 1,400-row file off one request. */
export async function addImportRowsAction(
  input: { importId: string; fromIndex: number; rows: string[][] },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      importId: uuid,
      fromIndex: z.number().int().min(1),
      rows: importRows
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  return runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_IMPORT_ADD_ROWS',
    payload: {
      import_id: parsed.data.importId,
      from_index: parsed.data.fromIndex,
      rows: parsed.data.rows
    }
  });
}

export async function mapImportAction(
  input: {
    importId: string;
    programmeId: string;
    mapping: Record<string, number>;
    expectedVersion: number;
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      importId: uuid,
      programmeId: uuid,
      mapping: z.record(z.enum(IMPORT_KEYS), z.number().int().min(0).max(199)),
      expectedVersion: z.number().int().min(1)
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const response = await runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_IMPORT_MAP',
    expected_version: parsed.data.expectedVersion,
    payload: {
      import_id: parsed.data.importId,
      mapping: parsed.data.mapping
    }
  });
  if (response.ok) refresh(parsed.data.programmeId);
  return response;
}

export async function applyImportAction(
  input: { importId: string; programmeId: string; expectedVersion: number },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      importId: uuid,
      programmeId: uuid,
      expectedVersion: z.number().int().min(1)
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const response = await runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_IMPORT_APPLY',
    expected_version: parsed.data.expectedVersion,
    payload: { import_id: parsed.data.importId }
  });
  if (response.ok) refresh(parsed.data.programmeId);
  return response;
}

export async function discardImportAction(
  input: {
    importId: string;
    programmeId: string;
    reason?: string | null;
    expectedVersion: number;
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      importId: uuid,
      programmeId: uuid,
      reason: z.string().max(500).nullish(),
      expectedVersion: z.number().int().min(1)
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const response = await runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_IMPORT_DISCARD',
    expected_version: parsed.data.expectedVersion,
    payload: {
      import_id: parsed.data.importId,
      ...(parsed.data.reason?.trim()
        ? { reason: parsed.data.reason.trim() }
        : {})
    }
  });
  if (response.ok) refresh(parsed.data.programmeId);
  return response;
}

// -- Assignment ------------------------------------------------------------------

export async function assignAction(
  input: {
    programmeId: string;
    personId: string;
    propertyId?: string | null;
    note?: string | null;
  },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      programmeId: uuid,
      personId: uuid,
      propertyId: uuid.nullish(),
      note: z.string().max(500).nullish()
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const response = await runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_ASSIGN',
    payload: {
      programme_id: parsed.data.programmeId,
      person_id: parsed.data.personId,
      ...(parsed.data.propertyId
        ? { property_id: parsed.data.propertyId }
        : {}),
      ...(parsed.data.note?.trim() ? { note: parsed.data.note.trim() } : {})
    }
  });
  if (response.ok) refresh(parsed.data.programmeId);
  return response;
}

export async function unassignAction(
  input: { assignmentId: string; programmeId: string; reason?: string | null },
  commandId: string
): Promise<CommandResponse> {
  const parsed = z
    .strictObject({
      assignmentId: uuid,
      programmeId: uuid,
      reason: z.string().max(500).nullish()
    })
    .safeParse(input);
  if (!parsed.success || !uuid.safeParse(commandId).success) return invalid;
  const response = await runCommand({
    command_id: commandId,
    command_type: 'PROGRAMME_UNASSIGN',
    payload: {
      assignment_id: parsed.data.assignmentId,
      ...(parsed.data.reason?.trim()
        ? { reason: parsed.data.reason.trim() }
        : {})
    }
  });
  if (response.ok) refresh(parsed.data.programmeId);
  return response;
}

// -- Export ----------------------------------------------------------------------

const VISIT_EXPORT_HEADER = [
  'Property ID',
  'Address',
  'Town',
  'Postcode',
  'Visit date',
  'Installer',
  'Outcome',
  'Expected meter serial',
  'Actual meter serial',
  'Serial matches',
  'Meter reading',
  'New SIM serial',
  'CSQ',
  'CSQ band',
  'Portal verification',
  'Status',
  'Disposition',
  'Why reviewed',
  'Installer comments',
  'Office note',
  'Reviewed by',
  'Reviewed at'
] as const;

const yesNo = (v: boolean | null) =>
  v === null ? 'Not comparable' : v ? 'Yes' : 'No';

/**
 * The visit list as CSV. An OUTPUT of the system, never the system: the rows are
 * read through the same filtered query the screen uses, so the file and the
 * screen cannot disagree.
 */
export async function exportVisitsAction(
  programmeId: string,
  filters: VisitFilters = {}
): Promise<
  { ok: true; filename: string; csv: string } | { ok: false; message: string }
> {
  if (!uuid.safeParse(programmeId).success)
    return { ok: false, message: 'That programme could not be found.' };
  // Paged through in full: an export that silently stops at a round number is
  // worse than no export, because the file looks complete.
  const visits = await listAllVisits(programmeId, filters);
  const rows = visits.map((v) => [
    v.property.externalRef,
    v.property.addressLine1,
    v.property.town,
    v.property.postcode,
    v.visitDate,
    v.installerName,
    v.outcome ? OUTCOME_LABEL[v.outcome] : '',
    v.property.expectedMeterSerial,
    v.actualMeterSerial,
    yesNo(v.meterSerialMatches),
    v.meterReading,
    v.newSimSerial,
    v.csq,
    v.signalClassification,
    v.portalVerification ? PORTAL_LABEL[v.portalVerification] : '',
    v.reviewStatus,
    DISPOSITION_LABEL[v.disposition],
    v.reviewReasons.map(reviewReason).join('; '),
    v.installerComments,
    v.actionNote,
    v.reviewedByName,
    v.reviewedAt
  ]);
  return {
    ok: true,
    filename: `programme-visits-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(VISIT_EXPORT_HEADER, rows)
  };
}

const DAILY_HEADER = [
  'Property ID',
  'Address',
  'Postcode',
  'Installer',
  'Outcome',
  'Expected meter serial',
  'Actual meter serial',
  'Serial matches',
  'Meter reading',
  'New SIM serial',
  'CSQ',
  'CSQ band',
  'Portal verification',
  'Status',
  'Comments'
] as const;

/** The daily client report as CSV. Nothing is emailed: the file is downloaded. */
export async function exportDailyReportAction(
  programmeId: string,
  date?: string
): Promise<
  { ok: true; filename: string; csv: string } | { ok: false; message: string }
> {
  if (!uuid.safeParse(programmeId).success)
    return { ok: false, message: 'That programme could not be found.' };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { ok: false, message: 'Choose a date.' };
  const report = await getDailyReport(programmeId, date);
  if (!report)
    return { ok: false, message: 'You do not have access to this report.' };
  const rows = report.lines.map((l) => [
    l.external_ref,
    l.address,
    l.postcode,
    l.installer,
    OUTCOME_LABEL[l.outcome],
    l.expected_meter_serial,
    l.actual_meter_serial,
    yesNo(l.meter_serial_matches),
    l.meter_reading,
    l.new_sim_serial,
    l.csq,
    l.signal_classification,
    l.portal_verification ? PORTAL_LABEL[l.portal_verification] : '',
    DISPOSITION_LABEL[l.disposition],
    l.comments
  ]);
  return {
    ok: true,
    filename: `${report.programme.code}-daily-${report.date}.csv`,
    csv: toCsv(DAILY_HEADER, rows)
  };
}

/** Blocks a developer preview from acting, even holding a real session. */
export async function programmeWriteBlocked() {
  return previewWriteBlock();
}
