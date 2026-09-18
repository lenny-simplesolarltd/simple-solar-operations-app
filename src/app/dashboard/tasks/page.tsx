import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { getOpenTasks } from '@/features/jobs/server/queries';
import { TaskTable } from '@/features/jobs/task-table';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Tasks | Simple Solar Operations' };

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const [permissions, tasks] = await Promise.all([
    getPermissions(user),
    getOpenTasks()
  ]);
  // "My tasks" = I own it or I am its backup (one shared task row, as in the reference).
  const mine = tasks.filter(
    (t) => t.ownerId === user.id || t.backupId === user.id
  );
  const team = tasks.filter(
    (t) => t.ownerId !== user.id && t.backupId !== user.id
  );

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-8'>
        <section className='flex flex-col gap-3'>
          <Heading
            title='My tasks'
            description='Open work you own, or are the backup for. Completing tasks arrives with the prebooking workflow.'
          />
          <TaskTable tasks={mine} />
        </section>
        {permissions.has('task.read.all') && (
          <section className='flex flex-col gap-3'>
            <Heading
              title='Team tasks'
              description='Open work owned by everyone else.'
            />
            <TaskTable tasks={team} />
          </section>
        )}
      </div>
    </PageContainer>
  );
}
