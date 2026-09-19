# R1 backend parity: AFTER the P0 integration

**Date:** 2026-09-19. Read-only audit of the integrated code (row classifications by the auditor; verification notes below updated by the integrator after the commits and test runs).

**Scope:**
- **New stack:** `/Users/lennybeadle/simple-solar-p0-r1-integration`, branch `feature/p0-r1-integration`, HEAD `b6f307d`.
  - The integration layer the audit assessed is committed as `7487e95`..`231d101` (branch head `231d101`, pushed).
- **Reference:** `/Users/lennybeadle/:reference` @ `c4f56ea`, read with `git show`.
- **Baseline:** `…/3949a873-…/scratchpad/backend-parity-report/REPORT.md` plus appendices A–G.

## 1. Method and denominator reconciliation

**How the baseline reached 121.** The baseline's "R1 121" is not a list of 121 rows. It is the 131 R1-tagged matrix rows in appendices A–E, minus the 10 rows classified INTENTIONALLY OBSOLETE (REPORT §19: "Denominator (excl. obsolete)").

I rebuilt the R1 set from each appendix's release tag and checked it against the baseline totals (REPORT §5 R1 row: 37 / 38 / 22 / 7 / 10 / 12 / 5):

| Appendix | R1 rows | Tags counted as R1 | Tags excluded |
|---|---|---|---|
| A | 55 | R1, "R1 (FN-14)", "R1 foundation", R1/R2 (A10), R1–R4 (G04–G06) | platform "—"/"all": A09, A21, G03, E01, E02. R2: A16, C01, C02, C03 |
| B | 42 | all except | C08 (R4); C41, C42 (platform) |
| C | 26 | #1–14, 18, 19, 21, 23–29, 36, 39 | R2: 15, 16, 17, 20, 22, 38. R3: 35. R4: 32–34. Platform: 30, 31, 37 |
| D | 0 | (every D row is R2) | — |
| E | 8 | R-12, R-18, R-19, F-01, F-02, B-01, B-02, N-01 | the appendix's own "By release tag" line |
| **Total** | **131** | | |

**Check against the baseline.** Per-class sums of the rebuilt set match the baseline exactly: C 37, CDA 38, P 22, RG 7, OBS 10, MISS 12, UNC 5 = 131. Taking out the 10 OBS rows (A08, A14, A19, B06, C13, B-C06, B-C20, B-C23, E-B-01, E-B-02) leaves **121**. The same method also reproduces the baseline's R2 = 66, R3 = 17, R4 = 17 and platform = 11, which cross-checks the release assignment.

**Notes on the baseline itself:**
- **Duplicates inside the 121** (the baseline flagged these as ~5 overstated): COMMISSIONING_RECORD (B-C45, C-11, E-R-12), job-level call (B-C44, C-5), MOVE_JOB (B-C43, C-13), evidence (B-C19, E-R-18, E-R-19), DEPOSIT_CONFIRM (B-C29, E-F-02), OutboundGuard (A-C04, E-N-01). Kept as-is so the denominator is unchanged.
- **A03 inconsistency:** REPORT §5 calls A03 "PARTIAL", but the appendix row and the counts use COMPLETE — DIFFERENT ARCHITECTURE. I follow the counted value.
- **No baseline row covers InProgress/Aftercare stage transitions**, so the verified "obsolete for R1" finding changes no row.
- The 10 obsolete rows stay out of the denominator, as in the baseline, and are listed at the end for transparency. No row changed to or from OBSOLETE.

**Release-gating convention.** I followed the baseline's convention (REPORT §5 notes; App. B §6):
- FN-01 is treated as the go-live switch and **does not** downgrade a row.
- RELEASE-GATED was used only for the rows the baseline already treated that way: FN-14/FN-16 health and resilience rows, and B-C39, the gating mechanism itself.
- A row whose only blocker is FN-14/15/16/17/19/20 being Disabled was classified on implementation completeness plus UI.
- The global release gate is reported separately in §5(c).

