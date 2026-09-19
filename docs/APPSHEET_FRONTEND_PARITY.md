# AppSheet -> new frontend parity

Every meaningful view of the old AppSheet front end (reference `c4f56ea`:
`docs/R1-office-appsheet-configuration.md`, `r1-appsheet/*`, `s17/admin.js`,
the queue maps and module code - the repository has no AppSheet export, so
views without a committed config were reconstructed from the backend each
used), mapped to the converged app. Classes: DIRECTLY PORTED (DP),
CONSOLIDATED (CONS), REPLACED (REPL), RELEASE-GATED (RG), INTENTIONALLY
OBSOLETE (OBS), BACKEND READY - FRONTEND MISSING (BR-FM), PARTIAL (P),
MISSING (M). A view counts only if its purpose - the list **and** the
actions staff take from it - is reachable in the new UI.

## R1 office core

| # | AppSheet view | New equivalent | Class | Notes |
|---|---|---|---|---|
| 1 | Office Home (Today) | `/dashboard` | CONS | overdue / today / booking review / health; issue counts link to Issues |
| 2 | My Tasks | `/dashboard/tasks` | DP | |
| 3 | Team Tasks | `/dashboard/tasks?scope=team`, `?scope=all` (Everyone) | DP | "Everyone" added (team excludes your own) |
| 4 | History | `/dashboard/tasks?status=closed` | DP | |
| 5 | Task Detail (+ Complete / Reopen / Attach contract / Record call forms) | `/dashboard/tasks/[taskId]` | DP | + Reassign; cancellation tasks link to Operations |
| 6 | Jobs search | `/dashboard/jobs` | DP | |
| 7 | Job Detail (+ related tasks, work, materials, scaffold, actions) | `/dashboard/jobs/[jobId]` (Overview, Tasks, Work, Operations, Money, Files, History) | DP | issue reassign now on the Operations tab |
| 8 | Booking Queue | `/dashboard/booking?view=queue` | DP | |
| 9 | Ready to Continue Booking | `/dashboard/booking?view=ready` | DP | |
| 10 | Booking In Progress | `/dashboard/booking?view=in_progress` | DP | Confirm booking |
| 11 | Upcoming Booked | `/dashboard/booking?view=upcoming` | DP | |
| 12 | Booking Intake Form (Start Job Booking) | `/dashboard/jobs/[jobId]/booking` | DP | first installers chosen here |
| 13 | Confirm Booking Result and all other `*Result` views | in-dialog command outcome | REPL | synchronous commands, no request rows |
| 14 | My Requests | `/dashboard/requests` | REPL | commands ledger |
| 15 | New Job Sold | `/dashboard/presales/new` | REPL | 9-step Presale design form |
| 16 | My Job Sales | `/dashboard/presales` | DP | |
| 17 | Intake Review | `/dashboard/intake` | DP | read-only in both systems (resolve never existed; parity B-C32 obsolete) |
| 18-20 | Planner 3 Weeks / 6 Weeks / Planner Board | `/dashboard/planner?view=3w|6w` | DP / CONS | allocation actions need FN-02 (R2) |
| 21 | Team Planner | `/dashboard/planner?view=board` | DP | |
| 22 | Teams | `/dashboard/skills` (Teams) | CONS | |
| 23 | Installer Skills | `/dashboard/skills` | DP | |
| 24 | Staff Availability Calendar | `/dashboard/availability` | CONS | list over month / quarter / year rather than a grid |
| 25 | Staff Unavailability (recording) | `/dashboard/availability` | DP | add / cancel leave, sickness, training |
| 26 | Move Job Form / Preview | `/dashboard/jobs/[jobId]/move` | DP | office class only |
| 27 | Change Installer Form | job Operations tab, planner row | DP | |
| 28 | Raise / Update Issue forms | job Operations tab, `/dashboard/issues` | DP | REASSIGN added; optional proof file on resolve |
| 29 | Record Commissioning (office) | job Operations tab | DP | certificate upload |
| 30 | Admin: Release modes | `/dashboard/release` | DP (was P) | Release control with reasons, dependencies, readiness |
| 31 | Admin: System status | `/dashboard/system` | DP | Director included; readiness card |
| 32 | Synthetic Jobs / Tasks (DEV) | none | OBS | DEV fixtures of the Sheets system |
| - | People / roles (Sheets editing) | `/dashboard/people` | REPL | add person, give / remove role, invite, deactivate |

## Cross-job queues

| # | Queue | New equivalent | Class | Notes |
|---|---|---|---|---|
| 33 | Calls Queue | **Calls** (`/dashboard/tasks?scope=all&queue=calls`) -> Record call | CONS | whole team; the scheduler (pg_cron) raises INS01 / INS04 |
| 34 | Issues Queue | **Issues** (`/dashboard/issues`) | DP (was P) | issue records across jobs: resolve, close, reassign, blocking badge |
| 35 | Cancellation Queue | **Cancellations** (`/dashboard/tasks?scope=all&queue=cancellation`) -> job Operations tab | CONS (was P) | resolve, close, reinstate, reopen review on the Operations tab |
| 36 | Payments Queue (R1 finance tasks) | `/dashboard/tasks?scope=all&queue=payments` | CONS | |
| 36b | Payments / finance screens (R4) | none | RG + BR-FM | FN-09 / FN-12 Disabled; no finance UI built (R4 boundary respected) |
| 37 | GHL Queue | `/dashboard/tasks?scope=all&queue=ghl` | CONS + RG | FN-11; GHL ids not configured - human tasks only, no connectivity faked |
| 38 | Intake Review as a queue | `/dashboard/intake` | DP | |
| 39 | Store Queue | `/dashboard/goods-in` | RG | R2 (FN-03 / FN-05); Materials + Goods in + Stock replace it |
| 40 | Materials / Scaffold / Commissioning / Handover / Archive queues | module screens + task queue filters | CONS | |

## R2 / R3 / R4 module views

| # | View | New route | Class |
|---|---|---|---|
| 41 | Materials | `/dashboard/materials(/[jobId])` | RG (UI built) |
| 42 | Merchant Orders | `/dashboard/orders(/[orderId])` | RG (UI built; optional confirmation file) |
| 43 | Goods In | `/dashboard/goods-in(/[deliveryId])` | RG (UI built) |
| 44 | Stock | `/dashboard/stock` | RG (UI built) |
| 45 | Scaffold Bookings | `/dashboard/scaffold(/[bookingId])` | RG (UI built; optional files; scaffolder setup has no UI) |
| 46 | My Installs / Installer Workflow | `/dashboard/installs(/[wp])` | RG (UI built) |
| 47 | Commissioning Review / Handover | `/dashboard/commissioning(/[wp])` | RG (UI built; no commissioning templates seeded) |
| 48 | Archive | none | RG + BR-FM (R4) |

## Totals

48 inventoried views (+ the People view): R1 core and queues are all DP / CONS
/ REPL except the deliberate OBS (#32) and the R4-bounded finance screens.
Nothing required for R1 daily operation is missing. What changed in this
convergence: Issues (#34) and Release modes (#30) from PARTIAL to ported;
Cancellation (#35) and Calls (#33) made team-wide with nav entries; Team
Tasks gained Everyone; People became a real admin screen.
