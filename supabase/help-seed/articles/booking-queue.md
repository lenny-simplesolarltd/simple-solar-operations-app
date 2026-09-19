---
slug: booking-queue
title: The Booking queue
summary: Find jobs at each booking step, open their booking form, re-check their booking checks and confirm bookings.
category: booking
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: none
routes: ["/dashboard/booking"]
tools: ["find_job", "get_job_tasks", "get_my_tasks"]
keywords: ["booking", "queue", "board", "prebooking", "ready to book", "in progress", "upcoming", "booking tasks"]
aliases: ["booking queue", "booking board", "booking list", "jobs to book", "what needs booking", "ready to book list", "upcoming installs", "booking screen"]
related: ["book-a-job", "booking-checks", "confirm-a-booking", "ready-to-book", "job-stages", "find-a-job", "intake-review"]
common_task: true
sort: 10
sources: ["src/app/dashboard/booking/page.tsx", "src/features/booking/tabs.ts", "src/features/booking/components/booking-board.tsx", "src/features/booking/components/booking-tabs.tsx", "src/features/booking/components/booking-actions.tsx", "src/constants/data.ts (Booking, access office)", "src/components/layout/nav-visibility.ts", "supabase/migrations/20260919171000_view_port_booking_reads.sql (BOOKING_BOARD stages per view)", "supabase/migrations/20260919149000_s17_reads_rls.sql (booking_intake / confirm_booking flags)"]
---
The **Booking** screen shows every job that is moving through booking, one step at a time. Open it from **Booking** in the **Operations** menu.

## The tabs

- **Booking tasks**: open prebooking and booking tasks. Admin, Manager and Office staff see everyone's; others see their own.
- **Prebooking**: sold jobs still completing their prebooking checks.
- **Ready to book**: jobs cleared to book. Fill in the booking form.
- **In progress**: the booking has been received. Sort out any checks, then confirm the booking.
- **Upcoming**: booked jobs with work still to come.

Each tab shows how many jobs it holds. Use **Search job, customer, postcode** to narrow the list.

## What each card shows

- The job number (click it to open the job), customer and postcode.
- Badges such as **Intake review** or a count of open booking tasks.
- The booked roof, electrical and scaffold dates and the team, or **No dates yet**.
- The checks that are not passing yet. Red ones block the booking; amber ones need a look.

## Buttons on a card

- **Booking form** (or **Update booking** if a booking was already sent) opens the job's booking form.
- **Re-check** runs the booking checks again, for example after a task is finished.
- **Confirm booking** appears on the **In progress** tab.

## If you can't do it

- If the **Booking form** button is missing, booking may be switched off, or the job is cancelled or archived.
- You can only act on jobs you are assigned to (you own or back up a task on the job). Admins and Managers can act on any job.
- This feature may not be switched on yet. Ask an administrator.