**What I verified, and what I could not:**
- **Verified in code** (migrations, handlers, UI wiring, test source, reference at `c4f56ea`): every claim in the brief.
- **Test status (integrator, final code `231d101`):** the auditor did not run tests; the integrator ran them on an isolated local stack after a fresh replay of all 40 migrations: real Postgres + Storage 108/108 (including `tests/r1-p0-integration.test.mjs`), PGlite 22/22, unit 320 passed / 1 skipped, typecheck and lint (0 errors) clean, `next build` passes. `src/types/database.ts` is generated (`supabase gen types`), not hand-edited.
- **Browser (integrator):** PRE01-PRE04, BKG01-03, Confirm booking, INS01/INS04 calls, Operations tab (commissioning upload, issues, job call, completion), the full cancellation lifecycle and Director System Health were clicked through in Chrome on the isolated stack.

## 2. Summary: BEFORE vs AFTER (121 R1 capabilities)

| Classification | BEFORE | AFTER | Δ |
|---|---|---|---|
| COMPLETE | 37 | 54 | +17 |
| COMPLETE — DIFFERENT ARCHITECTURE | 38 | 42 | +4 |
| PARTIAL | 22 | 9 | −13 |
| RELEASE-GATED | 7 | 8 | +1 |
| MISSING | 12 | 4 | −8 |
| UNCERTAIN | 5 | 4 | −1 |
| INTENTIONALLY OBSOLETE (inside the 121) | 0 | 0 | 0 |
| **Total** | **121** | **121** | |
| **R1 complete (C + CDA)** | **75 / 121 = 62.0%** | **96 / 121 = 79.3%** | +21 |
| R1 implemented (C + CDA + RG) | 82 / 121 = 67.8% | 104 / 121 = 86.0% | +22 |
| Live today | 0 (FN-01 Disabled) | 0 (FN-01 Disabled) | — |

**Rows that changed (26):**

| Change | Rows |
|---|---|
| PARTIAL → COMPLETE (11) | C-7, C-8, C-10, C-12, C-14, C-23, C-24, C-25, C-26, C-27, C-28 |
| MISSING → COMPLETE (5) | B-C44, B-C45, C-5, C-11, E-R-12 |
| UNCERTAIN → COMPLETE (1) | B-C43 |
| PARTIAL → COMPLETE — DIFFERENT ARCHITECTURE (3) | A-B07, A-F01, B-C19 |
| MISSING → COMPLETE — DIFFERENT ARCHITECTURE (1) | E-R-19 |
| MISSING → RELEASE-GATED (1) | A-D02 |
| MISSING → PARTIAL (1) | A-G04 |

- **No regressions found.** B10 and C40 (staff-facing wording) were silently broken for signed-in staff from `20260919167000` until `220000`, which was already true at baseline time. That is now fixed and tested (`r1-p0-integration.test.mjs:246-247`).
- **Improved but still in the same class:** A-A15, A-B11, A-C05, A-C06, A-D01, A-E02 (now audited), B-C11, B-C13, B-C18.

## 3. Full 121-row appendix

Key:
- **Class codes:** C = COMPLETE, CDA = COMPLETE — DIFFERENT ARCHITECTURE, P = PARTIAL, RG = RELEASE-GATED, M = MISSING, U = UNCERTAIN.
- **Migration short names:** 183 = `20260919183000_p0_evidence.sql`, 202 = `…202000_p0_audit_integrity.sql`, 2021 = `…202100_p0_operational_health.sql`, 210 = `…210000_r1_completion.sql`, 220 = `…220000_p0_r1_integration.sql`.
- **Test short names:** r1p0 = `tests/r1-p0-integration.test.mjs`, se = `tests/storage-evidence.test.mjs`, pah = `tests/p0-audit-health.test.mjs`.
- **UI short name:** ops-tab = `src/features/jobs/components/operations/operations-tab.tsx`, mounted at `src/app/dashboard/jobs/[jobId]/page.tsx:135`.

