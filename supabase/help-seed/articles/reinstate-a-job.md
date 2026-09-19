---
slug: reinstate-a-job
title: How to reinstate a cancelled job
summary: Bring a cancelled job back to Prebooking when the customer changes their mind, then complete the reopen review.
category: cancellations
roles: ["Admin", "Manager", "Office"]
release_function: FN-01, FN-17, FN-20
routes: ["/dashboard/jobs/[jobId]"]
tools: ["find_job", "get_job"]
keywords: ["reinstate", "reopen", "uncancel", "restore job", "reopen review", "customer back"]
aliases: ["reinstate job", "reinstate a job", "reopen job", "uncancel job", "undo cancellation", "restore cancelled job", "customer changed mind", "customer wants to go ahead again", "reopen review"]
related: ["cancel-a-job", "close-a-cancellation", "booking-checks", "book-a-job", "job-stages"]
common_task: false
sort: 40
sources: ["src/features/jobs/components/operations/actions.tsx (ReinstateJob)", "src/features/jobs/components/operations/cancellation-work.tsx (CompleteReopenReview)", "src/features/jobs/components/operations/operations-tab.tsx", "src/features/jobs/components/operations/labels.ts (STAGE_NOT_CANCELLED)", "supabase/migrations/20260919147000_s15_cancellation.sql (cmd_reinstate_job, cmd_reopen_review_complete, assert_normal_work)", "supabase/migrations/20260919149000_s17_reads_rls.sql (REINSTATE_JOB wording)"]
---
If a customer comes back after cancelling, you can reinstate the job. It returns to **Prebooking** and goes through booking again.

## Before you start

- The job must be **Cancelled**. If it is still **Cancellation in progress**, [close the cancellation](/help/close-a-cancellation) first.
- Review what is still in place from before: commitments, invoices, orders and any work already done.

## Steps

1. Open the job and choose the **Operations** tab.
2. In the **Cancellation** section, click **Reinstate job**.
3. Enter the **Reason** and a **Next action date**. The date must be after the cancellation date.
4. Fill in **Commitments reviewed**, **Finance reviewed** and **Evidence reference**.
5. If work had started, fill in **Risk review** too.
6. Confirm.

## What happens next

You see "Job reinstated." The job is back at **Prebooking** with fresh, unscheduled work. Installers are not re-allocated and the old booking approval is cleared.

Normal work is paused until the reopen review is done:

1. On the **Operations** tab, find "Reinstated. Normal work is paused until the reopen review is complete."
2. Click **Complete reopen review**, describe **What was reviewed** and confirm.
3. Run the booking checks again, then book the job again. See [What the booking checks mean](/help/booking-checks).

> **Note:** Check the installers on the job's **Operations** tab after rebooking. If none show, ask a Manager or administrator how to allocate them.

## If you can't do it

- **Only a cancelled job can be reinstated.**
- "This needs checking before it can go ahead" with a reason, such as a missing review or a date that is not after the cancellation date. Fix it and try again.
- Only Admin, Manager and Office staff can reinstate jobs, and you must be assigned to the job unless you are an Admin or Manager.
- This feature may not be switched on yet. Ask an administrator.
