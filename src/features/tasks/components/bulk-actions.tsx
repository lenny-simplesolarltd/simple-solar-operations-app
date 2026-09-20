'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  NoteField,
  SelectField,
  TextField
} from '@/features/operations/fields';
import type { StaffOption } from '@/features/tasks/server/queries';
import type {
  BatchItemOutcome,
  BatchOperation,
  BatchPlanItem,
  BatchPreflightRead,
  BatchRequirement
} from '@/lib/backend/models';
import type { CommandOutcome } from '@/lib/backend/types';
import {
  IconAlertTriangle,
  IconCheck,
  IconLoader2,
  IconRotate,
  IconUserShare,
  IconX
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { preflightBatch } from '../server/batch';

/** Staff wording for why a task will not take part. */
const OUTCOME_LABEL: Record<BatchItemOutcome, string> = {
  ready: 'Ready',
  already_complete: 'Already complete',
  already_open: 'Already open',
  needs_information: 'Needs information',
  not_permitted: 'Not allowed for you',
  not_actionable: 'Cannot be done',
  not_found: 'No longer exists'
};

/** The order the summary reads in: what will happen first, then what will not. */
const OUTCOME_ORDER: BatchItemOutcome[] = [
  'ready',
  'already_complete',
  'already_open',
  'needs_information',
  'not_permitted',
  'not_actionable',
  'not_found'
];

const OPERATION_TITLE: Record<BatchOperation, string> = {
  TASK_BATCH_COMPLETE: 'Complete tasks',
  TASK_BATCH_OVERRIDE_COMPLETE: 'Complete with override',
  TASK_BATCH_REOPEN: 'Reopen tasks',
  TASK_BATCH_REASSIGN: 'Reassign tasks'
};

/** The reasons staff actually give. Free text is always allowed as well. */
const OVERRIDE_CATEGORIES = [
  'Confirmed externally',
  'Historical admin cleanup',
  'Manager instruction',
  'Duplicate requirement',
  'No longer required',
  'DEV/test'
];

export interface BulkSubmitArgs {
  operation: BatchOperation;
  args: Record<string, unknown>;
  /** Only the tasks the preflight said would run. */
  taskIds: string[];
}

/** One line of the preflight summary. */
function OutcomeLine({
  outcome,
  count,
  items
}: {
  outcome: BatchItemOutcome;
  count: number;
  items: BatchPlanItem[];
}) {
  const reasons = new Map<string, number>();
  for (const i of items) {
    const why = i.blocking[0]?.detail;
    if (why) reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }
  return (
    <li className='flex flex-col gap-0.5'>
      <span className='flex items-center gap-2'>
        <Badge variant={outcome === 'ready' ? 'success' : 'outline'}>
          {count}
        </Badge>
        <span
          className={
            outcome === 'ready' ? 'font-medium' : 'text-muted-foreground'
          }
        >
          {OUTCOME_LABEL[outcome]}
        </span>
      </span>
      {outcome !== 'ready' &&
        Array.from(reasons.entries())
          .slice(0, 3)
          .map(([why, n]) => (
            <span key={why} className='text-muted-foreground pl-9 text-xs'>
              {n > 1 ? `${n} × ` : ''}
              {why}
            </span>
          ))}
    </li>
  );
}

/** What an override is about to stop asking for. Never phrased as "done". */
function BypassSummary({ items }: { items: BatchPlanItem[] }) {
  const counts = new Map<string, { n: number; req: BatchRequirement }>();
  for (const item of items) {
    for (const b of item.bypassed) {
      const hit = counts.get(b.detail);
      if (hit) hit.n += 1;
      else counts.set(b.detail, { n: 1, req: b });
    }
  }
  if (counts.size === 0) return null;
  const values = Array.from(counts.values());
  const business = values.filter((c) => c.req.kind === 'normal');
  const other = values.filter((c) => c.req.kind !== 'normal');
  return (
    <div className='flex flex-col gap-2'>
      <p className='text-sm font-medium'>Requirements being bypassed</p>
      <ul className='text-muted-foreground flex flex-col gap-1 text-sm'>
        {other.concat(business).map(({ n, req }) => (
          <li key={req.detail}>
            • {n > 1 ? `${n} × ` : ''}
            {req.detail}
          </li>
        ))}
      </ul>
      {business.length > 0 && (
        <Alert>
          <IconAlertTriangle />
          <AlertTitle>Nothing will be recorded for these</AlertTitle>
          <AlertDescription>
            The task stops being asked for, but the underlying fact is not
            written. The job&rsquo;s booking checks will still report it as
            outstanding, and it stays listed on the job.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * The confirm step for a bulk action. It always resolves the selection through
 * the server preflight FIRST, so the person sees the real count and the real
 * reasons before anything is written - and only the tasks that would actually
 * run are submitted.
 */
export function BulkDialog({
  operation,
  taskIds,
  staff,
  onClose,
  onSubmit,
  submitting,
  outcome
}: {
  operation: BatchOperation | null;
  taskIds: string[];
  staff: StaffOption[];
  onClose: () => void;
  onSubmit: (args: BulkSubmitArgs) => void;
  submitting: boolean;
  outcome: CommandOutcome | null;
}) {
  const [plan, setPlan] = useState<BatchPreflightRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState(OVERRIDE_CATEGORIES[0]);
  const [owner, setOwner] = useState('');

  // Override never reaches this dialog - BulkBar submits it directly - but the
  // flag is kept so the wording and styling of a mistakenly routed operation
  // stay honest rather than silently reading as a normal completion.
  const override = operation === 'TASK_BATCH_OVERRIDE_COMPLETE';

  // The form belongs to one opening of the dialog: keying the state on the
  // operation resets it without writing state from inside an effect.
  const [openedFor, setOpenedFor] = useState<BatchOperation | null>(null);
  if (operation !== openedFor) {
    setOpenedFor(operation);
    setPlan(null);
    setError(null);
    setNote('');
    setReason('');
    setOwner('');
    setCategory(OVERRIDE_CATEGORIES[0]);
  }

  useEffect(() => {
    if (!operation) return;
    let live = true;
    void preflightBatch(operation, { taskIds }).then((r) => {
      if (!live) return;
      if (r.ok) setPlan(r.data);
      else setError(r.error.message);
    });
    return () => {
      live = false;
    };
  }, [operation, taskIds]);

  if (!operation) return null;

  const ready = plan?.items.filter((i) => i.outcome === 'ready') ?? [];
  const grouped = OUTCOME_ORDER.map((o) => ({
    outcome: o,
    items: plan?.items.filter((i) => i.outcome === o) ?? []
  })).filter((g) => g.items.length > 0);

  const needsNote = operation === 'TASK_BATCH_COMPLETE';
  const needsReason = override || operation === 'TASK_BATCH_REOPEN';
  const needsOwner = operation === 'TASK_BATCH_REASSIGN';
  const filled =
    (!needsNote || note.trim().length > 0) &&
    (!needsReason || reason.trim().length >= 3) &&
    (!needsOwner || (owner !== '' && reason.trim().length >= 3));
  const canSubmit = !!plan && ready.length > 0 && filled && !submitting;

  const submit = () => {
    const args: Record<string, unknown> =
      operation === 'TASK_BATCH_COMPLETE'
        ? { completion_note: note.trim() }
        : override
          ? { override_reason: reason.trim(), override_category: category }
          : operation === 'TASK_BATCH_REOPEN'
            ? { reopen_reason: reason.trim() }
            : { owner_id: owner, reason: reason.trim() };
    onSubmit({ operation, args, taskIds: ready.map((i) => i.task_id) });
  };

  const submitLabel = !plan
    ? 'Checking…'
    : ready.length === 0
      ? 'Nothing to do'
      : operation === 'TASK_BATCH_REOPEN'
        ? `Reopen ${ready.length}`
        : operation === 'TASK_BATCH_REASSIGN'
          ? `Reassign ${ready.length}`
          : `Complete ${ready.length}`;

  return (
    <Dialog open onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <form
          className='flex flex-col gap-4'
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{OPERATION_TITLE[operation]}</DialogTitle>
            <DialogDescription>
              {taskIds.length} selected
              {override && ' · administrative override'}
            </DialogDescription>
          </DialogHeader>

          {!plan && !error && (
            <p className='text-muted-foreground flex items-center gap-2 text-sm'>
              <IconLoader2 className='size-4 animate-spin' />
              Checking what can be done…
            </p>
          )}
          {error && (
            <Alert variant='destructive'>
              <AlertTitle>COULD NOT CHECK</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {plan && (
            <ul className='flex flex-col gap-2 text-sm'>
              {grouped.map((g) => (
                <OutcomeLine
                  key={g.outcome}
                  outcome={g.outcome}
                  count={g.items.length}
                  items={g.items}
                />
              ))}
            </ul>
          )}

          {plan && override && <BypassSummary items={ready} />}

          {plan && ready.length > 0 && (
            <>
              {needsNote && (
                <NoteField
                  label='Completion note'
                  required
                  value={note}
                  onChange={setNote}
                />
              )}
              {needsOwner && (
                <SelectField
                  label='Move to'
                  required
                  value={owner}
                  onChange={setOwner}
                  options={staff.map((s) => ({ value: s.id, label: s.name }))}
                />
              )}
              {override && (
                <SelectField
                  label='Reason'
                  required
                  value={category}
                  onChange={setCategory}
                  options={OVERRIDE_CATEGORIES.map((c) => ({
                    value: c,
                    label: c
                  }))}
                />
              )}
              {(needsReason || needsOwner) && (
                <TextField
                  label={override ? 'Say more' : 'Reason'}
                  required
                  hint='Recorded against every task in this operation.'
                  value={reason}
                  onChange={setReason}
                />
              )}
            </>
          )}

          {outcome && (
            <Alert
              variant={
                outcome.status === 'ActionRequired' ? 'default' : 'destructive'
              }
            >
              <AlertTitle>{outcome.heading}</AlertTitle>
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type='submit'
              variant={override ? 'destructive' : 'default'}
              disabled={!canSubmit}
            >
              {submitting && <IconLoader2 className='size-4 animate-spin' />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The contextual bar. Only actions this person may use are offered, and only
 * while something is selected.
 */
export function BulkBar({
  count,
  canOverride,
  canReassign,
  overriding,
  onAction,
  onOverride,
  onClear
}: {
  count: number;
  canOverride: boolean;
  canReassign: boolean;
  /** True from the click until the batch is acknowledged, so it cannot be sent twice. */
  overriding: boolean;
  onAction: (operation: BatchOperation) => void;
  onOverride: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      className='bg-card sticky bottom-0 z-20 -mx-2 flex flex-wrap items-center gap-2 border-t px-2 py-3 shadow-lg sm:mx-0 sm:rounded-lg sm:border'
      role='region'
      aria-label='Bulk task actions'
    >
      <span className='text-sm font-medium' aria-live='polite'>
        {count} selected
      </span>
      <div className='flex flex-1 flex-wrap gap-2'>
        <Button size='sm' onClick={() => onAction('TASK_BATCH_COMPLETE')}>
          <IconCheck className='size-4' />
          Complete
        </Button>
        {canOverride && (
          // Choosing "Complete with override" IS the deliberate act, so there
          // is nothing to confirm: it submits on this click. The button is
          // disabled the moment it is pressed, so a double click or an
          // impatient second press cannot start a second batch.
          <Button
            size='sm'
            variant='destructive'
            disabled={overriding}
            onClick={onOverride}
          >
            {overriding ? (
              <IconLoader2 className='size-4 animate-spin' />
            ) : (
              <IconAlertTriangle className='size-4' />
            )}
            {overriding ? 'Completing…' : 'Complete with override'}
          </Button>
        )}
        <Button
          size='sm'
          variant='outline'
          onClick={() => onAction('TASK_BATCH_REOPEN')}
        >
          <IconRotate className='size-4' />
          Reopen
        </Button>
        {canReassign && (
          <Button
            size='sm'
            variant='outline'
            onClick={() => onAction('TASK_BATCH_REASSIGN')}
          >
            <IconUserShare className='size-4' />
            Reassign
          </Button>
        )}
      </div>
      <Button size='sm' variant='ghost' onClick={onClear}>
        <IconX className='size-4' />
        Clear
      </Button>
    </div>
  );
}
