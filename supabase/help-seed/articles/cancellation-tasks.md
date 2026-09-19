---
slug: cancellation-tasks
title: Working through cancellation tasks
summary: Resolve the tasks a cancellation raises, such as telling the customer or getting the merchant and scaffolder to confirm, with evidence.
category: cancellations
roles: ["Admin", "Manager", "Office"]
release_function: FN-01, FN-17, FN-20
routes: ["/dashboard/jobs/[jobId]"]
tools: ["get_job_tasks", "get_my_tasks"]
keywords: ["cancellation tasks", "resolve", "evidence", "merchant confirmed", "scaffolder acknowledged", "strip", "notify customer", "notify installer", "GHL"]
aliases: ["cancellation tasks", "resolve cancellation task", "cancellation to do", "after cancelling a job", "merchant cancellation", "scaffold cancellation", "tell customer cancelled", "notify installer cancelled", "cant complete cancellation task"]
related: ["cancel-a-job", "close-a-cancellation", "reinstate-a-job", "my-tasks", "task-blocked"]
common_task: false
sort: 20
sources: ["src/features/jobs/components/operations/cancellation-work.tsx (ResolveCancellationTask)", "src/features/jobs/components/operations/operations-tab.tsx (Cancellation section)", "supabase/migrations/20260919220000_p0_r1_integration.sql (cancellation tasks, confirmation, resolvable, resolve flag)", "supabase/migrations/20260919147000_s15_cancellation.sql (s15_task owner = actor, revision_required; cmd_cancellation_resolve)", "supabase/migrations/20260919142000_reference_config.sql (S15-CAN-* titles)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (TASK_COMPLETE refuses revision_required)"]
---
Cancelling a job raises tasks for everything a person must sort out. They are assigned to whoever cancelled the job, and you resolve them from the job itself, not from the task screen.

## Typical tasks

- **Notify customer using reviewed cancellation message** and **Notify salesperson of cancellation**.
- **Notify installer and cancel future commitment**, one per installer booking.
- **Merchant confirmed latest cancellation and goods disposition** and **Review goods**.
- **Scaffolder acknowledged cancellation**, or **Arrange safe strip and confirm actual removal** if the scaffold is up.
- Finance, contract and record-keeping reviews, and **Record human GHL cancellation stage action**.

## Steps

1. Open the job and choose the **Operations** tab.
2. In the **Cancellation** section, find the task and click **Resolve**.
3. For merchant, scaffold, strip and calendar tasks, choose the **Outcome** **Confirmed by them**. A message you sent is not a confirmation: wait for their reply. For a strip, also enter the **Date struck**.
4. Enter the **Evidence reference**: the email, call note or document that proves it.
5. Describe **What was done** and confirm.

## What happens next

The task is completed and drops off the list. Once the merchant, scaffold, strip and calendar confirmations are all resolved, you can [close the cancellation](/help/close-a-cancellation).

## If you can't do it

- Tasks marked **track it when closing** (usually the GHL task) cannot be resolved yet. You record where they are tracked when you close the cancellation.
- They cannot be completed from the ordinary task screen ("This task can't be completed in its current state"). Use **Resolve** on the job.
- Only Admin, Manager and Office staff can resolve them, and you must be assigned to the job unless you are an Admin or Manager.
- This feature may not be switched on yet. Ask an administrator.
