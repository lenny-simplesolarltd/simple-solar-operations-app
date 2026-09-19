# Evidence (files attached to operational work)

Migration: `supabase/migrations/20260919183000_p0_evidence.sql`.
Reference semantics: `r1-appsheet/services.js` (`_r1sEnsureOfficeTaskEvidence`, `TASK_EVIDENCE_ATTACH`),
`installer/workflow.js` (`_iwEvidenceRows`), `materials/workflow.js:481` (delivery note).

## Rule

**The database row is the authority.** `public.evidence` says which job a file belongs to, which task /
work package / submission / issue it is tied to, its category, who uploaded it and whether the file has
arrived. The storage path is only an address: nothing authorizes by parsing it.

## Model

| Column | Meaning |
|---|---|
| `job_id` (required, immutable) | the one job the file belongs to |
| `task_id` | the task it was uploaded for / first attached to. `tasks.evidence_id` remains the *current* pointer; a later upload replaces the pointer and the earlier row is kept (reference) |
| `work_package_id`, `submission_id`, `issue_id` | installer / commissioning / issue links - always objects of the same job (trigger `evidence_guard`) |
| `context_type`, `context_id` | what the upload was registered for: `Task`, `WorkPackage`, `Delivery`, `Job` |
| `category` | `Contract`, `CustomerDetails`, `FinanceAgreement`, `TaskEvidence`, `DeliveryNote`, `Progress`, `Completion`, `Commissioning`, `Problem`, `Variation`, `Return`, `Other`. The command that first uses a file decides it |
| `upload_status` | `Pending` (registered, file not confirmed) -> `Uploaded` (confirmed in storage). `Referenced` = legacy reference without a file |
| `uploaded_by`, `registered_at`, `attached_by`, `attached_at` | who / when |
| `filename` / `original_filename` | storage-safe name / the name the device gave (display only) |
| `mime_type`, `size_bytes`, `checksum` | declared at registration, replaced by what storage measured on confirmation |
| `storage_path` (unique, immutable) | `<job id>/<evidence id>/<safe name>` in the private bucket `evidence` |

Evidence is append-only (reference): rows cannot change job or file, cannot be deleted once uploaded.

## Upload

```
browser -> server action beginEvidenceUpload
        -> public.evidence_upload_begin   authorizes the actor for the task / package / delivery,
                                          derives the job, validates category, type, size, name,
                                          mints the path, inserts the Pending row (audit: Register)
        -> one-off signed upload URL      minted under the person's session; Storage accepts only the
                                          exact path of their own Pending row
browser -> Storage (bytes)
browser -> server action completeEvidenceUpload
        -> public.evidence_upload_complete checks the stored object (exists, owner, size, type)
                                          and marks the row Uploaded (audit: Upload)
browser -> command (TASK_COMPLETE evidence_path, TASK_EVIDENCE_ATTACH, IW_* evidence[],
           GOODS_IN_RECEIVE delivery_note_path)
        -> app.ensure_evidence            same job or R1A_CROSS_JOB_EVIDENCE; unregistered path ->
                                          R1A_UPLOAD_INVALID; a still-Pending row is confirmed here,
                                          inside the command's transaction (audit: Attach, TaskLink)
```

- **Nothing completes before its file is durable.** If the object is missing the command fails with
  `R1A_UPLOAD_MISSING` and writes nothing (one transaction). This replaces the reference's
  `R1C_UPLOAD_PENDING` retry sweep, which existed only because AppSheet fired the command before Drive
  showed the file.
- **Retries are idempotent.** One `upload_id` per chosen file: repeating `evidence_upload_begin` returns the
  same row; a finished upload is reported as finished; a different file under the same id is
  `EVIDENCE_UPLOAD_CONFLICT`. Commands are idempotent by `command_id` as before. A stored object cannot be
  overwritten (no update/delete storage policy, signed uploads never upsert).
- The browser never supplies a job id or a person id.

Who may register an upload mirrors who may run the command that will use it: `Task` = office class,
assigned to the job, owner/backup or Admin, FN-01; `WorkPackage` = active allocation or Office/Manager/Admin,
FN-06; `Delivery` = the roles and modes registered for `GOODS_IN_RECEIVE` (Store included - previously Store
could not upload at all); `Job` = office class assigned to the job.

## Reading

`app.can_read_evidence(actor, row)` - used by `public.list_evidence`, `public.evidence_open`, the RLS policy
on `public.evidence` and the Storage select policy:

- Admin, Manager, Director, Office, VariationApprover, Surveyor, Finance: evidence of jobs they may read
  (`app.can_read_job`: `job.read.all`, `job.read.own`, or assignment);
- Store: delivery notes;
- Installers (and anyone without a staff role): only installer categories, only for a work package they hold
  an **active** allocation on. Never contracts, finance agreements, customer details or delivery notes;
- inactive people and people without an active role: nothing.

`GET /api/evidence/<id>` (`?download=1` to download) calls `evidence_open`, then mints a **60-second** signed
URL under the person's own session and redirects to it (`Cache-Control: no-store`, `Referrer-Policy:
no-referrer`). No permanent or public URL exists; signed URLs are never stored, logged or audited.
"Not found" and "not yours" are both 404.

## Consistency

| Situation | Behaviour |
|---|---|
| metadata, file never arrived | row stays `Pending`, is invisible to readers, cannot be attached; listed by `evidence_consistency` after an hour |
| metadata `Uploaded`, file gone | open returns 410 with a clear message; `evidence_report_missing` verifies against Storage and writes one `FileMissing` audit event; listed by `evidence_consistency` |
| file in the bucket, no metadata | unreadable by everyone (Admin included), never adopted by a command; listed by `evidence_consistency` |

`public.evidence_consistency()` is Admin-only. It reports; it does not repair.

## Audit (`audit_events`, `entity_type = 'Evidence'`)

`Register`, `Upload`, `Attach`, `TaskLink`, `TaskReplace`, `FileMissing`. Snapshots carry metadata only - no
file contents, storage paths or URLs. Reads are not audited (as elsewhere in the system).

## File rules

JPEG, PNG, WebP, HEIC/HEIF and PDF; 25 MB. Enforced three times: the upload field (early feedback), the
database at registration (type, extension must match type, no executable inner extension, sanitised name)
and the bucket itself (`file_size_limit`, `allowed_mime_types`) - then re-checked against the stored object.

## Not done

- **No antivirus / content scanning.** Type checks are by declared MIME type and extension; file contents are
  not inspected. Mitigations in place: private bucket, allow-list of non-executable types, files are served
  from the Storage origin (not the app's), downloads use `Content-Disposition: attachment`. A scanner would
  sit between `Upload` and `Attach` (a `Quarantined` status) - needs a product decision and infrastructure.
- No removal/revocation: the reference has none (append-only). A `Pending` registration whose file never
  arrived is the only thing that can be deleted.
- Scaffold, supplier-response and issue flows accept an `evidence_id` but have no upload control yet
  (the `Job` upload context exists for them).
- `customer_shareable` is stored but nothing customer-facing consumes it (as in the reference).
- `src/types/database.ts` has not been regenerated for the new columns/functions.
- Tests without Storage (PGlite) still let a command create the evidence row from a path, as the reference
  did; with Storage present a command only accepts registered uploads.
