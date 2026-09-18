# REF-03 — Job workflow, tasks, gates, evidence (R1 Office journey)

Source repo (read-only): `/Users/lennybeadle/:reference`. All citations are `path:line` relative to that root.
Canonical business-rule source is the Node modules (`sNN/*.js`, `r1-appsheet/*.js`, `processor/*.js`). The
`apps-script/sNN/*.js` files are self-contained cloud smoke bundles; several are OLDER/simplified copies (see §11.1).
`standalone-bridge/AppSheetBridge.js` (8208 lines) is a generated bundle of the canonical modules and was not used as a source.

Conventions used below: **[BIZ]** = business semantics to preserve; **[PLUMB]** = platform plumbing not to port.

---

## 0. Executive orientation

- The whole system is a **command processor over tables**: each staff action is a named command with `command_id`
  (idempotency key), `expected_version` (optimistic lock on one named entity), a whitelisted payload, an authenticated
  actor resolved from `People.email` + active `PersonRoles`, a `CommitJournal` row (Prepared → Committed /
  RecoveryRequired), a `TaskEvents` row and an `AuditEvents` row. In Postgres this collapses to: one transaction +
  unique `command_id` + row version check + audit/event inserts.
- The R1 Office journey actually implemented end to end is:
  `SOLD_INTAKE → (PRE01..PRE05 via TASK_COMPLETE / TASK_EVIDENCE_ATTACH / TASK_REOPEN) → auto ReadyToBook →
  BOOKING_INTAKE → BookingInProgress + BKG01..03 → CONFIRM_BOOKING → Booked + BKG04/05 → planner / MOVE_JOB /
  CHANGE_INSTALLER → CALL_RECORD / ISSUE_* / COMMISSIONING_RECORD → OPERATIONAL_COMPLETE → GHL01`, with
  `CANCEL_JOB` / `REINSTATE_JOB` available throughout.
- **No code anywhere sets `workflow_stage` to `AwaitingInstallation`, `InProgress` or `Aftercare`** (see §2.3, §11.2).

---

## 1. Stage modules S05…S20

Release allocation authority: `docs/release-plan.md:15-20` (R1 = "S01–S06; office/manual portions of S09–S13 and
S15–S17"; R2 = "S07–S09; Calendar adapter portion of S11; extend S15–S17"; R3 = "S12 and extensions S10,S15–S17";
R4 = "automated S13, S14, remaining S16–S17"). `docs/R1-go-live-readiness.md:9-13` restates the same boundary.

| Stage | File(s) | Release | What it implements |
|---|---|---|---|
| S05 | `s05/intake.js`, `s05/mapping.js`, `s05/booking-apply.js`, `s05/priority.js` | **R1** | Sold + Booking intake. Sold creates exactly one Customer + one Job (`workflow_stage:'Prebooking'`, `contract_status:'NotSent'`, `sold_booking_match_status:'Pending'`, `handover_status:'NotReady'`, `financial_status:'Pending'`, `release_scope:'R1'` — `s05/intake.js:69-113`), generates the public job id once (`SS-` + 4 letters (no I/O) + `-` + 4 digits, 20 collision retries, `s05/mapping.js:219-236`), then calls S06 `createPrebookingTasksForSold` (`s05/intake.js:219-230`). Booking matches an existing Job by **exact public `job_id` only** (`s05/mapping.js:209-217`; blank → `BLANK_JOB_REFERENCE`, unknown/ambiguous → `NO_MATCHING_JOB`, both Intake `Review`, never surname/address matching — `s05/intake.js:275-293`), applies structured data (WorkPackages, Allocations, ScaffoldBookings, Materials, JobEquipment, TechnicalDetails, CustomerChanges) and sets `sold_booking_match_status` to `Match` or `Review`. Idempotency = `Intake.intake_id` + canonical payload hash; same id + different payload → `Review`/`CONFLICTING_INTAKE` (`s05/intake.js:152-172`). `priority.js` is a pure due-window classifier (`OVERDUE | DUE_TODAY | DUE_TOMORROW | NEXT_7_DAYS | NORMAL_LATER | NO_DUE`, Europe/London, `s05/priority.js:27-45`). |
| S06 | `s06/gates.js` | **R1** | The gate engine and the PRE/BKG task generator: `evaluateReadyToBook`, `evaluateBookingGates`, `taskSatisfaction`, `bankConfirmationEvidence`, `createPrebookingTasksForSold`, `createTasksForJob`, `processBookingGates` (stage advance one step per call), `confirmBookingFromEvaluatedGates`, staffed-day helpers, PRE03 owner/backup resolution. Everything in §2, §3, §5, §6, §7 is rooted here. |
| S07 | `s07/ordering.js` | **R2** (FN-03) | Material requirement evaluation (each `Materials` line needs product_id-or-description, quantity>0, merchant_id, need_by_date — `s07/ordering.js:26-41`), order creation grouped by merchant with deterministic id `ORD-{jobId}-{merchantId}` (`:114`), marks Materials `source:'AlreadyOrdered'` (`:177-183`), creates one `MAT01` task when any `Draft` order exists (`:243-246`). |
| S08 | `s08/picking.js` | **R2** (FN-05) | Stock balance purely from the `StockMovements` ledger (`s08/picking.js:10-23`), pick evaluation/execution against `LOC-store`, `Reservations`, one `S08-PICK-STOCK` task per job (`instance_key 'S08-PICK-'+jobId`, `:169-189`). |
| S09 | `s09/scaffold.js` | **R2** automated part (FN-04); R1 only tracks scaffold manually | `evaluateScaffoldRequirement` (`NotRequired` / `AlreadyBooked` / `Ready`), deterministic booking `SB-{jobId}` status `Requested`, erect date = install date − `Companies.standard_lead_days`, rolled back off weekends (`s09/scaffold.js:83-89`), one `SCA01` task owned by `PERSON-tanya` (`:98-123`). Hard-wired to the synthetic `COMP-scaffold-dev` company (`:57`) — DEV-only. |
| S10 | `s10/operations.js` | **R1** (FN-01 Automated; FN-18/19/11 Manual) | Installer confirmation calls (INS01), customer happy call (INS04), call recording with task side effects, Issues (Variation/Remedial/Complaint) + ISS01/ISS02 tasks + IssueEvents, REM01 return-visit task, missing-commissioning reminder (INS02, two staffed days), operational-completion gate and approval → `OperationallyComplete` + GHL01 task + `GHLTasks` row. |
| S11 | `s11/planner.js` | **R1** for `updatePlannedDates`, `moveJobR1`, `changeInstallerR1`, `buildPlanner` (3/6-week); **R2** for `planWorkPackage`/`moveWorkPackage`/`changeInstaller` (require FN-02 Calendar Automated/Pilot/R2 and a synthetic `S11*` job, `s11/planner.js:25`) | Planner read model, date moves with revision bumps, installer replace/add, capacity/leave/skill/holiday checks, Calendar intent captured to `CalendarLinks` + `Outbox` with `response_summary:'CAPTURE_ONLY: no Calendar API call'` (`:41`), move "impact tasks". |
| S12 | `s12/commissioning.js` | **R3** (FN-06/07); R1 uses only `ensureR1OfficeCommissioningTemplate` (`s12/commissioning.js:155-195`) via COMMISSIONING_RECORD | See §1.1 (filled from the S12–S20 survey). |
| S13 | `s13/payments.js` | **R4** automated; R1 uses stage calculation + manual tasks | See §1.1. |
| S14 | `s14/reporting.js` | **R4** | See §1.1. |
| S15 | `s15/cancellation.js` | **R1** (FN-01 + FN-17 + FN-20) | See §1.1 and §7.4. |
| S16 | `s16/health.js`, `s16/heartbeat.js` | **R1** foundation (FN-14/FN-16), remainder R4 | See §1.1. |
| S17 | `s17/admin.js` | **R1** | Office read models (`_s17OfficeToday`, `_s17OperationalQueue`, `_s17JobOverview`, `_s17ActionAvailability`, `_s17TaskActionAvailability`, audit history, release-mode/system status). See §1.1. |
| S18 | `s18/acceptance.js` | per-release gate | Acceptance checklist evaluator — release governance, not product behaviour. |
| S19 | `s19/migration.js` | per-release gate | Migration/training readiness evaluator — governance. |
| S20 | `s20/release.js` | per-release gate | Cutover authorisation evaluator — governance. |

### 1.1 S12–S20 detail

(Surveyed by a delegated sub-agent; the load-bearing S15 lines were re-verified directly.)
Bundle note: `apps-script/s15…s20` are verbatim concatenations of source; `apps-script/s12…s14` are hand-condensed
rewrites that drop rules (e.g. S12 bundle has no "Already accepted" guard and no R1 office template; S13 bundle has no
`milestone_tasks:false`). Treat `sNN/*.js` + tests as the spec.

**S12 Commissioning (R3; FN-06/07/08).** `s12/commissioning.js`. Status machine `Draft → Submitted → Accepted |
Returned`; one submission per work package (`CS-{wpId}`, `:25-42`); `submitAnswers` never overwrites an existing answer
(`{submissionId}-A-{question_key}`) and refuses `'Already accepted'` (`:44-71`); `reviewSubmission` accepts only
`Accepted|Returned` (`:73-85`) — the *approved-template* requirement lives in `r1-appsheet/operations-contract.js:93`,
not in S12; `evaluateHandover` ready = ≥1 submission, all `Accepted`, ≥1 JobEquipment row (`:104-125`);
`createHandover` `HO-{jobId}` `completeness_status:'Pending'`, S15-guarded, and does **not** require handover readiness
(`:127-145`). No role checks, no tasks, no stage transitions, no photo/document validation in S12 itself. R1 uses only
`ensureR1OfficeCommissioningTemplate` (`CT-R1-OFFICE-{trade}`, `template_version:'R1-OFFICE-MANUAL-1.0'`,
`approved_by/approved_at` always null and re-nulled if drifted, `:155-187`). Real commissioning content is
**BLOCKED — INPUT REQUIRED** (`docs/operations-overview-review.md:39`).

**S13 Payments (automation R4 / FN-09; manual bank + GHL are R1 / FN-15, FN-11).** `s13/payments.js`.
`STAGES = {deposit:25, interim:35, final:40}` (`:8`); stage id `IS-{jobId}-{stage}`, `gross = round(gross×pct/100)`,
`net = round(gross/1.2)`, `vat = gross − net`, status `Pending`; **only interim gets a `due_date`** = Friday on/before
`Jobs.next_action_at` (`:167-173`); **the final stage is not created until `operational_complete_at` is set**
(`:10-48`). `confirmDeposit` (`:50-72`) stamps stage `Confirmed` + Job deposit fields but writes **no**
ManualBankChecks row — so by design it can no longer satisfy the S06 gate (`tests/r1-appsheet.test.cjs:1884-1894`).
`createXeroIntent` writes a capture-only Outbox row. Tasks: `S13-INTERIM-CHASE` (due now, p1, owner literal
`PERSON-tanya`, **no S15 guard**) and `S13-GHL-PROGRESSION` (+ `GHLTasks` row `GHL-{jobId}`); `processJobPayments`
creates both unless `milestone_tasks === false` (R1 sold intake passes false). The `Payments` table is never written —
there is no record-payment command. Business rules: unpaid interim never blocks install; final invoice gated on
operational completion; GHL is always a human task.

**S14 Reporting (R4; FN-09/FN-12).** Read-only except `ReportSnapshots`. `financially_complete` = operationally
complete AND all three stages exist AND each outstanding = 0 (`s14/reporting.js:71-79`). Reconciliation exception
types `OVERPAYMENT`, `DUPLICATE_PAYMENT_REF`, `MISSING_EXTERNAL_REF`, `FINAL_BEFORE_OPERATIONAL` (`:101-159`).
Snapshots `RS-{type}-{periodStart}` immutable. Two different "overdue" definitions (`:28-97` vs `:163-186`).

**S15 Cancellation / reinstatement (R1; `S15_ENABLED = ['FN-01','FN-17','FN-20']`).** `s15/cancellation.js`, entry
`_s15Execute(kind ∈ Cancel|Resolve|Close|Reinstate)` + read-only `_s15Preview`. Only `Cancel` and `Reinstate` are
bound to R1 adapter commands (`r1-appsheet/services.js:693-694`); **`Resolve` and `Close` have no adapter command**
(§11.12).
- Scope/auth (`:33-43`): job pilot+R1; actor must be an active person with `People.role` or active PersonRole ∈
  `Admin|Office|Manager` (`S15_REFUSED: authenticated office actor required`) — narrower than the adapter's office
  class (a Director/VariationApprover passes the adapter then fails here); `command_id` `^[-A-Za-z0-9]+$` and non-empty
  `reason`; `expected_version` = Jobs.version (`S15_REVIEW: stale job revision`).
- Risk flags (`:61-68`): `OPERATIONALLY_COMPLETE`, `WORK_PERFORMED_OR_UNCERTAIN`, `PAYMENT_REVIEW`,
  `FINAL_INVOICE_REVIEW`, `SAFE_STRIP_REQUIRED`, `PHYSICAL_STOCK_REVIEW`, `EVIDENCE_HANDOVER_REVIEW`.
