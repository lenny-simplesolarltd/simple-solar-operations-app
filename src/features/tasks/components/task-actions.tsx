'use client';

import { Button } from '@/components/ui/button';
import { CommandDialog } from '@/features/operations/command-dialog';
import { EvidenceField } from '@/features/operations/evidence-field';
import {
  ChoiceField,
  NoteField,
  SelectField,
  TextField,
  localDateTimeToIso
} from '@/features/operations/fields';
import { useCommand } from '@/features/operations/use-command';
import type { TaskDetailRead } from '@/lib/backend/models';
import type { CommandFlag } from '@/lib/backend/types';
import {
  IconCheck,
  IconPaperclip,
  IconPhoneCall,
  IconRotate
} from '@tabler/icons-react';
import { useState } from 'react';

// Staff wording for the availability reasons returned by the read model.
const REASON: Record<string, string> = {
  NOT_ASSIGNED: 'You can view this job but are not assigned to it.',
  TASK_OWNER_OR_BACKUP_REQUIRED:
    'Only the task owner, backup or an admin can do this.',
  COMPLETE_NOT_AVAILABLE:
    'This task cannot be completed in its current status.',
  REOPEN_NOT_AVAILABLE: 'Only completed tasks can be reopened.',
  ATTACH_NOT_AVAILABLE:
    'Evidence can only be attached to an open or evidence-less contract task.',
  MODE_UNAVAILABLE: 'This action is switched off at the moment.',
  JOB_NOT_ACTIONABLE: 'The job is cancelled or archived.'
};

export const reasonText = (flag: CommandFlag | undefined) =>
  flag?.reason ? (REASON[flag.reason] ?? flag.reason) : undefined;

type Detail = TaskDetailRead;

