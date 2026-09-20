---
slug: system-health
title: System health
summary: What the System health screen shows, what Verified, Stale, Failed and Unknown mean, and how to record a backup or recovery check.
category: administration
roles: ["Admin", "Manager", "Director", "Office"]
release_function: FN-14
routes: ["/dashboard/system"]
tools: []
keywords: ["system health", "backup", "restore", "recovery", "health check", "integrations", "calendar sync", "verified", "stale", "unknown", "operational evidence"]
aliases: ["is the system working", "backup check", "record backup", "restore test", "recovery drill", "integrations to review", "calendar sync problem", "system status", "health page", "what does stale mean", "what does unknown mean"]
related: ["release-controls", "switched-off-features", "staff-roles", "office-home"]
common_task: false
sort: 30
sources: ["src/app/dashboard/system/page.tsx", "src/features/system/components/system-actions.tsx", "src/features/system/operational-health.ts", "src/components/layout/nav-visibility.ts (systemHealth)", "docs/OPERATIONAL_HEALTH.md (states and thresholds)", "supabase/migrations/20260919220000_p0_r1_integration.sql (SYSTEM_STATUS roles)", "supabase/migrations/20260919202100_p0_operational_health.sql (OPS_EVIDENCE_RECORD roles, FN-14)", "supabase/migrations/20260919164000_r2_calendar_resourcing.sql (CALENDAR_REVIEW_RESOLVE roles)"]
---
**System health** shows whether the system's background checks are running, whether backups have been checked, and anything waiting for a person to decide. Admin, Manager, Office and Director staff can open it.

## What you see

- **Health**: the latest background health check and how long ago it ran.
- **Not configured yet**: parts of the system that have not been set up.
- **Operational evidence**: one line per check, such as **Database backup verified** and **Database recovery tested**, each with a state.
- **Integrations needing a decision**: messages to other systems where the result is uncertain.
- **Calendar sync** (Admin, Manager and Office): calendar entries that need a decision.
- **Release modes** (Admin and Manager only): which parts of the system are switched on. See [Release controls](/help/release-controls).

## What the states mean

- **Verified**: recent proof exists.
- **Stale**: the proof is too old to rely on. A backup check older than 8 days, or a recovery test older than 90 days, becomes Stale.
- **Failed**: the check ran and did not pass.
- **Unknown**: there is no proof. Unknown is not a pass.

Backups are made by the hosting company. The app only records that a person checked them.

## Recording a backup or recovery check

Admin, Manager and Director staff can do this.

1. Press **Record a check** on **Operational evidence**.
2. Choose **What was checked** and the **Result**.
3. Fill in **When you checked**, **How it was checked** and **Where the proof is kept**. Never paste passwords or keys.
4. Save. The line shows your name and the date.

## Resolving an integration item

Admin, Manager and Office staff can press **Resolve**. Check the other system first, then choose **Try again**, **It did happen** or **Cancel it**, and give a reason.

## If you can't do it

**Record a check** is greyed out while health monitoring is switched off, and resolving an integration item is refused. This feature may not be switched on yet. Ask an administrator.
