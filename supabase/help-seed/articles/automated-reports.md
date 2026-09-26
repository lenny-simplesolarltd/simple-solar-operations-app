---
slug: automated-reports
title: Reports that email themselves
summary: How to set up a daily or weekly report that emails itself, who it goes to, how to send one by hand, and what each delivery state really means.
category: programmes
roles: ["Admin", "Manager", "Director", "Office"]
release_function: FN-22
routes: ["/dashboard/operations/programmes/[programmeId]/report", "/dashboard/forms/[id]/reports"]
tools: ["report_schedule", "report_preview", "report_schedule_set", "report_recipients_change", "report_schedule_delete", "report_send"]
keywords: ["automated report", "schedule", "email report", "daily", "weekly", "recipients", "send now", "pause", "subscription", "sent", "queued", "failed", "history"]
aliases: ["schedule a report", "email the report automatically", "send the report to the client", "who gets the report", "add a recipient", "pause a report", "send now", "report not sent", "was the report sent", "stop a report"]
related: ["programme-reports", "programmes-overview", "forms-overview", "simplebot-confirmations", "switched-off-features"]
common_task: true
sort: 70
sources: ["src/features/programmes/components/report-schedules.tsx", "src/features/programmes/report-status.ts", "src/features/programmes/server/recipients.ts", "supabase/migrations/20260926090000_report_subscriptions.sql"]
---
A programme's daily and weekly report, and a form's responses, can email themselves. You find this under **Reports** on a programme, or **Responses & reports** on a form.

## Setting one up

Press **Set up** next to **Daily** or **Weekly**. Choose the hour it goes out, in UK time, and for a weekly report the day the week starts on. Add each address under **Send to**. Tick to switch it on, then **Save**. **Preview** shows exactly what would be sent.

A report is only built once its period has finished, so a daily report sent in the morning covers yesterday, in full. The clock follows UK time all year, including when the clocks change.

## Who it goes to

Recipients are named people, chosen when you set the schedule up. They are not a role. If it went to "whoever is in the office", giving somebody the office role next month would quietly start sending them a client's report, and nobody would have decided that.

Asking SimpleBot to send a report to "the office" is a way of choosing people, not a rule it stores: it shows you who that is today and saves those people, after you confirm. Someone with no address on file is named and left out rather than guessed at. Adding an address here is a standing instruction, so check it before you save.

## Sending one by hand

**Send now** sends the current period immediately. It will not send the same period twice, so a report the schedule already sent is not duplicated, and one sent by hand is not sent again later.

## What the states mean

**Built** and **Ready to send** mean it exists but has not left. **Queued** and **Sending** mean it is on its way. **Sent** means it actually went. **Not sent**, **Unconfirmed**, **Refused** and **Failed** each mean it did not arrive, and the reason is shown. **Recent reports** lists what happened and whether each was scheduled or sent by hand.

## If you can't do it

- Nothing sends: outgoing email is switched off, or the recipients are not yet allowed. Ask an administrator.
- You can see the schedules but not change them: your role is view-only.
