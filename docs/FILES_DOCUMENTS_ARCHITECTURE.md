# Files & documents architecture

## The rule

Every file is represented by a row in `public.evidence`, and is found, opened
and downloaded through that row. The Storage path is only an address; it never
authorises anything.
(Model: `docs/evidence.md`, migrations `20260919183000_p0_evidence.sql` and
`20260920240000_file_manager.sql`.)

An operational file belongs to exactly one job (`scope = 'Job'`). A **company
document** (`scope = 'Library'`) belongs to no job and is read through the
`file.library.read` permission instead of job visibility; it may carry no task,
work package, submission or issue link, because it is a filed document and never
evidence of work. That is the only relaxation of the original one-job rule, and
it is enforced by `evidence_scope_job_check` and
`evidence_library_has_no_work_links`.

## Filing is logical, never physical

Storage object names are **identity**: `<job_id>/<evidence_id>/<safe name>`, or
`library/<evidence_id>/<safe name>`. Nothing about where a document "lives" has
ever been encoded in a path, and nothing is now.

Folders are a separate tree (`public.file_folders`, nested, job-scoped or
library-scoped). A document's filing lives in mutable columns on the evidence
row - `folder_id`, `display_name`, `trashed_at`, `filing_version` - and nothing
else. So:

- renaming changes `display_name`; `filename` and `storage_path` never change,
  and every task, command and commissioning reference to the file still works;
- moving changes `folder_id`; `job_id` and `storage_path` are immutable
  (`app.evidence_guard`), so **there is no code path that can move a document to
  another job**. A cross-scope move is refused as `FILE_CROSS_SCOPE_MOVE`;
- an existing document with no folder is simply at the top level of its job.
  Nothing was migrated and no storage object was renamed.

`app.file_evidence_locked()` marks a document a task, work package, submission
or issue actually relies on. Such a document can be filed and renamed freely but
**cannot be trashed or destroyed at all** (`FILE_EVIDENCE_LOCKED`).

## Folders, trash and destruction

| Operation                                         | Command                                                                                                    | Notes                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create / rename / move / trash / restore a folder | `file_folder_create`, `file_folder_rename`, `file_folder_move`, `file_folder_trash`, `file_folder_restore` | A folder never leaves its scope; moving into itself or a descendant is `FILE_FOLDER_CYCLE`; nesting is capped at 10                                                                                         |
| rename / move / trash / restore a document        | `file_rename`, `file_move`, `file_trash`, `file_restore`                                                   | `file_move` and `file_trash` take a selection and are one transaction                                                                                                                                       |
| destroy a document                                | `file_purge`                                                                                               | `file.purge` permission, trashed first, never evidence-locked. Leaves an unreadable tombstone row so the audit outlives the file; the bytes are removed by the service role only after the command said yes |

Deleting means the Trash. Trashed items keep who trashed them, when, and where
they were, and are excluded from `list_evidence`, `search_evidence`,
`file_browse` and `file_search` - but stay visible to someone holding
`file.manage` so they can be found and restored.

Conflicts: every filing change may quote `expected_version`
(`evidence.filing_version` or `file_folders.version`). A stale one is refused as
`FILE_CONFLICT` rather than silently overwriting - no lost updates.

## Permissions

| Permission            | Who                                                 | What                                                          |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `file.manage`         | Admin, Manager, Director, Office                    | Organise a job's documents (also needs assignment to the job) |
| `file.library.read`   | the above plus Finance, Surveyor, VariationApprover | See company documents                                         |
| `file.library.manage` | Admin, Manager, Director, Office                    | Organise company documents                                    |
| `file.purge`          | Admin, Manager                                      | Permanently delete a trashed document                         |

A `HistoricalImport` job is read-only: `app.file_authorize_write` refuses every
filing command on it with `HISTORICAL_IMPORT`, and `file_browse` returns
`can_manage: false` so the UI does not offer what the database would refuse.

## Where files come from

| Source                                                                                                | Upload surface                                       | Evidence context / category                                                   | Linked to                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Signed contract (PRE02), supporting documents (PRE04), finance agreement (PRE05), other task evidence | task **Complete** dialog, **Attach signed contract** | Task / Contract, CustomerDetails, FinanceAgreement, TaskEvidence              | task (`evidence.task_id`, `tasks.evidence_id`), contract pointer on the job |
| Office commissioning certificate (R1)                                                                 | job **Operations** tab, **Record commissioning**     | Job / Commissioning                                                           | commissioning submission (`submission_id`)                                  |
| Issue proof photo / PDF                                                                               | **Resolve** on the Issues page or the Operations tab | Job / Problem                                                                 | issue (`issue_id`, via the issue event)                                     |
| Any other job document                                                                                | job **Files** tab, **Upload a file** (office roles)  | Job / chosen category                                                         | job                                                                         |
| Installer photos, installer commissioning forms (R3, FN-06)                                           | My installs                                          | WorkPackage / Progress, Completion, Commissioning, Problem, Variation, Return | work package / submission / issue                                           |
| Delivery notes (R2, FN-03/05)                                                                         | Goods in                                             | Delivery / DeliveryNote                                                       | job of the order                                                            |
| Scaffold confirmations, strip record, merchant order confirmation (R2)                                | optional file in those dialogs                       | Job / Other                                                                   | the command's record (`evidence_id`)                                        |

