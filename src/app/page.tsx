import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function Page() {
  const user = await getCurrentUser();

  if (!user) {
    return redirect('/auth/sign-in');
  } else {
    redirect('/dashboard');
  }
}
