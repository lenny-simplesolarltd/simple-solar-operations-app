# Milestone 002 — Presale / Job Sold: design proposal

Status: **proposal, awaiting approval.** No Migration 002 and no Presale UI exist yet.

Sources audited (reference = `/Users/lennybeadle/:reference`, read-only):
`r1-appsheet/services.js:723-742, 1193-1235` (SOLD_INTAKE + field contract), `r1-appsheet/adapter.js:168-219`
(authorization), `s05/intake.js:45-241` (Customer/Job build, intake idempotency), `s05/mapping.js:106-125, 219-236`
(transforms, Job ID), `s06/gates.js:235-258, 586-760` (staffed days, PRE03 responsibility, prebooking generator),
`s13/payments.js:8-60, 175-215` (stages at sale), `schema/config-seed.json` (PRE templates),
`tests/r1-office-journey.test.cjs:109-143, 305-315`, `docs/R1-office-journey-audit.md:26-34`.
Prototype: `docs/ui-reference/prototype-inventory.md` (full inventory of Ben's v0.12).

Legend: **[REF]** preserved from reference · **[DEC]** your decision of 2026-09-18 · **[NEW]** deliberate change, needs your OK.

---

## Prototype vs reference (A–D)

**A. Prototype content that is real business data** — roof elevations (X/Y, pitch, shading, bearing, radiance, roof
material), fit clearances, obstructions, chosen panel + net panel count + kWp, inverter lines, battery, extras (EV
charger, dongle, off-grid backup, bird proofing, iBoost, immersion timer, PV Ultra, optimisers + count), scaffold
metres/levels, AC run, adjustments A/B/C, "using finance?", total system price and the 25/35/40 payment split,
performance assumptions (tariff, SEG, self-consumption, annual consumption). Much of this is exactly what the
reference Booking form later re-keys (panel counts, inverter/battery to order, optimisers, bird netting, EV charger,
scaffold) — so capturing it structurally now pays off in the Booking slice.

**B. Purely visual / prototype behaviour** — stepper and reachability, "Use these values → Values confirmed",
param chips with ± buttons, sticky stat strips, BEST OUTPUT flag and trim hints, shift sliders, SVG drag-to-mark,
tap-to-exclude, "New job" double-tap reset, `localStorage['rafterRidge.v3']` persistence, light/dark tokens and fonts.

**C. Prototype conflicts with the reference**
1. Finance: prototype `No / Yes / Maybe` (+£0/£250/£125 fee) vs reference `finance_route ∈ Standard | Phoenix |
   OtherReview`, which drives PRE01/PRE03 vs PRE05.
2. Price: prototype *computes* the total; reference takes a *typed* gross amount, which PRE04 later verifies.
3. VAT: prototype VAT is a flat £0 with no control; reference S13 splits every stage as `net = gross / 1.2` (20%).
4. Panel catalogue: prototype = SunPower P7 **510 W**, M Class **475 W**; reference products/booking map =
   **515 W**, **460 W**, "M-Class".
5. Agreement: payment split 25/35/40 is identical in both.

**D. Reference Presale fields missing from the prototype** — every customer field (first/last name, address,
town, postcode, phone, email), finance route, salesperson, lead source, quote reference, roof/electrical/scaffold
*required* flags, roof/electrical notes — and any submit/save/Job ID step at all. The prototype ends on a read-only
Performance page.

---

## 1. Customer schema — `customers`

`id uuid pk` · `first_name*` · `last_name*` · `address_line1*` · `address_line2` · `town*` · `postcode*`
(stored upper-case, single-spaced) · `email` (lower-case) · `phone` · `alternate_contact` · `contact_notes` ·
stamping + `version` (same triggers as Migration 001) · index on `(postcode, lower(last_name))`.

**[REF]** A Sold always creates a **new** customer; the reference never resolves or merges at sale (later identity
differences raise a CustomerChange review, not an overwrite). I propose preserving that: no auto-matching. The index
lets Office see "possible existing customer" in a later slice.

## 2. Job schema — `jobs`

`id uuid pk` · `job_ref text unique not null check (job_ref ~ '^SS-[A-HJ-NP-Z]{4}-[0-9]{4}$')`, immutable ·
`customer_id fk*` · `display_name` (= `"{last_name} – {postcode}"` **[REF]**) · `sold_at*` · `salesperson_id fk
people*` · `lead_source` · `quote_reference` · `finance_route* check in (Standard, Phoenix, OtherReview)` ·
`original_gross_pence bigint* check > 0` · `current_contract_gross_pence bigint*` (= original at sale **[REF]**) ·
`valuation_basis` · `roof_required / electrical_required / scaffold_required boolean*` · `workflow_stage*` ·
stamping + `version`.

Not created yet (each arrives with the slice that owns it, as `NOT NULL DEFAULT` where the reference sets an
initial value): `contract_*`, `deposit_bank_*`, `customer_details_verified_*`, `sold_booking_match_status`,
`booking_*`, `operational_*`, `cancellation_*`, `archived_at`, `next_action_at`, `handover/financial_status`.
Never ported: `pilot_job`, `release_scope`, `source_system`, `source_record_id`, `commit_id`, `sold_submission_id`
(replaced by the presale FK), `presale_file_id` (a Drive file id).

## 3. Presale schema — is a separate table needed? **Yes, but not as a request queue.**

The reference `Intake` table (raw payload + hash + Review status) is Jotform-ingestion plumbing and is **not**
ported. What *is* genuinely needed is the sold document itself: PRE04 checks "customer details and sold/presale
amount" against it and BKG01 checks "survey, presale, extras". With Ben's designer that document becomes rich.

`presales`: `id uuid pk` · `job_id fk unique*` · `surveyor_id fk people*` · `submitted_at*` · `roof_notes` ·
`electrical_notes` · `design jsonb*` (elevations, clearances, obstructions, panel, layouts, inverter lines, battery,
extras, adjustments, performance assumptions — validated by a versioned zod schema) · `design_schema_version*` ·
`catalogue_version*` · snapshot columns for querying: `system_kwp`, `net_panels`, `computed_total_pence`,
`price_breakdown jsonb` · stamping. **Immutable once written** (trigger) — it is the record of what was sold.
Roof/electrical notes live here rather than in a one-row `TechnicalDetails` table; that table arrives with Booking.

## 4. TaskTemplate schema — `task_templates`

`code text pk` · `title*` · `task_group*` (reference vocabulary; slice 1 uses `Prebooking`) · `default_priority*` ·
`due_rule* check in ('at_creation','next_staffed_day','none')` · `guidance` (the reference's `evidence_required`
text — display only; the reference explicitly forbids deriving rules from it) · `active*` · `template_version*` ·
stamping + `version`. **[NEW]** `due_rule` becomes machine-readable; in the reference it was prose and the real rule
was hard-coded in each generator. Seeded with PRE01–PRE05, titles verbatim:
"Send deposit invoice", "Check contract sent/signed", "Confirm bank deposit", "Check customer details and
sold/presale amount", "Check finance agreement approval".

## 5. Task schema — `tasks`

`id uuid pk` · `job_id fk` · `template_code fk*` · `instance_key text unique*` · `task_group*` · `title*`
(snapshot) · `owner_id fk people*` · `backup_id fk people` · `related_entity_type / related_entity_id` ·
`due_at` · `original_due_at` · `priority*` · `status* check in (Blocked, Open, InProgress, Waiting, Complete,
Cancelled, NotRequired) default 'Open'` · `blocking_reason` · `next_followup_at` · `completed_at/by` ·
`completion_note` · `evidence_id` (FK added with Storage in slice 2) · `revision_required default false` ·
`created_rule_version*` · `assignment_rule_id fk` (traceability) · stamping + `version`.

**[REF]** `instance_key` is **fully** unique — the proven S06 rule is "one task per key, ever": a Complete or
Cancelled task is never recreated. Owner and backup share one row; whoever acts is recorded in `completed_by`.
Slice 1 only creates tasks; complete / follow-up / reopen and `task_events` arrive in slice 2.

## 6. Job lifecycle

`workflow_stage text check in` the ten reference stages (Prebooking, ReadyToBook, BookingInProgress, Booked,
AwaitingInstallation, InProgress, Aftercare, OperationallyComplete, CancellationInProgress, Cancelled). Slice 1
writes only `Prebooking`. Stage changes happen **only inside command functions**; clients get no UPDATE on `jobs`.
(Noted for later: the reference never writes AwaitingInstallation / InProgress / Aftercare — we will have to define
those transitions ourselves.)

## 7. Exact Presale fields

| Group | Field | Required | Source |
|---|---|---|---|
| Customer | first name, last name, address line 1, town, postcode | yes | [REF] |
| Customer | address line 2, phone, email | no (see §8) | [REF] |
| Sale | finance route: Standard / Phoenix / OtherReview | yes | [REF] |
| Sale | agreed gross price (£, stored as pence) | **yes** | [REF] optional → [NEW] required |
| Sale | salesperson (defaults to the signed-in surveyor) | yes | [REF] optional → derived |
| Sale | lead source, quote reference | no | [REF] |
| Scope | roof required, electrical required, scaffold required | yes (boolean) | [REF] |
| Scope | roof notes, electrical notes | no | [REF] |
| Design | everything in list A above, as `design` | per designer gating | prototype |

Dropped: `submitted_by` (now `auth.uid()`), `presale_file_id` (Drive), `valuation_basis` as an input (never on the
R1 form; PRE04 sets it, default `Standard`).

## 8. Validation (authoritative in the database function; mirrored by zod for UX)

- Payload is a strict allow-list: unknown keys are refused **[REF]** (`R1A_INVALID_FIELDS`).
- Text trimmed; required text non-empty **[REF]**; sensible max lengths **[NEW]**.
- Postcode upper-cased **[REF]** + must be a valid UK postcode, normalised to one space **[NEW]**.
- Email lower-cased **[REF]** + format check **[NEW]**; at least one of phone / email **[NEW]**.
- `finance_route` ∈ the three values **[REF]**.
- Price: strip `£`, commas, spaces; must match `^\d+(\.\d{1,2})?$`; pence = round(× 100); safe integer **[REF]**;
  and > 0 **[NEW]** (the reference allowed blank, but PRE04 can then never pass — `R1A_SOLD_VALUE_REQUIRED`).
- Salesperson must be an active person **[REF]**; a Surveyor may only name themselves **[DEC]**.
- `command_id`: a UUID (reference pattern `^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$`).
- No `expected_version` on submit — it creates, it doesn't mutate **[REF]** (the reference refuses one).

## 9. Job ID generation **[DEC]**

`SS-` + 4 letters from `ABCDEFGHJKLMNPQRSTUVWXYZ` (no I/O) + `-` + 4 digits — the reference generator exactly.
Generated inside the transaction; uniqueness guaranteed by the UNIQUE constraint (not by pre-reading all jobs);
on collision retry, up to 20 attempts, then fail `JOB_ID_COLLISION_EXHAUSTED` **[REF]**. ~3.3 billion values.
Generated once and immutable. UUID stays the primary key.

## 10. Task generation at submit **[REF]** unless marked

| Code | When | Due | Priority |
|---|---|---|---|
| PRE01 | finance route = Standard | the submit instant ("same day") | 1 |
| PRE02 | always | the submit instant | 1 |
| PRE03 | finance route = Standard | next staffed day, 09:00 | 2 |
| PRE04 | always | none ("before booking approval") | 2 |
| PRE05 | finance route ≠ Standard | none | 2 |

`instance_key = {code}-{job uuid}-ROOT-nodue`. Staffed day = Mon–Fri (the R1 reference passes no holidays; a
closures table can slot into `app.next_staffed_day()` later). Generation never reassigns, re-dates or reopens an
existing task. **[NEW]** "09:00" means 09:00 **Europe/London** (the reference writes literal `09:00Z`, an hour out
in summer — flagged in its own survey). **[NEW]** A missing/inactive template fails the whole submit; the reference
silently skips it. **Not created:** `PRE-COPY-JOBID` ("Prepare job booking") — it exists to get the old Booking
form submitted; I propose deciding its fate in the Booking slice.

## 11. Task assignment configuration **[DEC]**

`task_assignment_rules`: `id` · `template_code fk*` · `owner_person_id fk*` · `backup_person_id fk` ·
`eligible_owner_roles text[]*` · `active*` · stamping + `version`; **one active rule per template** (partial unique
index) so resolution is deterministic. `app.resolve_task_assignment(code)`:
owner must be active **and** hold an eligible role, otherwise the submit fails visibly with
`TASK_ASSIGNMENT_CONFIG` — never a fallback person **[REF: PRE03 rule, generalised]**; a backup who is inactive or
ineligible resolves to none, never to someone else **[REF]**. Seeded by `legacy_id` → UUID (no names/emails in
code): PRE01, PRE02, PRE04 → Tanya (eligible: office-class); PRE03 → Ben, backup Dan (eligible: Admin, Manager,
Director); PRE05 → Tanya, *provisional* until the finance workflow is ported. Admin-class can edit rules (RLS,
audited); tasks snapshot their owner, so a rule change never touches existing tasks. Nothing ported from
"first Office row", name matching or row order.

## 12. Idempotency and transaction design

One database function, `public.submit_presale(command_id, payload)`, is the whole transaction:

1. actor = `app.current_person_id()` — never from the payload; must hold permission `presale.submit`.
2. validate (§8).
3. `commands` row (`command_id pk`, type, actor, `fingerprint` = sha256 of canonical `{type, payload, actor}`,
   `result jsonb`, timestamps). Same id + same fingerprint → return the stored result, **no writes**; same id +
   different content or actor → `COMMAND_ID_CONFLICT` **[REF: the hardened S04 semantics]**. The primary key
   serialises concurrent double-submits.
4. insert customer → job (+ Job ID retry) → presale → tasks (§10–11) → audit events (one per created entity,
   sharing `command_id`; the job's action is `SoldIntake`; initiating person = actor) → store result.

Everything commits or nothing does, so the reference's Prepared / Applying / RecoveryRequired journal has no
equivalent. Rejected commands write nothing and are not audited **[REF]**. A replay is still subject to current
authorization **[REF]**. The Next.js server action generates nothing authoritative: it validates for UX, calls the
function as the signed-in user, and shows the result. The `command_id` is minted when the form is opened, so a
retry after a dropped connection is a replay, not a second job.

## 13. RLS and permissions

**[DEC] explicit permissions:** `role_permissions (role_code, permission)` + `app.has_permission()`, seeded by
migration, Admin-editable, audited. This is the enforced successor to the reference's `PermissionRules` table,
which its live commands ignored. Slice 1 permissions: `presale.submit`, `job.read.own`, `job.read.assigned`,
`job.read.all`, `task.read.assigned`.

| | Surveyor | Office / VariationApprover | Director | Admin / Manager |
|---|---|---|---|---|
| Submit a Presale | yes (as themselves) | yes, naming the salesperson **(confirm)** | no **(confirm)** | yes |
| See jobs / customers / presales | only where they are salesperson or submitter | where "assigned" | where "assigned" | all |
| See tasks | tasks they own/back up (none yet) | own/backup | own/backup | all |
| Direct INSERT/UPDATE/DELETE | none | none | none | none |

"Assigned" is the **[REF]** rule: you own or back up any task on the job, or are its salesperson. In practice Tanya
sees every job (she owns PRE02/PRE04 on all of them), Ben and Dan see every Standard job (PRE03). All writes go
through command functions; no table in this slice grants write access to clients. Surveyor inherits nothing from
Office **[DEC]**; Ben stays Director and gets exactly what the matrix gives Director **[DEC]**.

## 14. Business semantics preserved

Sold creates exactly one Customer + one Job at `Prebooking`; the field contract and transforms; finance-route
vocabulary and its effect on PRE tasks; PRE task set, due rules, priorities, titles; PRE03 as a named personal
responsibility with optional backup that fails visibly rather than falling back; one-task-per-instance-key forever;
generation never mutating existing tasks; shared owner/backup row; command_id idempotency with content + actor
fingerprint; no audit for rejected commands; one audit event per created entity with initiating person ≠ executing
service; attribution by person id; Job ID alphabet/format/retry; assignment-scoped job visibility; salesperson must
be an active person; strict payload allow-list.

## 15. Deliberately not ported

`DEVNewJobSoldRequests` rows, `result_*` columns, "My Requests", bots, `USEREMAIL()` / `submitted_by` cross-check;
`Intake` raw-payload table, `MappingRules`, Jotform `qid`s and form ids; CommitJournal and recovery classification;
`withLock`; cardinality self-checks (`R1A_INTAKE_CARDINALITY`) that only guard against Sheets partial writes;
ReleaseModes / `pilot_job` / `release_scope` gates; self-healing templates (`ensurePre04Template`); Drive file ids;
Xero intents (R4); `NOT_CONFIGURED` placeholders; random text ids; "first Office row" / name / row-order ownership.
**Deferred, not dropped:** invoice stages. The reference creates deposit + interim stages at sale (25% / 35%;
final 40% only after completion). They gate PRE01/PRE03, so I propose creating the table in slice 2 with an
idempotent backfill for jobs sold in slice 1 — subject to the VAT decision below.

## 16. Proposed Presale UI (from Ben's prototype)

Keep his visual language wholesale: paper/ink/amber tokens with the dark set, IBM Plex Sans/Mono + Big Shoulders
Display, 640 px mobile-first column, cards, param chips, toggle pairs, sticky stat strip, banners, the
"Use these values → Values confirmed" pattern. Route `/presales/new` with its own themed layout inside the app.

Flow — his seven steps, bracketed by the two that are missing:
**1 Customer** → 2 Parameters → 3 Elevations → 4 Obstructions (skipped when all elevations are Complex) →
5 Panels → 6 Layout → 7 Price → 8 Performance → **9 Sale & submit** (finance route, agreed price pre-filled from
the computed total, scope flags pre-derived — roof = panels > 0, scaffold = metres > 0 — and editable, notes,
read-only review, Submit). Then a confirmation screen showing the Job ID and who now holds which task, and a
**My presales** list for the surveyor. Local autosave per draft as in the prototype, keyed by `command_id`.

Fix rather than copy: the 7-pill stepper in a 5-column grid (make it scroll), ± buttons not clearing "confirmed",
the stepper jump that skips the all-elevations-confirmed check, stale page numbers in three strings, unescaped
elevation names, scaffold "minimum 8 / 2" that isn't enforced.

The designer maths (fit, kWp, pricing, performance) becomes a pure, tested TypeScript module whose outputs are
checked against the prototype's numbers; catalogue and prices live in a versioned file, stamped on every presale.

## 17. Decisions needed

1. **Scope split (recommended).** 002a = backend + Customer / Sale steps + submit + confirmation + surveyor list —
   proves your acceptance target end to end. 002b = port the designer (steps 2–8) into the same flow. Or all at once?
2. **What is the sold price?** Recommended: the designer's computed total pre-fills "agreed price", the surveyor
   confirms or overrides, we store both, and PRE04 verifies the agreed figure. (In 002a it is simply typed.)
3. **Finance mapping.** How do `No / Yes / Maybe` map to `Standard / Phoenix / OtherReview`? Can a "Maybe" be
   submitted as sold at all? Do the £250 / £125 admin fees stand?
4. **VAT.** Prototype: £0. Reference: every stage split at 20%. Which is right for these jobs? (Needed for slice 2.)
5. **Panel catalogue authority.** 510 W / 475 W (prototype) vs 515 W / 460 W (reference). Who owns the price list?
6. **Office visibility.** Keep the reference's assignment-scoped rule (Lucy, Rosie and Hannah see a job only once
   they hold a task on it), or let all Office staff see all jobs?
7. **Who else may submit.** Office/Admin entering a sale on a surveyor's behalf — yes? Director — no?
8. **Drafts.** Local autosave only for now (works offline on a roof; schema leaves room for server drafts), or
   server-side drafts from day one?
9. **Tightenings** (§8, §10): price required, UK postcode format, phone-or-email required, 09:00 London time,
   missing template fails the submit. All OK?
10. **PRE05 → Tanya** provisionally, and **drop `PRE-COPY-JOBID`** until the Booking slice?
11. **Invoice stages deferred to slice 2** with a backfill — OK?
