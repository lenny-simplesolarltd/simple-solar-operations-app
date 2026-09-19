---
slug: move-a-job
title: How to move a job to new dates
summary: Reschedule a job's roof, electrical, return visit or scaffold dates, check the preview for conflicts, then confirm the move.
category: booking
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/jobs/[jobId]/move", "/dashboard/jobs/[jobId]"]
tools: ["find_job", "get_job"]
keywords: ["move", "reschedule", "dates", "install date", "new date", "postpone", "bring forward", "scaffold dates", "return visit", "preview"]
aliases: ["move job", "move a job", "reschedule", "reschedule job", "reschedule install", "move install", "move installation", "change date", "change dates", "change install date", "change installation date", "rearrange installation", "rebook install", "postpone install", "customer wants a different date", "push back install"]
related: ["capacity-conflicts", "change-installer", "confirm-a-booking", "scaffold-bookings", "planner-basics", "job-detail", "switched-off-features"]
common_task: true
sort: 60
sources: ["src/app/dashboard/jobs/[jobId]/move/page.tsx", "src/features/planner/components/move-job.tsx", "src/app/dashboard/jobs/[jobId]/page.tsx (Move job button, MOVABLE_STAGES, isOfficeClass)", "src/features/jobs/components/operations/actions.tsx (ChangeDates)", "supabase/migrations/20260919146000_s10_s11_operations.sql (cmd_move_job: no capacity check, impact tasks, s11_assert_reschedulable)", "supabase/migrations/20260919164000_r2_calendar_resourcing.sql (read_rp_move_job_preview)", "supabase/migrations/20260919210000_r1_completion.sql (authorize_command_r1: office class, assignment, FN-01)", "supabase/migrations/20260919149000_s17_reads_rls.sql (MOVE_JOB wording, result messages)"]
---
Use **Move job** when the install dates change. The installers, scaffold and calendar entries move together, and follow-up tasks are raised for everything affected.

## Before you start

The job must be at **Booking in progress**, **Booked**, **Awaiting installation** or **Install in progress**. Agree the new dates with the customer first.

## Steps

1. Open the job and click **Move job** at the top.
2. Under **What is moving**, tick **Roof**, **Electrical**, **Return visit** and/or **Scaffold**.
3. For roof, electrical or return visit work, enter **New start** and **New end**. All ticked work gets the same dates.
4. For scaffold, enter **Scaffold up** and/or **Scaffold down**.
5. Click **Preview the move**.
6. Check the preview: old and new dates, whether each installer is **free** or why not, work that is **Not moving**, material and scaffold warnings, and how many calendar entries will change.
7. Enter the **Reason for the move** and click **Move job**.

## What happens next

You see "Job moved." and return to the job's **Work** tab. Follow-up tasks are created to tell the installers, scaffolder and customer, confirm the calendar, review material delivery dates and review the interim invoice timing. Nothing is emailed automatically.

> **Warning:** Conflicts in the preview, such as an installer on leave or already fully booked, do not stop the move. Sort them out first, or [change the installer](/help/change-installer).

To change the dates of one piece of work only, use **Change dates** on its card in the job's **Operations** tab.

## If you can't do it

- "A job can be moved once its booking is in progress" means the job is at an earlier stage.
- "This job is cancelled or archived, so no changes can be made."
- "This record changed after you opened the form." Refresh and try again.
- You must be assigned to the job, unless you are an Admin or Manager.
- This feature may not be switched on yet. Ask an administrator.