Not wired: stock quarantine (the command only takes an existing evidence id
and stock has no job context).

## Generated documents

The application **generates no documents today**: no quote, ROI or contract
PDF is produced anywhere (no PDF library, no generator; the SimpleBot
document tools are "planned"). Quotes are a free-text quote reference;
contracts are an external Signable reference plus the uploaded signed copy.
So nothing is lost after download: there is nothing generated to lose.
When document generation is built it must write the bytes into the private
`evidence` bucket through a registered row (context Job, a new category such
as `GeneratedDocument`, versioned by a new row per generation) so it appears
in the same Files surfaces automatically.

## Where staff find files

- **Files > Files & documents** (`/dashboard/files`): the global file manager.
  Its top level lists company documents and the jobs whose files you can see;
  `?job=<id>` opens that job's folders, `?scope=library` the company ones.
  Folders, breadcrumbs, list/grid, sorting, multi-select, drag and drop,
  rename, move, trash and restore - with a menu item behind every drag gesture,
  so the whole surface works from the keyboard. Search (`public.file_search`)
  runs in the database and every result says which folder it lives in.
- **Job > Files tab**: the SAME component (`JobFilesTab` -> `FileManager`)
  rooted at that job. There is no separate "job files" implementation: a
  document uploaded there is found in the library, and a folder made in one is
  in the other. (`src/features/files/` is the single implementation.)
- **Task Evidence card**, **install / commissioning pages**, **Operations tab**
  (current commissioning record's files).
- **SimpleBot**: `list_job_files`, `search_files` and `list_file_folders`
  (reads, now reporting the folder a document lives in), plus two mutations -
  `create_file_folder` and `move_files_to_folder` - which are confirmed
  proposals calling the same `file_folder_create` / `file_move` commands under
  the person's own session. Nothing that removes a document is offered to the
  model at all: no trash, restore or delete tool exists.

## Security

- Private bucket `evidence`; 25 MB; JPEG/PNG/WebP/HEIC/PDF only; no public URL.
- Uploads are registered first (`evidence_upload_begin`: the server derives
  the job from the task / work package / delivery / job the person may act
  on), stored only where a Pending row of that person names exactly that
  path, then confirmed against Storage (`evidence_upload_complete` or inside
  the command's own transaction).
- Reads: `app.can_read_evidence` - staff roles read files of jobs they may
  read; installers only installer-category files of work they are allocated
  to (never contracts, finance or customer documents); Store only delivery
  notes. The same rule drives the table policy, the Storage policy, the job
  lists, the library search and SimpleBot's tools.
- Open / Download: `GET /api/evidence/<id>` checks `evidence_open` under the
  person's session and redirects to a signed URL that expires after 60
  seconds.
- Rows are append-only in everything that carries meaning: job, scope and path
  never change; replacing a contract adds a new row and moves the task pointer
  (`TaskReplace` audited). Only filing is mutable, and only through the
  commands above.
- Audited without anyone typing a reason: `Rename`, `Move`, `Trash`, `Restore`
  and `Destroy` against the document, `Create`/`Rename`/`Move`/`Trash`/
  `Restore` against the folder, each with the actor, the timestamp and the old
  and new values. `file_details` renders that log as the document's history.
- Audit carries metadata only (`app.evidence_audit_json`): never the path, a
  URL or file content (the last path leak, TASK_EVIDENCE_ATTACH's reason, was
  fixed in `20260919220000`; hosted has no such rows).
- SimpleBot never uses the service role; it sees exactly what the person
  sees.

## Malware scanning (decision)

There is **no antivirus scanning**. Uploads are limited by type, size and
filename rules, the bucket refuses other MIME types, and files are only ever
served to authorised staff through short-lived links. Scanning is an
**external production prerequisite** if the business wants it. The model
supports it without redesign: readers already accept only
`upload_status in ('Uploaded', 'Referenced')`, so a scanner would register
files as a new `Scanning` / `Quarantined` state in `evidence_finalize`, with a
worker (service role) promoting clean files to `Uploaded`. Nothing in the
app claims files are scanned.