export function TaskActions({
  detail,
  isAdmin
}: {
  detail: Detail;
  isAdmin: boolean;
}) {
  const { task, availability } = detail;
  const flags = availability.commands;
  const isCall =
    task.template_code === 'INS01' || task.template_code === 'INS04';
  const open = ['Open', 'Waiting', 'InProgress'].includes(task.status);
  // Calls are completed by recording the call (CALL_RECORD), not TASK_COMPLETE.
  // Mirrors the CALL_RECORD authorization (assigned to the job; owner, backup
  // or admin); the command re-checks it.
  const callAllowed =
    isCall &&
    open &&
    !!detail.job &&
    availability.assigned &&
    (task.is_mine || isAdmin);

  const buttons: React.ReactNode[] = [];
  if (isCall && open) {
    buttons.push(
      <RecordCall key='call' detail={detail} disabled={!callAllowed} />
    );
  } else if (flags.task_complete.available || open) {
    buttons.push(
      <CompleteTask key='complete' detail={detail} flag={flags.task_complete} />
    );
  }
  if (flags.task_evidence_attach.available) {
    buttons.push(<AttachEvidence key='attach' detail={detail} />);
  }
  if (
    flags.task_reopen.available ||
    ['Complete', 'NotRequired'].includes(task.status)
  ) {
    buttons.push(
      <ReopenTask key='reopen' detail={detail} flag={flags.task_reopen} />
    );
  }

  const blocked = [flags.task_complete, flags.task_reopen].find(
    (f) => !f.available && f.reason
  );
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap gap-2'>{buttons}</div>
      {isCall && open && !callAllowed && (
        <p className='text-muted-foreground text-xs'>
          {availability.assigned
            ? REASON.TASK_OWNER_OR_BACKUP_REQUIRED
            : REASON.NOT_ASSIGNED}
        </p>
      )}
      {!isCall && blocked && buttons.length > 0 && (
        <p className='text-muted-foreground text-xs'>{reasonText(blocked)}</p>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  disabled,
  title,
  onClick,
  variant = 'default'
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
}) {
  return (
    <Button
      variant={variant}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

// -----------------------------------------------------------------------------
// TASK_COMPLETE - the PRE01-PRE05 forms (reference services.js _r1sTaskComplete)
// -----------------------------------------------------------------------------

type Yes = 'yes' | 'no';
const YES_NO: { value: Yes; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
];

function CompleteTask({ detail, flag }: { detail: Detail; flag: CommandFlag }) {
  const { task, job } = detail;
  const code = task.template_code ?? '';
  const [openDialog, setOpenDialog] = useState(false);
  const { run, pending, outcome, reset } = useCommand();
  const [f, setF] = useState<Record<string, string>>({});
  const [evidencePath, setEvidencePath] = useState<string | null>(null);
  const set = (k: string) => (v: string) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const payload: Record<string, unknown> = { completion_note: f.note ?? '' };
  let canSubmit = !!f.note?.trim();
  let submitLabel = 'Complete task';

  if (code === 'PRE01') {
    payload.outcome = f.outcome === 'failed' ? 'failed' : 'sent';
    if (f.outcome !== 'failed') {
      payload.invoice_number = f.invoice_number ?? '';
      payload.invoice_sent = true;
    }
    canSubmit &&=
      !!f.outcome && (f.outcome === 'failed' || !!f.invoice_number?.trim());
    if (f.outcome === 'failed') submitLabel = 'Record follow-up';
  } else if (code === 'PRE02') {
    payload.contract_id = f.contract_id ?? '';
    payload.contract_signed = f.signed === 'signed' ? 'signed' : 'awaiting';
    if (f.signed === 'signed' && evidencePath)
      payload.evidence_path = evidencePath;
    canSubmit &&=
      !!f.contract_id?.trim() &&
      !!f.signed &&
      (f.signed !== 'signed' || !!evidencePath || !!task.evidence_id);
    if (f.signed === 'awaiting') submitLabel = 'Record as sent';
  } else if (code === 'PRE03') {
    payload.deposit_bank_confirmed = f.confirmed === 'yes';
    if (f.deposit_amount) payload.deposit_amount = f.deposit_amount;
    if (f.received) payload.deposit_received_date = f.received;
    if (f.reference) payload.deposit_bank_reference = f.reference;
    canSubmit &&=
      !!f.confirmed &&
      (f.confirmed === 'no' ||
        (!!f.deposit_amount && !!f.received && !!f.reference?.trim()));
    if (f.confirmed === 'no') submitLabel = 'Record not received';
  } else if (code === 'PRE04') {
    payload.customer_details_verified = f.details === 'yes';
    payload.sold_value_verified = f.value === 'yes';
    if (f.details === 'yes' && f.value === 'yes')
      payload.verified_gross_amount = f.gross ?? '';
    if (evidencePath) payload.evidence_path = evidencePath;
    canSubmit &&=
      !!f.details &&
      !!f.value &&
      (f.details === 'no' || f.value === 'no' || !!f.gross);
    if (f.details === 'no' || f.value === 'no') submitLabel = 'Record mismatch';
  } else if (evidencePath) {
    payload.evidence_path = evidencePath;
  }

  const close = (next: boolean) => {
    setOpenDialog(next);
    if (!next) {
      reset();
      setF({});
      setEvidencePath(null);
    }
  };

  return (
    <>
      <ActionButton
        icon={<IconCheck />}
        label='Complete'
        disabled={!flag.available}
        title={reasonText(flag)}
        onClick={() => setOpenDialog(true)}
      />
      <CommandDialog
        open={openDialog}
        onOpenChange={close}
        title={`Complete: ${task.title}`}
        description={COMPLETE_HELP[code]}
        submitLabel={submitLabel}
        pending={pending}
        outcome={outcome}
        canSubmit={canSubmit}
        onSubmit={() =>
          run(
            {
              command_type: 'TASK_COMPLETE',
              task_id: task.id,
              expected_version: task.version,
              payload
            },
            (r) => r.ok && close(false)
          )
        }
      >
        {code === 'PRE01' && (
          <>
            <ChoiceField
              label='Deposit invoice'
              required
              value={(f.outcome as 'sent' | 'failed') ?? ''}
              onChange={set('outcome')}
              options={[
                { value: 'sent', label: 'Sent to the customer' },
                { value: 'failed', label: 'Could not send' }
              ]}
            />
            {f.outcome === 'sent' && (
              <TextField
                label='Invoice number'
                required
                value={f.invoice_number ?? ''}
                onChange={set('invoice_number')}
              />
            )}
          </>
        )}
        {code === 'PRE02' && (
          <>
            <TextField
              label='Contract reference'
              required
              value={f.contract_id ?? ''}
              onChange={set('contract_id')}
            />
            <ChoiceField
              label='Contract'
              required
              value={(f.signed as 'signed' | 'awaiting') ?? ''}
              onChange={set('signed')}
              options={[
                { value: 'signed', label: 'Signed' },
                { value: 'awaiting', label: 'Sent, awaiting signature' }
              ]}
            />
            {f.signed === 'signed' && job && (
              <EvidenceField
                jobId={job.id}
                label={
                  task.evidence_id
                    ? 'Signed contract (already attached)'
                    : 'Signed contract'
                }
                required={!task.evidence_id}
                onUploaded={setEvidencePath}
              />
            )}
          </>
        )}
        {code === 'PRE03' && (
          <>
            <ChoiceField
              label='Deposit seen in the bank?'
              required
              value={(f.confirmed as Yes) ?? ''}
              onChange={set('confirmed')}
              options={YES_NO}
            />
            <TextField
              label='Amount received (£)'
              required={f.confirmed === 'yes'}
              inputMode='decimal'
              value={f.deposit_amount ?? ''}
              onChange={set('deposit_amount')}
            />
            <TextField
              label='Date received'
              type='date'
              required={f.confirmed === 'yes'}
              value={f.received ?? ''}
              onChange={set('received')}
            />
            <TextField
              label='Bank reference'
              required={f.confirmed === 'yes'}
              value={f.reference ?? ''}
              onChange={set('reference')}
            />
          </>
        )}
        {code === 'PRE04' && (
          <>
            <ChoiceField
              label='Customer details match the booking?'
              required
              value={(f.details as Yes) ?? ''}
              onChange={set('details')}
              options={YES_NO}
            />
            <ChoiceField
              label='Sold value matches?'
              required
              value={(f.value as Yes) ?? ''}
              onChange={set('value')}
              options={YES_NO}
            />
            {f.details === 'yes' && f.value === 'yes' && (
              <TextField
                label='Verified gross amount (£)'
                required
                inputMode='decimal'
                value={f.gross ?? ''}
                onChange={set('gross')}
              />
            )}
            {job && (
              <EvidenceField
                jobId={job.id}
                label='Supporting document (optional)'
                onUploaded={setEvidencePath}
              />
            )}
          </>
        )}
        {!['PRE01', 'PRE02', 'PRE03', 'PRE04'].includes(code) && job && (
          <EvidenceField
            jobId={job.id}
            label={
              code === 'PRE05'
                ? 'Finance agreement (optional)'
                : 'Evidence (optional)'
            }
            onUploaded={setEvidencePath}
          />
        )}
        <NoteField
          label='Note'
          required
          value={f.note ?? ''}
          onChange={set('note')}
        />
      </CommandDialog>
    </>
  );
}

const COMPLETE_HELP: Record<string, string> = {
  PRE01:
    'Record the deposit invoice. If it could not be sent the task stays open for a follow-up.',
  PRE02:
    'A sent contract is not a signed one: it is recorded and the task waits for the signature.',
  PRE03:
    'Check the bank. The amount must match the deposit invoice exactly to complete.',
  PRE04:
    'Confirm the customer details and the sold value. A mismatch flags the job for review.',
  PRE05: 'Confirm the finance agreement is in place.'
};

// -----------------------------------------------------------------------------
// TASK_REOPEN
// -----------------------------------------------------------------------------

function ReopenTask({ detail, flag }: { detail: Detail; flag: CommandFlag }) {
  const { task } = detail;
  const [openDialog, setOpenDialog] = useState(false);
  const [reason, setReason] = useState('');
  const { run, pending, outcome, reset } = useCommand();
  const close = (next: boolean) => {
    setOpenDialog(next);
    if (!next) {
      reset();
      setReason('');
    }
  };
  return (
    <>
      <ActionButton
        variant='outline'
        icon={<IconRotate />}
        label='Reopen'
        disabled={!flag.available}
        title={reasonText(flag)}
        onClick={() => setOpenDialog(true)}
      />
      <CommandDialog
        open={openDialog}
        onOpenChange={close}
        title={`Reopen: ${task.title}`}
        description='The completion note, evidence and history are kept. Reopening a prebooking task can move the job back out of Ready to book.'
        submitLabel='Reopen task'
        pending={pending}
        outcome={outcome}
        canSubmit={!!reason.trim()}
        onSubmit={() =>
          run(
            {
              command_type: 'TASK_REOPEN',
              task_id: task.id,
              expected_version: task.version,
              payload: { reopen_reason: reason }
            },
            (r) => r.ok && close(false)
          )
        }
      >
        <NoteField
          label='Why is it being reopened?'
          required
          value={reason}
          onChange={setReason}
        />
      </CommandDialog>
    </>
  );
}

// -----------------------------------------------------------------------------
// TASK_EVIDENCE_ATTACH (PRE02)
// -----------------------------------------------------------------------------

function AttachEvidence({ detail }: { detail: Detail }) {
  const { task, job } = detail;
  const [openDialog, setOpenDialog] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const { run, pending, outcome, reset } = useCommand();
  if (!job) return null;
  const close = (next: boolean) => {
    setOpenDialog(next);
    if (!next) {
      reset();
      setPath(null);
    }
  };
  return (
    <>
      <ActionButton
        variant='outline'
        icon={<IconPaperclip />}
        label='Attach signed contract'
        onClick={() => setOpenDialog(true)}
      />
      <CommandDialog
        open={openDialog}
        onOpenChange={close}
        title='Attach signed contract'
        description={
          task.status === 'Complete'
            ? 'This completed contract task has no evidence. Attaching it records the signed contract on the job.'
            : 'The file is stored on the task. Complete the task afterwards to record the contract as signed.'
        }
        submitLabel='Attach'
        pending={pending}
        outcome={outcome}
        canSubmit={!!path}
        onSubmit={() =>
          run(
            {
              command_type: 'TASK_EVIDENCE_ATTACH',
              task_id: task.id,
              expected_version: task.version,
              payload: { evidence_path: path }
            },
            (r) => r.ok && close(false)
          )
        }
      >
        <EvidenceField
          jobId={job.id}
          label='Signed contract'
          required
          onUploaded={setPath}
        />
      </CommandDialog>
    </>
  );
}

// -----------------------------------------------------------------------------
// CALL_RECORD (INS01 installer call, INS04 customer call)
// -----------------------------------------------------------------------------

type CallOutcome =
  | 'NoAnswer'
  | 'Complete'
  | 'ReturnRequired'
  | 'Unhappy'
  | 'Confirmed'
  | 'Other';

const INSTALLER_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: 'Complete', label: 'Work complete' },
  { value: 'ReturnRequired', label: 'Return visit required' },
  { value: 'NoAnswer', label: 'No answer' },
  { value: 'Other', label: 'Other' }
];
const CUSTOMER_OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: 'Confirmed', label: 'Spoke to the customer' },
  { value: 'Unhappy', label: 'Customer unhappy' },
  { value: 'NoAnswer', label: 'No answer' },
  { value: 'Other', label: 'Other' }
];

