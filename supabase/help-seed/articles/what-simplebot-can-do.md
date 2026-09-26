---
slug: what-simplebot-can-do
title: What SimpleBot can and cannot do today
summary: What SimpleBot can look up and what changes it can prepare for you to confirm, and the things it will not do, with where to do them in the app instead.
category: simplebot
roles: []
release_function: none
routes: []
tools: ["find_job", "get_job", "get_job_tasks", "get_my_tasks", "get_team_tasks", "get_presale_workflow"]
keywords: ["simplebot", "capabilities", "what can it do", "limits", "find job", "find customer", "tasks", "presale", "quote", "documents", "forms"]
aliases: ["what can simplebot do", "can simplebot complete a task", "can simplebot book a job", "can simplebot move a job", "can simplebot cancel a job", "simplebot cant do it", "simplebot limitations", "can the bot change things", "can simplebot show me a quote", "can simplebot generate a document", "can simplebot find a customer"]
related: ["simplebot-basics", "asking-simplebot", "simplebot-confirmations", "simplebot-permissions", "complete-a-task", "forms-overview", "programmes-overview"]
common_task: false
sort: 20
sources: ["src/features/assistant/server/tools/index.ts", "src/features/assistant/server/tools/jobs.ts", "src/features/assistant/server/tools/tasks.ts", "src/features/assistant/server/tools/presale.ts", "src/features/assistant/server/tools/forms.ts", "src/features/assistant/server/tools/files.ts", "src/features/assistant/server/tools/planned.ts", "src/features/assistant/server/system-prompt.ts", "src/features/assistant/components/assistant-panel.tsx (CapabilityList)"]
---
SimpleBot looks things up, and can prepare a change for you to confirm. It never changes anything on its own: nothing happens until you press **Confirm**.

## What SimpleBot can look up

- **Find a job** by reference, name or postcode.
- **Find a customer** rather than a job: by name, postcode, address, phone or email, with their details and every job of theirs you can see.
- **Read a job**: the customer, the sale, the system, the scope, its open tasks, what is holding it up, and its history.
- **List your open tasks**, or the team's. See [Team tasks](/help/team-tasks).
- **Show the quote a job is on now**: the price and what makes it up, the system size, the notes and why that version exists. **List every version**, and **compare two** line by line.
- **Show the documents the app generates** - the quotation pack and the ROI report - and whether each is waiting, being made, ready, failed or replaced.
- **Find stored files**: contracts, photos, certificates, delivery notes. See [Files & documents](/help/files-library).
- **Answer "how do I" questions** from this Help Center. See [Asking SimpleBot good questions](/help/asking-simplebot).

## Changes it can prepare for you to confirm

- **Complete, override or reopen tasks.** See [Complete a task](/help/complete-a-task).
- **Correct a customer's phone, email or contact notes**, and the enquiry's source.
- **Record a new version of a quote**, or correct the current one.
- **Generate the quotation pack or the ROI report.** It queues the work, so it is not ready the moment you confirm.
- **Attach a signed contract already on the job** to the contract task.
- **Move planned work**, **raise an issue**, **record a sale**.

When Forms or Programmes is switched on, it works in those too. See [SimpleBot confirmations](/help/simplebot-confirmations).

## What SimpleBot cannot do

- **Upload a file.** Whoever uploads a document is saying it is genuine, so that stays with you. Add it on the Files tab, then ask SimpleBot to attach it.
- **Change the system design on a quote.** Only the Presale screen recalculates that.
- **Book a job, change the installer or cancel a job.** Use the job's screens.
- **Change a customer's name or address, or a sale's agreed terms.**
- **Send anything to a customer.** Generating a document emails no one.

It says so and tells you where to go instead.

## Good to know

- SimpleBot only uses what the app tells it. If it cannot find something, it says so rather than guessing.
- It sees only what you may see. See [SimpleBot and your permissions](/help/simplebot-permissions).
- Open **What SimpleBot can do today** in a new conversation for the current list.
