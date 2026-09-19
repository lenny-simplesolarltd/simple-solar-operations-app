---
slug: change-installer
title: How to change the installer on a job
summary: Replace an installer, or add another one, on a job's roof or electrical work after it has been booked.
category: booking
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/jobs/[jobId]", "/dashboard/planner"]
tools: ["find_job", "get_job"]
keywords: ["installer", "change installer", "replace", "add installer", "roofer", "electrician", "second electrician", "allocation", "team"]
aliases: ["change installer", "swap installer", "replace installer", "different installer", "add installer", "add second electrician", "change roofer", "change electrician", "reassign installer", "installer off sick"]
related: ["capacity-conflicts", "move-a-job", "book-a-job", "planner-basics", "staff-availability", "job-detail"]
common_task: true
sort: 50
sources: ["src/features/jobs/components/operations/actions.tsx (ChangeInstaller)", "src/features/jobs/components/operations/operations-tab.tsx", "src/features/jobs/components/operations/labels.ts (flagText)", "src/lib/backend/command.ts (NEEDS_REVIEW wording)", "supabase/migrations/20260919146000_s10_s11_operations.sql (cmd_change_installer, s11_validate_person, s11_capacity)", "supabase/migrations/20260919210000_r1_completion.sql (change_installer flag, authorize_command_r1)", "src/features/planner/components/planner-actions.tsx (ChangeInstallerButton, FN-01+FN-02 via 20260919164000 registry)", "docs/p0-r1-integration.md (first installer from booking form)"]
---
The first installers are chosen on the [booking form](/help/book-a-job). After that, use **Change installer** to swap someone or add another person.

## Before you start

- The job is at **Booking in progress**, **Booked**, **Awaiting installation** or **Install in progress**.
- The roof or electrical work already has an installer.

## Steps

1. Open the job and choose the **Operations** tab.
2. Under **Work and commissioning**, find the **Roof** or **Electrical** card.
3. Click **Change installer**.
4. Under **Change**, choose **Replace an installer** or **Add another installer**.
5. Choose the **Current installer** and the **New installer**.
6. Optionally set a **Role**: Lead, Second or Support.
7. Enter a **Reason** and confirm.

## What happens next

The new installer is checked for the work's dates. If they are fine you see "Installer changed." When you replace someone, their booking on this work is removed.

If the new installer cannot do it, you see **NOTHING CHANGED** and the reason, for example "That installer is on leave then". See [Capacity conflicts](/help/capacity-conflicts).

> **Note:** The **Change** button on the Planner does the same job and also checks skills. It needs an extra planning feature to be switched on.

## If you can't do it

Hover over the greyed-out button to see why:

- **Only once the job is booked.** The job is at the wrong stage.
- **No installer is allocated yet.**
- **Paused while a cancellation or reopen review is open.**
- **You’re not assigned to this job.** Admins and Managers can act on any job.
- **Switched off for this release. An administrator turns it on.** This feature may not be switched on yet. Ask an administrator.
