---
slug: add-evidence-to-a-task
title: Adding evidence to a task
summary: How to upload a photo or PDF as evidence for a task, which file types are accepted, and how to open files already added.
category: tasks
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: []
keywords: ["evidence", "upload", "file", "photo", "pdf", "signed contract", "attach", "finance agreement", "document"]
aliases: ["upload a file to a task", "attach signed contract", "add photo", "add a document", "upload contract", "attach evidence", "upload failed", "file too big", "wrong file type", "where are the files"]
related: ["complete-a-task", "upload-a-file", "find-customer-files", "task-blocked", "signed-contract", "pre02-check-contract-signed"]
common_task: false
sort: 40
sources: ["src/features/tasks/components/task-actions.tsx (EvidenceField in Complete, AttachEvidence)", "src/features/operations/evidence-field.tsx", "src/features/operations/evidence-rules.ts", "src/features/operations/evidence-list.tsx", "src/app/dashboard/tasks/[taskId]/page.tsx", "docs/evidence.md", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_evidence_attach)", "supabase/migrations/20260919149000_s17_reads_rls.sql (read_task_action_availability, result_error_catalogue)"]
---
Files are added to a task while you complete it. The contract task also has its own **Attach signed contract** button.

## Before you start

- Only photos (JPG, PNG, WebP, HEIC) and PDF files can be added. Each file must be 25 MB or smaller.
- You must be allowed to complete the task: its owner or backup, or an Admin or Manager.
- The task must belong to a job.

## Adding a file while completing

1. Open the task and press **Complete**.
2. Use the file box in the form. It is labelled for the task, for example **Signed contract**, **Supporting document (optional)**, **Finance agreement (optional)** or **Evidence (optional)**. A red star means the file is required.
3. Wait for the tick and **Uploaded** with the file name.
4. Finish the form and submit it. The file is only linked to the task when the form is accepted.

## Attaching a signed contract on its own

On the **Check contract sent/signed** task, press **Attach signed contract**, choose the file and press **Attach**. On an open task, you still need to complete it afterwards to record the contract as signed. You can also use this on a completed contract task that has no file yet.

## Seeing the files

The **Evidence** section on the task lists every file with its type, date and who added it. Press **Open** or **Download**. **Replaced** marks an older file that a newer one has taken over from. Files are never deleted.

## If you can't do it

- **Files must be 25 MB or smaller** or **Only photos (JPG, PNG, WebP, HEIC) and PDF files can be added**: choose a different file.
- **The upload failed. Try again.** Press **Try again**. It will not create a duplicate.
- **Contract evidence is already attached to this task**: nothing more is needed.

This feature may not be switched on yet. Ask an administrator.
