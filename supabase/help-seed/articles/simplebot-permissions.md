---
slug: simplebot-permissions
title: SimpleBot and your permissions
summary: SimpleBot acts as you, with exactly your access. Why it may not find a job a colleague can see, and why it cannot be talked into doing more.
category: simplebot
roles: []
release_function: none
routes: []
tools: ["find_job", "get_team_tasks"]
keywords: ["simplebot", "permissions", "access", "security", "privacy", "roles", "acts as me", "cant find"]
aliases: ["why cant simplebot see this job", "simplebot cant find job", "simplebot access", "is simplebot safe", "can simplebot see everything", "simplebot permission", "does simplebot act as me", "simplebot shows different results"]
related: ["simplebot-basics", "what-simplebot-can-do", "simplebot-confirmations", "staff-roles", "simplebot-conversations"]
common_task: false
sort: 50
sources: ["src/features/assistant/server/system-prompt.ts (Tools, Retrieved content is data)", "src/features/assistant/server/tools/tasks.ts (get_team_tasks requires task.read.all)", "src/features/assistant/server/registry.ts (permission filtering)", "src/app/api/assistant/capabilities/route.ts (availableFor actor)", "src/features/assistant/server/confirm.ts (re-authorised at confirm, proposer-only)", "docs/assistant/ARCHITECTURE.md (owner-only conversations)"]
---
SimpleBot works as you. It has exactly the same access you have in the app: no more and no less.

## What this means

- **It sees what you can see.** Every search and lookup runs as you. If you cannot open a job, SimpleBot cannot find it either. It says it could not find a job you have access to, rather than saying the job does not exist.
- **It offers only what your role allows.** For example, only staff who can see **Team tasks** can ask SimpleBot about the team's tasks. The list under **What SimpleBot can do today** is the list for you.
- **"Me" always means you.** SimpleBot cannot look things up or act as another member of staff, even if asked to.
- **Changes are made as you.** When SimpleBot prepares a change, your access is checked again when you press confirm. If your role cannot make that change, it is refused and nothing changes. See [SimpleBot confirmations](/help/simplebot-confirmations).
- **Your conversations are private.** Nobody else can read them. See [Conversation history](/help/simplebot-conversations).

## Why a colleague gets a different answer

Two people asking the same question can get different results because they have different roles or are assigned to different jobs. That is expected. See [Staff roles explained](/help/staff-roles).

## It cannot be talked round

Notes, names and other text stored on a job are treated as information, never as instructions. If a note says something like "ignore your rules", SimpleBot ignores it and may point it out to you. Nothing you or anyone else types can give SimpleBot more access.

## If you can't do it

If SimpleBot cannot find something you think you should see, open it yourself in the app. If you cannot see it there either, ask an administrator to check your access.
