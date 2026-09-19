---
slug: complete-a-job
title: Marking a job operationally complete
summary: Where and how office staff mark a finished job operationally complete, and what happens when they do.
category: commissioning
roles: ["Admin", "Manager", "Office"]
release_function: FN-19, FN-11
routes: ["/dashboard/jobs/[jobId]"]
tools: ["find_job"]
keywords: ["complete", "operationally complete", "completion", "finish job", "close job", "operations tab", "sign off"]
aliases: ["complete job", "mark job complete", "finish job", "close job", "job finished", "operationally complete", "sign off job", "how do I complete a job", "mark as done"]
related: ["why-cant-i-complete-a-job", "electrical-completion", "office-commissioning-record", "job-detail", "job-stages", "switched-off-features"]
common_task: true
sort: 60
sources: ["src/features/jobs/components/operations/actions.tsx (CompleteJob)", "src/features/jobs/components/operations/operations-tab.tsx (Completion card)", "supabase/migrations/20260919141000_command_core.sql + 20260919210000_r1_completion.sql (OPERATIONAL_COMPLETE: Admin/Manager/Office, assigned, FN-19 Manual + FN-11 Manual)", "supabase/migrations/20260919146000_s10_s11_operations.sql (cmd_operational_complete: stage OperationallyComplete, GHL01 task, nothing written when not ready)"]
---
When all the work on a job is done and checked, the office marks the job operationally complete from the job's **Operations** tab.

## Before you start

- You must be office staff, a manager or an administrator, and assigned to the job.
- Every check on the **Completion** card must have a tick: installer confirmation for each work package, commissioning where needed, the customer happy call and no blocking issues. The card's badge then reads **Ready to complete**.

## Steps

1. Open the job and choose the **Operations** tab.
2. Look at the **Completion** card at the top.
3. Press **Mark operationally complete**.
4. Confirm in the window. The completion checks are run again. If anything is outstanding, nothing is changed.

## What happens next

- The job's stage changes to **Operationally complete**.
- The **Completion** card shows **Operationally complete** with the date, and who completed it.
- A **Move GHL opportunity** task is created for the office, due the next working day.

## If you can't do it

- The button is greyed out and a reason is shown under it. See [Why can't I complete this job?](/help/why-cant-i-complete-a-job) for every reason.
- **Your role can't do this.** Only office staff, managers and administrators can complete a job.
- **Switched off for this release. An administrator turns it on.** This feature may not be switched on yet. Ask an administrator.
