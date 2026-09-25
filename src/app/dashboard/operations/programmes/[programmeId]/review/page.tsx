import PageContainer from '@/components/layout/page-container';
import {
  ProgrammeShell,
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import { ReviewPanel } from '@/features/programmes/components/review-panel';
import {
  currentAccess,
  getProgramme,
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

  const queue = await listVisits(programmeId, {
    review_status: 'AwaitingReview'
  });
  // Oldest first: the queue is worked from the front.
  queue.reverse();
  const wanted = one((await searchParams).visit);
  const open = queue.find((v) => v.id === wanted) ?? queue[0] ?? null;
  const evidence = open ? await visitEvidence(open.id) : [];
  const base = programmePath(programmeId);

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/review'
        description={`${queue.length} ${queue.length === 1 ? 'submission' : 'submissions'} awaiting review.`}
      >
        {queue.length === 0 ? (
          <p className='text-muted-foreground py-8 text-sm'>
            Nothing is waiting for review.
          </p>
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
