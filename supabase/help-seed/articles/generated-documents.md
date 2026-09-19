---
slug: generated-documents
title: Quotes, contracts and other documents
summary: The app does not create quotes, contracts or other documents yet. This explains what it does keep and where.
category: files
roles: []
release_function: none
routes: ["/dashboard/jobs/[jobId]"]
tools: []
keywords: ["quote", "quotation", "PDF", "generate", "document", "ROI", "proposal", "contract document"]
aliases: ["generate quote", "print quote", "quote pdf", "create contract", "download quote", "where is the quote", "roi document", "proposal pdf", "generate documents", "send quote to customer"]
related: ["find-customer-files", "signed-contract", "new-job-sold", "job-detail"]
common_task: false
sort: 50
sources: ["docs/design/003-quotes-documents-files.md (proposal only; no quote or generated-document tables, no generator)", "src/app/dashboard/jobs/[jobId]/page.tsx (Presale card, Quote reference)", "src/features/presale/components/steps/sale-step.tsx (Quote reference field)", "supabase/migrations/20260919149000_s17_reads_rls.sql (R1A_REQUIRED_CONTRACT_ID: Signable or contract reference)"]
---
The app does not create quotes, contracts, ROI proposals or any other documents yet. There is no button to generate or print a PDF.

## What the app keeps instead

- **The sale:** the job's **Overview** tab has a **Presale** card with the system size, panel count and price breakdown exactly as sold. It cannot be edited.
- **The quote reference:** if one was entered on the sale, it shows on the **Sale** card as **Quote reference**. You can also search for it in **Job search**.
- **The contract reference:** recorded on the PRE02 task, for example the Signable reference.
- **Signed contracts and other files:** uploaded copies are on the job's **Files** tab. See [signed contracts](/help/signed-contract).

## What this means for you

Quotes and contracts are still prepared and sent outside this app. When the signed contract comes back, upload it on the PRE02 task so it is kept with the job.
