---
slug: record-a-programme-visit
title: Recording a programme visit
summary: How an installer finds the next property, records what happened at the door, adds photos, and what to do when the meter serial does not match.
category: programmes
roles: ["Admin", "Manager", "Office", "Installer"]
release_function: FN-22
routes: ["/dashboard/operations/programmes/[programmeId]/visit", "/dashboard/operations/programmes/[programmeId]/visits"]
tools: ["programme_property_search", "programme_property_get", "programme_visit_submit", "programme_visit_submit_status"]
keywords: ["visit", "installer", "door", "SIM", "meter serial", "meter reading", "signal", "photo", "calling card", "no access", "tenant not home", "dead meter"]
aliases: ["record a visit", "installer visit", "sim swap", "log a visit", "no access", "tenant not home", "meter dead", "wrong meter serial", "visit photos", "send in a visit"]
related: ["programmes-overview", "review-a-programme-visit", "programme-board", "upload-a-file"]
common_task: true
sort: 40
sources: ["src/app/dashboard/operations/programmes/[programmeId]/visit/page.tsx", "src/features/programmes/components/visit-form.tsx", "src/features/programmes/labels.ts", "src/features/programmes/components/photo-field.tsx"]
---
Installers record each property at the door, one at a time, on a phone.

## Finding the property

Open the programme and press **Record a visit**. Search by postcode, address or the client's property reference. You only see the properties in this programme, and the details on file are shown so you can check you are at the right address before you start.

## What to record

- **What happened**: nobody in, the SIM was changed and the meter appears to be working, the SIM was changed and the meter is not working, or the meter is dead.
- **The meter serial you can actually see**, even when it differs from the one on file. Record what is there; do not correct it to match.
- **The meter reading**, the **new SIM serial** when you fit one, and the **signal reading**.
- **Photos**: the meter, the SIM serial, the signal reading, and the calling card if you had to leave one.

The signal bands are shown on the form, so you can see whether what you have measured counts as good, marginal or too weak.

## Sending it in

Press **Submit**. The visit goes to the office as **Awaiting review**, and you are offered the next property straight away. Sending the same visit twice does not create two of them.

You cannot mark a property finished. That is the office's job, once they have confirmed the meter is reporting in the client's portal, because a good signal at the door does not prove it has gone live.

## If you can't do it

- You see no properties: they have not been assigned to you yet, or you are in the wrong programme.
- The serial you type does not match the one on file: send it anyway. The office is told, and will look at it.
- A photo will not attach: check the file is a photo and try again. The visit is kept while you do.
