---
slug: programme-board
title: Using the programme board
summary: How the programme board's columns work, how to move a property by dragging or from the keyboard, and why only the office can finish one.
category: programmes
roles: ["Admin", "Manager", "Director", "Office"]
release_function: FN-22
routes: ["/dashboard/operations/programmes/[programmeId]/board", "/dashboard/operations/programmes/[programmeId]/properties"]
tools: ["programme_visit_search", "programme_visit_get", "programme_review_visit"]
keywords: ["board", "columns", "drag", "drop", "move", "awaiting review", "no access", "action required", "complete and working", "inbox", "kanban"]
aliases: ["programme board", "move a card", "drag a property", "board columns", "kanban board", "cant move a card", "board wont let me", "load more on the board"]
related: ["programmes-overview", "review-a-programme-visit", "record-a-programme-visit", "programme-reports"]
common_task: true
sort: 30
sources: ["src/features/programmes/components/board.tsx", "src/features/programmes/labels.ts", "src/app/dashboard/operations/programmes/[programmeId]/board/page.tsx"]
---
The board shows where every visited property has got to, one column per state.

## The columns

- **Awaiting review**: sent in by the installer, not yet checked by the office.
- **No access — rebook**: nobody in. Needs another appointment.
- **Action required**: something has to be done before the property is finished.
- **Meter requires changing**: the meter itself has to be replaced.
- **Complete & working**: confirmed live and reporting in the client's portal. Nothing further to do.

Each column header states its real size, which is usually larger than the cards shown. **Load more** brings in the next batch, and **see all** opens the full list with the same filters applied.

## Moving a property

Drag a card into another column. Dragging is only a shortcut: every card is also a link to its review screen, and each one has a **Move** menu you can reach with the keyboard, so the board works one-handed or without a mouse. All three do exactly the same thing and are recorded the same way.

Moving a card to **Complete & working** asks you to confirm the meter is live in the client's portal first. If it is not, the move is refused. A good signal reading at the door is not the same as the meter reporting, and the whole point of the last column is that it only holds properties somebody has actually checked.

## Filters

The board carries whatever you have filtered by, such as the installer, the date or the review state, so you can work through one person's day without losing your place. Clearing a filter reloads every column.

## If you can't do it

- Cards will not drag: your role can view the board but not change it. Directors see everything and change nothing.
- **Confirm the meter is live/reporting in the portal first**: check the portal, then review the visit properly rather than moving the card.
- A column looks short: press **Load more**, or open **see all**.
