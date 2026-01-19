import ClientDashboard from './client-dashboard';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function ClientPage() {
  const { userId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return redirect('/auth/sign-in');
  }

  const { role } = await getUserRole(user);

  return <ClientDashboard />;
}
