---
slug: programme-reports
title: Reading the daily and weekly programme report
summary: Where to find the day's and the week's figures for a programme, what each number counts, and how to export the detail.
category: programmes
roles: ["Admin", "Manager", "Director", "Office"]
release_function: FN-22
routes: ["/dashboard/operations/programmes/[programmeId]/report"]
tools: ["programme_daily_report", "programme_summary", "report_preview"]
keywords: ["report", "daily report", "weekly report", "figures", "attended", "sims swapped", "no access", "confirmed live", "export", "spreadsheet", "progress", "target"]
aliases: ["daily report", "weekly report", "programme figures", "export the report", "download the report", "how many done today", "progress against target", "report for the client", "yesterdays report"]
related: ["automated-reports", "programmes-overview", "programme-board", "review-a-programme-visit"]
common_task: true
sort: 60
sources: ["src/app/dashboard/operations/programmes/[programmeId]/report/page.tsx", "src/features/programmes/components/daily-report.tsx", "src/features/programmes/report-email.ts", "src/features/programmes/components/export-button.tsx"]
---
Open a programme and choose **Reports** to read the day as the client would read it. Nothing on this page is sent to anybody by opening it.

## What the figures mean

- **Attended**: visits made, whatever the outcome. Attended is not the same as finished.
- **SIMs swapped**: visits where a new SIM was fitted.
- **No access**: nobody in, so the property needs another appointment.
- **Meters requiring replacement** and **action required**: properties that need something else doing.
- **Confirmed live** and **not live**: what the office found in the client's portal.
- **Still awaiting review**: sent in but not yet checked, so not yet counted as either.

Underneath, each visit is listed with its address, outcome, current state and portal result, so a figure can always be traced to the properties behind it.

## Choosing a period

The page shows today by default. Pick another date to read that day. Switching to the weekly view shows the whole week, starting on the day the programme's weekly report starts, in UK time. The weekly view is exactly what the weekly email carries, from the same figures, so what you read and what the client receives cannot differ.

## Progress against target

The programme's own page shows how many properties are loaded and how far through the target the work is. The target is set per programme by whoever set it up; it is not a fixed number, and it changes if the client changes their order.

## Exporting

**Export** downloads the day's detail as a spreadsheet for anyone who wants to work on the figures themselves. The summary figures on the page are the same ones the emailed report uses.

## If you can't do it

- **You do not have access to this programme's reporting**: reporting is limited to office staff, managers, administrators and directors.
- Figures look low for today: visits only appear once the installer has sent them in.
