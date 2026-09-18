'use server';

import { getCurrentUser } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';
import { getSiteUrl } from '@/lib/site-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface InviteResult {
  ok: boolean;
  message: string;
}

/**
 * Grants application access to an existing person: Supabase Auth emails them an
 * invite, they follow it into the app and set their OWN password. No password
 * is ever generated, seen or stored here. The new auth user links to the person
 * by verified email (database trigger); permissions still come only from
 * person_roles.
 */
export async function inviteStaff(personId: string): Promise<InviteResult> {
  // 1. Authorize the signed-in actor BEFORE touching the service-role client.
  const actor = await getCurrentUser();
  if (!actor || !isAdmin(actor)) {
    return { ok: false, message: 'Only an administrator can grant access.' };
  }

  // 2. Read the person as the actor (RLS applies).
  const supabase = await createClient();
  const { data: person, error } = await supabase
    .from('people')
    .select(
      'id, email, display_name, active, auth_user_id, person_roles!person_roles_person_id_fkey(active)'
    )
    .eq('id', personId)
    .maybeSingle();
  if (error || !person) return { ok: false, message: 'Person not found.' };
  if (!person.active) return { ok: false, message: 'This person is inactive.' };
  if (!person.email)
    return { ok: false, message: 'This person has no email address.' };
  if (person.auth_user_id)
    return { ok: false, message: 'This person already has a login.' };
  if (!person.person_roles.some((r) => r.active)) {
    return {
      ok: false,
      message:
        'Give this person a role first - a login with no role has no access.'
    };
  }

  // 3. Ask Supabase Auth to send the invite.
  const admin = createAdminClient();
  const redirectTo = `${await getSiteUrl()}/auth/confirm`;
  let invite = await admin.auth.admin.inviteUserByEmail(person.email, {
    redirectTo
  });

  if (invite.error && /already/i.test(invite.error.message)) {
    // A previous invite that was never accepted: replace it so a fresh email goes out.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const pending = list?.users.find((u) => u.email === person.email);
    if (pending && !pending.email_confirmed_at) {
      await admin.auth.admin.deleteUser(pending.id);
      invite = await admin.auth.admin.inviteUserByEmail(person.email, {
        redirectTo
      });
    } else {
      return {
        ok: false,
        message:
          'A confirmed login already exists for this email. They can use "Forgot your password?".'
      };
    }
  }
  if (invite.error) {
    return {
      ok: false,
      message: `Supabase could not send the invite: ${invite.error.message}`
    };
  }

  // 4. Audit (initiating person = the administrator; the service only executes).
  await admin.from('audit_events').insert({
    entity_type: 'people',
    entity_id: person.id,
    action: 'AccessInvited',
    initiating_person_id: actor.id,
    executing_service: 'app:invite-staff',
    after_json: { email: person.email }
  });

  revalidatePath('/dashboard/people');
  return { ok: true, message: `Invite emailed to ${person.email}.` };
}
