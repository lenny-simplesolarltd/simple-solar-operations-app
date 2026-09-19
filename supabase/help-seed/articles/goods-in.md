---
slug: goods-in
title: Goods in - what to do when a delivery arrives
summary: Book in a merchant delivery at the store, recording good, damaged and short quantities against the order and the delivery note.
category: materials
roles: ["Store", "Office", "Manager", "Admin"]
release_function: FN-03, FN-05
routes: ["/dashboard/goods-in", "/dashboard/goods-in/[deliveryId]"]
tools: []
keywords: ["goods in", "delivery", "receive", "delivery note", "damaged", "short", "quarantine", "store", "merchant delivery", "part received", "book in"]
aliases: ["goods arrived", "delivery arrived", "delivery", "receive goods", "book in delivery", "record delivery", "delivery note", "damaged delivery", "short delivery", "missing items", "part delivery", "late delivery", "goods in", "stuff arrived"]
related: ["merchant-orders", "stock", "materials-for-a-job", "my-tasks", "switched-off-features"]
common_task: true
sort: 30
sources: ["src/app/dashboard/goods-in/page.tsx", "src/app/dashboard/goods-in/[deliveryId]/page.tsx", "src/features/materials/components/receive-form.tsx", "supabase/migrations/20260919162000_r2_stock.sql (GOODS_IN_RECEIVE: Store/Office/Manager/Admin, FN-03 + FN-05; good to Store, damaged to Quarantine; Supply issues for damaged/short; balance delivery + MAT04; GOODS_IN_DETAIL FN-03 + FN-05)", "supabase/migrations/20260919183000_p0_evidence.sql (Delivery upload context)", "supabase/migrations/20260919167000_result_catalogue_r2r4.sql"]
---
When a merchant delivery arrives at the store, record what came against the order. Good stock goes into the store, and damaged or missing items are raised with the office.

## Before you start

- Have the delivery note to hand. Its reference is required.
- Deliveries appear here once the merchant's confirmation has been recorded on the order.

## Steps

1. Open **Goods in**. **Expected deliveries** lists deliveries for **Next 7 days**, **Next 14 days** or **Next month**, plus any that are late (shown as **late**).
2. Click the delivery. The page shows the job, the expected date and each line still outstanding.
3. For each line, enter the quantity that arrived **Good**, **Damaged** and **Short**. **Good** starts filled with the full outstanding amount, so change it if less arrived. Leave a line blank if none of it came.
4. Enter the **Delivery note reference**.
5. Add a **Photo of the delivery note** if you can.
6. Describe anything else under **Anything wrong with the delivery?**
7. Press **Record delivery**.

## What happens next

- Good stock is added to the store. Damaged stock goes to quarantine.
- Damaged or short items raise a supply issue for the office.
- If the whole order has arrived it becomes **Received**. If not, it becomes **Part received** and a new expected delivery for the balance appears, with a task to receive it.
- The receive task for this delivery is completed.

## If you can't do it

- **Record delivery** is greyed out until the delivery note reference and at least one quantity are filled in.
- **This needs checking before it can go ahead: receipt exceeds outstanding quantity.** You entered more than is outstanding.
- **This needs checking before it can go ahead: delivery already received.** It has already been booked in.
- **Not switched on yet**, or the action is switched off: this feature may not be switched on yet. Ask an administrator.
