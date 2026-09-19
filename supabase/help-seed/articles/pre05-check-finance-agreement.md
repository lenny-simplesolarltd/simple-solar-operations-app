---
slug: pre05-check-finance-agreement
title: PRE05 Check finance agreement approval
summary: Confirm the customer's finance agreement is approved and upload the agreement, so a finance job can become Ready to book.
category: sales
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: ["get_job_tasks"]
keywords: ["PRE05", "finance", "finance agreement", "Phoenix", "other finance", "approval", "prebooking"]
aliases: ["pre 5", "pre05", "finance approved", "finance agreement", "phoenix finance", "upload finance agreement", "finance approval", "customer on finance"]
related: ["presale-workflow", "ready-to-book", "upload-a-file", "complete-a-task", "switched-off-features"]
common_task: false
sort: 44
sources: ["src/features/tasks/components/task-actions.tsx (PRE05 'Finance agreement (optional)' field)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_complete PRE05 note + evidence)", "supabase/migrations/20260919143000_s06_workflow.sql (PRE05_satisfied and finance_agreement_evidence gates)", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (PRE05 created when finance route is not Standard)", "docs/r1-parity-after-p0.md row 64 (field labelled optional though the gate requires it)"]
---
PRE05 is created when a job is sold with **Phoenix finance** or **Other finance**. It takes the place of the deposit tasks. The office confirms the finance provider has approved the agreement.

## Before you start

- Get the approved finance agreement or the provider's approval, as a PDF or photo, 25 MB or smaller.
- You must be the task owner, their backup or an administrator.

## Steps

1. Open the task from **My tasks** or the job's **Tasks** tab.
2. Click **Complete**.
3. Under **Finance agreement (optional)**, choose the file and wait for "Uploaded".
4. Add a **Note**, for example the provider and agreement reference. It is required.
5. Click **Complete task**.

> **Warning:** The screen says the agreement is optional, but a finance job cannot become Ready to book until the agreement file is on this task. Always upload it.

## What happens next

The task is complete and the file appears under **Evidence** on the task and on the job's **Files** tab as **Finance agreement**. The app rechecks whether the job is Ready to book.

If you completed the task without the file, the job stays at **Prebooking**. Reopen the task and complete it again with the file.

## If you can't do it

- **"This action is switched off at the moment."** This feature may not be switched on yet. Ask an administrator.
- **"Only photos (JPG, PNG, WebP, HEIC) and PDF files can be added."** Save the agreement as a PDF.
- **"Only the task owner, backup or an admin can do this."**
