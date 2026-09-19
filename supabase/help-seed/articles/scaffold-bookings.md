---
slug: scaffold-bookings
title: Managing scaffold bookings
summary: Request scaffold, record the scaffolder's confirmation, record it going up, authorise and plan the strip, and record it coming down.
category: planning
roles: ["Admin", "Manager", "Office"]
release_function: FN-04
routes: ["/dashboard/scaffold", "/dashboard/scaffold/[bookingId]"]
tools: ["find_job"]
keywords: ["scaffold", "scaffolder", "erect", "strip", "scaffold up", "scaffold down", "authorise strip", "weekly list", "chase", "complaint"]
aliases: ["scaffold booking", "book scaffold", "request scaffold", "scaffold up", "scaffold down", "strip scaffold", "take scaffold down", "scaffolder confirmed", "change scaffold date", "cancel scaffold", "scaffold complaint", "scaffold weekly list"]
related: ["planner-basics", "move-a-job", "book-a-job", "cancel-a-job"]
common_task: false
sort: 20
sources: ["src/app/dashboard/scaffold/page.tsx", "src/app/dashboard/scaffold/[bookingId]/page.tsx", "src/features/scaffold/components/scaffold-actions.tsx", "supabase/migrations/20260919163000_r2_scaffold.sql (registry: Admin/Manager/Office, job scoped, FN-04; SCF_REFUSED erected cannot be cancelled; messages captured not sent)", "supabase/migrations/20260919167000_result_catalogue_r2r4.sql (SCF_STRIP_BLOCKED wording)", "supabase/migrations/20260919173000_view_port_resourcing_reads.sql (SCAFFOLD_BOARD roles)"]
---
**Scaffold bookings** tracks every scaffold from request to strip. Open it from **Scaffold bookings** in the **Planning** menu.

## The list

- **Needs requesting**: jobs that need scaffold but have no live booking. Click **Request scaffold**, choose the **Scaffolder** and fill in any dates, notes and quoted cost. Blank fields are filled from the booking form or the scaffolder's lead time.
- Filter with **Active**, **Down or cancelled** or **All**. **Awaiting scaffolder** means they have not confirmed the latest dates.
- **Weekly lists** records one list per scaffolder for the week. **Chase overdue** creates chase tasks for dates that have passed without confirmation. Nothing is emailed from here.

## Working a booking

Click a booking to open it. The buttons change as the scaffold moves on:

1. **Scaffolder confirmed**: record what they said.
2. **Scaffold is up**: enter the date it went up.
3. **Authorise strip**: refused while the customer is not confirmed happy or a complaint blocks the strip. Blockers show under **Strip blocked**.
4. **Plan strip** (later **Re-plan strip**): enter the strip date.
5. **Scaffolder confirmed strip**.
6. **Scaffold is down**: the date, and optionally the final cost and invoice reference.

**Change dates** asks the scaffolder to confirm again. **Complaint** records a problem; an unsafe concern blocks the strip until resolved.

## If you can't do it

- **Cancel booking** is not offered once the scaffold is up. Arrange a safe strip instead.
- "The scaffold can't be stripped yet. Clear the listed blockers first."
- Only Admin, Manager and Office staff can act. You must be assigned to the job, unless you are an Admin or Manager.
- This feature may not be switched on yet. Ask an administrator.
