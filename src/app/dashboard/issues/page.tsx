import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDate, formatDateTime } from '@/features/jobs/format';
import { IssueActions } from '@/features/jobs/components/operations/actions';
import { flagText } from '@/features/jobs/components/operations/labels';
import { ListFilters } from '@/features/operations/list-filters';
import { getCurrentUser } from '@/lib/auth';
import type {
  IssueQueueRow,
  IssueStatusFilter,
  IssuesRead
} from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Issues | Simple Solar Operations' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

const STATUSES: IssueStatusFilter[] = ['open', 'resolved', 'all'];
const TYPES = ['Remedial', 'Complaint', 'Variation'];

const isOpen = (i: IssueQueueRow) =>
  i.status !== 'Resolved' && i.status !== 'Closed';

// Every issue across the jobs the person can read (ISSUES). The actions are
// the same ISSUE_UPDATE commands as the job's Operations tab; each row's flags
// say whether they are offered and the server re-checks them.
export default async function IssuesPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const params = await searchParams;
  const requested = first(params.status);
  const status = (STATUSES as string[]).includes(requested)
    ? (requested as IssueStatusFilter)
    : 'open';
  const type = TYPES.includes(first(params.type)) ? first(params.type) : '';
  const q = first(params.q).slice(0, 120);

  const result = await readOps<IssuesRead>('ISSUES', {
    status,
    ...(type ? { type } : {}),
    ...(q ? { q } : {})
  });
  const counts = result.ok ? result.data.counts : null;

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'operations', surface: 'issues' }} />
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Issues'
          description='Remedials, complaints and variations across every job. An issue that blocks completion must be resolved before the job can be marked operationally complete.'
        />
        {counts && (
          <p className='text-muted-foreground text-sm' aria-live='polite'>
            {counts.open} open
            {counts.blocking > 0 && (
              <span className='text-destructive font-medium'>
                {' '}
                · {counts.blocking} blocking completion
              </span>
            )}
            {counts.resolved_awaiting_close > 0 &&
              ` · ${counts.resolved_awaiting_close} resolved, waiting to be closed`}
          </p>
        )}
        <ListFilters
          defaults={{ status: 'open' }}
          tabs={{
            key: 'status',
            label: 'Issue status',
            options: [
              { value: 'open', label: 'Open', count: counts?.open },
              { value: 'resolved', label: 'Resolved' },
              { value: 'all', label: 'All' }
            ]
          }}
          selects={[
            {
              key: 'type',
              label: 'Type',
              allLabel: 'All types',
              options: TYPES.map((t) => ({ value: t, label: t }))
            }
          ]}
          searchPlaceholder='Search job, customer, postcode or text'
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : result.data.issues.length === 0 ? (
          <EmptyState
            title={status === 'open' ? 'No open issues' : 'No issues'}
            description={
              q || type
                ? 'Try clearing the search or type.'
                : status === 'open'
                  ? 'Nothing is waiting to be put right.'
                  : undefined
            }
          />
        ) : (
          <ul className='flex flex-col gap-3'>
            {result.data.issues.map((i) => (
              <IssueCard
                key={i.id}
                issue={i}
                officePeople={result.data.office_people}
              />
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}

function IssueCard({
  issue: i,
  officePeople
}: {
  issue: IssueQueueRow;
  officePeople: { id: string; name: string }[];
}) {
  const why =
    !i.actions.resolve.available &&
    !i.actions.close.available &&
    i.status !== 'Closed'
      ? i.actions.resolve
      : null;
  return (
    <li className='bg-card rounded-lg border p-4 text-sm'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <Link
            href={`/dashboard/jobs/${i.job_id}?tab=operations`}
            className='decoration-primary font-mono font-semibold underline decoration-2 underline-offset-4'
          >
            {i.job_ref}
          </Link>
          <span className='text-muted-foreground'>
            {' '}
            · {[i.customer_name, i.postcode].filter(Boolean).join(' · ')}
          </span>
        </div>
        <span className='text-muted-foreground text-xs'>
          {i.workflow_stage}
        </span>
      </div>
      <div className='mt-2 flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{i.category}</span>
        <Badge variant='outline'>{i.type}</Badge>
        {i.severity && <Badge variant='outline'>{i.severity}</Badge>}
        <Badge variant={isOpen(i) ? 'outline' : 'secondary'}>{i.status}</Badge>
        {i.blocks_completion && isOpen(i) && (
          <Badge variant='destructive'>Blocks completion</Badge>
        )}
      </div>
      <p className='mt-1 break-words'>{i.description}</p>
      <p className='text-muted-foreground mt-1 text-xs'>
        Raised {formatDateTime(i.raised_at)} by {i.raised_by_name ?? 'staff'} ·
        owner {i.owner_name ?? '-'}
        {i.due_at && ` · due ${formatDate(i.due_at)}`}
        {i.resolved_at && ` · resolved ${formatDate(i.resolved_at)}`}
        {i.closed_at && ` · closed ${formatDate(i.closed_at)}`}
      </p>
      {i.resolution && (
        <p className='mt-1 text-xs break-words'>Resolution: {i.resolution}</p>
      )}
      <div className='mt-2 flex flex-col gap-1'>
        <IssueActions jobId={i.job_id} issue={i} officePeople={officePeople} />
        {why && (
          <p
            className={
              why.denied === 'MODE'
                ? 'text-warning text-xs'
                : 'text-muted-foreground text-xs'
            }
          >
            {flagText(why)}
          </p>
        )}
      </div>
    </li>
  );
}
