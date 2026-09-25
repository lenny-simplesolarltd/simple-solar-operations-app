import PageContainer from '@/components/layout/page-container';
import {
  ProgrammeShell,
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import { ReviewPanel } from '@/features/programmes/components/review-panel';
import {
  currentAccess,
  getDashboard,
  getProgramme,
  getVisit,
  listVisits,
  programmesEnabled,
  visitEvidence
} from '@/features/programmes/server/queries';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../filters';

export const metadata: Metadata = {
  title: 'Programme review | Simple Solar Operations'
};

const one = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

/** The queue list shows this many; the count above it is the real depth. */
const QUEUE_PAGE = 100;

/**
 * The office review queue: every submission waiting to be checked, oldest first,
 * with the first one open. Reviewing is a comparison, so the whole comparison is
 * on the screen at once.
 */
export default async function ReviewPage({
  params,
  searchParams
}: {
  params: Promise<{ programmeId: string }>;
  searchParams: SearchParams;
}) {
  const session = await currentAccess();
  if (!session) redirect('/auth/sign-in');
  if (!(await programmesEnabled()))
    return (
      <PageContainer>
        <ProgrammesNotEnabled />
      </PageContainer>
    );

  const { programmeId } = await params;
  const programme = await getProgramme(programmeId);
  if (!programme) notFound();
  if (!session.access.review && !session.access.readAll) redirect('/dashboard');

  // Oldest first, because the queue is worked from the front, and only a
  // page of it: `waiting` is the true depth of the queue even when the list
  // below shows the first hundred.
  const page = await listVisits(programmeId, {
    review_status: 'AwaitingReview',
    order: 'oldest',
    limit: QUEUE_PAGE
  });
  const queue = page.visits;
  const waiting = page.total;
  const wanted = one((await searchParams).visit);
  // A deep-linked submission may sit beyond this page; fetch it directly
  // rather than silently opening somebody else's visit.
  const open =
    queue.find((v) => v.id === wanted) ??
    (wanted ? await getVisit(wanted) : null) ??
    queue[0] ??
    null;
  const evidence = open ? await visitEvidence(open.id) : [];
  const base = programmePath(programmeId);
  // When the queue is empty, say what the rest of the programme still owes the
  // office. These are real counts from the same reads the board uses - nothing
  // is invented, and where a figure is genuinely zero it is shown as zero.
  const caughtUp =
    waiting === 0 && session.access.report
      ? await getDashboard(programmeId)
      : null;

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/review'
        description={`${waiting} ${waiting === 1 ? 'submission' : 'submissions'} awaiting review.`}
      >
        {waiting === 0 ? (
          <div className='flex flex-col gap-4 py-6'>
            <div className='flex flex-col gap-1'>
              <p className='text-base font-semibold'>All caught up</p>
              <p className='text-muted-foreground max-w-prose text-sm'>
                There are no installer submissions waiting for office review.
              </p>
            </div>
            {caughtUp && (
              <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
                {[
                  {
                    label: 'Awaiting review',
                    value: caughtUp.awaiting_review,
                    href: null
                  },
                  {
                    label: 'Action required',
                    value: caughtUp.action_required,
                    href: `${base}/visits?disposition=ActionRequired`
                  },
                  {
                    label: 'Portal checks outstanding',
                    value: caughtUp.portal_outstanding,
                    href: null
                  }
                ].map((stat) => (
                  <div key={stat.label} className='rounded-lg border p-3'>
                    <dt className='text-muted-foreground text-xs font-medium'>
                      {stat.label}
                    </dt>
                    <dd className='mt-0.5 text-2xl font-semibold tabular-nums'>
                      {stat.href && stat.value > 0 ? (
                        <Link href={stat.href} className='hover:underline'>
                          {stat.value.toLocaleString('en-GB')}
                        </Link>
                      ) : (
                        stat.value.toLocaleString('en-GB')
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (
          <div className='grid gap-5 lg:grid-cols-[18rem_1fr]'>
            <nav aria-label='Review queue' className='lg:border-r lg:pr-4'>
              <ol className='flex flex-col gap-1'>
                {queue.map((v, i) => (
                  <li key={v.id}>
                    <Link
                      href={`${base}/review?visit=${v.id}`}
                      aria-current={open?.id === v.id ? 'true' : undefined}
                      className={
                        'flex min-h-14 flex-col justify-center rounded-md px-3 py-1.5 text-sm ' +
                        (open?.id === v.id
                          ? 'bg-accent font-medium'
                          : 'hover:bg-accent/50')
                      }
                    >
                      <span className='flex items-baseline gap-2'>
                        <span className='text-muted-foreground tabular-nums'>
                          {i + 1}.
                        </span>
                        <span className='truncate'>
                          {v.property.addressLine1}
                        </span>
                      </span>
                      <span className='text-muted-foreground pl-6 text-xs'>
                        {v.property.externalRef} · {v.visitDate}
                        {v.meterSerialMatches === false && (
                          <span className='text-destructive font-semibold'>
                            {' '}
                            · mismatch
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
            {open && (
              <ReviewPanel
                visit={open}
                evidence={evidence}
                signalConfig={programme.signalConfig}
                canReview={session.access.review}
              />
            )}
          </div>
        )}
      </ProgrammeShell>
    </PageContainer>
  );
}
