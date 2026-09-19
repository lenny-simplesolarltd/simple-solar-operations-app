import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate } from '@/features/jobs/format';
import { ListFilters } from '@/features/operations/list-filters';
import {
  RequestScaffold,
  ScaffoldHousekeeping
} from '@/features/scaffold/components/scaffold-actions';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Scaffold bookings | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

interface ScaffoldBoardRead {
  bookings: {
    booking_id: string;
    status: string;
    acknowledgement_required: boolean;
    erect_planned_at: string | null;
    erect_actual_at: string | null;
    strip_forecast_at: string | null;
    strip_planned_at: string | null;
    strip_actual_at: string | null;
    company: string | null;
    job_id: string;
    job_ref: string;
    customer_name: string | null;
    postcode: string | null;
    customer_happy: boolean;
    open_complaints: number;
  }[];
  needs_request: {
    job_id: string;
    job_ref: string;
    job_version: number;
    workflow_stage: string;
    customer_name: string | null;
    postcode: string | null;
    install_date: string | null;
  }[];
  scaffolders: { id: string; name: string }[];
}

const day = (v: string | null) => (v ? formatDate(v) : '—');

export default async function ScaffoldPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const requested = first((await searchParams).view);
  const view = ['active', 'finished', 'all'].includes(requested)
    ? requested
    : 'active';
  const result = await readOps<ScaffoldBoardRead>('SCAFFOLD_BOARD', { view });
  const canAct = isOfficeManager(user);

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'scaffold', view }}
      />
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title='Scaffold bookings'
            description='Every scaffold from request to strip, and jobs that still need one requested.'
          />
          {canAct && <ScaffoldHousekeeping />}
        </div>
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : (
          <>
            {result.data.needs_request.length > 0 && (
              <section className='flex flex-col gap-2'>
                <h2 className='text-lg font-semibold'>Needs requesting</h2>
                <ul className='flex flex-col gap-2'>
                  {result.data.needs_request.map((j) => (
                    <li
                      key={j.job_id}
                      className='bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm'
                    >
                      <span>
                        <Link
                          href={`/dashboard/jobs/${j.job_id}`}
                          className='font-mono font-semibold hover:underline'
                        >
                          {j.job_ref}
                        </Link>
                        <span className='text-muted-foreground block text-xs'>
                          {[j.customer_name, j.postcode]
                            .filter(Boolean)
                            .join(' · ')}
                          {j.install_date &&
                            ` · install ${day(j.install_date)}`}
                        </span>
                      </span>
                      {canAct && (
                        <RequestScaffold
                          jobId={j.job_id}
                          jobVersion={j.job_version}
                          scaffolders={result.data.scaffolders}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ListFilters
              defaults={{ view: 'active' }}
              tabs={{
                key: 'view',
                label: 'Bookings',
                options: [
                  { value: 'active', label: 'Active' },
                  { value: 'finished', label: 'Down or cancelled' },
                  { value: 'all', label: 'All' }
                ]
              }}
            />
            {result.data.bookings.length === 0 ? (
              <EmptyState title='No scaffold bookings' />
            ) : (
              <ul className='flex flex-col gap-2'>
                {result.data.bookings.map((b) => (
                  <li key={b.booking_id}>
                    <Link
                      href={`/dashboard/scaffold/${b.booking_id}`}
                      className='bg-card hover:border-primary grid gap-2 rounded-lg border p-3 text-sm transition-colors md:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1fr)_auto] md:items-center'
                    >
                      <span>
                        <span className='font-mono font-semibold'>
                          {b.job_ref}
                        </span>
                        <span className='text-muted-foreground block text-xs'>
                          {[b.customer_name, b.postcode]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span>
                        {b.company ?? (
                          <span className='text-destructive'>
                            No scaffolder
                          </span>
                        )}
                      </span>
                      <span className='text-xs'>
                        Up{' '}
                        {b.erect_actual_at
                          ? day(b.erect_actual_at)
                          : `${day(b.erect_planned_at)} (planned)`}
                        <span className='text-muted-foreground block'>
                          Down{' '}
                          {b.strip_actual_at
                            ? day(b.strip_actual_at)
                            : b.strip_planned_at
                              ? `${day(b.strip_planned_at)} (planned)`
                              : `${day(b.strip_forecast_at)} (forecast)`}
                        </span>
                      </span>
                      <span className='flex flex-wrap gap-1 md:justify-end'>
                        <Badge variant='outline'>{b.status}</Badge>
                        {b.acknowledgement_required && (
                          <Badge variant='warning'>Awaiting scaffolder</Badge>
                        )}
                        {b.open_complaints > 0 && (
                          <Badge variant='danger'>
                            {b.open_complaints} complaint
                          </Badge>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
