import { EmptyState } from '@/components/empty-state';
import { canSee } from '@/components/layout/nav-visibility';
import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { dueState } from '@/features/jobs/format';
import { getOpenTasks } from '@/features/jobs/server/queries';
import { STAGE_LABEL } from '@/features/jobs/stages';
import { TaskTable } from '@/features/jobs/task-table';
import { getPermissions } from '@/features/presale/server/queries';
import { TaskList } from '@/features/tasks/components/task-list';
import { getCurrentUser, type AppUser } from '@/lib/auth';
import {
  WORKFLOW_STAGES,
  type OfficeDashboardRead,
  type TasksRead
} from '@/lib/backend/models';
import { readOps } from '@/lib/backend/read';
import { cn } from '@/lib/utils';
import { IconChevronRight, IconPlus } from '@tabler/icons-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

const ATTENTION_LIMIT = 8;

type Tone = 'default' | 'danger' | 'warning';

/** A count that opens the list it counts. */
function StatTile({
  label,
  value,
  href,
  tone = 'default'
}: {
  label: string;
  value: number;
  href?: string;
  tone?: Tone;
}) {
  const active = value > 0;
  const body = (
    <>
      <dt className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 flex items-center justify-between text-2xl font-bold tabular-nums',
          active && tone === 'danger' && 'text-destructive',
          active && tone === 'warning' && 'text-warning'
        )}
      >
        {value}
        {href && <IconChevronRight className='text-muted-foreground size-4' />}
      </dd>
    </>
  );
  return href ? (
    <Link
      href={href}
      className='bg-card hover:border-primary focus-visible:ring-ring rounded-lg border px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none'
    >
      {body}
    </Link>
  ) : (
    <div className='bg-card rounded-lg border px-4 py-3'>{body}</div>
  );
}

