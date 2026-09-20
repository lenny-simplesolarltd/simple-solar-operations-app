// What a drag proposes, and the cheap checks that run before anything is
// proposed at all. Pure, client-safe.
//
// IMPORTANT: nothing here is a business rule. Every rule that decides whether
// work may move lives in the database - app.rp_assess_person for readiness and
// app.r2_person_ready at commit time - and a drop is only ever committed by
// MOVE_WORK_PACKAGE or CHANGE_INSTALLER_R2, which re-check it inside the
// transaction. The functions below answer two much smaller questions:
//
//   1. Is this drag even a proposal? (dropping an event back where it started
//      is not; dragging scaffold is not, because no work-package command moves
//      a scaffold date.)
//   2. What should the confirmation dialog say it is about to do?
//
// So a false "looks fine" here costs a refusal the user sees and nothing else,
// and a false "not allowed" only ever withholds an operation the database
// would have refused anyway.

import type { CalendarEvent } from './events';
import { KIND_LABEL, isHistorical, isScaffold, shiftTo } from './events';
import type { Day } from './range';
import { formatMedium } from './range';

export interface MoveProposal {
  kind: 'move';
  event: CalendarEvent;
  from: { start: Day; end: Day };
  to: { start: Day; end: Day };
}

export interface ReassignProposal {
  kind: 'reassign';
  event: CalendarEvent;
  toPersonId: string;
  toPersonName: string;
  /** A resource-row drag can also change the dates. */
  to: { start: Day; end: Day };
  datesChanged: boolean;
}

export type Proposal = MoveProposal | ReassignProposal;

export type Refusal = { ok: false; reason: string };
export type Accepted<T> = { ok: true; proposal: T };

/** Why a drag cannot even be proposed. Staff wording - these are shown. */
export const DRAG_REFUSAL = {
  SCAFFOLD:
    'Scaffold dates are changed from the scaffold booking, not by dragging the install.',
  UNALLOCATED:
    'Nobody is allocated to this work yet. Open it and allocate an installer to give it dates.',
  IN_PROGRESS: 'This work has already started, so it cannot be dragged.',
  COMPLETE: 'This work is finished.',
  CANCELLED: 'This work is cancelled.',
  SAME_DAY: 'Dropped back on the same dates - nothing to change.',
  SAME_PERSON: 'That is already who this work is allocated to.',
  HISTORICAL:
    'This is an imported record of work that already happened. It is not scheduled work and cannot be changed.'
} as const;

/**
 * Statuses a drag must not touch. Started or finished work has actual dates
 * and evidence behind it; the database refuses to re-plan it, and saying so
 * before the drag is kinder than after.
 */
const UNDRAGGABLE_STATUS: Record<string, string> = {
  InProgress: DRAG_REFUSAL.IN_PROGRESS,
  ReportedComplete: DRAG_REFUSAL.COMPLETE,
  ConfirmedComplete: DRAG_REFUSAL.COMPLETE,
  Cancelled: DRAG_REFUSAL.CANCELLED
};

/** Whether this event can start a drag at all, and why not if it cannot. */
export function canDrag(e: CalendarEvent): { ok: true } | Refusal {
  // First, and before anything that looks at work: an imported record is not
  // scheduled work. It has no work package, no version and no allocation, so
  // there is nothing a command could be built from - this check states that
  // rather than creating it.
  if (isHistorical(e)) return { ok: false, reason: DRAG_REFUSAL.HISTORICAL };
  if (isScaffold(e)) return { ok: false, reason: DRAG_REFUSAL.SCAFFOLD };
  if (!e.work) return { ok: false, reason: DRAG_REFUSAL.SCAFFOLD };
  if (!e.work.allocated || !e.work.allocationId) {
    return { ok: false, reason: DRAG_REFUSAL.UNALLOCATED };
  }
  const blocked = UNDRAGGABLE_STATUS[e.work.status];
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true };
}

/** Dropping an event on a day: the whole span shifts. */
export function proposeMove(
  e: CalendarEvent,
  day: Day
): Accepted<MoveProposal> | Refusal {
  const drag = canDrag(e);
  if (!drag.ok) return drag;
  const to = shiftTo(e, day);
  if (to.start === e.start && to.end === e.end) {
    return { ok: false, reason: DRAG_REFUSAL.SAME_DAY };
  }
  return {
    ok: true,
    proposal: {
      kind: 'move',
      event: e,
      from: { start: e.start, end: e.end },
      to
    }
  };
}

/**
 * Dropping an event on another person's row in the team view. The day may or
 * may not change: dropping on the same day under a different name is a
 * reassignment only, dropping on a different day under a different name is
 * both, and the two are separate commands (see plannedCommands below).
 */
export function proposeReassign(
  e: CalendarEvent,
  personId: string,
  personName: string,
  day: Day | null
): Accepted<ReassignProposal> | Refusal {
  const drag = canDrag(e);
  if (!drag.ok) return drag;
  if (e.work?.personId === personId && (day === null || day === e.start)) {
    return { ok: false, reason: DRAG_REFUSAL.SAME_PERSON };
  }
  const to = day === null ? { start: e.start, end: e.end } : shiftTo(e, day);
  return {
    ok: true,
    proposal: {
      kind: 'reassign',
      event: e,
      toPersonId: personId,
      toPersonName: personName,
      to,
      datesChanged: to.start !== e.start
    }
  };
}

/**
 * The canonical commands a proposal runs, in order.
 *
 * A reassignment that also moves the dates is genuinely two commands - the
 * backend has no single "move and reassign" - so the confirmation dialog says
 * so plainly rather than pretending it is one atomic change.
 */
export function plannedCommands(p: Proposal): string[] {
  if (p.kind === 'move') return ['MOVE_WORK_PACKAGE'];
  return p.datesChanged
    ? ['MOVE_WORK_PACKAGE', 'CHANGE_INSTALLER_R2']
    : ['CHANGE_INSTALLER_R2'];
}

/**
 * Whether a drop is confirmed before it is committed.
 *
 * Always, and the brief's "simple time adjustments" case does not arise here:
 * there is no time-of-day in this schema, so the smallest change a drag can
 * make is a whole day - a date a customer, an installer and often a scaffolder
 * have already been told. None of those is committed on a mouse release.
 */
export function needsConfirmation(): boolean {
  return true;
}

/** One line describing a proposal, for a dialog title or a screen reader. */
export function describeProposal(p: Proposal): string {
  const what = KIND_LABEL[p.event.kind];
  const ref = p.event.jobRef ?? 'this job';
  if (p.kind === 'move') {
    return `Move ${what.toLowerCase()} for ${ref} from ${formatMedium(p.from.start)} to ${formatMedium(p.to.start)}`;
  }
  return p.datesChanged
    ? `Reassign ${what.toLowerCase()} for ${ref} to ${p.toPersonName} and move it to ${formatMedium(p.to.start)}`
    : `Reassign ${what.toLowerCase()} for ${ref} to ${p.toPersonName}`;
}
