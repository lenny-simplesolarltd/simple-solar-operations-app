---
slug: raise-an-issue
title: How to raise and resolve an issue
summary: Record a remedial, complaint or variation issue on a job, then resolve it and close it once the customer confirms.
category: jobs
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/jobs/[jobId]"]
tools: []
keywords: ["issue", "remedial", "complaint", "variation", "blocks completion", "resolve", "close issue", "problem"]
aliases: ["raise issue", "log a problem", "customer complaint", "remedial work", "variation", "resolve issue", "close issue", "problem on job", "snag", "blocking issue"]
related: ["job-detail", "record-a-call", "why-cant-i-complete-a-job", "switched-off-features"]
common_task: true
sort: 50
sources: ["src/features/jobs/components/operations/actions.tsx (RaiseIssue, IssueActions)", "src/features/jobs/components/operations/operations-tab.tsx (Issues section)", "src/features/jobs/components/operations/labels.ts (flagText, STATE)", "supabase/migrations/20260919210000_r1_completion.sql (issue_create / resolve / close flags)", "supabase/migrations/20260919210000_r1_completion.sql (authorize_command_r1 ISSUE_UPDATE)", "supabase/migrations/20260919149000_s17_reads_rls.sql (R1A_INVALID_ISSUE_TYPE wording)"]
---
Issues record something that needs putting right on a job. An issue that **blocks completion** must be resolved and closed before the job can be marked operationally complete.

## Before you start

You must be office staff and be assigned to the job. The job must not be cancelled or archived.

## Raise an issue

1. Open the job and choose the **Operations** tab.
2. In **Issues**, click **Raise issue**.
3. Choose the **Type**: **Remedial**, **Complaint** or **Variation**.
4. Enter a **Title** and **What happened**.
5. Choose **Blocks completion**. **Yes - must be resolved first** is selected for you.
6. Choose the **Severity**: **Normal** or **Medium**.
7. Click **Raise issue**.

The issue appears in the list with its type, status, who raised it and its owner. A blocking issue shows a **Blocks completion** badge.

## Resolve and close an issue

1. Find the issue in **Issues** on the **Operations** tab.
2. Click **Resolve**, describe **How it was resolved**, then click **Resolve** again to save.
3. When the customer has confirmed the fix, click **Close**, then **Customer confirmed - close**.

You can only close an issue after it has been resolved.

## What happens next

Issues are also raised for you when a call records a return visit or an unhappy customer. See [how to record a call](/help/record-a-call).

## If you can't do it

- **"Switched off for this release. An administrator turns it on."** This feature may not be switched on yet. Ask an administrator.
- **"Your role can't do this."** Only office staff can raise issues.
- **"You're not assigned to this job."** Ask the task owner or an administrator.
- **"The job is cancelled or archived."** Issues cannot be raised on it.
