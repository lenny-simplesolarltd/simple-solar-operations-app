# 003 Quote revisions, generated documents and customer files

Status: **PROPOSAL FOR REVIEW**. Nothing in this document has been applied to any database. No
migration file exists for it. It follows the conventions of `002-presale-job-sold-design-proposal.md`
and `docs/DATABASE_OWNERSHIP.md`.

## 1. Audit: what exists today (2026-09-19)

| Area | Found |
| --- | --- |
| Quote / revision tables | **None**, on any local or remote branch. `jobs.quote_reference` is a free-text field only. |
| Generated-document / file tables | **None** for quotes. The backend-port stream owns `evidence` (job evidence files: `storage_path`, `filename`, `mime_type`, `checksum`, file `version`, `customer_shareable`), `handover` (`generated_file_id`, `generated_version`) and `archive_index`. |
| Storage | **No bucket and no `storage.objects` policy** in any migration, seed or `config.toml`. `evidence.storage_path` has nowhere to point yet. |
| Sale snapshot | `presales` is already immutable (trigger) and holds the full `design` JSON, `design_schema_version`, `catalogue_version`, `price_breakdown`, `computed_total_pence`, `agreed_price_pence`. It is, in effect, Quote 1. |
| Calculations | `src/features/presale/designer/calc` is pure and deterministic: pricing, year-1 performance, 30-year total, deposit split 25/35/40. It produces **no per-year series** and no goods/services split. |
| Commands / audit | `commands` (command_id + fingerprint incl. actor), `app.reject`, `audit_events` with `command_id`. One public command: `submit_presale`. |
| Tasks | `tasks.related_entity_type/related_entity_id` exist, so a task can point at one exact revision. Templates PRE01-PRE05 only; `task_assignment_rules` decide the owner. |
| Templates | `document-templates/presale/{quotation,roi}/master.pdf`, untracked, owned by another workstream. Read-only for this work. |
| Assistant | Planned, non-executable: `get_current_quote`, `get_quote_history`, `compare_quote_revisions`, `get_generated_documents`, `create_quote_amendment`, `update_quote_draft`, `approve_quote_revision`, `generate_document_pack` (BD-05, BD-06). Pending actions in memory (BD-07). |
| Concurrent branches | `feature/dev-user-preview` (read-only "view as user"); touches none of this. The **hosted** database was not inspected (not permitted), so migrations applied there but absent from the repo cannot be ruled out. |

## 2. BLOCKER: the masters are not editable templates

