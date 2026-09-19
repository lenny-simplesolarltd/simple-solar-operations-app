---
slug: files-library
title: Files & documents: searching files across all jobs
summary: How to find a contract, photo, certificate or delivery note without knowing which job it is on, and open or download it.
category: files
roles: []
release_function: none
routes: ["/dashboard/files"]
tools: ["search_files", "list_job_files"]
keywords: ["files", "documents", "library", "search files", "contract", "certificate", "delivery note", "photos", "postcode", "download"]
aliases: ["find a document", "search all files", "where is the delivery note", "find a contract", "document library", "all files", "files menu", "find certificate"]
related: ["find-customer-files", "upload-a-file", "file-permissions", "asking-simplebot"]
common_task: true
sort: 5
sources: ["src/app/dashboard/files/page.tsx", "src/features/operations/files-library.tsx", "src/features/operations/evidence-groups.ts", "supabase/migrations/20260920120000_convergence_operations.sql (search_evidence)", "src/features/assistant/server/tools/files.ts"]
---
**Files & documents** lists every file you are allowed to see, across all jobs. Every file still belongs to one job; the library just saves you opening each job.

## Searching

1. Open **Files & documents** from the **Files** menu.
2. Type in **Search**: a customer name, job reference, postcode or file name.
3. Narrow it with the file type list (grouped as on a job's Files tab) and the from / to dates.
4. Press **Search**. Use **Previous** and **Next** to page through long lists.

Each result shows the file, its type, the job reference (click it to open the job's Files tab), the customer and postcode, when and by whom it was added, and its size.

## Opening a file

Press **Open** to view it or **Download** to save a copy. The link is private and lasts about a minute; press again to look later.

## What you will see

You only ever see files you are allowed to see: office staff see the files of jobs they can open, installers see the photos and certificates of work they are allocated to, Store staff see delivery notes. See [who can see files](/help/file-permissions).

## Asking SimpleBot

SimpleBot can search the same files for you, for example "Where is the signed contract for SS-ABCD-1234?" or "Find the delivery note for the Smith job". It only finds files you are allowed to see and gives you an Open link.
