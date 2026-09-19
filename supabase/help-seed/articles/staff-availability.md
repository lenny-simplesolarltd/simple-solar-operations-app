---
slug: staff-availability
title: Recording staff holiday, sickness and time away
summary: Record annual leave, sickness, training or other time away so installers are not booked on those days.
category: planning
roles: []
release_function: none
routes: ["/dashboard/availability"]
tools: []
keywords: ["availability", "leave", "holiday", "annual leave", "sick", "sickness", "training", "unavailable", "time off", "absence"]
aliases: ["staff holiday", "book holiday", "book annual leave", "annual leave", "holiday request", "record holiday", "time off", "day off", "off sick", "sick day", "installer on holiday", "staff unavailable", "staff availability"]
related: ["capacity-conflicts", "planner-basics", "change-installer", "move-a-job", "installer-skills"]
common_task: true
sort: 30
sources: ["src/app/dashboard/availability/page.tsx", "src/features/planner/components/resourcing-actions.tsx (AddAvailability, AvailabilityRowActions)", "src/constants/data.ts + src/components/layout/nav-visibility.ts (Staff availability, access resourcing = office class)", "supabase/migrations/20260919164000_r2_calendar_resourcing.sql (RP_SET_AVAILABILITY / RP_CANCEL_AVAILABILITY: Admin/Manager/Office, no release mode; approver = actor; Available never conflicts)", "supabase/migrations/20260919146000_s10_s11_operations.sql (ON_LEAVE check)", "supabase/migrations/20260919145000_s05_booking_intake.sql (booking form has no leave check)"]
---
**Staff availability** holds everyone's leave, sickness, training and other time away. Installer entries stop them being given work on those days.

## Before you start

Only Admin, Manager and Office staff can add or change entries. If you want to book your own holiday, ask the office to record it.

## Steps

1. Open **Staff availability** from the **Planning** menu.
2. Click **Add**.
3. Choose the **Person** and the **Type**: Leave, Sick, Training, Unavailable or Available.
4. Enter **From** and, for more than one day, **To**. Leave **To** blank for a single day.
5. Add a **Reason** if useful, then confirm.

You are recorded as the person who approved it.

## Finding and changing entries

- Use **How far ahead** (**Next month**, **Next 3 months**, **Next year**) and **Person** to filter the list.
- Click **Edit** to change an entry, or **Cancel** to remove it. Cancelling needs a reason.

## What happens next

- If the person is already booked on jobs in that period, the entry shows "Booked on 1 job in this period – re-plan in the Planner." Existing bookings are not moved for you. Use [Move job](/help/move-a-job) or [Change installer](/help/change-installer).
- From now on, giving that installer work on those days is refused with "That installer is on leave then". See [Capacity conflicts](/help/capacity-conflicts).
- The Planner's **Team board** shows the time away in amber.

> **Note:** The booking form does not check leave. Check this screen before choosing installers on a new booking.

## If you can't do it

- If you cannot see **Staff availability** in the menu, your role does not include it. Ask the office.
- Office-wide closures are not recorded here. Ask an administrator.
