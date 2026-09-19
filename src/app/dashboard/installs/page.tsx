import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import type { MyWorkRead } from '@/features/installs/types';
import { formatDate } from '@/features/jobs/format';
import { ListFilters } from '@/features/operations/list-filters';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import { IconMapPin, IconPhone } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'My installs | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

const STATUS_VARIANT: Record<
  string,
  'info' | 'warning' | 'success' | 'secondary' | 'danger'
> = {
  Scheduled: 'secondary',
  InProgress: 'info',
  ReportedComplete: 'success',
  ConfirmedComplete: 'success',
  ReturnRequired: 'danger',
  Unscheduled: 'warning'
};

export default async function MyInstallsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const all = first((await searchParams).view) === 'all';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London'
  }).format(new Date());
  // Installer reads take their parameters under `payload`.
  const result = await readOps<MyWorkRead>('INSTALLER_MY_WORK', {
    payload: all ? {} : { from: today }
  });

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'operations',
          surface: 'my-installs',
          view: all ? 'all' : 'upcoming'
        }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='My installs'
          description='Work you are allocated to. Open one to start, report progress, finish or raise a problem.'
        />
        <ListFilters
          defaults={{ view: 'upcoming' }}
          tabs={{
            key: 'view',
            label: 'Which work',
            options: [
              { value: 'upcoming', label: 'Today onwards' },
              { value: 'all', label: 'All' }
            ]
          }}
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : result.data.items.length === 0 ? (
          <EmptyState title='No installs allocated to you' />
        ) : (
          <ul className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {result.data.items.map((i) => (
              <li key={i.allocation_id}>
                <Link
                  href={`/dashboard/installs/${i.work_package_id}`}
                  className='bg-card hover:border-primary flex h-full flex-col gap-2 rounded-lg border p-4 text-sm transition-colors'
                >
                  <span className='flex items-start justify-between gap-2'>
                    <span>
                      <span className='font-semibold'>
                        {i.trade} · {i.job.display_name ?? i.job.job_reference}
                      </span>
                      <span className='text-muted-foreground block font-mono text-xs'>
                        {i.job.job_reference}
                      </span>
                    </span>
                    <Badge variant={STATUS_VARIANT[i.status] ?? 'secondary'}>
                      {i.status}
                    </Badge>
                  </span>
                  <span className='font-medium tabular-nums'>
                    {i.planned_start
                      ? formatDate(i.planned_start)
                      : 'Date to be set'}
                    {i.planned_end &&
                      i.planned_end !== i.planned_start &&
                      ` – ${formatDate(i.planned_end)}`}
                    {i.role && (
                      <span className='text-muted-foreground font-normal'>
                        {' '}
                        · {i.role}
                      </span>
                    )}
                  </span>
                  <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                    <IconMapPin className='size-3.5' />
                    {[i.site.address_line1, i.site.town, i.site.postcode]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                  {i.site.phone && (
                    <span className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                      <IconPhone className='size-3.5' /> {i.site.phone}
                    </span>
                  )}
                  <span className='flex flex-wrap gap-1'>
                    {i.commissioning && (
                      <Badge variant='outline'>
                        Commissioning {i.commissioning.status}
                      </Badge>
                    )}
                    {i.commissioning?.status === 'Returned' && (
                      <Badge variant='danger'>Needs fixing</Badge>
                    )}
                    {i.open_issues.length > 0 && (
                      <Badge variant='warning'>
                        {i.open_issues.length} open issue
                      </Badge>
                    )}
                    {i.my_tasks.length > 0 && (
                      <Badge variant='secondary'>
                        {i.my_tasks.length} task
                      </Badge>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
