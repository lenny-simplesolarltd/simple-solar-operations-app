---
slug: release-controls
title: Release controls: seeing which features are switched on
summary: Where Admin and Manager staff can see which parts of the system are switched on, and how a feature gets switched on today.
category: administration
roles: ["Admin", "Manager"]
release_function: none
routes: ["/dashboard/system"]
tools: []
keywords: ["release modes", "release functions", "switch on", "switch off", "enable", "feature switch", "disabled", "manual", "automated", "scope"]
aliases: ["switch a feature on", "turn on a feature", "enable feature", "release mode", "why is everything switched off", "feature flags", "go live", "which features are on"]
related: ["switched-off-features", "system-health", "staff-roles"]
common_task: false
sort: 40
sources: ["src/app/dashboard/system/page.tsx (Release modes table, 'changed by an administrator in the database')", "supabase/migrations/20260919220000_p0_r1_integration.sql (RELEASE_MODE_STATUS Admin/Manager only)", "supabase/migrations/20260919149000_s17_reads_rls.sql (release_modes policies)", "supabase/migrations/20260919142000_reference_config.sql (FN-01..FN-20 seeded Disabled)", "supabase/migrations/20260919190000_forms.sql (FN-21)", "supabase/migrations/20260919141000_command_core.sql (mode_available)"]
---
Parts of the system are controlled by release switches. A switched-off part refuses to work for everyone, whatever their role. Admin and Manager staff can see the switches, but there is no screen to change them yet.

## Seeing the switches

1. Open **System health** from the **Admin** menu.
2. Scroll to **Release modes**. Each row shows:
   - **Function**: the part of the system, with its number, for example office core and tasks, bank deposit confirmation or Forms.
   - **Release**: the stage of the rollout it belongs to.
   - **Mode**: **Disabled** (switched off), **Manual** (switched on, with people doing the work) or **Automated** (switched on, with the system doing more of the work).
   - **Scope**: which jobs it applies to. **None** means no jobs.

A function only counts as switched on when its mode is the one that part of the system needs and its scope covers the job.

## Switching a feature on

There is no button for this in the app. The screen says: **Release modes are changed by an administrator in the database.** Switching on a feature is a planned rollout decision, so ask the person who manages the system to arrange it. Changes are recorded in the audit trail.

## What staff see while a feature is switched off

Screens say **Not switched on yet**, and buttons say **This action is switched off at the moment. Ask an administrator.** See [Understanding switched-off features](/help/switched-off-features).

## If you can't do it

**Release modes** only appears for Admin and Manager staff.