- **Cancel** (`:91-143`): no source-stage precondition except not already cancelling
  (`S15_REVIEW: cancellation already started; replay original command`). Job → `CancellationInProgress` +
  `cancellation_at/by/reason`. WorkPackages untouched-by-work (`Unscheduled|Scheduled`, no actuals, no installer
  confirmation) → `Cancelled`; others get a Blocked `S15-CAN-REVIEW`. Active allocations ending on/after the effective
  date → `active:false`; each gets `S15-CAN-INSTALLER`. **Open tasks cancelled** (`status:'Cancelled'`,
  `completion_note = reason`) when status ∈ Open/Waiting/InProgress/Blocked, group ≠ `Cancellation`,
  `related_entity_type ≠ 'Issues'`, and (template ∈ `PRE01, PRE02, BKG01, BKG04, MAT01, MAT05, FIN01, FIN03, GHL01,
  S13-GHL-PROGRESSION, S08-PICK-STOCK, SCA01` OR linked from a GHLTasks row OR group ∈ `Prebooking|Booking`)
  (`:105-106`, verified). Consequently issue tasks, INS01/INS02/INS04/REM01 (group Install/Aftercare),
  `S13-INTERIM-CHASE`, `S06-UNPAID-INTERIM` (Finance) and `S11-MOVE-*` Install/Materials/Finance tasks stay open.
  Materials `cancelled_quantity = required_quantity`; unpicked Active reservations → `Released`, others → Blocked
  `S15-CAN-STOCK` ("no automatic reversal"); StockMovements never touched; pure-Draft orders → `Cancelled`, any sent
  order → `Review` + Blocked `S15-CAN-MERCHANT`; scaffold: erected → `S15-CAN-STRIP`, unerected → `S15-CAN-SCAFFOLD`
  (both Blocked, booking status unchanged, revision+1); CalendarLinks → `Error` + Outbox `CalendarCancel`
  `NeedsReview` + Blocked `S15-CAN-CALENDAR`; never-attempted Pending Outbox → `Cancelled`, others → `NeedsReview`;
  Communications Draft/Approved/Queued → `Failed`; **payments/invoices never changed** — each stage gets Blocked
  `S15-CAN-XERO`; conditional `S15-CAN-SIGNABLE`, `S15-CAN-PHOENIX`, `S15-CAN-LEGACY`, `S15-CAN-FINANCE`; always
  `S15-CAN-CUSTOMER`, `S15-CAN-SALES`, `S15-CAN-GHL` (Blocked).
- S15 task construction (`:80-89`, verified): template must be active else `S15_NOT_CONFIGURED: {code}`;
  `instance_key = S15-{command_id}-{code}-{entityId}`; group `Cancellation`; priority 1; due now;
  **`revision_required:true`**; status `Blocked` iff a blocking reason string is supplied else `Open`;
  `owner_id` = the acting user, `backup_id` = the acting user. The `S15-CAN-*` templates exist only in
  `s15/fixture.js:2-19`, **not** in `schema/config-seed.json`.
- **Resolve** (`:144-163`): stage must be cancelling/cancelled; task open + group Cancellation; `evidence_reference`
  required; `task_version` must match; the four confirmation tasks (`S15-CAN-MERCHANT|SCAFFOLD|STRIP|CALENDAR`) need
  `outcome === 'Confirmed'` and `confirmed_revision` = the entity's **current** revision else
  `S15_REVIEW: latest revision confirmation required; sent is not confirmed`; STRIP also needs `actual_date`;
  `S15-CAN-GHL` needs real GHL ids else `S15_NOT_CONFIGURED: GHL cancellation IDs` (nothing ever fills them).
- **Close** (`:164-173`): only from `CancellationInProgress`; no open confirmation task; every other pending
  cancellation task must be listed in `tracked_obligations[{task_id, reference, reason}]`; then Job → `Cancelled`.
- **Reinstate** (`:174-186`): only from `Cancelled`; `new_date` strictly after `cancellation_at`; `risk_review`
  required when risk flags exist; Job → `Prebooking`, cancellation + booking-approval fields cleared,
  `next_action_at = new_date`; each cancelled required WP spawns a new `Unscheduled` package
  `WP-{commit}-{oldId}` with `parent_package_id`; old allocations not reactivated; creates Open
  `S15-REOPEN-REVIEW` which suppresses all normal work until complete (see §11.11 — no implemented way to complete it).

**S16 Health / heartbeat / archive (FN-14 Automated + FN-16 Manual are R1; FN-13 archive is R4).** Health status
`Healthy|Degraded|Critical` from journal/outbox/heartbeat state; writes `HealthChecks`; **alerts never create tasks**.
Heartbeat states `Fresh|Stale|Failing|Quiet|Never`, stale threshold setting `health.heartbeat_stale_minutes` default
120, staffed window from `office.staffed_weekdays` / `office.hours` (09:00 incl.–17:00 excl. London) / Holidays.
`_s16SystemTasks` (`s16/health.js:787-856`) creates `SYS01`/`SYS02` tasks: key `S16-{command_id}-{code}`, group
`System`, `job_id:null`, due **now** (template `09:00`/`16:30` not applied), owner = first active Office person whose
display_name contains "tanya", else active `Manager` whose name contains "ben"; backup = the other; neither found →
silently skipped. **No task-overdue escalation, no owner fallback on absence exists anywhere.** Archive eligibility
(`:500-590`): operationally complete, ≥ 6 calendar months (`S16_ARCHIVE_MONTHS = 6`), not cancelled, no open tasks,
no unresolved issues, `handover_status ∈ Sent|Approved`, nothing outstanding, no live outbox, no unstripped scaffold.
Backup manifest/restore = plumbing.

**S17 Admin/screens (R1).** Entirely **read-only** (`tests/s17.test.cjs` asserts no mutation). No admin commands for
people, roles, absences, task reassignment, templates or config exist. Read models listed in §9. Quirks: `ghl` queue
matches group `CRM` or template `GHL01`, so `S13-GHL-PROGRESSION` (group Aftercare) never appears
(`s17/admin.js:416`); `calls` queue references a non-existent `CAL01`.

**S18/S19/S20.** Read-only release-governance simulators (item statuses `PASS|BLOCKED|NOT_RUN|FAIL|NOT_APPLICABLE`;
outputs `READY_FOR_CONTROLLED_PILOT`, `READY_FOR_S20`, `AUTHORIZED_FOR_CUTOVER`). Nothing to port except a few data
invariants usable as DB checks (S18 R2 stock/material invariants, `s18/acceptance.js:345-424`). Note S18 JOB-01
validates job ids with `^SS-\d{4}-\d{4}$` (`s18/acceptance.js:148`), which **contradicts** the generator and the R1
adapter (`^SS-[A-Z]{4}-\d{4}$`) — see §11.13.

---

## 2. Job workflow stages

### 2.1 Exact stage list

`processor/types.js:55-66`:

```
Prebooking, ReadyToBook, BookingInProgress, Booked, AwaitingInstallation, InProgress,
Aftercare, OperationallyComplete, CancellationInProgress, Cancelled
```

Related job-level status enums seen in code (not stages): `contract_status` ∈ {`NotSent` (`s05/intake.js:87`), `Sent`
(`r1-appsheet/services.js:107`), `Signed` (`:85`)}; `sold_booking_match_status` ∈ {`Pending`, `Match`, `Review`};
`finance_route` ∈ {`Standard`, `Phoenix`, `OtherReview`} (`s06/gates.js:108`); `handover_status:'NotReady'`,
`financial_status:'Pending'` (initial values only).

### 2.2 Transitions actually implemented

| # | From → To | Trigger (who) | Preconditions | Side effects | Cite |
|---|---|---|---|---|---|
| T1 | (none) → `Prebooking` | `SOLD_INTAKE` (Office/VariationApprover/Director/Admin/Manager; FN-01 Automated/Pilot/R1) | Required payload: `customer_first_name, customer_last_name, street_address, city, postcode, finance_route`; `finance_route` ∈ Standard/Phoenix/OtherReview; optional `salesperson_id` must be an active Person; `submitted_by` must equal the actor | 1 Customer, 1 Job (`pilot_job:true`, `release_scope:'R1'`), optional TechnicalDetails, Intake row, prebooking tasks (§3.1), and — if `original_gross_pence>0` — S13 `processJobPayments(job.id, store, {milestone_tasks:false})` to create InvoiceStages/Xero intents but **not** interim-chase/GHL tasks | `r1-appsheet/services.js:1193-1235`, `s05/intake.js:146-241` |
| T2 | `Prebooking` → `ReadyToBook` | **Automatic** — post-command hook `_r1sReevaluatePrebooking` after any TASK_COMPLETE / TASK_REOPEN / TASK_EVIDENCE_ATTACH(repair) on PRE01–PRE05, after DEPOSIT_CONFIRM, or explicit `BOOKING_GATES` command | `evaluateReadyToBook(job).ready === true` (§6) | Job version+1, `updated_by`=actor; AuditEvent id `AE-S06-ReadyToBook-{jobId}` action `WorkflowStage:ReadyToBook` (written once — id is deterministic, so a second promotion after a demotion writes **no** second audit row, see §11.6); also runs `createTasksForJob` (idempotent backfill) | `s06/gates.js:764-795`, `r1-appsheet/services.js:262-269,485` |
| T2r | `ReadyToBook` → `Prebooking` (demotion) | Automatic — same hook, when a gating PRE task is reopened or otherwise readiness becomes false | job is `ReadyToBook` and `evaluateReadyToBook.ready` false | Job version+1; AuditEvent `AE-R1A-DEM-{command_id}` action `WorkflowStage:Prebooking`, reason = readiness summary (`PrebookingBlocked`). **Never touches `BookingInProgress` or later** | `r1-appsheet/services.js:270-291` |
| T3 | `ReadyToBook` → `BookingInProgress` | `BOOKING_INTAKE` when the job is `ReadyToBook` (`s05/intake.js:302`); or `processBookingGates` when stage is `ReadyToBook` and `booking_submission_id` is set (`s06/gates.js:796-798`) | Job pilot/R1, not archived, not `CancellationInProgress`/`Cancelled`, stage ∈ {Prebooking, ReadyToBook, BookingInProgress}; `expected_version` = Jobs.version; booking `finance_route` (if supplied) must equal the job's (`R1A_FINANCE_ROUTE_CONFLICT`) | Links `booking_submission_id`, sets `sold_booking_match_status` `Match`/`Review`, structured apply (§7.1), completes open `PRE-COPY-JOBID` helper as superseded, generates BKG01–03 via `processBookingGates` | `r1-appsheet/services.js:1272-1323`, `s05/intake.js:296-306` |
| T3e | `Prebooking` + early Booking | `BOOKING_INTAKE` while still `Prebooking` | same as T3 | Booking is **linked but the stage stays `Prebooking`** ("cannot skip the explicit ReadyToBook gate"); the adapter asserts this (`R1A_STAGE_RULE_BROKEN` if it changed). Later, when readiness passes, `processBookingGates` moves Prebooking→ReadyToBook on one call and ReadyToBook→BookingInProgress on the **next** call ("one stage at a time") | `s05/intake.js:301-302`, `r1-appsheet/services.js:1312-1313`, `tests/s06.test.cjs:396-427` |
| T4 | `BookingInProgress` → `Booked` | `CONFIRM_BOOKING` (Office/Admin/Manager only — **not** Director/VariationApprover; must be assigned to the job; FN-01) — or legacy `BOOKING_GATES`/`processBookingGates` when `evaluateBookingGates.ready` | stage must be exactly `BookingInProgress` (`R1A_STAGE_NOT_BOOKING_IN_PROGRESS`); `expected_version` = Jobs.version; `evaluateBookingGates(job).ready === true` else `R1A_BOOKING_GATES_NOT_SATISFIED` with `outstanding:[gate names]`; active BKG04 and BKG05 templates must exist (`S06_CONFIG`) | `workflow_stage:'Booked'`, `booking_approved_at=now`, `booking_approved_by=actor`, version+1; creates BKG04 + BKG05 (due = now, priority 2, owner = first active Office PersonRole else `PERSON-tanya`); AuditEvents `AE-S06-Booked-{jobId}` and `AE-R1A-{command_id}` (`BookingConfirmed`). Already Booked → returns `AlreadyBooked` (or `Replayed`) and never re-creates tasks | `r1-appsheet/services.js:1531-1578`, `s06/gates.js:530-584`, `r1-appsheet/adapter.js:198-201` |
| T5 | any non-complete → `OperationallyComplete` | `OPERATIONAL_COMPLETE` (Office/Admin/Manager; assigned to job; FN-19 Manual + FN-11 Manual) | `expected_version` = Jobs.version; S15 suppression not active; `evaluateOperationalCompletion.ready` (§7.5). **The server does not check the current stage** — only the read-side availability flag restricts it to `InProgress`/`Aftercare` (`r1-appsheet/adapter.js:112`, `s17/admin.js:630`) | `operational_complete_at/by`, stage, version+1; GHL01 task (due next staffed day, instance key `GHL01-{jobId}-OPCOMPLETE`) + `GHLTasks` row `GHL-{jobId}-OPCOMPLETE`; if gate not ready returns `{status:'NeedsReview', gate}` and writes nothing | `s10/operations.js:138-165`, `r1-appsheet/services.js:712-713` |
| T6 | any active → `CancellationInProgress` → `Cancelled` | `CANCEL_JOB` (office class; assigned; FN-01 + FN-17 Manual + FN-20 Manual) | payload all required: `reason, effective_date, work_performed, material_state, scaffold_state, finance_review, legacy_state` | see §7.4 / §1.1 S15 | `r1-appsheet/services.js:693`, `s15/cancellation.js:95,173` |
| T7 | `Cancelled` → `Prebooking` | `REINSTATE_JOB` (same auth as T6) | payload required: `reason, new_date, commitment_review, finance_review, evidence_reference` (`risk_review` optional) | clears `cancellation_*`, `booking_approved_at/by`, sets `next_action_at=newDate`; same Job ID retained | `r1-appsheet/services.js:694`, `s15/cancellation.js:181` |

### 2.3 Stages with no implemented transition

