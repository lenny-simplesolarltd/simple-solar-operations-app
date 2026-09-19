---
slug: planner-basics
title: Using the Planner
summary: See installs and scaffold in date order or by installer, spot unallocated work, and allocate, change or move work from a row.
category: planning
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01, FN-02
routes: ["/dashboard/planner"]
tools: ["find_job"]
keywords: ["planner", "schedule", "diary", "calendar", "3 weeks", "6 weeks", "team board", "allocate", "unallocated", "week view"]
aliases: ["planner", "install planner", "schedule", "diary", "who is working when", "installer diary", "team board", "3 week planner", "6 week planner", "allocate installer", "unallocated work", "what is booked this week"]
related: ["move-a-job", "change-installer", "capacity-conflicts", "scaffold-bookings", "staff-availability", "installer-skills"]
common_task: true
sort: 10
sources: ["src/app/dashboard/planner/page.tsx", "src/features/planner/components/planner-list.tsx", "src/features/planner/components/planner-actions.tsx (Allocate / Change / Move -> PLAN_WORK_PACKAGE, CHANGE_INSTALLER_R2, MOVE_WORK_PACKAGE)", "src/features/planner/components/team-board.tsx (read-only)", "supabase/migrations/20260919164000_r2_calendar_resourcing.sql (registry: FN-01 + FN-02 Automated, office class)", "src/constants/data.ts (Planner, access resourcing)"]
---
The **Planner** shows installs and scaffold in date order. Open it from **Planner** in the **Planning** menu.

## Views

- **3 weeks** and **6 weeks**: a list grouped by **Week of** date. Each row shows the dates, the job number, the trade and status, and the installer and their role. Work with nobody on it shows **Unallocated**.
- Scaffold rows show **Scaffold up**, **Scaffold down** or **Scaffold down (forecast)**, the scaffolder and status. **Not acknowledged** means the scaffolder has not confirmed yet. Click **booking** to open the scaffold booking.
- **Team board**: installers down the side, days across, grouped by team. Leave shows in amber. Work with nobody allocated is listed underneath. The board is for viewing only.

Click a job number to open the job.

## Changing work from a row

Office staff see buttons on each row:

1. **Allocate** on an unallocated row: choose **Start**, **End**, an installer and a **Role**.
2. **Change** on an allocated row: replace the installer or add a second one, with a **Reason**.
3. **Move** on an allocated row: new **Start** and **End** for that work only, with a **Reason**. The installer moves with it.

The installer list shows each person as **Free** or **Not ready**, with the reason. You can still pick someone who is not ready, but the system will refuse it and say why. See [Capacity conflicts](/help/capacity-conflicts).

To move several trades or the scaffold together, use [Move job](/help/move-a-job) from the job instead.

## If you can't do it

- **Allocate**, **Change** and **Move** on the Planner need a planning feature that is separate from the job screens. This feature may not be switched on yet. Ask an administrator.
- While it is off, use **Change installer** and **Move job** from the job itself.
- You must be assigned to the job, unless you are an Admin or Manager.
