---
slug: complete-a-task
title: How to complete a task
summary: How to open a task, fill in the Complete form and understand the result, including when a task is saved for follow-up instead.
category: tasks
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: ["get_my_tasks", "get_job_tasks"]
keywords: ["complete", "finish", "done", "close task", "completion note", "deposit invoice", "contract", "bank deposit", "customer details", "finance agreement"]
aliases: ["complete task", "finish a task", "mark task done", "tick off task", "close a task", "sign off task", "deposit invoice sent", "contract signed", "deposit received", "check customer details", "cant complete task"]
related: ["add-evidence-to-a-task", "task-blocked", "task-statuses", "reopen-a-task", "record-a-call", "my-requests", "ready-to-book", "pre01-send-deposit-invoice", "pre02-check-contract-signed", "pre03-confirm-bank-deposit", "pre04-check-customer-details-and-amount", "pre05-check-finance-agreement"]
common_task: true
sort: 30
sources: ["src/app/dashboard/tasks/[taskId]/page.tsx", "src/features/tasks/components/task-actions.tsx", "supabase/migrations/20260919210000_r1_completion.sql (authorize_command_r1 TASK_COMPLETE: office class, assigned, owner/backup/admin, FN-01)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_complete, task_follow_up)", "supabase/migrations/20260919149000_s17_reads_rls.sql (describe_command_result, result_error_catalogue)"]
---
You complete a task from its own page. The form asks for what the task needs, and always for a note.

## Before you start

- You must be the task's owner or backup. An Admin or Manager can complete anyone's task.
- The task must be **Open**, **Waiting** or **In progress**.

## Steps

1. Open the task from **My tasks** or from the job.
2. Press **Complete**.
3. Fill in the form. Some tasks ask for more:
   - **Send deposit invoice**: choose **Sent to the customer** and enter the **Invoice number**, or choose **Could not send**.
   - **Check contract sent/signed**: enter the **Contract reference** and choose **Signed** (upload the signed contract) or **Sent, awaiting signature**.
   - **Confirm bank deposit**: answer **Deposit seen in the bank?** If yes, enter the amount, date and bank reference. The amount must match the deposit invoice exactly.
   - **Check customer details and sold/presale amount**: answer both questions, then enter the **Verified gross amount**.
   - Other tasks can take an optional file. See [Adding evidence to a task](/help/add-evidence-to-a-task).
4. Write a **Note**.
5. Press the button at the bottom. Its label changes to match your answer, for example **Complete task**, **Record follow-up** or **Record as sent**.

Installer and customer call tasks show **Record call** instead. See [Record a call](/help/record-a-call).

## What happens next

- **Task completed successfully.** means it is done. It may add **The job is now Ready to Book.**
- A message starting **Saved.** means your answer was recorded but the task is not finished, for example because the deposit has not arrived. The task becomes **Waiting**, with a follow-up the next working day at 9am.
- If the form shows **ACTION REQUIRED** or **COULD NOT COMPLETE**, nothing was saved. Read the message, fix the form and try again.

Every result is also listed on [My requests](/help/my-requests).

## If you can't do it

This feature may not be switched on yet. Ask an administrator.

For other reasons, see [What to do if you can't complete a task](/help/task-blocked).
