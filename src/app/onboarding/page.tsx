import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getUserRole } from '@/lib/userRoles';
import PlanSelect from './plan-select';

export default async function OnboardingPage() {
  const { userId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return redirect('/auth/sign-in');
  }

  const { role } = await getUserRole(user);

  if (role === 'company') {
    return redirect('/dashboard/company');
  }

  return <PlanSelect />;
}
