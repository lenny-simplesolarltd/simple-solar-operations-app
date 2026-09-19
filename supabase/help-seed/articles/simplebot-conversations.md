---
slug: simplebot-conversations
title: SimpleBot conversation history
summary: How SimpleBot saves your conversations, and how to reopen, rename, archive or delete them, or start fresh when one gets long.
category: simplebot
roles: []
release_function: none
routes: []
tools: []
keywords: ["simplebot", "history", "conversations", "chat history", "rename", "archive", "delete", "new conversation", "summary", "private"]
aliases: ["simplebot history", "old chats", "previous conversation", "find an old conversation", "delete a chat", "rename conversation", "archive conversation", "conversation too long", "start again", "can others see my chats"]
related: ["simplebot-basics", "asking-simplebot", "simplebot-permissions"]
common_task: false
sort: 60
sources: ["src/features/assistant/components/conversation-history.tsx", "src/features/assistant/components/assistant-panel.tsx (history button, New, LongConversationPrompt, summary)", "docs/assistant/ARCHITECTURE.md (Conversations: owner-only, titles, long conversations)"]
---
SimpleBot saves your conversations so you can come back to them later. Only you can see your own conversations. No other member of staff can read them, including managers.

## Opening an old conversation

1. Open **SimpleBot**.
2. Press the history button (the clock icon) next to **New**.
3. Conversations are grouped under **Today**, **Yesterday**, **Previous 7 days** and **Earlier**. Click one to open it.

Each conversation is named after your first question, led by the job reference when it was about one job.

## Renaming, archiving and deleting

Press the three dots beside a conversation, then:

- **Rename** to give it your own name, then **Save**.
- **Archive** to move it out of the way. Use **Show archived** at the bottom of the list, then **Restore** to bring it back.
- **Delete…**, then **Delete** to remove it and all its messages permanently. This cannot be undone. Nothing else in the app is changed.

## Starting fresh

Press **New** (or **New conversation** in the history) at any time.

When a conversation gets long, SimpleBot shows **This conversation is getting long**. Press **Start new conversation** to continue in a fresh one. Leave **Carry a summary into the new conversation** ticked to bring a short summary with you. The new conversation shows it under **Continuing from an earlier conversation**, and the original stays in your history. Press **Keep going** to stay where you are.

## Old answers are not current facts

An old conversation shows what was true when you asked. Ask again and SimpleBot checks the live data before relying on it.

## If you can't do it

If the history says conversations are not saved, this system is not set up to store them yet. Your conversation then lasts until you reload the page.
