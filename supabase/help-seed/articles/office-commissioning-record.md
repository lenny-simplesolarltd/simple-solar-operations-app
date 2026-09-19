---
slug: office-commissioning-record
title: Recording commissioning on a job (office)
summary: Upload the commissioning certificate or evidence for a work package from the job's Operations tab so it counts towards completion.
category: commissioning
roles: ["Admin", "Manager", "Office"]
release_function: FN-01
routes: ["/dashboard/jobs/[jobId]"]
tools: ["find_job"]
keywords: ["commissioning", "certificate", "EIC", "electrical certificate", "evidence", "operations tab", "record commissioning", "replace commissioning record", "work package"]
aliases: ["record commissioning", "upload certificate", "upload EIC", "add electrical certificate", "commissioning certificate", "office commissioning", "commissioning not recorded", "replace commissioning", "attach commissioning evidence"]
related: ["electrical-completion", "why-cant-i-complete-a-job", "complete-a-job", "commissioning-review", "job-detail", "upload-a-file"]
common_task: true
sort: 20
sources: ["src/features/jobs/components/operations/actions.tsx (RecordCommissioning)", "src/features/jobs/components/operations/operations-tab.tsx (Work and commissioning)", "src/features/jobs/components/operations/labels.ts (flagText, STATE)", "supabase/migrations/20260919210000_r1_completion.sql (COMMISSIONING_RECORD: Admin/Manager/Office, job-scoped, FN-01; evidence required; refused once an installer form is accepted; catalogue wording)", "supabase/migrations/20260919220000_p0_r1_integration.sql (R1A_EVIDENCE_ALREADY_LINKED)"]
---
When commissioning is done through the current paperwork, the office records it on the job by uploading the certificate. This counts as commissioning for that work package when the job is completed.

## Before you start

- You need the certificate or evidence file: a photo (JPG, PNG, WebP, HEIC) or a PDF, up to 25 MB.
- You must be office staff, a manager or an administrator, and assigned to the job.

## Steps

1. Open the job and choose the **Operations** tab.
2. Under **Work and commissioning**, find the card for the trade, for example **Electrical**. Its **Commissioning** line says **Not recorded**.
3. Press **Record commissioning**.
4. Upload the **Certificate or evidence**. Wait for **Uploaded**.
5. Optionally add the **Certificate / document reference**, for example the EIC number, and any **Notes**.
6. Press **Record commissioning**.

## What happens next

The card shows **Recorded by** your name, the date and the reference, and the completion checklist ticks the commissioning line for that trade. To correct it, press **Replace commissioning record** and upload again. The earlier record is kept in the history.

## If you can't do it

The reason is shown under the button:
- **This work package does not need commissioning.**
- **This work package is cancelled.**
- **An installer commissioning form is already accepted.** The installer's form is the record, so the office does not replace it.
- **You're not assigned to this job.** or **Your role can't do this.**
- **That file is already the evidence for a different commissioning record.** Upload the certificate again.
- **Switched off for this release. An administrator turns it on.** This feature may not be switched on yet. Ask an administrator.