export function RecordCall({
  detail,
  disabled
}: {
  detail: Detail;
  disabled?: boolean;
}) {
  const { task, job } = detail;
  const installer = task.template_code === 'INS01';
  const [openDialog, setOpenDialog] = useState(false);
  const [callOutcome, setCallOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [next, setNext] = useState('');
  const [confirmed, setConfirmed] = useState<Yes | ''>('');
  const [happy, setHappy] = useState<Yes | ''>('');
  const { run, pending, outcome, reset } = useCommand();
  if (!job) return null;

  const close = (value: boolean) => {
    setOpenDialog(value);
    if (!value) {
      reset();
      setCallOutcome('');
      setNotes('');
      setNext('');
      setConfirmed('');
      setHappy('');
    }
  };

  const payload: Record<string, unknown> = {
    type: installer ? 'Installer' : 'Customer',
    outcome: callOutcome,
    notes: notes || undefined,
    next_attempt_at:
      callOutcome === 'NoAnswer' ? localDateTimeToIso(next) : undefined
  };
  if (installer && callOutcome !== 'NoAnswer' && confirmed) {
    payload.actual_completion_confirmed = confirmed === 'yes';
  }
  if (!installer && callOutcome !== 'NoAnswer' && happy)
    payload.customer_happy = happy === 'yes';

  return (
    <>
      <ActionButton
        icon={<IconPhoneCall />}
        label='Record call'
        disabled={disabled}
        onClick={() => setOpenDialog(true)}
      />
      <CommandDialog
        open={openDialog}
        onOpenChange={close}
        title={installer ? 'Installer call' : 'Customer call'}
        description={
          installer
            ? 'Confirming completion marks the work package complete; a return visit raises a remedial issue.'
            : 'An unhappy customer raises a complaint issue for the office.'
        }
        submitLabel='Save call'
        pending={pending}
        outcome={outcome}
        canSubmit={!!callOutcome}
        onSubmit={() =>
          run(
            {
              command_type: 'CALL_RECORD',
              job_id: job.id,
              task_id: task.id,
              expected_version: task.version,
              payload: Object.fromEntries(
                Object.entries(payload).filter(([, v]) => v !== undefined)
              )
            },
            (r) => r.ok && close(false)
          )
        }
      >
        <SelectField
          label='Outcome'
          required
          value={callOutcome}
          onChange={setCallOutcome}
          options={installer ? INSTALLER_OUTCOMES : CUSTOMER_OUTCOMES}
        />
        {callOutcome === 'NoAnswer' && (
          <TextField
            label='Try again at'
            type='datetime-local'
            value={next}
            onChange={setNext}
            hint='Leave blank to try again the next working day.'
          />
        )}
        {installer && callOutcome && callOutcome !== 'NoAnswer' && (
          <ChoiceField
            label='Installer confirmed the work is finished?'
            value={confirmed}
            onChange={setConfirmed}
            options={YES_NO}
          />
        )}
        {!installer && callOutcome && callOutcome !== 'NoAnswer' && (
          <ChoiceField
            label='Customer happy?'
            value={happy}
            onChange={setHappy}
            options={YES_NO}
          />
        )}
        <NoteField label='Notes' value={notes} onChange={setNotes} />
      </CommandDialog>
    </>
  );
}
