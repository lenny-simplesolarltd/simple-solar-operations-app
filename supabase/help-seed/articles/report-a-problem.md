---
slug: report-a-problem
title: Reporting a problem or a variation on site
summary: Tell the office about a problem on site, or extra work the customer wants, from the install page.
category: installation
roles: ["Installer", "Office", "Manager", "Admin"]
release_function: FN-06
routes: ["/dashboard/installs/[workPackageId]"]
tools: []
keywords: ["problem", "issue", "variation", "extra work", "damage", "access", "safety", "materials short", "technical", "site problem", "remedial"]
aliases: ["report a problem", "problem on site", "something wrong on site", "cant get access", "no access to property", "damage on site", "materials short", "missing materials", "safety issue", "customer wants extra", "extra work", "variation", "change to the job", "raise issue from site"]
related: ["installation-progress", "installation-photos", "raise-an-issue", "why-cant-i-complete-a-job", "my-installs"]
common_task: false
sort: 40
sources: ["src/features/installs/components/install-actions.tsx (Problem, Variation)", "supabase/migrations/20260919165000_r3_installer_commissioning.sql (IW_REPORT_PROBLEM: Safety/Technical block completion, ISS02 task; IW_REPORT_VARIATION: VariationApprover, ISS01)", "src/app/dashboard/installs/page.tsx (open issue badge)"]
---
If something goes wrong on site, or the customer asks for something different, report it from the install page. The office is told straight away.

## Before you start

Open the work from [My installs](/dashboard/installs). The **Problem** and **Variation** buttons appear while the work is scheduled, in progress or waiting for a return visit.

## Report a problem

1. Press **Problem**.
2. Choose a **Category**: **Access**, **Damage**, **Technical**, **Safety**, **Materials short** or **Other**.
3. Describe **What is wrong**.
4. Add a **Photo** if it helps.
5. Press **Problem** in the window.

The problem is raised as an issue on the job and a task goes to the office to deal with it. **Safety** and **Technical** problems stop the job being marked complete until they are resolved.

## Report a variation

Use this for extra or different work the customer wants.

1. Press **Variation**.
2. Describe **What is needed**.
3. Add a **Photo** if it helps.
4. Press **Variation** in the window.

The variation goes to the variation approver as a task to decide on.

## What happens next

The card in **My installs** shows the number of open issues on the work. The office follows the issue up on the job's **Operations** tab.

## If you can't do it

- **You're not allocated to this work package.** Only the allocated installer, or office staff, can report from this page.
- Office staff must fill in **Why the office is recording this**.
- This feature may not be switched on yet. Ask an administrator.
