---
slug: file-permissions
title: Who can see files
summary: Which staff can see and open which files, and why a file may be hidden from you.
category: files
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]", "/dashboard/tasks/[taskId]", "/dashboard/installs/[workPackageId]"]
tools: []
keywords: ["file permissions", "who can see", "access", "privacy", "contract access", "installer photos", "store delivery notes"]
aliases: ["who can see files", "why cant I see the contract", "file access", "can installers see contract", "file hidden", "share file", "send file to customer", "file permissions", "private files"]
related: ["find-customer-files", "upload-a-file", "signed-contract", "staff-roles"]
common_task: false
sort: 40
sources: ["supabase/migrations/20260919183000_p0_evidence.sql (app.can_read_evidence, evidence_installer_categories)", "supabase/migrations/20260919170000_view_port_reads.sql (app.can_read_job)", "src/app/api/evidence/[evidenceId]/route.ts (60-second links, not-found wording)", "docs/evidence.md (Reading)"]
---
Files are private. The app decides who may see each file from the job it belongs to and what kind of file it is. Everyone else is told "That file could not be found."

## Who sees what

- **Office, Admin, Manager, Director and Variation Approver staff:** every file on every job.
- **Surveyors:** every file on the jobs they sold or submitted.
- **Finance staff:** every file on jobs where they own or back up a task.
- **Store staff:** delivery note photos only.
- **Installers:** only installation photos (progress, completion, commissioning, problem, variation and return visit photos) for work they are currently allocated to. Installers never see contracts, finance agreements, customer details or delivery notes.
- **People whose account is switched off:** nothing.

## Opening files safely

- Every **Open** or **Download** click creates a private link that lasts about a minute and only works for you.
- There is no public or permanent link to a file. To give someone a copy, download it and send it through the usual company route.
- The app does not share files with customers.

## Who can add files

Adding a file follows the step it belongs to: the task's owner or backup when completing an office task, allocated installers (or the office) for installation photos, and goods-in staff for delivery notes. See [uploading a file](/help/upload-a-file).

## If you can't do it

- **"That file could not be found."** Either the file does not exist or your role cannot see it. Ask the office if you need it.
- **"Your account cannot open files."** Your staff record has no active role. Ask an administrator.
