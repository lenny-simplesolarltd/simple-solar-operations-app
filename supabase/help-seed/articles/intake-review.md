---
slug: intake-review
title: Intake review
summary: See booking forms that did not match the sale, compare the details side by side, and correct the booking.
category: sales
roles: ["Admin", "Manager", "Office"]
release_function: FN-01
routes: ["/dashboard/intake"]
tools: []
keywords: ["intake review", "booking form", "mismatch", "customer details differ", "price differs", "review queue"]
aliases: ["intake", "intake review", "booking doesnt match sale", "booking mismatch", "customer details different", "price different on booking", "installer not found", "merchant not recognised", "review booking"]
related: ["book-a-job", "booking-queue", "pre04-check-customer-details-and-amount", "job-detail", "switched-off-features"]
common_task: false
sort: 60
sources: ["src/app/dashboard/intake/page.tsx", "src/features/booking/labels.ts (reasonLabel, fieldLabel)", "src/components/layout/nav-visibility.ts (intakeReview = Admin/Manager/Office)", "supabase/migrations/20260919171000_view_port_booking_reads.sql (INTAKE_REVIEW_QUEUE roles)", "docs/r1-parity-after-p0.md row 78 (no Intake Review resolve)"]
---
**Intake review** lists booking forms that did not match the sale. Nothing on these forms has been applied to the customer record.

## Before you start

**Intake review** is in the **Operations** section of the menu for Office, Admin and Manager staff.

## What you see

Each item shows:

- the job reference, customer and postcode (or "Unlinked ... form" if it could not be matched to a job)
- when the form was received and the job's stage
- the reasons, for example **Customer details differ from the sale**, **Price differs from the contract value**, **Installer not found** or **Merchant not recognised**
- a table of each differing field: **On the sale** and **On the booking**

## Steps

1. Open **Intake review**.
2. Read the reasons and compare **On the sale** with **On the booking**.
3. Check with the customer or the salesperson which is right.
4. Click **Open job** to look at the job, or **Booking form** to submit a corrected booking.

## What happens next

Correct the booking with the booking form. If the details on the sale itself are wrong, tell an administrator: the sale cannot be edited.

> **Note:** There is no button to mark an item as resolved yet. Items stay on the list after you correct the booking.

## If you can't do it

- **"Nothing to review"**: no booking forms need a decision.
- **The booking form will not submit:** this feature may not be switched on yet. Ask an administrator.
- **No Open job or Booking form buttons:** you cannot open that job. Ask an administrator.
