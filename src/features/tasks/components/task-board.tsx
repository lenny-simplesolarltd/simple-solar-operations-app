'use client';

import type { BatchOperation, TaskView } from '@/lib/backend/models';
import type { CommandOutcome } from '@/lib/backend/types';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { StaffOption } from '../server/queries';
import { driveBatch, getBatchProgress, submitBatch } from '../server/batch';
import { BulkBar, BulkDialog, type BulkSubmitArgs } from './bulk-actions';
import { TaskList, type TaskListSelection } from './task-list';

/**
 * The Tasks table with selection and bulk actions.
 *
 * The optimistic part is deliberately narrow: a row that has been submitted
 * shows "Completing…" and fades, but it is never shown as Complete until the
 * server says so. When an item does not go through, the row comes back with
 * the reason the server gave rather than disappearing or claiming success.
 */

/** Work that is finished by a different command, so it never joins a bulk action. */
const completedElsewhere = (task: TaskView) =>
  task.group === 'Cancellation' ||
  (task.template_code ?? '').startsWith('S15-') ||
  task.template_code === 'INS01' ||
  task.template_code === 'INS04';

/**
 * Why the override happened, recorded automatically.
 *
 * public.tasks requires a non-blank override_reason (tasks_override_shape), and
 * that constraint is not something to relax for a UX change. Choosing
 * "Complete with override" from the task list is the whole act, so the reason
 * records exactly that and nothing more. It is deliberately not a business
 * fact: override never asserts the work happened, and the job's readiness
 * gates still report the requirement as unmet.
 */
const OVERRIDE_REASON =
  'Administrative override from the task list. No business fact was recorded.';

const VERB: Record<BatchOperation, string> = {
  TASK_BATCH_COMPLETE: 'Completing…',
  TASK_BATCH_OVERRIDE_COMPLETE: 'Completing…',
  TASK_BATCH_REOPEN: 'Reopening…',
  TASK_BATCH_REASSIGN: 'Reassigning…'
};

/** How often the board asks the server how the operation is getting on. */
const POLL_MS = 1200;
const POLL_LIMIT = 150;

