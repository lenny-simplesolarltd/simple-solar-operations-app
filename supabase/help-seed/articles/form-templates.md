---
slug: form-templates
title: Form templates
summary: Create reusable form templates, start new forms from them, and save an existing form as a template.
category: forms
roles: ["Admin", "Manager", "Office"]
release_function: FN-21
routes: ["/dashboard/forms", "/dashboard/forms/[id]"]
tools: ["save_form_as_template", "create_form", "list_forms"]
keywords: ["template", "templates", "reuse", "copy", "duplicate", "starting point", "new form from template", "save as template"]
aliases: ["form templates", "create a template", "new template", "use a template", "save as template", "copy a form", "duplicate template", "reuse a form", "template for forms", "archive template"]
related: ["build-a-form", "forms-overview", "send-a-form", "switched-off-features"]
common_task: false
sort: 40
sources: ["src/app/dashboard/forms/page.tsx (Templates tab, New template)", "src/features/forms/components/new-form-dialog.tsx", "src/features/forms/components/form-builder.tsx (More actions: Create a form from this template, Duplicate template, Save as template, Archive, Restore)", "src/features/forms/errors.ts", "supabase/migrations/20260919190000_forms.sql (forms.templates.manage: Admin/Manager/Office)"]
---
A template is a reusable starting point. Forms made from a template are independent copies: changing the template later does not change them.

## Before you start

Forms must be switched on. Templates cannot be published or sent themselves. You make a form from them first.

## Create a template

1. Open **Forms** and choose the **Templates** tab.
2. Press **New template**, give it a **Title** and press **Create**.
3. Add questions just as you would on a form, then press **Save draft**.

## Start a form from a template

- Press **New form** on the **Forms** tab and choose the template under **Start from**, or
- open the template and choose **Create a form from this template** from the **More actions** menu.

## Save a form as a template

Open the form and choose **Save as template** from the **More actions** menu.

## Other template actions

From the **More actions** menu you can **Duplicate template**, **Archive** it, or **Restore** an archived one. Use **Show** to switch between **Current** and **Archived** templates.

## If you can't do it

- **That template is archived. Restore it first.**
- **Templates cannot be sent. Create a form from it first.**
- **You do not have permission to do that with forms.** Only office staff, managers and administrators manage templates.
- This feature may not be switched on yet. Ask an administrator.
