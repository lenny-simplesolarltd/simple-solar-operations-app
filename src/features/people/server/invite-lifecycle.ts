'use server';

import { getCurrentUser } from '@/lib/auth';
import { previewWriteBlock } from '@/lib/preview/guard';
import { isAdmin } from '@/lib/roles';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// Withdrawing an invite that was never accepted.
//
// This lives in a server action rather than a database command because the
// thing being withdrawn is an auth.users row, and no SQL command can reach
// Supabase Auth. It follows the same shape as inviteStaff: authorize the actor
// FIRST, read the person under RLS, only then touch the service-role client,
// and record what happened.
//
// The safety property that matters: this may only ever delete an auth user
// that is UNCONFIRMED and whose email matches the person row the administrator
// named. A confirmed login is somebody who is using the system - removing that
// is STAFF_SET_ACTIVE's job, through the command registry, with a reason.

export interface InviteActionResult {
  ok: boolean;
  message: string;
}

/**
 * Cancels a pending invite: the emailed link stops working because the account
 * it pointed at is gone. The person stays in the directory with their roles
 * intact - only the unaccepted login offer is withdrawn.
 */
export async function revokeInvite(
  personId: string,
  reason: string
): Promise<InviteActionResult> {
  const blocked = await previewWriteBlock();
  if (blocked) return { ok: false, message: blocked };

  const actor = await getCurrentUser();
  if (!actor || !isAdmin(actor))
    return {
      ok: false,
      message: 'Only an administrator can withdraw an invite.'
    };

  const why = reason.trim();
  if (why.length < 3)
    return { ok: false, message: 'Give a reason for withdrawing the invite.' };

  const supabase = await createClient();
  const { data: person, error } = await supabase
    .from('people')
    .select('id, email, display_name, auth_user_id')
    .eq('id', personId)
    .maybeSingle();
  if (error || !person) return { ok: false, message: 'Person not found.' };
  if (!person.email)
    return { ok: false, message: 'This person has no email address.' };
  if (person.auth_user_id)
    return {
      ok: false,
      message:
        'They have already accepted and are using the app. Deactivate their access instead.'
    };

  const admin = createAdminClient();
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const invited = (list?.users ?? []).find((u) => u.email === person.email);
  if (!invited)
    return { ok: false, message: 'There is no pending invite to withdraw.' };
  // Belt and braces: auth_user_id being null should already mean unconfirmed,
  // but the two facts come from different places, so check the one that counts.
  if (invited.email_confirmed_at)
    return {
      ok: false,
      message:
        'That login has already been confirmed. Deactivate their access instead.'
    };

  const { error: deleteError } = await admin.auth.admin.deleteUser(invited.id);
  if (deleteError)
    return {
      ok: false,
      message: `Could not withdraw the invite: ${deleteError.message}`
    };

  await admin.from('audit_events').insert({
    entity_type: 'people',
    entity_id: person.id,
    action: 'AccessInviteRevoked',
    initiating_person_id: actor.id,
    executing_service: 'app:invite-lifecycle',
    before_json: { email: person.email, invite_pending: true },
    after_json: { email: person.email, invite_pending: false },
    reason: why
  });

  revalidatePath('/dashboard/people');
  return {
    ok: true,
    message: `Invite for ${person.display_name} withdrawn. The link no longer works.`
  };
}
