import { PresaleWizard } from '@/features/presale/components/presale-wizard';
import {
  getPermissions,
  getSalespeople
} from '@/features/presale/server/queries';
import { submitPresale } from '@/features/presale/server/submit-presale';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'New presale | Simple Solar Operations'
};

export default async function NewPresalePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const permissions = await getPermissions(user);
  // The database enforces this again on submit; this only avoids showing a form that cannot be used.
  if (!permissions.has('presale.submit')) redirect('/dashboard');

  const salespeople = await getSalespeople();

  return (
    <PresaleWizard
      currentUser={{
        personId: user.id,
        displayName: user.fullName ?? user.email,
        roles: user.roles
      }}
      salespeople={salespeople}
      canSubmitOnBehalf={permissions.has('presale.submit_on_behalf')}
      submitAction={submitPresale}
    />
  );
}