export function TaskBoard({
  tasks,
  showOwner,
  showCompleted,
  emptyTitle,
  emptyDescription,
  canOverride,
  canReassign,
  canAct,
  staff
}: {
  tasks: TaskView[];
  showOwner: boolean;
  showCompleted: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  canOverride: boolean;
  canReassign: boolean;
  /** False for someone who may only read this list: no checkboxes at all. */
  canAct: boolean;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  const [operation, setOperation] = useState<BatchOperation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // State updates are batched, so two clicks in the same tick would both see
  // submitting === false. A ref changes synchronously and closes that window.
  const inFlight = useRef(false);
  const [outcome, setOutcome] = useState<CommandOutcome | null>(null);
  // The selection frozen when the dialog opened: state, because the dialog
  // renders from it (a ref read during render is not safe).
  const [dialogIds, setDialogIds] = useState<string[]>([]);

  const selectable = useMemo(
    () => tasks.filter((t) => !completedElsewhere(t)),
    [tasks]
  );

  const onToggle = useCallback((taskId: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(taskId);
      else copy.delete(taskId);
      return copy;
    });
  }, []);

  const onTogglePage = useCallback(
    (next: boolean) => {
      setSelected((prev) => {
        const copy = new Set(prev);
        for (const t of selectable) {
          if (next) copy.add(t.id);
          else copy.delete(t.id);
        }
        return copy;
      });
    },
    [selectable]
  );

  const selection: TaskListSelection | undefined = canAct
    ? {
        selected,
        onToggle,
        onTogglePage,
        pending,
        failed,
        isSelectable: (t) => !completedElsewhere(t)
      }
    : undefined;

  const openDialog = (op: BatchOperation) => {
    setDialogIds(Array.from(selected));
    setOutcome(null);
    setOperation(op);
  };

  const closeDialog = () => {
    setOperation(null);
    setOutcome(null);
  };

  /** Reads the authoritative per-item result and puts the failures back on the table. */
  const reconcile = useCallback(
    async (batchId: string, ids: string[]) => {
      for (let i = 0; i < POLL_LIMIT; i += 1) {
        const detail = await getBatchProgress(batchId);
        if (!detail.ok) break;
        const { progress, items } = detail.data;
        const running =
          progress.pending + progress.processing + progress.retrying;
        if (running === 0) {
          const problems = new Map<string, string>();
          for (const it of items) {
            if (it.status === 'Failed' || it.status === 'NeedsReview') {
              problems.set(
                it.task_id,
                it.error_detail ?? it.error_code ?? 'Could not be done'
              );
            }
          }
          setFailed((prev) => {
            const copy = new Map(prev);
            problems.forEach((why, id) => copy.set(id, why));
            return copy;
          });
          setPending((prev) => {
            const copy = new Map(prev);
            for (const id of ids) copy.delete(id);
            return copy;
          });
          // Whatever did go through is now authoritative; re-read the list.
          router.refresh();
          if (problems.size > 0) {
            toast.warning(
              `${progress.succeeded} done · ${problems.size} need attention`
            );
          } else if (progress.succeeded > 0) {
            toast.success(`${progress.succeeded} done`);
          }
          return;
        }
        // Help it along: claiming is safe to do from more than one place.
        if (progress.pending > 0) void driveBatch(batchId);
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      // Still running after the cap: the recovery sweep owns it now.
      setPending((prev) => {
        const copy = new Map(prev);
        for (const id of ids) copy.delete(id);
        return copy;
      });
      router.refresh();
    },
    [router]
  );

  /**
   * Override completes on the click that chose it: no dialog, no second
   * confirmation, no question to answer. The guard is the submitting flag, not
   * a modal - a second press while the first is in flight does nothing, so one
   * selection can only ever produce one batch.
   *
   * Nothing about authorisation moves. The batch is submitted with every
   * selected task and the database decides each one on its own merits:
   * permission, cross-owner rights, live-job requirement, historical
   * non-actionability, cancellation locks, version and idempotency. Anything
   * it refuses comes back as a failed item and returns to the list.
   */
  const overrideNow = () => {
    if (inFlight.current || submitting) return;
    inFlight.current = true;
    void submit({
      operation: 'TASK_BATCH_OVERRIDE_COMPLETE',
      args: { override_reason: OVERRIDE_REASON },
      taskIds: Array.from(selected)
    });
  };

  const submit = async ({ operation: op, args, taskIds }: BulkSubmitArgs) => {
    if (taskIds.length === 0) return;
    setSubmitting(true);
    setOutcome(null);
    const result = await submitBatch({
      operation: op,
      args,
      target: { taskIds }
    });
    setSubmitting(false);
    inFlight.current = false;
    if (!result.ok) {
      setOutcome(result.outcome);
      return;
    }
    // Acknowledge immediately: the rows go quiet, the dialog closes, the
    // person can carry on. Nothing claims to be Complete yet.
    setPending((prev) => {
      const copy = new Map(prev);
      for (const id of taskIds) copy.set(id, VERB[op]);
      return copy;
    });
    setFailed((prev) => {
      const copy = new Map(prev);
      for (const id of taskIds) copy.delete(id);
      return copy;
    });
    setSelected(new Set());
    closeDialog();
    // Let the global indicator know there is something to watch.
    window.dispatchEvent(new CustomEvent('ss:batch-started'));
    void reconcile(result.batchId, taskIds);
  };

  return (
    <>
      <TaskList
        tasks={tasks}
        showOwner={showOwner}
        showCompleted={showCompleted}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        selection={selection}
      />
      {selection && (
        <BulkBar
          count={selected.size}
          canOverride={canOverride}
          canReassign={canReassign}
          overriding={submitting}
          onAction={openDialog}
          onOverride={overrideNow}
          onClear={() => setSelected(new Set())}
        />
      )}
      <BulkDialog
        operation={operation}
        taskIds={dialogIds}
        staff={staff}
        onClose={closeDialog}
        onSubmit={submit}
        submitting={submitting}
        outcome={outcome}
      />
    </>
  );
}
