---
slug: why-cant-i-complete-a-job
title: Why can't I complete this job?
summary: Every reason the system refuses to mark a job operationally complete, what each message means and how to clear it.
category: commissioning
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]"]
tools: ["find_job"]
keywords: ["complete", "completion", "operationally complete", "not ready", "completion checks", "blocking issue", "customer happy call", "installer confirmation", "commissioning", "greyed out"]
aliases: ["cant finish job", "can't complete job", "job wont complete", "complete job", "why cant I complete", "mark operationally complete greyed out", "completion checks are outstanding", "not ready to complete", "job stuck not complete", "complete button disabled", "cant close job", "finish job"]
related: ["complete-a-job", "record-a-call", "electrical-completion", "office-commissioning-record", "complete-a-task", "raise-an-issue", "switched-off-features", "staff-roles"]
common_task: true
sort: 50
sources: ["supabase/migrations/20260919146000_s10_s11_operations.sql (s10_evaluate_operational_completion, cmd_operational_complete, s10_create_issue blocks_completion default)", "supabase/migrations/20260919210000_r1_completion.sql (JOB_OPERATIONS completion.action flag, authorize_command_r1 OPERATIONAL_COMPLETE: Admin/Manager/Office, assigned, FN-19 + FN-11)", "src/features/jobs/components/operations/labels.ts (flagText, STATE, gateReasonText)", "src/features/jobs/components/operations/operations-tab.tsx", "supabase/migrations/20260919165000_r3_installer_commissioning.sql (Safety/Technical problems and return visits block completion)"]
---
The **Mark operationally complete** button on the job's **Operations** tab stays greyed out until everything is in place. The reason is shown under the button, and the **Completion** card lists what is missing.

## Completion checks

The **Completion** card shows a tick or a cross for each check:

- **Installer confirmed every required work package.** Message: "Installer confirmation is missing for a required work package". Record the installer confirmation call task with **Work complete** and **Yes**. A job with no booked work packages also fails this check.
- **Commissioning recorded**, one line per trade that needs it, usually Electrical. Message: "Commissioning is not recorded for Electrical". See [Recording commissioning on a job](/help/office-commissioning-record).
- **Customer happy call done.** Message: "The customer happy call is not recorded yet". Record the customer happy call task with **Customer happy?** answered **Yes**. This task is only raised once every work package is confirmed.
- **No blocking issues open.** Message: "An issue that blocks completion is still open". Resolve it in **Issues** on the same tab. Issues marked **Blocks completion** include office issues that affect the customer, customer complaints, return visits and installers' safety or technical problems.

## Other reasons under the button

- **Completion checks are outstanding.** One of the checks above is not met.
- **Your role can't do this.** Only office staff, managers and administrators can complete a job.
- **You're not assigned to this job.** You must own a task or issue on the job. Managers and administrators can act on any job.
- **The job is cancelled or archived.**
- **Paused while a cancellation or reopen review is open.**
- **The job is already operationally complete.**
- **Switched off for this release. An administrator turns it on.** This feature may not be switched on yet. Ask an administrator.

## If you can't do it

If the button worked but the job still did not complete, something changed at the same moment. The system re-checks everything and changes nothing unless all checks pass. Refresh the page and look at the list again.
