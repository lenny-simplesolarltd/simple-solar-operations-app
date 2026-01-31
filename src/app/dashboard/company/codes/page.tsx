import CompanyDashboard from '../company-dashboard';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function CompanyCodesPage() {
  const { userId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return redirect('/auth/sign-in');
  }

  const { role } = await getUserRole(user);

  if (role !== 'company') {
    return redirect('/dashboard/client/metrics');
  }

  return <CompanyDashboard view='codes' />;
}
