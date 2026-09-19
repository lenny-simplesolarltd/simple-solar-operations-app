---
slug: staff-roles
title: Staff roles explained
summary: What each staff role can see and do in the app, in plain English, and why you may be able to view a job but not act on it.
category: administration
roles: []
release_function: none
routes: ["/dashboard/people"]
tools: []
keywords: ["roles", "permissions", "access", "admin", "manager", "director", "office", "variation approver", "surveyor", "finance", "store", "installer", "scaffolder", "read only"]
aliases: ["what can my role do", "what is my role", "why cant I see", "permissions", "access level", "who can do what", "what does office role do", "read only access", "not assigned to this job", "change my role"]
related: ["people-and-access", "finding-your-way-around", "team-tasks", "task-blocked", "switched-off-features"]
common_task: false
sort: 20
sources: ["src/lib/roles.ts", "src/components/layout/nav-visibility.ts", "src/constants/data.ts", "supabase/migrations/20260919141000_command_core.sql (is_office, is_director, is_office_manager, is_assigned)", "supabase/migrations/20260919210000_r1_completion.sql (authorize_command_r1)", "supabase/migrations/*.sql (app.command_registry role lists)", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (role_permissions)"]
---
Your roles are shown as badges on **Office home**. A person can have more than one role. Roles decide which menu items you see and what you can do.

## The roles

- **Admin** and **Manager**: everything. Only they have **People & access** and see which features are switched on. They can act on any task or job.
- **Director**: the office screens, **Team tasks** and **System health**. Can confirm bank deposits and record backup checks.
- **Office**: the day-to-day office work: tasks, **Booking**, **Intake review**, planning, materials, **Commissioning review**, confirming bookings and signing off completed jobs.
- **VariationApprover**: the office screens, with read access to every job. Does not have **Team tasks** or **System health**.
- **Surveyor**: sells jobs. Has **New job sold** and **Job sales**, and can search and open the jobs they sold.
- **Finance**: **Job search** and their own tasks.
- **Store**: **Materials**, **Merchant orders**, **Goods in** and **Stock**. Receives deliveries and handles stock.
- **Installer**: **My installs** for the work they are allocated, and their own tasks.
- **Scaffolder** and **ReadOnly**: **Office home**, **My tasks** and **My requests** only.

Everyone has **Office home**, **My tasks**, **My requests** and SimpleBot.

## Seeing is not the same as acting

Office roles can open most jobs. To change something on a job, you must also be assigned to it: you own or back up one of its tasks, you are responsible for one of its issues, or you sold it. Admin and Manager are always treated as assigned. Otherwise you see **You can view this job but are not assigned to it.**

Some actions are for fewer roles. For example, completing tasks is for Admin, Manager, Director, Office and VariationApprover, and many features are not switched on yet. See [Understanding switched-off features](/help/switched-off-features).

## If you can't do it

If your role looks wrong, ask an administrator. Roles cannot be changed from inside the app yet.
