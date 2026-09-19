---
slug: reopen-a-task
title: Reopening a task
summary: How to reopen a completed or not-required task, what is kept, and how it can affect the job's stage.
category: tasks
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: []
keywords: ["reopen", "undo", "completed by mistake", "reopen task", "not required", "ready to book"]
aliases: ["reopen task", "undo complete", "completed by mistake", "task completed wrongly", "unfinish task", "put task back", "reopen a finished task"]
related: ["complete-a-task", "task-statuses", "task-blocked", "ready-to-book"]
common_task: false
sort: 70
sources: ["src/features/tasks/components/task-actions.tsx (ReopenTask)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_reopen)", "supabase/migrations/20260919149000_s17_reads_rls.sql (read_task_action_availability, describe_command_result TASK_REOPEN)", "supabase/migrations/20260919210000_r1_completion.sql (authorize_command_r1)"]
---
If a task was completed by mistake, or marked not required when it is needed after all, you can reopen it.

## Before you start

- The task must be **Complete** or **Not required**. **Cancelled** tasks cannot be reopened.
- You must be the task's owner or backup. An Admin or Manager can reopen anyone's task.

## Steps

1. Open the task. You can find finished tasks under **History** on **My tasks**.
2. Press **Reopen**.
3. Write why in **Why is it being reopened?** A reason is required.
4. Press **Reopen task**.

## What happens next

- You see **Task reopened. It is back in the task list.** The task is **Open** again, with the same owner.
- The completion note, evidence and history are kept.
- Reopening one of the prebooking tasks can move the job back out of Ready to Book. If so, the message says **The job has moved back to Prebooking until this task is done again.**
- The reopening, with your reason, appears in the task's **History**.

## If you can't do it

- **Only completed tasks can be reopened.** The task is still open or was cancelled.
- **Only the task owner, backup or an admin can do this.** Ask the owner or a manager.

This feature may not be switched on yet. Ask an administrator.
