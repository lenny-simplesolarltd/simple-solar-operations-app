---
slug: send-a-form
title: Sending a form link and reading responses
summary: Create a secure one-use link for a customer, surveyor or someone else, send it yourself, and read the response when it comes back.
category: forms
roles: ["Admin", "Manager", "Office", "Director"]
release_function: FN-21
routes: ["/dashboard/forms/[id]", "/dashboard/forms", "/dashboard/forms/responses/[id]"]
tools: ["create_form_link", "revoke_form_link", "list_form_responses", "get_form_response"]
keywords: ["link", "send form", "recipient", "customer", "surveyor", "copy link", "revoke", "expiry", "responses", "submitted", "awaiting response"]
aliases: ["send a form", "send form to customer", "form link", "create link", "copy link", "revoke link", "link expired", "resend form", "read responses", "form response", "did the customer fill in the form", "form answers", "customer says link doesnt work"]
related: ["forms-overview", "build-a-form", "form-templates", "find-a-job", "switched-off-features"]
common_task: false
sort: 30
sources: ["src/features/forms/components/share-links.tsx", "src/app/dashboard/forms/page.tsx (Responses view)", "src/app/dashboard/forms/responses/[id]/page.tsx", "src/app/f/[token]/page.tsx (recipient messages)", "src/features/forms/errors.ts", "docs/forms/ARCHITECTURE.md (no email/SMS; one submission per link)", "supabase/migrations/20260919190000_forms.sql (forms.send: Admin/Manager/Office; forms.responses.read also Director)"]
---
Each link is for one recipient and works once. The system does not send email or text messages, so you copy the link and send it yourself.

## Before you start

- The form must be **Published**. See [Building and publishing a form](/help/build-a-form).
- Creating links is for office staff, managers and administrators. Directors can read responses.

## Create and send a link

1. Open the form. Under **Recipient links**, press **Create link**.
2. Under **Who is it for?** choose **Customer**, **Surveyor** or **Other**.
3. For a customer, choose the **Job** whose customer this is. For others the job is optional.
4. For a surveyor, choose the **Surveyor**. For anyone else, enter the **Recipient name**.
5. Choose **Link expires after**: **7 days**, **30 days**, **90 days** or **No expiry**.
6. Press **Create link**, then **Copy**, and send the link by your usual email or message.

## Read responses

- On the form, each link shows **Ready to send**, **Submitted**, **Revoked**, **Expired** or **Form closed**. Press **View response** on a submitted link.
- Or open **Forms**, choose **Responses**, and filter by **Form**, **Status**, **Recipient**, **Created** date or job reference.
- A response shows the answers against the version the recipient saw, with **Open the form** and **Open the job** links.

## Change or cancel a link

- Lost the link? Press **Copy link** on it again.
- Press **Revoke** to stop a link working immediately. You can then create a new one.

## If you can't do it

- **Publish the form to create links.**
- **Choose the job whose customer this is for.**
- **Recipient links are not set up on this server yet.** Tell an administrator.
- The recipient sees **This link has expired** or **This link is no longer active**: create a new link.
- This feature may not be switched on yet. Ask an administrator.
