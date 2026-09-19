# Final convergence report

Date 2026-09-20. Branch `feature/final-convergence` (worktree
`/Users/lennybeadle/simple-solar-final-convergence`), from `origin/feature/dev`
`685039d`, integrated into `feature/dev` by pull request. Companion documents:
`FINAL_CONVERGENCE_BRANCH_INVENTORY.md`, `FINAL_ROUTE_ACCEPTANCE.md`,
`APPSHEET_FRONTEND_PARITY.md`, `ROLE_NAVIGATION_MATRIX.md`,
`FILES_DOCUMENTS_ARCHITECTURE.md`, `HOSTED_MIGRATION_PLAN.md`,
`R1_PILOT_RUNBOOK.md`, `R1_PARITY_FINAL.md`.

## 1. Starting state and integration

- `origin/feature/dev` = `685039d`. Local `feature/dev` had moved to
  `3429fdc` (= `origin/convergence/feature-dev`: P0 integration + auth +
  SimpleBot + Forms merged by an earlier session). `feature/help-center`
  (`0179c81`) was built on it.
- Every local and remote branch is an ancestor of `0179c81` (verified with
  `git merge-base --is-ancestor`), so integration was a **fast-forward** of
  `feature/final-convergence` to `0179c81`: no branch merged twice, no
  textual conflicts. The three P0 branches are contained through
  `p0-r1-integration`; Forms already contained SimpleBot.
- No frontend / AppSheet parity branch existed; that work was done here.
- Reference preserved remotely (plain pushes, no force):
  `archive/pre-port-backend-final` (already there), `archive/r1-post-booking-completion-wip`
  and tag `pre-next-backend-reference-2026-09-19` (pushed in this task).

Semantic conflicts found and resolved:

| Found | Resolution |
|---|---|
| `src/types/database.ts` stale by ~10 migrations (conversations, pending actions, Forms, Help missing) | regenerated from the fresh replay (45, then 47 migrations) |
| `identity.test.mjs` asserts "no logins yet" but newer suites sorting before it create logins | renamed `00-identity.test.mjs`; `test:db` is one glob again |
| Booking page crashed for anyone without booking availability (`bookingReason()` in a `'use client'` module called on the server) | moved to `features/booking/booking-reasons.ts` |
| "Not deployed" fallback also caught 42883 raised by a real SQL error; dashboard fell back to the legacy home on **any** failure | 42883 counts only for a missing read entry point; legacy home only for `READ_NOT_DEPLOYED` |
| Help seed test hard-coded seed version 1 | follows the latest seed |
| Blocked cancellation tasks offered no action (found in browser acceptance) | link to the Operations tab |

## 2. Migrations

47 migrations, unique timestamps, forward-only; **no historical migration
edited**. New in this task (additive):

- `20260920120000_convergence_operations.sql`: ISSUES read; issue files linked
  to issues; JOB_OPERATIONS office people; RELEASE_MODE_SET +
  RELEASE_CONTROL / RELEASE_READINESS reads + `app.release_readiness()`
  (S20 replacement); staff writes to `release_modes` withdrawn;
  STAFF_CREATE / STAFF_ROLE_SET / STAFF_SET_ACTIVE + STAFF_ADMIN read;
  TASK_REASSIGN + TASK_REASSIGN_CANDIDATES; `public.search_evidence`;
  catalogue extension (`result_error_catalogue_pre_convergence`) with grants.
- `20260920130000_help_center_seed_v2.sql`: 85 standard articles (v1 file
  untouched; untouched articles upgrade, staff-edited ones are only flagged).

Fresh replay from zero: 47 migrations + seeds, **all 21 release functions
Disabled**, audit coverage **Verified 26/26**, pg_cron: 5 jobs active
(`ss-outbox-stalled`, `ss-resilience-sweep`, `ss-s10-schedules`,
`ss-s13-milestones`, `ss-system-tasks`).

