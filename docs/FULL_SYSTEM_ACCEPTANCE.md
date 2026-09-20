# Full system acceptance

Date 2026-09-20. Branch `feature/full-system-acceptance`, from `main` `b16505d`.
This moves past the R1-only pilot view: every implemented release function was
switched on and every area was driven through the real screens.

Companion documents: `FINAL_CONVERGENCE_REPORT.md`, `FINAL_ROUTE_ACCEPTANCE.md`,
`APPSHEET_FRONTEND_PARITY.md`, `ROLE_NAVIGATION_MATRIX.md`,
`R1_PILOT_RUNBOOK.md`, `R1_PARITY_FINAL.md`, `assistant/BACKEND_DEPENDENCIES.md`.

## 1. Why the Forms menu was invisible

Nothing was broken. `src/components/layout/nav-visibility.ts` hides the Forms
item rather than disabling it:

```ts
case 'forms':
  // Hidden, not merely disabled, while Forms is switched off.
  return released.forms && permissions.has('forms.read');
```

`released.forms` comes from `formsEnabled()` → `app.mode_available('FN-21', 'Manual')`.
FN-21 was `Disabled`, so the menu item was hidden for everyone, including
Admin. Permissions were never the problem: migration `20260919190000_forms.sql`
already grants Admin, Manager and Office all seven `forms.*` permissions.
FN-21 has no dependencies, so switching it to its planned mode (`Manual`) is
all that is needed. After enabling it, the Admin sidebar reads:

> Operations, Office home, My tasks, Team tasks, Job search, My requests, New job
> sold, Job sales, Booking, Intake review, Calls, Issues, Cancellations, Planner,
> Scaffold bookings, Staff availability, Installer skills, My installs,
> Commissioning review, Materials, Merchant orders, Goods in, Stock, **Forms**,
> Files & documents, Help Center, People & access, Release control, System health

## 2. Release enablement

Done through the application's own mechanism - the `RELEASE_MODE_SET` command
via `public.execute_command`, as an Admin, one command per function, each with
a reason. No `release_modes` row was edited by hand. The order follows the
app's own dependency functions (`app.release_requires` / `app.release_works_with`),
FN-01 first.

| | |
|---|---|
| Enabled | 20 of 21, each to its own `planned_target_mode`, scope `All` |
| Result | 12 Automated, 8 Manual |
| Audit | 20 events, one per command, each carrying the reason |
| Not enabled | **FN-10 (Phoenix evidence/upload/chase)** |

FN-10 is **NOT IMPLEMENTED**: no command in the registry names it, no read is
gated by it, and no screen exists. Switching it on would have changed nothing
and would have misrepresented the system, so it was left Disabled.

Functions with no user interface at all (backend and gating only): FN-09,
FN-10, FN-12, FN-13, FN-15, FN-16, FN-18. FN-15's only trace in the frontend
is a label string; the PRE03 deposit flow runs on TASK_COMPLETE under FN-01,
so enabling FN-15 changes nothing visible.

## 3. Configuration that was missing

R2 and R3 could not run at all on a freshly replayed database, because the
port never carried the reference system's configuration across. This was
found by trying to use the screens, not by reading code.

| Seed | What it restores | Source |
|---|---|---|
| `003_backend_task_assignment_rules.sql` (existed, never applied to hosted) | ownership of the backend task templates | repository |
| `004_reference_catalogue.sql` (new) | merchants (Greentech, CEF), the panel catalogue (P460, P515) and the five stock locations | reference `schema/config-seed.json` @ `c4f56ea`, ported verbatim |
| `005_dev_commissioning_template.sql` (new, **clearly marked DEV**) | one approved commissioning template per commissioning trade, so the R3 review can accept | shape ported from the reference DEV fixture `s12/fixture.js` |

Without 004, `MATERIAL_ADD` has no product, `ORDERS_BUILD` has no merchant and
every stock movement has no location. Without an approved template,
`COMMISSIONING_REVIEW` can never accept, because `app.iw_approved_template`
finds nothing.

