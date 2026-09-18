import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { dueState } from '@/features/jobs/format';
import { getOpenTasks } from '@/features/jobs/server/queries';
import { TaskTable } from '@/features/jobs/task-table';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { IconPlus } from '@tabler/icons-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

const ATTENTION_LIMIT = 8;

function StatTile({
  label,
  value,
  tone = 'default'
}: {
  label: string;
  value: number;
  tone?: 'default' | 'danger' | 'warning';
}) {
  const active = value > 0;
  return (
    <div className='bg-card rounded-lg border px-4 py-3'>
      <dt className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums',
          active && tone === 'danger' && 'text-destructive',
          active && tone === 'warning' && 'text-warning'
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const [permissions, tasks] = await Promise.all([
    getPermissions(user),
    getOpenTasks()
  ]);

  // Same "mine" rule as the Tasks page: I own it or I am its backup.
  const mine = tasks.filter(
    (t) => t.ownerId === user.id || t.backupId === user.id
  );
  const overdue = mine.filter((t) => dueState(t.dueAt) === 'overdue');
  const today = mine.filter((t) => dueState(t.dueAt) === 'today');
  const rest = mine.filter(
    (t) => !['overdue', 'today'].includes(dueState(t.dueAt))
  );
  const attention = [...overdue, ...today, ...rest].slice(0, ATTENTION_LIMIT);

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='flex flex-col gap-2'>
            <Heading
              title='Dashboard'
              description={`Signed in as ${user.fullName ?? user.email}.`}
            />
            <div className='flex flex-wrap gap-1.5'>
              {user.roles.map((role) => (
                <Badge key={role} variant='outline'>
                  {role}
                </Badge>
              ))}
            </div>
          </div>
          <div className='flex flex-wrap gap-2'>
            {permissions.has('presale.submit') && (
              <Button asChild>
                <Link href='/dashboard/presales/new'>
                  <IconPlus />
                  New presale
                </Link>
              </Button>
            )}
            <Button asChild variant='outline'>
              <Link href='/dashboard/tasks'>Tasks</Link>
            </Button>
            <Button asChild variant='outline'>
              <Link href='/dashboard/presales'>
                {permissions.has('job.read.all') ? 'Sold jobs' : 'My presales'}
              </Link>
            </Button>
          </div>
        </div>

        <dl className='grid grid-cols-3 gap-3 sm:max-w-xl'>
          <StatTile label='Overdue' value={overdue.length} tone='danger' />
          <StatTile label='Due today' value={today.length} tone='warning' />
          <StatTile label='My open tasks' value={mine.length} />
        </dl>

        <section
          aria-labelledby='attention-heading'
          className='flex flex-col gap-3'
        >
          <div className='flex items-end justify-between gap-3'>
            <h2 id='attention-heading' className='text-lg font-semibold'>
              Needs your attention
            </h2>
            {mine.length > attention.length && (
              <Link
                href='/dashboard/tasks'
                className='text-sm underline underline-offset-4'
              >
                View all {mine.length}
              </Link>
            )}
          </div>
          {attention.length === 0 ? (
            <EmptyState
              title='You are all clear'
              description='No open tasks are assigned to you right now.'
            />
          ) : (
            <TaskTable tasks={attention} />
          )}
        </section>
      </div>
    </PageContainer>
  );
}