## 3. "Backend update not deployed" (primary acceptance item)

The owner saw these messages because the owner's app runs against **hosted**,
which has only the first 23 migrations; every registry read is created by
`20260919160000` or later. On the converged database they never appear:
416 page visits by 8 roles on the production build found **zero** such
messages and zero errors (`FINAL_ROUTE_ACCEPTANCE.md`). The remaining texts
fire only when the read entry point is genuinely missing (hosted today) and
stay as production compatibility until hosted is migrated; the check was
narrowed so it can no longer mislabel a real error. Making the owner's
screens work requires the hosted migration (`HOSTED_MIGRATION_PLAN.md`) - not
done without authorisation.

## 4. What was built

| Area | Result |
|---|---|
| Issues queue | `/dashboard/issues`: open / resolved / all, search by job, customer, postcode; blocking badge; Resolve (optional proof file, linked to the issue), Close, Reassign; also on the job Operations tab |
| Calls / Cancellations / Payments / GHL queues | Tasks "Everyone" scope + queue chips; Calls and Cancellations in the Operations menu; cancellation tasks (incl. Blocked) link to the job's Operations tab |
| Task reassignment | eligible people only, reason, version check (was MISSING in parity) |
| Release control | `/dashboard/release`: switch on / off with reason, planned mode only, FN-01 dependency both ways, one audit event, Director read-only; direct SQL no longer needed or possible for staff |
| Readiness (S20 replacement) | Pass / Fail / Unknown for audit, backups, restore drills, pg_cron, admin login, task owners, mode consistency, commit journal, private files; on Release control and System health |
| Staff administration | People & access: add person, give / remove role, invite, deactivate / reactivate; last-Admin and self-lockout guards; only Admin grants Admin |
| Files | grouped job Files tab with upload; Files & documents library (`search_evidence`); optional files on scaffold / order confirmations; SimpleBot `list_job_files` / `search_files` |
| Navigation | role-aware sidebar (`ROLE_NAVIGATION_MATRIX.md`); office-only job tabs hidden from Surveyor / Finance / installers; Move page office-only |
| Help | 85 articles incl. Issues, Office queues, Files & documents, Reassign a task, Release control, Go-live readiness, People & access |
| Docs | the eight documents listed above; `backend-port.md`, `ENVIRONMENT.md`, `env.example.txt` corrected |

## 5. Verification

| Check | Result |
|---|---|
| Fresh replay | 47/47 migrations + seeds; 21 Disabled; audit Verified |
| Real Postgres + Storage (`tests/*.test.mjs`, isolated stack) | **167/167** (identity, Job Sold, SimpleBot conversations + pending actions, Forms incl. FN-21 gate, audit + health, preview, R1 end to end, convergence operations, Storage evidence, Help) |
| PGlite (23 suites, full replay each) | 23/23 |
| Unit (vitest) | 528/528 |
| Typecheck | clean |
| Lint | 0 errors (21 warnings, pre-existing kinds) |
| Production build | passes |
| Browser, full R1 journey (production build, fresh DB) | **14/14 steps, 0 page errors**: Release control switch-on (9 functions, reasons) -> New Job Sold through the 9-step Presale form -> PRE01, PRE02 (real PDF), PRE04 (bad type refused, failed upload retried), PRE03 by Director -> ReadyToBook -> booking form with installers -> BKG01-03 -> Confirm booking -> change dates, change installer -> Calls queue (scheduler) -> installer confirmation + customer happy -> Electrical commissioning with certificate -> blocking issue from Issues queue (reassign, resolve with file, close) -> job-level call -> OperationallyComplete; Files tab + library; cancellation (Cancellations queue -> resolve -> close -> reinstate -> reopen review); task reassign; Help search; Director read-only Release control |
| Browser, every route x 8 roles | 416 visits, 0 errors, 0 false warnings (`FINAL_ROUTE_ACCEPTANCE.md`) |

