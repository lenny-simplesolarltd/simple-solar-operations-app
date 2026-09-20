---
slug: upload-a-file
title: Uploading a file
summary: Where you can add a file or photo in the app today, which file types and sizes are allowed, and what to do if an upload fails.
category: files
roles: []
release_function: FN-01, FN-03, FN-05, FN-06
routes: ["/dashboard/tasks/[taskId]", "/dashboard/jobs/[jobId]", "/dashboard/installs/[workPackageId]", "/dashboard/goods-in"]
tools: []
keywords: ["upload", "file", "photo", "evidence", "PDF", "attach", "file size", "file type", "HEIC"]
aliases: ["upload contract", "upload a file", "attach file", "add photo", "upload photo", "add document", "upload pdf", "file too big", "upload failed", "cant upload", "attach evidence", "which files can I upload"]
related: ["find-customer-files", "signed-contract", "add-evidence-to-a-task", "installation-photos", "record-commissioning", "goods-in", "switched-off-features"]
common_task: true
sort: 20
sources: ["src/features/operations/evidence-field.tsx", "src/features/operations/evidence-rules.ts (types, 25 MB, messages)", "src/features/tasks/components/task-actions.tsx (task upload fields)", "src/features/jobs/components/operations/actions.tsx (Record commissioning upload)", "src/features/installs/components/install-actions.tsx", "src/features/materials/components/receive-form.tsx", "supabase/migrations/20260919183000_p0_evidence.sql (evidence_upload_context, file rules, wording)", "docs/evidence.md"]
---
There is no general "upload to a job" button. You add a file as part of the step it proves, and the file is then kept on the job.

## Where you can upload

- **Completing a task:** the **Complete** form lets you add a file, for example **Signed contract** on PRE02, **Finance agreement** on PRE05 or **Evidence (optional)** on other job tasks.
- **Attach signed contract** on the PRE02 task.
- **Record commissioning** on a job's **Operations** tab: the certificate or commissioning evidence.
- **My installs:** progress and completion photos for installation work.
- **Goods in:** a **Photo of the delivery note**.

## Allowed files

- Photos: JPG, PNG, WebP and HEIC (iPhone photos).
- PDF documents.
- Each file must be 25 MB or smaller. Word, Excel and other file types cannot be added.

## Steps

1. Open the form where the file belongs, for example **Complete** on the task.
2. Choose the file in the upload field.
3. Wait for the tick and "Uploaded" with the file name.
4. Finish and submit the form as normal.

The file is only linked to the job when you submit the form.

## If you can't do it

- **"Only photos (JPG, PNG, WebP, HEIC) and PDF files can be added."** Save the document as a PDF first.
- **"Files must be 25 MB or smaller."** Use a smaller photo or compress the PDF.
- **"The upload failed. Try again."** Click **Try again**. The same file continues; it is not added twice.
- **"Your uploaded file never arrived. Upload the file again and try again."**
- **"This action is switched off at the moment. Ask an administrator."**, or the form's button is greyed out: this feature may not be switched on yet. Ask an administrator.
- **"Only the task owner, backup or an admin can do this."** Task files can only be added by the task's owner or backup.
