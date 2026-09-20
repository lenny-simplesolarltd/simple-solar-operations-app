import { describe, expect, it } from 'vitest';
import type { PlannerRow, PlannerScaffold } from '../../types';
import { scaffoldEvent, workEvent } from '../events';
import {
  DRAG_REFUSAL,
  canDrag,
  describeProposal,
  needsConfirmation,
  plannedCommands,
  proposeMove,
  proposeReassign
} from '../moves';

const row = (over: Partial<PlannerRow> = {}): PlannerRow => ({
  job_id: 'job-1',
  job_ref: 'SS-SEXL-5961',
  job_display: 'Miss Parton',
  work_package_id: 'wp-1',
  trade: 'Roof',
  work_package_status: 'Scheduled',
  planned_start: '2026-09-21',
  planned_end: '2026-09-21',
  work_package_version: 4,
  allocation_id: 'alloc-1',
  person_id: 'person-1',
  person_name: 'John Doyle',
  role: 'Lead',
  allocated: true,
  start_at: '2026-09-21',
  end_at: '2026-09-21',
  ...over
});

const scaffold: PlannerScaffold = {
  job_id: 'job-1',
  scaffold_booking_id: 'sb-1',
  company: 'Westcountry Scaffolding',
  kind: 'Erect',
  date: '2026-09-18',
  status: 'Confirmed',
  acknowledged: true,
  confirmed: true,
  actual_recorded: false
};

describe('what can be dragged', () => {
  it('allows scheduled, allocated work', () => {
    expect(canDrag(workEvent(row()))).toEqual({ ok: true });
  });

  it('refuses scaffold, which has its own commands', () => {
    const r = canDrag(scaffoldEvent(scaffold));
    expect(r).toEqual({ ok: false, reason: DRAG_REFUSAL.SCAFFOLD });
  });

  it('refuses work with nobody allocated', () => {
    const r = canDrag(
      workEvent(row({ allocated: false, allocation_id: null }))
    );
    expect(r).toEqual({ ok: false, reason: DRAG_REFUSAL.UNALLOCATED });
  });

  it('refuses work that has started or finished', () => {
    for (const status of [
      'InProgress',
      'ReportedComplete',
      'ConfirmedComplete',
      'Cancelled'
    ]) {
      const r = canDrag(workEvent(row({ work_package_status: status })));
      expect(r.ok).toBe(false);
    }
  });
});

describe('proposing a move', () => {
  it('shifts the whole span to the drop day', () => {
    const e = workEvent(row({ start_at: '2026-09-21', end_at: '2026-09-23' }));
    const r = proposeMove(e, '2026-09-23');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.from).toEqual({
      start: '2026-09-21',
      end: '2026-09-23'
    });
    expect(r.proposal.to).toEqual({ start: '2026-09-23', end: '2026-09-25' });
  });

  it('is not a proposal when dropped back where it started', () => {
    const r = proposeMove(workEvent(row()), '2026-09-21');
    expect(r).toEqual({ ok: false, reason: DRAG_REFUSAL.SAME_DAY });
  });

  it('passes the drag refusal through', () => {
    const r = proposeMove(scaffoldEvent(scaffold), '2026-09-21');
    expect(r).toEqual({ ok: false, reason: DRAG_REFUSAL.SCAFFOLD });
  });

  it('runs exactly one canonical command', () => {
    const r = proposeMove(workEvent(row()), '2026-09-22');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(plannedCommands(r.proposal)).toEqual(['MOVE_WORK_PACKAGE']);
  });
});

describe('proposing a reassignment', () => {
  it('changes the installer without touching the dates', () => {
    const r = proposeReassign(
      workEvent(row()),
      'person-2',
      'Dan Avery',
      '2026-09-21'
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.datesChanged).toBe(false);
    expect(r.proposal.to).toEqual({
      start: '2026-09-21',
      end: '2026-09-21'
    });
    expect(plannedCommands(r.proposal)).toEqual(['CHANGE_INSTALLER_R2']);
  });

  it('is two commands when the day changes too, and says so', () => {
    const r = proposeReassign(
      workEvent(row()),
      'person-2',
      'Dan Avery',
      '2026-09-24'
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.datesChanged).toBe(true);
    expect(plannedCommands(r.proposal)).toEqual([
      'MOVE_WORK_PACKAGE',
      'CHANGE_INSTALLER_R2'
    ]);
  });

  it('is not a proposal when dropped on the same person and day', () => {
    const r = proposeReassign(
      workEvent(row()),
      'person-1',
      'John Doyle',
      '2026-09-21'
    );
    expect(r).toEqual({ ok: false, reason: DRAG_REFUSAL.SAME_PERSON });
  });

  it('refuses to reassign scaffold', () => {
    const r = proposeReassign(
      scaffoldEvent(scaffold),
      'person-2',
      'Dan Avery',
      null
    );
    expect(r).toEqual({ ok: false, reason: DRAG_REFUSAL.SCAFFOLD });
  });
});

describe('confirmation', () => {
  it('confirms every proposal, because the smallest change is a whole day', () => {
    expect(needsConfirmation()).toBe(true);
  });

  it('describes a move in the words the dialog uses', () => {
    const r = proposeMove(workEvent(row()), '2026-09-23');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(describeProposal(r.proposal)).toBe(
      'Move roof for SS-SEXL-5961 from 21 Sept 2026 to 23 Sept 2026'
    );
  });

  it('describes a reassignment that also moves', () => {
    const r = proposeReassign(
      workEvent(row()),
      'person-2',
      'Dan Avery',
      '2026-09-24'
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(describeProposal(r.proposal)).toBe(
      'Reassign roof for SS-SEXL-5961 to Dan Avery and move it to 24 Sept 2026'
    );
  });
});
