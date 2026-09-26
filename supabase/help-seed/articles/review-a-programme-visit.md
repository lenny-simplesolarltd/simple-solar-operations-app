---
slug: review-a-programme-visit
title: Reviewing a programme visit
summary: How the office checks a visit, why the client's portal has to be checked before a property can be called complete, and what each review reason means.
category: programmes
roles: ["Admin", "Manager", "Director", "Office"]
release_function: FN-22
routes: ["/dashboard/operations/programmes/[programmeId]/review", "/dashboard/operations/programmes/[programmeId]/visits", "/dashboard/operations/programmes/[programmeId]/visits/[visitId]"]
tools: ["programme_visit_search", "programme_visit_get", "programme_visit_evidence", "programme_review_visit"]
keywords: ["review", "office", "portal", "confirmed live", "not live", "unable to verify", "disposition", "review reason", "signal", "antenna", "serial mismatch", "reopen"]
aliases: ["review a visit", "office review", "check a visit", "portal check", "confirm live", "mark complete", "why does this need a look", "reopen a review", "review queue"]
related: ["programmes-overview", "programme-board", "record-a-programme-visit", "programme-reports"]
common_task: true
sort: 50
sources: ["src/features/programmes/components/review-panel.tsx", "src/features/programmes/labels.ts", "src/app/dashboard/operations/programmes/[programmeId]/review/page.tsx"]
---
Every visit an installer sends in is checked by the office before the property counts as done.

## The queue

**Review** lists the visits waiting. Each one shows the property as the client has it, what the installer recorded, the photos, and a **Why this needs a look** panel when something needs attention: the meter on site is not the one the client's records name, there is nothing on file to compare it with, the signal is weak or marginal, nobody was in, the meter was dead, or the installer reported the meter not working after the change.

## Checking one

1. Compare the expected details with what the installer recorded, and look at the photos.
2. **Portal verification**: check the client's portal yourself and record what you found — confirmed live and reporting, not live, or unable to verify. Where no SIM was changed there is nothing to check and this step is skipped.
3. **Final disposition**: choose where the property now stands. **Complete & working** is only offered once you have confirmed the meter is live. Everything else is available at any time.
4. Add an office note saying what needs doing, or what you checked, and press **Record review**.

A reviewed visit can be reopened with **Reopen for review** if something later turns out to be wrong. Who reviewed it and when is kept, and every change is recorded.

## Why the portal step cannot be skipped

A strong signal reading only means the SIM has a connection. It does not mean the meter has started reporting to the client. Treating one as the other is what lets a property be called finished while its meter is dark, so the only thing that can finish a property is somebody confirming it in the portal.

## If you can't do it

- **You can see this visit but not review it**: your role is view-only. Directors read everything and change nothing.
- **Complete & working** is greyed out: record the portal check first.
- The queue is empty: nothing is waiting. The board shows everything already dealt with.
