---
slug: programmes-overview
title: Programmes - what they are and who can use them
summary: What a property programme is, how the screens fit together, who can do what, and why you may not see Programmes in the menu yet.
category: programmes
roles: []
release_function: FN-22
routes: ["/dashboard/operations", "/dashboard/operations/programmes", "/dashboard/operations/programmes/[programmeId]"]
tools: ["programme_list", "programme_summary", "programme_capabilities"]
keywords: ["programme", "programmes", "PCH", "meter", "SIM replacement", "property", "property list", "visit", "contract", "client", "rollout"]
aliases: ["programmes", "what is a programme", "PCH", "meter sim replacement", "where is programmes", "cant see programmes", "programmes missing", "property programme", "who can see programmes"]
related: ["import-a-property-list", "programme-board", "record-a-programme-visit", "review-a-programme-visit", "programme-reports", "switched-off-features", "staff-roles"]
common_task: false
sort: 10
sources: ["supabase/migrations/20260921110000_programmes.sql", "supabase/migrations/20260921120000_programme_pch_2026.sql", "src/app/dashboard/operations/programmes/page.tsx", "src/features/programmes/server/queries.ts (programmesEnabled: fails closed)"]
---
A **programme** is a block of repeat work at many addresses for one client, rather than a single sale. The first one is the PCH meter and SIM replacement: a list of properties, one short visit each, and a report to the client showing how the work is going.

A programme is not a job. Nothing here creates a customer, a quote or an install. Programme properties never appear in the jobs list, and job screens never show programme work.

## Is it switched on?

Programmes is switched off until an administrator switches it on. While it is off, **Programmes** does not appear under Operations and the pages say so. This feature may not be switched on yet. Ask an administrator.

## The screens

- **Programmes** lists each programme with its target, how many properties are loaded, and progress so far.
- **Properties** is the register: every address, its reference, and where it has got to.
- **Board** moves properties between columns as the work progresses.
- **Visit** is what an installer fills in at the door.
- **Visits** lists what has been sent in, and each one opens for office review.
- **Review** is the office queue of visits waiting to be checked.
- **Reports** shows the day's and the week's figures, and sets up reports that email themselves.

## Who can do what

- **Office staff, managers and administrators** load the property list, run the board, review visits and set up reports.
- **Directors** can see everything and read reports, but change nothing.
- **Installers** see the properties assigned to them and send in visits. They do not see the client's figures or anyone else's visits.

## If you can't do it

- **You do not have permission to do that** means your role can view only.
- An empty programme list usually means no programme has been set up yet, not that something is broken.
