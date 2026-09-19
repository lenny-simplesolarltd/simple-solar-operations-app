---
slug: office-home
title: Office home: your starting screen
summary: What the Office home screen shows you, what each count means, and why some people see more counts than others.
category: getting-started
roles: []
release_function: none
routes: ["/dashboard"]
tools: ["get_my_tasks"]
keywords: ["home", "dashboard", "office home", "counts", "overdue", "due today", "my work", "operations", "jobs by stage"]
aliases: ["home page", "dashboard", "front page", "start screen", "where is my work", "what do I need to do today", "overview", "my overdue tasks", "what needs doing"]
related: ["my-tasks", "team-tasks", "finding-your-way-around", "job-stages", "booking-queue", "staff-roles"]
common_task: true
sort: 20
sources: ["src/app/dashboard/page.tsx", "supabase/migrations/20260919170000_view_port_reads.sql (read_office_dashboard, can_read_team_tasks)", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (role_permissions)", "src/constants/data.ts"]
---
**Office home** is the first screen after you sign in. It shows your roles and the work waiting for you. Every count is a live number, and most counts open the list behind them when you click them.

## What you see

- **Your roles** are shown as small badges under the heading.
- **New job sold** appears at the top right if you are allowed to submit a sale. **Sold jobs** (or **My job sales** for salespeople) opens the list of sales.
- **My work** counts your open tasks: **Overdue**, **Due today**, **Next 7 days**, **Waiting**, **Booking** and **All open**. A task counts as yours when you are its owner or its backup.
- **Needs your attention** lists up to eight of your open tasks. Press **View all** to see the rest. If you have none, it says **You are all clear**.
- **Operations** shows company-wide counts such as **Open issues**, **Blocking issues**, **Draft orders**, **Installs, next 14 days** and **Unallocated installs**. These only count jobs you are allowed to see.
- **Jobs by stage** shows how many jobs are at each stage.

## Why other people see different counts

Some counts only appear for certain roles:

- **Team overdue** and **Booking queue** are shown to Admin, Manager, Director and Office.
- **Intake review** and **Integrations to review** are shown to Admin, Manager and Office.

A count you can see but cannot click means you can read the number but the list behind it is not in your menu.

## If you can't do it

If a section says it **could not load**, refresh the page. If it keeps happening, tell an administrator.
