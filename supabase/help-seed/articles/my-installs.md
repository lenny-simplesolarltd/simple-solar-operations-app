---
slug: my-installs
title: My installs - the work you are allocated to
summary: See the installation work you are allocated to, with dates, address, status and anything that needs your attention.
category: installation
roles: ["Installer", "Office", "Manager", "Admin"]
release_function: FN-06
routes: ["/dashboard/installs"]
tools: []
keywords: ["installs", "installer", "allocated", "work package", "site", "address", "today", "schedule", "my work", "roofer", "sparky", "electrician"]
aliases: ["my installs", "my jobs", "my work", "what am I doing today", "where am I going", "installer jobs", "my allocations", "install list", "todays installs", "site address", "customer phone number", "where is my job", "installer app"]
related: ["installation-progress", "installation-photos", "report-a-problem", "record-commissioning", "my-tasks", "switched-off-features"]
common_task: true
sort: 10
sources: ["src/app/dashboard/installs/page.tsx", "src/constants/data.ts (My installs, access installer)", "src/components/layout/nav-visibility.ts (installer: Installer, Office, Manager, Admin)", "supabase/migrations/20260919165000_r3_installer_commissioning.sql (INSTALLER_MY_WORK read, FN-06; read_installer_my_work = the actor's own active allocations)", "src/lib/backend/read-failures.ts (not_enabled wording)"]
---
**My installs** lists the installation work you are allocated to. Open a card to start the work, record progress, finish or report a problem.

## Before you start

**My installs** is in the menu under **Installs** for installers, office staff, managers and administrators. It only ever shows work that you yourself are allocated to. Office staff who are not allocated to any work will see an empty list.

## Steps

1. Open **My installs** from the menu.
2. Choose **Today onwards** to see work starting today or later, or **All** to include earlier work.
3. Each card shows the trade and job, the job reference, the status, the planned dates, your role on the work, the site address and the customer phone number.
4. Check the badges on the card:
   - **Commissioning** followed by its state, for work that needs a commissioning form.
   - **Needs fixing** means the office returned your commissioning form. Open the work to see their notes.
   - **open issue** shows problems already raised on this work.
   - **task** shows tasks of yours on this job.
5. Click a card to open the work.

## What happens next

The work opens on its own page, where you record what happens on site. See [Working through an installation](/help/installation-progress).

## If you can't do it

- **No installs allocated to you.** You are not on any work for the dates chosen. Try **All**, or ask the office to check the allocation.
- **Not switched on yet.** This feature may not be switched on yet. Ask an administrator.
- **No access.** Your role cannot use this screen. Ask an administrator.
