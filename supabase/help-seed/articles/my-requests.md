---
slug: my-requests
title: My requests: checking what you have submitted
summary: How to use My requests to check what you have submitted and what result the system recorded for each one.
category: getting-started
roles: []
release_function: none
routes: ["/dashboard/requests"]
tools: []
keywords: ["requests", "history", "submitted", "result", "outcome", "audit", "what did I do"]
aliases: ["did it go through", "did my request work", "what have I submitted", "my history", "check my submission", "follow up required", "action required", "my requests", "did it save"]
related: ["complete-a-task", "task-blocked", "office-home", "new-job-sold"]
common_task: false
sort: 50
sources: ["src/app/dashboard/requests/page.tsx", "supabase/migrations/20260919170000_view_port_reads.sql (read_my_requests)", "supabase/migrations/20260919141000_command_core.sql (execute_command: refusal writes nothing)", "supabase/migrations/20260919149000_s17_reads_rls.sql (describe_command_result)"]
---
**My requests** lists everything you have submitted, newest first, with the result the system recorded. Use it when you are not sure whether something went through.

## Steps

1. Open **My requests** from the menu, or press **r r**.
2. Each row shows **When** you submitted it, the **Request** (for example **Complete task**, **Record call**, **Raise issue**, **Move job** or **Job sold**), the **Job** and the **Result**.
3. Click the job reference to open the job.

The list shows your newest 100 requests. You only ever see your own.

## What the results mean

- A green result means it was done.
- An amber result, such as follow-up required, means it was saved but something still needs doing. The message under it says what, and may give a next follow-up date.
- A red result means it did not work as intended. Read the message under it.

## What is not listed

If the system refused a request, nothing was saved, so it does not appear here. The refusal message is shown on screen at the time instead. If you do not see your request in the list, it did not go through: try again, or read [What to do if you can't complete a task](/help/task-blocked).

If the list is empty, it says **No requests yet**. Actions you take on jobs and tasks appear here once you make them.
