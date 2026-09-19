---
slug: stock
title: Stock in the store
summary: See what is in the store, reserved and in quarantine, record opening counts, quarantine damaged stock and run a stocktake.
category: materials
roles: ["Store", "Manager", "Admin"]
release_function: FN-05
routes: ["/dashboard/stock"]
tools: []
keywords: ["stock", "store", "stocktake", "count", "opening count", "quarantine", "damaged stock", "available", "reserved", "balance", "variance", "panels"]
aliases: ["stock", "stock levels", "how many in stock", "whats in the store", "stock count", "stocktake", "count stock", "opening count", "quarantine stock", "damaged stock", "stock variance", "approve stocktake", "panels in stock"]
related: ["goods-in", "stock-for-a-job", "materials-for-a-job", "switched-off-features"]
common_task: false
sort: 40
sources: ["src/app/dashboard/stock/page.tsx", "src/features/materials/components/stock-actions.tsx", "src/components/layout/nav-visibility.ts (stock: Admin, Manager, Store)", "supabase/migrations/20260919172000_view_port_materials_reads.sql (STOCK_OVERVIEW Store/Manager/Admin, FN-05)", "supabase/migrations/20260919162000_r2_stock.sql (STOCK_OPENING_COUNT, STOCK_QUARANTINE, STOCKTAKE_START/COUNT/APPROVE: Store/Manager/Admin, FN-05; STK_REVIEW refusals)"]
---
**Stock** shows every stock-tracked product: how many are **In store**, **Reserved** for jobs, **Available** and in **Quarantine**. Balances are worked out from every stock movement, so they cannot be typed in directly.

## Before you start

**Stock** is in the menu under **Materials** for store staff, managers and administrators. If it says **Stock locations are not set up**, ask an administrator.

## Opening count

Each product needs one opening count before its balance is right.

1. Find the product. Use the search box for product name or SKU.
2. Press **Opening count**, enter the **Quantity** and a **Reason**, and confirm. This can only be done once per product.

## Quarantine damaged stock

1. Press **Quarantine** on the product.
2. Enter the **Quantity** and a **Reason**, and confirm. The stock leaves the usable store. It cannot be moved back from here.

## Stocktake

1. Press **Start stocktake**. The expected quantity of every product is frozen at that moment.
2. For each product press **Count**, enter the **Counted** quantity and choose **Counted as at**: **The stocktake start**, or **Now** if stock has moved since. Give a **Reason for any difference**.
3. Use **Recount** to correct a count.
4. When every line is counted, press **Approve stocktake**. Any differences are posted to the stock.

## If you can't do it

- **Quarantine** is greyed out when there is nothing in the store.
- **This needs checking before it can go ahead: variance reason required.** Give a reason for the difference.
- **This needs checking before it can go ahead: movements after cut-off; count AtCount.** Stock moved since the start. Choose **Now**.
- **There isn't enough stock available for that quantity.**
- **Not switched on yet.** This feature may not be switched on yet. Ask an administrator.
