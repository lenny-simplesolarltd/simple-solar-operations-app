---
slug: capacity-conflicts
title: Installer conflicts and "nothing changed" warnings
summary: What it means when an installer shows as on leave, fully booked, missing a skill or not ready, and how to fix it.
category: booking
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]/move", "/dashboard/jobs/[jobId]", "/dashboard/planner"]
tools: []
keywords: ["conflict", "capacity", "fully booked", "on leave", "office holiday", "skill", "not ready", "nothing changed", "needs review", "clash"]
aliases: ["installer conflict", "installer clash", "double booked", "installer fully booked", "installer on leave", "installer not available", "nothing changed", "nothing was saved", "not ready", "no daily capacity set", "missing this skill", "office holiday", "why cant I pick this installer"]
related: ["change-installer", "move-a-job", "staff-availability", "installer-skills", "planner-basics"]
common_task: false
sort: 70
sources: ["src/lib/backend/command.ts (NEEDS_REVIEW wording, NOTHING CHANGED)", "src/features/planner/types.ts (READINESS_REASON)", "src/features/planner/components/planner-actions.tsx (CandidatePicker hint)", "src/features/planner/components/move-job.tsx (preview)", "supabase/migrations/20260919146000_s10_s11_operations.sql (s11_validate_person, s11_capacity; R1 change installer has no skill check)", "supabase/migrations/20260919164000_r2_calendar_resourcing.sql (rp_assess_person: skill mismatch only when skills recorded)", "supabase/migrations/20260919145000_s05_booking_intake.sql (booking form: no capacity/leave/skill check)", "src/app/dashboard/skills/page.tsx (No capacity set; no edit UI for capacity)"]
---
Before an installer is given work, the system checks they are free and able. If they are not, the change is refused with the heading **NOTHING CHANGED** and one of the messages below, ending "Nothing was saved."

## Where the checks run

- **Change installer** on a job, and **Allocate**, **Change** and **Move** on the Planner. These refuse the change.
- **Move job** preview and the Planner's installer lists. These only warn, marking people **Not ready**.
- The booking form does not check at all.

## What each message means

- **That installer is on leave then** (**On leave**): they have Leave, Sick, Training or Unavailable time recorded on those dates.
- **That installer is already fully booked then** (**Already fully booked**): on a working day in the range they already have as many jobs as their daily capacity.
- **Those dates include an office holiday** (**Office holiday**): the office is closed on one of the days.
- **That installer does not have this skill** (**Missing this skill**): they have skills recorded, but not Roof or Electrical as needed. Planner only.
- **That installer has no daily capacity set** (**No daily capacity set**): their record has no daily job limit.
- **That installer is outside their available dates**: the work falls outside the period they are available to work.
- **That person is not an active installer**: they no longer have an active Installer role.

**Certification expires first** and **Apprentice – needs supervision** are warnings only.

## How to fix it

1. Choose different dates or a different installer.
2. Check [Staff availability](/help/staff-availability) for leave that is wrong or out of date.
3. Check [Installer skills](/help/installer-skills) for missing or expired skills.

## If you can't do it

Daily capacity and available dates cannot be changed on any screen yet. Ask an administrator.
