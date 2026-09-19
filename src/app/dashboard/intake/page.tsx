import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { fieldLabel, reasonLabel } from '@/features/booking/labels';
import { formatDateTime } from '@/features/jobs/format';
import { stageLabel } from '@/features/jobs/stages';
import { getCurrentUser } from '@/lib/auth';
import type { IntakeReviewRead } from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Intake review | Simple Solar Operations'
};

export default async function IntakeReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const result = await readOps<IntakeReviewRead>('INTAKE_REVIEW_QUEUE');

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'intake-review' }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Intake review'
          description='Bookings that did not match the sale. Nothing here was applied to the customer record. To deal with an item, correct the booking with the booking form: the corrected booking is what counts. Items are not ticked off here (the old system had no resolve step either).'
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : result.data.items.length === 0 ? (
          <EmptyState
            title='Nothing to review'
            description='Bookings that need a decision appear here.'
          />
        ) : (
          <ul className='flex flex-col gap-3'>
            {result.data.items.map((item) => {
              const reasons = item.errors
                .map((e) => e.error)
                .filter((e, i, all) => all.indexOf(e) === i);
              return (
                <li
                  key={item.id}
                  className='bg-card flex flex-col gap-3 rounded-lg border p-4'
                >
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div>
                      {item.job ? (
                        <p>
                          <span className='font-mono font-semibold'>
                            {item.job.job_ref}
                          </span>
                          <span className='text-muted-foreground'>
                            {' '}
                            ·{' '}
                            {[item.job.customer_name, item.job.postcode]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </p>
                      ) : (
                        <p className='font-medium'>
                          Unlinked {item.form_type.toLowerCase()} form
                        </p>
                      )}
                      <p className='text-muted-foreground text-xs'>
                        {item.form_type} form received{' '}
                        {formatDateTime(item.received_at)}
                        {item.job &&
                          ` · ${stageLabel(item.job.workflow_stage)}`}
                      </p>
                    </div>
                    {item.job?.can_open && (
                      <div className='flex flex-wrap gap-2'>
                        <Button asChild size='sm' variant='outline'>
                          <Link href={`/dashboard/jobs/${item.job.id}`}>
                            Open job
                          </Link>
                        </Button>
                        <Button asChild size='sm' variant='outline'>
                          <Link href={`/dashboard/jobs/${item.job.id}/booking`}>
                            Booking form
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                  {reasons.length > 0 && (
                    <div className='flex flex-wrap gap-1.5'>
                      {reasons.map((r) => (
                        <Badge key={r} variant='warning'>
                          {reasonLabel(r)}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {item.customer_changes.length > 0 && (
                    <div className='overflow-x-auto'>
                      <table className='w-full min-w-[28rem] text-sm'>
                        <thead className='text-muted-foreground text-left text-xs'>
                          <tr>
                            <th className='py-1 font-medium'>Field</th>
                            <th className='py-1 font-medium'>On the sale</th>
                            <th className='py-1 font-medium'>On the booking</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.customer_changes.map((c) => (
                            <tr key={c.field_name} className='border-t'>
                              <td className='py-1.5'>
                                {fieldLabel(c.field_name)}
                              </td>
                              <td className='py-1.5'>
                                {c.previous_value ?? '—'}
                              </td>
                              <td className='py-1.5 font-medium'>
                                {c.incoming_value ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
