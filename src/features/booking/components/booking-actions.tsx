'use client';

import { Button } from '@/components/ui/button';
import { CommandDialog } from '@/features/operations/command-dialog';
import { useCommand } from '@/features/operations/use-command';
import type { GateSummary } from '@/lib/backend/models';
import type { CommandFlag } from '@/lib/backend/types';
import { IconCalendarCheck, IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { bookingReason } from '../booking-reasons';
import { gateLabel } from '../labels';

/**
 * CONFIRM_BOOKING: BookingInProgress -> Booked when every booking gate passes.
 * The dialog is the "Confirm Booking Result" of the old app: the server's
 * answer (booked, already booked, or which checks are outstanding) is shown
 * in place.
 */
export function ConfirmBookingButton({
  jobId,
  jobRef,
  version,
  flag,
  gates,
  size = 'sm'
}: {
  jobId: string;
  jobRef: string;
  version: number;
  flag: CommandFlag;
  gates: GateSummary | null;
  size?: 'sm' | 'default';
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, outcome, reset } = useCommand();
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };
  return (
    <>
      <Button
        size={size}
        disabled={!flag.available}
        title={bookingReason(flag)}
        onClick={() => setOpen(true)}
      >
        <IconCalendarCheck /> Confirm booking
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={`Confirm booking ${jobRef}`}
        description='This moves the job to Booked, records you as the approver and creates the pre-install tasks. It cannot be undone from here.'
        submitLabel='Confirm booking'
        pending={pending}
        outcome={outcome}
        onSubmit={() =>
          run(
            {
              command_type: 'CONFIRM_BOOKING',
              job_id: jobId,
              expected_version: version,
              payload: {}
            },
            (r) => r.ok && close(false)
          )
        }
      >
        {gates && gates.failing.length > 0 ? (
          <GateList gates={gates} />
        ) : (
          <p className='text-muted-foreground text-sm'>
            All booking checks pass.
          </p>
        )}
      </CommandDialog>
    </>
  );
}

/** BOOKING_GATES: re-evaluates readiness / booking checks now (e.g. after fixing data). */
export function RecheckGatesButton({
  jobId,
  version
}: {
  jobId: string;
  version: number;
}) {
  const { run, pending, outcome } = useCommand();
  return (
    <span className='inline-flex flex-col gap-1'>
      <Button
        size='sm'
        variant='outline'
        disabled={pending}
        onClick={() =>
          run({
            command_type: 'BOOKING_GATES',
            job_id: jobId,
            expected_version: version,
            payload: {}
          })
        }
      >
        <IconRefresh className={pending ? 'animate-spin' : undefined} />{' '}
        Re-check
      </Button>
      {outcome && (
        <span className='text-destructive max-w-56 text-xs'>
          {outcome.message}
        </span>
      )}
    </span>
  );
}

export function GateList({
  gates,
  compact = false
}: {
  gates: GateSummary;
  compact?: boolean;
}) {
  if (gates.failing.length === 0) {
    return <p className='text-success text-sm font-medium'>All checks pass</p>;
  }
  return (
    <ul className={compact ? 'flex flex-wrap gap-1' : 'flex flex-col gap-1.5'}>
      {gates.failing.map((g) =>
        compact ? (
          <li
            key={g.name}
            title={g.detail ?? undefined}
            className={
              g.blocking
                ? 'bg-destructive-soft text-destructive rounded-full px-2 py-0.5 text-xs'
                : 'bg-warning-soft text-warning rounded-full px-2 py-0.5 text-xs'
            }
          >
            {gateLabel(g.name)}
          </li>
        ) : (
          <li key={g.name} className='text-sm'>
            <span
              className={
                g.blocking
                  ? 'text-destructive font-medium'
                  : 'text-warning font-medium'
              }
            >
              {gateLabel(g.name)}
            </span>
            {g.detail && (
              <span className='text-muted-foreground block text-xs'>
                {g.detail}
              </span>
            )}
          </li>
        )
      )}
    </ul>
  );
}
