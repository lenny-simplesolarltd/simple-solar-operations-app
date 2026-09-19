---
slug: presale-workflow
title: The presale workflow explained
summary: The prebooking (PRE) tasks created when a job is sold, who owns them, and how finishing them makes the job Ready to book.
category: sales
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]", "/dashboard/tasks/[taskId]"]
tools: ["get_job_tasks"]
keywords: ["presale workflow", "prebooking", "PRE01", "PRE02", "PRE03", "PRE04", "PRE05", "after the sale", "finance route"]
aliases: ["what happens after a sale", "pre tasks", "prebooking tasks", "pre 1", "pre 2", "pre 3", "pre 4", "pre 5", "after job sold", "who does what after sale", "sale to booking"]
related: ["new-job-sold", "pre01-send-deposit-invoice", "pre02-check-contract-signed", "pre03-confirm-bank-deposit", "pre04-check-customer-details-and-amount", "pre05-check-finance-agreement", "ready-to-book", "job-tasks"]
common_task: false
sort: 30
sources: ["supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (PRE task templates, finance-route task creation)", "supabase/seeds/002_task_assignment_rules.sql (owners and eligible roles)", "supabase/migrations/20260919143000_s06_workflow.sql (evaluate_ready_to_book)", "src/features/presale/components/job-sold-screen.tsx", "src/features/jobs/components/operations/labels.ts / src/features/booking/labels.ts (gate labels)"]
---
When a sale is submitted, the job starts at **Prebooking** and the app creates its prebooking tasks. Their codes start with PRE. When all of them are done properly, the job becomes **Ready to book** by itself.

## Which tasks are created

It depends on the **Finance route** chosen on the sale.

**No finance:**

1. PRE01 **Send deposit invoice**, due straight away.
2. PRE02 **Check contract sent/signed**, due straight away.
3. PRE03 **Confirm bank deposit**, due the next working day.
4. PRE04 **Check customer details and sold/presale amount**.

**Phoenix finance or Other finance:**

1. PRE02 **Check contract sent/signed**.
2. PRE04 **Check customer details and sold/presale amount**.
3. PRE05 **Check finance agreement approval**.

## Who owns them

PRE01, PRE02, PRE04 and PRE05 go to a named person in the office. PRE03 goes to a director, with a named backup, because it confirms money in the bank. The **JOB SOLD** screen and the job's **Tasks** tab show the owner of each task.

Only the owner, their backup or an administrator can complete a task.

## What happens next

Each time a PRE task is completed, the app rechecks the job. Once every check passes it moves to **Ready to book**. See [what Ready to book means](/help/ready-to-book).

Some answers do not complete the task. For example, a contract that is sent but not signed, or a deposit not yet in the bank, is saved and the task waits for a follow-up on the next working day.

## If you can't do it

- **The Complete button is greyed out:** this feature may not be switched on yet. Ask an administrator.
- A Surveyor cannot complete these tasks. The office does them after the sale.
