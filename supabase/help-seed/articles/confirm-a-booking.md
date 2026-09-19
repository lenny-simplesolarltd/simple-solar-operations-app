---
slug: confirm-a-booking
title: How to confirm a booking
summary: Move a job from Booking in progress to Booked once every booking check passes.
category: booking
roles: ["Admin", "Manager", "Office"]
release_function: FN-01
routes: ["/dashboard/booking", "/dashboard/jobs/[jobId]/booking"]
tools: ["find_job", "get_job"]
keywords: ["confirm", "booked", "approve booking", "booking in progress", "confirm booking"]
aliases: ["confirm booking", "confirm a booking", "approve booking", "mark as booked", "finish booking", "book it in", "booking approval"]
related: ["booking-checks", "booking-queue", "book-a-job", "job-stages", "change-installer", "move-a-job"]
common_task: true
sort: 40
sources: ["src/features/booking/components/booking-actions.tsx (ConfirmBookingButton, REASON wording)", "src/features/booking/components/booking-board.tsx (In progress tab)", "src/app/dashboard/jobs/[jobId]/booking/page.tsx", "supabase/migrations/20260919210000_r1_completion.sql (authorize_command_r1 CONFIRM_BOOKING: Admin/Manager/Office, FN-01)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_confirm_booking, BKG04/BKG05)", "supabase/migrations/20260919142000_reference_config.sql (BKG04/BKG05 titles)", "supabase/migrations/20260919149000_s17_reads_rls.sql (success and refusal wording)"]
---
Confirming a booking moves a job from **Booking in progress** to **Booked**. It is the office's final approval.

## Before you start

- The booking form has been submitted, so the job is at **Booking in progress**.
- Every booking check passes. See [What the booking checks mean](/help/booking-checks).

## Steps

1. Open **Booking** and choose the **In progress** tab, or open the job's booking form.
2. Click **Confirm booking**.
3. Read the dialog. It lists any checks still failing, or says **All booking checks pass**.
4. Click **Confirm booking** in the dialog.

## What happens next

You see "Booking confirmed. The customer email and calendar checks are now on the job." The job is now **Booked**, you are recorded as the approver, and two tasks are created: **Send customer booking email** and **Check calendar events and document pack**.

There is no undo. To change dates or installers afterwards, use [Move a job](/help/move-a-job) or [Change installer](/help/change-installer).

## If you can't do it

The button is greyed out when it cannot be used. Hover over it to see why:

- **Only office managers can confirm bookings.** Only Admin, Manager and Office staff can confirm.
- **Some booking checks are still outstanding.** Finish them and click **Re-check**.
- **You are not assigned to this job.** Admins and Managers can confirm any job; others must be assigned to it, for example by owning a task on the job.
- **The job is cancelled or archived.**
- **Booking is switched off at the moment.** This feature may not be switched on yet. Ask an administrator.
