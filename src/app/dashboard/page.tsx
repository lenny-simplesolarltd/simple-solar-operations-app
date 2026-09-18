import PageContainer from '@/components/layout/page-container';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const permissions = await getPermissions(user);

  return (
    <PageContainer>
      <div className='flex flex-col gap-4'>
        <Heading
          title='Simple Solar Operations'
          description={`Signed in as ${user.fullName ?? user.email} (${user.roles.join(', ')}).`}
        />
        <div className='flex flex-wrap gap-3'>
          {permissions.has('presale.submit') && (
            <Button asChild>
              <Link href='/dashboard/presales/new'>New presale</Link>
            </Button>
          )}
          <Button asChild variant='outline'>
            <Link href='/dashboard/presales'>
              {permissions.has('job.read.all') ? 'Sold jobs' : 'My presales'}
            </Link>
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
