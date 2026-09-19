---
slug: office-queues
title: Office queues: calls, cancellations and everyone's tasks
summary: How office managers see the call, cancellation, payment and GHL work of the whole team, not just their own tasks.
category: tasks
roles: ["Admin", "Manager", "Office"]
release_function: FN-01
routes: ["/dashboard/tasks", "/dashboard/issues"]
tools: []
keywords: ["calls", "calls queue", "cancellations", "cancellation queue", "everyone", "team queue", "payments", "ghl", "queues"]
aliases: ["what calls need making", "calls to make", "cancellation tasks", "everyone's tasks", "all tasks", "whole team tasks", "payments queue", "ghl queue"]
related: ["team-tasks", "my-tasks", "record-a-call", "cancellation-tasks", "issues-queue"]
common_task: true
sort: 25
sources: ["src/app/dashboard/tasks/page.tsx", "src/features/tasks/filters.ts (QUEUE_TITLES, TEAM_QUEUE_CHIPS)", "src/features/tasks/components/task-filter-bar.tsx", "src/constants/data.ts (Calls, Cancellations)"]
---
The **Operations** menu has **Calls** and **Cancellations**. They show that kind of task for **everyone**, so the office can see what needs doing across all jobs.

## The queues

- **Calls**: installer-confirmation and customer-happy calls. Open one and use **Record call**.
- **Cancellations**: the tasks raised when a job is cancelled. They are resolved on the job's **Operations** tab: the task page has a **Resolve on the job's Operations tab** link.
- On **Tasks**, choose **Everyone** to see all owners, then the chips for **Calls**, **Issues**, **Cancellation**, **Payments**, **GHL** and **Booking**.
- Issues themselves (not just their tasks) are on the [Issues](/help/issues-queue) page.

## Who sees them

Office managers (Admin, Manager, Office) and anyone allowed to see team tasks.
