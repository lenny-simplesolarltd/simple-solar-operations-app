'use client';

import {
  SimpleCommand,
  type SimpleField
} from '@/features/operations/simple-command';
import { IconPlus } from '@tabler/icons-react';
import type {
  AvailabilityEntry,
  InstallerSkillsRead,
  TeamsRead
} from '../types';

const TYPES = ['Leave', 'Sick', 'Training', 'Unavailable', 'Available'].map(
  (t) => ({ value: t, label: t })
);
const LEVELS = ['Lead', 'Member', 'Apprentice'].map((l) => ({
  value: l,
  label: l
}));

const availabilityFields = (
  people: { id: string; name: string }[],
  entry?: AvailabilityEntry
): SimpleField[] => [
  ...(entry
    ? []
    : [
        {
          key: 'person_id',
          label: 'Person',
          kind: 'select' as const,
          required: true,
          options: people.map((p) => ({ value: p.id, label: p.name }))
        }
      ]),
  {
    key: 'type',
    label: 'Type',
    kind: 'select',
    required: true,
    initial: entry?.type ?? 'Leave',
    options: TYPES
  },
  {
    key: 'from_date',
    label: 'From',
    kind: 'date',
    required: true,
    initial: entry?.from_date ?? ''
  },
  {
    key: 'to_date',
    label: 'To (blank = one day)',
    kind: 'date',
    initial: entry?.to_date ?? ''
  },
  { key: 'reason', label: 'Reason', kind: 'note', initial: entry?.reason ?? '' }
];

/** RP_SET_AVAILABILITY (new entry). */
export function AddAvailability({
  people
}: {
  people: { id: string; name: string }[];
}) {
  return (
    <SimpleCommand
      label='Add'
      icon={<IconPlus />}
      variant='default'
      title='Add availability'
      description='Leave, sickness, training or other time away. Installers booked on those days are listed afterwards for re-planning.'
      request={{ command_type: 'RP_SET_AVAILABILITY' }}
      fields={availabilityFields(people)}
    />
  );
}

/** RP_SET_AVAILABILITY (edit) and RP_CANCEL_AVAILABILITY. */
export function AvailabilityRowActions({
  entry
}: {
  entry: AvailabilityEntry;
}) {
  return (
    <span className='flex flex-wrap gap-1'>
      <SimpleCommand
        label='Edit'
        title={`Edit · ${entry.display_name}`}
        request={{
          command_type: 'RP_SET_AVAILABILITY',
          expected_version: entry.version
        }}
        fields={availabilityFields([], entry)}
        payload={(v) => ({
          availability_id: entry.availability_id,
          person_id: entry.person_id,
          type: v.type,
          from_date: v.from_date,
          ...(v.to_date ? { to_date: v.to_date } : {}),
          ...(v.reason ? { reason: v.reason } : {})
        })}
      />
      <SimpleCommand
        label='Cancel'
        variant='ghost'
        title={`Cancel · ${entry.display_name}`}
        description={`${entry.type} from ${entry.from_date} to ${entry.to_date}.`}
        request={{ command_type: 'RP_CANCEL_AVAILABILITY' }}
        fields={[
          { key: 'reason', label: 'Reason', kind: 'note', required: true }
        ]}
        payload={(v) => ({
          availability_id: entry.availability_id,
          reason: v.reason
        })}
        submitLabel='Cancel entry'
      />
    </span>
  );
}

type Installer = InstallerSkillsRead['installers'][number];

