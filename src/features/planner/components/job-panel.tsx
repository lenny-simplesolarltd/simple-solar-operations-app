'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  IconArrowsExchange,
  IconCalendarPlus,
  IconExternalLink,
  IconTool
} from '@tabler/icons-react';
import Link from 'next/link';
import type { CalendarEvent } from '../calendar/events';
import { KIND_LABEL, siblingEvents } from '../calendar/events';
import { canDrag } from '../calendar/moves';
import { formatMedium } from '../calendar/range';

/**
 * What a calendar event opens: enough to decide, and a way through to the
 * canonical Job Detail for everything else.
 *
 * This panel deliberately does NOT restate Job Detail. It shows what the
 * planner already has in hand from the window read - no second query - and
 * every deeper question ("what are the materials", "who is the customer",
 * "what are the issues") is a link to the page that owns it.
 */
export function JobPanel({
  event,
  allEvents,
  canPlan,
  onClose,
  onMove,
  onReassign
}: {
  event: CalendarEvent | null;
  allEvents: CalendarEvent[];
  canPlan: boolean;
  onClose: () => void;
  onMove: (event: CalendarEvent) => void;
  onReassign: (event: CalendarEvent) => void;
}) {
  if (!event) return null;
  const siblings = siblingEvents(allEvents, event);
  const drag = canDrag(event);

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent className='flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md'>
        <SheetHeader>
          <SheetTitle>{event.jobDisplay ?? 'Scheduled work'}</SheetTitle>
          <SheetDescription>
            <span className='font-mono'>{event.jobRef}</span> ·{' '}
            {KIND_LABEL[event.kind]}
          </SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-4 p-4 text-sm'>
          <Field label='Scheduled'>
            {formatMedium(event.start)}
            {event.end !== event.start && ` – ${formatMedium(event.end)}`}
          </Field>

          {event.work && (
            <>
              <Field label='Status'>
                <Badge variant='secondary'>{event.work.status}</Badge>
              </Field>
              <Field label='Installer'>
                {event.work.allocated ? (
                  <>
                    {event.work.personName}
                    <span className='text-muted-foreground'>
                      {' '}
                      · {event.work.role}
                    </span>
                  </>
                ) : (
                  <Badge variant='warning'>Nobody allocated</Badge>
                )}
              </Field>
              {(event.work.plannedStart !== event.start ||
                event.work.plannedEnd !== event.end) && (
                <Field label='Planned dates'>
                  <span className='text-muted-foreground'>
                    {formatMedium(event.work.plannedStart)} –{' '}
                    {formatMedium(event.work.plannedEnd)} (the allocation
                    differs)
                  </span>
                </Field>
              )}
            </>
          )}

          {event.scaffold && (
            <>
              <Field label='Scaffolder'>
                {event.scaffold.company ?? 'Not set'}
              </Field>
              <Field label='Booking'>
                <span className='flex flex-wrap items-center gap-2'>
                  <Badge variant='secondary'>{event.scaffold.status}</Badge>
                  {!event.scaffold.acknowledged && (
                    <Badge variant='warning'>Not acknowledged</Badge>
                  )}
                  {event.scaffold.actualRecorded && (
                    <Badge variant='success'>Done</Badge>
                  )}
                </span>
              </Field>
            </>
          )}

          {siblings.length > 0 && (
            <>
              <Separator />
              <div className='flex flex-col gap-2'>
                <h3 className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
                  Everything else scheduled on this job
                </h3>
                <ul className='flex flex-col gap-1'>
                  {siblings.map((s) => (
                    <li
                      key={s.id}
                      className='flex items-baseline justify-between gap-2'
                    >
                      <span>{KIND_LABEL[s.kind]}</span>
                      <span className='text-muted-foreground tabular-nums'>
                        {formatMedium(s.start)}
                        {s.end !== s.start && ` – ${formatMedium(s.end)}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className='text-muted-foreground text-xs'>
                  Moving one of these does not move the others. To move a whole
                  job together, use Move job.
                </p>
              </div>
            </>
          )}

          <Separator />

          <div className='flex flex-col gap-2'>
            {/*
              The keyboard route to every drag. Drag and drop is an
              enhancement; these buttons are the operation.
            */}
            {canPlan && event.work && (
              <>
                <Button
                  variant='outline'
                  className='justify-start'
                  disabled={!drag.ok}
                  onClick={() => onMove(event)}
                >
                  <IconCalendarPlus /> Change the dates
                </Button>
                <Button
                  variant='outline'
                  className='justify-start'
                  disabled={!drag.ok}
                  onClick={() => onReassign(event)}
                >
                  <IconArrowsExchange /> Change the installer
                </Button>
                {!drag.ok && (
                  <p className='text-muted-foreground text-xs'>{drag.reason}</p>
                )}
              </>
            )}
            <Button asChild variant='outline' className='justify-start'>
              <Link href={`/dashboard/jobs/${event.jobId}`}>
                <IconExternalLink /> Open job
              </Link>
            </Button>
            {canPlan && (
              <Button asChild variant='outline' className='justify-start'>
                <Link href={`/dashboard/jobs/${event.jobId}/move`}>
                  <IconCalendarPlus /> Move job (all trades and scaffold)
                </Link>
              </Button>
            )}
            {event.scaffold && (
              <Button asChild variant='outline' className='justify-start'>
                <Link
                  href={`/dashboard/scaffold/${event.scaffold.scaffoldBookingId}`}
                >
                  <IconTool /> View scaffold booking
                </Link>
              </Button>
            )}
          </div>

          <p className='text-muted-foreground text-xs'>
            Contact details, materials, issues and history live on the job
            itself, so there is one place they are right.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
