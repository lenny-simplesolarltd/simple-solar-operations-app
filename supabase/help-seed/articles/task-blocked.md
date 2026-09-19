---
slug: task-blocked
title: What to do if you can't complete a task
summary: The real reasons the Complete button is greyed out or your task is refused, and what to do about each one.
category: tasks
roles: []
release_function: none
routes: ["/dashboard/tasks/[taskId]"]
tools: ["get_my_tasks"]
keywords: ["cant complete", "refused", "greyed out", "blocked", "permission", "switched off", "not assigned", "error", "could not complete", "action required"]
aliases: ["cant complete task", "complete button greyed out", "complete button not working", "task wont complete", "task refused", "no permission", "switched off", "you dont have permission", "record changed", "task stuck", "blocked task"]
related: ["complete-a-task", "task-statuses", "switched-off-features", "my-requests", "reopen-a-task", "why-cant-i-complete-a-job"]
common_task: true
sort: 60
sources: ["src/features/tasks/components/task-actions.tsx (REASON wording)", "supabase/migrations/20260919149000_s17_reads_rls.sql (read_task_action_availability, result_message, result_error_catalogue, describe_command_error)", "supabase/migrations/20260919170000_view_port_reads.sql (availability_for_reader NOT_ASSIGNED)", "supabase/migrations/20260919210000_r1_completion.sql (authorize_command_r1)", "src/features/operations/use-command.ts"]
---
If you cannot complete a task, the task page or the form tells you why. Match the wording you see below.

## Messages under the buttons

- **Only the task owner, backup or an admin can do this.** Ask the owner, or ask a manager to reassign the task to you.
- **You can view this job but are not assigned to it.** You can read the job but cannot act on it. Ask the owner of the task.
- **This task cannot be completed in its current status.** It is already finished, **Blocked**, or marked **Revision required**. See [Task statuses explained](/help/task-statuses).
- **The job is cancelled or archived.** No normal work can be done on it.

## Messages after you press the button

- **This action is switched off at the moment. Ask an administrator.** Task completion is not switched on yet. See [Switched-off features](/help/switched-off-features).
- **You don't have permission to do this.** Your role cannot complete tasks. Task completion is for Admin, Manager, Director, Office and Variation Approver staff.
- **Only the task owner, their backup, or an administrator can do this.** As above.
- **This record changed after you opened the form.** Someone else changed the task. Close the form, refresh the page and try again.
- A message under **ACTION REQUIRED** names a missing or wrong answer, such as a missing note or an amount that does not match. Fix it and submit again.
- **CONNECTION PROBLEM**: press the button again. It will not be done twice.

## If you still can't do it

A message under **COULD NOT COMPLETE** ends with **Reference:** and a code. Nothing was saved. Send that reference to an administrator so they can look it up.

If the task is **Waiting**, it has not failed. Your answer was saved and it needs a follow-up. Complete it again once the missing item arrives.
