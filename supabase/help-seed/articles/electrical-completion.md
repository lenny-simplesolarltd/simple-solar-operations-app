---
slug: electrical-completion
title: What an electrical job needs before it can complete
summary: The checks an Electrical work package must pass before the job can be marked operationally complete, and how to clear each one.
category: commissioning
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]"]
tools: ["find_job"]
keywords: ["electrical", "sparky", "commissioning", "certificate", "EIC", "installer confirmation", "INS01", "completion", "work package", "operationally complete"]
aliases: ["electrical completion", "electrical job", "cant complete electrical", "electrical commissioning", "electrical not complete", "sparky job wont complete", "electrical commissioning not recorded", "what does electrical need", "electrics sign off", "electrical certificate missing"]
related: ["why-cant-i-complete-a-job", "record-a-call", "office-commissioning-record", "record-commissioning", "commissioning-review", "complete-a-job", "complete-a-task"]
common_task: false
sort: 40
sources: ["supabase/migrations/20260919145000_s05_booking_intake.sql (commissioning_required = trade Electrical)", "supabase/migrations/20260919146000_s10_s11_operations.sql (s10_evaluate_operational_completion; INS01 sets ConfirmedComplete)", "supabase/migrations/20260919210000_r1_completion.sql (COMMISSIONING_RECORD, header note on Electrical)", "src/features/jobs/components/operations/operations-tab.tsx (Completion checklist)", "src/features/tasks/components/task-actions.tsx (RecordCall INS01)", "supabase/migrations/20260919142000_reference_config.sql (INS01 Installer confirmation call)"]
---
Electrical work always needs commissioning. On top of the checks every job needs, an Electrical work package must have its work confirmed and its commissioning recorded before the job can be completed.

## What an Electrical work package needs

1. **The installer's work is confirmed.** Reporting the work finished on site is not enough. The office must record the **Installer confirmation call** task: press **Record call**, choose **Work complete**, and answer **Yes** to **Installer confirmed the work is finished?**
2. **Commissioning is recorded.** One of these:
   - the office uploads the certificate with **Record commissioning** on the job's **Operations** tab, or
   - the office accepts the installer's commissioning form in **Commissioning review**.

Roof work does not need commissioning, only the confirmation call.

## What the whole job also needs

- The **Customer happy call** is recorded with **Customer happy?** answered **Yes**.
- No issue that blocks completion is still open.

## How to check

Open the job and choose the **Operations** tab. The **Completion** card lists each check with a tick or a cross, including **Electrical commissioning recorded**. The **Work and commissioning** section shows the Electrical card's **Confirmed** date and **Commissioning** state.

## If you can't do it

- **Commissioning is not recorded for Electrical.** Record the certificate. See [Recording commissioning on a job](/help/office-commissioning-record).
- **Installer confirmation is missing for a required work package.** Record the installer confirmation call. A call marked **Return visit required** does not confirm the work.
- For every other reason, see [Why can't I complete this job?](/help/why-cant-i-complete-a-job).
