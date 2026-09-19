'use client';

import { Button } from '@/components/ui/button';
import { CommandDialog } from '@/features/operations/command-dialog';
import { EvidenceField } from '@/features/operations/evidence-field';
import {
  localDateTimeToIso,
  NoteField,
  TextField
} from '@/features/operations/fields';
import { SimpleCommand } from '@/features/operations/simple-command';
import { useCommand } from '@/features/operations/use-command';
import type { OpsFlag, OpsIssue, OpsPackage } from '@/lib/backend/models';
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCertificate,
  IconCheck,
  IconCircleCheck,
  IconLock,
  IconPhoneCall,
  IconUserEdit
} from '@tabler/icons-react';
import { useState } from 'react';
import { CALL_OUTCOMES, CALL_TYPES, flagText } from './labels';

// R1 job operations. Every button runs one backend command through
// execute_command; availability only decides whether the button is offered.
// The server re-checks role, assignment, release mode, versions and gates.

const gate = (flag: OpsFlag) => ({
  disabled: !flag.available,
  disabledReason: flagText(flag)
});

/** COMMISSIONING_RECORD: the office records the certificate / evidence. */
export function RecordCommissioning({
  jobId,
  pkg
}: {
  jobId: string;
  pkg: OpsPackage;
}) {
  const flag = pkg.actions.commissioning_record;
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const { run, pending, outcome, reset } = useCommand();
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setPath(null);
      setReference('');
      setNotes('');
    }
  };
  return (
    <>
      <Button
        size='sm'
        variant={pkg.commissioning.accepted ? 'outline' : 'default'}
        disabled={!flag.available}
        title={flagText(flag)}
        onClick={() => setOpen(true)}
      >
        <IconCertificate />
        {pkg.commissioning.accepted
          ? 'Replace commissioning record'
          : 'Record commissioning'}
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={`Record ${pkg.trade.toLowerCase()} commissioning`}
        description='Upload the certificate or commissioning evidence from the current process. It counts towards completion for this work package; it is not an installer form review.'
        submitLabel='Record commissioning'
        pending={pending}
        outcome={outcome}
        canSubmit={!!path}
        onSubmit={() =>
          run(
            {
              command_type: 'COMMISSIONING_RECORD',
              job_id: jobId,
              work_package_id: pkg.id,
              expected_version: pkg.version,
              payload: {
                evidence_path: path,
                ...(reference.trim() ? { reference: reference.trim() } : {}),
                ...(notes.trim() ? { notes: notes.trim() } : {})
              }
            },
            (r) => r.ok && close(false)
          )
        }
      >
        <EvidenceField
          jobId={jobId}
          label='Certificate or evidence'
          required
          onUploaded={setPath}
        />
        <TextField
          label='Certificate / document reference'
          value={reference}
          onChange={setReference}
          placeholder='e.g. EIC number'
        />
        <NoteField label='Notes' value={notes} onChange={setNotes} />
      </CommandDialog>
    </>
  );
}

/** CALL_RECORD without a task: a call logged against the job. */
export function LogJobCall({
  jobId,
  jobVersion,
  packages,
  flag
}: {
  jobId: string;
  jobVersion: number;
  packages: OpsPackage[];
  flag: OpsFlag;
}) {
  return (
    <SimpleCommand
      label='Log call'
      icon={<IconPhoneCall />}
      title='Log a call on this job'
      description='For calls that are not an installer-confirmation or customer-happy call task. It records the call only; it changes no task or work status.'
      request={{
        command_type: 'CALL_RECORD',
        job_id: jobId,
        expected_version: jobVersion
      }}
      {...gate(flag)}
      fields={[
        {
          key: 'type',
          label: 'Who',
          kind: 'select',
          required: true,
          initial: 'Customer',
          options: CALL_TYPES
        },
        {
          key: 'outcome',
          label: 'Outcome',
          kind: 'select',
          required: true,
          options: CALL_OUTCOMES
        },
        ...(packages.length
          ? [
              {
                key: 'work_package_id',
                label: 'About (optional)',
                kind: 'select' as const,
                options: packages.map((p) => ({
                  value: p.id,
                  label: `${p.trade} work`
                }))
              }
            ]
          : []),
        { key: 'attempted_at', label: 'When', kind: 'datetime-local' },
        {
          key: 'next_attempt_at',
          label: 'Try again at',
          kind: 'datetime-local'
        },
        { key: 'notes', label: 'Notes', kind: 'note' }
      ]}
      payload={(v) => ({
        type: v.type,
        outcome: v.outcome,
        ...(v.work_package_id ? { work_package_id: v.work_package_id } : {}),
        ...(localDateTimeToIso(v.attempted_at)
          ? { attempted_at: localDateTimeToIso(v.attempted_at) }
          : {}),
        ...(localDateTimeToIso(v.next_attempt_at)
          ? { next_attempt_at: localDateTimeToIso(v.next_attempt_at) }
          : {}),
        ...(v.notes.trim() ? { notes: v.notes.trim() } : {})
      })}
    />
  );
}