`005` is DEV data and says so in its own header, with the removal SQL. The
real commissioning questions are business content Simple Solar must decide.
Staff cannot create templates in the app - `commissioning_templates` is
read-only to every role - so a seed or migration is the only mechanism. This
is **an open decision for the business**, not a defect.

Note that this does not disturb R1: `app.s12_ensure_r1_office_template` keeps
its own per-trade `OfficeRecordedEvidence` template deliberately unapproved, so
office-recorded evidence is never mistaken for a technical review.

`SCAFFOLDER_CONFIGURE` has **no user interface**, so the acceptance scaffolder
was created through the command path. A scaffolder cannot be added by any
member of staff today; this is a real gap for R2.

## 4. Defects found and fixed

### 4.1 Commissioning could never be completed through the installer app

**Severity: blocking for R3.** Found by driving the installer screens with an
approved template in place for the first time.

`IW_REPORT_COMPLETION` opens the commissioning draft automatically when the
installer reports the work finished, stamping it
`template_version = 'NOT_CONFIGURED'`. `app.iw_approved_template` has always
treated that value as "any approved template for this trade", so the DRAFT and
SUBMIT commands resolved it correctly. The `INSTALLER_WORKFLOW` read did not:
it required an exact `t.template_version = v_sub.template_version` match, which
`'NOT_CONFIGURED'` never satisfies.

The effect, with an approved template present:

- the installer's form said *"No approved commissioning template for Electrical
  yet"* and offered no questions, only a photo upload;
- the submission therefore stayed on `NOT_CONFIGURED`;
- Commissioning review disabled **Accept**, because a form without an approved
  template cannot be accepted.

Fix: additive migration `20260920150000_commissioning_template_match.sql`
makes the read use the same rule as the commands. Regression assertion added to
`tests/pglite/t_installer.mjs` (it fails without the migration).

### 4.2 Recording scaffold up or down was refused by its own default

**Severity: usability, guaranteed failure in a real case.** The "Scaffold is
up" dialog prefilled **Date it went up** with the *planned* erect date. The
server refuses an actual date in the future (`erect_actual_at cannot be in the
future`). Whenever scaffold goes up earlier than planned - a normal event - the
default value guaranteed a refusal, shown as internal wording.

Fix: in `src/features/scaffold/components/scaffold-actions.tsx`, the two
"it happened on" dates (erected, stripped) are prefilled with the planned date
*or today, whichever is earlier*. The planned-date fields (Plan strip, Change
dates) are untouched, because a plan may legitimately be in the future.

### 4.3 SimpleBot misdescribed the application

**Severity: acceptance-blocking for the assistant.** `planned.ts` and
`docs/assistant/BACKEND_DEPENDENCIES.md` still claimed BD-02, BD-03 and BD-04
were unavailable. That list is rendered verbatim into the stable system
prompt, so SimpleBot told staff it could not do things the backend has
supported since the convergence migrations.

Fixed three ways:

1. **Two capabilities implemented** (section 5).
2. `complete_task`, `reopen_task` now state the real reason they are not built
   (task types need a file or extra fields; reopening undoes recorded work),
   rather than claiming a missing backend.
3. `attach_task_evidence` is now described as permanently app-only: a file is
   uploaded from the browser straight to storage and the person attests to it.
   The assistant cannot hold a file, and a path it supplied would be an
   unattested record.

### 4.4 One suite left a person deactivated for every suite after it

`tests/00-identity.test.mjs` ends by deactivating Hannah to prove that a live
session loses its access at once - and never put her back. It runs first in
the glob, and the suites after it read the same database. Hannah owns ISS01,
so R1 readiness reported *"No active owner for: ISS01"* and the convergence
suite's readiness assertion failed for a reason that had nothing to do with
what it was testing.

Fix: an `after()` hook restores Hannah and Mike. This is a test defect, not a
product one, but it made the database suite unreliable.

### 4.5 Help Center corrections

| Article | Was | Now |
|---|---|---|
| `switched-off-features` | "There is no button to change them in the app" | Admin and Manager switch features on and off on Release control, with a reason; Directors read-only |
| `system-health` | `release_function: none` | `FN-14` (Record a check and the health read are gated on it) |
| `commissioning-review` | `FN-06, FN-07` | `FN-06, FN-07, FN-08` (its own body describes handover) |
| `upload-a-file` | `FN-01` | `FN-01, FN-03, FN-05, FN-06` (it also covers goods-in and install photos) |

