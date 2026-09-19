---
slug: record-a-call
title: How to record a call
summary: Log a phone call against a job, or record the installer confirmation call and customer happy call from their tasks.
category: jobs
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/jobs/[jobId]", "/dashboard/tasks/[taskId]"]
tools: []
keywords: ["call", "phone call", "log call", "record call", "installer confirmation call", "customer happy call", "INS01", "INS04", "no answer"]
aliases: ["log a call", "record call", "rang customer", "called customer", "phoned installer", "no answer", "customer happy call", "installer call", "call notes", "try again later"]
related: ["job-detail", "raise-an-issue", "complete-a-task", "why-cant-i-complete-a-job", "switched-off-features"]
common_task: true
sort: 40
sources: ["src/features/jobs/components/operations/actions.tsx (LogJobCall)", "src/features/jobs/components/operations/labels.ts (CALL_TYPES, CALL_OUTCOMES, flagText)", "src/features/tasks/components/task-actions.tsx (RecordCall)", "supabase/migrations/20260919210000_r1_completion.sql (job-level CALL_RECORD, authorize_command_r1, call_record flag)", "supabase/migrations/20260919149000_s17_reads_rls.sql (result messages)"]
---
There are two ways to record a call. Use **Log call** for any call about a job. Use **Record call** on the installer confirmation call or customer happy call tasks.

## Before you start

You must be office staff and be assigned to the job (for example, own a task on it). The job must not be cancelled or archived.

## Log a call on a job

1. Open the job and choose the **Operations** tab.
2. In **Calls**, click **Log call**.
3. Choose **Who**: Customer, Installer, Supplier or Payment.
4. Choose the **Outcome**, for example **Spoke - done** or **No answer**.
5. Optionally choose which work it was **About**, set **When**, set **Try again at** and add **Notes**.
6. Click **Log call** at the bottom of the form. The call appears in the **Calls** list.

A logged call records the call only. It does not complete any task or change any work.

## Record an installer or customer call task

1. Open the **Installer confirmation call** or **Customer happy call** task.
2. Click **Record call** and choose the **Outcome**.
3. For **No answer**, you can set **Try again at**. Leave it blank to try again the next working day.
4. Otherwise answer **Installer confirmed the work is finished?** or **Customer happy?**.
5. Click **Save call**.

Confirming the installer finished marks that work complete. A return visit raises a remedial issue, and an unhappy customer raises a complaint.

## If you can't do it

- **"Switched off for this release. An administrator turns it on."** This feature may not be switched on yet. Ask an administrator.
- **"You're not assigned to this job."** Ask the task owner or an administrator.
- **"Only the task owner, backup or an admin can do this."** Call tasks can only be recorded by their owner or backup.
- **"The job is cancelled or archived."** No calls can be logged.
