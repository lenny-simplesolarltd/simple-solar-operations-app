# R1 parity: FINAL (converged code)

**Date:** 2026-09-20. Read-only audit. No code, DB or server touched.
**New stack:** `/Users/lennybeadle/simple-solar-final-convergence`, branch `feature/final-convergence` (47 migrations).
**Reference:** `/Users/lennybeadle/:reference` @ `c4f56ea`, read with `git show`.
**Baseline:** `docs/r1-parity-after-p0.md` (96/121 = 79.3%).

## 1. Method

- The denominator and row ids are the same as the baseline: 121 R1 rows (131 R1-tagged appendix rows minus the 10 baseline-obsolete rows). Ids use the baseline appendix keys (A01…, A-B01…, B-C01…, C-1…, E-R-12…).
- BEFORE = the baseline AFTER column. AFTER = this audit, on the converged code.
- The release-gating convention is unchanged. FN-01 is the go-live switch and never downgrades a row. RELEASE-GATED is kept for the FN-14/FN-16 health and resilience rows.
- Every change listed in the brief was checked in code:
  - `supabase/migrations/20260920120000_convergence_operations.sql` (short name **co**), all 851 lines read
  - the UI pages and components that call the new commands and reads
  - `tests/s0-convergence-operations.test.mjs` (**s0co**)
  - the reference S16/S19/S20 and R1 AppSheet adapter at `c4f56ea`
- Tests were not run. The browser acceptance (Presale → OperationallyComplete, cancel/reinstate through the UI) is taken as reported.
- Rows whose code did not change keep their baseline evidence (marked "unchanged").
- Short names:
  - migrations: 141000 = command_core, 144000 = r1_prebooking_commands, 170000 = view_port_reads, 183 = p0_evidence, 202 = p0_audit_integrity, 2021 = p0_operational_health, 210 = r1_completion, 220 = p0_r1_integration
  - tests: r1p0 = tests/r1-p0-integration.test.mjs, se = storage-evidence, pah = p0-audit-health

## 2. BEFORE vs AFTER

| Class | BEFORE (after P0) | AFTER (converged) | Δ |
|---|---|---|---|
| COMPLETE | 54 | 57 | +3 |
| COMPLETE — DIFFERENT ARCHITECTURE | 42 | 44 | +2 |
| PARTIAL | 9 | 7 | −2 |
| RELEASE-GATED | 8 | 7 | −1 |
| MISSING | 4 | 0 | −4 |
| UNCERTAIN | 4 | 4 | 0 |
| INTENTIONALLY OBSOLETE (inside the 121) | 0 | 2 | +2 |
| **Total** | 121 | 121 | |
| **R1 complete (C + CDA)** | **96/121 = 79.3%** | **101/121 = 83.5%** | +5 |
| R1 complete, excluding the 2 new obsolete rows | — | 101/119 = 84.9% | |
| R1 implemented (C + CDA + RG) | 104/121 = 86.0% | 108/121 = 89.3% | +4 |
| Live today | 0 (all FN Disabled) | 0 (all FN Disabled; hosted has 23 of 47 migrations) | — |

**Rows that changed (8):**

| Change | Row | Why |
|---|---|---|
| P → C | #2 A02 | STAFF_CREATE / STAFF_ROLE_SET / STAFF_SET_ACTIVE and the People UI |
| P → CDA | #39 A-E04 | Only the planned mode can be set, enforced when the mode is written. The readiness check covers Disabled⇔None across all 21 functions. Staff can no longer write release_modes directly. |
| M → P | #47 A-G05 | A runbook exists, but it has gaps against the reference S19 plan (§4) |
| M → CDA | #48 A-G06 | `app.release_readiness()` plus the RELEASE_CONTROL UI |
| M → C | #69 B-C22 | TASK_REASSIGN with a UI and tests |
| M → OBS | #78 B-C32 | Owner decision. The reference has only the INTAKE_REVIEW read, no resolve command. |
| P → OBS | #75 B-C29 | The reference calls DEPOSIT_CONFIRM a "legacy … DEV request route". PRE03 does the same work through the same recorder, and deposit confirmation is already counted at E-F-02. |
| RG → C | #85 B-C39 | The only baseline gap (no audited switch and no UI) is closed by RELEASE_MODE_SET, the Release control page and the revoked direct writes |

**Improved but still in the same class:**
- A11: deactivation now has a UI.
- A-E03: RELEASE_CONTROL.
- A-G04: R1 readiness verdict plus the runbook checklist.
- A-C05 and C-39: readiness now checks the pg_cron jobs by name.
- C-7 and C-8: new cross-job Issues queue.
- E-R-19: Files library, `search_evidence`, and SimpleBot file tools.
- A-F04: task-level availability *is* consumed via TASK_DETAIL. The baseline note overstated this gap; the class is unchanged.

