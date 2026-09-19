---
slug: signed-contract
title: Signed contracts: where to upload and find them
summary: The signed contract is uploaded on the job's PRE02 task and can then be found on that task and on the job's Files tab.
category: files
roles: []
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]", "/dashboard/jobs/[jobId]"]
tools: ["get_job_tasks"]
keywords: ["signed contract", "contract", "PRE02", "Signable", "contract file", "contract status"]
aliases: ["where is contract", "signed contract", "upload contract", "upload signed contract", "find contract", "customer contract", "contract pdf", "has the customer signed", "contract status", "attach contract"]
related: ["pre02-check-contract-signed", "find-customer-files", "upload-a-file", "file-permissions", "generated-documents", "ready-to-book"]
common_task: true
sort: 30
sources: ["src/features/tasks/components/task-actions.tsx (PRE02 Signed contract field, Attach signed contract)", "src/app/dashboard/tasks/[taskId]/page.tsx (Evidence card)", "src/app/dashboard/jobs/[jobId]/page.tsx (Files tab)", "src/features/jobs/components/job-sections.tsx (Money tab Contract row)", "src/features/operations/evidence-rules.ts (Contract -> Signed contract label)", "supabase/migrations/20260919183000_p0_evidence.sql (PRE02 uploads are category Contract)", "supabase/migrations/20260919143000_s06_workflow.sql (signed_contract_evidence gate)"]
---
The signed contract belongs on the job's **PRE02 Check contract sent/signed** task. The app does not create or send contracts; you upload the signed copy you received.

## Upload the signed contract

1. Open the job and choose the **Tasks** tab.
2. Open **Check contract sent/signed**.
3. Either:
   - click **Complete**, enter the **Contract reference**, choose **Signed**, choose the file under **Signed contract**, add a **Note** and click **Complete task**; or
   - click **Attach signed contract**, choose the file and click **Attach**. This stores the file now; complete the task afterwards to record the contract as signed.

Use a PDF or photo of 25 MB or smaller. Only the task's owner, their backup or an administrator can do this.

## Find the signed contract

- On the job's **Files** tab, look for the file marked **Signed contract**.
- On the PRE02 task, under **Evidence**.
- The job's **Money** tab shows the **Contract** status, for example **Sent** or **Signed**.

Click **Open** to view it or **Download** to save a copy.

## Things to know

- A job cannot become Ready to book until the contract is recorded as signed with its file.
- If PRE02 was completed without a file, **Attach signed contract** is still offered on the completed task so you can add it.
- A contract file cannot be deleted. A newer upload is kept alongside the old one.

## If you can't do it

- **Complete is greyed out with "This action is switched off at the moment.", or Attach signed contract is not shown:** this feature may not be switched on yet. Ask an administrator.
- **"Contract evidence is already attached to this task, so nothing was changed."**
- **"Evidence can only be attached to an open or evidence-less contract task."**
- **You cannot see the file:** installers and store staff cannot see contracts. See [who can see files](/help/file-permissions).