function Header({
  user,
  canSell,
  jobsLabel
}: {
  user: AppUser;
  canSell: boolean;
  jobsLabel: string;
}) {
  return (
    <div className='flex flex-wrap items-start justify-between gap-3'>
      <div className='flex flex-col gap-2'>
        <Heading
          title='Office home'
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
        {canSell && (
          <Button asChild>
            <Link href='/dashboard/presales/new'>
              <IconPlus />
              New job sold
            </Link>
          </Button>
        )}
        <Button asChild variant='outline'>
          <Link href='/dashboard/presales'>{jobsLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const [permissions, dashboard, attention] = await Promise.all([
    getPermissions(user),
    readOps<OfficeDashboardRead>('OFFICE_DASHBOARD'),
    readOps<TasksRead>('TASKS', {
      scope: 'my',
      status: 'open',
      limit: String(ATTENTION_LIMIT)
    })
  ]);
  const header = (
    <Header
      user={user}
      canSell={permissions.has('presale.submit')}
      jobsLabel={permissions.has('job.read.all') ? 'Sold jobs' : 'My job sales'}
    />
  );

  if (!dashboard.ok) {
    return (
      <PageContainer>
        <AssistantPageContext page={{ kind: 'dashboard' }} />
        <div className='flex w-full flex-col gap-6'>
          {header}
          {/* The legacy home only stands in where the dashboard read is not
              deployed yet (a database behind the migrations); any other
              failure is shown as it is. */}
          {dashboard.error.code === 'READ_NOT_DEPLOYED' ? (
            <LegacyHome user={user} />
          ) : (
            <ReadFailureState failure={dashboard.error} />
          )}
        </div>
      </PageContainer>
    );
  }

  const d = dashboard.data;
  const ops = d.operations;
  const operations: {
    label: string;
    value: number | null;
    href?: string;
    tone?: Tone;
  }[] = [
    {
      label: 'Team overdue',
      value: ops.team_overdue,
      href: '/dashboard/tasks?scope=team&due=overdue',
      tone: 'danger'
    },
    {
      label: 'Booking queue',
      value: ops.booking_queue,
      href: '/dashboard/booking?view=queue'
    },
    {
      label: 'Intake review',
      value: ops.intake_review,
      href: '/dashboard/intake',
      tone: 'warning'
    },
    {
      label: 'Commissioning review',
      value: ops.commissioning_review,
      href: canSee('commissioning', user, permissions)
        ? '/dashboard/commissioning'
        : undefined,
      tone: 'warning'
    },
    { label: 'Open issues', value: ops.open_issues },
    { label: 'Blocking issues', value: ops.blocking_issues, tone: 'danger' },
    {
      label: 'Draft orders',
      value: ops.draft_orders,
      href: canSee('materials', user, permissions)
        ? '/dashboard/orders?view=draft'
        : undefined
    },
    {
      label: 'Installs, next 14 days',
      value: ops.installs_next_14_days,
      href: canSee('resourcing', user, permissions)
        ? '/dashboard/planner'
        : undefined
    },
    {
      label: 'Unallocated installs',
      value: ops.unallocated_next_14_days,
      href: canSee('resourcing', user, permissions)
        ? '/dashboard/planner?view=board'
        : undefined,
      tone: 'warning'
    },
    {
      label: 'Integrations to review',
      value: ops.outbox_needs_review,
      href: '/dashboard/system',
      tone: 'warning'
    }
  ];
  const visibleOps = operations.filter((o) => o.value !== null) as {
    label: string;
    value: number;
    href?: string;
    tone?: Tone;
  }[];
  const stages = WORKFLOW_STAGES.filter((s) => (d.jobs_by_stage[s] ?? 0) > 0);
  const canSearchJobs = canSee('jobs', user, permissions);

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'dashboard' }} />
      <div className='flex w-full flex-col gap-6'>
        {header}

        <section aria-labelledby='mine-heading' className='flex flex-col gap-3'>
          <h2 id='mine-heading' className='text-lg font-semibold'>
            My work
          </h2>
          <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
            <StatTile
              label='Overdue'
              value={d.my_tasks.overdue}
              tone='danger'
              href='/dashboard/tasks?due=overdue'
            />
            <StatTile
              label='Due today'
              value={d.my_tasks.due_today}
              tone='warning'
              href='/dashboard/tasks?due=today'
            />
            <StatTile
              label='Next 7 days'
              value={d.my_tasks.due_soon}
              href='/dashboard/tasks?due=soon'
            />
            <StatTile label='Waiting' value={d.my_tasks.waiting} />
            <StatTile
              label='Booking'
              value={d.my_tasks.booking}
              href='/dashboard/tasks?queue=booking'
            />
            <StatTile
              label='All open'
              value={d.my_tasks.open}
              href='/dashboard/tasks'
            />
          </dl>
        </section>

        <section
          aria-labelledby='attention-heading'
          className='flex flex-col gap-3'
        >
          <div className='flex items-end justify-between gap-3'>
            <h2 id='attention-heading' className='text-lg font-semibold'>
              Needs your attention
            </h2>
            {attention.ok && attention.data.total > attention.data.count && (
              <Link
                href='/dashboard/tasks'
                className='text-sm underline underline-offset-4'
              >
                View all {attention.data.total}
              </Link>
            )}
          </div>
          {attention.ok ? (
            <TaskList
              tasks={attention.data.tasks}
              showOwner={false}
              emptyTitle='You are all clear'
              emptyDescription='No open tasks are assigned to you right now.'
            />
          ) : (
            <EmptyState
              title='Could not load your tasks'
              description={attention.error.message}
            />
          )}
        </section>

        {visibleOps.length > 0 && (
          <section
            aria-labelledby='ops-heading'
            className='flex flex-col gap-3'
          >
            <h2 id='ops-heading' className='text-lg font-semibold'>
              Operations
            </h2>
            <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
              {visibleOps.map((o) => (
                <StatTile
                  key={o.label}
                  label={o.label}
                  value={o.value}
                  href={o.href}
                  tone={o.tone}
                />
              ))}
            </dl>
          </section>
        )}

        {stages.length > 0 && (
          <section
            aria-labelledby='stages-heading'
            className='flex flex-col gap-3'
          >
            <h2 id='stages-heading' className='text-lg font-semibold'>
              Jobs by stage
            </h2>
            <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5'>
              {stages.map((s) => (
                <StatTile
                  key={s}
                  label={STAGE_LABEL[s]}
                  value={d.jobs_by_stage[s]}
                  href={
                    canSearchJobs ? `/dashboard/jobs?stage=${s}` : undefined
                  }
                />
              ))}
            </dl>
          </section>
        )}
      </div>
    </PageContainer>
  );
}

/** The previous home (canonical tables under RLS) until the dashboard read is deployed. */
async function LegacyHome({ user }: { user: AppUser }) {
  const tasks = await getOpenTasks();
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
    <>
      <dl className='grid grid-cols-3 gap-3 sm:max-w-xl'>
        <StatTile
          label='Overdue'
          value={overdue.length}
          tone='danger'
          href='/dashboard/tasks'
        />
        <StatTile
          label='Due today'
          value={today.length}
          tone='warning'
          href='/dashboard/tasks'
        />
        <StatTile
          label='My open tasks'
          value={mine.length}
          href='/dashboard/tasks'
        />
      </dl>
      <section
        aria-labelledby='attention-heading'
        className='flex flex-col gap-3'
      >
        <h2 id='attention-heading' className='text-lg font-semibold'>
          Needs your attention
        </h2>
        {attention.length === 0 ? (
          <EmptyState
            title='You are all clear'
            description='No open tasks are assigned to you right now.'
          />
        ) : (
          <TaskTable tasks={attention} />
        )}
      </section>
    </>
  );
}
