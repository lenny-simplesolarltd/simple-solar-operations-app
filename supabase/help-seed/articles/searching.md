---
slug: searching
title: Searching for jobs, tasks and screens
summary: Where to search for a job, a task or a screen, and what each search box looks through.
category: getting-started
roles: []
release_function: none
routes: ["/dashboard/jobs", "/dashboard/tasks"]
tools: ["find_job"]
keywords: ["search", "find", "job search", "postcode", "customer", "reference", "command bar", "ctrl k", "cmd k"]
aliases: ["search", "find a customer", "look up a job", "search by postcode", "search by phone number", "find job reference", "cant find a job", "cant find customer", "quick search", "search bar"]
related: ["find-a-job", "my-tasks", "finding-your-way-around", "simplebot-basics", "job-detail"]
common_task: true
sort: 40
sources: ["src/app/dashboard/jobs/page.tsx", "src/features/jobs/components/job-filter-bar.tsx", "supabase/migrations/20260919170000_view_port_reads.sql (read_jobs, JOBS registry roles)", "src/features/tasks/components/task-filter-bar.tsx", "src/components/kbar/index.tsx", "src/components/search-input.tsx", "src/features/assistant/server/tools"]
---
There are three places to search. Each one looks through something different.

## Search for a job

1. Open **Job search** from the menu.
2. Type in the box marked **Job ref, customer, postcode, quote, phone**. Part of a word is enough, and spaces in a postcode do not matter.
3. Choose a **Stage** to narrow the list, or press **Clear** to start again.
4. Click a job to open it.

With no search typed, the list shows every job you can see, newest sale first. Only jobs you are allowed to see ever appear. See [Find a job](/help/find-a-job) for more.

## Search your tasks

On **My tasks** (or **Team tasks**), use the box marked **Search task, job, customer, postcode**. It only searches the tasks in the current list, so check the **Status** and **Due** filters too.

## Search for a screen

Press **Ctrl+K** (**Cmd+K** on a Mac) or click **Search...** at the top of the page. This finds screens in your menu, such as **Planner** or **Booking**. It does not search jobs or customers.

## Ask SimpleBot

You can also ask SimpleBot, for example "find the job for postcode BS1 4DJ". It searches the same jobs you can see and links to them.

## If you can't do it

- **Job search is not in my menu.** It is available to office roles, Surveyor and Finance. Installers, Store, Scaffolders and read-only staff reach jobs from their tasks or installs instead.
- **A job does not appear.** Check the spelling and the **Stage** filter. If it still does not appear, you may not have access to it. Ask a colleague in the office.
