---
slug: job-detail
title: Understanding the job page
summary: What each tab on a job page shows, from the customer and sale details to tasks, files and history.
category: jobs
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]"]
tools: ["get_job", "get_job_tasks"]
keywords: ["job page", "job detail", "overview", "tabs", "work", "operations", "money", "files", "history", "presale"]
aliases: ["job page", "open a job", "job screen", "job tabs", "what is on the job page", "job overview", "where is the price", "customer details", "job history", "who sold the job"]
related: ["find-a-job", "job-stages", "job-tasks", "find-customer-files", "raise-an-issue", "record-a-call", "book-a-job", "move-a-job"]
common_task: true
sort: 20
sources: ["src/app/dashboard/jobs/[jobId]/page.tsx", "src/features/jobs/components/job-tabs.tsx", "src/features/jobs/components/job-sections.tsx", "src/features/jobs/components/operations/operations-tab.tsx", "supabase/migrations/20260919220000_p0_r1_integration.sql (execute_read office-class check for JOB_OVERVIEW / AUDIT_HISTORY)", "supabase/migrations/20260919210000_r1_completion.sql (JOB_OPERATIONS roles)"]
---
The job page is the single place for everything about one job. The top shows the job reference, the customer, the postcode, the sale date and the job's stage.

## The tabs

- **Overview:** the **Customer** card (name, address, phone, email), the **Sale** card (agreed price, payment route, salesperson, lead source, quote reference and scope: roof, electrical, scaffold), the **Presale** card with the system size, panel count and price breakdown, and the job's open tasks. The presale is the record of what was sold and cannot be edited.
- **Tasks:** every task on the job with its owner, due date and status.
- **Work:** work packages with planned dates and installers, plus install, materials, scaffold, and commissioning and handover summaries.
- **Operations:** completion checks, commissioning, date and installer changes, issues, calls and cancellation.
- **Money:** contract value, invoiced, paid and outstanding, whether the deposit is in the bank, the contract status and the invoice stages.
- **Files:** every file added to the job, with **Open** and **Download** buttons.
- **History:** a timeline of changes to the job, its tasks and issues, newest first.

## Buttons at the top

Office staff also see:

- **Booking form**, while the job is at Prebooking, Ready to book or Booking in progress.
- **Move job**, from Booking in progress up to Install in progress.

## If you can't do it

- **"Not found" when opening a job:** you do not have access to that job.
- **"No access" on the Work, Operations, Money or History tab:** these tabs are for office staff, directors and variation approvers only. A Surveyor can use Overview, Tasks and Files.
- **The Tasks tab looks empty:** you only see tasks you own or back up, unless your role can see every task.
