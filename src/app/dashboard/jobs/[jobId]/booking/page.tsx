import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import {
  bookingReason,
  ConfirmBookingButton,
  GateList
} from '@/features/booking/components/booking-actions';
import { BookingForm } from '@/features/booking/components/booking-form';
import { reasonLabel } from '@/features/booking/labels';
import { formatDateTime } from '@/features/jobs/format';
import { stageLabel } from '@/features/jobs/stages';
import { getCurrentUser } from '@/lib/auth';
import type { BookingFormRead } from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import { IconArrowLeft } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Job booking | Simple Solar Operations'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobBookingPage({
  params
}: {
  params: Promise<{ jobId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const { jobId } = await params;
  if (!UUID.test(jobId)) notFound();

  const result = await readOps<BookingFormRead>('BOOKING_FORM', {
    job_id: jobId
  });
  if (!result.ok) {
    if (result.error.kind === 'not_found') notFound();
    return (
      <PageContainer>
        <ReadFailureState failure={result.error} />
      </PageContainer>
    );
  }
  const data = result.data;
  const flag = data.commands.booking_intake;
  const lastIntake = data.current.last_intake;

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'job',
          jobId: data.job.id,
          jobRef: data.job.job_ref,
          customerName:
            [data.customer.first_name, data.customer.last_name]
              .filter(Boolean)
              .join(' ') || 'Customer',
          workflowStage: data.job.workflow_stage
        }}
      />
      <div className='flex w-full max-w-5xl flex-col gap-4'>
        <Button asChild variant='ghost' size='sm' className='-ml-2 w-fit'>
          <Link href={`/dashboard/jobs/${data.job.id}`}>
            <IconArrowLeft /> {data.job.job_ref}
          </Link>
        </Button>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h1 className='text-2xl font-bold'>
              Job booking · {data.job.job_ref}
            </h1>
            <p className='text-muted-foreground text-sm'>
              {stageLabel(data.job.workflow_stage)}
              {data.job.booking_submitted &&
                ' · booking already received; submitting again updates it'}
            </p>
          </div>
          {data.job.workflow_stage === 'BookingInProgress' && (
            <ConfirmBookingButton
              jobId={data.job.id}
              jobRef={data.job.job_ref}
              version={data.job.version}
              flag={data.commands.confirm_booking}
              gates={data.gates}
              size='default'
            />
          )}
        </div>

        {(data.gates || lastIntake) && (
          <div className='grid gap-4 md:grid-cols-2'>
            {data.gates && (
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    {data.job.workflow_stage === 'Prebooking'
                      ? 'Prebooking checks'
                      : 'Booking checks'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <GateList gates={data.gates} />
                </CardContent>
              </Card>
            )}
            {lastIntake && (
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>
                    Last booking received
                  </CardTitle>
                </CardHeader>
                <CardContent className='text-sm'>
                  <p>
                    {formatDateTime(lastIntake.received_at)} ·{' '}
                    <span
                      className={
                        lastIntake.status === 'Review'
                          ? 'text-warning font-medium'
                          : 'font-medium'
                      }
                    >
                      {lastIntake.status === 'Review'
                        ? 'In Intake Review'
                        : lastIntake.status}
                    </span>
                  </p>
                  {lastIntake.errors.length > 0 && (
                    <ul className='text-muted-foreground mt-2 list-disc pl-5'>
                      {lastIntake.errors.map((e, i) => (
                        <li key={i}>
                          {reasonLabel(e.error)}
                          {e.field && ` (${e.field})`}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {flag.available ? (
          <BookingForm data={data} />
        ) : (
          <p className='bg-muted rounded-md px-3 py-2 text-sm'>
            The booking form is not available:{' '}
            {bookingReason(flag) ?? 'this job is not at a booking step.'}
          </p>
        )}
      </div>
    </PageContainer>
  );
}