Roles: Admin and Manager (everything incl. People, Release control, System
health); Director (oversight, System health, Release control read-only, no
selling, no People); Office / VariationApprover (full daily R1); Surveyor
(New job sold, own job sales, own jobs' Overview / Tasks / Files, Files,
Help; other surveyors' jobs not found); Installer (My installs - R3,
release-gated - own work's files, Help; no office queues); Store (Materials,
Merchant orders, Goods in, Stock - R2 release-gated - delivery notes, Help;
synthetic local login, no genuine Store person exists).

## 6. Security regression

Actor and roles resolved server-side (`app.resolve_actor`, `auth.uid()` ->
`people.auth_user_id` -> active `person_roles`); RLS fail-closed; no service
role in the browser (used server-side for invitations and the auth callback
only; SimpleBot never uses it); no arbitrary SQL through SimpleBot (typed
tools on the user's session); expected_version + command ids + fingerprints
on every command (tested: stale, replay, id reuse); refused commands write no
audit (tested); audit append-only; release changes one audited event with
reason; private Storage, 60-second signed URLs, no path-based authorisation;
Forms tokens stored as hashes, FN-21 Disabled; conversations owner-only;
pending actions owner-bound and single-use.

## 7. Integrations and infrastructure (not faked)

| | State |
|---|---|
| pg_cron | isolated stack: 5 jobs active. Hosted (read only): 3 R1 jobs active; the other 2 arrive with pending migrations. Verification SQL in the runbook |
| Email / SMTP | only Supabase Auth invitations and password resets; no operational email sender exists. Hosted needs custom SMTP, sign-ups off, Site / Redirect URLs |
| Google Calendar | outbox capture only; no worker; FN-02 Disabled (R2) |
| Xero | outbox envelope and callbacks in the DB; no client; FN-09 / FN-12 Disabled (R4) |
| GHL | human tasks only; ids NOT_CONFIGURED; FN-11 |
| Antivirus | none; documented as an external prerequisite; upload states can take a scan step without redesign |
| Generated documents | the app generates none (no quote / contract PDF); documented |

## 8. Parity

R1: **101/121 complete (83.5%)**, up from 96/121 after P0 (75/121 before P0);
no MISSING rows; 7 PARTIAL, 7 RELEASE-GATED (FN-14 / FN-16 health), 4
UNCERTAIN (hosted infrastructure facts), 2 intentionally obsolete
(`R1_PARITY_FINAL.md`). R2 / R3: backend and UI built, release-gated; R3 needs
commissioning templates; R4: backend largely there, no UI, no Xero client.
AppSheet views: every R1 view and queue ported, consolidated or replaced
(`APPSHEET_FRONTEND_PARITY.md`). Apps Script / AppSheet runtime dependencies:
**none** (all hits are comments).

## 9. Hosted

Inspected read only (`default_transaction_read_only=on`): 23 migrations,
identical to the repository; 24 pending; no conflicting objects; 0 evidence
rows; **0** audit rows with storage paths (the old TASK_EVIDENCE_ATTACH leak
never reached hosted data). **No hosted change was made.**

## 10. Remaining blockers before an R1 pilot

1. Apply the 24 pending migrations to hosted (owner authorisation; plan ready).
2. Hosted Auth: sign-ups off, Site / Redirect URLs, custom SMTP; invite pilot staff.
3. Record backup and restore-drill evidence (readiness shows Unknown until then).
4. External uptime monitor on `/api/health`.
5. Owner decisions (runbook 8a): existing jobs (new sales only?), stopping the
   Jotform -> Calendar creator, training record; whether `submit_presale`
   should be gated by FN-01.
6. Switch R1 on in Release control (runbook step 9) once readiness is Ready.

Known non-blocking gaps: resilience review queue has no screen; the old
`ACTION_AVAILABILITY` job read is stale and unused; invitation audit is not
transactional; email allow-list advisory (no sender); commissioning
templates (R3); Radix id hydration note in development only.
