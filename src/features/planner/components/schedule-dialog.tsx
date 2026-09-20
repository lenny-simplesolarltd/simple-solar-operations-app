'use client';

import { Label } from '@/components/ui/label';
import { CommandDialog } from '@/features/operations/command-dialog';
import { SelectField, TextField } from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import { cn } from '@/lib/utils';
import { IconLoader2 } from '@tabler/icons-react';
import { useEffect, useState, useTransition } from 'react';
import { assessInstallers } from '../actions';
import {
  READINESS_REASON,
  type Candidate,
  type UnscheduledWork
} from '../types';

const ASSESSED_TRADES = ['Roof', 'Electrical'];

/**
 * PLAN_WORK_PACKAGE for a piece of work dragged in from "Needs scheduling".
 *
 * Dropping on a day proposes the dates; it never books anything. An installer
 * is required, because scheduling work without one is not a state this system
 * has - and choosing one is what makes the readiness check meaningful.
 */
export function ScheduleDialog({
  work,
  day,
  onClose,
  onDone
}: {
  work: UnscheduledWork | null;
  /** The day it was dropped on, if it was dropped rather than clicked. */
  day: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!work) return null;
  // Keyed on the work and the day, so each drop gets a form that starts from
  // its own dates rather than an effect resetting the previous one.
  return (
    <ScheduleForm
      key={`${work.work_package_id}:${day ?? ''}`}
      work={work}
      day={day}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function ScheduleForm({
  work,
  day,
  onClose,
  onDone
}: {
  work: UnscheduledWork;
  day: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const initial = day ?? work.need_by_date ?? '';
  const [start, setStart] = useState(initial);
  const [end, setEnd] = useState(initial);
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('Lead');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, startAssessing] = useTransition();
  const { run, pending, outcome } = useCommand();

  // Readiness is assessed for the dates in the form, and re-assessed whenever
  // they change: who is free on Tuesday is not who is free on Thursday.
  useEffect(() => {
    if (!start || !end || !ASSESSED_TRADES.includes(work.trade)) return;
    let live = true;
    startAssessing(async () => {
      const r = await assessInstallers({
        trade: work.trade as 'Roof' | 'Electrical',
        start_at: start,
        end_at: end
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
  }, [work.trade, start, end]);

  return (
    <CommandDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Schedule ${work.trade} · ${work.job_ref ?? ''}`}
      description={`${work.job_display ?? ''}${work.town ? ` · ${work.town}` : ''}`}
      submitLabel='Schedule'
      pending={pending}
      outcome={outcome}
      canSubmit={!!person && !!start && !!end}
      onSubmit={() =>
        run(
          {
            command_type: 'PLAN_WORK_PACKAGE',
            job_id: work.job_id,
            work_package_id: work.work_package_id,
            expected_version: work.work_package_version,
            payload: { person_id: person, start_at: start, end_at: end, role }
          },
          (r) => {
            if (!r.ok) return;
            onDone();
            onClose();
          }
        )
      }
    >
      <div className='grid grid-cols-2 gap-3'>
        <TextField
          label='Start'
          type='date'
          value={start}
          onChange={setStart}
          required
        />
        <TextField
          label='End'
          type='date'
          value={end}
          onChange={setEnd}
          required
        />
      </div>

      {ASSESSED_TRADES.includes(work.trade) ? (
        <CandidateList
          candidates={candidates}
          value={person}
          onChange={setPerson}
          loading={loading}
          error={error}
        />
      ) : (
        <p className='text-muted-foreground text-sm'>
          {work.trade} work has no skill-based readiness check; choose the
          person on the job itself.
        </p>
      )}

      <SelectField
        label='Role'
        value={role}
        onChange={setRole}
        options={['Lead', 'Second', 'Support'].map((r) => ({
          value: r,
          label: r
        }))}
      />
    </CommandDialog>
  );
}

function CandidateList({
  candidates,
  value,
  onChange,
  loading,
  error
}: {
  candidates: Candidate[];
  value: string;
  onChange: (id: string) => void;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <p className='text-muted-foreground flex items-center gap-2 text-sm'>
        <IconLoader2 className='size-4 animate-spin' /> Checking who is free…
      </p>
    );
  }
  if (error) return <p className='text-destructive text-sm'>{error}</p>;
  if (candidates.length === 0) {
    return (
      <p className='text-muted-foreground text-sm'>No installers found.</p>
    );
  }
  return (
    <div className='flex flex-col gap-1.5'>
      <Label>Installer</Label>
      <ul
        role='radiogroup'
        className='flex max-h-64 flex-col gap-1 overflow-y-auto'
      >
        {candidates.map((c) => (
          <li key={c.person_id}>
            <button
              type='button'
              role='radio'
              aria-checked={value === c.person_id}
              onClick={() => onChange(c.person_id)}
              className={cn(
                'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                value === c.person_id
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
  );
}
