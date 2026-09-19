---
slug: installation-progress
title: Working through an installation
summary: Start the work, send progress updates and report the work finished or needing a return visit from the install page.
category: installation
roles: ["Installer", "Office", "Manager", "Admin"]
release_function: FN-06
routes: ["/dashboard/installs/[workPackageId]"]
tools: []
keywords: ["start work", "progress", "finish", "complete", "return visit", "actual end", "work package", "installer", "on site", "status"]
aliases: ["start work", "start job", "start install", "progress update", "finish job", "finish install", "job done", "mark install done", "report finished", "need to go back", "return visit", "come back another day", "installer finished", "update the office"]
related: ["my-installs", "installation-photos", "report-a-problem", "record-commissioning", "why-cant-i-complete-a-job", "switched-off-features"]
common_task: true
sort: 20
sources: ["src/app/dashboard/installs/[workPackageId]/page.tsx", "src/features/installs/components/install-actions.tsx", "supabase/migrations/20260919165000_r3_installer_commissioning.sql (IW_START, IW_PROGRESS, IW_REPORT_COMPLETION, iw_package allocation/office reason rules, registry roles FN-06)", "supabase/migrations/20260919146000_s10_s11_operations.sql (INS01 confirmation call sets ConfirmedComplete)", "supabase/migrations/20260919167000_result_catalogue_r2r4.sql (R1C_ASSIGNMENT_DENIED, R1C_OFFICE_REASON_REQUIRED)"]
---
Each piece of installation work has its own page. The buttons along the top record what happens on site, and the office sees each update.

## Before you start

Open the work from [My installs](/dashboard/installs). The buttons only appear while the work is scheduled, in progress or waiting for a return visit.

## Steps

1. Press **Start work** when you arrive. The status changes to in progress.
2. During the job, press **Progress update**. Add a **Note**, a **Photo**, or both, then press **Progress update** in the window.
3. When you have finished, press **Finish**.
4. Choose the **Outcome**:
   - **All done** if the work is complete.
   - **Needs a return visit** if you must come back. Say **Why a return visit is needed**.
5. Check **Finished on**. It cannot be a future date.
6. Add a **Photo of the finished work** if you have one, then press **Finish** in the window.

## What happens next

- **All done** marks the work as reported complete. The office then rings you to confirm it. The work only counts as complete once the office has recorded that call.
- If the work needs commissioning, a commissioning form appears lower down the page. See [Recording commissioning](/help/record-commissioning).
- **Needs a return visit** tells the office, creates a new visit for the same trade, and keeps you responsible for it. The office books the new date.

## If you can't do it

- **You're not allocated to this work package.** Only the allocated installer, or office staff, can record updates.
- Office staff are asked **Why the office is recording this** and must fill it in.
- **This record changed after you opened the form.** Refresh the page and try again.
- **Not switched on yet** or **This action is switched off at the moment.** This feature may not be switched on yet. Ask an administrator.
