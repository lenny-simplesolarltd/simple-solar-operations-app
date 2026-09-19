---
slug: pre04-check-customer-details-and-amount
title: PRE04 Check customer details and sold/presale amount
summary: Confirm the customer's details and the sold value are correct, or record a mismatch so the job is flagged for review.
category: sales
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: ["get_job_tasks", "get_job"]
keywords: ["PRE04", "customer details", "sold value", "verified amount", "contract value", "mismatch", "prebooking"]
aliases: ["pre 4", "pre04", "check customer details", "check sold amount", "verify price", "sold value wrong", "customer details wrong", "value mismatch", "check presale amount"]
related: ["presale-workflow", "job-detail", "ready-to-book", "intake-review", "complete-a-task", "switched-off-features"]
common_task: false
sort: 43
sources: ["src/features/tasks/components/task-actions.tsx (PRE04 form, COMPLETE_HELP)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_complete PRE04)", "supabase/migrations/20260919143000_s06_workflow.sql (task_satisfaction PRE04, customer_value_verified gate)", "supabase/migrations/20260919149000_s17_reads_rls.sql (PRE04 wording)", "supabase/seeds/002_task_assignment_rules.sql (PRE04 owner)"]
---
PRE04 is created for every sale. The office confirms that the customer's details and the sold value are right before the job can be booked.

## Before you start

- Open the job and compare the **Customer** and **Sale** cards on the **Overview** tab with what the customer agreed. The agreed price is also the **Contract value** on the **Money** tab.
- You must be the task owner, their backup or an administrator.

## Steps

1. Open the task from **My tasks** or the job's **Tasks** tab.
2. Click **Complete**.
3. Answer **Customer details match the booking?**
4. Answer **Sold value matches?**
5. If both are **Yes**, enter the **Verified gross amount (£)**.
6. Optionally add a **Supporting document (optional)**.
7. Add a **Note**. It is required.
8. Click **Complete task**, or **Record mismatch** if either answer is **No**.

## What happens next

- **Both Yes and the amount matches the contract value:** the task is complete, the customer and value are recorded as verified, and the app rechecks whether the job is Ready to book.
- **Either answer is No, or the amount does not match:** the job is flagged for review and the task waits with a follow-up on the next working day. Sort out the difference, then complete the task again.

## If you can't do it

- **"This action is switched off at the moment."** This feature may not be switched on yet. Ask an administrator.
- **"Enter the verified contract value in pounds and try again."**
- **"The amount isn't valid."** Enter pounds and pence, for example 10451.78.
- **"This job doesn't have a sold value recorded."** Ask an administrator to check the job.
- **"Only the task owner, backup or an admin can do this."**
