---
slug: merchant-orders
title: Merchant orders
summary: Send a draft order, record the merchant's confirmation, revise or cancel an order, and prepare the weekly delivery lists.
category: materials
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover", "Store"]
release_function: FN-03
routes: ["/dashboard/orders", "/dashboard/orders/[orderId]"]
tools: []
keywords: ["orders", "merchant", "purchase order", "send order", "confirmation", "merchant reference", "revise", "revision", "cancel order", "weekly delivery list", "supplier"]
aliases: ["merchant orders", "send order to merchant", "place order", "record merchant confirmation", "merchant confirmed", "order reference", "change order", "amend order", "revise order", "cancel order", "weekly delivery lists", "friday list", "needs merchant reply", "supplier order"]
related: ["materials-for-a-job", "goods-in", "stock", "my-tasks", "switched-off-features"]
common_task: true
sort: 20
sources: ["src/app/dashboard/orders/page.tsx", "src/app/dashboard/orders/[orderId]/page.tsx", "src/features/materials/components/order-actions.tsx", "src/features/materials/labels.ts (ORDER_STATUS, ORDER_VIEWS)", "supabase/migrations/20260919161000_r2_materials_ordering.sql (ORDER_SEND captures the message only, no email; ORDER_CONFIRM creates expected delivery + MAT04; ORDER_REVISE; ORDER_CANCEL refused after goods received; MERCHANT_WEEKLY_LIST; roles Admin/Manager/Office FN-03)"]
---
**Merchant orders** shows orders across every job. Open an order to send it, record the merchant's confirmation, revise it or cancel it.

## Before you start

Office, store and management staff can view orders. Only office staff, managers and administrators see the order buttons, and the job must be assigned to you. Draft orders are created with **Build orders** on the job's materials page.

## Steps

1. Open **Merchant orders**. Use the tabs **Open**, **To send**, **Awaiting confirmation**, **Due in**, **Received**, **Cancelled** or **All**, pick a **Merchant**, or search.
2. Open an order. It shows its status, revision, the lines with **Ordered**, **Received** and **Outstanding**, the **Deliveries** and the merchant contact.
3. Press **Send to merchant** and say whether it is **Urgent?**. The order message is recorded and the order waits for the merchant's reply. The system does not email the merchant, so send the order by your usual route.
4. When the merchant replies, press **Record confirmation**. Enter the **Merchant reference**, the **Confirmed delivery date**, the **Revision they replied to** and **Their reply**.
5. To change quantities or the delivery date, press **Revise**, make the changes and give a **Reason**. If the merchant already has the order, it goes back to them for confirmation and shows **Needs merchant reply**.
6. To cancel, press **Cancel order** and give a **Reason**. Its lines go back to **To order**.

## What happens next

A confirmed order creates an expected delivery. It appears in **Goods in** with a task to receive it on the day. See [Goods in](/help/goods-in).

**Weekly delivery lists** at the top prepares next week's list for each merchant, with follow-up tasks. Nothing is emailed from here.

## If you can't do it

- A reply to an older revision is recorded but does not confirm the order. Record the reply to the latest revision.
- **Cancel order** is not offered once any goods have been received.
- This feature may not be switched on yet. Ask an administrator.
