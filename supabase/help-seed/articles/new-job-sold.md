---
slug: new-job-sold
title: How to submit a New job sold
summary: Record a sale with the nine-step presale form, from the customer and roof design to the agreed price, then submit it to create the job.
category: sales
roles: ["Surveyor", "Office", "Admin", "Manager"]
release_function: none
routes: ["/dashboard/presales/new"]
tools: ["get_presale_workflow"]
keywords: ["presale", "job sold", "new sale", "submit sale", "designer", "elevations", "agreed price", "finance route", "surveyor"]
aliases: ["sold a job", "new job sold", "submit a sale", "record a sale", "new presale", "presale form", "job sold form", "enter a sale", "how do I sell a job", "customer signed up", "start over presale", "draft presale"]
related: ["presale-workflow", "job-sales", "job-detail", "ready-to-book"]
common_task: true
sort: 10
sources: ["src/app/dashboard/presales/new/page.tsx", "src/features/presale/lib/steps.ts", "src/features/presale/components/steps/sale-step.tsx", "src/features/presale/components/steps/customer-step.tsx", "src/features/presale/components/presale-wizard.tsx (draft saved on this device, Start over)", "src/features/presale/components/job-sold-screen.tsx", "src/features/presale/server/messages.ts", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (submit_presale, presale.submit grants)"]
---
**New job sold** is the presale form. It walks you through nine steps, from the customer to the agreed price. Submitting it creates the job and hands its first tasks to the office.

## Before you start

Have the customer's details and the roof measurements ready. Your work is saved in this browser as you go ("Draft saved on this device").

## Steps

1. Open **New job sold** from the **Sales** section of the menu.
2. **Customer:** enter the name, address and a valid UK postcode, plus a phone number or an email address.
3. **Parameters:** enter the AC cable run and annual consumption.
4. **Elevations:** enter each roof elevation's pitch, shading, bearing and size, then click **Use these values** on each one.
5. **Obstructions:** add anything on the roof that reduces the usable area.
6. **Panels:** choose the panel type.
7. **Layout:** check the panel layout on each elevation.
8. **Price:** add inverter and battery lines, extras and adjustments. Every inverter line needs a model.
9. **Performance:** check the estimated generation and savings.
10. **Review & submit:** check the salesperson, choose the **Finance route** (**No finance**, **Phoenix finance** or **Other finance**), enter the **Agreed selling price (£)**, check the **Scope** and add any notes. Lead source and quote reference are optional.
11. Click **Submit job sold**.

## What happens next

The **JOB SOLD** screen shows the new job reference (SS-XXXX-0000) and **What happens next**: the prebooking tasks, their owners and due dates. From there choose **View job**, **Back to presales** or **Start another presale**.

> **Warning:** The presale cannot be edited after it is submitted. Check the review first.

## If you can't do it

- **Next is greyed out:** the message above the button says what is missing, for example "Fill in every highlighted field above to continue."
- **"You can only submit a sale as yourself."** Surveyors are always the salesperson. Office staff can choose another active Surveyor.
- **New job sold is not in your menu:** your role cannot submit sales.
