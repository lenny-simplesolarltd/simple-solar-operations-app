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
import { InviteButton } from '@/features/people/invite-button';
import { getCurrentUser } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'People & access | Simple Solar Operations'
};

export default async function PeoplePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!isAdmin(user)) redirect('/dashboard');

  const supabase = await createClient();
  const { data: people, error } = await supabase
    .from('people')
    .select(
      'id, display_name, email, active, auth_user_id, person_roles!person_roles_person_id_fkey(role_code, active)'
    )
    .order('display_name');
  if (error) throw new Error(`people: ${error.message}`);

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
        <Heading
          title='People & access'
          description='Everyone in the directory. A login is separate: invite only the people who need to use the app. They set their own password from the emailed link; roles decide what they can do.'
        />
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
                const roles = person.person_roles
                  .filter((r) => r.active)
                  .map((r) => r.role_code);
                const pending =
                  !!person.email && pendingEmails.has(person.email);
                const canInvite =
                  person.active &&
                  !!person.email &&
                  !person.auth_user_id &&
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
                      {person.auth_user_id ? (
                        <Badge variant='success'>Active login</Badge>
                      ) : pending ? (
                        <Badge variant='warning'>Invited</Badge>
                      ) : (
                        <Badge variant='outline'>No login</Badge>
                      )}
                    </TableCell>
                    <TableCell className='text-right'>
                      {canInvite && (
                        <InviteButton personId={person.id} resend={pending} />
                      )}
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
