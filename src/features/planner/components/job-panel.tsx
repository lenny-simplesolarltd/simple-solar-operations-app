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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  IconArrowsExchange,
  IconCalendarPlus,
  IconExternalLink,
  IconHistory,
  IconTool
} from '@tabler/icons-react';
import Link from 'next/link';
import type { CalendarEvent } from '../calendar/events';
import { KIND_LABEL, isHistorical, siblingEvents } from '../calendar/events';
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
  const historical = isHistorical(event);

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent className='flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md'>
        <SheetHeader>
          <SheetTitle className='flex flex-wrap items-center gap-2'>
            {event.jobDisplay ?? (historical ? 'Historical record' : 'Scheduled work')}
            {historical && <Badge variant='outline'>Historical</Badge>}
          </SheetTitle>
          <SheetDescription>
            <span className='font-mono'>{event.jobRef}</span> ·{' '}
            {KIND_LABEL[event.kind]}
          </SheetDescription>
        </SheetHeader>

        <div className='flex flex-col gap-4 p-4 text-sm'>
          {historical && (
            <Alert>
              <IconHistory />
              <AlertTitle>Imported record</AlertTitle>
              <AlertDescription>
                A date preserved from the old Job Booking form. It is not
                scheduled work: nothing is booked, nobody is allocated, and it
                cannot be moved or rescheduled.
              </AlertDescription>
            </Alert>
          )}
          <Field label={historical ? 'Recorded date' : 'Scheduled'}>
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

          {event.historical && (
            <>
              {(event.town || event.postcode) && (
                <Field label='Address'>
                  {[event.town, event.postcode].filter(Boolean).join(' · ')}
                </Field>
              )}
              {event.historical.scaffoldCompany && (
                <Field label='Scaffolder'>
                  {event.historical.scaffoldCompany}
                </Field>
              )}
              {event.historical.people.length > 0 && (
                <Field label='Staff recorded'>
                  <ul className='flex flex-col gap-1'>
                    {event.historical.people.map((p) => (
                      <li key={`${p.role}:${p.sourceValue}`}>
                        {/*
                          A link only where the import was certain. Where it
                          was not, the original text stands on its own - the
                          planner never guesses which current person a name
                          meant.
                        */}
                        {p.linked ? (
                          <>
                            {p.displayName}
                            <span className='text-muted-foreground text-xs'>
                              {' '}
                              · {p.role} · recorded as &ldquo;{p.sourceValue}
                              &rdquo;
                            </span>
                          </>
                        ) : (
                          <>
                            &ldquo;{p.sourceValue}&rdquo;
                            <span className='text-muted-foreground text-xs'>
                              {' '}
                              · {p.role} ·{' '}
                              {p.matchKind === 'Ambiguous'
                                ? 'more than one person matches, so it is left as recorded'
                                : 'nobody here matches this name'}
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
              <Field label='Where this came from'>
                <span className='text-muted-foreground'>
                  {event.historical.sourceField}
                  {event.historical.sourceSystem &&
                    ` · ${event.historical.sourceSystem}`}
                  {event.historical.sourceReference &&
                    ` · ${event.historical.sourceReference}`}
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
                  {historical
                    ? 'Everything recorded for this job by the old booking form.'
                    : 'Moving one of these does not move the others. To move a whole job together, use Move job.'}
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
            {/*
              Note the `event.work` guard: a historical event has no work
              package, no version and no allocation, so these buttons have
              nothing to build a command from. They are absent because there is
              no entity behind them, not because they were hidden.
            */}
            {canPlan && !historical && event.work && (
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
            {canPlan && !historical && (
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
            {historical
              ? 'Open job shows the full imported record, exactly as it was received.'
              : 'Contact details, materials, issues and history live on the job itself, so there is one place they are right.'}
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
