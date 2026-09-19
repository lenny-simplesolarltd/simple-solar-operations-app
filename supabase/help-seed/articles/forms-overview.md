---
slug: forms-overview
title: Forms - what it is and who can use it
summary: What the Forms area does, why you may not see it yet, and what each role can do with forms, templates, links and responses.
category: forms
roles: []
release_function: FN-21
routes: ["/dashboard/forms"]
tools: ["list_forms", "get_form", "list_form_responses", "get_form_response"]
keywords: ["forms", "form builder", "templates", "responses", "links", "survey", "questionnaire", "switched off", "customer form", "surveyor form"]
aliases: ["forms", "where is forms", "forms menu missing", "cant see forms", "forms switched off", "online form", "customer questionnaire", "send a survey", "form builder", "who can use forms", "forms not working"]
related: ["build-a-form", "send-a-form", "form-templates", "switched-off-features", "staff-roles", "what-simplebot-can-do"]
common_task: false
sort: 10
sources: ["docs/forms/ARCHITECTURE.md", "src/app/dashboard/forms/page.tsx", "src/features/forms/components/forms-not-enabled.tsx", "src/components/layout/nav-visibility.ts (forms: hidden unless released and forms.read)", "supabase/migrations/20260919190000_forms.sql (role_permissions: Admin/Manager/Office all forms.*; Director forms.read + forms.responses.read; FN-21 Disabled)"]
---
**Forms** lets the office build online forms, send a secure link to a customer, a surveyor or someone else, and read what they send back.

## Is it switched on?

Forms is switched off until an administrator switches it on. While it is off:

- **Forms** does not appear in the menu.
- Opening a Forms page shows "Forms is switched off at the moment. Nothing is wrong with your account: it will work here once it has been switched on."
- Links already sent to recipients stop working until it is switched on again.
- SimpleBot cannot help with forms.

## Who can do what

- **Office staff, managers and administrators** can build and publish forms, manage templates, create and revoke links, and read responses.
- **Directors** can see forms and read responses, but cannot change or send them.
- **Surveyors, installers and everyone else** do not use the Forms area. They can be sent a link and fill the form in like a customer.

## The three views

Open **Forms** and choose a tab:

- **Forms**: the forms you send. Each shows its status, **Draft**, **Published**, **Closed** or **Archived**, and its version.
- **Templates**: reusable starting points for new forms.
- **Responses**: every link sent, with its status and, once answered, the response.

Nothing sends email or text messages yet. You copy each link and send it yourself.

## If you can't do it

- **Forms** is missing from the menu, or the page says it is switched off: this feature may not be switched on yet. Ask an administrator.
- **You do not have permission to do that with forms.** Your role can only view, or has no forms access.
