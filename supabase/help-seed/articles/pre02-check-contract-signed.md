---
slug: pre02-check-contract-signed
title: PRE02 Check contract sent/signed
summary: Record the contract reference, mark the contract as sent or signed, and upload the signed contract.
category: sales
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: FN-01
routes: ["/dashboard/tasks/[taskId]"]
tools: ["get_job_tasks"]
keywords: ["PRE02", "contract", "signed contract", "contract reference", "Signable", "awaiting signature", "prebooking"]
aliases: ["pre 2", "pre02", "contract signed", "contract sent", "awaiting signature", "customer signed", "contract reference", "signable reference", "check contract"]
related: ["signed-contract", "presale-workflow", "upload-a-file", "ready-to-book", "complete-a-task", "switched-off-features"]
common_task: true
sort: 41
sources: ["src/features/tasks/components/task-actions.tsx (PRE02 form, AttachEvidence, COMPLETE_HELP)", "supabase/migrations/20260919144000_r1_prebooking_commands.sql (cmd_task_complete PRE02, TASK_EVIDENCE_ATTACH)", "supabase/migrations/20260919143000_s06_workflow.sql (task_satisfaction PRE02, signed_contract_evidence gate)", "supabase/migrations/20260919149000_s17_reads_rls.sql (contract refusal wording)", "supabase/seeds/002_task_assignment_rules.sql (PRE02 owner)"]
---
PRE02 is created for every sale. It records the contract reference and whether the contract is signed. A signed contract must have the signed file uploaded, or the job cannot become Ready to book.

## Before you start

- Have the contract reference (for example the Signable reference).
- If it is signed, have the signed contract as a PDF or photo, 25 MB or smaller.
- You must be the task owner, their backup or an administrator.

## Steps

1. Open the task from **My tasks** or the job's **Tasks** tab.
2. Click **Complete**.
3. Enter the **Contract reference**.
4. Under **Contract**, choose **Signed** or **Sent, awaiting signature**.
5. If signed, choose the file under **Signed contract** and wait for "Uploaded".
6. Add a **Note**. It is required.
7. Click **Complete task**, or **Record as sent** if it is awaiting signature.

## What happens next

- **Signed:** the task is complete and the contract is recorded as signed on the job. The app rechecks whether the job is Ready to book.
- **Sent, awaiting signature:** a sent contract is not a signed one. The contract is recorded as sent and the task waits, with a follow-up on the next working day. Complete it again once it is signed.

You can also use **Attach signed contract** on the task to store the file first and complete the task later.

## If you can't do it

- **"This action is switched off at the moment."** This feature may not be switched on yet. Ask an administrator.
- **"The contract reference is required."** Enter the Signable or contract reference.
- **Complete task stays greyed out:** a signed contract needs its file. Upload it under **Signed contract**.
- **"The contract evidence doesn't match a file saved for this job."** Upload the signed contract file again.
- **"This contract is already recorded as signed, so it was not changed to sent."**
- **"Only the task owner, backup or an admin can do this."** Ask the owner shown on the task.
