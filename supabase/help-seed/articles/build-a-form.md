---
slug: build-a-form
title: Building and publishing a form
summary: Create a form, add and arrange questions, preview it and publish it so links can be sent.
category: forms
roles: ["Admin", "Manager", "Office"]
release_function: FN-21
routes: ["/dashboard/forms", "/dashboard/forms/[id]", "/dashboard/forms/[id]/preview"]
tools: ["create_form", "edit_form_draft", "publish_form", "set_form_status", "get_form"]
keywords: ["new form", "build form", "questions", "publish", "draft", "preview", "version", "condition", "required", "close form", "archive form"]
aliases: ["create a form", "new form", "make a form", "add a question", "edit form", "publish form", "preview form", "change a published form", "close a form", "stop responses", "archive a form", "show question only when", "form versions"]
related: ["forms-overview", "send-a-form", "form-templates", "simplebot-basics", "switched-off-features"]
common_task: false
sort: 20
sources: ["src/features/forms/components/new-form-dialog.tsx", "src/features/forms/components/form-builder.tsx", "src/features/forms/definition.ts (field types)", "src/app/dashboard/forms/[id]/page.tsx (Published versions)", "src/features/forms/errors.ts", "docs/forms/ARCHITECTURE.md", "supabase/migrations/20260919190000_forms.sql (forms.create / forms.edit / forms.publish; FN-21)"]
---
You build a form as a draft, then publish it. Publishing creates a numbered version that cannot change, so every response is read against the exact questions the recipient saw.

## Before you start

Forms must be switched on. See [Forms](/help/forms-overview).

## Steps

1. Open **Forms**, stay on the **Forms** tab and press **New form**.
2. Enter a **Title**. Under **Start from**, choose **A blank form** or a template. Press **Create**.
3. Press **Add question** and pick a type: short or long text, email, phone, address, number, currency, rating scale, date, time, yes/no, single or multiple choice, dropdown, confirmation, section heading or text block.
4. Click a question to change its **Question**, **Helper text (optional)** and **Required** setting. For choices, type **Options, one per line**.
5. To show a question only when an earlier answer matches, use **Show this only when…**.
6. Use the arrows to reorder, or duplicate and remove questions.
7. Press **Save draft**, then **Preview** to see it as the recipient will.
8. Press **Publish**.

## What happens next

The form becomes **Published** and you can create links. Later edits change the draft only. Press **Publish v2** (and so on) to release them. Links already sent keep the version they were created with. Past versions are listed under **Published versions**.

From the **More actions** menu you can **Close (stop new responses)**, **Reopen**, **Duplicate form**, **Save as template** or **Archive**. Responses are kept.

## If you can't do it

- **Add at least one question before publishing.**
- **Nothing has changed since the last published version.**
- **Someone else changed this form since you opened it.** Press **Reload**. Nothing was saved.
- **This form is archived. Restore it before editing.**
- This feature may not be switched on yet. Ask an administrator.
