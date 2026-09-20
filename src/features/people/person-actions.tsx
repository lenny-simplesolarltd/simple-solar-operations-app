'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { CommandDialog } from '@/features/operations/command-dialog';
import { NoteField } from '@/features/operations/fields';
import type { StaffPerson } from '@/lib/backend/admin-models';
import { IconDotsVertical } from '@tabler/icons-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { InviteButton } from './invite-button';
import { hasPendingInvite, type LoginStatus } from './invite-state';
import { revokeInvite } from './server/invite-lifecycle';
import { ActiveToggleButton, RoleChangeButton } from './staff-admin';

// One row's actions. The point of this component is restraint: the row shows
// at most ONE button, the thing an administrator actually wants to do next,
// and everything else lives behind the dots. The previous table put Invite,
// Give role, Remove role and Deactivate on every row at once.
//
// The existing command buttons are reused untouched - they each own their own
// dialog and authorization - they are simply stacked inside the popover rather
// than spread across the row.

const TONE: Record<
  LoginStatus['tone'],
  'outline' | 'info' | 'success' | 'warning'
> = {
  neutral: 'outline',
  progress: 'info',
  done: 'success',
  attention: 'warning'
};

export function LoginBadge({ status }: { status: LoginStatus }) {
  return (
    <span title={status.detail}>
      <Badge variant={TONE[status.tone]}>{status.label}</Badge>
    </span>
  );
}

export function PersonActions({
  person,
  status,
  grantableRoles
}: {
  person: StaffPerson;
  status: LoginStatus;
  grantableRoles: string[];
}) {
  const [open, setOpen] = useState(false);
  const pending = hasPendingInvite(status);
  // Inviting needs an address and at least one role: a login with no role has
  // no access, and the server refuses it anyway.
  const canInvite =
    person.active &&
    status.state !== 'NoEmail' &&
    !person.has_login &&
    person.roles.some((r) => r.active);

  return (
    <div className='flex items-center justify-end gap-1'>
      {canInvite && <InviteButton personId={person.id} resend={pending} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size='sm'
            variant='ghost'
            aria-label={`More actions for ${person.display_name}`}
          >
            <IconDotsVertical />
          </Button>
        </PopoverTrigger>
        <PopoverContent align='end' className='flex w-56 flex-col gap-1 p-1'>
          {person.active && (
            <RoleChangeButton
              person={person}
              roles={grantableRoles}
              mode='grant'
            />
          )}
          <RoleChangeButton
            person={person}
            roles={grantableRoles}
            mode='withdraw'
          />
          {pending && (
            <RevokeInviteButton
              personId={person.id}
              name={person.display_name}
            />
          )}
          <ActiveToggleButton person={person} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Withdraws an invite nobody accepted. Separate from Deactivate on purpose:
 * this removes an offer of access, where deactivating removes access somebody
 * is already using.
 */
function RevokeInviteButton({
  personId,
  name
}: {
  personId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [working, startTransition] = useTransition();

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) setReason('');
  };

  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        Withdraw invite
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={`Withdraw the invite for ${name}`}
        description='The emailed link stops working. They stay in the directory and keep their roles — only the unaccepted login offer is withdrawn.'
        submitLabel='Withdraw invite'
        pending={working}
        // Withdrawing is a server action against Supabase Auth, not a database
        // command, so there is no CommandOutcome to render. The result is a
        // toast either way.
        outcome={null}
        canSubmit={reason.trim().length >= 3}
        onSubmit={() =>
          startTransition(async () => {
            const result = await revokeInvite(personId, reason);
            if (result.ok) {
              toast.success(result.message);
              close(false);
            } else {
              toast.error(result.message);
            }
          })
        }
      >
        <NoteField
          label='Reason'
          required
          value={reason}
          onChange={setReason}
        />
      </CommandDialog>
    </>
  );
}
