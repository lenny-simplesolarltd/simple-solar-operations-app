---
slug: record-commissioning
title: Filling in the commissioning form
summary: How an installer saves and submits the commissioning form for their work, and what to do when the office returns it.
category: commissioning
roles: ["Installer", "Office", "Manager", "Admin"]
release_function: FN-06
routes: ["/dashboard/installs/[workPackageId]"]
tools: []
keywords: ["commissioning", "commissioning form", "draft", "submit", "returned", "needs fixing", "test results", "certificate", "installer", "template"]
aliases: ["record commissioning", "commissioning form", "fill in commissioning", "submit commissioning", "send commissioning to office", "commissioning returned", "needs fixing", "fix commissioning", "resubmit commissioning", "save draft commissioning", "no approved commissioning template"]
related: ["commissioning-review", "office-commissioning-record", "electrical-completion", "installation-progress", "installation-photos"]
common_task: false
sort: 10
sources: ["src/features/installs/components/commissioning-form.tsx", "src/app/dashboard/installs/[workPackageId]/page.tsx (Commissioning card only when commissioning_required)", "supabase/migrations/20260919165000_r3_installer_commissioning.sql (IW_REPORT_COMPLETION creates the Draft; IW_COMMISSIONING_DRAFT / SUBMIT rules; no templates seeded; R1C_APPROVED_QUESTION_REQUIRED)", "src/app/dashboard/installs/page.tsx (Needs fixing badge)"]
---
Work that needs commissioning, such as electrical work, has a **Commissioning** section on its install page. You save the form as a draft, then submit it for the office to review.

## Before you start

- The **Commissioning** section only appears on work that needs commissioning.
- Pressing **Finish** with **All done** starts a draft form for you. See [Working through an installation](/help/installation-progress).
- If the section says **No approved commissioning template** for the trade, there are no questions to answer yet. You can still attach a photo and submit it.

## Steps

1. Open the work from [My installs](/dashboard/installs) and scroll to **Commissioning**.
2. Answer the questions shown.
3. Add a **Commissioning photo** if you have one.
4. Press **Save draft**. You need at least one answer or a photo.
5. Once the draft is saved, press **Submit for review**. This sends the saved answers to the office.

After you submit, the form can no longer be changed while the office reviews it.

## If the office returns it

The card in **My installs** shows **Needs fixing**. The form shows **Returned** and the **Office notes**.

1. Open the work and read the notes.
2. Correct the answers or upload a new photo. A photo from the earlier form cannot be reused, so upload it again.
3. Press **Save draft**, then **Submit for review**.

## If you can't do it

- **That question isn't on an approved commissioning form.** The trade has no approved form yet. Save and submit with a photo instead.
- **This record changed after you opened the form.** Refresh the page and try again.
- Office staff must fill in **Why the office is recording this**.
- This feature may not be switched on yet. Ask an administrator.
