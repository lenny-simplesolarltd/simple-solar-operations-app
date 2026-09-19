---
slug: materials-for-a-job
title: Materials for a job
summary: See what each job needs, add material lines, and turn the lines still to order into draft merchant orders.
category: materials
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover", "Store"]
release_function: FN-03
routes: ["/dashboard/materials", "/dashboard/materials/[jobId]"]
tools: []
keywords: ["materials", "requirements", "to order", "build orders", "add material", "need by", "lead time", "at risk", "merchant", "stock", "already ordered"]
aliases: ["materials", "job materials", "what needs ordering", "order materials", "add material", "add a material line", "build orders", "materials needed", "order by date", "lead time risk", "check external order", "materials at risk", "what materials does this job need"]
related: ["merchant-orders", "goods-in", "stock", "stock-for-a-job", "job-detail", "switched-off-features"]
common_task: true
sort: 10
sources: ["src/app/dashboard/materials/page.tsx", "src/app/dashboard/materials/[jobId]/page.tsx", "src/features/materials/components/material-actions.tsx (AddMaterial, BuildOrders)", "src/features/materials/labels.ts (MATERIAL_STATE)", "src/components/layout/nav-visibility.ts (materials: office class + Store)", "supabase/migrations/20260919161000_r2_materials_ordering.sql (MATERIAL_ADD / ORDERS_BUILD: Admin/Manager/Office, job-scoped, FN-03; MAT02/MAT03 tasks; MAT_REVIEW refusals)", "supabase/migrations/20260919172000_view_port_materials_reads.sql (MATERIALS_BOARD roles, no gate)"]
---
**Materials** shows every job whose materials still need ordering, confirming or receiving, with the soonest need-by date first. Open a job to see its lines and orders.

## Before you start

Anyone in the office and the store can view **Materials**. Only office staff, managers and administrators see **Add material** and **Build orders**, and the job must be assigned to you.

## Steps

1. Open **Materials** from the menu. Choose **Needs action** or **All with materials**, or search by job, customer or postcode.
2. Coloured badges show counts such as **to order**, **at risk**, **awaiting confirmation** and **part received**. Click a job.
3. The **Requirements** table lists each line with its quantity, merchant, **Needed by** date and state. **Order by** in red means the merchant's lead time is at risk.
4. To add a line, press **Add material**:
   - Choose **Where it comes from**: **Order from a merchant**, **Already ordered elsewhere** or **Take from our stock**.
   - Pick a **Product**, or choose **Not in the catalogue** and give a description and unit.
   - Enter the **Quantity** and **Needed on site by**. Add the **External order reference** for goods already ordered.
5. Press **Build orders**. Lines still to order are grouped by merchant and trade into draft orders. Nothing is sent to a merchant yet.

## What happens next

Draft orders appear under **Merchant orders** on the same page. See [Merchant orders](/help/merchant-orders). Lines from our stock are handled under **From our stock**.

## If you can't do it

- **Build orders** is greyed out: nothing is left to order.
- **This needs checking before it can go ahead: material has no merchant** (or **no need_by_date**). Add the missing merchant or date to the line.
- **You don't have permission to do this.** You are not assigned to the job, or your role cannot order.
- This feature may not be switched on yet. Ask an administrator.