| # | area | capability | BEFORE | AFTER | evidence | note |
|---|---|---|---|---|---|---|
| 1 | Identity (A01) | Staff directory (People) | CDA | CDA | 120000:62-91; 00-identity.test.mjs | unchanged |
| 2 | Identity (A02) | Staff/role administration | P | P | no command/UI; people/auth unchanged since 685039d | people/person_roles edits are row-audited; still no admin command or UI |
| 3 | Identity (A03) | Auth identity → person linkage | CDA | CDA | 120000:357-382; 00-identity.test.mjs | hosted sign-up/confirm settings still unverified |
| 4 | Identity (A04) | Login provisioning (invite-only) | P | P | invite-staff.ts unchanged | audit insert still non-atomic/unchecked; no test |
| 5 | Identity (A05) | Actor resolution, fail closed | CDA | CDA | 141000:326-354; t_s17 | — |
| 6 | Identity (A06) | Role vocabulary + PersonRoles | C | C | 120000; roles now row-audited (202 audit_required) | improved |
| 7 | Identity (A07) | Role classes | C | C | 141000:369-383 | — |
| 8 | Identity (A10) | Skills (installer-only) | C | C | 164000 RP_SET_SKILL; skills row-audited (202) | — |
| 9 | Identity (A11) | Deactivation immediate | C | C | 00-identity.test.mjs; se "an inactive person opens nothing" | extended to evidence reads |
| 10 | Identity (A12) | Job access rule for commands | C | C | 141000:429-475; r1p0 "wrong role, wrong job access…" | spot-checked: JOB_ACCESS_DENIED on job-level call |
| 11 | Identity (A13) | Read visibility + redaction | CDA | CDA | 170000; list_evidence/evidence_open 183 | — |
| 12 | Identity (A15) | R1 command authorization matrix | P | P | 210:241-330 (job-level CALL_RECORD, COMMISSIONING_RECORD added) | remaining gap: `submit_presale` still has no FN-01 check (no recorded owner decision) |
| 13 | Identity (A17) | Read boundary | CDA | CDA | 149000; 220:213-354 | SYSTEM_STATUS adds Director |
| 14 | Identity (A18) | Identity probe (WHO_AM_I) | CDA | CDA | 220:247-265 | — |
| 15 | Identity (A20) | Client uncertain-outcome controller | CDA | CDA | use-command.ts | — |
| 16 | Core (B01) | Command envelope | CDA | CDA | 141000:907-977 | — |
| 17 | Core (B02) | Idempotency / conflict | CDA | CDA | r1p0 "duplicate command id" (replay) | — |
| 18 | Core (B03) | Payload allow-list | C | C | app.payload; 210/220 handlers use it | — |
| 19 | Core (B04) | expected_version | CDA | CDA | COMMISSIONING_RECORD uses WP version (220:111); job-level call uses job version | — |
| 20 | Core (B05) | Locking / concurrency | CDA | CDA | FOR UPDATE in 220:97-101 | — |
| 21 | Core (B07) | Append-only audit | P | CDA | 202:99-146 (26 required tables), app.audit_coverage 202:213; pah "direct Admin edit… audited", "switching a release function is audited"; t_p0_audit | 36 operational tables deliberately semantic-audited only (no body leakage) |
| 22 | Core (B08) | Task creation dedup + task events | CDA | CDA | 141000:648-709 | — |
| 23 | Core (B09) | Clock / London calendar | CDA | CDA | 141000:89-174 | — |
| 24 | Core (B10) | Failure categories → staff wording | CDA | CDA | 220:55-57 grants; r1p0:246-247 | latent break since 167000 fixed |
| 25 | Core (B11) | Versioned settings | CDA | CDA | settings INSERT audited again (202:131) | improved |
| 26 | Core (B12) | Server boundary / no client service role | CDA | CDA | /api/evidence and /api/health use session/anon only | — |
| 27 | Ops infra (C04) | OutboundGuard allow-list | P | P | 164000:528-577 | no email path; guard advisory for a future worker |
| 28 | Ops infra (C05) | Scheduled work (pg_cron) | U | U | 150000:84-109; app.sweep_schedule 2021:303-320 | now detectable in System Health; hosted pg_cron still unverified |
| 29 | Ops infra (C06) | System health evaluation + record | RG | RG | 2021 app.operational_health / health_status; System Health UI system/page.tsx:176-194; t_p0_health | FN-14 Disabled |
| 30 | Ops infra (C07) | Processing heartbeats | RG | RG | 148000; Scheduler item 2021:405 | FN-14; no hourly tick (C13 obsolete) |
| 31 | Ops infra (C08) | Integration health checks | RG | RG | 148000:129-179 | no caller (no worker) |
| 32 | Ops infra (C09) | Daily system tasks SYS01/02 | RG | RG | 148000:449-510 | FN-16 |
| 33 | Ops infra (C10) | Resilience review queue read | P | P | resilience_review_queue() still not called from src | comms Uncertain/Failed and stalled rows not shown |
| 34 | Ops infra (C11) | Sweep RS-REVIEW / RS-ALERT | RG | RG | 148000 | FN-14 |
| 35 | Ops infra (C12) | OUTBOX_RESOLVE | RG | RG | system-actions.tsx | FN-14 |
| 36 | Backup (D01) | Data backup | U | U | 2021 header: platform backups outside app; state Unknown until evidence | hosted plan/PITR still unverified |
| 37 | Backup (D02) | Backup verify / restore rehearsal / status | M | RG | OPS_EVIDENCE_RECORD 2021:192-221; evidence_state Verified/Stale/Failed/Unknown 2021:~260; UI system-actions.tsx:92-108; pah "a Director records a verified backup…"; r1p0 "System Health for Director" | FN-14; human-recorded evidence, not an automated verifier (docs/OPERATIONAL_HEALTH.md §4) |
| 38 | Release (E03) | Release-mode status read | C | C | execute_read RELEASE_MODE_STATUS 220:314-318; system/page.tsx:83 | spot-checked, unchanged |
| 39 | Release (E04) | Mode-consistency health check | P | P | 2021:411-433 (FN-13/14/16 only) | "Manual set to Automated" and target_release checks still absent |
| 40 | Reads (F01) | SYSTEM_STATUS | P | CDA | 2021:525+ (Drive placeholders → evidence; latest S16-system check; operational items); 220:320-325 Director; r1p0:534-535 | residual: `commit_journal` counts still shown (always 0) |
| 41 | Reads (F02) | AUDIT_HISTORY per job | C | C | job-sections.tsx; r1p0 "audit: …no file paths or URLs" | spot-checked |
| 42 | Reads (F03) | Office reads | CDA | CDA | 149000/170000 | — |
| 43 | Reads (F04) | ACTION_AVAILABILITY / TASK_ACTION_AVAILABILITY | P | P | still only type decls (models.ts:377) | job-level R1 flags now come from JOB_OPERATIONS (210:490-650); these reads remain unused and stale (offer completion only in InProgress/Aftercare) |
| 44 | Tooling (G01) | Schema provisioning + config seed | CDA | CDA | migrations chain | hosted: 160000+ (incl. every P0 migration) not applied per docs/backend-port.md:51-52 |
| 45 | Tooling (G02) | Staff import | CDA | CDA | seeds/001 | — |
| 46 | Tooling (G04) | Release acceptance evaluator | M | P | audit_coverage, operational_health (backup, drill, scheduler, release functions, audit) | no R1..R4 verdict, no data invariants, no manual checklist |
| 47 | Tooling (G05) | Migration / cutover (S19) | M | M | none | in-flight job import + no-dual-creator plan still absent |
| 48 | Tooling (G06) | Release plan evaluation / config contract | M | M | none | — |
| 49 | Tooling (G07) | Ownership / entitlement registers | U | U | none | — |
| 50 | Tooling (G08) | Negative security suite | CDA | CDA | 00-identity.test.mjs; se "knowing the path gains…nothing" | extended |
| 51 | Presale (B-C01) | Sold intake → customer + job + presale | CDA | CDA | 120000:1017-1220; r1p0 "Job Sold creates PRE01-PRE04" | not FN-01 gated (see #12) |
| 52 | Presale (B-C02) | Finance routes → PRE sets | C | C | 143000:353-375 | Phoenix→ReadyToBook still untested |
| 53 | Presale (B-C03) | Human Job ID | C | C | 120000:857-877 | — |
| 54 | Presale (B-C04) | Immutable presale snapshot | CDA | CDA | 120000:600-627 | — |
| 55 | Presale (B-C05) | PRE01–05 generation + assignment | CDA | CDA | seeds/002; r1p0 "explicit owners" | hosted legacy_id seeds unverified |
| 56 | Presale (B-C07) | Invoice stages at sale | C | C | 143000:528-585 | — |
| 57 | Presale (B-C09) | Sold idempotency / conflict | CDA | CDA | job-sold.test.mjs | — |
| 58 | Presale (B-C10) | Never merge customers | C | C | 145000:559-576 | — |
| 59 | Tasks (B-C11) | TASK_COMPLETE | C | C | 144000; evidence via app.evidence_attach (183:616); r1p0 PRE flow | spot-checked: only registered uploads accepted when Storage exists |
| 60 | Tasks (B-C12) | PRE01 invoice sent / failed | C | C | 144000:285-300 | — |
| 61 | Tasks (B-C13) | PRE02 contract + evidence | C | C | r1p0 "PRE02 (+ contract upload)"; se "a file of job A cannot complete a task of job B" | improved |
| 62 | Tasks (B-C14) | PRE03 bank check | C | C | t_prebooking | NotReceived still untested |
| 63 | Tasks (B-C15) | PRE04 verification | C | C | t_prebooking | — |
| 64 | Tasks (B-C16) | PRE05 finance agreement | C | C | 144000:426-433 | UX: still labelled "(optional)" (task-actions.tsx:366) though the gate requires it |
| 65 | Tasks (B-C17) | TASK_REOPEN | C | C | 144000:471-502 | — |
| 66 | Tasks (B-C18) | TASK_EVIDENCE_ATTACH | C | C | 220:483-534; r1p0 (2 uses) | audit reason no longer carries the storage path; Repair mode still untested |
| 67 | Evidence (B-C19) | Evidence rows + storage + cross-job protection | P | CDA | 183 (evidence_upload_begin :351, _complete :529, policies :956-958, bucket limits :949-950); se "nobody writes to a path…", "a file of job A…"; t_evidence | DB-registered uploads replace path parsing |
| 68 | Tasks (B-C21) | Owner/backup/admin authz | C | C | 141000:789-879 | — |
| 69 | Tasks (B-C22) | Task reassignment | M | M | none | the reference never had a general command (candidate for an owner decision) |
| 70 | Tasks (B-C24) | Task history + audit | C | C | task_events immutable; tasks audited (202) | — |
| 71 | Tasks (B-C25) | Task dependencies via gates | CDA | CDA | 143000 | — |
| 72 | Booking (B-C26) | ReadyToBook evaluation | C | C | r1p0 "…-> ReadyToBook" | — |
| 73 | Booking (B-C27) | Booking gates evaluation | C | C | 143000:213-299 | — |
| 74 | Booking (B-C28) | BOOKING_GATES command | CDA | CDA | r1p0 (BOOKING_GATES ×2) | — |
| 75 | Booking (B-C29) | DEPOSIT_CONFIRM legacy route | P | P | label only (requests/page.tsx:34) | no UI; happy path untested; business need covered by PRE03 |
| 76 | Booking (B-C30) | BOOKING_INTAKE | CDA | CDA | 145000; r1p0 "booking -> Booked; first installers allocated by the booking form fields" | first installer assignment is via the booking form |
| 77 | Booking (B-C31) | Booking queue / board / form reads | C | C | 171000 | — |
| 78 | Booking (B-C32) | Intake Review resolution | M | M | intake/page.tsx:36 | also absent in the reference |
| 79 | Booking (B-C33) | ReadyToBook → BookingInProgress | C | C | 145000:816 | — |
| 80 | Booking (B-C34) | CONFIRM_BOOKING | C | C | r1p0 (CONFIRM_BOOKING ×2) | refusal paths still thinly tested |
| 81 | Booking (B-C35) | BKG01–05 generation | CDA | CDA | 143000:377-395 | — |
| 82 | Booking (B-C36) | FIN01 / unpaid interim | C | C | 143000:397-412 | — |
| 83 | Booking (B-C37) | Task priority / due | C | C | 149000:55-80 | — |
| 84 | Booking (B-C38) | Staffed day / Friday-before | CDA | CDA | 141000:104-158 | — |
| 85 | Release (B-C39) | Release-mode gating for R1 commands | RG | RG | 141000:410-423; r1p0 "disabled release mode" | no audited switch/UI; direct UPDATE is now row-audited (pah) |
| 86 | UX (B-C40) | Staff-facing result/error wording | CDA | CDA | 220:55-57, :462-475; 210:702-720; r1p0:246 | grants fixed |
| 87 | Planner (B-C43) | MOVE_JOB | U | C | 146000:1099; move-job.tsx:239; t_s10_s11 MOVE_JOB | the uncertainty was only "other auditor's row" (C-13 = COMPLETE); needs 164000 on hosted for the preview |
| 88 | Ops (B-C44) | Job-level CALL_RECORD | M | C | 210:69-71, :304-330, :338+; UI LogJobCall ops-tab:300; t_r1_completion:272-324; r1p0:223-225 | deviation: completion/customer flags refused without a call task |
| 89 | Commissioning (B-C45) | COMMISSIONING_RECORD | M | C | 210:50-67, :229-232; 220:63-167; UI RecordCommissioning ops-tab:218 (Job evidence context, actions.tsx:101-102); t_r1_completion:86-218; r1p0:281-386 | deviation: supersede-row instead of update in place; foreign-linked file refused |
| 90 | Ops (C-1) | INS01–04 installer call schedules | CDA | CDA | 146000:245; r1p0 "scheduler raises INS01" | cron presence on hosted is U (#121) |
| 91 | Ops (C-2) | Customer call schedule | CDA | CDA | 146000:281; r1p0 "INS04 raised by the scheduler" | — |
| 92 | Ops (C-3) | Missing-commissioning reminder (INS02) | CDA | CDA | 146000:310 | inert in R1 (no actual_end) in both systems |
| 93 | Ops (C-4) | CALL_RECORD task-level | C | C | 210:338-470 (task path preserved); r1p0 INS01/INS04 | spot-checked; REM01 due still from now() (210:134) |
| 94 | Ops (C-5) | Job-level call | M | C | = #88 | duplicate |
| 95 | Ops (C-6) | Call side effects (issue, REM01, complaint) | C | C | 210:~440-470 | — |
| 96 | Ops (C-7) | ISSUE_CREATE | P | C | UI RaiseIssue actions.tsx:198, ops-tab:243; t_s10_s11; r1p0 (ISSUE_CREATE ×2) | — |
| 97 | Ops (C-8) | ISSUE_UPDATE (reassign / resolve / close) | P | C | UI IssueActions actions.tsx:265, ops-tab:284; r1p0 "blocking issue holds Electrical completion until resolved and closed" | — |
| 98 | Ops (C-9) | Operational completion evaluation | C | C | 146000:730; JOB_OPERATIONS completion gate | — |
| 99 | Ops (C-10) | OPERATIONAL_COMPLETE | P | C | UI CompleteJob actions.tsx:321, ops-tab:141; r1p0 "OPERATIONAL_COMPLETE from Booked" | FN-19; the Electrical path is now open via #89; the extra build_invoice_stages side effect remains |
| 100 | Commissioning (C-11) | COMMISSIONING_RECORD | M | C | = #89 | duplicate |
| 101 | Planner (C-12) | PLANNER_UPDATE | P | C | UI ChangeDates actions.tsx:349, ops-tab:220; r1p0 "planner/date change…" | — |
| 102 | Planner (C-13) | MOVE_JOB | C | C | move-job.tsx:239; t_s10_s11 | spot-checked, unchanged |
| 103 | Planner (C-14) | CHANGE_INSTALLER (R1) | P | C | UI ChangeInstaller actions.tsx:391, ops-tab:221; r1p0 "installer replacement (with stale-version refusal)" | first assignment after Booked has no path (the reference neither; R2 PLAN_WORK_PACKAGE, FN-02) |
| 104 | Planner (C-18) | Person / capacity / leave / skill validation | C | C | 146000:972-1008 | — |
| 105 | Planner (C-19) | PLANNER_3/6_WEEKS | C | C | 149000:981 | — |
| 106 | Planner (C-21) | Calendar capture (R1) | CDA | CDA | 146000:883-937 | Postgres is the truth; no sender |
| 107 | Cancellation (C-23) | Cancellation preview | P | C | cancel-job.tsx:16 → server/cancellation.ts:33 `cancellation_preview`; t_s15 | — |
| 108 | Cancellation (C-24) | CANCEL_JOB | P | C | UI CancelJob cancel-job.tsx:63, ops-tab:436; r1p0 "R1 cancellation…from Prebooking/ReadyToBook/Booked" | FN-17 + FN-20 Manual |
| 109 | Cancellation (C-25) | CANCELLATION_RESOLVE | P | C | 220:357-456 flags; UI cancellation-work.tsx:24, ops-tab:374; r1p0 (×2) | GHL tasks unresolvable until GHL ids are configured (flagged) |
| 110 | Cancellation (C-26) | CANCELLATION_CLOSE | P | C | cancellation-work.tsx:99, ops-tab:388; r1p0 | — |
| 111 | Cancellation (C-27) | REINSTATE_JOB | P | C | actions.tsx:462, ops-tab:401; r1p0 | — |
| 112 | Cancellation (C-28) | REOPEN_REVIEW_COMPLETE | P | C | cancellation-work.tsx:156, ops-tab:425; r1p0 | — |
| 113 | Cancellation (C-29) | S15 guard on normal work | C | C | 141000:489; JOB_OPERATIONS STAGE_NOT_CANCELLED | spot-checked |
| 114 | Queues (C-36) | OPERATIONAL_QUEUE | C | C | 149000:555-583 | — |
| 115 | Scheduling (C-39) | pg_cron presence (INS generators) | U | U | 150000:99-108; 2021 sweep_schedule | hosted unverified; tests run s10_run_schedules by hand |
| 116 | Commissioning (E-R-12) | COMMISSIONING_RECORD | M | C | = #89 | duplicate |
| 117 | Evidence (E-R-18) | Drive resolve → Storage upload | CDA | CDA | 183; evidence-field upload with retry | real-browser upload/retry/replace reported verified on an isolated stack |
| 118 | Evidence (E-R-19) | Viewing / opening files | M | CDA | 183:754 evidence_open, :788 list_evidence; src/app/api/evidence/[evidenceId]/route.ts (60 s signed URL); evidence-list.tsx on job/task/installs/commissioning pages; se "open / download" (3 tests) | — |
| 119 | Finance (E-F-01) | Invoice stages | CDA | CDA | 143000:528 | — |
| 120 | Finance (E-F-02) | Deposit confirmation | CDA | CDA | PRE03 path | — |
| 121 | Outbound (E-N-01) | OutboundGuard | CDA | CDA | 164000:541 | — |

**Excluded from the denominator (R1 INTENTIONALLY OBSOLETE in the baseline; unchanged):**

| Row | Capability | Note |
|---|---|---|
| A08 | PermissionRules | — |
| A14 | Pilot-job scope | — |
| A19 | Signed actor proof / bridge | — |
| B06 | Commit journal | table still counted by SYSTEM_STATUS |
| C13 | Hourly heartbeat tick | — |
| B-C06 | PRE-COPY-JOBID helper | — |
| B-C20 | Upload retry | registered upload + in-transaction check |
| B-C23 | DEV admin repair tools | — |
| E-B-01 | Drive backup export | now replaced by an evidence model |
| E-B-02 | Drive backup folder health | — |

## 4. Remaining gaps

**PARTIAL (9):**

| # | Row | Exact gap |
|---|---|---|
| 2 | A02 Staff/role administration | No command or UI to add a person, change roles or deactivate; direct table writes only (now row-audited). |
| 4 | A04 Login provisioning | `invite-staff.ts` audit insert is non-transactional and unchecked; the preview-identity check; no test. |
| 12 | A15 R1 authorization matrix | `public.submit_presale` is not FN-01 gated (reference SOLD_INTAKE was); no recorded owner decision to leave it ungated. |
| 27 | A-C04 OutboundGuard | Email recipient allow-list is advisory only; no email outbox type or sender calls it. |
| 33 | A-C10 Resilience review queue | `public.resilience_review_queue()` is not used by any screen; Communications Uncertain/Failed and stalled Processing rows are invisible. |
| 39 | A-E04 Mode-consistency check | Only Disabled⇔None for FN-13/14/16; no "planned-Manual set to Automated" or target_release check. |
| 43 | A-F04 ACTION_AVAILABILITY reads | Unused by the UI and stale: they offer completion only in InProgress/Aftercare (149000:858, :909). JOB_OPERATIONS covers the job screens; task-level availability is still not consumed. |
| 46 | A-G04 Release acceptance evaluator | No R1..R4 readiness verdict, no data invariants (duplicates, stuck rows, stock), no manual checklist. The health/audit coverage items exist. |
| 75 | B-C29 DEPOSIT_CONFIRM | No UI or availability flag; happy path untested. PRE03 covers the business need. |

**MISSING (4):**

| # | Row | Gap |
|---|---|---|
| 47 | A-G05 | S19 migration/cutover: no import of in-flight jobs, tasks, booking or planner state; no no-dual-creator plan. |
| 48 | A-G06 | S20 release plan evaluation / production configuration contract. |
| 69 | B-C22 | Task reassignment. The reference had none either; recommend an owner decision to mark it obsolete or build it. |
| 78 | B-C32 | Intake Review resolve. Absent in the reference too; same recommendation. |

**UNCERTAIN (4):**

| # | Row | Why |
|---|---|---|
| 28 | A-C05 | pg_cron schedules on hosted. |
| 36 | A-D01 | Hosted platform backup / PITR plan and retention. |
| 49 | A-G07 | Company ownership and recovery of the Supabase / Vercel / keys. |
| 115 | C-39 | pg_cron for the INS generators on hosted. |

All four are external infrastructure facts that cannot be verified from the repo. System Health now reports two of them (the scheduler item, and backup evidence reads Unknown).

**RELEASE-GATED (8):** A-C06, C07, C08, C09, C11, C12, D02 (all FN-14 or FN-16) and B-C39 (the gating mechanism).

## 5. Can R1 now operate entirely without Apps Script?

**Short answer:** the application side of R1 no longer needs Apps Script or AppSheet, and its end-to-end path is implemented. R1 is not operable today, for two reasons: every R1 function is still Disabled, and several external operational prerequisites are unproven or manual.

**(a) Backend implemented: YES for the R1 business workflow.**
- The whole path is ported, with the same authorization, idempotency, versioning and audit as the rest of the backend, and exercised end to end by `tests/r1-p0-integration.test.mjs`:
  - Sold → PRE01–05 → ReadyToBook → booking (first installers via the booking form) → Booked
  - calls (task and job level), issues, office commissioning, OPERATIONAL_COMPLETE from Booked
  - cancel / resolve / close / reinstate / reopen review
  - evidence upload / open
  - audit coverage and System Health
- Remaining backend gaps are peripheral:
  - `submit_presale` FN-01 gate
  - staff administration command
  - release-mode set command
  - release-readiness evaluator
  - S19 cutover import
- InProgress/Aftercare are obsolete for R1: the reference never writes them, and `fffbe1f` says R1 completes from Booked.
- Zero runtime calls to Apps Script, AppSheet, Sheets, Drive or Calendar.

**(b) UI operable by staff: YES for the daily R1 flow, with caveats.**
- Every R1 command is now wired, except DEPOSIT_CONFIRM, which PRE03 covers. The Operations tab adds: commissioning with upload, job-level calls, issues create/update, completion, dates, installer change, cancel/reinstate, cancellation resolve/close, reopen review.
- Evidence open/download works on job, task, installs and commissioning pages. System Health is visible to Director.
- Staff still cannot:
  - enable release modes (direct SQL only; now audited)
  - administer staff/roles (SQL only)
  - see the resilience queue
- These flows were clicked through in a real browser on the isolated stack (see §1).

**(c) Release-gated: every R1 function ships Disabled.**
- FN-01, 11, 14, 15, 16, 17, 19, 20 are all Disabled (`20260919142000_reference_config.sql:75-96`); no migration changes them.
- On a fresh deploy every `execute_command` except `submit_presale` is refused, and System Health reads Unknown because FN-14 is off.
- Going live needs an Admin to set the modes. There is no command or UI; it is a direct UPDATE, now row-audited. This is an operational go-live step.

**(d) External operational infrastructure: not in place. These are the real blockers to "live without Apps Script".**
- **Hosted deployment:** `20260919160000` onward, including all five P0/R1 migrations, is reported not applied to hosted (`docs/backend-port.md:51-52`). JOB_OPERATIONS, evidence, health and commissioning therefore do not exist on hosted yet.
- **pg_cron:** the sweep, S10 schedules, SYS01/02 and S13 are unverified on hosted. They are now detectable in System Health.
- **Backups and restore drills:** Supabase platform, unverified. Evidence must be recorded by a person (OPS_EVIDENCE_RECORD, FN-14). There is no automated verifier and no scheduled drill.
- **External uptime monitor:** `/api/health` exists, but nothing polls it.
- **SMTP / invites:** hosted Auth settings (sign-up off, confirmations on) are unverified; invite flow only.
- **Senders:** Google Calendar, Xero, GHL, merchant/scaffold email. There is no outbox worker. Calendar is `NOT_CONFIGURED` (capture only). GHL and Xero ids are `NOT_CONFIGURED`, reported by SYSTEM_STATUS, and GHL cancellation tasks cannot be resolved until they are set. These are manual or tracked human tasks in R1, the same as the reference, which never sent either.
- **Data cutover (S19):** no import of in-flight work from the current systems.

**Verdict:** Apps Script is no longer needed as R1 business logic. The only thing still held in it is semantic reference material for the unported S19/S18/S20 and R2 stock/calendar rules; keep the `c4f56ea` archive.

R1 can operate on the new stack once all of the following are done:
1. the integration is merged and applied to hosted
2. the hosted Auth/pg_cron/backup facts are verified and evidence is recorded
3. FN-01 and the related functions are switched on
4. a cutover plan exists
