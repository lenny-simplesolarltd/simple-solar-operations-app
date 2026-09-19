---
slug: what-simplebot-can-do
title: What SimpleBot can and cannot do today
summary: The things SimpleBot can look up for you today, and the things it cannot do yet, with where to do them in the app instead.
category: simplebot
roles: []
release_function: none
routes: []
tools: ["find_job", "get_job", "get_job_tasks", "get_my_tasks", "get_team_tasks", "get_presale_workflow"]
keywords: ["simplebot", "capabilities", "what can it do", "limits", "find job", "tasks", "presale", "forms"]
aliases: ["what can simplebot do", "can simplebot complete a task", "can simplebot book a job", "can simplebot move a job", "can simplebot cancel a job", "simplebot cant do it", "simplebot limitations", "can the bot change things"]
related: ["simplebot-basics", "asking-simplebot", "simplebot-confirmations", "simplebot-permissions", "complete-a-task", "forms-overview"]
common_task: false
sort: 20
sources: ["src/features/assistant/server/tools/index.ts", "src/features/assistant/server/tools/jobs.ts", "src/features/assistant/server/tools/tasks.ts", "src/features/assistant/server/tools/presale.ts", "src/features/assistant/server/tools/forms.ts", "src/features/assistant/server/tools/files.ts", "src/features/assistant/server/tools/planned.ts", "src/features/assistant/server/system-prompt.ts", "src/features/assistant/components/assistant-panel.tsx (CapabilityList)"]
---
Today SimpleBot mainly looks things up. It cannot complete, book, move or cancel anything. The list below is what it can really do.

## What SimpleBot can do

- **Find a job** by job reference, customer name or postcode.
- **Read a job**: the customer, the sale, the system, the scope and how many tasks are open.
- **List a job's tasks**.
- **Find files**: a job's contract, photos, commissioning certificate or delivery note, or search files across jobs, with an **Open** link. Only files you are allowed to see. See [Files & documents](/help/files-library).
- **List your open tasks**, or only the overdue ones or those due today.
- **List the team's open tasks**, for one person or only the overdue ones. Only for staff who can see [Team tasks](/help/team-tasks).
- **Explain the Presale (Job Sold) workflow** step by step.
- **Answer "how do I" questions** from this Help Center. It links the guide it used so you can check it. See [Asking SimpleBot good questions](/help/asking-simplebot).

When Forms is switched on, SimpleBot can also list and read forms and responses, and prepare new forms, changes and recipient links for you to confirm. See [SimpleBot confirmations](/help/simplebot-confirmations).

## What SimpleBot cannot do yet

- Complete or reopen a task, or attach evidence. Use [Complete a task](/help/complete-a-task).
- Book a job, move a job, change the installer or cancel a job. Do these from the job's screens.
- Find a customer without a job, or summarise a job's full history.
- Explain what is blocking a job from being booked.
- Show quotes, compare quote versions, or create documents.

If you ask for one of these, SimpleBot says it cannot do it yet. It will not pretend to.

## Good to know

- SimpleBot only uses what the app tells it. If it cannot find something, it says so rather than guessing.
- It sees only what you are allowed to see. See [SimpleBot and your permissions](/help/simplebot-permissions).
- Open **What SimpleBot can do today** in a new conversation to see the current list for you.