`AwaitingInstallation`, `InProgress`, `Aftercare`: the constants exist (`processor/types.js:60-62`) and are **read** by
availability rules (move/change-installer allowed in `Booked, AwaitingInstallation, InProgress, BookingInProgress` —
`r1-appsheet/adapter.js:113`; operational completion offered in `InProgress, Aftercare` — `:112`), and the R1 cloud
smoke fixture seeds a job directly at `Aftercare` (`r1-appsheet/cloud-adapter.js:59`). A repo-wide search for writes
(`workflow_stage: '…'`) finds only Prebooking / ReadyToBook / BookingInProgress / Booked / OperationallyComplete /
CancellationInProgress / Cancelled. **The port must define Booked → AwaitingInstallation → InProgress → Aftercare
itself** (see §11.2).

### 2.4 Global suppression rule ("S15 review") [BIZ]

Every normal-work generator throws `S15_REVIEW: normal work suppressed` if the job has `cancellation_at`, or stage ∈
{`CancellationInProgress`,`Cancelled`}, or has an open (`not Complete/NotRequired`) task with template
`S15-REOPEN-REVIEW`. Present in `s06/gates.js:354` (createTasksForJob), `s07/ordering.js:92,205`,
`s08/picking.js:89,163`, `s09/scaffold.js:38,93`, `s10/operations.js:150,159`, `s11/planner.js:154,159,164`,
`s13/payments.js` (createGHLTask). Note `createPrebookingTasksForSold` and the R1 `moveJobR1`/`changeInstallerR1`
functions do **not** carry this guard; for those the adapter's `R1A_JOB_NOT_ACTIONABLE` checks are the only protection
(and MOVE_JOB/CHANGE_INSTALLER have none server-side — see §11.7).

---

## 3. Task generation rules

### 3.1 Template catalogue

28 seeded templates in `schema/config-seed.json:58-87`, fields: `template_code, title, group, default_owner_role,
trigger_event, due_rule, evidence_required, active, template_version`. `due_rule` and `evidence_required` are
**free text guidance** — no code parses them; actual due dates are hard-coded per generator (below).
`evidence_required` is surfaced read-only on the Complete Task form as "Required checks" and the doc says explicitly
"Do not add a backend rule from this text" (`docs/R1-office-appsheet-configuration.md:476`).

Templates used in code but **absent from the seed**: `INS04`, `REM01`, `ISS01`, `ISS02` (`docs/S10-implementation.md:11`;
ISS01/ISS02 are auto-provisioned by `_r1sEnsureIssueTaskTemplates`, `r1-appsheet/services.js:627-638`, with
`default_owner_role` `VariationApprover`/`Office`, `trigger_event:'Issue created'`, `due_rule:'Next staffed day'`,
`template_version:'R1A-1.0'`; REM01/ISS01/ISS02 titles also in `installer/workflow.js:21-23`). Ad-hoc codes with no
template row at all: `PRE-COPY-JOBID`, `S06-UNPAID-INTERIM`, `S08-PICK-STOCK`, `S11-MOVE-{code}`, `S13-INTERIM-CHASE`,
`S13-GHL-PROGRESSION`, `S15-*`, `CAL-DRIFT`, `XO-REVIEW-CANCEL`, `R1A-ACCESS`. Seeded templates whose generators live
**outside the S05–S17 stage modules**: `MAT02–MAT06` (`materials/workflow.js`, `materials/revisions.js`,
`stock/workflow.js` — R2 modules, not surveyed here), `SCA02–SCA05` (`scaffold/workflow.js` — R2, not surveyed),
`SYS01`/`SYS02` (only via the manually-invoked `_s16SystemTasks`), `FIN03` (only in the in-memory S03 demo processor,
`processor/processor.js:282-294` — no R1 generator). `FIN02` is referenced in docs/comments (`r1-appsheet/services.js:1225`,
`docs/R1-office-appsheet-configuration.md:573`) but **does not exist** as a template or generator.

### 3.2 Generators (event → tasks)

| Event | Generator | Tasks created | Owner / backup | Due | Priority | instance_key | Cite |
|---|---|---|---|---|---|---|---|
| Sold intake processed | `createPrebookingTasksForSold` | `PRE01` (Standard only) | Office person (§5) / — | `now` ("Same day") | 1 | `PRE01-{jobId}-ROOT-nodue` | `s06/gates.js:700-703` |
| 〃 | 〃 | `PRE02` (always) | Office / — | `now` | 1 | `PRE02-{jobId}-ROOT-nodue` | `:704-705` |
| 〃 | 〃 | `PRE03` (Standard only) | `PERSON-ben` / `PERSON-dan` | `nextStaffedDay(now)` 09:00Z | 2 | `PRE03-…` | `:706-709` |
| 〃 | 〃 | `PRE04` (always; template self-healed by `ensurePre04Template`) | Office / — | **null** ("Before booking approval") | 2 | `PRE04-…` | `:698,710-713` |
| 〃 | 〃 | `PRE05` (finance_route set and ≠ Standard) | Office / — | null | 2 | `PRE05-…` | `:714-717` |
| 〃 | 〃 | `PRE-COPY-JOBID` titled **"Prepare job booking"**, group `Prebooking` | Office / first active Admin PersonRole else `PERSON-ben` | `nextStaffedDay(now)` | 1 | `PRE-COPY-JOBID-{jobId}` | `:718-759` |
| `processBookingGates` / BOOKING_GATES / auto re-evaluation (job has sold or booking link) | `createTasksForJob` | Backfills `PRE01` (Standard), `PRE02`, `PRE03` (Standard), `PRE04` — note due dates differ from the Sold generator: PRE01/PRE02 due `nextStaffedDay(now)` here vs `now` at Sold. **Does not backfill PRE05** | as above | see note | 1/1/2/2 | same keys | `s06/gates.js:426-449` |
| Booking linked (`job.booking_submission_id`) | 〃 | `BKG01`, `BKG02`, `BKG03`; templates reconciled first by `ensureBookingTemplates`; missing template → recorded in `skipped` with reason `Template missing` (never silent) | Office / — | null | 2 | `BKG0n-{jobId}-ROOT-nodue` | `:445,451-459` |
| Job is `Booked` or `booking_approved_at` set | 〃 / `confirmBookingFromEvaluatedGates` | `BKG04`, `BKG05` — **never before confirmation** | Office / — | `now` ("Same staffed day") | 2 | `BKG04/05-{jobId}-ROOT-nodue` | `:461-468`, `:543-576` |
| `job.next_action_at` (earliest work date) known **and** booking gates ready | `createTasksForJob` | `FIN01` Interim draft check/send | Office | `fridayBefore(installDate)` 17:00Z (seed text says "Seven days before due"; setting `finance.interim_send_lead_days=7` is **not read** here) | 1 | `FIN01-{jobId}-ROOT-nodue` | `:470-476` |
| install date set, Standard, `deposit_bank_confirmed_at` empty | 〃 | `S06-UNPAID-INTERIM` "Chase unpaid interim payment", group Finance — explicitly does **not** block installation (`tests/s06.test.cjs:100-107`) | Office | `nextStaffedDay(now)` | 1 | `S06-UNPAID-INTERIM-{jobId}` | `:481-522` |
| Draft order exists (R2) | `createOrderingTasks` | `MAT01` | Office | null | 1 | `MAT01-{jobId}-ROOT-nodue` | `s07/ordering.js:243-246` |
| Stock pick (R2) | `createPickTasks` | `S08-PICK-STOCK` | Office (`tanyaId`) | null | 1 | `S08-PICK-{jobId}` | `s08/picking.js:169-189` |
| Scaffold booking created (R2) | `createScaffoldTasks` | `SCA01` group **Materials** | hard-coded `PERSON-tanya` | null | 1 | `SCA01-{jobId}-ROOT-nodue`; any other SCA01 on the job → `S09_CONFLICT` | `s09/scaffold.js:98-123` |
| Work package has `planned_end` or `actual_end`, required, status ∉ {Cancelled, ConfirmedComplete} | `scheduleInstallerCalls` | `INS01` per work package **per revision** | exactly-one Office owner (§5) | 1 staffed day after `actual_end \|\| planned_end`, 09:00Z | 1 | `INS01-{wpId}-R{revision}`; task **id is deterministic** `TASK-{key}` | `s10/operations.js:58-72` |
| All required packages `ConfirmedComplete` with `installer_confirmation_at` | `scheduleCustomerCall` | `INS04` customer call; otherwise returns `{status:'Blocked',reason:'INSTALLER_CONFIRMATIONS_MISSING'}` | Office | 1 staffed day after the **latest** installer confirmation | 1 | `INS04-{jobId}-ROOT` | `:74-79` |
| INS01 call outcome `ReturnRequired` | `recordCall` | Issue `Remedial`/`ReturnRequired` (+ `ISS02` task) and `REM01` | Office | next staffed day | 1 | `REM01-{issueId}-E1` | `:99` |
| INS04 call `customer_happy === false` | `recordCall` | Issue `Complaint`/`CustomerCall` + `ISS02` | Office | next staffed day | 1 | `ISS02-{issueId}-E1` | `:98,111` |
| Issue created | `createIssue` | `ISS01` if type `Variation`, else `ISS02`; due = issue.due_at (default next staffed day) | issue `office_owner_id` — default = the single active `VariationApprover` for Variation, else Office | issue due | 1 | `ISS0n-{issueId}-E1` | `:104-113` |
| Commissioning-required package in {ReportedComplete, ConfirmedComplete, ReturnRequired} with `actual_end`, no submission in {Submitted, UnderReview, Accepted}, and now ≥ due | `scheduleMissingCommissioning` (FN-18 Manual) | `INS02` | the single active `Lead` allocation's person; ≠1 lead → `S10_REVIEW: commissioning owner ambiguous` | **2 staffed days** after `actual_end` | 1 | `INS02-{wpId}-R{revision}` | `:131-136` |
| Operational completion approved | `_s10EnsureGhlTracking` | `GHL01` + `GHLTasks` row | Office | next staffed day after completion | 1 | `GHL01-{jobId}-OPCOMPLETE` | `:148-155` |
| MOVE_JOB | `_s11ImpactTasks` | one task per impact: `S11-MOVE-ASSIGNED_PEOPLE` (per active allocation, group Install), `S11-MOVE-CALENDAR` (per moved WP, Booking), `S11-MOVE-MATERIALS` (per moved WP, Materials), `S11-MOVE-SCAFFOLD` (per scaffold booking, Materials), `S11-MOVE-CUSTOMER_NOTICE` (Booking), `S11-MOVE-INTERIM_INVOICE` (Finance) | first active Office PersonRole else the acting user | `now` | 1 | `S11-MOVE-{code}-{command_id}` — **keyed per command, not per entity**: two ASSIGNED_PEOPLE/CALENDAR/MATERIALS impacts in one command collapse to one task (see §11.8) | `s11/planner.js:56-65,101-123` |
| S13 milestones (not at sale) | `createInterimChaseTask`, `createGHLTask` | `S13-INTERIM-CHASE` (due now, p1), `S13-GHL-PROGRESSION` (no due, p2) | hard-coded `PERSON-tanya` | — | — | `S13-INTERIM-CHASE-{jobId}`, `S13-GHL-{jobId}` | `s13/payments.js:99-160` |

### 3.3 Dedupe / determinism guarantees [BIZ]

1. **One task per `instance_key`, ever.** S06 generators skip if *any* task with the key exists, **including Complete
   or Cancelled ones** (`s06/gates.js:374-383, 656-661`; `tests/s06.test.cjs:514-534` "completed tasks not recreated").
   This differs from the older in-memory S03 rule which only dedupes against non-Complete/non-Cancelled tasks
   (`processor/tasks.js:23-28`). The S06 behaviour is the proven one for R1.
2. S10 generators additionally **fail closed on duplicates** (`>1` row with the key → `S10_CONFLICT`,
   `s10/operations.js:60-61`) and use a deterministic primary key `TASK-{instance_key}`.
3. Key shapes: `{template}-{jobId}-ROOT-nodue` (job-scoped singletons); `{template}-{entityId}-R{revision}` (per work
   package revision — a date change that bumps `WorkPackages.revision` legitimately creates a new INS01/INS02);
   `{template}-{issueId}-E1` (issue episode); `{prefix}-{jobId}`; `S11-MOVE-{code}-{command_id}`.
4. Task generation is a pure function of (job row, tasks, templates, people, now, holidays) and is re-runnable at any
   time; `processBookingGates` always calls it before deciding a transition.
5. Generation never reassigns, re-dates or reopens an existing task (`s06/gates.js:604-608` comment + the PRE03 test
   `tests/s06.test.cjs:619`).
6. A gate treats "≠ exactly one task for the code on the job" as **unsatisfied** (`s06/gates.js:12-13`: `Expected one
   task; found N` / `Required task missing`), so duplicates can never pass a gate.

### 3.4 Due-date helpers [BIZ]

- `isStaffedDay(date, holidays)`: not Sat/Sun and not in `holidays[].date` (`s06/gates.js:235-242`).
  S10/S11 use `Holidays.office_closed === true` with `local_date` (`s10/operations.js:34`, `s11/planner.js:39`) and
  S11 reads `Settings office.staffed_weekdays` (`[1,2,3,4,5]`) and requires `office.timezone === 'Europe/London'`
  (`s11/planner.js:30`). S06 hard-codes Mon–Fri and its callers pass `holidays: []` by default (the R1 adapter never
  passes holidays — `_r1sNextFollowUpAt` calls `nextStaffedDay(now, [])`, `r1-appsheet/services.js:316-322`).
- `nextStaffedDay(from)` → next staffed date at `T09:00:00.000Z` (`s06/gates.js:244-249`).
- `fridayBefore(date)` → the Friday on/before the date (if the date is itself a Friday it returns that Friday), rolled
  back past holidays, at `T17:00:00.000Z` (`s06/gates.js:251-258`; test expects install 2026-10-1x → `2026-10-09`,
  `tests/s06.test.cjs:195-199`).
