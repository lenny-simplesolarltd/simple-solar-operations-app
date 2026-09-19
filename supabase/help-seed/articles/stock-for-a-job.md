---
slug: stock-for-a-job
title: Reserving, picking and issuing stock for a job
summary: Set store stock aside for a job, record what was picked and issue it to the job site from the job's materials page.
category: materials
roles: ["Store", "Office", "Manager", "Admin"]
release_function: FN-05
routes: ["/dashboard/materials/[jobId]"]
tools: []
keywords: ["reserve", "pick", "issue", "stock", "from our stock", "picking", "job site", "store", "panels", "set aside"]
aliases: ["reserve stock", "pick stock", "issue stock", "take from stock", "stock for job", "from our stock", "picking list", "send stock to site", "set aside stock", "reserve panels", "pick for job", "issue to job"]
related: ["stock", "materials-for-a-job", "goods-in", "switched-off-features"]
common_task: false
sort: 50
sources: ["src/app/dashboard/materials/[jobId]/page.tsx (From our stock section, shown only when STOCK_JOB_PICKING succeeds)", "src/features/materials/components/material-actions.tsx (StockLineActions)", "supabase/migrations/20260919162000_r2_stock.sql (STOCK_RESERVE / STOCK_PICK / STOCK_ISSUE: Store/Office/Manager/Admin, FN-05; MAT03 completed on issue; STK_REVIEW refusals; STOCK_JOB_PICKING FN-05)"]
---
When a job's materials come from our own stock, the store sets the stock aside, picks it and issues it to the job. This happens in the **From our stock** section of the job's materials page.

## Before you start

- The line must be added with **Take from our stock**. See [Materials for a job](/help/materials-for-a-job).
- The **From our stock** section only appears when stock is switched on and the job has stock lines.

## Steps

1. Open **Materials** and click the job.
2. Under **From our stock**, each line shows how many are needed, reserved, picked and issued, and how many are available. The badge next to the heading says whether picking is **Ready** or **Blocked**. Any problem is shown in red under the line.
3. Press **Reserve**. Leave the **Quantity** blank to reserve everything outstanding, and confirm.
4. When you have picked the goods, press **Pick** and enter the **Picked** quantity.
5. When the goods leave for site, press **Issue to job**. Leave the quantity blank to issue everything picked.

## What happens next

Issued stock leaves the store and the line shows **Issued**. The reserve-and-pick task for that material is completed.

## If you can't do it

- **Reserve** is greyed out: nothing is available or nothing is outstanding.
- **Issue to job** is greyed out: pick before issuing.
- **This needs checking before it can go ahead: quantity exceeds outstanding requirement.** Reserve less.
- **This needs checking before it can go ahead: picked quantity must be > 0 and <= reserved.**
- **There isn't enough stock available for that quantity.**
- This feature may not be switched on yet. Ask an administrator.
