import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Heading } from '@/components/ui/heading';
import { OperationsCentre } from '@/features/operations/operations-centre';
import { getBatches } from '@/features/tasks/server/batch';
import { getCurrentUser } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Operations | Simple Solar Operations'
};

/**
 * Bulk operations and what became of them. The per-item state is the
 * database's, so this answers the same questions however the work was started:
 * is it still processing, what succeeded, what failed, why, and can it be
 * retried.
 */
export default async function OperationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const result = await getBatches({ limit: 40 });

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        <Heading
          title='Operations'
          description='Bulk actions you have run, from the Tasks screen or from SimpleBot, and what happened to each task.'
        />
        {result.ok ? (
          <Suspense>
            <OperationsCentre
              initial={result.data.batches}
              canSeeEveryone={isAdmin(user)}
            />
          </Suspense>
        ) : (
          <ReadFailureState failure={result.error} />
        )}
      </div>
    </PageContainer>
  );
}
