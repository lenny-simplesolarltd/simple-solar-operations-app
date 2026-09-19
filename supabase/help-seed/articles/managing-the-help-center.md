---
slug: managing-the-help-center
title: Writing and updating Help Center guides
summary: How office staff draft guides, and how managers publish, check and archive them. SimpleBot uses the published version straight away.
category: administration
roles: ["Admin", "Manager", "Office"]
release_function: none
routes: ["/dashboard/help/manage", "/dashboard/help/manage/[id]", "/dashboard/help/manage/new"]
tools: []
keywords: ["edit", "publish", "article", "guide", "draft", "archive", "review", "history", "documentation"]
aliases: ["edit help", "edit a guide", "write a guide", "update instructions", "publish article", "change help text", "fix a guide", "help article wrong", "archive guide", "help health", "manage articles"]
related: ["using-the-help-center", "staff-roles", "simplebot-basics"]
common_task: false
sort: 90
sources: ["supabase/migrations/20260920100000_help_center.sql (help.edit Admin/Manager/Office, help.publish Admin/Manager, revisions, health)", "src/features/help/components/article-editor.tsx", "src/app/dashboard/help/manage/page.tsx"]
---
Guides can be changed in the app at any time. Nothing needs to be installed. Office staff write drafts. A manager or administrator publishes them.

## Steps

1. Open **Help Center** and click **Manage articles**.
2. Open a guide, or click **New article**.
3. Change the text under **Write**. Click **Preview** to see it as staff will.
4. Under **Search words, audience and links**, add the phrases staff really use, such as "reschedule" or "customer cancelling". Tick roles only if the guide is just for them.
5. Click **Save draft**. Staff and SimpleBot still see the published version.
6. A manager or administrator clicks **Publish**. The new version is live straight away, for staff and for SimpleBot.

## Writing a good guide

- Short sentences and numbered steps.
- Use the exact button and menu names, in **bold**.
- Say what happens afterwards, and why someone might not be able to do it.
- Only describe what the app does today.

## Checking, archiving and history

- **Mark as checked** records that a published guide is still correct. Guides not checked for six months are listed under **Help health**.
- **Archive** hides a guide from staff and SimpleBot. **Restore** brings it back.
- **History** keeps every version, who made it and when. **Copy this version into the draft** brings back older wording. Publish it to make it live.

**Help health** on the Manage page also lists guides that link to missing guides, name a screen that no longer exists, or have unpublished changes.

## If you can't do it

- Only Admin, Manager and Office staff can edit guides. Only Admin and Manager can publish, archive or restore.
- "Someone else changed this article while you were editing" means you need to reload and make your change again.
- The web address of a published guide cannot change, because other guides and SimpleBot link to it.
