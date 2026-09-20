'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { OutcomeAlert } from '@/features/operations/command-dialog';
import { NoteField, TextField } from '@/features/operations/fields';
import { newCommandId } from '@/features/presale/lib/draft';
import { runCommand } from '@/lib/backend/command';
import type { CommandOutcome, CommandRequest } from '@/lib/backend/types';
import { IconArrowRight, IconLoader2 } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { assessInstallers } from '../actions';
import { KIND_LABEL, type CalendarEvent } from '../calendar/events';
import type { Proposal } from '../calendar/moves';
import { describeProposal, plannedCommands } from '../calendar/moves';
import { formatMedium } from '../calendar/range';
import { READINESS_REASON, type Candidate } from '../types';

/**
 * The drop preview: what is about to change, whether the person is free, and
 * one button that runs the canonical command.
 *
 * Nothing is committed because the mouse was released. Releasing produces a
 * proposal; this dialog is where a human accepts it. The readiness shown here
 * is advisory (RP_ASSESS for the proposed dates) - the command re-checks it
 * inside the transaction and refuses with the database's own wording, which is
 * what OutcomeAlert then shows.
 */
export function MoveDialog({
  proposal,
  onClose,
  onDone
}: {
  proposal: Proposal | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  const router = useRouter();

  // One command_id per command, held until that command succeeds. A retry
  // after a dropped response is then replayed by the ledger rather than acted
  // on twice - and the reassignment never borrows the move's id, which would
  // make the ledger answer the second command with the first one's result.
  const ids = useRef({ move: newCommandId(), reassign: newCommandId() });

  /**
   * Runs one command. On success it reports the row the command wrote, so a
   * following command can use the version that now exists.
   */
  const runOne = useCallback(
    async (
      slot: 'move' | 'reassign',
      request: Omit<CommandRequest, 'command_id'>
    ): Promise<{
      ok: boolean;
      workPackageVersion?: number;
      allocationId?: string;
    }> => {
      let response;
      try {
        response = await runCommand({
          ...request,
          command_id: ids.current[slot]
        });
      } catch {
        setOutcome({
          status: 'Failed',
          heading: 'CONNECTION PROBLEM',
          message:
            'We could not confirm the result. Try again - it will not be done twice.'
        });
        return { ok: false };
      }
      // ActionRequired means the command ran and deliberately wrote nothing
      // (NeedsReview): not an error, but not done either.
      if (!response.ok || response.outcome.status === 'ActionRequired') {
        setOutcome(response.outcome);
        return { ok: false };
      }
      ids.current[slot] = newCommandId();
      toast.success(response.outcome.message);
      const result = response.result as {
        work_package?: { version?: number };
        allocation?: { id?: string };
      } | null;
      return {
        ok: true,
        workPackageVersion: result?.work_package?.version,
        allocationId: result?.allocation?.id
      };
    },
    []
  );

  // The dialog opens with the dates the drop proposed; the user can still
  // adjust them here, which is also the keyboard route to the same change.
  useEffect(() => {
    if (!proposal) return;
    setStart(proposal.to.start);
    setEnd(proposal.to.end);
    setReason('');
    setCandidate(null);
    setOutcome(null);
    ids.current = { move: newCommandId(), reassign: newCommandId() };
  }, [proposal]);

  const trade = proposal?.event.kind;
  const personId =
    proposal?.kind === 'reassign'
      ? proposal.toPersonId
      : (proposal?.event.work?.personId ?? null);

  // Readiness for the dates now in the form, for the person who would do it.
  useEffect(() => {
    if (!proposal || !personId || !start || !end) return;
    if (trade !== 'Roof' && trade !== 'Electrical') return;
    let live = true;
    setChecking(true);
    assessInstallers({ trade, start_at: start, end_at: end }).then((r) => {
      if (!live) return;
      setChecking(false);
      setCandidate(
        r.ok
          ? (r.data.candidates.find((c) => c.person_id === personId) ?? null)
          : null
      );
    });
    return () => {
      live = false;
    };
  }, [proposal, personId, start, end, trade]);

  if (!proposal) return null;
  const event = proposal.event;
  const work = event.work;
  const commands = plannedCommands(proposal);
  const datesMoved =
    start !== event.start || end !== event.end || proposal.kind === 'move';

  const submit = async () => {
    if (!work?.allocationId || pending) return;
    setPending(true);
    setOutcome(null);
    try {
      // A reassignment that also moves is genuinely two commands: the backend
      // has no combined one. The move goes first, so a refusal of the second
      // leaves the work on the new dates with its original installer - a state
      // the planner shows honestly - rather than on the old dates with a new
      // one.
      const movesDates = proposal.kind === 'move' || proposal.datesChanged;
      // Carried between the two commands: MOVE_WORK_PACKAGE bumps the work
      // package and returns the row it wrote, so the reassignment sends the
      // version that now exists instead of the one this dialog opened with
      // (which would be refused as R1A_STALE_VERSION by our own first step).
      let version = work.workPackageVersion;
      let allocationId = work.allocationId;

      if (movesDates) {
        const moved = await runOne('move', {
          command_type: 'MOVE_WORK_PACKAGE',
          job_id: event.jobId,
          work_package_id: work.workPackageId,
          expected_version: version,
          payload: {
            allocation_id: allocationId,
            start_at: start,
            end_at: end,
            reason
          }
        });
        // Stale either way: a refusal may have been a version conflict, and a
        // success changed the row.
        router.refresh();
        if (!moved.ok) return;
        version = moved.workPackageVersion ?? version;
        allocationId = moved.allocationId ?? allocationId;
      }

      if (proposal.kind === 'reassign') {
        const reassigned = await runOne('reassign', {
          command_type: 'CHANGE_INSTALLER_R2',
          job_id: event.jobId,
          work_package_id: work.workPackageId,
          old_allocation_id: allocationId ?? undefined,
          expected_version: version,
          payload: {
            mode: 'Replace',
            person_id: proposal.toPersonId,
            reason
          }
        });
        router.refresh();
        if (!reassigned.ok) return;
      }
      onDone();
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {proposal.kind === 'move'
              ? `Move ${KIND_LABEL[event.kind].toLowerCase()}`
              : 'Reassign and move'}
          </DialogTitle>
          <DialogDescription>{describeProposal(proposal)}</DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4 text-sm'>
          <div className='bg-muted/40 flex flex-col gap-1 rounded-lg border p-3'>
            <p className='font-medium'>
              {event.jobDisplay ?? 'This job'}{' '}
              <Link
                href={`/dashboard/jobs/${event.jobId}`}
                className='font-mono text-xs underline'
              >
                {event.jobRef}
              </Link>
            </p>
            <p className='flex flex-wrap items-center gap-2'>
              <span className='text-muted-foreground'>
                {formatMedium(event.start)}
                {event.end !== event.start && ` – ${formatMedium(event.end)}`}
              </span>
              <IconArrowRight className='size-3.5' aria-hidden />
              <span className='font-medium'>
                {formatMedium(start)}
                {end !== start && ` – ${formatMedium(end)}`}
              </span>
            </p>
            <p className='text-muted-foreground'>
              Installer:{' '}
              {proposal.kind === 'reassign'
                ? `${work?.personName ?? 'unknown'} → ${proposal.toPersonName}`
                : (work?.personName ?? 'unknown')}
            </p>
          </div>

          {commands.length > 1 && (
            <Alert>
              <AlertTitle>This is two changes</AlertTitle>
              <AlertDescription>
                There is no single command that moves work and changes who does
                it, so this runs two: the dates move first, then the installer
                changes. Both are audited separately, and if the second is
                refused the first still stands. The move is checked against{' '}
                {work?.personName ?? 'the current installer'}&rsquo;s
                availability on the new dates, because they still hold the work
                at that point.
              </AlertDescription>
            </Alert>
          )}

          {datesMoved && (
            <div className='grid grid-cols-2 gap-3'>
              <TextField
                label='New start'
                type='date'
                required
                value={start}
                onChange={setStart}
              />
              <TextField
                label='New end'
                type='date'
                required
                value={end}
                onChange={setEnd}
              />
            </div>
          )}

          {checking && (
            <p className='text-muted-foreground flex items-center gap-2'>
              <IconLoader2 className='size-4 animate-spin' /> Checking whether
              they are free…
            </p>
          )}
          {!checking && candidate && (
            <p className='flex flex-wrap items-center gap-2'>
              <Badge variant={candidate.ready ? 'success' : 'warning'}>
                {candidate.ready ? 'Free' : 'Not ready'}
              </Badge>
              <span className='text-muted-foreground'>
                {candidate.display_name}
                {[...candidate.reasons, ...candidate.warnings].length > 0 &&
                  ` · ${[...candidate.reasons, ...candidate.warnings]
                    .map((r) => READINESS_REASON[r] ?? r)
                    .join(', ')}`}
              </span>
            </p>
          )}
          {!checking && candidate && !candidate.ready && (
            <p className='text-muted-foreground text-xs'>
              You can still try: the system will check again when you confirm
              and refuse it with the reason if it still applies.
            </p>
          )}

          <ScaffoldNote event={event} />

          <NoteField
            label='Reason for the change'
            required
            value={reason}
            onChange={setReason}
          />
          {outcome && <OutcomeAlert outcome={outcome} />}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !reason.trim()}>
            {pending && <IconLoader2 className='size-4 animate-spin' />}
            {proposal.kind === 'move'
              ? `Move ${KIND_LABEL[event.kind].toLowerCase()}`
              : 'Apply changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Scaffold does not follow an install automatically, and this dialog will not
 * make it. Says so where the user is about to move the install.
 */
function ScaffoldNote({ event }: { event: CalendarEvent }) {
  return (
    <p className='text-muted-foreground text-xs'>
      Scaffold dates are not changed by this. If the scaffold needs to move too,
      use{' '}
      <Link href={`/dashboard/jobs/${event.jobId}/move`} className='underline'>
        Move job
      </Link>
      , which previews the scaffold, materials and every trade together before
      anything changes.
    </p>
  );
}
