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
import {
  JOBS_VIEWS,
  WORKFLOW_STAGES,
  type JobsRead,
  type JobsView
} from '@/lib/backend/models';
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

  // Active is the default and is exactly the operational queue it always was.
  // Historical browses the archive of imported jobs, which app.job_in_scope
  // deliberately keeps out of operational scope; All is both. The read applies
  // the view, so there is no second search implementation here, and it returns
  // authoritative per-view counts for the control.
  const view = (JOBS_VIEWS as readonly string[]).includes(first(params.view))
    ? (first(params.view) as JobsView)
    : 'active';
  const page = Math.max(1, Number(first(params.page)) || 1);
  const perPage = 50;

  const result = await readOps<JobsRead>('JOBS', {
    q,
    stage: view === 'active' ? stages.join(',') : '',
    view,
    limit: String(perPage),
    offset: String((page - 1) * perPage)
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
          title='Jobs'
          description='Current work and the archive of jobs imported from the previous system. Search by reference, previous reference, customer, address, postcode, quote or phone.'
        />
        <JobFilterBar counts={result.ok ? result.data.counts : undefined} />
        {result.ok ? (
          <>
            {view !== 'active' && (
              <p className='bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm'>
                Historical records are read-only history imported from the
                previous system. There is no active work on them, and nothing
                can be actioned.
              </p>
            )}
            <p className='text-muted-foreground text-sm' aria-live='polite'>
              {result.data.total === 0
                ? 'No jobs'
                : `${result.data.total} ${result.data.total === 1 ? 'job' : 'jobs'}` +
                  (result.data.count < result.data.total
                    ? ` · showing ${(page - 1) * perPage + 1}-${(page - 1) * perPage + result.data.count}`
                    : '')}
              {view === 'active' &&
                stages.length > 0 &&
                ` · ${stages.map(stageLabel).join(', ')}`}
            </p>
            <JobList jobs={result.data.jobs} />
            <Pager
              page={page}
              perPage={perPage}
              total={result.data.total}
              params={params}
            />
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

/**
 * Server-side paging. The read returns one page at a time, so the archive is
 * never loaded into the browser in one lump.
 */
function Pager({
  page,
  perPage,
  total,
  params
}: {
  page: number;
  perPage: number;
  total: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return null;
  const href = (n: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'page') continue;
      const one = Array.isArray(v) ? v[0] : v;
      if (one) next.set(k, one);
    }
    if (n > 1) next.set('page', String(n));
    const qs = next.toString();
    return qs ? `/dashboard/jobs?${qs}` : '/dashboard/jobs';
  };
  return (
    <nav
      className='flex items-center justify-between gap-2'
      aria-label='Pages of jobs'
    >
      {page > 1 ? (
        <Link href={href(page - 1)} className='text-sm hover:underline'>
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className='text-muted-foreground text-sm tabular-nums'>
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className='text-sm hover:underline'>
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
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
