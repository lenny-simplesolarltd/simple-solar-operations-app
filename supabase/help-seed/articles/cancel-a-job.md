---
slug: cancel-a-job
title: How to cancel a job
summary: Cancel a job when the customer pulls out: record why, see what will be undone, and raise the follow-up tasks.
category: cancellations
roles: ["Admin", "Manager", "Office"]
release_function: FN-01, FN-17, FN-20
routes: ["/dashboard/jobs/[jobId]"]
tools: ["find_job", "get_job"]
keywords: ["cancel", "cancellation", "customer cancelled", "pull out", "withdraw", "terminate", "cancel job", "effective date"]
aliases: ["cancel job", "cancel a job", "customer cancelling", "customer cancelled", "cancel customer", "customer wants to cancel", "customer pulled out", "customer changed their mind", "cancel install", "cancel order", "job cancelled", "stop job"]
related: ["cancellation-tasks", "close-a-cancellation", "reinstate-a-job", "job-stages", "job-detail", "switched-off-features"]
common_task: true
sort: 10
sources: ["src/features/jobs/components/operations/cancel-job.tsx", "src/features/jobs/components/operations/operations-tab.tsx (Cancellation section)", "src/features/jobs/components/operations/labels.ts (flagText)", "src/features/jobs/server/cancellation.ts (preview refusal wording)", "supabase/migrations/20260919147000_s15_cancellation.sql (cmd_cancel_job: required fields, stage, tasks owned by the actor)", "supabase/migrations/20260919210000_r1_completion.sql (cancel_job flag: office manager, assignment, FN-01 + FN-17 + FN-20)", "supabase/migrations/20260919149000_s17_reads_rls.sql (CANCEL_JOB success wording)"]
---
When a customer cancels, the job is kept, not deleted. It moves to **Cancellation in progress**, unstarted work and future installer bookings are cancelled, and tasks are raised for everything a person must sort out.

## Before you start

Have the reason ready, and find out what has already happened: work on site, materials ordered or delivered, scaffold, and any deposit or payments.

## Steps

1. Open the job and choose the **Operations** tab.
2. In the **Cancellation** section, click **Cancel job**.
3. Read **What cancelling will do**. It lists what will be cancelled and anything that **Needs review afterwards**, such as scaffold that must be struck safely.
4. Check the **Effective date**.
5. Fill in every box: **Reason for cancelling**, **Work already done on site**, **Materials (ordered / picked / on site)**, **Scaffold**, **Deposit / payments** and **Other systems (Trello, GHL ...)**. Write "None" where nothing applies.
6. Tick "I understand the job moves to cancellation and its bookings are cancelled."
7. Click **Cancel job**.

## What happens next

You see "Job cancellation recorded." Open tasks, draft orders, stock reservations and unsent messages are cancelled. Cancellation tasks are created and assigned to you, for example notifying the customer, installer and salesperson. Nothing is sent to the customer automatically. See [Cancellation tasks](/help/cancellation-tasks).

## If you can't do it

Hover over the greyed-out button to see why:

- **Cancellation has already started.** Or **The job is archived.**
- **Your role can’t do this.** Only Admin, Manager and Office staff can cancel jobs. Tell one of them.
- **You’re not assigned to this job.** Admins and Managers can cancel any job.
- **Switched off for this release. An administrator turns it on.** This feature may not be switched on yet. Ask an administrator.
