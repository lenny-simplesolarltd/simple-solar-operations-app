import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/features/jobs/format';
import type { BookingBoardRow, BookingView } from '@/lib/backend/models';
import Link from 'next/link';
import {
  ConfirmBookingButton,
  GateList,
  RecheckGatesButton
} from './booking-actions';

function Schedule({ row }: { row: BookingBoardRow }) {
  const s = row.schedule;
  const parts = [
    s.roof_date && `Roof ${formatDate(s.roof_date)}`,
    s.electrical_date && `Electrics ${formatDate(s.electrical_date)}`,
    s.scaffold_date && `Scaffold ${formatDate(s.scaffold_date)}`
  ].filter(Boolean);
  if (parts.length === 0)
    return <span className='text-muted-foreground text-xs'>No dates yet</span>;
  return (
    <span className='text-xs'>
      {parts.join(' · ')}
      {s.team.length > 0 && (
        <span className='text-muted-foreground block'>
          {s.team.map((t) => t.name ?? 'Unknown').join(', ')}
        </span>
      )}
    </span>
  );
}

function Actions({ row, view }: { row: BookingBoardRow; view: BookingView }) {
  const bookingFlag = row.commands.booking_intake;
  return (
    <div className='flex flex-wrap items-start gap-2'>
      {view !== 'upcoming' && bookingFlag?.available && (
        <Button
          asChild
          size='sm'
          variant={view === 'ready' ? 'default' : 'outline'}
        >
          <Link href={`/dashboard/jobs/${row.id}/booking`}>
            {row.booking_submitted ? 'Update booking' : 'Booking form'}
          </Link>
        </Button>
      )}
      {view === 'in_progress' && row.commands.confirm_booking && (
        <ConfirmBookingButton
          jobId={row.id}
          jobRef={row.job_ref}
          version={row.version}
          flag={row.commands.confirm_booking}
          gates={row.gates}
        />
      )}
      {(view === 'in_progress' || view === 'prebooking') &&
        bookingFlag?.available && (
          <RecheckGatesButton jobId={row.id} version={row.version} />
        )}
    </div>
  );
}

/** One booking view. Cards at every width: each row carries its own actions. */
export function BookingBoard({
  rows,
  view
}: {
  rows: BookingBoardRow[];
  view: BookingView;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title='Nothing at this step'
        description='Jobs appear here as they move through booking.'
      />
    );
  }
  return (
    <ul className='flex flex-col gap-2'>
      {rows.map((row) => (
        <li
          key={row.id}
          className='bg-card grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1.2fr)_auto] md:items-start'
        >
          <div className='min-w-0'>
            <Link
              href={`/dashboard/jobs/${row.id}`}
              className='font-mono font-semibold hover:underline'
            >
              {row.job_ref}
            </Link>
            <p className='text-muted-foreground text-xs'>
              {[row.customer_name, row.postcode].filter(Boolean).join(' · ')}
            </p>
            <div className='mt-1 flex flex-wrap gap-1'>
              {row.in_review && <Badge variant='warning'>Intake review</Badge>}
              {row.finance_route && row.finance_route !== 'Standard' && (
                <Badge variant='outline'>{row.finance_route}</Badge>
              )}
              {row.open_booking_tasks > 0 && (
                <Badge variant='secondary'>
                  {row.open_booking_tasks} open booking tasks
                </Badge>
              )}
            </div>
          </div>
          <div>
            <Schedule row={row} />
            {row.sold_at && (
              <p className='text-muted-foreground text-xs'>
                Sold {formatDate(row.sold_at)}
                {row.salesperson_name && ` by ${row.salesperson_name}`}
              </p>
            )}
          </div>
          <div>{row.gates ? <GateList gates={row.gates} compact /> : null}</div>
          <Actions row={row} view={view} />
        </li>
      ))}
    </ul>
  );
}
