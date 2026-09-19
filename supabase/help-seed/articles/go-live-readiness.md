---
slug: go-live-readiness
title: Go-live readiness: what must be true before R1 is switched on
summary: The checklist the app evaluates before R1 goes live - audit trail, backups and recovery drills, schedules, an administrator login, task owners, consistent release modes and private files.
category: administration
roles: ["Admin", "Manager", "Director", "Office"]
release_function: none
routes: ["/dashboard/release", "/dashboard/system"]
tools: []
keywords: ["readiness", "go live", "release readiness", "checklist", "backup", "restore drill", "pg_cron", "schedules", "pilot"]
aliases: ["are we ready to go live", "what is blocking go live", "readiness failing", "why is R1 not ready", "go-live checklist"]
related: ["release-controls", "system-health"]
common_task: false
sort: 41
sources: ["supabase/migrations/20260920120000_convergence_operations.sql (app.release_readiness)", "src/features/release/readiness-card.tsx", "docs/R1_PILOT_RUNBOOK.md"]
---
The **R1 go-live readiness** card appears on **Release control** and **System health**. The app checks each condition itself; it never assumes.

## The conditions

- **Audit trail coverage**: every audited table still has its audit trigger.
- **Database backup verified**, **File storage backup verified**: someone recorded a recent check (System health, **Record a check**).
- **Database recovery tested**, **File storage recovery tested**: a restore drill was recorded.
- **Background schedules (pg_cron)**: the schedules that create installer and customer call tasks, the resilience sweep and the daily system tasks are scheduled and active.
- **An administrator can sign in**.
- **Every R1 task has an owner**: each PRE, BKG, INS, ISS and REM task template has an active owner (INS02 goes to the lead installer).
- **Release modes are consistent**: every function is off, or on in its planned mode.
- **No commits awaiting recovery**.
- **Customer files are private**.

**Unknown** means there is no evidence yet. It is not a pass.

## Also needed outside the app

The card lists conditions the app cannot check itself: invitation-only sign-in with a working email sender, an external monitor polling the health address, and the live database being fully up to date. These are part of the go-live runbook.

## What readiness does not do

It never switches anything on. Switching R1 on is a deliberate step in [Release control](/help/release-controls).
