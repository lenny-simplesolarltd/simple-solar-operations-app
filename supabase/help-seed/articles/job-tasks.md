---
slug: job-tasks
title: A job's tasks
summary: Where to see every task on a job, who owns each one, and which tasks the app creates as the job moves on.
category: jobs
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]", "/dashboard/tasks/[taskId]"]
tools: ["get_job_tasks"]
keywords: ["tasks", "job tasks", "task owner", "backup", "due date", "PRE", "BKG", "INS", "open tasks"]
aliases: ["tasks on a job", "what tasks are left", "who owns this task", "whats outstanding on the job", "open tasks", "next task", "task list for job", "PRE tasks", "booking tasks"]
related: ["job-detail", "presale-workflow", "my-tasks", "team-tasks", "complete-a-task", "task-statuses", "task-blocked"]
common_task: false
sort: 60
sources: ["src/app/dashboard/jobs/[jobId]/page.tsx (Tasks tab, Open tasks on Overview)", "src/features/jobs/task-table.tsx", "src/features/jobs/server/queries.ts (OPEN_TASK_STATUSES, getJobDetail)", "src/components/task-status-badge.tsx", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (tasks_select RLS, PRE task creation)", "supabase/migrations/20260919142000_reference_config.sql (task templates)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (BKG04/BKG05 on confirm)"]
---
Every piece of work on a job is a task with one owner and, sometimes, a backup. The job page shows them all in one place.

## Where to see them

- The **Overview** tab lists the job's **Open tasks**.
- The **Tasks** tab lists every task on the job, open or finished. The number next to **Tasks** is how many are still open.

Each row shows the task code and title, the **Owner** (and backup), the **Due** date and the **Status**. If a task is waiting on something, the reason shows in red under its title. Click a task title to open it.

## Which tasks appear, and when

- **When the job is sold:** the prebooking tasks, starting with PRE. Which ones depends on how the customer is paying. See [the presale workflow](/help/presale-workflow).
- **During booking:** booking tasks, starting with BKG, such as **Prepare booking** and **Book dates and allocations**. Confirming the booking adds **Send customer booking email** and **Check calendar events and document pack**.
- **Around the install:** the **Installer confirmation call** and the **Customer happy call**, plus remedial and issue tasks when needed.
- **When a job is moved or cancelled:** follow-up tasks to tell the customer, installers, merchant and scaffolder.

## Who sees which tasks

Office, Admin, Manager and Director staff see every task on a job. Everyone else sees only the tasks they own or back up, so the list may look shorter for you.

## What happens next

Open a task to complete it. See [how to complete a task](/help/complete-a-task).

> **Note:** Task owners are set by the app's assignment rules when the task is created. Changing a rule does not change tasks that already exist.