/** ISSUE_CREATE. "Blocks completion" is the reference customer_impact flag. */
export function RaiseIssue({
  jobId,
  jobVersion,
  flag
}: {
  jobId: string;
  jobVersion: number;
  flag: OpsFlag;
}) {
  return (
    <SimpleCommand
      label='Raise issue'
      icon={<IconAlertTriangle />}
      title='Raise an issue'
      description='A blocking issue must be resolved before the job can be marked operationally complete.'
      request={{
        command_type: 'ISSUE_CREATE',
        job_id: jobId,
        expected_version: jobVersion
      }}
      {...gate(flag)}
      fields={[
        {
          key: 'issue_type',
          label: 'Type',
          kind: 'select',
          required: true,
          options: [
            { value: 'Remedial', label: 'Remedial' },
            { value: 'Complaint', label: 'Complaint' },
            { value: 'Variation', label: 'Variation' }
          ]
        },
        { key: 'title', label: 'Title', required: true },
        {
          key: 'description',
          label: 'What happened',
          kind: 'note',
          required: true
        },
        {
          key: 'customer_impact',
          label: 'Blocks completion',
          kind: 'select',
          required: true,
          initial: 'yes',
          options: [
            { value: 'yes', label: 'Yes - must be resolved first' },
            { value: 'no', label: 'No' }
          ]
        },
        {
          key: 'severity',
          label: 'Severity',
          kind: 'select',
          initial: 'Normal',
          options: [
            { value: 'Normal', label: 'Normal' },
            { value: 'Medium', label: 'Medium' }
          ]
        }
      ]}
    />
  );
}

/** ISSUE_UPDATE TRANSITION: Resolved (with resolution) / Closed (customer confirmed). */
export function IssueActions({
  jobId,
  issue
}: {
  jobId: string;
  issue: OpsIssue;
}) {
  const request = {
    command_type: 'ISSUE_UPDATE',
    job_id: jobId,
    issue_id: issue.id,
    expected_version: issue.version
  };
  return (
    <div className='flex flex-wrap gap-2'>
      {issue.actions.resolve.available && (
        <SimpleCommand
          label='Resolve'
          icon={<IconCheck />}
          title='Resolve issue'
          request={request}
          fields={[
            {
              key: 'resolution',
              label: 'How it was resolved',
              kind: 'note',
              required: true
            }
          ]}
          payload={(v) => ({
            action: 'TRANSITION',
            status: 'Resolved',
            resolution: v.resolution.trim()
          })}
        />
      )}
      {issue.actions.close.available && (
        <SimpleCommand
          label='Close'
          icon={<IconLock />}
          title='Close issue'
          description='Close only once the customer has confirmed the resolution.'
          submitLabel='Customer confirmed - close'
          request={request}
          payload={() => ({
            action: 'TRANSITION',
            status: 'Closed',
            customer_resolution_confirmed: true
          })}
        />
      )}
    </div>
  );
}

/** OPERATIONAL_COMPLETE. The server re-evaluates the gate; nothing is written unless it passes. */
export function CompleteJob({
  jobId,
  jobVersion,
  flag
}: {
  jobId: string;
  jobVersion: number;
  flag: OpsFlag;
}) {
  return (
    <SimpleCommand
      label='Mark operationally complete'
      icon={<IconCircleCheck />}
      variant='default'
      title='Mark the job operationally complete'
      description='The completion checks are re-run on the server. If anything is outstanding nothing is changed.'
      request={{
        command_type: 'OPERATIONAL_COMPLETE',
        job_id: jobId,
        expected_version: jobVersion
      }}
      {...gate(flag)}
      payload={() => ({})}
    />
  );
}

