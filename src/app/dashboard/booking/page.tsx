import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { BookingBoard } from '@/features/booking/components/booking-board';
import { BookingTabs } from '@/features/booking/components/booking-tabs';
import { bookingTabLabel } from '@/features/booking/tabs';
import { getPermissions } from '@/features/presale/server/queries';
import { TaskList } from '@/features/tasks/components/task-list';
import { getCurrentUser } from '@/lib/auth';
import {
  BOOKING_VIEWS,
  type BookingBoardRead,
  type BookingView,
  type TasksRead
} from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import { isOfficeManager } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Booking | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

const DESCRIPTIONS: Record<string, string> = {
  queue: 'Open prebooking and booking tasks.',
  prebooking: 'Sold jobs still completing their prebooking checks.',
  ready: 'Jobs cleared to book: fill in the booking form.',
  in_progress:
    'Booking received: resolve any checks, then confirm the booking.',
  upcoming: 'Booked jobs with work still to come.'
};

export default async function BookingPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const params = await searchParams;
  const requested = first(params.view);
  const view = (['queue', ...BOOKING_VIEWS] as string[]).includes(requested)
    ? requested
    : 'ready';
  const q = first(params.q).slice(0, 120);

  const permissions = await getPermissions(user);
  const team = permissions.has('task.read.all') || isOfficeManager(user);
  const [board, queue] = await Promise.all([
    readOps<BookingBoardRead>('BOOKING_BOARD', {
      view: view === 'queue' ? 'ready' : view,
      q: view === 'queue' ? undefined : q
    }),
    view === 'queue'
      ? readOps<TasksRead>('TASKS', {
          scope: team ? 'all' : 'my',
          queue: 'booking',
          q
        })
      : Promise.resolve(null)
  ]);

  const counts: Partial<Record<string, number>> = board.ok
    ? { ...board.data.counts }
    : {};
  if (queue?.ok) counts.queue = queue.data.total;

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'operations',
          surface: 'booking',
          view: bookingTabLabel(view)
        }}
      />
      <div className='flex w-full flex-col gap-4'>
        <Heading title='Booking' description={DESCRIPTIONS[view]} />
        {!board.ok && board.error.kind !== 'unavailable' ? (
          <ReadFailureState failure={board.error} />
        ) : (
          <>
            <BookingTabs counts={counts} />
            {view === 'queue' ? (
              queue && queue.ok ? (
                <TaskList
                  tasks={queue.data.tasks}
                  emptyTitle='No booking tasks'
                  emptyDescription='Prebooking and booking tasks appear here while they are open.'
                />
              ) : (
                queue && !queue.ok && <ReadFailureState failure={queue.error} />
              )
            ) : board.ok ? (
              <>
                {board.data.truncated && (
                  <p className='text-muted-foreground text-sm'>
                    Showing {board.data.count} of {board.data.total}. Search to
                    narrow it down.
                  </p>
                )}
                <BookingBoard
                  rows={board.data.jobs}
                  view={view as BookingView}
                />
              </>
            ) : (
              <ReadFailureState failure={board.error} />
            )}
          </>
        )}
      </div>
    </PageContainer>
  );
}
