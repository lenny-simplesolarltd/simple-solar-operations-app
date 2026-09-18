'use client';

import { SimpleCommand } from '@/features/operations/simple-command';
import { IconCheck, IconFileCheck, IconRotate } from '@tabler/icons-react';

/** COMMISSIONING_REVIEW: accept or return the submitted form (notes required). */
export function ReviewActions({
  jobId,
  workPackageId,
  submissionId,
  version,
  templateConfigured
}: {
  jobId: string;
  workPackageId: string;
  submissionId: string;
  version: number;
  templateConfigured: boolean;
}) {
  const request = {
    command_type: 'COMMISSIONING_REVIEW',
    job_id: jobId,
    work_package_id: workPackageId,
    expected_version: version
  };
  return (
    <div className='flex flex-wrap gap-2'>
      <SimpleCommand
        label='Accept'
        icon={<IconCheck />}
        variant='default'
        title='Accept commissioning'
        disabled={!templateConfigured}
        disabledReason='A form without an approved template cannot be accepted'
        request={request}
        fields={[
          {
            key: 'review_notes',
            label: 'Notes',
            kind: 'note',
            required: true,
            initial: 'Checked and accepted.'
          }
        ]}
        payload={(v) => ({
          submission_id: submissionId,
          status: 'Accepted',
          review_notes: v.review_notes
        })}
      />
      <SimpleCommand
        label='Return to installer'
        icon={<IconRotate />}
        variant='destructive'
        title='Return commissioning'
        description='The installer sees your notes and must fix and resubmit.'
        request={request}
        fields={[
          {
            key: 'review_notes',
            label: 'What needs fixing',
            kind: 'note',
            required: true
          }
        ]}
        payload={(v) => ({
          submission_id: submissionId,
          status: 'Returned',
          review_notes: v.review_notes
        })}
      />
    </div>
  );
}

/** HANDOVER_CREATE: start the job's handover pack once commissioning is in. */
export function CreateHandover({
  jobId,
  jobVersion
}: {
  jobId: string;
  jobVersion: number;
}) {
  return (
    <SimpleCommand
      label='Create handover'
      icon={<IconFileCheck />}
      title='Create handover'
      description='Starts the customer handover pack for this job.'
      request={{
        command_type: 'HANDOVER_CREATE',
        job_id: jobId,
        expected_version: jobVersion
      }}
      fields={[
        {
          key: 'checklist_version',
          label: 'Checklist version',
          required: true,
          initial: 'v1'
        },
        {
          key: 'documents',
          label: 'Documents required (comma separated)',
          initial: 'Certificate, Warranty, User guide'
        }
      ]}
      payload={(v) => ({
        checklist_version: v.checklist_version,
        required_document_types: v.documents
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean)
      })}
    />
  );
}
