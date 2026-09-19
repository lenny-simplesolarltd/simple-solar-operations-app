---
slug: release-controls
title: Release control: switching parts of the system on and off
summary: How Admin and Manager staff see which parts of the system are switched on, check go-live readiness, and switch a function on or off with a reason.
category: administration
roles: ["Admin", "Manager", "Director"]
release_function: none
routes: ["/dashboard/release", "/dashboard/system"]
tools: []
keywords: ["release control", "release modes", "release functions", "switch on", "switch off", "enable", "feature switch", "disabled", "manual", "automated", "scope", "pilot", "readiness", "go live"]
aliases: ["switch a feature on", "turn on a feature", "enable feature", "release mode", "why is everything switched off", "feature flags", "go live", "which features are on", "is R1 ready", "turn off a feature"]
related: ["switched-off-features", "system-health", "staff-roles", "go-live-readiness"]
common_task: false
sort: 40
sources: ["src/app/dashboard/release/page.tsx", "src/features/release/release-actions.tsx", "src/features/release/readiness-card.tsx", "supabase/migrations/20260920120000_convergence_operations.sql (RELEASE_MODE_SET, RELEASE_CONTROL, app.release_readiness)", "supabase/migrations/20260919142000_reference_config.sql (FN-01..FN-20 seeded Disabled)", "supabase/migrations/20260919190000_forms.sql (FN-21)"]
---
Parts of the system are controlled by release functions (FN-01, FN-02 ...). A switched-off function refuses to work for everyone, whatever their role. **Release control** is the only place they are switched on or off.

## Opening it

Open **Release control** from the **Admin** menu. Admin and Manager staff can switch functions. Directors can see the page but not change it.

## What the page shows

- **R1 go-live readiness** at the top: each condition that must be met before R1 is switched on, marked **Pass**, **Fail** or **Unknown**. Unknown is never a pass. See [Go-live readiness](/help/go-live-readiness).
- Every function grouped by release (R1 to R4), with its mode (**Off**, or **Manual** / **Automated** with **Pilot** or **All**), its planned mode, what it needs and what it works with, and the last change: when, by whom and why.

## Switching a function on

1. Press **Switch on** next to the function.
2. Choose the **Scope**: **Pilot jobs only** or **All jobs**.
3. Write the **Reason** (who approved it and why) and confirm.

A function only ever runs in its planned mode. Functions that depend on the office core (FN-01) can only be switched on after FN-01. The button tells you when that is the case.

## Switching a function off

Press **Switch off**, write the reason and confirm. Its actions are refused from then on and its schedules do nothing. Records already made stay. FN-01 cannot be switched off while other functions that need it are on.

## What staff see while a function is off

Screens say **Not switched on yet**, and buttons say the action is switched off. See [Understanding switched-off features](/help/switched-off-features).
