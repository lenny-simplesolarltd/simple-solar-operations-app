'use client';

import { Button } from '@/components/ui/button';
import { CommandDialog } from '@/features/operations/command-dialog';
import { NoteField, SelectField } from '@/features/operations/fields';
import { SimpleCommand } from '@/features/operations/simple-command';
import { useCommand } from '@/features/operations/use-command';
import type { StaffPerson } from '@/lib/backend/admin-models';
import { IconUserMinus, IconUserPlus } from '@tabler/icons-react';
import { useState } from 'react';

// People & access administration through the staff commands (STAFF_CREATE,
// STAFF_ROLE_SET, STAFF_SET_ACTIVE). The database decides: never the last
// Admin, never your own Admin, only an Admin gives or removes Admin. Every
// change carries a reason and is audited.

/** STAFF_CREATE: a new person in the directory (the login is an invitation). */
export function AddPersonButton({ roles }: { roles: string[] }) {
  return (
    <SimpleCommand
      label='Add person'
      icon={<IconUserPlus />}
      variant='default'
      title='Add a person'
      description='Adds them to the directory with a role. Send the login invitation from the list afterwards.'
      request={{ command_type: 'STAFF_CREATE' }}
      fields={[
        { key: 'display_name', label: 'Name', required: true },
        { key: 'email', label: 'Email', required: true },
        {
          key: 'role',
          label: 'Role',
          kind: 'select',
          required: true,
          options: roles.map((r) => ({ value: r, label: r }))
        }
      ]}
      payload={(v) => ({
        display_name: v.display_name.trim(),
        email: v.email.trim(),
        roles: [v.role]
      })}
    />
  );
}

/**
 * STAFF_ROLE_SET: give or remove one role. expected_version is the role
 * row's version (the person's version for a role never held), so it
 * depends on the role chosen in the dialog.
 */
export function RoleChangeButton({
  person,
  roles,
  mode
}: {
  person: StaffPerson;
  roles: string[];
  mode: 'grant' | 'withdraw';
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');
  const { run, pending, outcome, reset } = useCommand();
  const held = person.roles.filter((r) => r.active).map((r) => r.role_code);
  const options = (
    mode === 'grant' ? roles.filter((r) => !held.includes(r)) : held
  ).map((r) => ({ value: r, label: r }));
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setRole('');
      setReason('');
    }
  };
  if (options.length === 0) return null;
  // The role row's version; for a role never held, the person's version.
  const version =
    person.roles.find((r) => r.role_code === role)?.version ?? person.version;
  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        {mode === 'grant' ? 'Give role' : 'Remove role'}
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={`${mode === 'grant' ? 'Give a role to' : 'Remove a role from'} ${person.display_name}`}
        description={
          mode === 'grant'
            ? 'The role takes effect at their next page load.'
            : 'Access that depends on the role stops at once.'
        }
        submitLabel={mode === 'grant' ? 'Give role' : 'Remove role'}
        pending={pending}
        outcome={outcome}
        canSubmit={!!role && reason.trim().length >= 3}
        onSubmit={() =>
          run(
            {
              command_type: 'STAFF_ROLE_SET',
              expected_version: version,
              payload: {
                person_id: person.id,
                role_code: role,
                active: mode === 'grant',
                reason: reason.trim()
              }
            },
            (r) => r.ok && close(false)
          )
        }
      >
        <SelectField
          label='Role'
          required
          value={role}
          onChange={setRole}
          options={options}
        />
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

/** STAFF_SET_ACTIVE: deactivation stops every read and command at once. */
export function ActiveToggleButton({ person }: { person: StaffPerson }) {
  return (
    <SimpleCommand
      label={person.active ? 'Deactivate' : 'Reactivate'}
      icon={person.active ? <IconUserMinus /> : <IconUserPlus />}
      variant={person.active ? 'destructive' : 'outline'}
      title={`${person.active ? 'Deactivate' : 'Reactivate'} ${person.display_name}`}
      description={
        person.active
          ? 'They can no longer sign in or act, and their tasks stay where they are. Reassign their open tasks separately.'
          : 'They regain the roles they still hold.'
      }
      request={{
        command_type: 'STAFF_SET_ACTIVE',
        expected_version: person.version
      }}
      fields={[
        { key: 'reason', label: 'Reason', kind: 'note', required: true }
      ]}
      payload={(v) => ({
        person_id: person.id,
        active: !person.active,
        reason: v.reason.trim()
      })}
    />
  );
}
