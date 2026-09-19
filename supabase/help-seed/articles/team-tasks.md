---
slug: team-tasks
title: Team tasks: everyone else's work
summary: Who can see Team tasks, and how to use it to check and chase work owned by other people.
category: tasks
roles: ["Admin", "Manager", "Director", "Office"]
release_function: none
routes: ["/dashboard/tasks"]
tools: ["get_team_tasks"]
keywords: ["team tasks", "everyone's tasks", "owner", "chase", "overdue", "workload", "backup"]
aliases: ["other peoples tasks", "whole team work", "see colleagues tasks", "who owns this task", "team overdue", "chase a task", "tasks for someone else", "cover for someone"]
related: ["my-tasks", "task-statuses", "office-home", "complete-a-task", "staff-roles"]
common_task: false
sort: 20
sources: ["src/app/dashboard/tasks/page.tsx", "src/features/tasks/components/task-filter-bar.tsx", "src/features/tasks/components/task-list.tsx", "src/components/layout/nav-visibility.ts (teamTasks)", "supabase/migrations/20260919170000_view_port_reads.sql (can_read_team_tasks, read_tasks team scope)", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (task.read.all grants)"]
---
**Team tasks** shows open work owned by everyone else. It is for Admin, Manager, Director and Office staff. Other roles do not have it in the menu, and the system refuses the list to them.

## Steps

1. Open **Team tasks** from the menu, or press **t e**. On **My tasks** you can also switch **Whose tasks** from **My tasks** to **Team tasks**.
2. Use **Owner** to show one person's tasks, or **Everyone**.
3. Use **Status**, **Due**, **Queue** and the search box as on [My tasks](/help/my-tasks).
4. Click a task to open it.

## Reading the list

- The **Owner** column shows who owns the task, and the backup underneath if there is one. **Unassigned** means nobody owns it yet.
- Tasks you own or are backup for are not shown here. They are on **My tasks**.
- **Customer hidden** means you cannot open that job, so the customer's name is not shown.
- **Team overdue** on **Office home** opens this list filtered to overdue tasks.

## What you can do from here

Seeing a task does not mean you can act on it. Only the task's owner, its backup, or an Admin or Manager can complete or reopen it. See [What to do if you can't complete a task](/help/task-blocked).

## If you can't do it

If **Team tasks** is not in your menu, your role does not include it. Ask an administrator if you think it should.
