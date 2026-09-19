---
slug: find-a-job
title: How to find a job
summary: Search for a job by its reference, the customer's name, postcode, address, phone, email or quote reference, and filter by stage.
category: jobs
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover", "Surveyor", "Finance"]
release_function: none
routes: ["/dashboard/jobs"]
tools: ["find_job"]
keywords: ["job search", "search", "find", "job reference", "SS reference", "postcode", "customer", "stage filter"]
aliases: ["find job", "search job", "look up job", "where is the job", "find customer", "search customer", "search postcode", "job number", "SS number", "look up SS-", "find by phone", "find by email", "find by quote"]
related: ["job-detail", "job-stages", "job-sales", "finding-your-way-around"]
common_task: true
sort: 10
sources: ["src/app/dashboard/jobs/page.tsx", "src/features/jobs/components/job-filter-bar.tsx", "src/features/jobs/components/job-list.tsx", "src/constants/data.ts (Job search, access jobs)", "src/components/layout/nav-visibility.ts (jobs)", "supabase/migrations/20260919170000_view_port_reads.sql (app.read_jobs search fields, JOBS roles, app.can_read_job)", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (job.read.all / job.read.own grants, app.generate_job_ref)"]
---
**Job search** lists every job you are allowed to see, newest sale first. Every job has a reference like SS-ABCD-1234.

## Before you start

**Job search** is offered to office staff, directors, surveyors and finance. What you see depends on your role:

- Office, Admin, Manager, Director and Variation Approver staff see every job.
- A Surveyor sees the jobs they sold or submitted.
- Anyone else sees only jobs where they own a task.

## Steps

1. Open **Job search** from the **Work** section of the menu.
2. Type in the search box. You can search by:
   - job reference, for example SS-ABCD-1234 (part of it works too)
   - customer name
   - postcode (with or without the space)
   - first line of the address or town
   - phone number or email address
   - quote reference
3. Press Enter. The list updates.
4. To narrow it down, choose a stage from **Stage**, for example **Ready to book**.
5. Click the job reference to open the job.
6. Use **Clear** to remove your search and stage filter.

## What happens next

Each row shows the job's stage, when it was sold and by whom, how many tasks are open (late ones are counted in red), and the next task with its owner and due date. Click the next task to go straight to it.

> **Note:** Without a search the list shows the newest jobs only. If you see "Showing the newest ... jobs. Search to narrow it down.", type a search to find older jobs.

## If you can't do it

- **No jobs found:** check the spelling, or try the postcode or part of the reference instead.
- **A job you expect is missing:** you may not have access to it. Ask the office or an administrator.
- **Job search is not in your menu:** your role does not use it. Installers find their work under **My installs**.