**Judgement calls:**
- B-C39 moved RG → C. It was the gating mechanism itself; the mechanism is now complete, and its Disabled position is the go-live switch.
- B-C29 went to OBS instead of CDA. CDA would count deposit confirmation twice.
- A-G05 was given PARTIAL, not CDA or OBS. See §4.

## 3. Full 121-row table

Key: C = COMPLETE, CDA = COMPLETE — DIFFERENT ARCHITECTURE, P = PARTIAL, RG = RELEASE-GATED, M = MISSING, U = UNCERTAIN, OBS = INTENTIONALLY OBSOLETE.

| # | id | capability | before | after | evidence | note |
|---|---|---|---|---|---|---|
| 1 | A01 | Staff directory (People) | CDA | CDA | 120000:62-91; 00-identity.test.mjs | unchanged |
| 2 | A02 | Staff/role administration | P | C | co:439-624 STAFF_CREATE/STAFF_ROLE_SET/STAFF_SET_ACTIVE + STAFF_ADMIN; UI people/page.tsx:34-38, staff-admin.tsx:26,102,147; s0co:108-146 | Admin/Manager add person, give/remove role, deactivate/reactivate; reason + version; self-lockout and last-Admin guards; only Admin grants Admin; row-audited |
| 3 | A03 | Auth identity → person linkage | CDA | CDA | 120000:357-382; 00-identity.test.mjs | unchanged; hosted sign-up/confirm settings still unverified |
| 4 | A04 | Login provisioning (invite-only) | P | P | invite-staff.ts unchanged (audit insert :88-95 unchecked, after the invite) | still non-transactional/unchecked audit; only a preview write-block unit test |
| 5 | A05 | Actor resolution, fail closed | CDA | CDA | 141000:326-354; t_s17 | unchanged |
| 6 | A06 | Role vocabulary + PersonRoles | C | C | 120000; roles now row-audited (202 audit_required) | unchanged; improved |
| 7 | A07 | Role classes | C | C | 141000:369-383 | unchanged |
| 8 | A10 | Skills (installer-only) | C | C | 164000 RP_SET_SKILL; skills row-audited (202) | unchanged |
| 9 | A11 | Deactivation immediate | C | C | co:551-591 STAFF_SET_ACTIVE; s0co:128 "deactivation takes effect at once" | now also reachable from the People UI |
| 10 | A12 | Job access rule for commands | C | C | 141000:429-475; r1p0 "wrong role, wrong job access…" | unchanged; spot-checked: JOB_ACCESS_DENIED on job-level call |
| 11 | A13 | Read visibility + redaction | CDA | CDA | 170000; list_evidence/evidence_open 183 | unchanged |
| 12 | A15 | R1 command authorization matrix | P | P | submit_presale defined only in 090000/120000; no mode_available/FN-01 check; no later redefinition | unchanged: needs an owner decision (gate it, or record that sale capture stays ungated) |
| 13 | A17 | Read boundary | CDA | CDA | 149000; 220:213-354 | unchanged; SYSTEM_STATUS adds Director |
| 14 | A18 | Identity probe (WHO_AM_I) | CDA | CDA | 220:247-265 | unchanged |
| 15 | A20 | Client uncertain-outcome controller | CDA | CDA | use-command.ts | unchanged |
| 16 | A-B01 | Command envelope | CDA | CDA | 141000:907-977 | unchanged |
| 17 | A-B02 | Idempotency / conflict | CDA | CDA | r1p0 "duplicate command id" (replay) | unchanged |
| 18 | A-B03 | Payload allow-list | C | C | app.payload; 210/220 handlers use it | unchanged |
| 19 | A-B04 | expected_version | CDA | CDA | COMMISSIONING_RECORD uses WP version (220:111); job-level call uses job version | unchanged |
| 20 | A-B05 | Locking / concurrency | CDA | CDA | FOR UPDATE in 220:97-101 | unchanged |
| 21 | A-B07 | Append-only audit | CDA | CDA | 202:99-146 (26 required tables), app.audit_coverage 202:213; pah "direct Admin edit… audited", "switching a release function is audited"; t_p0_audit | unchanged; 36 operational tables deliberately semantic-audited only (no body leakage) |
| 22 | A-B08 | Task creation dedup + task events | CDA | CDA | 141000:648-709 | unchanged |
| 23 | A-B09 | Clock / London calendar | CDA | CDA | 141000:89-174 | unchanged |
| 24 | A-B10 | Failure categories → staff wording | CDA | CDA | 220:55-57 grants; r1p0:246-247 | unchanged; latent break since 167000 fixed |
| 25 | A-B11 | Versioned settings | CDA | CDA | settings INSERT audited again (202:131) | unchanged; improved |
| 26 | A-B12 | Server boundary / no client service role | CDA | CDA | /api/evidence and /api/health use session/anon only | unchanged |
| 27 | A-C04 | OutboundGuard allow-list | P | P | 164000:528-577 unchanged; no email outbox type or sender in src | email allow-list still advisory; no sender exists (runbook §8: no customer/merchant email) |
| 28 | A-C05 | Scheduled work (pg_cron) | U | U | app.release_readiness Scheduler item co:309-319; docs/HOSTED_MIGRATION_PLAN.md:17 reports 3 active jobs on hosted | now checked by name in readiness; hosted presence is documented by a read-only inspection but not verifiable from the repo |
| 29 | A-C06 | System health evaluation + record | RG | RG | 2021 app.operational_health / health_status; System Health UI system/page.tsx:176-194; t_p0_health | unchanged; FN-14 Disabled |
| 30 | A-C07 | Processing heartbeats | RG | RG | 148000; Scheduler item 2021:405 | unchanged; FN-14; no hourly tick (C13 obsolete) |
| 31 | A-C08 | Integration health checks | RG | RG | 148000:129-179 | unchanged; no caller (no worker) |
| 32 | A-C09 | Daily system tasks SYS01/02 | RG | RG | 148000:449-510 | unchanged; FN-16 |
| 33 | A-C10 | Resilience review queue read | P | P | public.resilience_review_queue() still not referenced anywhere in src | System health still shows only outbox Uncertain (SYSTEM_STATUS) and calendar NeedsReview; Communications Uncertain/Failed and stalled Processing rows not shown |
| 34 | A-C11 | Sweep RS-REVIEW / RS-ALERT | RG | RG | 148000 | unchanged; FN-14 |
| 35 | A-C12 | OUTBOX_RESOLVE | RG | RG | system-actions.tsx | unchanged; FN-14 |
| 36 | A-D01 | Data backup | U | U | readiness DatabaseBackup/StorageBackup items co:299-305 (Unknown until recorded) | hosted backup/PITR plan still unverified |
| 37 | A-D02 | Backup verify / restore rehearsal / status | RG | RG | OPS_EVIDENCE_RECORD 2021:192-221; evidence_state Verified/Stale/Failed/Unknown 2021:~260; UI system-actions.tsx:92-108; pah "a Director records a verified backup…"; r1p0 "System Health for Director" | unchanged; FN-14; human-recorded evidence, not an automated verifier (docs/OPERATIONAL_HEALTH.md §4) |
| 38 | A-E03 | Release-mode status read | C | C | execute_read RELEASE_MODE_STATUS unchanged; RELEASE_CONTROL co:386-416 adds per-function mode/scope/last change | improved |
| 39 | A-E04 | Mode-consistency health check | P | CDA | co:230-231 (only planned mode), co:225-226 (Disabled => None), co:342-351 readiness ModeConsistency over all functions; release_modes.function_id unique (100000:165); staff writes revoked co:276-278; s0co:63 | reference S16 checks Disabled<=>None and planned-Manual-not-Automated at read time; the new stack enforces the stronger rule at write time and re-checks all 21 functions in readiness. target_release is no longer staff-writable (only migrations), so the reference target_release check has nothing to catch |
| 40 | A-F01 | SYSTEM_STATUS | CDA | CDA | 2021:525+ (Drive placeholders → evidence; latest S16-system check; operational items); 220:320-325 Director; r1p0:534-535 | unchanged; residual: `commit_journal` counts still shown (always 0) |
| 41 | A-F02 | AUDIT_HISTORY per job | C | C | job-sections.tsx; r1p0 "audit: …no file paths or URLs" | unchanged; spot-checked |
| 42 | A-F03 | Office reads | CDA | CDA | 149000/170000 | unchanged |
| 43 | A-F04 | ACTION_AVAILABILITY / TASK_ACTION_AVAILABILITY | P | P | models.ts:377 type only; ACTION_AVAILABILITY still served by 220:304 (stale); TASK_DETAIL embeds read_task_action_availability (170000:356) and task-actions.tsx:101-117 consumes it | task-level availability IS consumed (via TASK_DETAIL; baseline note was too strong). Remaining gap: the job-level ACTION_AVAILABILITY read is still stale (completion only in InProgress/Aftercare) and callable; retire it or fix it |
| 44 | A-G01 | Schema provisioning + config seed | CDA | CDA | migrations chain | unchanged; hosted: 160000+ (incl. every P0 migration) not applied per docs/backend-port.md:51-52 |
| 45 | A-G02 | Staff import | CDA | CDA | seeds/001 | unchanged |
| 46 | A-G04 | Release acceptance evaluator | P | P | app.release_readiness co:283-381 (R1 verdict, Pass/Fail/Unknown); runbook docs/R1_PILOT_RUNBOOK.md §§2-10 (manual checklist) | improved: R1 verdict + documented manual checklist. Still no R2-R4 verdict, no data invariants (duplicate jobs, stuck tasks, stock), no in-app record of the manual checklist/sign-off |
| 47 | A-G05 | Migration / cutover (S19) | M | P | docs/R1_PILOT_RUNBOOK.md (139 lines); reference S19Migration.js:22-153 is itself a plan evaluator (DEV only, no importer) | see §5: runbook covers deploy, config, staff, scheduler, backups, pilot switch-on, smoke test, rollback. Missing vs the reference S19 plan: decision on in-flight jobs in the CURRENT business process (Jotform/Calendar/Trello - CUT-R1-02), freezing the old Jotform->Calendar creator for pilot jobs (no-dual-creator, CUT-R1-03), training plan (TRN-R1-01..15) |
| 48 | A-G06 | Release plan evaluation / config contract | M | CDA | app.release_readiness co:283-381; RELEASE_CONTROL/RELEASE_READINESS co:386-433; UI release/page.tsx + readiness card on system/page.tsx:90; s0co:95 "readiness never counts missing evidence as a pass" | R1 release contract as a live Pass/Fail/Unknown evaluator (backups+drills, audit, pg_cron, admin login, task owners, mode consistency, commit journal, private files) plus 3 listed external prerequisites. Residual: no old-creator-stopped check, sign-off = RELEASE_MODE_SET reason text only, R1 only, advisory (does not block a switch - neither did the reference, which was simulation-only) |
| 49 | A-G07 | Ownership / entitlement registers | U | U | — | company ownership of Supabase/Vercel/keys not provable from the repo |
| 50 | A-G08 | Negative security suite | CDA | CDA | 00-identity.test.mjs; se "knowing the path gains…nothing" | unchanged; extended |
| 51 | B-C01 | Sold intake → customer + job + presale | CDA | CDA | 120000:1017-1220; r1p0 "Job Sold creates PRE01-PRE04" | unchanged; not FN-01 gated (see #12) |
| 52 | B-C02 | Finance routes → PRE sets | C | C | 143000:353-375 | unchanged; Phoenix→ReadyToBook still untested |
| 53 | B-C03 | Human Job ID | C | C | 120000:857-877 | unchanged |
| 54 | B-C04 | Immutable presale snapshot | CDA | CDA | 120000:600-627 | unchanged |
| 55 | B-C05 | PRE01–05 generation + assignment | CDA | CDA | seeds/002; r1p0 "explicit owners" | unchanged; hosted legacy_id seeds unverified |
| 56 | B-C07 | Invoice stages at sale | C | C | 143000:528-585 | unchanged |
| 57 | B-C09 | Sold idempotency / conflict | CDA | CDA | job-sold.test.mjs | unchanged |
| 58 | B-C10 | Never merge customers | C | C | 145000:559-576 | unchanged |
| 59 | B-C11 | TASK_COMPLETE | C | C | 144000; evidence via app.evidence_attach (183:616); r1p0 PRE flow | unchanged; spot-checked: only registered uploads accepted when Storage exists |
| 60 | B-C12 | PRE01 invoice sent / failed | C | C | 144000:285-300 | unchanged |
| 61 | B-C13 | PRE02 contract + evidence | C | C | r1p0 "PRE02 (+ contract upload)"; se "a file of job A cannot complete a task of job B" | unchanged; improved |
| 62 | B-C14 | PRE03 bank check | C | C | t_prebooking | unchanged; NotReceived still untested |
| 63 | B-C15 | PRE04 verification | C | C | t_prebooking | unchanged |
| 64 | B-C16 | PRE05 finance agreement | C | C | 144000:426-433 | unchanged; UX: still labelled "(optional)" (task-actions.tsx:366) though the gate requires it |
| 65 | B-C17 | TASK_REOPEN | C | C | 144000:471-502 | unchanged |
| 66 | B-C18 | TASK_EVIDENCE_ATTACH | C | C | 220:483-534; r1p0 (2 uses) | unchanged; audit reason no longer carries the storage path; Repair mode still untested |
| 67 | B-C19 | Evidence rows + storage + cross-job protection | CDA | CDA | 183 (evidence_upload_begin :351, _complete :529, policies :956-958, bucket limits :949-950); se "nobody writes to a path…", "a file of job A…"; t_evidence | unchanged; DB-registered uploads replace path parsing |
| 68 | B-C21 | Owner/backup/admin authz | C | C | 141000:789-879 | unchanged |
| 69 | B-C22 | Task reassignment | M | C | co:634-692 TASK_REASSIGN, co:697-734 TASK_REASSIGN_CANDIDATES; UI task-actions.tsx:490-560, tasks/[taskId]/page.tsx:72,117; s0co:148-169 | eligible roles from the assignment rule; version + reason; task_events "Reassign"; FN-01 gated. Beyond the reference (it had no general command) |
| 70 | B-C24 | Task history + audit | C | C | task_events immutable; tasks audited (202) | unchanged |
| 71 | B-C25 | Task dependencies via gates | CDA | CDA | 143000 | unchanged |
| 72 | B-C26 | ReadyToBook evaluation | C | C | r1p0 "…-> ReadyToBook" | unchanged |
| 73 | B-C27 | Booking gates evaluation | C | C | 143000:213-299 | unchanged |
| 74 | B-C28 | BOOKING_GATES command | CDA | CDA | r1p0 (BOOKING_GATES ×2) | unchanged |
| 75 | B-C29 | DEPOSIT_CONFIRM legacy route | P | OBS | cmd_deposit_confirm 144000:568 retained (API only); only AlreadyConfirmed path tested (t_prebooking.mjs:82); reference R1AppSheetAdapter.js:950 "Legacy DEPOSIT_CONFIRM... Retained for the DEVDepositConfirmRequests route" | superseded by PRE03 (same recorder app.record_deposit_confirmation); deposit confirmation itself is counted at E-F-02 (CDA). Kept inside the 121 as OBSOLETE |
| 76 | B-C30 | BOOKING_INTAKE | CDA | CDA | 145000; r1p0 "booking -> Booked; first installers allocated by the booking form fields" | unchanged; first installer assignment is via the booking form |
| 77 | B-C31 | Booking queue / board / form reads | C | C | 171000 | unchanged |
| 78 | B-C32 | Intake Review resolution | M | OBS | intake/page.tsx:34-37 (describes the process); reference has only the INTAKE_REVIEW read (R1AppSheetAdapter.js:165-168), no resolve command in R1A_BOUND_COMMANDS (:22) | decision applied: correct via the booking form; the queue read exists. Residual: items are never ticked off, so the queue can only grow |
| 79 | B-C33 | ReadyToBook → BookingInProgress | C | C | 145000:816 | unchanged |
| 80 | B-C34 | CONFIRM_BOOKING | C | C | r1p0 (CONFIRM_BOOKING ×2) | unchanged; refusal paths still thinly tested |
| 81 | B-C35 | BKG01–05 generation | CDA | CDA | 143000:377-395 | unchanged |
| 82 | B-C36 | FIN01 / unpaid interim | C | C | 143000:397-412 | unchanged |
| 83 | B-C37 | Task priority / due | C | C | 149000:55-80 | unchanged |
| 84 | B-C38 | Staffed day / Friday-before | CDA | CDA | 141000:104-158 | unchanged |
| 85 | B-C39 | Release-mode gating for R1 commands | RG | C | 141000:410-423 gate; RELEASE_MODE_SET co:197-273 (reason, version, planned mode, FN-01 dependency, one audit event); direct writes revoked co:276-278; UI release/page.tsx, release-actions.tsx:29,78; s0co:53-94 | reclassified from RG: the baseline gap (no audited switch/UI) is closed. Every function is still Disabled - that is the go-live switch, which per convention never downgrades a row |
| 86 | B-C40 | Staff-facing result/error wording | CDA | CDA | 220:55-57, :462-475; 210:702-720; r1p0:246 | unchanged; grants fixed |
| 87 | B-C43 | MOVE_JOB | C | C | 146000:1099; move-job.tsx:239; t_s10_s11 MOVE_JOB | unchanged; the uncertainty was only "other auditor's row" (C-13 = COMPLETE); needs 164000 on hosted for the preview |
| 88 | B-C44 | Job-level CALL_RECORD | C | C | 210:69-71, :304-330, :338+; UI LogJobCall ops-tab:300; t_r1_completion:272-324; r1p0:223-225 | unchanged; deviation: completion/customer flags refused without a call task |
| 89 | B-C45 | COMMISSIONING_RECORD | C | C | 210:50-67, :229-232; 220:63-167; UI RecordCommissioning ops-tab:218 (Job evidence context, actions.tsx:101-102); t_r1_completion:86-218; r1p0:281-386 | unchanged; deviation: supersede-row instead of update in place; foreign-linked file refused |
| 90 | C-1 | INS01–04 installer call schedules | CDA | CDA | 146000:245; r1p0 "scheduler raises INS01" | unchanged; cron presence on hosted is U (#121) |
| 91 | C-2 | Customer call schedule | CDA | CDA | 146000:281; r1p0 "INS04 raised by the scheduler" | unchanged |
| 92 | C-3 | Missing-commissioning reminder (INS02) | CDA | CDA | 146000:310 | unchanged; inert in R1 (no actual_end) in both systems |
| 93 | C-4 | CALL_RECORD task-level | C | C | 210:338-470 (task path preserved); r1p0 INS01/INS04 | unchanged; spot-checked; REM01 due still from now() (210:134) |
| 94 | C-5 | Job-level call | C | C | = #88 | unchanged; duplicate |
| 95 | C-6 | Call side effects (issue, REM01, complaint) | C | C | 210:~440-470 | unchanged |
| 96 | C-7 | ISSUE_CREATE | C | C | unchanged + Issues queue issues/page.tsx:52,183 | — |
| 97 | C-8 | ISSUE_UPDATE (reassign / resolve / close) | C | C | unchanged + read_issues co:36-113 (resolve/close/reassign flags), issue files linked co:135-151; UI issues/page.tsx:183 IssueActions; s0co:171-187 | cross-job queue added |
| 98 | C-9 | Operational completion evaluation | C | C | 146000:730; JOB_OPERATIONS completion gate | unchanged |
| 99 | C-10 | OPERATIONAL_COMPLETE | C | C | UI CompleteJob actions.tsx:321, ops-tab:141; r1p0 "OPERATIONAL_COMPLETE from Booked" | unchanged; FN-19; the Electrical path is now open via #89; the extra build_invoice_stages side effect remains |
| 100 | C-11 | COMMISSIONING_RECORD | C | C | = #89 | unchanged; duplicate |
| 101 | C-12 | PLANNER_UPDATE | C | C | UI ChangeDates actions.tsx:349, ops-tab:220; r1p0 "planner/date change…" | unchanged |
| 102 | C-13 | MOVE_JOB | C | C | move-job.tsx:239; t_s10_s11 | unchanged; spot-checked, unchanged |
| 103 | C-14 | CHANGE_INSTALLER (R1) | C | C | UI ChangeInstaller actions.tsx:391, ops-tab:221; r1p0 "installer replacement (with stale-version refusal)" | unchanged; first assignment after Booked has no path (the reference neither; R2 PLAN_WORK_PACKAGE, FN-02) |
| 104 | C-18 | Person / capacity / leave / skill validation | C | C | 146000:972-1008 | unchanged |
| 105 | C-19 | PLANNER_3/6_WEEKS | C | C | 149000:981 | unchanged |
| 106 | C-21 | Calendar capture (R1) | CDA | CDA | 146000:883-937 | unchanged; Postgres is the truth; no sender |
| 107 | C-23 | Cancellation preview | C | C | cancel-job.tsx:16 → server/cancellation.ts:33 `cancellation_preview`; t_s15 | unchanged |
| 108 | C-24 | CANCEL_JOB | C | C | UI CancelJob cancel-job.tsx:63, ops-tab:436; r1p0 "R1 cancellation…from Prebooking/ReadyToBook/Booked" | unchanged; FN-17 + FN-20 Manual |
| 109 | C-25 | CANCELLATION_RESOLVE | C | C | 220:357-456 flags; UI cancellation-work.tsx:24, ops-tab:374; r1p0 (×2) | unchanged; GHL tasks unresolvable until GHL ids are configured (flagged) |
| 110 | C-26 | CANCELLATION_CLOSE | C | C | cancellation-work.tsx:99, ops-tab:388; r1p0 | unchanged |
| 111 | C-27 | REINSTATE_JOB | C | C | actions.tsx:462, ops-tab:401; r1p0 | unchanged |
| 112 | C-28 | REOPEN_REVIEW_COMPLETE | C | C | cancellation-work.tsx:156, ops-tab:425; r1p0 | unchanged |
| 113 | C-29 | S15 guard on normal work | C | C | 141000:489; JOB_OPERATIONS STAGE_NOT_CANCELLED | unchanged; spot-checked |
| 114 | C-36 | OPERATIONAL_QUEUE | C | C | 149000:555-583 | unchanged |
| 115 | C-39 | pg_cron presence (INS generators) | U | U | readiness Scheduler item co:309-319; HOSTED_MIGRATION_PLAN.md:17 | as #28 |
| 116 | E-R-12 | COMMISSIONING_RECORD | C | C | = #89 | unchanged; duplicate |
| 117 | E-R-18 | Drive resolve → Storage upload | CDA | CDA | 183; evidence-field upload with retry | unchanged; real-browser upload/retry/replace reported verified on an isolated stack |
| 118 | E-R-19 | Viewing / opening files | CDA | CDA | 183 + search_evidence co:743-819; UI /dashboard/files (files-library.tsx), grouped job Files tab; SimpleBot list_job_files/search_files (tools/files.ts); s0co:189-213 | Files library added |
| 119 | E-F-01 | Invoice stages | CDA | CDA | 143000:528 | unchanged |
| 120 | E-F-02 | Deposit confirmation | CDA | CDA | PRE03 path | unchanged |
| 121 | E-N-01 | OutboundGuard | CDA | CDA | 164000:541 | unchanged |

The 10 rows excluded from the denominator are unchanged from the baseline: A08, A14, A19, B06, C13, B-C06, B-C20, B-C23, E-B-01, E-B-02.

## 4. Remaining gaps

**PARTIAL (7):**

| # | Row | Exact gap |
|---|---|---|
| 4 | A04 Login provisioning | The audit write in `src/features/people/server/invite-staff.ts:88-95` runs after the Auth invite, through the service role. It is not transactional and its result is not checked. No test covers the invite flow itself; only the preview write-block is tested. |
| 12 | A15 Authorization matrix | `public.submit_presale` (090000/120000) has no FN-01 / `mode_available` check; the reference SOLD_INTAKE had one. A sale can be captured while every function is Disabled. Needs an owner decision: gate it, or record that sale capture is deliberately ungated. |
| 27 | A-C04 OutboundGuard | The email recipient allow-list (164000:528-577) is advisory. There is no email outbox type and no sender. The runbook (§8) confirms the app sends no customer or merchant email. |
| 33 | A-C10 Resilience review queue | `public.resilience_review_queue()` is not referenced anywhere in `src`. System health shows only outbox Uncertain (SYSTEM_STATUS) and calendar NeedsReview. Communications Uncertain/Failed and stalled Processing rows are invisible. |
| 43 | A-F04 ACTION_AVAILABILITY | The job-level read (220:304) is still callable and stale: it offers completion only in InProgress/Aftercare. It is unused by the UI (JOB_OPERATIONS replaces it). Task-level availability is consumed via TASK_DETAIL. Fix: retire or correct the read. |
| 46 | A-G04 Release acceptance evaluator | There is an R1 verdict only. Missing: an R2–R4 verdict; data invariants (duplicate jobs or customers, stuck tasks, stock ledger vs balances); an in-app record of the manual checklist and sign-off. |
| 47 | A-G05 S19 cutover | Details below. |

**A-G05 in detail:**
- **What the reference S19 actually was.** `S19Migration.js` is not an importer. It is a DEV-only plan evaluator: migration inventory, creator map, training plan, cutover plan, S20 hand-off. Every MIG row is NOT_RUN or BLOCKED. So "no importer" is not a gap. The runbook's premise is also correct that the Sheets/AppSheet system never ran live, so there is nothing to import from it.
- **Why PARTIAL, not OBS or CDA.** The reference plan also targets the business's *current* process: open jobs in Jotform/Calendar/Trello (MIG-R1-01..06, CUT-R1-02 "Reconcile open job IDs, stages, tasks") and CUT-R1-03 "Freeze current Jotform→Calendar creator" (no dual creator). `docs/R1_PILOT_RUNBOOK.md` does not mention either. It also has no training plan (TRN-R1-01..15); the 85 help articles are material, not a plan.
- **What would make it CDA.** Add three runbook steps:
  - a recorded decision for existing jobs (e.g. "pilot = new sales only; existing jobs finish in the current process")
  - a step to stop the Jotform→Calendar creator for pilot jobs
  - a training checklist per person
- **Doc drift.** The runbook cites `docs/FINAL_CONVERGENCE_REPORT.md` and (via HOSTED_MIGRATION_PLAN) `FINAL_ROUTE_ACCEPTANCE.md`. Neither file exists in `docs/`. The plan also says the repo has 46 migrations; there are now 47.

**MISSING:** none.

**UNCERTAIN (4)**, all external facts the repo cannot prove:

| # | Row | Why |
|---|---|---|
| 28 | A-C05 pg_cron | `docs/HOSTED_MIGRATION_PLAN.md:17` reports `ss-resilience-sweep`, `ss-s10-schedules` and `ss-system-tasks` active on hosted (read-only inspection), but I cannot verify it. It becomes CDA when the readiness item "Background schedules" reads Pass on hosted after the push. |
| 36 | A-D01 Data backup | Hosted PITR and retention are unverified. The readiness backup items read Unknown until a person records evidence. |
| 49 | A-G07 Ownership | Company ownership of Supabase, Vercel and the keys. |
| 115 | C-39 pg_cron for INS | Same as #28. |

**RELEASE-GATED (7):** A-C06, A-C07, A-C08, A-C09, A-C11, A-C12, A-D02. All are FN-14 or FN-16.

**Other residuals worth tracking (not class-changing):**
- The Intake review queue has no "done" state, so items stay listed forever (B-C32).
- The readiness evaluator is advisory: RELEASE_MODE_SET does not refuse when readiness is not Ready. The runbook §9 asks for exceptions in the reason.
- B-C16 PRE05 is still labelled "(optional)" in the UI.
- REM01 due is still computed from now().
- SYSTEM_STATUS still shows commit_journal counts.

## 5. R2 / R3 / R4 (release-level summary, not re-audited row by row)

The baseline counts were R2 = 66, R3 = 17, R4 = 17 rows. All their functions ship Disabled; `RELEASE_MODE_SET` can only enable a function in its planned mode, and only after FN-01.

**R2 (~66 rows; FN-02 Calendar, FN-03 Orders, FN-04 Scaffold, FN-05 Stock):**
- **Backend implemented:**
  - 161000 materials/ordering: MATERIAL_ADD, ORDERS_BUILD/SEND/CONFIRM/REVISE/CANCEL, MERCHANT_WEEKLY_LIST
  - 162000 stock: goods-in, quarantine, opening count, reserve/pick/issue, stocktakes
  - 163000 scaffold: request → erect → strip lifecycle, chase, complaints, weekly list
  - 164000 outbox protocol, calendar service, resource planning, PLAN_WORK_PACKAGE, MOVE_WORK_PACKAGE, CHANGE_INSTALLER_R2
  - list reads in 172000/173000
- **UI built:**
  - /dashboard/materials, /orders, /goods-in, /stock, /scaffold, /availability, /skills
  - planner and team planner
  - calendar review on System health
  - optional evidence upload on scaffold and order confirm
  - every R2 command above is wired from `src`
- **Release-gated:** FN-02..05.
- **External integrations missing:**
  - There is no outbox worker or sender in `src`. Calendar rows are captured only; there is no Google Calendar client.
  - There is no merchant or scaffolder email sender.
- **Verdict:** backend implemented, UI built, release-gated, senders missing.

**R3 (~17 rows; FN-06 installer app, FN-07 commissioning review, FN-08 handover):**
- **Backend implemented (165000):** IW_START, IW_PROGRESS, IW_REPORT_*, commissioning draft/submit, COMMISSIONING_REVIEW, HANDOVER_CREATE, and the INSTALLER_WORKFLOW / MY_WORK / HANDOVER_READINESS reads.
- **UI built:** /dashboard/installs (installer workflow), /dashboard/commissioning (queue and review), handover create/readiness.
- **Release-gated:** FN-06..08.
- **Blocking gaps:**
  - No commissioning templates or questions are seeded ("BLOCKED - INPUT REQUIRED" in the reference too).
  - There is no template admin UI. Until templates are configured, answers are refused and a review can only Return, never Accept.
  - There is no offline mode (reference TRN-R3-02).
  - There is no handover pack generation or sending.
- **Verdict:** backend and UI built, release-gated, blocked on configuration content.

**R4 (~17 rows; FN-09 invoices/Xero, FN-10 Phoenix, FN-12 accounting/reporting, FN-13 archive):**
- **Backend partly implemented (166000):**
  - Xero invoice intents (capture only)
  - payment callback and reconciliation, XERO_REVIEW_CANCEL_INVOICE
  - S13 interim chase and GHL progression milestones (pg_cron `ss-s13-milestones`)
  - FINANCE_SUMMARY / INVOICE_STATUS / PAYMENT_RECONCILIATION reads
  - REPORT_SNAPSHOT_CREATE, ARCHIVE_ELIGIBILITY / ARCHIVE_JOB / REOPEN_ARCHIVED_JOB
- **Not ported:** Phoenix FN-10 (no reference logic), the accounting_events writer, job costs (summary only).
- **UI:** none. No R4 command or read is referenced from `src`.
- **Release-gated:** FN-09, 10, 12, 13.
- **External integrations missing:** no Xero client or worker (dispatch needs setting `xero.mode = LIVE` plus a sender that does not exist).
- **Verdict:** backend largely implemented, no UI, release-gated, Xero integration missing.

FN-11 (GHL) is R1 Manual: human tasks only, ids NOT_CONFIGURED. FN-21 (Forms) is outside R1–R4 and Disabled.

## 6. Apps Script runtime dependencies

The search covered `src`, `supabase/migrations` and `scripts`, excluding the generated `src/types/database.ts`. Patterns: `SpreadsheetApp|DriveApp|CalendarApp|GmailApp|ScriptApp|PropertiesService|LINKTOFORM|USEREMAIL|AppSheet|script.google.com|getRange|getLastRow|getSheetByName|UrlFetchApp|LockService|CacheService|MailApp|Utilities.`, plus the Sheets row-number and Drive patterns `sheet_row|rowIndex|spreadsheet|docs.google|sheets.google|drive_file_id|gapi`.

- **Runtime hits: 0.**
- **Comment hits: 16.** All are SQL `--` or TS `//` comments that name what was replaced:
  - `requests/page.tsx:27`
  - 090000:15-16
  - 144000:18
  - 149000:20-21, :745, :1183
  - 170000:17, :25
  - 171000:7
  - 172000:4
  - 173000:5, :8
  - identity_foundation:6, :14
  - one extra: 105000:98 "Reference: drive_file_id" (comment; the column is a Storage path)
- `package.json` has no Google, AppSheet or clasp dependency.
- The only `googleapis.com` URL is the Gemini endpoint used by SimpleBot (`src/features/assistant/server/providers/gemini.ts:15`), which is not Apps Script.

**Result:** no runtime dependency on Apps Script, AppSheet, Sheets, Drive, Gmail or Calendar APIs. The reference archive is semantic source only.