- `_s10AddStaffedDays(value, n, closed)` → n staffed days later at `T09:00:00.000Z` (`s10/operations.js:41-45`).
- All "time of day" values are written as literal **UTC** `09:00Z`/`17:00Z`, not London local time — a latent BST
  inaccuracy; seed says office hours 09:00–17:00 Europe/London (`schema/config-seed.json:92-94`). See §11.9.

---

## 4. Task lifecycle

### 4.1 Statuses

`processor/types.js:45-53`: `Blocked, Open, InProgress, Waiting, Complete, Cancelled, NotRequired`.
"Open-ish" set used for active lists: `Open, Waiting, InProgress, Blocked` (`r1-appsheet/services.js:1589`).
Terminal/satisfied set for gates: `Complete`, or `NotRequired` **only with a `completion_note` or `evidence_id`**
(`s06/gates.js:9,72-73`) — and PRE01–PRE04 must be strictly `Complete` (NotRequired never satisfies them,
`s06/gates.js:15-71`).

Task row fields (all generators write the same shape, e.g. `s06/gates.js:385-415`): `id, job_id, template_code,
instance_key, group, title, owner_id, backup_id, related_entity_type, related_entity_id, due_at, original_due_at,
priority, status, blocking_reason, next_followup_at, completed_at, completed_by, completion_note, evidence_id,
revision_required, created_rule_version, created_at/by, updated_at/by, version, source_system, commit_id`.

`TaskEvents` fields: `id, task_id, action, old_status, new_status, old_owner, new_owner, old_due, new_due, reason,
actor, timestamp, created_at, commit_id`. Actions observed: `CREATED`/`COMPLETED` (S03, `processor/tasks.js:66,88`),
`Complete`, `FollowUp`, `Reopen`, `EvidenceAttach`, `CallOutcome`, `Reassign`, `Retitle`, `NotRequired`
(`r1-appsheet/services.js:418,474,528,594,622,1442,1611-1627`). **S06/S10/S11 generators do not write a `CREATED`
TaskEvent** — only the S03 in-memory store does (§11.10).

### 4.2 Transitions implemented

| Transition | Command | Rule | Cite |
|---|---|---|---|
| Open/Waiting/InProgress → **Complete** | `TASK_COMPLETE` | status must be one of those three and `revision_required !== true`, else `R1A_TASK_NOT_COMPLETABLE`; `completion_note` always required; template-specific structured evidence for PRE01–PRE04 (§8). Sets `completed_at/by`, `completion_note`, `evidence_id`, **clears `blocking_reason`**, version+1 | `r1-appsheet/services.js:338-340,472-474` |
| Open/Waiting/InProgress → **Waiting** ("follow-up") | `TASK_COMPLETE` with a negative/partial outcome | PRE01 `outcome` ∈ {failed, failure, follow_up, follow-up, followup} → `blocking_reason:'PRE01_INVOICE_SEND_FAILED'`; PRE02 awaiting signature → `'PRE02_AWAITING_SIGNATURE'` (+ Job `contract_status:'Sent'`, `contract_id`); PRE03 → `'PRE03_DEPOSIT_NOT_RECEIVED'` or `'PRE03_DEPOSIT_AMOUNT_MISMATCH'` (+ non-successful ManualBankChecks row); PRE04 → `'PRE04_CUSTOMER_DETAILS_MISMATCH'`, `'PRE04_SOLD_VALUE_MISMATCH'`, `'PRE04_VALUE_MISMATCH'` (+ Job `sold_booking_match_status:'Review'`). All set `next_followup_at = nextStaffedDay(now)`, keep `completed_*` null, store the note, write TaskEvent `FollowUp`, command result status `FollowUpRequired` | `:414-460` |
| Complete/NotRequired → **Open** | `TASK_REOPEN` | payload `reopen_reason` required; only from `Complete` or `NotRequired` else `R1A_TASK_NOT_REOPENABLE`; clears `completed_at/by` only; **preserves `completion_note` and `evidence_id`** (asserted: `R1A_TASK_HISTORY_MUTATION`); never deletes InvoiceStages/Evidence; for PRE01–PRE05 re-evaluates readiness (may demote job) | `:491-539` |
| INS01/INS04 Open → Complete / stays Open | `CALL_RECORD` | outcome `NoAnswer` → status `Open`, `next_followup_at = next_attempt_at \|\| next staffed day`; any other outcome → `Complete` with `completion_note = outcome` | `s10/operations.js:93-95` |
| open `PRE-COPY-JOBID` (Open/Waiting/InProgress/Blocked) → Complete | side effect of `BOOKING_INTAKE` | only when the booking is actually linked (`Jobs.booking_submission_id === this intake id`), not on replay/duplicate; note `Superseded by Job Booking intake {intake_id}` + ` (Intake Review required)` if applicable | `r1-appsheet/services.js:1241-1253` |
| open → **NotRequired** | DEV reconciliation only (`_r1sReconcileStaffTasks`, Admin/Manager) for `S13-INTERIM-CHASE`/`S13-GHL-PROGRESSION` raised too early | sets `completion_note`, `completed_at/by` | `:1622-1629` |
| owner change | DEV repair only (`_r1sRepairPre03Assignment`) and S15/S17 (see §1.1) | see §5.4 | `:1421-1449` |

**Not implemented anywhere in the R1 command surface:** a general "cancel task", "set Blocked / unblock", "start
(InProgress)", "reassign task", "change due date", or "mark NotRequired" staff command. `Blocked`, `InProgress` and
`Cancelled` task statuses are only ever *read* (or set by S15 cancellation — see §1.1). `original_due_at` and
TaskEvents `old_due/new_due` exist to support re-dating but no command changes `due_at`.

### 4.3 Blocking / dependency rules

- `TaskDependencies` table exists (`schema/tables.json:1801`, columns incl. `task_id`, `prerequisite_task_id`,
  `named_gate`, `satisfied_at`) and the **S04 synthetic-only processor** refuses completion with
  `TASK_DEPENDENCY_UNSATISFIED` when any dependency row for the task has no `satisfied_at`, and `TASK_BLOCKED` when
  `blocking_reason` is set or `revision_required !== false` (`s04/processor.js:72-77`).
- The **R1 TASK_COMPLETE path does not consult `TaskDependencies` and does not refuse on `blocking_reason`** — it must
  not, because a `Waiting` task carrying `PRE0x_*` blocking_reason is re-submitted through the same command
  (`r1-appsheet/services.js:340`). Dependencies in R1 are expressed instead as (a) stage gates over task sets (§6/§7),
  (b) generator preconditions (INS04 only after all INS01 confirmations; BKG04/05 only after Booked; INS02 only after
  2 staffed days; GHL01 only after operational completion).
- `revision_required === true` blocks completion and PRE02 evidence attach in R1 (`:340,553`). Nothing in the surveyed
  code ever sets it to true.

---

## 5. Task owner / backup rules

### 5.1 Identity model

`People` (`id, email, display_name, role, active, backup_person_id, capacity_per_day, available_from/to, calendar_id`)
+ `PersonRoles` (`person_id, role, active`) — `schema/config-seed.json:16-34`. Actor roles come **only from active
PersonRoles** (`r1-appsheet/adapter.js:16-25`: unknown/duplicate email → `R1A_UNKNOWN_OR_DUPLICATE_ACTOR`, inactive →
`R1A_INACTIVE_ACTOR`, no active role → `R1A_NO_ACTIVE_ROLE`). Roles seen: `Admin, Manager, Director, Office,
VariationApprover, Finance, Store, Installer, Scaffolder, ReadOnly` (`processor/types.js:68-77` + adapter).
`People.backup_person_id` exists in the seed but **is never read by any generator**.

### 5.2 Resolution rules actually implemented

| Rule | Behaviour | Cite |
|---|---|---|
| "Office owner" (S06, S07, S08) | `resolvePersonByRole(store,'Office')` = **first** active `PersonRoles` row with role Office, in storage order; fallback literal `'PERSON-tanya'`. Does **not** check `People.active`. Nondeterministic when several Office people exist (seed has Tanya and Hannah both Office — Tanya wins only by row order) | `s06/gates.js:586-590,358,640` |
| "Office owner" (S10) | active PersonRoles ∩ active People; if `PERSON-tanya` is among them she wins; otherwise **exactly one** must exist else `S10_CONFIG: exactly one active Office owner required` | `s10/operations.js:46-52` |
| Variation owner (S10) | exactly one active `VariationApprover` (docs: Hannah) else `S10_CONFIG` | `:108` |
| PRE03 owner | Named personal responsibility constant `S06_PRE03_RESPONSIBILITY = {owner_person_id:'PERSON-ben', backup_person_id:'PERSON-dan', eligible_roles:['Admin','Manager','Director']}`. Owner must be an active Person **and** hold an eligible role (via `People.role` or an active PersonRole) → otherwise **throws** `S06_CONFIG: active PERSON-ben required for PRE03` / `S06_CONFIG: PERSON-ben must have an active Admin, Manager or Director role for PRE03` and Sold intake fails visibly; **never falls back to another person** | `s06/gates.js:604-626`, `tests/s06.test.cjs:138-159` |
| PRE03 backup | Dan if active + eligible role; otherwise `null` — "never another person" | `s06/gates.js:628-634`, `tests/s06.test.cjs:161-171` |
| PRE-COPY-JOBID backup | first active Admin PersonRole else `'PERSON-ben'` | `s06/gates.js:641,732` |
| INS02 owner | the single active `Lead` allocation's person for the work package | `s10/operations.js:134` |
| MOVE impact tasks | first active Office PersonRole else the acting user | `s11/planner.js:57` |
| SCA01, S13 tasks | literal `'PERSON-tanya'` | `s09/scaffold.js:98`, `s13/payments.js:108,138` |
| All other tasks | `backup_id: null` | — |

### 5.3 What owner/backup *mean* (authorisation) [BIZ]

- TASK_COMPLETE / TASK_REOPEN / TASK_EVIDENCE_ATTACH: actor must be in the office class, be "assigned" to the job,
  **and** be the task's `owner_id` or `backup_id`, or Admin/Manager (`r1-appsheet/adapter.js:176-180`). Otherwise
  `R1A_TASK_ACCESS_DENIED` (staff message: "Only the task owner, their backup, or an administrator can do this.").
- "Assigned to job" = Admin/Manager, or owner/backup of **any** task on the job, or `responsible_person_id` /
  `office_owner_id` of any issue on the job, or the job's `salesperson_id` (`adapter.js:38-43`).
- Owner and backup share **one** task row (no second task for the backup); optimistic versioning allows one successful
  completion; `completed_by`, TaskEvents.actor and AuditEvents.initiating_actor record who really did it
  (`docs/R1-office-journey-audit.md:20`). "My Tasks" = `owner_id = me OR backup_id = me` (`adapter.js:66`).
- The seed `PermissionRules` (`schema/config-seed.json:36-43`: Admin `*`, Office CompleteTask/All, Director
  CompleteTask/Assigned, …) are enforced only by the S04 synthetic processor (`s04/processor.js:48-59`); the R1 adapter
  hard-codes the equivalent logic.

### 5.4 Inactive / absent / escalation

- **No automatic fallback, reassignment or escalation exists for tasks.** If the owner is inactive/absent the task
  simply remains theirs; the backup (where set — only PRE03 and PRE-COPY-JOBID) or an Admin/Manager can act. The only
  owner-changing code for tasks in the R1 surface is the DEV-only, Admin/Manager-only PRE03 repair
  (`r1-appsheet/services.js:1421-1449`: changes only `owner_id`, version+1; preserves every other field — asserted
  against `R1S_PRE03_PRESERVED_FIELDS`; writes CommitJournal + TaskEvent `Reassign` + AuditEvent; refuses non-open
  tasks with `R1A_PRE03_NOT_OPEN`).
- Absence (`PersonAvailability` rows with `type !== 'Available'`), skills (`PersonSkills`) and `capacity_per_day`
  affect **installer allocation only** (§7.3), never task ownership.
- Escalation is organisational: "Tanya reviews overdue/waiting work, external updates and health daily; Ben is
  escalation backup" (`docs/release-plan.md:39`); overdue visibility is the `OFFICE_HOME`/`MY_TASKS`/`TEAM_TASKS` read
  models (overdue = `due_at` date < today London; due today; due soon = next 7 days — `s17/admin.js:51-90`).
  Issue ownership **can** be reassigned by command (`ISSUE_UPDATE` action `REASSIGN`, §9).
- (S16/S17 escalation or absence features, if any, are summarised in §1.1.)

---

## 6. ReadyToBook gates ("prebooking readiness")

### 6.1 `evaluateReadyToBook(job, store)` — every gate is blocking (`s06/gates.js:102-141`)

| Gate name | Applies | Exact condition |
|---|---|---|
| `sold_linked` | all | `job.sold_submission_id` truthy |
| `finance_route_valid` | all | `finance_route` ∈ `['Standard','Phoenix','OtherReview']` |
| `signed_contract_evidence` | all | `contract_status === 'Signed'` AND `contract_evidence_id` AND `contract_signed_at` AND non-blank trimmed `contract_id` |
| `PRE01_satisfied` | Standard | exactly one PRE01 task, status `Complete`, AND exactly one InvoiceStages row with `stage` = `deposit` (case-insensitive) having (`invoice_number` non-blank OR `xero_invoice_id` non-blank and ≠ `'NOT_CONFIGURED'`) AND `sent_at` set (`:15-31`) |
| `PRE02_satisfied` | all | exactly one PRE02 task `Complete` AND the same four contract facts on the Job (`:32-45`) |
| `PRE04_satisfied` | all | exactly one PRE04 task `Complete` AND `customer_details_verified_at` + `_by` AND `sold_booking_match_status === 'Match'` AND `original_gross_pence` is a number > 0 AND non-blank `valuation_basis` (`:57-71`) |
| `customer_value_verified` | all | the same Job facts as PRE04, checked independently of the task (`:122-125`) |
| `PRE03_satisfied` | Standard | exactly one PRE03 task `Complete` AND `bankConfirmationEvidence.pass` (`:46-56`) |
| `deposit_confirmation_evidence` | Standard | `bankConfirmationEvidence.pass` (below) |
| `PRE05_satisfied` | non-Standard | exactly one PRE05 task, `Complete` — or `NotRequired` with note/evidence (generic rule `:72-74`) |
| `finance_agreement_evidence` | non-Standard | the PRE05 task has a non-empty `evidence_id` (`:135-136`) |

