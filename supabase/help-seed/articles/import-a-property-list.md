---
slug: import-a-property-list
title: Loading a programme property list
summary: How to load or top up a programme's property register from a spreadsheet, what each column must contain, and how duplicates and bad rows are handled.
category: programmes
roles: ["Admin", "Manager", "Office"]
release_function: FN-22
routes: ["/dashboard/operations/programmes/[programmeId]/import", "/dashboard/operations/programmes/[programmeId]/properties"]
tools: ["list_programme_imports", "explain_programme_import", "apply_programme_import", "discard_programme_import"]
keywords: ["import", "upload", "spreadsheet", "csv", "property list", "register", "addresses", "meter serial", "duplicate", "rejected rows", "draft"]
aliases: ["import properties", "upload property list", "load addresses", "csv import", "import failed", "rows rejected", "duplicate property", "top up the list", "discard an import", "why was my row rejected"]
related: ["programmes-overview", "programme-board", "programme-reports", "what-simplebot-can-do"]
common_task: true
sort: 20
sources: ["src/app/dashboard/operations/programmes/[programmeId]/import/page.tsx", "src/features/programmes/server/import-from-file.ts", "supabase/migrations/20260925170000_programme_source_identity.sql", "supabase/migrations/20260926080000_programme_identity_hotfix.sql"]
---
The property register is loaded from a spreadsheet. You can load it in one go or top it up whenever the client sends more addresses.

## Loading a list

1. Open the programme and press **Import properties**.
2. Choose your file. A comma-separated file saved from Excel works best.
3. Check the summary: how many rows were read, how many are new, how many already exist, and how many were rejected.
4. Press **Apply** to add them, or **Discard** if the file was wrong.

Nothing changes until you press **Apply**. An import you neither apply nor discard stays as a draft and can be picked up later.

## What each row needs

Every row needs an address and a postcode. It also needs the value the client uses to identify the property, which the programme is set up to expect. For the PCH programme that is the meter serial number; other programmes may use the client's own reference instead. Other columns, such as the existing SIM type or a contact note, are kept if they are there and left empty if they are not.

Rejected rows are listed with the reason, so you can correct them and load the file again. Nothing is half-loaded: a rejected row is simply not there.

## Loading the same file twice

A row is matched on the identifying value, so re-sending a file already loaded updates those properties rather than creating a second copy of each address. This means you can safely load a corrected file, and a client's weekly list that repeats earlier addresses will not fill the register with duplicates.

## If you can't do it

- **Rows rejected** with a missing identifier means the column the programme expects is empty or absent. Check the heading spelling.
- **This programme already has an import in progress**: apply or discard that one first.
- You can ask SimpleBot to explain an import, and to apply or discard one after confirming with you.
