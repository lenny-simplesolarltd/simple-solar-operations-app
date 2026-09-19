import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { TaskStatusBadge } from '@/components/task-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate, formatDateTime } from '@/features/jobs/format';
import { ScaffoldBookingActions } from '@/features/scaffold/components/scaffold-actions';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Scaffold booking | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScaffoldBookingRead {
  found: boolean;
  booking: {
    id: string;
    job_id: string;
    version: number;
    status: string;
    revision: number | null;
    erect_planned_at: string | null;
    erect_actual_at: string | null;
    strip_forecast_at: string | null;
    strip_planned_at: string | null;
    strip_actual_at: string | null;
    access_notes: string | null;
    quoted_cost_pence: number | null;
    actual_cost_pence: number | null;
  };
  job: {
    id: string;
    job_reference: string;
    display_name: string | null;
    customer_happy_at: string | null;
  } | null;
  company: {
    name: string;
    contacts: { contact_id: string; name: string; email: string }[];
  } | null;
  acknowledgement_required: boolean;
  strip_blockers: string[];
  next_action: string | null;
  tasks: {
    id: string;
    template_code: string;
    title: string;
    status: string;
    due_at: string | null;
  }[];
  communications: {
    id: string;
    type: string;
    revision: number | null;
    status: string;
  }[];
  issues: {
    id: string;
    category: string;
    status: string;
    blocks_strip: boolean;
  }[];
}

const BLOCKER: Record<string, string> = {
  CUSTOMER_NOT_HAPPY: 'The customer has not been confirmed happy yet',
  NOT_ERECTED: 'The scaffold is not recorded as up'
};
const day = (v: string | null) => (v ? formatDate(v) : '—');

export default async function ScaffoldBookingPage({
  params
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { bookingId } = await params;
  if (!UUID.test(bookingId)) notFound();
  const result = await readOps<ScaffoldBookingRead>('SCAFFOLD_BOOKING', {
    booking_id: bookingId
  });
  if (result.ok && !result.data.found) notFound();

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'scaffold', view: 'booking' }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href='/dashboard/scaffold'>
            <IconArrowLeft /> Scaffold bookings
          </Link>
        </Button>
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : (
          <>
            <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between'>
              <div>
                <h1 className='text-2xl font-bold'>
                  Scaffold · {result.data.job?.job_reference}
                </h1>
                <div className='mt-1 flex flex-wrap items-center gap-2 text-sm'>
                  <Badge variant='outline'>{result.data.booking.status}</Badge>
                  {result.data.acknowledgement_required && (
                    <Badge variant='warning'>Awaiting scaffolder</Badge>
                  )}
                  <span className='text-muted-foreground'>
                    {result.data.company?.name ?? 'No scaffolder'} · revision{' '}
                    {result.data.booking.revision ?? 1}
                  </span>
                  {result.data.job && (
                    <Link
                      href={`/dashboard/jobs/${result.data.job.id}`}
                      className='underline underline-offset-4'
                    >
                      open job
                    </Link>
                  )}
                </div>
                {result.data.next_action && (
                  <p className='text-muted-foreground mt-1 text-sm'>
                    Next: {result.data.next_action}
                  </p>
                )}
              </div>
              {isOfficeManager(user) && (
                <ScaffoldBookingActions booking={result.data.booking} />
              )}
            </div>

            {result.data.strip_blockers.length > 0 && (
              <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
                Strip blocked:{' '}
                {result.data.strip_blockers
                  .map(
                    (b) =>
                      BLOCKER[b] ??
                      (b.startsWith('STRIP_BLOCKING_ISSUES')
                        ? 'An open complaint blocks the strip'
                        : b)
                  )
                  .join('; ')}
              </p>
            )}

            <div className='grid gap-4 md:grid-cols-2'>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>Dates</CardTitle>
                </CardHeader>
                <CardContent className='grid grid-cols-2 gap-2 text-sm'>
                  <span className='text-muted-foreground'>Up (planned)</span>
                  <span>{day(result.data.booking.erect_planned_at)}</span>
                  <span className='text-muted-foreground'>Up (actual)</span>
                  <span>{day(result.data.booking.erect_actual_at)}</span>
                  <span className='text-muted-foreground'>Down (forecast)</span>
                  <span>{day(result.data.booking.strip_forecast_at)}</span>
                  <span className='text-muted-foreground'>Down (planned)</span>
                  <span>{day(result.data.booking.strip_planned_at)}</span>
                  <span className='text-muted-foreground'>Down (actual)</span>
                  <span>{day(result.data.booking.strip_actual_at)}</span>
                  {result.data.booking.access_notes && (
                    <>
                      <span className='text-muted-foreground'>Access</span>
                      <span>{result.data.booking.access_notes}</span>
                    </>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Tasks, messages & complaints
                  </CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-1.5 text-sm'>
                  {result.data.tasks.map((t) => (
                    <div
                      key={t.id}
                      className='flex items-center justify-between gap-2'
                    >
                      <Link
                        href={`/dashboard/tasks/${t.id}`}
                        className='hover:underline'
                      >
                        <span className='text-muted-foreground font-mono text-xs'>
                          {t.template_code}
                        </span>{' '}
                        {t.title}
                      </Link>
                      <TaskStatusBadge status={t.status} />
                    </div>
                  ))}
                  {result.data.communications.map((c) => (
                    <p key={c.id} className='text-muted-foreground text-xs'>
                      {c.type} rev {c.revision ?? '-'} · {c.status}
                    </p>
                  ))}
                  {result.data.issues.map((i) => (
                    <p key={i.id} className='text-xs'>
                      Complaint · {i.category} · {i.status}
                      {i.blocks_strip && ' · blocks strip'}
                    </p>
                  ))}
                  {result.data.tasks.length +
                    result.data.issues.length +
                    result.data.communications.length ===
                    0 && <p className='text-muted-foreground'>Nothing yet.</p>}
                </CardContent>
              </Card>
            </div>
            {result.data.job?.customer_happy_at && (
              <p className='text-muted-foreground text-xs'>
                Customer confirmed happy{' '}
                {formatDateTime(result.data.job.customer_happy_at)}.
              </p>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