Result: `{job_id, workflow_stage, ready, blocked:!ready, gates[], summary: 'ReadyToBook' | 'PrebookingBlocked'}`.

**`bankConfirmationEvidence(store, jobId)`** (`s06/gates.js:77-100`) — a three-way reconciliation, all required:
1. Job has `deposit_bank_confirmed_at`, `deposit_bank_confirmed_by`, `deposit_bank_reference`.
2. Exactly one deposit InvoiceStages row with numeric `gross_pence > 0`.
3. **Exactly one** `ManualBankChecks` row with `job_id` match, `stage` = deposit, `outcome === 'Confirmed'`,
   `checked_at` same instant as `job.deposit_bank_confirmed_at`, `checked_by === job.deposit_bank_confirmed_by`,
   `amount_pence === stage.gross_pence`, `evidence_reference === job.deposit_bank_reference`.
4. The InvoiceStage has `status === 'Confirmed'` and `reference === job.deposit_bank_reference`.

Principle (stated repeatedly in code and docs): **a Complete task alone never satisfies a gate — the structured
evidence state must also be present, and the structured state alone never satisfies it without the task**
(`tests/s06.test.cjs:236-394`, `docs/R1-office-appsheet-configuration.md:424,445`).

### 6.2 How the result is computed / automated

- Not stored as a column; recomputed on demand. `_r1sReevaluatePrebooking(store, jobId, actorId, commandId, now)`
  (`r1-appsheet/services.js:259-292`) runs inside the same lock/transaction as the triggering command:
  - stage `Prebooking` → `processBookingGates(jobId, store, {actor, command_id:'AUTO-'+commandId, now})` → promotes to
    `ReadyToBook` when ready (also backfills tasks).
  - stage `ReadyToBook` → re-evaluates; if no longer ready, **demotes** to `Prebooking` with audit.
  - any other stage → no-op (returns null).
- Called after: every TASK_COMPLETE outcome (Completed or FollowUpRequired) for PRE01–PRE05 (`:419,431,442,456,485`),
  TASK_REOPEN of PRE01–PRE05 (`:530-533`), TASK_EVIDENCE_ATTACH in Repair mode (`:605`), DEPOSIT_CONFIRM (`:708`).
  Explicit manual trigger: `BOOKING_GATES` command (`:715-716`).
- The readiness object (gate list with `name/pass/detail`) is returned in the command result so the UI can show exactly
  what is outstanding.
- `PRE-COPY-JOBID` is **not** a gate (`docs/R1-office-appsheet-configuration.md:178`). The "Start Job Booking" launcher
  is only offered when stage is `ReadyToBook`, no booking linked, job pilot/R1 and not archived/cancelled, and (from a
  task) the task is an open PRE-COPY-JOBID (`r1-appsheet/services.js:1146-1157`). Note the *server* accepts
  BOOKING_INTAKE in Prebooking too (T3e).

---

## 7. Booking gates and installation scheduling rules

### 7.1 Booking intake (what "booking a job" records) [BIZ] — `s05/booking-apply.js:466-645`

- Customer fields (`first_name,last_name,address_line1,address_line2,town,postcode,email,phone`) are **compared, never
  overwritten**: a normalised (trim/collapse-space/lowercase) difference inserts `CustomerChanges` row
  `CC-{jobId}-{field}-{intakeId}` with `reason:'BOOKING_CUSTOMER_MISMATCH'`, `resolution:null` and forces Review
  (`:56-61,427-464`); the adapter asserts no customer field changed (`R1A_CUSTOMER_OVERWRITE`,
  `r1-appsheet/services.js:1309-1311`).
- Amount: booking `cost` vs canonical gross (= `current_contract_gross_pence` if >0 else `original_gross_pence`);
  different → `AMOUNT_MISMATCH` → Review (`:43-49,508-517`).
- Review reasons (each sets `match_status:'Review'`, Intake `processing_status:'Review'`): `CUSTOMER_MISSING`,
  `CUSTOMER_MISMATCH`, `AMOUNT_MISMATCH`, `SCAFFOLD_NOT_REQUIRED` (scaffold detail supplied on a job not marked
  `scaffold_required` — nothing created), `INSTALLER_NOT_FOUND`, `INSTALLER_AMBIGUOUS`, `MERCHANT_UNRESOLVED`.
  `SCAFFOLD_COMPANY_UNRESOLVED` is advisory only (`:541-558,598-616`).
- WorkPackages: one live package per trade (`Roof` sequence 1, `Electrical` sequence 2, `commissioning_required` =
  Electrical only); `status` `Scheduled` if a date is given else `Unscheduled`; `planned_end = planned_start`;
  re-booking updates the existing non-cancelled package (`:100-147`). Created when a date is given, or the job flag is
  set, or relevant materials/equipment are present (`:528-535`).
- Allocations: installer names resolved by **exact unique active `People.role==='Installer'` display_name**; ids
  `ALLOC-BOOKING-{jobId}-{roofer|sparky|second_sparky}`, roles `Lead`/`Lead`/`Second` (`:561-604`).
  **Booking intake performs no capacity/leave/skill/holiday check** (those exist only in S11).
- ScaffoldBookings: one live row per job, `status` `Planned` (date) or `Draft`; company resolved by id or exact name
  among active `Scaffolder` companies (`:149-202`). The "scaffold ≥ 2 days before roofer" rule exists **only as an
  AppSheet Valid_If** and "is not enforced by the server" (`r1-appsheet/services.js:1033-1034`).
- Materials: deterministic ids `MAT-BOOKING-{jobId}-{key}`, `source:'ToOrder'`, `need_by_date` = roof start else
  electrical start; unapproved SKU → `product_id:null`, `notes:'MAPPING_REQUIRED:{key}'`; Renusol hook totals are
  **derived server-side from components and any submitted total is discarded** (`:204-288`). Equipment →
  `JobEquipment` `JEQ-BOOKING-{jobId}-{field}`, `technical_review_status` `Planned`/`MappingRequired` (`:321-379`).
- `Jobs.next_action_at` := earliest of roof/electrical/scaffold-erect dates (`:636-638`) — this is the "install date"
  used by FIN01 and S06-UNPAID-INTERIM. (`docs/R1-go-live-readiness.md:298` flags `next_action_at` as a questionable
  date master vs WorkPackages.)

### 7.2 `evaluateBookingGates(job, store)` — the gate to **confirm** a booking (`s06/gates.js:145-231`)

| Gate | Blocking? | Exact condition |
|---|---|---|
| `sold_booking_linked` | yes | `sold_submission_id` AND `booking_submission_id` |
| `sold_booking_match` | yes | `sold_booking_match_status === 'Match'` |
| `customer_exists` | yes | `Customers` row for `customer_id` |
| `customer_details_complete` | **no** | `first_name,last_name,address_line1,town,postcode` each present and ≠ `'NOT_CONFIGURED'` |
| `contract_status` | yes | Signed + `contract_evidence_id` + `contract_signed_at` + non-blank `contract_id` ("A booking cannot weaken the signed-evidence prebooking gate") |
| `finance_route_valid` | yes | ∈ Standard/Phoenix/OtherReview |
| `deposit_confirmed` | yes | Standard: `bankConfirmationEvidence.pass`; others: pass ("Not applicable") |
| `gross_amount_present` | **no** | `original_gross_pence` number > 0 |
| `task_{code}` for each mandatory code | yes | Standard: `PRE01,PRE02,PRE03,PRE04,BKG01,BKG02,BKG03`; non-Standard: `PRE02,PRE04,PRE05,BKG01,BKG02,BKG03` — each via `taskSatisfaction` (§6.1 rules; BKG tasks: `Complete`, or `NotRequired` with note/evidence) |

Result: `ready` = all pass; `blocked` = any blocking gate failed; `needs_review` = `!ready && !blocked`;
`summary` ∈ `Ready | Blocked | NeedsReview`. **Note:** `CONFIRM_BOOKING` requires `ready === true`, so the two
"non-blocking" gates still prevent confirmation — "non-blocking" only changes the label (Blocked vs NeedsReview).
BKG04/BKG05 are never in the mandatory list (`tests/s06.test.cjs:429-477`). After a Review booking, the route back to
`Match` is PRE04 completion (`_r1sApplyPre04Verification` sets `sold_booking_match_status:'Match'`,
`r1-appsheet/services.js:233-242`) — see §11.4.

### 7.3 Reschedule / re-resource rules (S11) [BIZ]

**MOVE_JOB** (`_s11MoveJobR1`, `s11/planner.js:68-128`): `reason` required; `activities` non-empty subset of
`['Roof','Electrical','Return','Scaffold']` (`Return` ↔ trade `ReturnVisit`); `expected_version` = Jobs.version
(`S11_STALE: job version`); for trade activities `planned_start` and `planned_end` required, end ≥ start; at least one
live work package of the trade else `S11_REVIEW: no {trade} work package to move`; for Scaffold one of
`scaffold_erect`/`scaffold_strip` required and a live scaffold booking must exist. Effects: only selected activities
change, everything else returned in `preserved`; each moved WP `revision+1, version+1`; all active allocations on it
get the new dates; a Calendar intent is captured per allocation; ScaffoldBookings `revision+1`; Jobs.version+1; audit
rows; impact tasks (§3.2). **No capacity/leave/holiday validation on MOVE_JOB** (only on the R2 `moveWorkPackage`).
Availability (read side): stage ∈ `Booked, AwaitingInstallation, InProgress, BookingInProgress`.

**PLANNER_UPDATE** (`_s11UpdatePlannedDates`, `:45-54`): `planned_start`,`planned_end` required; `expected_version` =
WorkPackages.version; revision+1; audit `PlanDates`; no impact tasks, no calendar intent.

**CHANGE_INSTALLER** (`_s11ChangeInstallerR1`, `:131-150`): `mode` ∈ `Replace|Add`, `person_id`, `reason` required;
`expected_version` = WorkPackages.version; old allocation must belong to the WP and be active. Person validation
(`_s11ValidatePerson`, `:38`): active `People.role === 'Installer'` else `INSTALLER_INACTIVE_OR_WRONG_ROLE`;
`capacity_per_day` integer ≥ 1 else `CAPACITY_NOT_CONFIGURED`; within `available_from/to` else `INSTALLER_UNAVAILABLE`;
no overlapping active `PersonAvailability` row with `type !== 'Available'` else `ON_LEAVE`; skill check only if the
person has active `PersonSkills` rows (none matching the trade → `SKILL_MISMATCH`; the R1 variant passes no trade so
the skill check is effectively skipped — `:139`). Capacity (`_s11Capacity`, `:39`): any date in range that is an
office-closed holiday → `OFFICE_HOLIDAY`; on each staffed weekday, count of the person's other active allocations
covering the date ≥ `capacity_per_day` → `CAPACITY_CONFLICT`. Failures return `{status:'NeedsReview', reason}` and
write nothing. `Replace` deactivates the old allocation (`active:false`, `cancellation_reason=reason`), queues a
Calendar cancel, new allocation gets `replaced_allocation_id`; `Add` defaults role `Second`. WP `revision+1`.

**Calendar** [BIZ intent / PLUMB transport]: R1 never calls Calendar. It records *intent*: `CalendarLinks` (status
`Pending`/`UpdatePending`/`Cancelled`, all-day, end = day after `end_at`, title `{job.display_name} — {trade}`, no
guests) and an `Outbox` row (`CalendarCreate`/`CalendarUpdate`/`CalendarCancel`, idempotency key
`S11-CALENDAR-{command_id}-{kind}`). In R1 the human follow-up is the BKG05 and `S11-MOVE-CALENDAR` tasks.

### 7.4 Cancel / reinstate

Command envelopes in §9; S15 effects in §1.1.

### 7.5 Operational completion gate (`s10/operations.js:138-146`)

Reasons (all must be absent): `REQUIRED_WORK_UNCONFIRMED` (no required non-cancelled WP, or any not
`ConfirmedComplete` with `installer_confirmation_at`); `COMMISSIONING_NOT_ACCEPTED:{wpId}` (each
`commissioning_required` WP needs a CommissioningSubmissions row with `status:'Accepted'`); `CUSTOMER_NOT_HAPPY`
(`customer_happy_at` empty — set only by an INS04 call with `customer_happy:true`); `BLOCKING_ISSUE_OPEN` (any issue
with `blocks_completion === true` and status ∉ {`Resolved`,`Closed`}). Status `AlreadyComplete` / `NeedsReview` /
`Ready`. Cash collection, handover and scaffold strip are explicitly **not** part of this gate
(`docs/S10-implementation.md:20`).

---

## 8. Evidence requirements

### 8.1 Evidence row [BIZ]

`Evidence`: `id, job_id, submission_id, issue_id, category, drive_file_id, filename, mime_type, upload_status
('Uploaded'), captured_at/by, received_at, customer_shareable:false, version, checksum, created_at, commit_id`
(`r1-appsheet/services.js:55-73`). Rules: one Evidence row per (job, file) — idempotent
(`EV-R1A-{jobId}-{hash(fileId)}`); evidence may **never be used across jobs** (`R1A_CROSS_JOB_EVIDENCE`); >1 match →
`R1A_EVIDENCE_AMBIGUOUS`; evidence ids are never invented — a supplied id must resolve to a real row for the job
(`R1A_REQUIRED_CONTRACT_EVIDENCE`, `:117-130`); uploaded file + a different typed id → `R1A_EVIDENCE_CONFLICT`
(`:463`). Categories used: `Contract` (PRE02), `CustomerDetails` (PRE04), `Commissioning` (COMMISSIONING_RECORD).
In Supabase: `drive_file_id` → storage object key.