`node scripts/build-help-seed.mjs --check` reports **85 articles OK**; all 43
dashboard routes are named by at least one article.

## 5. SimpleBot: capabilities added

Both are reads, both go through the ported backend's own entry points, so they
inherit the actor resolution, role rules, visibility and release gating already
in the database. Neither adds business logic and neither can mutate anything.

| Tool | Reads | Answers |
|---|---|---|
| `get_job_timeline` | `execute_read` `AUDIT_HISTORY` | "what happened to this job", "who changed this", "when was this done" |
| `get_job_blockers` | `execute_operations_read` `JOB_OPERATIONS` + `execute_read` `ACTION_AVAILABILITY` | "why can't this job be completed", "what is blocking it", "what can I do on it" |

`get_job_blockers` reports open issues and whether they block, the state of
each piece of work, the operational-completion gate with its reasons, and each
refused action with the database's own reason. If the availability read
refuses, it still answers and says so rather than implying there are no
restrictions.

Tests: `src/features/assistant/server/__tests__/operations-tools.test.ts`
(7 tests) covers what each tool asks the database for, what reaches the model,
that a refusal is repeated honestly rather than turned into an empty success,
and that the registry no longer lists them as unavailable.

**Deliberately not built.** Every evidence upload; revealing a form recipient
link; `RELEASE_MODE_SET`, the `STAFF_*` commands and invitations; the outbox,
calendar-review and operational-evidence resolutions; the cancellation chain,
`CONFIRM_BOOKING`, `OPERATIONAL_COMPLETE`, `HANDOVER_CREATE`,
`COMMISSIONING_REVIEW`; and `HELP_ARTICLE_*`, which the bot cites as company
procedure and must not author.

## 6. What was exercised, and how

Everything below ran against a full local replay of all 48 migrations plus the
seeds, on a production build, through the browser: sign in, click, type,
upload, submit. No command was sent by SQL except where noted.

### 6.1 R1 journey - 14 steps, 0 page errors

Release control renders readiness → New Job Sold through the 9-step Presale
form → PRE01, PRE02 (real PDF upload), PRE04 (wrong file type refused, failed
upload retried), PRE03 by the Director → ReadyToBook → booking form with
installers → BKG01-03 → Confirm booking → change dates and change installer →
Calls queue, installer confirmation and customer-happy calls → Electrical
commissioning recorded with the certificate → blocking issue raised from the
Issues queue, reassigned, resolved with a file, closed → job-level call → Mark
operationally complete → Files tab and Files & documents library → cancellation
(Cancel → queue → Resolve → Close → Reinstate → Reopen review) → task reassigned
→ Help search → Director reads Release control read-only → a Surveyor cannot
reach another surveyor's job.

### 6.2 R2 and R3 and Forms - 16 steps, 0 page errors

| Area | Path driven |
|---|---|
| Materials | Add material (catalogue product, merchant source) → Build orders → a Draft order for Greentech |
| Merchant orders | Send to merchant → Record confirmation (this is what creates the delivery) |
| Goods in | Record delivery against a delivery note reference → Received |
| Stock | Opening count → Reserve → Pick → Issue to job → Start stocktake → count every line → Approve |
| Scaffold | Request scaffold → Scaffolder confirmed → Scaffold is up → Erected |
| Installer app | Start work → Progress update → Finish (All done) → ReportedComplete |
| Commissioning | installer answered the approved template and submitted → office **Accept** → Accepted |
| Handover | Create handover (checklist v1, three required documents) |
| Forms | New form → add question → Save draft → Publish → Create link for the customer on a job → the recipient opened `/f/<token>`, answered and saw the thank-you page → the office read the answer |

Two refusals were met on the way and were **correct**: a stocktake count "as at
the stocktake start" is refused once stock has moved after the cut-off, and a
count that differs from the expected balance must give a reason. Both are the
database protecting the ledger. Their wording is internal
(*"movements after cut-off; count AtCount"*) - see section 8.

