---
slug: asking-simplebot
title: Asking SimpleBot good questions
summary: How to word questions so SimpleBot finds the right job or task first time, and how it answers "how do I" questions.
category: simplebot
roles: []
release_function: none
routes: []
tools: ["find_job", "get_job", "get_job_tasks", "get_my_tasks", "get_team_tasks"]
keywords: ["simplebot", "questions", "ask", "how do I", "examples", "prompts", "this job", "wording"]
aliases: ["how do I ask simplebot", "what should I ask", "example questions", "simplebot got it wrong", "simplebot cant find the job", "simplebot doesnt understand", "how do I questions", "help with simplebot"]
related: ["simplebot-basics", "what-simplebot-can-do", "simplebot-conversations", "simplebot-permissions", "searching"]
common_task: false
sort: 30
sources: ["src/features/assistant/server/system-prompt.ts", "src/features/assistant/suggestions.ts", "src/features/assistant/components/assistant-panel.tsx", "src/features/assistant/server/tools/jobs.ts", "src/features/assistant/server/tools/tasks.ts"]
---
SimpleBot understands plain English. A few habits help it find the right thing first time.

## Questions that work well

- "Find the job for postcode BS1 4DJ" or "Find Mrs Patel's job".
- "What tasks are open on SS-ABCD-1234?"
- "Show my overdue tasks" or "What's due today?"
- "What is Tanya working on?" (if you can see team tasks)
- "Explain the Presale workflow."

## Tips

- **Use a reference, name or postcode.** These are what SimpleBot searches by.
- **Say "this job" when you are on a job.** SimpleBot knows which page you are viewing. It also remembers the last job it showed you in the conversation.
- **Expect a question back.** If several jobs match a name, SimpleBot shows the matches and asks which one you mean.
- **"Not found" may mean no access.** SimpleBot only sees what you can see, so it will say it could not find a job you have access to.
- **Ask again for up-to-date facts.** Earlier answers in a conversation show what was true then. Ask again and SimpleBot checks the live data.

## "How do I" questions

Ask SimpleBot how to do something, for example "How do I reopen a task?". It answers from the guides in this Help Center and links to the guide, so you can follow the steps yourself.

## What SimpleBot will not do

It will not guess a status, date, name or amount it could not look up. If its tools cannot answer, it tells you. It also cannot yet complete, book, move or cancel anything: see [What SimpleBot can and cannot do](/help/what-simplebot-can-do).

## If you can't do it

If an answer looks wrong, check it on the job itself and ask again with the job reference.