### 8.2 Per task / outcome

| Task | To **Complete** | Negative outcome (→ `Waiting`) | Cite |
|---|---|---|---|
| any | `completion_note` non-empty (`R1A_REQUIRED_COMPLETION_NOTE`) | — | `services.js:338` |
| PRE01 | `invoice_number` text AND `invoice_sent` ∈ {true, yes, true, 1, sent, y}; a single deposit InvoiceStage must exist (`R1A_DEPOSIT_STAGE_MISSING`). Effect: stage gets `invoice_number`, `sent_at=now`, `status:'Sent'` unless already in {Confirmed, Paid, PartPaid, Voided, Credited}. **Notes alone refused.** No file | `outcome` ∈ failed/failure/follow_up/follow-up/followup | `:342-349,323-336` |
| PRE02 | `contract_id` always required; `contract_signed` truthy ({yes,true,1,signed,y}); plus either `evidence_path` (upload → Evidence `Contract`) or an `evidence_id` (payload, or already on the task from TASK_EVIDENCE_ATTACH) resolving to a real Evidence row **for this job**. Effect: Job `contract_status:'Signed'`, `contract_id`, `contract_evidence_id`, `contract_signed_at` (kept if already set) | `contract_signed` ∈ {false,no,0,n,sent,awaiting…} or `outcome` ∈ {awaiting_signature, sent, awaiting…} → Job `contract_status:'Sent'` + `contract_id` only; refuses if already Signed with evidence (`R1A_CONTRACT_ALREADY_SIGNED`). Neither yes nor awaiting → `R1A_REQUIRED_CONTRACT_SIGNED` | `:350-366,77-115,132-146` |
| PRE03 | `deposit_bank_confirmed` = yes; `deposit_amount` (GBP text, ≤2dp, >0 → pence); `deposit_received_date` (`YYYY-MM-DD`, stored as noon UTC, not more than 1 day in the future); `deposit_bank_reference` non-blank; amount must equal the canonical deposit InvoiceStage `gross_pence` — **the expected amount is never client-supplied**. Effect: exactly one `ManualBankChecks` row `MBC-R1A-{command_id}` (`stage:'deposit'`, `outcome:'Confirmed'`, `checked_at`=received date, `checked_by`=actor, `evidence_reference`=bank ref), Job `deposit_bank_confirmed_at/by/reference`, stage `status:'Confirmed'` + `reference`. Guard: contract/invoice amounts must be unchanged (`R1A_FINANCIAL_MUTATION`). **Documentary evidence can never replace the explicit bank check; no screenshot stored.** | `deposit_bank_confirmed` = no → `PRE03_DEPOSIT_NOT_RECEIVED`, bank check row `NotReceived` (amount optional, default 0); amount ≠ expected → `PRE03_DEPOSIT_AMOUNT_MISMATCH`, row `AmountMismatch`. Neither yes nor no → `R1A_REQUIRED_DEPOSIT_BANK_CONFIRMED` | `:367-386,163-226,436-446` |
| PRE04 | `customer_details_verified` = yes AND `sold_value_verified` = yes AND `verified_gross_amount` equal to canonical gross (current contract value if >0 else sold value; sold value must exist — `R1A_SOLD_VALUE_REQUIRED`). Effect: Job `customer_details_verified_at/by` (kept if set), `sold_booking_match_status:'Match'`, `valuation_basis` kept or `'Standard'`. Optional upload → Evidence `CustomerDetails`. Gross fields never mutated | either flag = no → `PRE04_CUSTOMER_DETAILS_MISMATCH` / `PRE04_SOLD_VALUE_MISMATCH`; amount differs → `PRE04_VALUE_MISMATCH`; Job `sold_booking_match_status:'Review'` | `:387-410,227-257,447-460` |
| PRE05 | No template-specific validation. Gate needs `Tasks.evidence_id` non-empty; TASK_COMPLETE stores `p.evidence_id \|\| t.evidence_id` **without validating it** for this template, and `evidence_path` uploads are only processed for PRE02/PRE04 | — | `:341,461-465`; §11.3 |
| BKG01–05, all others | completion note only. `TaskTemplates.evidence_required` is shown as guidance | — | `docs/…configuration.md:476` |
| INS01 / INS04 | completed through CALL_RECORD, not TASK_COMPLETE: `type`, `outcome` required; INS01 + `actual_completion_confirmed:true` → WP `ConfirmedComplete` (or `ReturnRequired` if outcome is `ReturnRequired`) + `installer_confirmation_at/by`; INS04 + `customer_happy:true` → Job `customer_happy_at/by` | `NoAnswer` keeps task Open with `next_followup_at` | `s10/operations.js:81-102` |
| Commissioning (R1 manual) | `COMMISSIONING_RECORD`: evidence **mandatory** — `evidence_path` or existing same-job `evidence_id` else `R1A_REQUIRED_EVIDENCE`; WP must be `commissioning_required`, not Cancelled. Writes `CS-R1A-{wpId}` `status:'Accepted'`, `source_system:'R1A-office-manual'`, `allocation_id:null`, `installer_id:null`, `reviewed_by`=actor, template `R1-OFFICE-MANUAL-1.0` (deliberately unapproved so it can never satisfy the R3 approved-template rule); refuses to overwrite a non-office Accepted submission (`R1A_COMMISSIONING_ALREADY_ACCEPTED`) | — | `services.js:1635-1710` |
| Issue close | `Resolved` needs `resolution`; `Closed` needs prior `Resolved` + `customer_resolution_confirmed:true`; optional `evidence_id` on the IssueEvent | — | `s10/operations.js:121-129` |

### 8.3 TASK_EVIDENCE_ATTACH (PRE02 only) [BIZ]

Modes by task state (`services.js:550-555`): `Pending` (Open/Waiting/InProgress, not revision_required) — stores
Evidence id on `Tasks.evidence_id`, version+1, **does not complete, does not stamp the Job, does not re-evaluate**;
result `EvidenceUploaded` with `completion_required:true`; a later upload replaces `Tasks.evidence_id`, earlier
Evidence rows kept. `Repair` (Complete with blank evidence) — attaches, stamps Job contract fields using the job's
existing `contract_id`, re-evaluates readiness, completion fields untouched (asserted `R1A_TASK_COMPLETION_MUTATION`).
`AlreadyAttached` → `R1A_EVIDENCE_ALREADY_ATTACHED`. Any other template/state → `R1A_TASK_NOT_ATTACHABLE`.
Because the attach bumps the task version, a Complete form opened earlier is refused as stale.

### 8.4 Upload / pending / retry — **AppSheet upload-race workaround** [PLUMB]

Everything in `r1-appsheet/upload-retry.js` exists because "AppSheet saves a File/Image column, writes the request row
and fires the bot before the uploaded file is necessarily visible through Drive" (`upload-retry.js:1-20`):
in-call waits at 0/2/6/12 s, error `R1C_UPLOAD_PENDING`, one `Outbox` row per request row (`action_type
'R1RequestUploadRetry'`, key `R1U:{table}:{rowId}`), `R1U_MAX_ATTEMPTS = 5`, backoff `[1,2,4,8,16]` minutes,
stalled-claim 10 min, 10 items per tick, 5-minute trigger, sweep of orphan `Ready` rows, fingerprint check
`R1U_REQUEST_CHANGED`, terminal `R1C_UPLOAD_MISSING` → Outbox `NeedsReview`, request-row statuses `UploadPending`.
**Do not port.** In the new app the file is uploaded to Supabase Storage *first*, and the command receives a storage
key that either exists or does not (single synchronous validation). The only semantics worth keeping from this area:
(a) a command that references a file must verify the file exists before writing anything; (b) a failed/pending upload
must leave **no** operational writes; (c) re-submitting the same `command_id` must not duplicate Evidence.

---

## 9. Commands in this domain

Common envelope (`r1-appsheet/adapter.js:168-222`): keys allowed =
`command_id, command_type, job_id, task_id, issue_id, work_package_id, old_allocation_id, expected_version, payload`
(anything else → `R1A_INVALID_FIELDS`); `command_id` required (`R1A_COMMAND_ID_REQUIRED`; pattern
`^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$` where checked, `services.js:816`); payload keys are whitelisted per command
(unknown key → `R1A_INVALID_FIELDS`; missing required key `k` → `R1A_REQUIRED_{K}`, `services.js:6`).
Role helpers (`adapter.js:26-29`): `admin` = Admin|Manager; `director` = admin|Director; `office` =
director|Office|VariationApprover; `officeManager` = admin|Office. Every command first requires `office` class
(`R1A_ROLE_DENIED`) — Installer/Store/Scaffolder/Finance/ReadOnly are refused for all of these. `AuthorizeJob` = job
exists (`R1A_JOB_NOT_FOUND`), is pilot + `release_scope 'R1'` (`R1A_OUTSIDE_PILOT`), and actor is "assigned"
(`R1A_JOB_ACCESS_DENIED`). Mode checks (`R1A_MODE_MISSING`/`R1A_MODE_DENIED`) are release plumbing.
Replay rule: same `command_id` + same fingerprint → `status:'Replayed'` with current rows; same id + different content →
`R1A_COMMAND_CONFLICT`; journal not Committed → `R1A_RECOVERY_REQUIRED`. Stale version → `R1A_STALE_VERSION`.
Every result carries `external_calls: 0`.

