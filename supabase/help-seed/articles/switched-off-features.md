---
slug: switched-off-features
title: Understanding switched-off features
summary: What "switched off" and "not switched on yet" messages mean, why they are not a problem with your account, and who can switch a feature on.
category: getting-started
roles: []
release_function: none
routes: []
tools: []
keywords: ["switched off", "not switched on", "disabled", "release", "feature", "not available", "rollout", "greyed out"]
aliases: ["switched off", "not switched on yet", "this action is switched off", "feature not working", "button greyed out", "feature disabled", "why cant I use this", "not available yet", "ask an administrator", "forms missing"]
related: ["release-controls", "task-blocked", "finding-your-way-around", "system-health"]
common_task: true
sort: 60
sources: ["src/lib/backend/read-failures.ts", "src/components/read-failure.tsx", "src/features/tasks/components/task-actions.tsx (MODE_UNAVAILABLE)", "src/features/booking/components/booking-actions.tsx (MODE_UNAVAILABLE)", "src/features/forms/components/forms-not-enabled.tsx", "src/components/layout/nav-visibility.ts (forms hidden)", "supabase/migrations/20260919149000_s17_reads_rls.sql (result_message MODE)", "supabase/migrations/20260919142000_reference_config.sql (release modes seeded Disabled)", "src/app/dashboard/system/page.tsx"]
---
The system is being switched on in stages. Until a part of it is switched on, it refuses to work for everyone, whatever their role. This is not a fault and nothing is wrong with your account.

## What you might see

- A screen titled **Not switched on yet**: **This part of the system is switched off at the moment. Nothing is wrong with your account: it will work here once it has been switched on.**
- After pressing a button: **This action is switched off at the moment. Ask an administrator.**
- Under a greyed-out button: **This action is switched off at the moment.** or **Booking is switched off at the moment.**
- A menu item that is missing. For example, **Forms** does not appear in the menu at all until it is switched on.

## Which parts this affects

Each part of the system has its own switch. Among them are:

- everyday office work: completing tasks, booking, recording calls, raising issues, and moving or changing installers on jobs;
- bank deposit confirmation;
- cancellations and reinstating jobs;
- signing off a job as operationally complete;
- health monitoring and backup checks;
- the installer app, commissioning, orders, scaffold, stock and Forms.

You can usually still open and read the screens. It is the actions that are refused.

## What to do

1. Do not keep retrying. The answer will be the same until the feature is switched on.
2. Carry on with the current way of doing that work.
3. If you think a feature should already be on, ask an administrator.

## Who can switch a feature on

Admin and Manager staff can see which features are switched on, on **System health**. There is no button to change them in the app: an administrator arranges it as part of the rollout. See [Release controls](/help/release-controls).
