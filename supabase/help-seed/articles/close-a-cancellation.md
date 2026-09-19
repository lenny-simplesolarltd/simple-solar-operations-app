---
slug: close-a-cancellation
title: How to close a cancellation
summary: Finish a cancellation so the job becomes Cancelled, recording where any still-open tasks are being tracked.
category: cancellations
roles: ["Admin", "Manager", "Office"]
release_function: FN-01, FN-17, FN-20
routes: ["/dashboard/jobs/[jobId]"]
tools: ["find_job", "get_job_tasks"]
keywords: ["close cancellation", "cancelled", "finish cancellation", "cancellation in progress", "tracked obligations"]
aliases: ["close cancellation", "close a cancellation", "finish cancellation", "complete cancellation", "mark job cancelled", "job stuck in cancellation", "cancellation in progress"]
related: ["cancel-a-job", "cancellation-tasks", "reinstate-a-job", "job-stages"]
common_task: false
sort: 30
sources: ["src/features/jobs/components/operations/cancellation-work.tsx (CloseCancellation)", "src/features/jobs/components/operations/operations-tab.tsx", "src/features/jobs/components/operations/labels.ts (CONFIRMATION_OUTSTANDING, CANCELLATION_NOT_IN_PROGRESS wording)", "supabase/migrations/20260919220000_p0_r1_integration.sql (close flag)", "supabase/migrations/20260919147000_s15_cancellation.sql (cmd_cancellation_close: confirmations first, open tasks must be tracked, stage -> Cancelled)"]
---
A cancelled job stays at **Cancellation in progress** until someone closes the cancellation. Closing it moves the job to **Cancelled**.

## Before you start

- Every confirmation task must be resolved: merchant, scaffold, strip and calendar. See [Cancellation tasks](/help/cancellation-tasks).
- Other cancellation tasks may stay open, but you must say where each one is being tracked and why it is still open.

## Steps

1. Open the job and choose the **Operations** tab.
2. In the **Cancellation** section, click **Close cancellation**.
3. Enter a **Reason**.
4. For each task still open, fill in **tracked where** (for example an email thread or another system) and **why still open**.
5. Confirm.

## What happens next

The job becomes **Cancelled**. Any task still open stays with its owner. The job can be brought back later with [Reinstate job](/help/reinstate-a-job).

## If you can't do it

Hover over the greyed-out button, or read the note under it:

- **Resolve the confirmation tasks (merchant, scaffold, calendar) first.**
- **Only while the cancellation is in progress.** The job is not being cancelled, or is already Cancelled.
- **Your role can’t do this.** Only Admin, Manager and Office staff can close a cancellation.
- **You’re not assigned to this job.** Admins and Managers can act on any job.
- **Switched off for this release. An administrator turns it on.** This feature may not be switched on yet. Ask an administrator.