Both masters are flat PDF exports: the quotation from a Google Doc ("Presale Automation 08/09/2025
DO NOT TOUCH", 24 A4 pages, contract of sale from page 10, e-signature text tag on page 5), the ROI
from a slide deck ("New Master Keynote Original (ROI)", 15 pages at 1920x1080). Literal
`{{placeholder}}` text, no form fields, **subset-embedded fonts**.

Why they cannot simply be filled in:

1. **Fonts.** A subset font contains only the glyphs the master already uses. New customer text
   needs the full fonts. Poppins (ROI) and Arimo are open; Helvetica Neue, Calibri, Arial and Times
   New Roman (quotation) are proprietary. Metric-compatible open substitutes exist (Arimo, Carlito,
   Tinos) but are a visible design decision.
2. **No reflow.** ROI page 4 and the quotation letter put placeholders inside sentences ("We have
   quoted you for {{panelquantity}} SUNPOWER panels, creating a {{systemsize}} kWp system..."). PDF
   text does not move when a value is longer or shorter.
3. **Hard-coded business content** that the application treats as variable: "SUNPOWER panels" (the
   catalogue has several panels), "Delivery costs: GBP 600.00", "VAT: GBP 0", "*Based on a 7% yearly
   increase" (the app's `ELECTRICITY_INFLATION_PCT` is **5**).
4. **Undefined fields.** ~60 numbered ROI placeholders come from cells of the legacy spreadsheet. The
   tables make most of them inferable (section 8) but the formulas are not in this repository or in
   the reference repository.

Per the instruction for this work, generation is **not** built on an approximation. Options:

| Option | Fidelity | Needs |
| --- | --- | --- |
| **A. Editable sources** (recommended): the original Google Doc and slide deck, exported as `.docx` / `.pptx`, merged deterministically and converted to PDF by a headless converter in a worker | Exact, reflows correctly | The two source files; a conversion service (LibreOffice/Gotenberg container); fonts installed there |
| **B. Overlay on the master pages**: keep every master page as the pixel-exact background, mask each placeholder box, draw the value (pdf-lib) | Exact for the ~85% of fields that sit in cells/boxes; sentences need per-field handling | Approval of font substitutes; approval to reword or freeze the in-sentence fields |
| **C. Rebuild as HTML/CSS** rendered to PDF | Close, never identical | Explicit design approval |

Whichever is chosen, the generator takes **only** an immutable revision snapshot (section 4) and a
template version, so the same revision always yields the same values. No AI is involved.

## 3. Canonical model

```
Job 1 --- * QuoteRevision (1, 2, 3 ...; immutable once issued)
                 |--- 1 ROI / Performance Proposal      (generated PDF)
                 |--- 1 Quotation & Contract             (generated PDF; the contract is inside it)
Job.selected_quote_revision_id -> exactly one revision, chosen by authorised staff
```

Two generated documents per revision. The contract is never a third output.

## 4. Proposed schema (for review - not applied)

Ownership: proposed as owned by this stream, alongside `jobs` and `presales`. **If the backend-port
developer already has a quote model, this section is withdrawn and the adapters in section 7 bind to
theirs instead.**

```sql
-- quote_revisions: one row per issued quote. Immutable except for the small status lifecycle.
create table public.quote_revisions (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null references public.jobs (id) on delete restrict,
  revision_number        integer not null check (revision_number >= 1),   -- "Quote 2"
  source_revision_id     uuid references public.quote_revisions (id),     -- null for Quote 1
  origin                 text not null check (origin in ('presale', 'amendment')),
  change_reason          text not null check (btrim(change_reason) <> ''),-- 'Original' for Quote 1
  status                 text not null default 'issued'
                         check (status in ('issued', 'superseded', 'selected', 'withdrawn')),
  -- Everything needed to reproduce THIS revision, captured at creation and never re-read from jobs/presales:
  snapshot               jsonb not null,  -- { schemaVersion, customer{...}, job{ref, surveyor...}, design{DesignState}, catalogueVersion }
  pricing_snapshot       jsonb not null,  -- computePricing() output + breakdown rows + deposit split, in pence
  performance_snapshot   jsonb not null,  -- computePerformance() output + the per-year series printed on the ROI
  document_values        jsonb not null,  -- the exact placeholder -> string map the PDFs were generated from
  calc_version           text not null,   -- version of the deterministic calculation code
  template_version       text not null,   -- checksum of the masters used
  total_pence            bigint not null check (total_pence > 0),
  created_at             timestamptz not null default now(),
  created_by             uuid not null references public.people (id),
  command_id             uuid not null references public.commands (command_id),
  version                integer not null default 1 check (version >= 1),
  unique (job_id, revision_number)
);
-- trigger: forbid UPDATE of every column except status/version, and forbid DELETE (app.forbid_mutation pattern).

alter table public.jobs
  add column selected_quote_revision_id uuid references public.quote_revisions (id),
  add column quote_selected_at timestamptz,
  add column quote_selected_by uuid references public.people (id);

-- customer_files: metadata for every private file. Storage holds bytes, this holds meaning.
create table public.customer_files (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete restrict,
  customer_id        uuid not null references public.customers (id) on delete restrict,
  quote_revision_id  uuid references public.quote_revisions (id) on delete restrict,
  folder             text not null check (folder in ('quotes', 'customer_documents', 'final_accepted')),
  document_type      text not null check (document_type in ('roi_proposal', 'quotation_contract', 'customer_upload', 'signed_contract')),
  bucket             text not null default 'customer-files',
  storage_path       text not null unique,   -- jobs/<job_id>/quotes/v<N>/roi.pdf
  filename           text not null,          -- "ROI - Quote 2.pdf"
  mime_type          text not null,
  byte_size          bigint not null check (byte_size > 0),
  checksum_sha256    text not null,
  immutable          boolean not null default true,
  generated_from     jsonb,                  -- { template_version, calc_version, command_id }
  created_at         timestamptz not null default now(),
  created_by         uuid not null references public.people (id),
  unique (quote_revision_id, document_type)
);
-- Evidence is NOT duplicated here: the Files UI reads the backend-port stream's `evidence` table
-- for its Evidence folder (BACKEND DEPENDENCY: a staff SELECT policy on evidence + the same bucket rules).

-- assistant_pending_actions (BD-07): see section 9.
```

New permissions (seeded into `permissions` / `role_permissions`): `quote.read` (follows job
visibility), `quote.amend` (Office, Manager, Admin), `quote.amend.pricing` (Manager, Admin, Director),
`quote.select` (Office, Manager, Admin), `file.read` (follows job visibility), `file.download`.
RLS on both tables mirrors `presales_select`: a row is visible when its job is.

New task template `QTE01` "Send selected quotation and contract", group Prebooking, with a
`task_assignment_rules` row (owner Tanya, as PRE02) so ownership stays with the existing deterministic
assignment. The task is created with `related_entity_type = 'quote_revision'`,
`related_entity_id = <the selected revision>`; its title carries "Quote N".

## 5. Commands (existing architecture: command_id, fingerprint, expected_version, P0001 codes, audit)

| Command | Behaviour |
| --- | --- |
| `submit_presale` (existing, extended) | In the same transaction, creates Quote 1 (`origin = 'presale'`, reason 'Original') from the presale payload. Needs care: this function is sensitive and owned by this stream. |
| `create_quote_revision(p_command_id, p_job_id, p_source_revision_id, p_expected_revision_number, p_reason, p_snapshot, p_pricing, p_performance, p_document_values, p_calc_version, p_template_version, p_dry_run)` | Validates permission (`quote.amend`, plus `quote.amend.pricing` when price inputs changed), that the source is the job's latest (`REVISION_CONFLICT` otherwise), and a non-empty reason. `p_dry_run = true` returns the would-be revision number and a structured diff **without writing**. Otherwise inserts revision N+1, marks the previous latest `superseded` unless it is `selected`, audits. |
| `attach_generated_file(p_command_id, p_quote_revision_id, p_document_type, p_storage_path, ...)` | Records one generated file. Refuses a second file of the same type for a revision. |
| `select_customer_quote_revision(p_command_id, p_job_id, p_revision_id, p_expected_job_version)` | Requires both documents to exist. Sets `jobs.selected_quote_revision_id`, status `selected` (the previously selected one returns to `issued`/`superseded`), creates or re-points the open `QTE01` task at exactly this revision. Deletes nothing. |

The authoritative numbers are computed by the **server** running the existing TypeScript calc on the
edited design, then passed to the command; the client's numbers are never trusted, and the model never
calculates. (Alternative for review: port the calc to SQL. Not recommended: two implementations.)

## 6. Storage

One **private** bucket, proposed name `customer-files` (none exists to reuse). `public = false`, PDF
and image MIME allow-list, 50 MiB limit. Policies on `storage.objects`: SELECT when a `customer_files`
row with that path is visible to the caller; INSERT only under `jobs/<job_id>/` for a job the caller
may amend; **no UPDATE, no DELETE** for `authenticated`. Staff open files through short-lived signed
URLs issued by a server route after the `customer_files` row has been read under RLS. Masters are
never uploaded to this bucket and never served.

Generation on save: command commits the revision -> server renders both PDFs from `document_values`
-> uploads -> `attach_generated_file` x2. A revision whose files are missing is shown as "documents
pending" and can be re-rendered from its own snapshot (idempotent; same values).

## 7. Application surfaces

- **Edit quote** (Job page, `quote.amend`): the designer's structured fields (panel, quantities,
  inverter lines, battery, EV, bird netting, optimisers, iBoost, immersion, back-up; price inputs only
  with `quote.amend.pricing`). Save -> validate -> diff view -> mandatory reason -> dry-run preview of
  price/performance -> confirm -> revision N+1 -> both documents.
- **Files** (new nav entry) and a Files panel on Job Detail: Customer/Job -> Quotes -> Version N -> the
  two PDFs; Customer Documents; Evidence; Final / Accepted. Search by customer and job reference,
  recent files, type filter, selected-revision badge, historical versions marked immutable.
- **Quote history -> Mark as customer-selected** (`quote.select`).
- **Assistant reads**: `find_customer`, `get_current_quote`, `get_quote_history`,
  `compare_quote_revisions` (structured diff of snapshots, computed by application code),
  `get_generated_documents`, `search_customer_files`, `inspect_document_metadata`,
  `read_document_values` (returns the revision's `document_values`, minus contact details, instead of
  parsing a PDF). The model never receives a file it did not ask for.
- **Assistant mutations** (only once section 9 is live): `create_quote_amendment`,
  `select_customer_quote_revision`, `generate_document_pack` - each `prepare()` calls the same command
  with `p_dry_run = true`; `execute()` calls it for real with the pending-action id as `command_id`.

## 8. Placeholder mapping (draft, to be confirmed against the legacy sheet)

Quotation (50): `fullname, firstname, firstline, city, postcode, fulladdress` <- customer;
`date` <- revision created_at (Europe/London); `ref` <- job_ref; `surveyor` <- salesperson;
`panel, panelq, inverter, inverterq, battery, batteryq, ev, evq, backup, offgridq, birdnettingq,
iboostq, immersionq, optimisersq` <- design/pricing state; `scaffq` <- scaffold; `gt, st, gsst` <-
**goods/services split - not produced by the calc today**; `totalcost` <- total; `25, 35, 40` <-
deposit split; `capacity, output, savings, savingsyear1, segyear1, selfconsume, selfconsumeperc,
exportperc, consume, roi, totsavings, battkwh` <- performance; `inclination, orientation, sf, kk,
postcodezone, pvdep, archetype` <- **MCS estimate inputs; the master has one value each but a design
can have several elevations - rule needed**.

ROI named (23): `name, fullname, address, phone, email, date, ref, surveyorname, surveyorcontact,
surveyoremail, price, roi, panelquantity, systemsize, generation, inverter, battery, batterysize,
annualusage, priceperkw, segrate, annualsaving(s), totalsaving`.

ROI numbered, inferred from the two tables (years 1,2,3,4,5,10,15,20,30):
"If nothing changes" - pence per kWh `55,56,57,58,59,64,69,70,72`; monthly bill
`2,5,8,11,14,29,44,47,53`; annual bill `3,6,9,12,15,30,45,48,54`; `73` = 30-year spend, `74` = monthly
bill in year 30. "30 Year Savings Plan" - monthly savings `101,104,107,110,113,128,143,146,152`;
yearly `102,105,108,111,114,129,144,147,153`; accumulated `103,106,109,112,115,130,145,148,154`.
The remaining numbered fields (pages 1-4: `50, 51, 71, ...`) need the sheet.

## 9. BD-07 durable pending actions

Application side is implemented on this branch: `PendingActionStore.durable`,
`SupabasePendingActionStore` (selected by `ASSISTANT_PENDING_ACTIONS=database`), and a guard that
refuses to propose or confirm any change in production through a non-durable store. Database side,
for review:

```sql
create table public.assistant_pending_actions (
  id               uuid primary key,            -- also the command_id given to the domain command
  actor_person_id  uuid not null references public.people (id),
  thread_id        uuid not null,
  tool             text not null,
  args_hash        text not null,               -- sha256 of the arguments; never the arguments
  expected_version integer,
  status           text not null default 'pending' check (status in ('pending', 'claimed')),
  resolution       text check (resolution in ('confirm', 'cancel')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,        -- <= created_at + 1 hour
  claimed_at       timestamptz
);
-- RLS: select own rows (or Admin). No insert/update/delete grant; rows change only through:
--   assistant_register_pending_action(p_id, p_thread_id, p_tool, p_args_hash, p_expected_version, p_expires_at)
--   assistant_claim_pending_action(p_id, p_decision) returns 'ok' | 'already_used' | 'unknown'
--     (single atomic UPDATE ... WHERE status = 'pending' AND actor = app.current_person_id() AND expires_at > now();
--      someone else's, expired and missing actions are all 'unknown')
--   assistant_release_pending_action(p_id)   -- hands back a confirm-claim after a transport failure
-- All SECURITY DEFINER, search_path '', actor from auth.uid(), execute granted to authenticated only.
```

## 10. Acceptance tests (the 26-step scenario)

DB integration (`tests/quotes.test.mjs`, local stack): steps 1-5, 10-12, 18-23, 26 and the role
matrix (Office, Surveyor, Director, Admin, no-role) for read, amend, select, storage access.
Unit: calc determinism per snapshot, structured diff, placeholder map completeness (every
placeholder in both masters has exactly one source), assistant tools 13-17, 25. Browser: 6-9, 24.

## 11. Decisions needed

1. Template route: A, B or C (section 2) - and, for A, the two source files.
2. Does the backend-port developer already own a quote/document/file model or a bucket? Is `evidence`
   meant to share a bucket with customer files?
3. 7% (ROI master) or 5% (application) electricity inflation; "SUNPOWER" wording; fixed GBP 600
   delivery and GBP 0 VAT; the goods/services split; the single-value MCS fields for multi-elevation
   designs; the legacy meaning of the remaining numbered ROI fields.
4. Approval of sections 4-6 and 9, after which the migrations can be written and validated locally.
