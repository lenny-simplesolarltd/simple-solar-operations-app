---
slug: reassign-a-task
title: Reassigning a task to someone else
summary: How office managers move an open task to another person, for example when the owner is off, and who it can go to.
category: tasks
roles: ["Admin", "Manager", "Office"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: []
keywords: ["reassign", "change owner", "task owner", "backup", "holiday cover", "off sick", "move task"]
aliases: ["give this task to someone else", "change who owns a task", "cover for someone", "someone is off", "move a task to another person"]
related: ["my-tasks", "team-tasks", "task-statuses", "people-and-access"]
common_task: false
sort: 40
sources: ["src/features/tasks/components/task-actions.tsx (Reassign)", "supabase/migrations/20260920120000_convergence_operations.sql (TASK_REASSIGN, TASK_REASSIGN_CANDIDATES)"]
---
An open task can be moved to someone else, for example when its owner is on leave.

## Reassigning

1. Open the task and press **Reassign**.
2. Choose the **new owner**. You can also choose a **backup**; the current backup is filled in, so leave it or change it.
3. Write the **reason** and press **Reassign task**.

The task moves at once and its history records who moved it and why.

## Who a task can go to

Only active people with a role the task allows. For example PRE03 (bank deposit) can only go to Admin, Manager or Director staff. The list only offers people who qualify.

## If you can't do it

**Reassign** only appears for open tasks on jobs you are assigned to, for Admin, Manager and Office staff, while the office core is switched on.
