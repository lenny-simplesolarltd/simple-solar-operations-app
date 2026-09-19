import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { getOpenTasks } from '@/features/jobs/server/queries';
import { TaskTable } from '@/features/jobs/task-table';
import { getPermissions } from '@/features/presale/server/queries';
import { TaskFilterBar } from '@/features/tasks/components/task-filter-bar';
import { TaskList } from '@/features/tasks/components/task-list';
import {
  DUE_OPTIONS,
  QUEUE_LABELS,
  QUEUE_TITLES,
  parseTaskFilters
} from '@/features/tasks/filters';
import { getStaffOptions, getTasks } from '@/features/tasks/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { isOfficeManager } from '@/lib/roles';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Tasks | Simple Solar Operations' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const filters = parseTaskFilters(await searchParams);
  const permissions = await getPermissions(user);
  // The same rule as app.can_read_team_tasks; the read re-checks it.
  const canViewTeam = permissions.has('task.read.all') || isOfficeManager(user);
  const team = filters.scope === 'team';
  const everyone = filters.scope === 'all';

  const [result, staff] = await Promise.all([
    getTasks(filters),
    (team || everyone) && canViewTeam ? getStaffOptions() : Promise.resolve([])
  ]);

  const title = everyone
    ? filters.queue
      ? QUEUE_TITLES[filters.queue]
      : 'Everyone’s tasks'
    : team
      ? 'Team tasks'
      : 'My tasks';
  const description = everyone
    ? filters.queue
      ? `${QUEUE_LABELS[filters.queue]} work across the whole team, including your own.`
      : 'Work across the whole team, including your own. Pick a queue to focus on one kind of work.'
    : team
      ? 'Open work owned by everyone else.'
      : 'Work you own, or are the backup for. Open a task to complete it.';

  const context = (
    <AssistantPageContext
      page={{
        kind: 'tasks',
        lists: filters.scope === 'all' ? ['my', 'team'] : [filters.scope],
        filters: {
          status: filters.status,
          ...(filters.due !== 'any' && filters.due !== 'dated'
            ? { due: filters.due }
            : {}),
          ...(filters.queue ? { queue: QUEUE_LABELS[filters.queue] } : {}),
          ...(filters.owner
            ? {
                owner:
                  staff.find((s) => s.id === filters.owner)?.name ??
                  'selected person'
              }
            : {}),
          ...(filters.q ? { q: filters.q } : {})
        }
      }}
    />
  );

  // Until the task read model is deployed to this database, keep the
  // previous list (canonical tables under RLS) rather than show nothing.
  if (!result.ok && result.error.kind === 'unavailable') {
    const tasks = await getOpenTasks();
    const mine = tasks.filter(
      (t) => t.ownerId === user.id || t.backupId === user.id
    );
    const others = tasks.filter(
      (t) => t.ownerId !== user.id && t.backupId !== user.id
    );
    return (
      <PageContainer>
        {context}
        <div className='flex w-full flex-col gap-4'>
          <Heading title={title} description={description} />
          <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
            Filters and task actions need a backend update that is not deployed
            to this database yet. Showing open tasks only.
          </p>
          <TaskTable
            tasks={
              everyone && canViewTeam
                ? tasks
                : team && canViewTeam
                  ? others
                  : mine
            }
          />
        </div>
      </PageContainer>
    );
  }

  const dueLabel = DUE_OPTIONS.find((d) => d.value === filters.due)?.label;

  return (
    <PageContainer>
      {context}
      <div className='flex w-full flex-col gap-4'>
        <Heading title={title} description={description} />
        <TaskFilterBar canViewTeam={canViewTeam} staff={staff} />
        {result.ok ? (
          <>
            <p className='text-muted-foreground text-sm' aria-live='polite'>
              {result.data.truncated
                ? `Showing the first ${result.data.count} of ${result.data.total} tasks. Narrow the filters to see the rest.`
                : `${result.data.total} ${result.data.total === 1 ? 'task' : 'tasks'}`}
              {filters.due !== 'any' &&
                dueLabel &&
                ` · ${dueLabel.toLowerCase()}`}
            </p>
            <TaskList
              tasks={result.data.tasks}
              showOwner={team || everyone}
              showCompleted={filters.status === 'closed'}
              emptyTitle={
                filters.status === 'closed'
                  ? 'No completed tasks'
                  : 'Nothing to do here'
              }
              emptyDescription='Try clearing the filters.'
            />
          </>
        ) : (
          <ReadFailureState failure={result.error} />
        )}
      </div>
    </PageContainer>
  );
}