/** PLANNER_UPDATE: one work package's planned dates. */
export function ChangeDates({
  jobId,
  pkg
}: {
  jobId: string;
  pkg: OpsPackage;
}) {
  return (
    <SimpleCommand
      label='Change dates'
      icon={<IconCalendarEvent />}
      title={`Change ${pkg.trade.toLowerCase()} dates`}
      description='Changes this work package only. Use Move job to move several activities together.'
      request={{
        command_type: 'PLANNER_UPDATE',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version
      }}
      {...gate(pkg.actions.planner_update)}
      fields={[
        {
          key: 'planned_start',
          label: 'Start',
          kind: 'date',
          required: true,
          initial: pkg.planned_start ?? ''
        },
        {
          key: 'planned_end',
          label: 'End',
          kind: 'date',
          required: true,
          initial: pkg.planned_end ?? pkg.planned_start ?? ''
        },
        { key: 'reason', label: 'Reason', kind: 'note' }
      ]}
    />
  );
}

/** CHANGE_INSTALLER: replace or add an installer on a work package. */
export function ChangeInstaller({
  jobId,
  pkg,
  installers
}: {
  jobId: string;
  pkg: OpsPackage;
  installers: { id: string; name: string }[];
}) {
  const current = pkg.allocations;
  return (
    <SimpleCommand
      label='Change installer'
      icon={<IconUserEdit />}
      title={`Change ${pkg.trade.toLowerCase()} installer`}
      description='The installer is checked for availability, leave and capacity. If they can’t do it, nothing changes and you’re told why.'
      request={{
        command_type: 'CHANGE_INSTALLER',
        job_id: jobId,
        work_package_id: pkg.id,
        expected_version: pkg.version
      }}
      {...gate(pkg.actions.change_installer)}
      fields={[
        {
          key: 'mode',
          label: 'Change',
          kind: 'select',
          required: true,
          initial: 'Replace',
          options: [
            { value: 'Replace', label: 'Replace an installer' },
            { value: 'Add', label: 'Add another installer' }
          ]
        },
        {
          key: 'old_allocation_id',
          label: 'Current installer',
          kind: 'select',
          required: true,
          initial: current.length === 1 ? current[0].id : '',
          options: current.map((a) => ({
            value: a.id,
            label: `${a.person_name ?? 'Unknown'} (${a.role})`
          }))
        },
        {
          key: 'person_id',
          label: 'New installer',
          kind: 'select',
          required: true,
          options: installers
            .filter((i) => !current.some((a) => a.person_id === i.id))
            .map((i) => ({ value: i.id, label: i.name }))
        },
        {
          key: 'role',
          label: 'Role (optional)',
          kind: 'select',
          options: ['Lead', 'Second', 'Support'].map((r) => ({
            value: r,
            label: r
          }))
        },
        { key: 'reason', label: 'Reason', kind: 'note', required: true }
      ]}
    />
  );
}

/** REINSTATE_JOB: a cancelled job back to Prebooking (S15). */
export function ReinstateJob({
  jobId,
  jobVersion,
  flag
}: {
  jobId: string;
  jobVersion: number;
  flag: OpsFlag;
}) {
  return (
    <SimpleCommand
      label='Reinstate job'
      title='Reinstate this job'
      description='The job returns to Prebooking with fresh work packages. Installers are not re-allocated.'
      request={{
        command_type: 'REINSTATE_JOB',
        job_id: jobId,
        expected_version: jobVersion
      }}
      {...gate(flag)}
      fields={[
        { key: 'reason', label: 'Reason', kind: 'note', required: true },
        {
          key: 'new_date',
          label: 'Next action date',
          kind: 'date',
          required: true
        },
        {
          key: 'commitment_review',
          label: 'Commitments reviewed',
          kind: 'note',
          required: true
        },
        {
          key: 'finance_review',
          label: 'Finance reviewed',
          kind: 'note',
          required: true
        },
        {
          key: 'evidence_reference',
          label: 'Evidence reference',
          required: true
        },
        { key: 'risk_review', label: 'Risk review', kind: 'note' }
      ]}
    />
  );
}
