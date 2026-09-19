import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
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
import { InviteButton } from '@/features/people/invite-button';
import {
  ActiveToggleButton,
  AddPersonButton,
  RoleChangeButton
} from '@/features/people/staff-admin';
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
  const pendingEmails = new Set(
    (authUsers?.users ?? [])
      .filter((u) => !u.email_confirmed_at)
      .map((u) => u.email)
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
                const pending =
                  !!person.email && pendingEmails.has(person.email);
                const canInvite =
                  person.active &&
                  !!person.email &&
                  !person.has_login &&
                  roles.length > 0;
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
                      {person.has_login ? (
                        <Badge variant='success'>Active login</Badge>
                      ) : pending ? (
                        <Badge variant='warning'>Invited</Badge>
                      ) : (
                        <Badge variant='outline'>No login</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap justify-end gap-2'>
                        {canInvite && (
                          <InviteButton personId={person.id} resend={pending} />
                        )}
                        {person.active && (
                          <RoleChangeButton
                            person={person}
                            roles={grantable}
                            mode='grant'
                          />
                        )}
                        <RoleChangeButton
                          person={person}
                          roles={grantable}
                          mode='withdraw'
                        />
                        <ActiveToggleButton person={person} />
                      </div>
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
