import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { ReadFailureState } from '@/components/read-failure';
import { describeLogin } from '@/features/people/invite-state';
import { LoginBadge, PersonActions } from '@/features/people/person-actions';
import { AddPersonButton } from '@/features/people/staff-admin';
import { getCurrentUser } from '@/lib/auth';
import type { StaffAdminRead } from '@/lib/backend/admin-models';
import { readOps } from '@/lib/backend/read';
import { isAdmin } from '@/lib/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'People & access | Simple Solar Operations'
};

export default async function PeoplePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!isAdmin(user)) redirect('/dashboard');

  // Staff administration read (STAFF_ADMIN): roles held and withdrawn, with
  // the versions the staff commands check.
  const staff = await readOps<StaffAdminRead>('STAFF_ADMIN');
  if (!staff.ok)
    return (
      <PageContainer>
        <ReadFailureState failure={staff.error} />
      </PageContainer>
    );
  const people = staff.data.people;
  // Only an Admin gives or removes Admin (the database refuses otherwise).
  const grantable = staff.data.roles.filter(
    (r) => staff.data.actor_is_admin || r !== 'Admin'
  );

  // Pending invites live in Supabase Auth, which only the service role can list.
  // The actor has already been authorized as an administrator above.
  const { data: authUsers } = await createAdminClient().auth.admin.listUsers({
    perPage: 1000
  });
  // Keyed by address, because email is what the linking trigger matches on.
  const authByEmail = new Map(
    (authUsers?.users ?? [])
      .filter((u) => u.email)
      .map((u) => [
        u.email as string,
        {
          emailConfirmedAt: u.email_confirmed_at ?? null,
          invitedAt: u.invited_at ?? u.confirmation_sent_at ?? null
        }
      ])
  );

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title='People & access'
            description='Everyone in the directory. A login is separate: invite only the people who need to use the app. They set their own password from the emailed link; roles decide what they can do. Every change needs a reason and is recorded.'
          />
          <AddPersonButton roles={grantable} />
        </div>
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Login</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => {
                const roles = person.roles
                  .filter((r) => r.active)
                  .map((r) => r.role_code);
                const status = describeLogin({
                  email: person.email,
                  hasLogin: person.has_login,
                  authUser: person.email
                    ? (authByEmail.get(person.email) ?? null)
                    : null
                });
                return (
                  <TableRow
                    key={person.id}
                    className={person.active ? '' : 'opacity-60'}
                  >
                    <TableCell className='font-medium'>
                      {person.display_name}
                      {!person.active && (
                        <span className='text-muted-foreground'>
                          {' '}
                          (inactive)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{person.email ?? '-'}</TableCell>
                    <TableCell>
                      {roles.length ? (
                        roles.join(', ')
                      ) : (
                        <span className='text-muted-foreground'>No role</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LoginBadge status={status} />
                      <p className='text-muted-foreground mt-1 text-xs'>
                        {status.detail}
                      </p>
                    </TableCell>
                    <TableCell>
                      <PersonActions
                        person={person}
                        status={status}
                        grantableRoles={grantable}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageContainer>
  );
}
