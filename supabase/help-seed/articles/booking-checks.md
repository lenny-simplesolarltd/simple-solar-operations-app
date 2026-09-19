---
slug: booking-checks
title: What the booking checks mean
summary: Understand the prebooking and booking checks that decide when a job is Ready to book and when a booking can be confirmed.
category: booking
roles: []
release_function: none
routes: ["/dashboard/booking", "/dashboard/jobs/[jobId]/booking"]
tools: ["get_job", "get_job_tasks"]
keywords: ["checks", "gates", "prebooking checks", "booking checks", "re-check", "blocked", "outstanding", "deposit", "contract"]
aliases: ["booking checks", "booking gates", "prebooking checks", "why cant i book", "why can't I confirm booking", "checks outstanding", "re-check booking", "recheck", "red checks", "job not ready to book"]
related: ["booking-queue", "confirm-a-booking", "book-a-job", "ready-to-book", "presale-workflow", "complete-a-task", "intake-review"]
common_task: false
sort: 30
sources: ["src/features/booking/labels.ts (gate wording)", "src/features/booking/components/booking-actions.tsx (GateList, RecheckGatesButton)", "src/app/dashboard/jobs/[jobId]/booking/page.tsx (Prebooking checks / Booking checks cards)", "supabase/migrations/20260919143000_s06_workflow.sql (evaluate_ready_to_book, evaluate_booking_gates, process_booking_gates)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (BOOKING_GATES, CONFIRM_BOOKING requires all gates)"]
---
The system checks each job twice before it is booked. Failing checks show on the [Booking queue](/help/booking-queue) cards and on the booking form, under **Prebooking checks** or **Booking checks**. Red checks block; amber checks need a look.

## Prebooking checks

These decide when a job moves from **Prebooking** to **Ready to book**:

- **Sale recorded**, **Payment route set** and **Signed contract on file**.
- **Contract signed (PRE02)** and **Details verified (PRE04)** tasks done.
- **Customer and value verified**.
- Standard payment: **Deposit invoice sent (PRE01)**, **Deposit checked (PRE03)** and **Deposit in the bank**.
- Finance: **Finance agreed (PRE05)** and **Finance agreement on file**.

When they all pass, the job moves to **Ready to book** by itself.

## Booking checks

These must all pass before a booking can be confirmed:

- **Booking form received** and **Booking matches the sale**.
- **Customer linked** and **Customer address complete**.
- **Signed contract on file**, **Payment route set** and **Deposit in the bank** (Standard payment only).
- **Contract value recorded**.
- The prebooking tasks above, plus **Task BKG01 done**, **Task BKG02 done** and **Task BKG03 done** (Prepare booking, Book dates and allocations, Reconcile booking response).

## Fixing a failing check

1. Hover over a check to see the detail.
2. Complete the missing task, or correct the booking through the booking form.
3. Click **Re-check** on the job's card to run the checks again.

> **Note:** Booking matches the sale fails while a booking is waiting in Intake Review. Correct the details and submit the booking form again.

## If you can't do it

- **Re-check** only appears on the **Prebooking** and **In progress** tabs, and only when you can use the booking form for that job.
- This feature may not be switched on yet. Ask an administrator.
