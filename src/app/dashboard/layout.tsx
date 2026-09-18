import { DashboardLayoutClient } from '@/components/layout/dashboard-layout-client';
import { getPreviewTargets } from '@/features/dev-preview/queries';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Simple Solar Operations'
};

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  // Persisting the sidebar state in the cookie.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';

  // Null in every environment and for every account where preview is not allowed.
  const previewTargets = await getPreviewTargets();

  return (
    <DashboardLayoutClient
      defaultOpen={defaultOpen}
      user={user}
      previewTargets={previewTargets}
    >
      {children}
    </DashboardLayoutClient>
  );
}
