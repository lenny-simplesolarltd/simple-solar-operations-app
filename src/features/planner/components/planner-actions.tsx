'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CommandDialog } from '@/features/operations/command-dialog';
import {
  NoteField,
  SelectField,
  TextField
} from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import { cn } from '@/lib/utils';
import {
  IconArrowsExchange,
  IconCalendarPlus,
  IconLoader2,
  IconUserPlus
} from '@tabler/icons-react';
import { useState } from 'react';
import { assessInstallers, changeInstallerOptions } from '../actions';
import { READINESS_REASON, type Candidate, type PlannerRow } from '../types';

/** Pick one installer; each shows whether the server thinks they are ready and why not. */
function CandidatePicker({
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
  if (candidates.length === 0)
    return (
      <p className='text-muted-foreground text-sm'>No installers found.</p>
    );
  return (
    <div className='flex flex-col gap-1.5'>
      <Label>Installer</Label>
      <ul
        role='radiogroup'
        className='flex max-h-72 flex-col gap-1 overflow-y-auto'
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
                <span className='font-medium'>
                  {c.display_name}
                  {c.currently_allocated && (
                    <span className='text-muted-foreground font-normal'>
                      {' '}
                      · current
                    </span>
                  )}
                </span>
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
      <p className='text-muted-foreground text-xs'>
        Someone marked not ready can still be chosen; the system will refuse it
        and say why.
      </p>
    </div>
  );
}

const TRADES = ['Roof', 'Electrical'];

/** PLAN_WORK_PACKAGE: give an unallocated package its dates and installer. */
export function AllocateButton({ row }: { row: PlannerRow }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(row.planned_start);
  const [end, setEnd] = useState(row.planned_end);
  const [person, setPerson] = useState('');
  const [role, setRole] = useState('Lead');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, pending, outcome, reset } = useCommand();

  // Candidates are assessed for the dates in the form, when it opens and
  // whenever a date changes.
  const load = (s: string, e: string) => {
    if (!s || !e || !TRADES.includes(row.trade)) return;
    setLoading(true);
    assessInstallers({
      trade: row.trade as 'Roof' | 'Electrical',
      start_at: s,
      end_at: e
    }).then((r) => {
      setLoading(false);
      if (r.ok) {
        setCandidates(r.data.candidates);
        setError(null);
      } else setError(r.error.message);
    });
  };
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setPerson('');
    }
  };

  return (
    <>
      <Button
        size='sm'
        variant='outline'
        onClick={() => {
          setOpen(true);
          load(start, end);
        }}
      >
        <IconUserPlus /> Allocate
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={`Allocate ${row.trade} · ${row.job_ref ?? ''}`}
        submitLabel='Allocate'
        pending={pending}
        outcome={outcome}
        canSubmit={!!person && !!start && !!end}
        onSubmit={() =>
          run(
            {
              command_type: 'PLAN_WORK_PACKAGE',
              job_id: row.job_id,
              work_package_id: row.work_package_id,
              expected_version: row.work_package_version,
              payload: { person_id: person, start_at: start, end_at: end, role }
            },
            (r) => r.ok && close(false)
          )
        }
      >
        <div className='grid grid-cols-2 gap-3'>
          <TextField
            label='Start'
            type='date'
            value={start}
            onChange={(v) => {
              setStart(v);
              load(v, end);
            }}
            required
          />
          <TextField
            label='End'
            type='date'
            value={end}
            onChange={(v) => {
              setEnd(v);
              load(start, v);
            }}
            required
          />
        </div>
        {TRADES.includes(row.trade) ? (
          <CandidatePicker
            candidates={candidates}
            value={person}
            onChange={setPerson}
            loading={loading}
            error={error}
          />
        ) : (
          <p className='text-muted-foreground text-sm'>
            {row.trade} work is allocated from the Team board; readiness checks
            cover Roof and Electrical only.
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
    </>
  );
}

/** CHANGE_INSTALLER_R2: replace this allocation's installer, or add another. */
export function ChangeInstallerButton({ row }: { row: PlannerRow }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'Replace' | 'Add'>('Replace');
  const [person, setPerson] = useState('');
  const [reason, setReason] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run, pending, outcome, reset } = useCommand();

  const load = () => {
    if (!row.allocation_id) return;
    setLoading(true);
    changeInstallerOptions({
      work_package_id: row.work_package_id,
      old_allocation_id: row.allocation_id
    }).then((r) => {
      setLoading(false);
      if (r.ok) {
        setCandidates(r.data.candidates);
        setError(null);
      } else setError(r.error.message);
    });
  };
  if (!row.allocation_id) return null;
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setPerson('');
      setReason('');
    }
  };

  return (
    <>
      <Button
        size='sm'
        variant='outline'
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        <IconArrowsExchange /> Change
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={`Change installer · ${row.job_ref ?? ''} ${row.trade}`}
        description={`Currently ${row.person_name ?? 'unknown'} (${row.role ?? 'Lead'}).`}
        submitLabel={mode === 'Replace' ? 'Replace installer' : 'Add installer'}
        pending={pending}
        outcome={outcome}
        canSubmit={!!person && !!reason.trim()}
        onSubmit={() =>
          run(
            {
              command_type: 'CHANGE_INSTALLER_R2',
              job_id: row.job_id,
              work_package_id: row.work_package_id,
              old_allocation_id: row.allocation_id ?? undefined,
              expected_version: row.work_package_version,
              payload: {
                mode,
                person_id: person,
                reason,
                ...(mode === 'Add' ? { role: 'Second' } : {})
              }
            },
            (r) => r.ok && close(false)
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
              label: `Replace ${row.person_name ?? 'this installer'}`
            },
            { value: 'Add', label: 'Add a second installer' }
          ]}
        />
        <CandidatePicker
          candidates={candidates.filter((c) => !c.currently_allocated)}
          value={person}
          onChange={setPerson}
          loading={loading}
          error={error}
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

/** MOVE_WORK_PACKAGE: new dates for this package and this allocation. */
export function MovePackageButton({ row }: { row: PlannerRow }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(row.start_at);
  const [end, setEnd] = useState(row.end_at);
  const [reason, setReason] = useState('');
  const { run, pending, outcome, reset } = useCommand();
  if (!row.allocation_id) return null;
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setReason('');
    }
  };
  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <IconCalendarPlus /> Move
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title={`Move ${row.trade} · ${row.job_ref ?? ''}`}
        description={`${row.person_name ?? 'The installer'} moves with the work. To move several trades or the scaffold together use Move job.`}
        submitLabel='Move'
        pending={pending}
        outcome={outcome}
        canSubmit={!!start && !!end && !!reason.trim()}
        onSubmit={() =>
          run(
            {
              command_type: 'MOVE_WORK_PACKAGE',
              job_id: row.job_id,
              work_package_id: row.work_package_id,
              expected_version: row.work_package_version,
              payload: {
                allocation_id: row.allocation_id,
                start_at: start,
                end_at: end,
                reason
              }
            },
            (r) => r.ok && close(false)
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
