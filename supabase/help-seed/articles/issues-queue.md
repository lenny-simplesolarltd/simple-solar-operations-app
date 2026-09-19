---
slug: issues-queue
title: Issues: working every open issue in one place
summary: How office staff see every open issue across jobs, resolve it with an optional photo, close it once the customer confirms, and reassign it.
category: jobs
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/issues", "/dashboard/jobs/[jobId]"]
tools: []
keywords: ["issues", "issue queue", "open issues", "blocking issues", "remedial", "complaint", "variation", "resolve issue", "close issue", "reassign issue"]
aliases: ["all open issues", "what issues are open", "blocking completion", "issue list", "who owns this issue", "resolve a complaint", "close an issue"]
related: ["raise-an-issue", "why-cant-i-complete-a-job", "complete-a-job", "office-queues"]
common_task: true
sort: 30
sources: ["src/app/dashboard/issues/page.tsx", "src/features/jobs/components/operations/actions.tsx (IssueActions)", "supabase/migrations/20260920120000_convergence_operations.sql (ISSUES read, issue files)"]
---
**Issues** (in the **Operations** menu) lists the issues on every job you can open, so you do not have to open each job.

## Reading the list

- Choose **Open** (the default), **Resolved** or **All**, filter by type, or search by job reference, customer, postcode or text.
- The top line counts open issues, how many block completion, and how many are resolved but waiting to be closed.
- **Blocks completion** marks an open issue that stops the job being marked operationally complete.
- Click the job reference to open the job's Operations tab.

## Resolving an issue

1. Press **Resolve** on the issue.
2. Write how it was resolved. You can add a photo or PDF as proof; it is saved with the job's files under **Issues**.
3. Confirm. The issue shows **Resolved**.

## Closing an issue

Once the customer has confirmed the fix, press **Close** and confirm **Customer confirmed - close**. Only a resolved issue can be closed.

## Reassigning an issue

Press **Reassign**, choose the office person who should own it, and confirm.

## If you can't do it

The buttons only appear for issues on jobs you are assigned to, while the office core is switched on and the job is not cancelled or archived. The reason is shown under the issue.
