---
slug: find-customer-files
title: Finding, opening and downloading a job's files
summary: Where to find a customer's contract, photos and other files, and how to open or download them.
category: files
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]", "/dashboard/tasks/[taskId]", "/dashboard/installs/[workPackageId]", "/dashboard/commissioning/[workPackageId]"]
tools: []
keywords: ["files", "evidence", "photos", "contract", "documents", "open file", "download", "attachments"]
aliases: ["where is contract", "customer photos", "customer files", "find files", "job files", "where are the photos", "open a file", "download file", "view contract", "installation photos", "attachments", "documents for job", "finance agreement file"]
related: ["upload-a-file", "signed-contract", "file-permissions", "generated-documents", "installation-photos", "job-detail"]
common_task: true
sort: 10
sources: ["src/app/dashboard/jobs/[jobId]/page.tsx (Files tab)", "src/app/dashboard/tasks/[taskId]/page.tsx (Evidence card)", "src/app/dashboard/installs/[workPackageId]/page.tsx and src/app/dashboard/commissioning/[workPackageId]/page.tsx (Photos and files)", "src/features/operations/evidence-list.tsx", "src/features/operations/evidence-rules.ts (category labels)", "src/app/api/evidence/[evidenceId]/route.ts (60-second link, refusal wording)", "docs/evidence.md"]
---
Every file added in the app belongs to one job. You can find it in several places, depending on what it was added for.

## Where files are

- **The job's Files tab:** every file on the job in one list, under **Evidence and files**. Each file shows its type (for example **Signed contract**, **Finance agreement**, **Completion photo** or **Delivery note**), when it was added, who added it, its size and the task it belongs to.
- **A task's Evidence card:** the files added to that task, for example the signed contract on PRE02.
- **Photos and files on an install:** photos added to one piece of installation work, on **My installs** and on **Commissioning review**.

## Open or download a file

1. Open the job and choose the **Files** tab (or open the task or install).
2. Find the file.
3. Click **Open** to view it in a new browser tab, or **Download** to save a copy.

Each click gives you a fresh, private link that only works for about a minute. To look again later, click **Open** again. Do not copy the link to share it: it will not work for anyone else.

## Things to know

- A file marked **Replaced** has been replaced by a newer one. Both are kept.
- "Reference only - no stored file" means the record exists but there is no file to open.
- Files cannot be deleted or changed once saved.

## If you can't do it

- **"No files have been added to this job yet."** Nothing has been uploaded.
- **"That file could not be found."** The file does not exist, or you do not have access to it.
- **"That file is still uploading. Try again in a moment."**
- **"The record exists but the stored file is missing. Tell an administrator."**
- **A file you expect is not listed:** you may not be allowed to see it. See [who can see files](/help/file-permissions).
