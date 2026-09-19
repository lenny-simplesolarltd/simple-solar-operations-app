---
slug: simplebot-confirmations
title: SimpleBot confirmations: nothing changes until you press Confirm
summary: How SimpleBot's confirmation cards work, why nothing changes until you confirm, and what to do when a proposal has expired.
category: simplebot
roles: []
release_function: none
routes: []
tools: []
keywords: ["simplebot", "confirm", "confirmation", "proposal", "card", "cancel", "expired", "change", "safe"]
aliases: ["simplebot changed something", "did simplebot change it", "confirm button", "proposal expired", "needs your confirmation", "cancel simplebot change", "can simplebot make changes", "simplebot said done"]
related: ["what-simplebot-can-do", "simplebot-permissions", "simplebot-basics", "forms-overview"]
common_task: false
sort: 40
sources: ["src/features/assistant/components/action-card.tsx", "src/features/assistant/server/confirm.ts", "src/features/assistant/server/pending-actions.ts (PENDING_ACTION_TTL_MS = 10 minutes)", "src/features/assistant/server/system-prompt.ts (Changing things)", "src/features/assistant/server/tools/forms.ts (confirmLabel values)", "src/features/assistant/server/tools/index.ts (Forms tools only while FN-21 is on)"]
---
SimpleBot never changes anything by itself. When it can make a change for you, it only prepares a proposal and shows it as a card. Nothing happens unless you press the button on the card. Typing "yes, go ahead" is not enough.

Today the only changes SimpleBot can prepare are for Forms, such as creating a form or a recipient link. These only work once Forms is switched on.

## Reading the card

- The card is headed **Needs your confirmation** and names the change.
- It lists what will change, with old values crossed out and the new value beside them.
- Any warnings are shown in amber.
- At the bottom it says **No changes have been made yet** and when the proposal expires.

## Steps

1. Read the card carefully.
2. Press the confirm button. It is labelled for the change, for example **Save draft**, **Publish** or **Create link**.
3. Or press **Cancel**. You see **Cancelled. Nothing was changed.**

## What happens next

- **Done.** means the change was made, as you, with your permissions.
- The card then reads **Proposed change** and cannot be used again.

## If you can't do it

- **This proposal has expired. Ask SimpleBot to prepare it again.** Proposals last 10 minutes.
- **This proposal has already been confirmed or cancelled. It was not run again.**
- **This proposal was prepared for a different staff member.** Only the person SimpleBot prepared it for can confirm it.
- A refusal about permissions means your role cannot make that change. SimpleBot checks your access again when you press confirm.

This feature may not be switched on yet. Ask an administrator.
