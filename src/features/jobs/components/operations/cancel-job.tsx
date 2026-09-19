'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { CommandDialog } from '@/features/operations/command-dialog';
import { NoteField, TextField } from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import type { OpsFlag } from '@/lib/backend/models';
import { IconBan, IconLoader2 } from '@tabler/icons-react';
import { useId, useRef, useState } from 'react';
import {
  type CancellationPreview,
  getCancellationPreview
} from '../../server/cancellation';
import { flagText } from './labels';

// CANCEL_JOB (S15). The job is never deleted: it moves to
// CancellationInProgress, unstarted work and future allocations are
// cancelled, and review tasks are raised for everything that needs a person
// (installers, merchants, scaffold, finance, customer, GHL...). The preview is
// read-only; the command re-plans on the server.

const FIELDS = [
  ['reason', 'Reason for cancelling'],
  ['work_performed', 'Work already done on site'],
  ['material_state', 'Materials (ordered / picked / on site)'],
  ['scaffold_state', 'Scaffold'],
  ['finance_review', 'Deposit / payments'],
  ['legacy_state', 'Other systems (Trello, GHL ...)']
] as const;
type Key = (typeof FIELDS)[number][0] | 'effective_date';

const WOULD: Record<string, string> = {
  work_packages_cancel: 'work packages cancelled',
  work_packages_review: 'work packages to review (work started)',
  allocations_deactivate: 'installer bookings removed',
  allocations_notify: 'installers to tell',
  tasks_cancel: 'open tasks cancelled',
  reservations_release: 'stock reservations released',
  reservations_review: 'picked stock to review',
  orders_cancel: 'draft orders cancelled',
  orders_review: 'sent orders to review with the merchant',
  outbox_cancel: 'unsent messages cancelled',
  outbox_review: 'messages to check',
  communications_fail: 'queued communications stopped',
  invoice_stages_review: 'invoice stages to review'
};

const RISKS: Record<string, string> = {
  OPERATIONALLY_COMPLETE: 'The job is already operationally complete.',
  WORK_PERFORMED_OR_UNCERTAIN: 'Work has started or may have started.',
  PAYMENT_REVIEW: 'Payments need reviewing.',
  FINAL_INVOICE_REVIEW: 'A final invoice needs reviewing.',
  SAFE_STRIP_REQUIRED: 'Scaffold is up and must be struck safely.',
  PHYSICAL_STOCK_REVIEW: 'Stock has physically moved.',
  EVIDENCE_HANDOVER_REVIEW: 'Commissioning or handover records exist.'
};

const today = () => new Date().toLocaleDateString('en-CA');

export function CancelJob({
  jobId,
  jobVersion,
  flag
}: {
  jobId: string;
  jobVersion: number;
  flag: OpsFlag;
}) {
  const confirmId = useId();
  const blank = (): Record<Key, string> => ({
    reason: '',
    effective_date: today(),
    work_performed: 'None',
    material_state: 'None',
    scaffold_state: 'None',
    finance_review: '',
    legacy_state: 'None'
  });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(blank);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; data: CancellationPreview }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  const { run, pending, outcome, reset } = useCommand();

  // Loaded when the dialog opens and whenever the effective date changes; the
  // latest request wins.
  const latest = useRef(0);
  const loadPreview = (date: string) => {
    const ticket = ++latest.current;
    setPreview({ kind: 'loading' });
    void getCancellationPreview(jobId, date).then((r) => {
      if (ticket !== latest.current) return;
      setPreview(
        r.ok
          ? { kind: 'ready', data: r.preview }
          : { kind: 'error', message: r.message }
      );
    });
  };

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      reset();
      setValues(blank());
      setConfirmed(false);
    }
  };
  const set = (k: Key) => (v: string) => {
    setValues((p) => ({ ...p, [k]: v }));
    if (k === 'effective_date' && v) loadPreview(v);
  };
  const complete =
    confirmed && (Object.keys(values) as Key[]).every((k) => values[k].trim());
  const would =
    preview.kind === 'ready'
      ? Object.entries(preview.data.would ?? {}).filter(([, n]) => n > 0)
      : [];

  return (
    <>
      <Button
        size='sm'
        variant='destructive'
        disabled={!flag.available}
        title={flagText(flag)}
        onClick={() => {
          setOpen(true);
          loadPreview(values.effective_date);
        }}
      >
        <IconBan />
        Cancel job
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={close}
        title='Cancel this job'
        description='The job is kept, not deleted. Unstarted work and future installer bookings are cancelled, and review tasks are raised for everything a person must sort out.'
        submitLabel='Cancel job'
        pending={pending}
        outcome={outcome}
        canSubmit={complete && preview.kind === 'ready'}
        onSubmit={() =>
          run(
            {
              command_type: 'CANCEL_JOB',
              job_id: jobId,
              expected_version: jobVersion,
              payload: Object.fromEntries(
                (Object.keys(values) as Key[]).map((k) => [k, values[k].trim()])
              )
            },
            (r) => r.ok && close(false)
          )
        }
      >
        {preview.kind === 'loading' && (
          <p className='text-muted-foreground flex items-center gap-2 text-sm'>
            <IconLoader2 className='size-4 animate-spin' /> Checking what this
            would change…
          </p>
        )}
        {preview.kind === 'error' && (
          <Alert variant='destructive'>
            <AlertDescription>{preview.message}</AlertDescription>
          </Alert>
        )}
        {preview.kind === 'ready' && (
          <Alert>
            <AlertTitle>What cancelling will do</AlertTitle>
            <AlertDescription>
              <ul className='list-disc pl-4'>
                {would.length === 0 && <li>Nothing planned to undo.</li>}
                {would.map(([k, n]) => (
                  <li key={k}>
                    {n} {WOULD[k] ?? k}
                  </li>
                ))}
              </ul>
              {preview.data.risks?.length > 0 && (
                <>
                  <p className='mt-2 font-medium'>Needs review afterwards:</p>
                  <ul className='list-disc pl-4'>
                    {preview.data.risks.map((r) => (
                      <li key={r}>{RISKS[r] ?? r}</li>
                    ))}
                  </ul>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        <TextField
          label='Effective date'
          type='date'
          required
          value={values.effective_date}
          onChange={set('effective_date')}
        />
        {FIELDS.map(([key, label]) => (
          <NoteField
            key={key}
            label={label}
            required
            value={values[key]}
            onChange={set(key)}
          />
        ))}
        <div className='flex items-start gap-2'>
          <Checkbox
            id={confirmId}
            checked={confirmed}
            onCheckedChange={(v) => setConfirmed(v === true)}
          />
          <Label htmlFor={confirmId} className='leading-snug font-normal'>
            I understand the job moves to cancellation and its bookings are
            cancelled. This can only be undone by reinstating it.
          </Label>
        </div>
      </CommandDialog>
    </>
  );
}
