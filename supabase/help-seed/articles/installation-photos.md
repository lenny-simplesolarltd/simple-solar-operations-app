---
slug: installation-photos
title: Installation photos and evidence
summary: How to add photos from site, which file types and sizes are accepted, and where the photos can be found afterwards.
category: installation
roles: ["Installer", "Office", "Manager", "Admin"]
release_function: FN-06
routes: ["/dashboard/installs/[workPackageId]", "/dashboard/commissioning/[workPackageId]"]
tools: []
keywords: ["photo", "photos", "picture", "evidence", "upload", "file", "HEIC", "JPG", "PDF", "25 MB", "site photos", "completion photo"]
aliases: ["installation photos", "install photos", "upload photos", "where are photos", "add a photo", "take a picture", "photo wont upload", "photo too big", "file type not allowed", "completion photo", "progress photo", "site pictures", "where do I put photos", "iphone photo"]
related: ["installation-progress", "record-commissioning", "report-a-problem", "upload-a-file", "find-customer-files", "file-permissions"]
common_task: true
sort: 30
sources: ["src/features/installs/components/install-actions.tsx (photo on Progress update, Finish, Problem, Variation)", "src/features/installs/components/commissioning-form.tsx (Commissioning photo)", "src/features/operations/evidence-field.tsx", "src/features/operations/evidence-rules.ts (types, 25 MB, messages)", "src/features/operations/evidence-list.tsx (Open, Download)", "src/app/dashboard/installs/[workPackageId]/page.tsx (Photos and files)", "docs/evidence.md (who can read installer photos)", "supabase/migrations/20260919183000_p0_evidence.sql (catalogue wording)"]
---
Photos from site are added through the buttons on the install page. Each photo is saved against the job, and the office can see it straight away.

## Before you start

- Accepted files: photos in JPG, PNG, WebP or HEIC, and PDF files.
- Each file must be 25 MB or smaller.
- You add one file at a time. To send several photos, send several updates.

## Steps

1. Open the work from [My installs](/dashboard/installs).
2. Press the button for what you are doing: **Progress update**, **Finish**, **Problem** or **Variation**. Each has a photo box.
3. Choose or take the photo. Wait for the tick and **Uploaded** with the file name.
4. Fill in the rest of the window and press the button to save.

For commissioning, use the **Commissioning photo** box in the **Commissioning** section, then press **Save draft**.

## Where to find photos

- On the install page, under **Photos and files**. The heading also shows how many photos are on file.
- Office staff also see them on the job's **Files** tab and on the commissioning review page.
- Use **Open** to view a file or **Download** to save it.

Photos cannot be deleted or changed once saved. If one is wrong, add the right one in a new update.

## If you can't do it

- **Files must be 25 MB or smaller.** Choose a smaller photo.
- **Only photos (JPG, PNG, WebP, HEIC) and PDF files can be added.** Choose a different file.
- **The upload failed. Try again.** Press **Try again**. The same photo is resumed, not added twice.
- If you close the window without pressing the save button, the update is not recorded. Open it again and add the photo again.
- This feature may not be switched on yet. Ask an administrator.
