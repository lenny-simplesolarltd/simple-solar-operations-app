---
slug: job-sales
title: The Job sales list
summary: See the jobs sold through the presale form, with the sale date, system size, payment route, agreed price and current stage.
category: sales
roles: []
release_function: none
routes: ["/dashboard/presales"]
tools: []
keywords: ["job sales", "my job sales", "sales list", "sold jobs", "presales", "agreed price", "finance route"]
aliases: ["my sales", "jobs I sold", "sales list", "list of sold jobs", "presales list", "what have I sold", "my job sales", "recent sales"]
related: ["new-job-sold", "find-a-job", "job-detail", "job-stages"]
common_task: false
sort: 20
sources: ["src/app/dashboard/presales/page.tsx", "src/features/presale/server/queries.ts (getVisibleJobs limit 200)", "src/components/layout/nav-visibility.ts (jobSales)", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (jobs_select RLS, job.read.own / job.read.all)"]
---
**Job sales** lists jobs sold through the **New job sold** form, newest first.

## What you see

- Office, Admin, Manager, Director and Variation Approver staff see **Job sales**: every job sold.
- A Surveyor sees **My job sales**: the jobs they sold or submitted. The office takes over once a sale is submitted.

Each row shows:

- the **Job** reference (click it to open the job)
- the **Customer** and postcode
- the date it was **Sold**
- the **System** size and panel count
- the **Payment** route: **No finance**, **Phoenix finance** or **Other finance**
- the **Agreed price**
- the job's current **Stage**

## Steps

1. Open **Job sales** from the **Sales** section of the menu.
2. Find the job and click its reference to open the job page.
3. To record a new sale, click **New job sold** at the top.

> **Note:** The list shows up to the 200 most recent jobs and has no search box. To find an older job, use [Job search](/help/find-a-job).

## If you can't do it

- **"No jobs have been sold yet"**: no sale you can see has been submitted.
- **A sale is missing:** you only see sales where you are the salesperson or the person who submitted it, unless your role sees every job.
- **No New job sold button:** your role cannot submit sales.
