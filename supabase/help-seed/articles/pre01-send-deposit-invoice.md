---
slug: pre01-send-deposit-invoice
title: PRE01 Send deposit invoice
summary: Record that the deposit invoice has been sent to the customer, or that it could not be sent and needs a follow-up.
category: sales
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: ["get_job_tasks"]
keywords: ["PRE01", "deposit invoice", "invoice number", "send invoice", "prebooking"]
aliases: ["pre 1", "pre01", "send deposit invoice", "deposit invoice sent", "invoice number", "couldnt send invoice", "invoice not sent"]
related: ["presale-workflow", "pre03-confirm-bank-deposit", "ready-to-book", "complete-a-task", "switched-off-features"]
common_task: false
sort: 40
sources: ["src/features/tasks/components/task-actions.tsx (PRE01 form, COMPLETE_HELP)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_complete PRE01)", "supabase/migrations/20260919143000_s06_workflow.sql (task_satisfaction PRE01, build_invoice_stages 25% deposit)", "supabase/migrations/20260919149000_s17_reads_rls.sql (R1A_REQUIRED_INVOICE_NUMBER, R1A_DEPOSIT_STAGE_MISSING wording)", "supabase/seeds/002_task_assignment_rules.sql (PRE01 owner)"]
---
PRE01 is created when a job is sold with **No finance**. It records that the deposit invoice has gone to the customer. It is due straight away and is owned by the office.

## Before you start

- Send the deposit invoice to the customer and note its invoice number. The deposit amount for the job is on the job's **Money** tab under **Invoice stages**.
- You must be the task owner, their backup or an administrator.

## Steps

1. Open the task from **My tasks** or the job's **Tasks** tab.
2. Click **Complete**.
3. Under **Deposit invoice**, choose **Sent to the customer**.
4. Enter the **Invoice number**.
5. Add a **Note**. It is required.
6. Click **Complete task**.

If the invoice could not be sent, choose **Could not send**, add a note and click **Record follow-up**.

## What happens next

- **Sent:** the task is complete and the deposit invoice is marked as sent. The app rechecks whether the job is Ready to book.
- **Could not send:** the task stays open as **Waiting**, with a follow-up on the next working day.

## If you can't do it

- **The Complete button is greyed out with "This action is switched off at the moment."** This feature may not be switched on yet. Ask an administrator.
- **"The deposit invoice number is required."** Enter the invoice number and try again.
- **"This job doesn't have a deposit invoice set up yet."** Ask an administrator to check the job's invoices.
- **"Only the task owner, backup or an admin can do this."** Ask the owner shown on the task.
