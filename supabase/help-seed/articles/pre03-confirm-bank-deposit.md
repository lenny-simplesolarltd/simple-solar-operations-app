---
slug: pre03-confirm-bank-deposit
title: PRE03 Confirm bank deposit
summary: Check the bank and record the deposit amount, date and bank reference, or record that it has not arrived yet.
category: sales
roles: ["Admin", "Manager", "Director"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: ["get_job_tasks"]
keywords: ["PRE03", "deposit", "bank", "deposit confirmation", "bank reference", "deposit received", "prebooking"]
aliases: ["pre 3", "pre03", "confirm deposit", "deposit in the bank", "deposit received", "has the deposit been paid", "deposit not received", "deposit confirmation", "bank check", "customer paid deposit"]
related: ["pre01-send-deposit-invoice", "presale-workflow", "ready-to-book", "complete-a-task", "switched-off-features"]
common_task: false
sort: 42
sources: ["src/features/tasks/components/task-actions.tsx (PRE03 form, COMPLETE_HELP)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_complete PRE03, record_deposit_confirmation, deposit helpers)", "supabase/migrations/20260919143000_s06_workflow.sql (bank_confirmation_evidence, build_invoice_stages)", "supabase/seeds/002_task_assignment_rules.sql (PRE03 owner Director with backup; eligible Admin/Manager/Director)", "supabase/migrations/20260919149000_s17_reads_rls.sql (deposit wording)", "docs/r1-parity-after-p0.md row 75 (DEPOSIT_CONFIRM has no UI; PRE03 covers it)"]
---
PRE03 is created when a job is sold with **No finance**. It is the deposit confirmation: a director checks the bank and records exactly what arrived. It is due the next working day and has a named backup.

## Before you start

- Look in the bank. Note the amount, the date it arrived and the payment reference.
- The expected deposit is on the job's **Money** tab under **Invoice stages**.
- You must be the task owner, their backup or an administrator.

## Steps

1. Open the task from **My tasks** or the job's **Tasks** tab.
2. Click **Complete**.
3. Answer **Deposit seen in the bank?**
4. If **Yes**, enter the **Amount received (£)**, the **Date received** and the **Bank reference**.
5. Add a **Note**. It is required.
6. Click **Complete task**, or **Record not received** if you answered **No**.

## What happens next

- **The amount matches the deposit invoice exactly:** the task is complete, the deposit shows as confirmed on the **Money** tab, and the app rechecks whether the job is Ready to book.
- **The amount is different:** the check is saved, but the task is not completed. It waits with a follow-up on the next working day.
- **Not received:** the check is saved and the task waits for a follow-up on the next working day.

## If you can't do it

- **"This action is switched off at the moment."** This feature may not be switched on yet. Ask an administrator.
- **"The deposit amount isn't valid."** Enter pounds and pence, for example 2612.95.
- **"The deposit received date isn't valid."** Enter a real date that isn't in the future.
- **"This job doesn't have a deposit invoice set up yet."** Ask an administrator to check the job's invoices.
- **"Only the task owner, backup or an admin can do this."**
