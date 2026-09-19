---
slug: task-statuses
title: Task statuses explained
summary: What each task status badge means, which statuses count as open, and which ones you can complete or reopen.
category: tasks
roles: []
release_function: none
routes: ["/dashboard/tasks", "/dashboard/tasks/[taskId]"]
tools: []
keywords: ["status", "badge", "open", "in progress", "waiting", "blocked", "complete", "cancelled", "not required", "revision required", "overdue"]
aliases: ["what does waiting mean", "what does blocked mean", "task status meaning", "task colours", "revision required", "not required task", "why is my task amber", "why is my task red"]
related: ["my-tasks", "complete-a-task", "task-blocked", "reopen-a-task", "cancellation-tasks"]
common_task: false
sort: 50
sources: ["src/components/task-status-badge.tsx", "src/features/tasks/components/due-label.tsx", "src/app/dashboard/tasks/[taskId]/page.tsx", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (tasks.status values)", "supabase/migrations/20260919149000_s17_reads_rls.sql (read_task_action_availability)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (task_follow_up)", "supabase/migrations/20260919147000_s15_cancellation.sql (Blocked cancellation tasks)"]
---
Every task has one status, shown as a coloured badge on the list and on the task.

## Open statuses

These tasks still need doing. They appear under **Open** on **My tasks**.

- **Open** (grey): ready to be worked on.
- **In progress** (blue): someone has started it.
- **Waiting** (amber): an answer was saved but something is still outstanding, for example a contract awaiting signature or a deposit not yet in the bank. The task page shows the reason and the next follow-up date.
- **Blocked** (red): the task cannot go ahead yet. This is used for some cancellation tasks that depend on something else being done first.

You can complete a task that is **Open**, **In progress** or **Waiting**. You cannot complete a **Blocked** task.

## Finished statuses

These appear under **History**.

- **Complete** (green): done. The task shows who completed it, when, and their note.
- **Not required**: the task turned out not to be needed.
- **Cancelled**: the task was stopped, usually because the job was cancelled.

**Complete** and **Not required** tasks can be reopened. **Cancelled** tasks cannot. See [Reopening a task](/help/reopen-a-task).

## Other markers

- **Revision required** (amber badge): the task must be dealt with through its own process, not the normal **Complete** button. Cancellation review tasks work this way. See [Cancellation tasks](/help/cancellation-tasks).
- The due date turns red with the number of days late when a task is overdue, and amber when it is due today.
