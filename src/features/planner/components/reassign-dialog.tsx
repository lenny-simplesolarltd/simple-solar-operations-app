'use client';

import { Label } from '@/components/ui/label';
import { CommandDialog } from '@/features/operations/command-dialog';
import { NoteField, SelectField } from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import { cn } from '@/lib/utils';
import { IconLoader2 } from '@tabler/icons-react';
import { useEffect, useState, useTransition } from 'react';
import { changeInstallerOptions } from '../actions';
import { KIND_LABEL, type CalendarEvent } from '../calendar/events';
import { READINESS_REASON, type Candidate } from '../types';

/**
 * CHANGE_INSTALLER_R2 reached by keyboard rather than by dragging onto another
 * resource row. Same command, same checks, same audit - the only difference is
 * how the person was chosen.
 *
 * RP_CHANGE_INSTALLER_OPTIONS is the read built for exactly this: it assesses
 * every candidate against the dates this work already has.
 */
export function ReassignDialog({
  event,
  onClose,
  onDone
}: {
  event: CalendarEvent | null;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!event?.work?.allocationId) return null;
  // Keyed on the allocation, so opening a different piece of work gets a
  // fresh form instead of an effect clearing the last one.
  return (
    <ReassignForm
      key={event.work.allocationId}
      event={event}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function ReassignForm({
  event,
  onClose,
  onDone
}: {
  event: CalendarEvent;
  onClose: () => void;
  onDone: () => void;
}) {
  const work = event.work!;
  const [mode, setMode] = useState<'Replace' | 'Add'>('Replace');
  const [person, setPerson] = useState('');
  const [reason, setReason] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const { run, pending, outcome } = useCommand();

  useEffect(() => {
    let live = true;
    startLoading(async () => {
      const r = await changeInstallerOptions({
        work_package_id: work.workPackageId,
        old_allocation_id: work.allocationId ?? undefined
      });
      if (!live) return;
      if (r.ok) {
        setCandidates(r.data.candidates);
        setError(null);
      } else {
        setCandidates([]);
        setError(r.error.message);
      }
    });
    return () => {
      live = false;
    };
  }, [work.workPackageId, work.allocationId]);

  const options = candidates.filter((c) => !c.currently_allocated);

  return (
    <CommandDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Change installer · ${event.jobRef ?? ''} ${KIND_LABEL[event.kind]}`}
      description={`Currently ${work.personName ?? 'unknown'} (${work.role ?? 'Lead'}). The dates do not change.`}
      submitLabel={mode === 'Replace' ? 'Replace installer' : 'Add installer'}
      pending={pending}
      outcome={outcome}
      canSubmit={!!person && !!reason.trim()}
      onSubmit={() =>
        run(
          {
            command_type: 'CHANGE_INSTALLER_R2',
            job_id: event.jobId,
            work_package_id: work.workPackageId,
            old_allocation_id: work.allocationId ?? undefined,
            expected_version: work.workPackageVersion,
            payload: {
              mode,
              person_id: person,
              reason,
              ...(mode === 'Add' ? { role: 'Second' } : {})
            }
          },
          (r) => {
            if (!r.ok) return;
            onDone();
            onClose();
          }
        )
      }
    >
      <SelectField
        label='Change'
        value={mode}
        onChange={(v) => setMode(v)}
        options={[
          {
            value: 'Replace',
            label: `Replace ${work.personName ?? 'this installer'}`
          },
          { value: 'Add', label: 'Add a second installer' }
        ]}
      />

      {loading && (
        <p className='text-muted-foreground flex items-center gap-2 text-sm'>
          <IconLoader2 className='size-4 animate-spin' /> Checking who is free…
        </p>
      )}
      {error && <p className='text-destructive text-sm'>{error}</p>}
      {!loading && !error && options.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          No other installers to choose from.
        </p>
      )}
      {options.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <Label>Installer</Label>
          <ul
            role='radiogroup'
            className='flex max-h-64 flex-col gap-1 overflow-y-auto'
          >
            {options.map((c) => (
              <li key={c.person_id}>
                <button
                  type='button'
                  role='radio'
                  aria-checked={person === c.person_id}
                  onClick={() => setPerson(c.person_id)}
                  className={cn(
                    'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    person === c.person_id
                      ? 'border-primary bg-accent'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <span className='flex items-center justify-between gap-2'>
                    <span className='font-medium'>{c.display_name}</span>
                    <span
                      className={
                        c.ready
                          ? 'text-success text-xs'
                          : 'text-destructive text-xs'
                      }
                    >
                      {c.ready ? 'Free' : 'Not ready'}
                    </span>
                  </span>
                  {(c.reasons.length > 0 || c.warnings.length > 0) && (
                    <span className='text-muted-foreground block text-xs'>
                      {[...c.reasons, ...c.warnings]
                        .map((r) => READINESS_REASON[r] ?? r)
                        .join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <NoteField label='Reason' required value={reason} onChange={setReason} />
    </CommandDialog>
  );
}
