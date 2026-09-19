---
slug: simplebot-basics
title: What SimpleBot is and how to open it
summary: SimpleBot is the assistant built into the app. How to open it, ask a question and use what it finds.
category: simplebot
roles: []
release_function: none
routes: ["/dashboard"]
tools: ["find_job", "get_my_tasks"]
keywords: ["simplebot", "assistant", "chat", "bot", "ai", "ask", "help"]
aliases: ["simplebot", "simple bot", "the bot", "assistant", "chatbot", "ai helper", "open the assistant", "ask a question", "how do I use simplebot", "simplebot not working", "simplebot isnt switched on"]
related: ["what-simplebot-can-do", "asking-simplebot", "simplebot-confirmations", "simplebot-permissions", "simplebot-conversations"]
common_task: true
sort: 10
sources: ["src/features/assistant/components/assistant-trigger.tsx", "src/features/assistant/components/assistant-panel.tsx", "src/features/assistant/components/assistant-drawer.tsx", "src/features/assistant/suggestions.ts", "src/components/layout/header.tsx", "src/app/api/assistant/capabilities/route.ts", "src/features/assistant/server/providers/index.ts"]
---
SimpleBot is the assistant built into Simple Solar Operations. You ask it questions in plain English, and it looks things up in the app with your access, so you do not have to leave the screen you are on.

## Opening SimpleBot

1. Press **SimpleBot** at the top right of any screen. On a phone it shows only the sun icon.
2. The panel opens beside the page. Under the heading, **Viewing** shows the page you are on, for example a job reference. SimpleBot uses this to understand "this job".
3. Press the cross, press **SimpleBot** again, or press **Esc** to close it. Your conversation is kept.

## Asking a question

1. Type in the box marked **Ask about a job, a customer or your tasks**.
2. Press **Enter** (or the send button) to send. Use **Shift+Enter** for a new line. Press the stop button if you change your mind while it is working.
3. Or press one of the suggestions under **Try from here**, such as **Show my overdue tasks** or **Summarise this job**.

SimpleBot shows what it finds as cards, such as a job card with a **View job** link, or a list of tasks. It then adds a short answer.

Press **New** to start a fresh conversation.

## Checking what it can do

On a new conversation, open **What SimpleBot can do today**. It lists what SimpleBot can do for you, and what is **Not available yet**. See [What SimpleBot can and cannot do](/help/what-simplebot-can-do).

## If you can't do it

- **SimpleBot isn't switched on yet.** It has not been set up on this system. Ask an administrator.
- **SimpleBot could not load.** Close and reopen it.
- Always check important facts on the job itself before acting on them.