| Command | Top-level refs / version entity | Payload (allowed; **required**) | Authorisation | Validations & effects |
|---|---|---|---|---|
| `SOLD_INTAKE` | none allowed (no job_id / expected_version) | 19 fields `services.js:723-743`; **customer_first_name, customer_last_name, street_address, city, postcode, finance_route** | office class; FN-01 | §2.2 T1. `gross_amount` pounds→pence (`^\d+(\.\d{1,2})?$`, `R1A_INVALID_GROSS_AMOUNT`); cardinality assertions (exactly +1 Job, +1 Customer); job id must match `^SS-[A-Z]{4}-\d{4}$`. Result `Processed` / `Review` / `Replayed` |
| `BOOKING_INTAKE` | `job_id`, `expected_version` (Jobs) | 60+ fields `services.js:744-811`; none required | office class + assigned; FN-01 | §2.2 T3/T3e, §7.1. Errors: `R1A_FINANCE_ROUTE_CONFLICT`, `R1A_JOB_NOT_ACTIONABLE`, `R1A_STAGE_NOT_ELIGIBLE`, `R1A_JOB_ID_INVALID`, `R1A_CUSTOMER_OVERWRITE`, `R1A_STAGE_RULE_BROKEN`, `R1A_JOB_LINK_MISMATCH`, `R1A_INTAKE_CARDINALITY`. Result includes `match_status`, `customer_changes`, `helper_tasks_completed`, `booking_tasks{created,skipped,missing_templates}` |
| `BOOKING_GATES` | `job_id`, version Jobs | none | office class + assigned; FN-01 | runs `processBookingGates`; result status `ReadyToBook` / `Booked` / `Blocked` / `NeedsReview` + readiness + gates + tasks. Can itself perform T2, T3, **and T4** (legacy path to Booked without CONFIRM_BOOKING's officeManager restriction — §11.5) |
| `CONFIRM_BOOKING` | `job_id`, version Jobs | `submitted_by` only (identity echo) | **officeManager** + assigned; FN-01 | §2.2 T4 |
| `TASK_COMPLETE` | `task_id`, version Tasks | `completion_note`*, `evidence_id`, `evidence_path`, `invoice_number`, `invoice_sent`, `outcome`, `contract_id`, `contract_signed`, `customer_details_verified`, `sold_value_verified`, `verified_gross_amount`, `deposit_bank_confirmed`, `deposit_amount`, `deposit_received_date`, `deposit_bank_reference` | office class + assigned to the task's job + (owner \| backup \| admin); job-less task: owner or admin; FN-01 | §4.2, §8.2. Results `Completed` / `FollowUpRequired` / `Replayed` with `task, job, invoice_stage, bank_check, readiness` |
| `TASK_REOPEN` | `task_id`, version Tasks | **reopen_reason** | same as TASK_COMPLETE | §4.2. Result `Reopened` |
| `TASK_EVIDENCE_ATTACH` | `task_id`, version Tasks | **evidence_path** | same as TASK_COMPLETE | §8.3. Results `EvidenceUploaded` / `Attached` / `Replayed` |
| `DEPOSIT_CONFIRM` (legacy, superseded by PRE03 TASK_COMPLETE) | `job_id`, version Jobs | **reference, deposit_bank_confirmed, deposit_amount, deposit_received_date** | **director** class (Admin/Manager/Director) + assigned; FN-15 Manual | must be explicit Yes (`R1A_DEPOSIT_NOT_CONFIRMED`); same recorder as PRE03; **never completes the PRE03 task**; `AlreadyConfirmed` if valid confirmation exists; re-evaluates readiness |
| `CALL_RECORD` | `job_id`; optional `task_id` (version = Tasks if task given, else Jobs) | **type, outcome**, `work_package_id, contact_id, person_id, attempted_at, notes, next_attempt_at, actual_completion_confirmed, customer_happy` | office class + assigned; if task given it must belong to the job (`R1A_TASK_JOB_MISMATCH`) and actor be owner/backup/admin; FN-01 | call id `CALL-R1A-{command_id}` (replay by existence); task must be INS01/INS04 (`S10_REVIEW: invalid call task`); effects §8.2; TaskEvent `CallOutcome` if the task changed |
| `ISSUE_CREATE` | `job_id`, version Jobs (job version must **not** change — asserted) | **issue_type** ∈ Variation/Remedial/Complaint, **title**, **description**, `severity` ∈ Normal/Medium (default Normal), `owner_id` (active person), `customer_impact` (bool-ish → `blocks_completion`; default true), `requested_by`, `requested_at` | office class + assigned; FN-01 | job not archived/cancelling; Issue `ISS-R1A-{command_id}` status `Open`, due next staffed day, `blocks_completion` default **true**, `blocks_strip` false; IssueEvent `Opened`; ISS01/ISS02 task |
| `ISSUE_UPDATE` | `job_id`, `issue_id`, version Issues | **action** ∈ `REASSIGN` (needs `owner_id`) \| `TRANSITION` (`status` ∈ Resolved/Closed, `resolution`, `evidence_id`, `customer_resolution_confirmed`) | office class + assigned; issue must belong to job (`R1A_ISSUE_JOB_MISMATCH`); FN-01 | §8.2 issue rules; IssueEvents `Reassigned` / `Resolved` / `Closed`. Note: resolving/closing an issue does **not** complete its ISS01/ISS02/REM01 task |
| `PLANNER_UPDATE` | `job_id`, `work_package_id`, version WorkPackages | **planned_start, planned_end**, `reason` | office class + assigned; WP belongs to job; FN-01 | §7.3 |
| `MOVE_JOB` | `job_id`, version Jobs | **activities[], reason**, `planned_start, planned_end, scaffold_erect, scaffold_strip` | office class + assigned; FN-01 | §7.3; result `Moved` with `moved, preserved, calendar_outbox_ids, impact_tasks` |
| `CHANGE_INSTALLER` | `job_id`, `work_package_id`, `old_allocation_id`, version WorkPackages | **mode, person_id, reason**, `role`, `old_allocation_id` | office class + assigned; WP belongs to job; FN-01 | §7.3; `Replaced` / `Added` / `NeedsReview{reason}` |
| `COMMISSIONING_RECORD` | `job_id`, `work_package_id`, version WorkPackages | `evidence_path, evidence_id, reference, notes` (one evidence source required) | **officeManager** + assigned; FN-01 | §8.2 |
| `OPERATIONAL_COMPLETE` | `job_id`, version Jobs | none | **officeManager** + assigned; FN-19 + FN-11 Manual | §2.2 T5, §7.5 |
| `CANCEL_JOB` | `job_id`, version Jobs | all required: **reason, effective_date, work_performed, material_state, scaffold_state, finance_review, legacy_state** | office class + assigned; FN-01 + FN-17 + FN-20 | S15 (§1.1) |
| `REINSTATE_JOB` | `job_id`, version Jobs | **reason, new_date, commitment_review, finance_review, evidence_reference**, `risk_review` | same as CANCEL_JOB | S15 (§1.1) |
| R3/R2 boundary commands (`IW_START, IW_PROGRESS, IW_REPORT_COMPLETION, IW_REPORT_PROBLEM, IW_REPORT_VARIATION, IW_COMMISSIONING_DRAFT, IW_COMMISSIONING_SUBMIT, COMMISSIONING_REVIEW, GOODS_IN_RECEIVE, STOCK_QUARANTINE`) | see `r1-appsheet/operations-contract.js:5-16` | field lists there | Installer commands: role ∈ Installer/Office/Manager/Admin and (actively allocated to the WP, or office with a mandatory `reason` — `R1C_OFFICE_REASON_REQUIRED`); review: Office/Manager/Admin; goods-in: Store/Office/Manager/Admin; stock: Store/Manager/Admin | Out of R1 scope; listed for completeness. Accepting a commissioning review requires an **approved** active template for the trade (`R1C_APPROVED_TEMPLATE_REQUIRED`, `:93`) |

DEV-only admin repair functions (Admin/Manager; dry-run by default): `_r1sPre03AssignmentAudit`,
`_r1sRepairPre03Assignment`, `_r1sProvisionBookingTemplates`, `_r1sGenerateBookingTasks`, `_r1sReconcileStaffTasks`
(`services.js:1413-1633`) — one-off data repairs for rows created by earlier code; **not staff features**
(`docs/R1-office-appsheet-configuration.md:589`).

Reads relevant to this domain (`adapter.js:5`): `OFFICE_HOME, MY_TASKS, TEAM_TASKS` (team view redacts customer
name/postcode for jobs the actor is not assigned to, `:72`), `OPERATIONAL_QUEUE` (queues allowed in R1:
`booking, calls, issues, payments, ghl, cancellation, intake_review`), `JOB_OVERVIEW, JOB_SEARCH, AUDIT_HISTORY,
ACTION_AVAILABILITY, TASK_ACTION_AVAILABILITY, PLANNER_3_WEEKS, PLANNER_6_WEEKS, INTAKE_REVIEW`.
Queue membership rules: `s17/admin.js:402-420`. Planner: left-join of live WorkPackages (planned dates overlapping the
window, inclusive) to active allocations; unallocated booked work **must** remain visible; not person-scoped
(`s11/planner.js:167-184`, `tests/s11.test.cjs:36-125`).

---

## 10. Classification: preserve vs do not port

### BUSINESS SEMANTICS TO PRESERVE

1. Stage list and the implemented transitions T1–T7, including **automatic promotion and demotion** between
   Prebooking and ReadyToBook, "one stage at a time", and "early booking cannot skip ReadyToBook".
2. Gates as *conjunction of task status + structured evidence state*; exactly-one-task rule; PRE01–PRE04 strictly
   `Complete`; `NotRequired` needs a note/evidence; finance-route branching (Standard → PRE01+PRE03+bank
   reconciliation; Phoenix/OtherReview → PRE05 + evidence); finance route immutable after Sold.
3. Three-way deposit reconciliation (Job summary ↔ ManualBankChecks ↔ deposit InvoiceStage), expected amount only from
   the server, non-successful checks recorded (`NotReceived`, `AmountMismatch`), financial fields never mutated by
   verification commands.
4. "Sent is not signed": PRE02 Waiting/`Sent` vs Complete/`Signed` with same-job documentary evidence.
5. Negative outcomes turn a task into `Waiting` with a machine-readable `blocking_reason` and
   `next_followup_at = next staffed day`, instead of completing or erroring.
6. Task generation table §3.2, instance-key dedupe (never recreate completed/cancelled), generators idempotent and
   re-runnable, BKG04/05 only after confirmation, per-revision INS01/INS02.
7. Owner/backup semantics: single shared task; owner|backup|Admin/Manager may act; real actor recorded; PRE03 named
   responsibility with fail-visible (no silent fallback); job "assignment" visibility rule; team view redaction.
8. Reopen preserves note/evidence/history and re-evaluates readiness.
9. Booking intake rules: exact public-id match only; customer data never overwritten (CustomerChanges proposals);
   amount/customer/installer/merchant/scaffold inconsistencies → Intake Review + `sold_booking_match_status:'Review'`;
   server-derived hook totals; deterministic child ids for replay safety.
10. Move/change-installer rules: reason required, selective activities, revision bumps, preserved list, installer
    validity/availability/leave/capacity/holiday checks, Replace vs Add, impact follow-up tasks, calendar intent.
11. Call/issue/operational-completion rules (§7.5, §8.2), INS04 only after all confirmations, NoAnswer keeps task open,
    unhappy customer → complaint, ReturnRequired → remedial + REM01, GHL01 only after completion, human GHL.
12. R1 office-recorded commissioning acceptance with honest provenance (null installer/allocation, unapproved template).
13. Global suppression of normal work during cancellation / reopen review (§2.4).
14. Command discipline: idempotency key, optimistic version on a *named* entity per command, payload whitelist,
    conflict on same id + different content, full before/after audit, TaskEvents, identity echo check
    (`submitted_by` must equal the authenticated actor).
15. Staff-facing result vocabulary worth keeping as UX: `Succeeded / FollowUpRequired / ActionRequired / Failed` with
    the message catalogue in `r1-appsheet/command-result.js:20-200` (drop `UploadPending`).
16. Due-window classification (`s05/priority.js`) and Office home buckets (overdue / today / next 7 days).

### PLATFORM PLUMBING NOT TO PORT

- `DEV_SHEET_ID` / `getSheetId()` / `getEnvironment()==='DEV'` guards in every module; `R1A_DEV_ONLY`.
- `ReleaseModes` FN-xx mode checks, `pilot_job`/`release_scope` gating, `R1A_OUTSIDE_PILOT`, S18/S19/S20 gate
  evaluators (release governance — port only if the business wants feature flags).
- `CommitJournal` Prepared/Applying/Committed/RecoveryRequired state machine, `_r1sConfirmRecovery`, buffered store
  (`_r1cBuffer`), cached store, `withLock`/script lock, `R1A_RECOVERY_REQUIRED` — replaced by DB transactions + a unique
  `commands(command_id)` table storing the fingerprint and result.
- Cardinality self-assertions (`R1A_INTAKE_CARDINALITY`, `R1A_JOB_MUTATION`, `R1A_FINANCIAL_MUTATION`,
  `R1A_TASK_HISTORY_MUTATION`…) — defensive checks against a non-transactional store; keep as tests, not runtime.
- Request-row tables (`DEV*Requests`), `appSheetR1CommandFromRequestRow`, `result_*` columns writer, request `status
  'Ready'`, AppSheet expressions/LINKTOFORM/Show_If/Valid_If builders (`services.js:899-1075`), MappingRules
  self-provisioning (`_r1sEnsureMappings`), synthetic form ids `R1A-SOLD-DEV`/`R1A-BOOKING-DEV`, the intake
  question-id mapping layer (unless Jotform intake is kept).
- Entire upload-retry module (§8.4), `_r1cResolveUpload`, Drive file ids, `_r1sHashDrive`.
- Template self-healing (`ensurePre04Template`, `ensureBookingTemplates`, `_r1sEnsureIssueTaskTemplates`) and all DEV
  repair runners — replace with seed migrations.
- Hand-rolled ids from `Date.now()`+`Math.random()`, 32-bit string hashes, `_r1sIdKey` zero-width stripping, flag
  parsers accepting `'yes'/'1'/'y'` (use real booleans/enums).
- Outbox `CAPTURE_ONLY` calendar rows as such (keep the *intent* concept only if a Calendar integration is planned).
- apps-script/ bundles, fixtures, VM smoke tests, `standalone-bridge/`.

---

## 11. Open questions, ambiguities, test/doc disagreements

### 11.1 Two divergent S06 implementations
`apps-script/s06/S06Gates.js` (289 lines) is an older, simplified smoke bundle: its ReadyToBook/deposit gate only
checks the three Job deposit fields (no ManualBankChecks/InvoiceStage reconciliation, no `contract_signed_at` /
`contract_id` requirement, no PRE01 invoice evidence), and it hard-codes `PERSON-tanya`
(`apps-script/s06/S06Gates.js:221-243,260-264`). `s06/gates.js` is what the R1 adapter and
`standalone-bridge/AppSheetBridge.js` embed and what `tests/s06.test.cjs` / `tests/r1-appsheet.test.cjs` prove.
**Port `s06/gates.js`.** `docs/S06-implementation.md:26-28` is also stale: it lists 8 checks with `contract_status`
as **non-blocking** and only 6 templates; the code makes `contract_status` blocking and adds the `task_*` gates,
PRE04/PRE05, BKG02/03/05.

### 11.2 Missing middle of the stage machine
No code moves a job to `AwaitingInstallation`, `InProgress` or `Aftercare`, yet OPERATIONAL_COMPLETE is only *offered*
in `InProgress`/`Aftercare` (`r1-appsheet/adapter.js:112`). So with purely implemented transitions a `Booked` job can
never be shown the completion action, although the server would accept the command (no stage check in
`s10/operations.js:157-165` or `adapter.js:193-195`). Needs a business decision: what events drive
Booked → AwaitingInstallation (BKG04+BKG05 complete? materials ready?) → InProgress (first `actual_start` / install
date reached?) → Aftercare (all required WPs `ConfirmedComplete`?), and whether OPERATIONAL_COMPLETE must enforce stage
server-side.

### 11.3 PRE05 (finance agreement) evidence is unvalidated and unreachable from the UI
The gate requires `Tasks.evidence_id` on PRE05 (`s06/gates.js:135-136`), but TASK_COMPLETE only processes
`evidence_path` uploads for PRE02/PRE04 and stores any typed `evidence_id` for other templates without checking it
exists or belongs to the job (`r1-appsheet/services.js:341,461-465`); the AppSheet form hides both evidence columns
for PRE05 (`docs/R1-office-appsheet-configuration.md:507-508`). No test completes PRE05 through the adapter
(`tests/r1-office-journey.test.cjs:305-315` only proves it is created). Also `createTasksForJob` never backfills
PRE05 (`s06/gates.js:426-449`). The Phoenix/OtherReview path to ReadyToBook is therefore effectively unproven.
Decide: PRE05 should take a validated same-job Evidence upload (category e.g. `FinanceAgreement`) like PRE02.

### 11.4 How a booking in `Review` gets back to `Match`
Booking intake sets `sold_booking_match_status:'Review'` on any mismatch, which blocks `sold_booking_match`. The only
code that sets `Match` afterwards is PRE04 completion (`services.js:233-242`) — but PRE04 is normally already Complete
by then (it gates ReadyToBook), so staff would have to TASK_REOPEN PRE04 (demotion does not apply at
BookingInProgress) and re-complete it, or submit a corrected booking with a **new** command/intake id
(`tests/r1-office-journey.test.cjs:199-214`). There is **no command to resolve a `CustomerChanges` proposal**
(`resolution/resolved_value/resolved_at/resolved_by` are never written) and no "accept intake review" command, though
`docs/…` and `s05/intake.js:308-309` refer to "Accept in Intake Review". BKG03 "Reconcile booking response" is only a
note-completed task. Needs design.

### 11.5 Two routes to `Booked` with different authorisation
`CONFIRM_BOOKING` requires Office/Admin/Manager (`adapter.js:198-201`). `BOOKING_GATES` (any office-class user incl.
Director/VariationApprover, `:196-197`) runs `processBookingGates`, which also performs BookingInProgress → Booked when
gates are ready (`s06/gates.js:799-806`) and stamps `booking_approved_by` = that actor. Tests keep BOOKING_GATES out of
the staff UI (`tests/r1-appsheet.test.cjs:64,4081`) but the server path exists. Port a single explicit confirm command
and make the evaluator side-effect-free beyond Prebooking↔ReadyToBook.

### 11.6 Promotion audit written once only
`AE-S06-ReadyToBook-{jobId}` is a deterministic id guarded by "insert if absent" (`s06/gates.js:785-789`), so
ReadyToBook → (reopen) Prebooking → ReadyToBook again leaves no second promotion audit row (the demotion rows are per
command). In Postgres simply log every transition.

### 11.7 Actionability checks are inconsistent across commands
`R1A_JOB_NOT_ACTIONABLE` (archived / cancelling / cancelled) is enforced server-side for BOOKING_INTAKE, ISSUE_CREATE,
CONFIRM_BOOKING, COMMISSIONING_RECORD only. TASK_COMPLETE, TASK_REOPEN, CALL_RECORD, ISSUE_UPDATE, PLANNER_UPDATE,
MOVE_JOB, CHANGE_INSTALLER and DEPOSIT_CONFIRM have no such server check (MOVE_JOB/CHANGE_INSTALLER R1 variants also
lack the S15 guard that the R2 variants have, `s11/planner.js:68,131` vs `:154-164`); only the read-side availability
flags hide them. Likewise the stage restriction for MOVE_JOB/CHANGE_INSTALLER (`Booked, AwaitingInstallation,
InProgress, BookingInProgress`) is read-side only. Recommend enforcing both server-side in the port.

### 11.8 MOVE_JOB impact-task key collision
`instance_key = 'S11-MOVE-'+code+'-'+command_id` (`s11/planner.js:59`) ignores the entity, so a move touching two
work packages or two allocations creates only **one** `ASSIGNED_PEOPLE`, `CALENDAR` and `MATERIALS` task (first
entity wins; the task id `TASK-{key}` would also collide). Tests only cover single-trade moves
(`tests/r1-office-journey.test.cjs:317-369`). Decide per-entity vs per-move tasks.

### 11.9 Time-of-day and timezone
Due times are literal `T09:00:00.000Z` / `T17:00:00.000Z` (UTC), not Europe/London; S06 `isStaffedDay` uses the server
timezone's `getDay()` and ignores `office.staffed_weekdays`; the R1 adapter passes no holidays to S06 helpers, while
S10/S11/S16 do read `Holidays`/Settings. Template due rules "Same day then daily" (PRE02), "Friday 12:00" (MAT05,
SCA05), "09:00"/"16:30" (SYS01/02), "Seven days before due" (FIN01; setting `finance.interim_send_lead_days`) are not
implemented — FIN01 is simply due the Friday on/before the install date. There is **no recurring/daily task
mechanism** (no generator for "Every Friday"/"Every staffed day" templates except the manual `_s16SystemTasks`).

### 11.10 TaskEvents coverage
Only the S03 in-memory store writes a `CREATED` event; S06/S10/S11/S13/S15 generators insert tasks with no TaskEvent
and (except S11/S15) no AuditEvent. S15's bulk task cancellation writes audit rows but no TaskEvents
(`grep -c TaskEvents s15/cancellation.js` → 0). For the port: write a task event for every create/status/owner/due change.

### 11.11 Reinstated jobs can never resume (as coded)
REINSTATE_JOB creates `S15-REOPEN-REVIEW` with `revision_required:true` (`s15/cancellation.js:83-89,186`). While it
is open every generator — including `createTasksForJob`, hence `processBookingGates`, hence the auto-readiness hook —
throws `S15_REVIEW: normal work suppressed`. But R1 TASK_COMPLETE refuses any task with `revision_required === true`
(`services.js:340`), S15 `Resolve` requires a cancelling/cancelled stage, and nothing clears `revision_required`. No
test completes this task (`grep REOPEN-REVIEW tests/` → only fixtures). Same problem for every `S15-CAN-*` task via
TASK_COMPLETE (they must go through `Resolve`, which has no adapter command — 11.12). Needs a defined "complete
reinstatement review" action.

### 11.12 Cancellation is only half exposed
The adapter binds `Cancel` and `Reinstate` only; S15 `Resolve` (evidence-backed completion of cancellation
obligations) and `Close` (CancellationInProgress → Cancelled) are implemented and tested in `tests/s15.test.cjs` but
unreachable from the R1 command surface, so through the adapter a job can never reach `Cancelled` and therefore never
be reinstated. S15's actor rule (Admin/Office/Manager) is also narrower than the adapter's. The `S15-CAN-*` templates
are missing from the seed. `docs/S15-implementation.md` says "17 cancellation templates + REOPEN"; the fixture has
15 + 1.

### 11.13 Job id format disagreement
Generator + adapter: `SS-` + 4 letters (A–Z without I and O) + `-` + 4 digits (`s05/mapping.js:219-236`,
`services.js:1219`). `docs/S05-implementation.md:41` and `docs/R1-office-journey-audit.md:24` say `SS-XXXX-XXXX`;
S18 acceptance check JOB-01 demands `^SS-\d{4}-\d{4}$` (`s18/acceptance.js:148`) which every generated id would fail.
Several fixtures use non-conforming ids (`SS-ACC-5961`, `SS-S06F-BOOK`). Use the generator's format.

### 11.14 Owner resolution is fragile
"First active Office PersonRole in storage order" (`s06/gates.js:586-590`) vs "Tanya if present else exactly one"
(`s10/operations.js:46-52`) vs literal `PERSON-tanya` (S09, S13) vs name-substring matching (S16). The seed has two
Office people (Tanya, Hannah), so S10 would throw `S10_CONFIG` if Tanya were removed. `TaskTemplates.default_owner_role`
is never used to resolve an owner (INS02's template says `Installer` and code does use the lead installer, by
coincidence of hard-coding). Ben is `Admin` in the seed (`schema/config-seed.json:18`) but `Director` in the S06 test
fixture and `Manager` in S16's. `People.backup_person_id` is unused. The port needs one explicit rule, e.g. a
`role_assignments` / "responsibility" table (template_code → person, backup) with the PRE03 fail-visible semantics.

### 11.15 Seed vs code template drift
In code, not in seed: INS04, REM01, ISS01, ISS02, all `S15-*`, `PRE-COPY-JOBID`, `S06-UNPAID-INTERIM`,
`S13-INTERIM-CHASE`, `S13-GHL-PROGRESSION`, `S08-PICK-STOCK`, `S11-MOVE-*`. In seed, no generator inside S05–S17: SCA02–SCA05
(`scaffold/workflow.js`, R2), MAT02–MAT06 (`materials/workflow.js` / `stock/workflow.js`, R2), SYS01/02 (manual S16
call only), **FIN03 (no R1 generator at all — only the S03 demo processor)**. The S17 `calls` queue references a
`CAL01` code that exists nowhere else. `FIN02` is referenced in docs/comments but does not exist.
Two unpaid-interim chase tasks exist with different codes/keys (`S06-UNPAID-INTERIM` triggered by *deposit* not
confirmed — arguably mis-named — and `S13-INTERIM-CHASE`). Two GHL tasks exist (`GHL01` from S10 and
`S13-GHL-PROGRESSION` from S13) with different GHLTasks ids; the S17 `ghl` queue only shows the former.
`docs/R1-office-appsheet-configuration.md:573` says the interim chase belongs "the Friday before the first
installation work" but `createInterimChaseTask` sets due = now.

### 11.16 "Non-blocking" booking gates still block confirmation
`customer_details_complete` and `gross_amount_present` are flagged `blocking:false`, but CONFIRM_BOOKING and the
auto-transition require `ready === true` (all gates pass). The flag only changes the summary label. Confirm intended.

### 11.17 S04 vs R1 completion rules
S04 (synthetic-only) refuses completion when `blocking_reason` is set or a `TaskDependencies` row is unsatisfied
(`s04/processor.js:75-76`); R1 TASK_COMPLETE does neither and *must* allow completing a `Waiting` task that carries a
`PRE0x_*` blocking_reason. If the port keeps a `Blocked` status/dependencies, distinguish "follow-up reason" from
"hard block". `docs/S06-implementation.md:12` claims TaskDependencies "supports named_gate and prerequisite_task_id
for gating" but no S06 code reads that table.

### 11.18 Issue tasks are not closed by issue resolution
`ISSUE_UPDATE` TRANSITION to Resolved/Closed never completes the linked ISS01/ISS02/REM01 task, and those tasks are
completed by generic TASK_COMPLETE (note only). `s10/operations.js:164` also returns `ghl_task: task.task` where
`task` is already the task row → `undefined` on first completion (the adapter masks it with `|| null`,
`services.js:713`). Severity is restricted to `Normal|Medium` in ISSUE_CREATE (`services.js:655`) with no higher level.

### 11.19 Booking-form rules enforced only in AppSheet
"Scaffold erect ≥ 2 days before roofer" (`services.js:1033-1034`, explicitly "not enforced by the server"); second
sparky ≠ sparky and only shown when a sparky is chosen (`:1037`); battery_qty ≥ 1; counts ≥ 0. Booking intake also
performs **no** installer capacity/leave/holiday check (only CHANGE_INSTALLER does). Decide which become server rules.

### 11.20 Minor test/doc mismatches
- Doc test counts are stale (S06 doc says 14 tests; file has ~30; S13 12 vs 13; S16 30 vs 57; S17 20 vs 29).
- `tests/command-result.test.cjs:44` uses reason `CAPACITY_EXCEEDED`; the planner emits `CAPACITY_CONFLICT`
  (`s11/planner.js:39`) — message mapping is generic so both "work".
- `docs/S11-implementation.md:45` says Add mode creates a "Support role"; code defaults to `Second`
  (`s11/planner.js:143`).
- `docs/S17-implementation.md` lists a `complete_task` job action; `tests/s17.test.cjs` asserts it is absent.
- BKG05 title differs between fixtures (`tests/r1-office-journey.test.cjs:48` vs `tests/r1-appsheet.test.cjs:3720`);
  the seed text `Check calendar events and document pack` is authoritative.
- `expected_version` strictness differs: CONFIRM_BOOKING/intake accept numeric strings (`services.js:819`), IW
  commands accept `^[1-9][0-9]*$` strings too, TASK_* compare with `Number()`. Use integers only.
- `docs/R1-go-live-readiness.md:298` flags `booking_install_date → Jobs.next_action_at` as a wrong authoritative
  target (WorkPackages are the date master) and `booking_notes → Jobs.display_name` as risky; yet FIN01, S13 interim due
  date, S09 erect date and S06-UNPAID-INTERIM all key off `next_action_at`. The port should derive "first install date"
  from work packages.
- The S13 legacy `confirmDeposit` still exists and stamps Job fields without a bank-check row; the gate correctly
  rejects that state (`tests/r1-appsheet.test.cjs:1884-1894`). Do not port `confirmDeposit`.

---

## Appendix A — R1 journey as proven by tests (`tests/r1-office-journey.test.cjs`, `tests/r1-appsheet.test.cjs`)

1. Sold → `Processed`, id matches `^SS-[A-Z]{4}-\d{4}$`, stage `Prebooking`, tasks PRE-COPY-JOBID + PRE01–04 (Standard)
   or PRE02/04/05 (Phoenix); PRE03 owner `PERSON-ben`, backup `PERSON-dan`; deposit stage = 25 % of gross
   (5000.00 → 125000 p; 10451.78 → 261295 p) (journey `:109-130,305-315`; appsheet `:197-250,1652`).
2. Duplicate Sold → `duplicate:true`; conflicting payload → `Review` / `CONFLICTING_INTAKE`; at the adapter, same
   command_id + different payload → `R1A_COMMAND_CONFLICT` (`:132-144`; appsheet `:341`).
3. PRE01/02/03/04 completions with structured evidence; negative outcomes → `FollowUpRequired` + `Waiting`; last one
   auto-advances to `ReadyToBook` with exactly one `WorkflowStage:ReadyToBook` audit (appsheet `:265-322, 574-577,
   639-641, 684-756, 781-815, 1628-1922`).
4. Reopen a gating task → job demoted to `Prebooking` (appsheet `:1511-1626`).
5. Booking on Prebooking job stays `Prebooking`; on ReadyToBook → `BookingInProgress`, helper task completed once,
   BKG01–03 created, nothing else (appsheet `:371,388,2730-2772,3736-3778`).
6. Mismatched booking → `Review` + CustomerChanges, never overwrite (journey `:185-197`; appsheet `:398-401`).
7. CONFIRM_BOOKING blocked → `R1A_BOOKING_GATES_NOT_SATISFIED` with `outstanding`, zero writes, no journal row; when
   ready → `Booked`, approval stamped with actor, BKG04/BKG05 created once; `force:true` → `R1A_INVALID_FIELDS`
   (**no override path exists**) (appsheet `:4062-4134,4193`).
8. Move one trade (other preserved, `CUSTOMER_NOTICE` impact task), replace installer (old allocation inactive),
   3-/6-week planner incl. unallocated work; zero external calls (journey `:317-420`).
9. COMMISSIONING_RECORD → `CS-R1A-{wp}` `Accepted`; OPERATIONAL_COMPLETE → `Completed`; VariationApprover-only actor
   refused (appsheet `:87-88,4481-4535`).
No `skip`/`todo`/`only` tests exist in the five R1 test files. Task due-date rules, task cancel, general reassign and
calendar/resource conflicts are **not** covered by the R1 adapter tests (see `tests/s06`, `tests/s10`, `tests/s11`).
