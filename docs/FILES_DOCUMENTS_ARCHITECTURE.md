# Files & documents architecture

## The rule

Every operational file belongs to exactly one job, is represented by a row in
`public.evidence`, and is found, opened and downloaded through that row. The
Storage path is only an address; it never authorises anything.
(Model: `docs/evidence.md`, migration `20260919183000_p0_evidence.sql`.)

## Where files come from

| Source | Upload surface | Evidence context / category | Linked to |
|---|---|---|---|
| Signed contract (PRE02), supporting documents (PRE04), finance agreement (PRE05), other task evidence | task **Complete** dialog, **Attach signed contract** | Task / Contract, CustomerDetails, FinanceAgreement, TaskEvidence | task (`evidence.task_id`, `tasks.evidence_id`), contract pointer on the job |
| Office commissioning certificate (R1) | job **Operations** tab, **Record commissioning** | Job / Commissioning | commissioning submission (`submission_id`) |
| Issue proof photo / PDF | **Resolve** on the Issues page or the Operations tab | Job / Problem | issue (`issue_id`, via the issue event) |
| Any other job document | job **Files** tab, **Upload a file** (office roles) | Job / chosen category | job |
| Installer photos, installer commissioning forms (R3, FN-06) | My installs | WorkPackage / Progress, Completion, Commissioning, Problem, Variation, Return | work package / submission / issue |
| Delivery notes (R2, FN-03/05) | Goods in | Delivery / DeliveryNote | job of the order |
| Scaffold confirmations, strip record, merchant order confirmation (R2) | optional file in those dialogs | Job / Other | the command's record (`evidence_id`) |

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

- **Job > Files tab**: every file of the job, grouped - Contracts, Customer &
  finance, Task documents, Photos & installation, Commissioning, Issues,
  Materials & delivery, Other - with name, type, date, who added it, size,
  Open, Download; **Upload a file** for office roles.
- **Files > Files & documents**: authorised library across jobs
  (`public.search_evidence`): search by customer, job reference, postcode,
  file name; filter by type and dates; each result shows its job and
  customer and links to the job's Files tab.
- **Task Evidence card**, **install / commissioning pages**, **Operations tab**
  (current commissioning record's files).
- **SimpleBot**: `list_job_files` (a job's files) and `search_files` (across
  jobs), returning metadata and Open / Download links only.

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
- Rows are append-only: job and path never change; replacing a contract adds
  a new row and moves the task pointer (`TaskReplace` audited); nothing is
  deleted.
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
