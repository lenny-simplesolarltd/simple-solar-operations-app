---
slug: ready-to-book
title: What Ready to book means
summary: The exact checks a sold job must pass before the app moves it from Prebooking to Ready to book, and where to see what is missing.
category: sales
roles: []
release_function: none
routes: ["/dashboard/booking", "/dashboard/jobs/[jobId]"]
tools: ["get_job", "get_job_tasks"]
keywords: ["ready to book", "prebooking", "readiness", "checks", "gates", "signed contract", "deposit", "finance agreement"]
aliases: ["ready to book", "what does ready to book mean", "why is job not ready to book", "job stuck in prebooking", "ready to book rules", "when can we book", "why cant I book this job", "what is missing before booking", "job went back to prebooking"]
related: ["presale-workflow", "job-stages", "booking-queue", "book-a-job", "pre02-check-contract-signed", "pre03-confirm-bank-deposit", "pre05-check-finance-agreement"]
common_task: true
sort: 50
sources: ["supabase/migrations/20260919143000_s06_workflow.sql (evaluate_ready_to_book, task_satisfaction, bank_confirmation_evidence, process_booking_gates, reevaluate_prebooking)", "src/features/booking/labels.ts (gate labels)", "src/app/dashboard/booking/page.tsx (Prebooking tab description)", "supabase/migrations/20260919171000_view_port_booking_reads.sql (BOOKING_BOARD gates for Prebooking jobs)"]
---
**Ready to book** means every prebooking check on a sold job has passed, so the office can book it. Nobody sets it by hand: the app checks the job each time a prebooking task is completed or reopened, and moves it when everything passes.

## The checks every job needs

- **Sale recorded:** the job has its presale.
- **Payment route set:** No finance, Phoenix finance or Other finance.
- **Signed contract on file:** PRE02 is complete with the contract reference, recorded as signed, with the signed contract file.
- **Details verified (PRE04)** and **Customer and value verified:** PRE04 is complete and the customer details and sold value were confirmed as matching.

## Extra checks for No finance

- **Deposit invoice sent (PRE01):** PRE01 is complete with an invoice number and marked as sent.
- **Deposit checked (PRE03)** and **Deposit in the bank:** PRE03 is complete and the amount in the bank matched the deposit invoice exactly.

## Extra checks for Phoenix or Other finance

- **Finance agreed (PRE05)** and **Finance agreement on file:** PRE05 is complete and the finance agreement file is attached to it.

> **Note:** A task marked complete is not enough on its own. The details it records must be there too, for example the signed contract file.

## Where to see what is missing

Office staff can open **Booking** and choose the **Prebooking** tab. Each job lists the checks it has not passed yet.

## What happens next

The job appears on the **Ready to book** tab of **Booking**, where the office fills in the booking form.

A job can drop back to **Prebooking** if one of its prebooking tasks is reopened or no longer passes.

## If you can't do it

If a check will not pass because tasks cannot be completed, this feature may not be switched on yet. Ask an administrator.
