import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { JobFilterBar } from '@/features/jobs/components/job-filter-bar';
import { JobList } from '@/features/jobs/components/job-list';
import { formatDate } from '@/features/jobs/format';
import { searchVisibleJobs } from '@/features/jobs/server/search';
import { stageLabel } from '@/features/jobs/stages';
import { getCurrentUser } from '@/lib/auth';
import { WORKFLOW_STAGES, type JobsRead } from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Job search | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export default async function JobsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const params = await searchParams;
  const q = first(params.q).slice(0, 120);
  // Keep only known stages; the read model rejects anything else.
  const stages = first(params.stage)
    .split(',')
    .filter((s) => (WORKFLOW_STAGES as readonly string[]).includes(s));

  const result = await readOps<JobsRead>('JOBS', {
    q,
    stage: stages.join(',')
  });

  const context = (
    <AssistantPageContext
      page={{
        kind: 'jobs',
        ...(q ? { query: q } : {}),
        ...(stages.length ? { stages } : {})
      }}
    />
  );

  return (
    <PageContainer>
      {context}
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Job search'
          description='Every job you can see, newest sale first. Search by reference, customer, postcode, quote or phone.'
        />
        <JobFilterBar />
        {result.ok ? (
          <>
            <p className='text-muted-foreground text-sm' aria-live='polite'>
              {result.data.truncated
                ? `Showing the newest ${result.data.count} of ${result.data.total} jobs. Search to narrow it down.`
                : `${result.data.total} ${result.data.total === 1 ? 'job' : 'jobs'}`}
              {stages.length > 0 && ` · ${stages.map(stageLabel).join(', ')}`}
            </p>
            <JobList jobs={result.data.jobs} />
          </>
        ) : result.error.kind === 'unavailable' ? (
          <LegacySearch q={q} />
        ) : (
          <ReadFailureState failure={result.error} />
        )}
      </div>
    </PageContainer>
  );
}

/** Until the JOBS read model is deployed: the reference/customer search under RLS. */
async function LegacySearch({ q }: { q: string }) {
  const { hits, total } = q
    ? await searchVisibleJobs(q, 50)
    : { hits: [], total: 0 };
  return (
    <div className='flex flex-col gap-3'>
      <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
        Browsing and stage filters need a backend update that is not deployed to
        this database yet. Search by reference, name or postcode.
      </p>
      {q && (
        <p className='text-muted-foreground text-sm'>
          {total} {total === 1 ? 'match' : 'matches'}
        </p>
      )}
      <ul className='divide-y rounded-lg border'>
        {hits.map((h) => (
          <li key={h.id}>
            <Link
              href={`/dashboard/jobs/${h.id}`}
              className='hover:bg-muted/50 flex items-center justify-between gap-3 p-3'
            >
              <span>
                <span className='font-mono font-semibold'>{h.jobRef}</span>
                <span className='text-muted-foreground block text-xs'>
                  {h.customerName} · {h.postcode} · sold {formatDate(h.soldAt)}
                </span>
              </span>
              <Badge variant='outline'>{stageLabel(h.workflowStage)}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
