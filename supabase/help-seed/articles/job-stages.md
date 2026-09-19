---
slug: job-stages
title: Job stages explained
summary: What each job stage means, in order, and what moves a job from one stage to the next.
category: jobs
roles: []
release_function: none
routes: ["/dashboard/jobs", "/dashboard/jobs/[jobId]"]
tools: ["get_job"]
keywords: ["stage", "status", "workflow stage", "prebooking", "ready to book", "booking in progress", "booked", "operationally complete", "cancelled"]
aliases: ["job status", "what stage is the job", "what does prebooking mean", "what does booked mean", "stages", "job stage meaning", "operationally complete meaning", "cancellation in progress", "why is job still prebooking"]
related: ["ready-to-book", "presale-workflow", "book-a-job", "confirm-a-booking", "why-cant-i-complete-a-job", "cancel-a-job", "reinstate-a-job"]
common_task: false
sort: 30
sources: ["src/features/jobs/stages.ts (STAGE_LABEL)", "supabase/migrations/20260919143000_s06_workflow.sql (process_booking_gates, reevaluate_prebooking)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (CONFIRM_BOOKING -> Booked)", "supabase/migrations/20260919146000_s10_s11_operations.sql (cmd_operational_complete; AwaitingInstallation/InProgress/Aftercare never written)", "supabase/migrations/20260919147000_s15_cancellation.sql (CancellationInProgress, Cancelled, reinstate to Prebooking)"]
---
Every job has one stage. You see it as a badge on the job page, in **Job search** and in **Job sales**.

## The stages, in order

1. **Prebooking:** the job has just been sold. The office works through the prebooking tasks (deposit invoice, contract, deposit, customer details, finance).
2. **Ready to book:** every prebooking check has passed. The app moves the job here by itself.
3. **Booking in progress:** a booking form has been received for a job that was Ready to book.
4. **Booked:** the office has confirmed the booking.
5. **Awaiting installation**, **Install in progress** and **Aftercare:** these stages exist, but the app does not move jobs into them yet. A booked job stays **Booked** until it is completed.
6. **Operationally complete:** the office has marked the job complete after every completion check passed.

## Cancellation stages

- **Cancellation in progress:** the job is being cancelled. Normal work stops while the cancellation tasks are dealt with.
- **Cancelled:** the cancellation is closed. A cancelled job can be reinstated, which returns it to **Prebooking**.

## Things to know

- A job can go back from **Ready to book** to **Prebooking** if a prebooking task is reopened or no longer passes its checks.
- A job cannot skip **Ready to book**, even if a booking form arrives early.
- Only confirming the booking moves a job to **Booked**.

> **Note:** Most actions that move a job on (completing tasks, booking, completing, cancelling) may not be switched on yet. See [switched-off features](/help/switched-off-features).
