---
slug: commissioning-review
title: Reviewing commissioning forms
summary: How the office checks commissioning forms that installers have submitted, and accepts them or returns them with notes.
category: commissioning
roles: ["Admin", "Manager", "Office"]
release_function: FN-06, FN-07, FN-08
routes: ["/dashboard/commissioning", "/dashboard/commissioning/[workPackageId]"]
tools: []
keywords: ["commissioning", "review", "accept", "return", "returned", "installer form", "submitted", "to review", "no template", "handover"]
aliases: ["commissioning review", "review commissioning", "accept commissioning", "return commissioning", "send commissioning back", "commissioning to check", "installer submitted form", "cant accept commissioning", "accept button greyed out", "no template"]
related: ["record-commissioning", "office-commissioning-record", "electrical-completion", "why-cant-i-complete-a-job", "switched-off-features"]
common_task: false
sort: 30
sources: ["src/app/dashboard/commissioning/page.tsx", "src/app/dashboard/commissioning/[workPackageId]/page.tsx", "src/features/installs/components/review-actions.tsx", "src/components/layout/nav-visibility.ts (commissioning: Admin, Manager, Office)", "supabase/migrations/20260919165000_r3_installer_commissioning.sql (COMMISSIONING_REVIEW: Office/Manager/Admin, FN-06 + FN-07; Accepted needs an approved template; INSTALLER_WORKFLOW FN-06; HANDOVER_CREATE / HANDOVER_READINESS FN-08)", "supabase/migrations/20260919173000_view_port_resourcing_reads.sql (COMMISSIONING_QUEUE, no release gate)", "supabase/migrations/20260919167000_result_catalogue_r2r4.sql (R1C_APPROVED_TEMPLATE_REQUIRED)"]
---
**Commissioning review** lists the commissioning forms installers have submitted. You check each one and either accept it or return it to the installer with notes.

## Before you start

**Commissioning review** is in the menu under **Installs** for office staff, managers and administrators.

## Steps

1. Open **Commissioning review**.
2. Choose a tab: **To review**, **Returned** or **Accepted**. Each row shows the job reference, trade, customer, postcode and installer. Commissioning recorded by the office shows **Office record**.
3. Click a row to open it. Check the **Answers** and the **Photos and files**. Use **open job** to see the whole job.
4. Choose one:
   - **Accept**. Add **Notes** (it starts with "Checked and accepted.") and confirm.
   - **Return to installer**. Say **What needs fixing** and confirm. The installer sees your notes and must fix and resubmit.

## What happens next

An accepted form ticks the commissioning line for that work on the job's completion checklist. A returned form shows **Needs fixing** in the installer's **My installs**.

The **Handover** section at the bottom shows whether the job is ready for handover. Handover is switched on separately.

## If you can't do it

- **No template** badge, and **Accept** is greyed out: a form without an approved template cannot be accepted. You can only return it. To count commissioning towards completion, record the certificate on the job instead. See [Recording commissioning on a job](/help/office-commissioning-record).
- The buttons only appear while a form is submitted or under review.
- **Not switched on yet** on the form page, or **This action is switched off at the moment.** This feature may not be switched on yet. Ask an administrator.
