import { getCurrentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: Props) {
  // Supabase falls back to the project Site URL when the redirect it was given
  // is not on the allow-list, so an OAuth code can land here instead of on
  // /auth/callback. Hand it to the callback rather than dropping the sign-in.
  const params = await searchParams;
  const code = params.code;
  if (typeof code === 'string' && code) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  }

  const user = await getCurrentUser();

  if (!user) {
    return redirect('/auth/sign-in');
  } else {
    redirect('/dashboard');
  }
}
