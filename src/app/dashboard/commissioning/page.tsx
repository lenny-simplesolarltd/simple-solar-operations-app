import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import type { CommissioningQueueRead } from '@/features/installs/types';
import { formatDateTime } from '@/features/jobs/format';
import { ListFilters } from '@/features/operations/list-filters';
import { getCurrentUser } from '@/lib/auth';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Commissioning review | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export default async function CommissioningPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const requested = first((await searchParams).view);
  const view = ['review', 'returned', 'accepted'].includes(requested)
    ? requested
    : 'review';
  const result = await readOps<CommissioningQueueRead>('COMMISSIONING_QUEUE', {
    view
  });

  return (
    <PageContainer>
      <AssistantPageContext
        page={{ kind: 'operations', surface: 'commissioning-review', view }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Commissioning review'
          description='Commissioning forms installers have submitted. Accept them, or return them with notes on what to fix.'
        />
        <ListFilters
          defaults={{ view: 'review' }}
          tabs={{
            key: 'view',
            label: 'Review state',
            options: [
              { value: 'review', label: 'To review' },
              { value: 'returned', label: 'Returned' },
              { value: 'accepted', label: 'Accepted' }
            ]
          }}
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : result.data.submissions.length === 0 ? (
          <EmptyState
            title={view === 'review' ? 'Nothing waiting for review' : 'None'}
          />
        ) : (
          <ul className='flex flex-col gap-2'>
            {result.data.submissions.map((s) => (
              <li key={s.submission_id}>
                <Link
                  href={`/dashboard/commissioning/${s.work_package_id}`}
                  className='bg-card hover:border-primary flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors'
                >
                  <span>
                    <span className='font-mono font-semibold'>{s.job_ref}</span>{' '}
                    · {s.trade}
                    <span className='text-muted-foreground block text-xs'>
                      {[s.customer_name, s.postcode]
                        .filter(Boolean)
                        .join(' · ')}{' '}
                      · {s.installer_name ?? 'Installer'}
                    </span>
                  </span>
                  <span className='flex items-center gap-2 text-xs'>
                    {s.submitted_at && (
                      <span className='text-muted-foreground'>
                        {formatDateTime(s.submitted_at)}
                      </span>
                    )}
                    <Badge variant='outline'>{s.status}</Badge>
                    {s.template_version === 'NOT_CONFIGURED' && (
                      <Badge variant='warning'>No template</Badge>
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
