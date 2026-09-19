---
slug: book-a-job
title: How to book a job
summary: Fill in the booking form for a job: customer details, install dates, installers, scaffold, system and materials.
category: booking
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/jobs/[jobId]/booking", "/dashboard/booking"]
tools: ["find_job", "get_job"]
keywords: ["booking form", "book", "install date", "roofer", "electrician", "installer", "scaffold", "materials", "merchant", "submit booking"]
aliases: ["book a job", "book job", "booking form", "book install", "book installation", "set install date", "choose installer", "assign installer", "pick roofer", "pick electrician", "submit booking", "update booking"]
related: ["booking-queue", "booking-checks", "confirm-a-booking", "change-installer", "move-a-job", "intake-review", "ready-to-book"]
common_task: true
sort: 20
sources: ["src/app/dashboard/jobs/[jobId]/booking/page.tsx", "src/features/booking/components/booking-form.tsx", "src/features/booking/labels.ts", "src/app/dashboard/jobs/[jobId]/page.tsx (Booking form button, BOOKING_STAGES)", "supabase/migrations/20260919145000_s05_booking_intake.sql (BOOKING_INTAKE: stages, review reasons, allocations only when none exists, no capacity check)", "supabase/migrations/20260919143000_s06_workflow.sql (BKG01-03 creation, stage advance)", "supabase/migrations/20260919149000_s17_reads_rls.sql (describe_command_result BOOKING_INTAKE)", "docs/p0-r1-integration.md (first installer chosen in booking form)"]
---
The booking form records the install dates, the team, scaffold, system details and materials for a job. This is where you choose the first installers.

## Before you start

The job must be at **Prebooking**, **Ready to book** or **Booking in progress**. Open it from the job's **Booking form** button, or from a card on the [Booking queue](/help/booking-queue).

## Steps

1. **Customer**: pre-filled from the sale. Only change something if it is wrong. Leave **Price on the booking (£)** blank unless it differs from the contract value.
2. **Dates & team**: enter the **Roof date** and choose the **Roofer**, then the **Electrical date**, **Electrician** and, if needed, **Second electrician**. The payment route is shown but cannot be changed here.
3. **Scaffold**: enter the **Scaffold erect date**, choose the **Scaffolder** and add **Scaffold access notes**.
4. **System**: size, generation, roof hooks, inverter and battery.
5. **Materials**: choose the **Merchant** and enter quantities.
6. **Notes**: roofing, electrical and ordering notes.
7. Click **Submit booking** (or **Update booking**).

## What happens next

You see **Booking saved** and the job's new stage. A job at **Ready to book** moves to **Booking in progress**, and the booking tasks **Prepare booking**, **Book dates and allocations** and **Reconcile booking response** are created. A job still at **Prebooking** keeps its booking but stays there until its checks pass.

If you see **Booking saved – needs Intake Review**, the reasons are listed, such as customer details or price differing from the sale, or scaffold details on a job sold without scaffold. Customer changes are never applied directly.

> **Note:** The form does not check installer leave or capacity. Once an installer is saved for a trade, sending the form again does not replace them. Use [Change installer](/help/change-installer).

## If you can't do it

- "The booking form is not available" means the job is at another stage, cancelled or archived, or booking is switched off.
- You must be assigned to the job, unless you are an Admin or Manager.
- This feature may not be switched on yet. Ask an administrator.