/** RP_SET_SKILL: add or change one skill for an installer. */
export function SetSkill({
  installer,
  skills,
  skill
}: {
  installer: Installer;
  skills: string[];
  skill?: Installer['skills'][number];
}) {
  return (
    <SimpleCommand
      label={skill ? `${skill.skill}: ${skill.level}` : 'Add skill'}
      icon={skill ? undefined : <IconPlus />}
      variant={
        skill
          ? skill.expired || !skill.active
            ? 'destructive'
            : 'secondary'
          : 'outline'
      }
      title={`${skill ? 'Change' : 'Add'} skill · ${installer.display_name}`}
      request={{
        command_type: 'RP_SET_SKILL',
        ...(skill ? { expected_version: skill.version } : {})
      }}
      fields={[
        {
          key: 'skill',
          label: 'Skill',
          kind: 'select',
          required: true,
          initial: skill?.skill ?? skills[0] ?? '',
          options: skills.map((s) => ({ value: s, label: s }))
        },
        {
          key: 'level',
          label: 'Level',
          kind: 'select',
          initial: skill?.level ?? 'Member',
          options: LEVELS
        },
        {
          key: 'certified_until',
          label: 'Certified until',
          kind: 'date',
          initial: skill?.certified_until ?? ''
        },
        {
          key: 'active',
          label: 'Active',
          kind: 'select',
          initial: skill?.active === false ? 'no' : 'yes',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ]
        },
        {
          key: 'notes',
          label: 'Notes',
          kind: 'note',
          initial: skill?.notes ?? ''
        }
      ]}
      payload={(v) => ({
        person_id: installer.person_id,
        skill: v.skill,
        level: v.level,
        active: v.active !== 'no',
        ...(v.certified_until ? { certified_until: v.certified_until } : {}),
        ...(v.notes ? { notes: v.notes } : {})
      })}
    />
  );
}

/** RP_UPSERT_TEAM. */
export function UpsertTeam({ team }: { team?: TeamsRead['teams'][number] }) {
  return (
    <SimpleCommand
      label={team ? 'Edit team' : 'New team'}
      icon={team ? undefined : <IconPlus />}
      variant={team ? 'ghost' : 'outline'}
      title={team ? `Edit · ${team.name}` : 'New team'}
      request={{
        command_type: 'RP_UPSERT_TEAM',
        ...(team ? { expected_version: team.version } : {})
      }}
      fields={[
        {
          key: 'name',
          label: 'Name',
          required: true,
          initial: team?.name ?? ''
        },
        {
          key: 'trade',
          label: 'Trade',
          kind: 'select',
          required: true,
          initial: team?.trade ?? 'Roof',
          options: ['Roof', 'Electrical', 'Mixed'].map((t) => ({
            value: t,
            label: t
          }))
        },
        {
          key: 'active',
          label: 'Active',
          kind: 'select',
          initial: team?.active === false ? 'no' : 'yes',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' }
          ]
        }
      ]}
      payload={(v) => ({
        ...(team ? { team_id: team.team_id } : {}),
        name: v.name,
        trade: v.trade,
        active: v.active !== 'no'
      })}
    />
  );
}

/** RP_SET_TEAM_MEMBER: add an installer to a team or change their role. */
export function SetTeamMember({
  team,
  installers
}: {
  team: TeamsRead['teams'][number];
  installers: { person_id: string; display_name: string }[];
}) {
  return (
    <SimpleCommand
      label='Add / change member'
      variant='ghost'
      title={`Team member · ${team.name}`}
      description='A team has one active Lead; change the current Lead first to appoint another.'
      request={{ command_type: 'RP_SET_TEAM_MEMBER' }}
      fields={[
        {
          key: 'person_id',
          label: 'Installer',
          kind: 'select',
          required: true,
          options: installers.map((i) => ({
            value: i.person_id,
            label: i.display_name
          }))
        },
        {
          key: 'role',
          label: 'Role',
          kind: 'select',
          initial: 'Member',
          options: LEVELS
        },
        {
          key: 'active',
          label: 'In the team',
          kind: 'select',
          initial: 'yes',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No (remove)' }
          ]
        }
      ]}
      payload={(v) => ({
        team_id: team.team_id,
        person_id: v.person_id,
        role: v.role,
        active: v.active !== 'no'
      })}
    />
  );
}