### 6.3 Every route, every role

| Pass | Visits | Result |
|---|---|---|
| Before any data | 216 static route visits by 8 roles | all 200, 0 page errors, 0 console errors, 0 "not deployed" warnings |
| After the R1 journey | 320 visits | all 200, 0 problems |
| After R2, R3 and Forms | **376 visits** - every route, including every dynamic one, reachable with real data | all 200, 0 problems, nothing left unvisited |

Roles: Admin, Manager, Director, Office, VariationApprover, Surveyor,
Installer, Store.

## 7. Test results

| Check | Result |
|---|---|
| Unit (vitest) | **535 / 535** |
| Real Postgres + Storage (`tests/*.test.mjs`, isolated stack) | **153 / 153**, excluding `preview-dev.test.mjs` - see below |
| PGlite, full replay per suite | **23 / 23** |
| Typecheck | clean |
| Lint | 0 errors (21 warnings, all pre-existing kinds) |
| Production build | passes |
| Browser, R1 journey | 14 / 14 steps, 0 page errors |
| Browser, R2 / R3 / Forms | 16 / 16 steps, 0 page errors |
| Browser, route crawl by 8 roles | **376 visits, all 200, 0 errors** |

## 8. Open items

1. **Hosted has not received the seeds.** Applying `003`, `004` and `005` to
   the hosted database was blocked in this session and is still outstanding.
   Until then hosted has 5 active task assignment rules instead of 45, no
   products, no merchants, no stock locations and no approved commissioning
   template - so R2 and R3 cannot be used there, and Release control readiness
   reports **Fail - Every R1 task has an owner** for BKG01-05, INS01, INS04,
   ISS01, ISS02 and REM01.
2. **The real commissioning questions** are a business decision. Seed `005` is
   a DEV stand-in and is labelled as one.
3. **No way to add a scaffolder.** `SCAFFOLDER_CONFIGURE` has no screen.
4. **FN-10 is not implemented.** Decide whether it is still wanted.
5. **Internal wording reaches staff** in two refusals seen during this run
   (`movements after cut-off; count AtCount`, `erect_actual_at cannot be in the
   future`). The second one can no longer be triggered by the default, but the
   text remains.
6. **Assistant audit stores nothing.** `server/audit.ts` is a console sink
   (BD-08). Proposals and rejections survive only in server logs; a confirmed
   command is still traceable through `commands.command_id`.
7. **Help Center gaps.** No article covers **Create handover**, the calendar
   sync **Resolve** options, the weekly delivery/scaffold lists, or
   **Change dates** on a single piece of work.
8. **`tests/preview-dev.test.mjs` fails 11 of 14 on `main` itself.** Verified
   against a pristine `b16505d` with none of this branch's changes, so it is
   not caused by this work. The "View as user" feature is mid-flight in
   another working copy, which holds an unapplied migration
   (`20260920140000_dev_preview_hosted.sql`); the tests appear to expect it.
   That suite was therefore excluded from the figure above, and the four
   further failures it caused in `r1-p0-integration` disappear when it is
   (they were collateral: it leaves a person deactivated).
9. **Ten registry reads are deployed but unused** by any page - mostly the R4
   finance and archive set, which has no frontend.

## 9. Integrations - state, not pretence

| | State |
|---|---|
| Xero | **NOT CONFIGURED.** Outbox envelope and callbacks exist in the database; no client. FN-09 / FN-12 |
| Google Calendar | **NOT CONFIGURED.** Outbox capture only, no worker. FN-02 |
| GHL | **NOT CONFIGURED.** Ids are `NOT_CONFIGURED`; GHL work is human tasks. FN-11 |
| Email / SMTP | **NOT CONFIGURED.** Only Supabase Auth invitations and password resets; no operational sender. Forms links are copied and sent by hand, and the app says so |
| External monitoring | **NOT CONFIGURED.** `/api/health` exists and answers; nothing polls it |
| Generated documents | **NOT IMPLEMENTED.** The app generates no quote or contract PDF |
| Antivirus scanning | **NOT IMPLEMENTED.** Documented as an external prerequisite |

Nothing above was simulated, stubbed or faked in this acceptance run.
