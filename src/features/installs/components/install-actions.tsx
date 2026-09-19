'use client';

import { EvidenceField } from '@/features/operations/evidence-field';
import {
  SimpleCommand,
  type SimpleField
} from '@/features/operations/simple-command';
import {
  IconAlertTriangle,
  IconCamera,
  IconCheck,
  IconPlayerPlay,
  IconPlus
} from '@tabler/icons-react';
import { useState } from 'react';
import type { WorkflowRead } from '../types';

// The category a photo is registered under. The command that receives it
// decides the category that is finally recorded.
const IW_PHOTO_CATEGORY: Record<string, string> = {
  IW_PROGRESS: 'Progress',
  IW_REPORT_COMPLETION: 'Completion',
  IW_REPORT_PROBLEM: 'Problem',
  IW_REPORT_VARIATION: 'Variation'
};

/**
 * One installer-workflow command (IW_*) with an optional photo. The package
 * version guards it; office staff acting without an allocation must say why.
 */
function IwAction({
  wf,
  command,
  label,
  icon,
  title,
  description,
  fields,
  build,
  photo,
  officeReason,
  variant = 'outline'
}: {
  wf: WorkflowRead;
  command: string;
  label: string;
  icon?: React.ReactNode;
  title: string;
  description?: string;
  fields: SimpleField[];
  build: (v: Record<string, string>) => Record<string, unknown>;
  photo?: string;
  officeReason: boolean;
  variant?: 'default' | 'outline' | 'destructive';
}) {
  const [path, setPath] = useState<string | null>(null);
  return (
    <SimpleCommand
      label={label}
      icon={icon}
      variant={variant}
      title={title}
      description={description}
      request={{
        command_type: command,
        job_id: wf.job_id,
        work_package_id: wf.work_package_id,
        expected_version: wf.expected_version
      }}
      fields={[
        ...fields,
        ...(officeReason
          ? [
              {
                key: 'reason',
                label: 'Why the office is recording this',
                kind: 'note' as const,
                required: true
              }
            ]
          : [])
      ]}
      payload={(v) =>
        Object.fromEntries(
          Object.entries({
            ...build(v),
            ...(path
              ? {
                  evidence: [
                    { storage_path: path, filename: path.split('/').pop() }
                  ]
                }
              : {}),
            ...(officeReason ? { reason: v.reason } : {})
          }).filter(([, x]) => x !== undefined && x !== '')
        )
      }
    >
      {photo && (
        <EvidenceField
          context={{ type: 'WorkPackage', id: wf.work_package_id }}
          category={IW_PHOTO_CATEGORY[command] ?? 'Progress'}
          label={photo}
          onUploaded={setPath}
        />
      )}
    </SimpleCommand>
  );
}

export function InstallActions({
  wf,
  officeReason
}: {
  wf: WorkflowRead;
  officeReason: boolean;
}) {
  const open = ['Scheduled', 'InProgress', 'ReturnRequired'].includes(
    wf.status
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London'
  }).format(new Date());
  if (!open) return null;
  return (
    <div className='flex flex-wrap gap-2'>
      {wf.status !== 'InProgress' && (
        <IwAction
          wf={wf}
          officeReason={officeReason}
          command='IW_START'
          label='Start work'
          icon={<IconPlayerPlay />}
          variant='default'
          title='Start work'
          fields={[]}
          build={() => ({})}
        />
      )}
      <IwAction
        wf={wf}
        officeReason={officeReason}
        command='IW_PROGRESS'
        label='Progress update'
        icon={<IconCamera />}
        title='Progress update'
        description='A note, a photo, or both.'
        fields={[{ key: 'note', label: 'Note', kind: 'note' }]}
        build={(v) => ({ note: v.note })}
        photo='Photo'
      />
      <IwAction
        wf={wf}
        officeReason={officeReason}
        command='IW_REPORT_COMPLETION'
        label='Finish'
        icon={<IconCheck />}
        variant={wf.status === 'InProgress' ? 'default' : 'outline'}
        title='Report the work finished'
        description='If a return visit is needed it is booked back in for you and the office is told.'
        fields={[
          {
            key: 'outcome',
            label: 'Outcome',
            kind: 'select',
            required: true,
            initial: 'Complete',
            options: [
              { value: 'Complete', label: 'All done' },
              { value: 'ReturnRequired', label: 'Needs a return visit' }
            ]
          },
          {
            key: 'actual_end',
            label: 'Finished on',
            kind: 'date',
            required: true,
            initial: today
          },
          {
            key: 'return_reason',
            label: 'Why a return visit is needed',
            kind: 'note'
          }
        ]}
        build={(v) => ({
          outcome: v.outcome,
          actual_end: v.actual_end,
          ...(v.outcome === 'ReturnRequired'
            ? { return_reason: v.return_reason }
            : {})
        })}
        photo='Photo of the finished work'
      />
      <IwAction
        wf={wf}
        officeReason={officeReason}
        command='IW_REPORT_PROBLEM'
        label='Problem'
        icon={<IconAlertTriangle />}
        title='Report a problem'
        fields={[
          {
            key: 'category',
            label: 'Category',
            kind: 'select',
            required: true,
            initial: 'Technical',
            options: [
              'Access',
              'Damage',
              'Technical',
              'Safety',
              'MaterialsShort',
              'Other'
            ].map((c) => ({
              value: c,
              label: c === 'MaterialsShort' ? 'Materials short' : c
            }))
          },
          {
            key: 'description',
            label: 'What is wrong',
            kind: 'note',
            required: true
          }
        ]}
        build={(v) => ({ category: v.category, description: v.description })}
        photo='Photo'
      />
      <IwAction
        wf={wf}
        officeReason={officeReason}
        command='IW_REPORT_VARIATION'
        label='Variation'
        icon={<IconPlus />}
        title='Report a variation'
        description='Extra or different work the customer wants. It goes to the variation approver.'
        fields={[
          {
            key: 'description',
            label: 'What is needed',
            kind: 'note',
            required: true
          }
        ]}
        build={(v) => ({ description: v.description })}
        photo='Photo'
      />
    </div>
  );
}
