'use client';

import { SimpleCommand } from '@/features/operations/simple-command';
import type { ReleaseFunction } from '@/lib/backend/admin-models';
import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';

// RELEASE_MODE_SET: the only way to switch a release function. The database
// allows only Disabled or the function's planned mode, refuses a function
// whose dependency (office core FN-01) is off, refuses switching off a
// function others depend on, and records who and why.

export function SwitchOnButton({
  fn,
  disabledReason
}: {
  fn: ReleaseFunction;
  disabledReason?: string;
}) {
  return (
    <SimpleCommand
      label='Switch on'
      icon={<IconPlayerPlay />}
      variant='default'
      title={`Switch on ${fn.function_id} ${fn.name}`}
      description={`It runs in its planned mode (${fn.planned_mode}). Pilot limits it to pilot jobs; All covers every job.`}
      disabled={!!disabledReason}
      disabledReason={disabledReason}
      request={{
        command_type: 'RELEASE_MODE_SET',
        expected_version: fn.version
      }}
      fields={[
        {
          key: 'scope',
          label: 'Scope',
          kind: 'select',
          required: true,
          initial: 'Pilot',
          options: [
            { value: 'Pilot', label: 'Pilot jobs only' },
            { value: 'All', label: 'All jobs' }
          ]
        },
        {
          key: 'reason',
          label: 'Reason (who approved it and why)',
          kind: 'note',
          required: true
        }
      ]}
      payload={(v) => ({
        function_id: fn.function_id,
        mode: fn.planned_mode,
        scope: v.scope,
        reason: v.reason.trim()
      })}
    />
  );
}

export function SwitchOffButton({
  fn,
  disabledReason
}: {
  fn: ReleaseFunction;
  disabledReason?: string;
}) {
  return (
    <SimpleCommand
      label='Switch off'
      icon={<IconPlayerStop />}
      variant='destructive'
      title={`Switch off ${fn.function_id} ${fn.name}`}
      description='Its commands are refused from now on and its schedules do nothing. Records already made stay.'
      disabled={!!disabledReason}
      disabledReason={disabledReason}
      request={{
        command_type: 'RELEASE_MODE_SET',
        expected_version: fn.version
      }}
      fields={[
        { key: 'reason', label: 'Reason', kind: 'note', required: true }
      ]}
      payload={(v) => ({
        function_id: fn.function_id,
        mode: 'Disabled',
        reason: v.reason.trim()
      })}
    />
  );
}
