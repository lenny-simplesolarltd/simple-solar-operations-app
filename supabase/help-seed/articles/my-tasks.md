---
slug: my-tasks
title: My tasks: your work list
summary: How to find, filter and open the tasks you own or are the backup for.
category: tasks
roles: []
release_function: none
routes: ["/dashboard/tasks"]
tools: ["get_my_tasks"]
keywords: ["tasks", "my tasks", "to do", "work list", "overdue", "due today", "queue", "filter", "history"]
aliases: ["where is my work", "what do I need to do", "my to do list", "my jobs to do", "overdue tasks", "tasks due today", "completed tasks", "task history", "find a task", "my work"]
related: ["complete-a-task", "task-statuses", "team-tasks", "office-home", "task-blocked"]
common_task: true
sort: 10
sources: ["src/app/dashboard/tasks/page.tsx", "src/features/tasks/components/task-filter-bar.tsx", "src/features/tasks/components/task-list.tsx", "src/features/tasks/components/due-label.tsx", "src/features/tasks/filters.ts", "supabase/migrations/20260919170000_view_port_reads.sql (read_tasks, TASKS registry roles)"]
---
**My tasks** lists the work you own, or are the backup for. Every member of staff has it.

## Steps

1. Open **My tasks** from the menu. You can also click a count on **Office home**, such as **Overdue** or **Due today**.
2. Use **Status** to choose **Open** (the default), **History** (finished tasks) or **All**.
3. Narrow the list if you need to:
   - **Search task, job, customer, postcode** searches the tasks in the list.
   - **Due** picks **Overdue**, **Due today**, **Next 7 days**, **Later** or **No due date**.
   - **Queue** picks a kind of work, such as **Booking**, **Calls**, **Issues**, **Payments**, **Materials** or **Cancellation**.
4. Press **Clear filters** to go back to all your open tasks.
5. Click a task title to open it. Click the job reference to open the job.

## Reading the list

- **Due** turns red with the number of days late when a task is overdue, and amber when it is due today. Dates follow the UK day.
- **Status** shows a coloured badge. See [Task statuses explained](/help/task-statuses).
- A note under the title means the task is waiting for something, for example a follow-up.
- In **History**, the column shows when the task was completed and by whom.

If the list is long, it says how many it is showing. Narrow the filters to see the rest.

## If you can't do it

- **Nothing to do here** means no task matches your filters. Try **Clear filters**.
- A task you expected is missing: it may be owned by someone else. Ask your manager, or look in [Team tasks](/help/team-tasks) if you have it.
