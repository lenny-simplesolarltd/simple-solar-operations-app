# Backend port from the reference system

The R1 backend in `supabase/migrations/20260919140000`–`20260919150000` is a port of the reference
implementation (`simple-solar-operations`: Google Sheets + AppSheet + Apps Script) to Postgres functions.

**Ported from reference commit `f25002a` ("R1 almost complete"), clean working tree.**

## Where each reference module lives

| Reference source | Migration |
|---|---|
| `r1-appsheet/adapter.js` (actor, role classes, modes, job access, dispatch), `s04/processor.js` (idempotency) | `20260919141000_command_core.sql` |
| `schema/tables.json` (Jobs columns), `schema/config-seed.json` (templates, release modes, settings) | `20260919140000_backend_schema.sql`, `20260919142000_reference_config.sql` |
| `s06/gates.js`, `s13/payments.js` (stages at sale) | `20260919143000_s06_workflow.sql` |
| `r1-appsheet/services.js` task commands, DEPOSIT_CONFIRM, BOOKING_GATES, CONFIRM_BOOKING | `20260919144000_r1_prebooking_commands.sql` |
| `s05/intake.js`, `s05/booking-apply.js`, `s05/mapping.js`, `services.js` BOOKING_INTAKE | `20260919145000_s05_booking_intake.sql` |
| `s10/operations.js`, `s11/planner.js` (R1 functions) | `20260919146000_s10_s11_operations.sql` |
| `s15/cancellation.js` | `20260919147000_s15_cancellation.sql` |
| `s16/health.js`, `s16/heartbeat.js`, `resilience/review.js` | `20260919148000_s16_health_resilience.sql` |
| `r1-appsheet/adapter.js` reads, `s17/admin.js`, `s11/planner.js` buildPlanner, `s05/priority.js`, `r1-appsheet/command-result.js` | `20260919149000_s17_reads_rls.sql` |
| scheduling, evidence storage | `20260919150000_integration.sql` |

SOLD_INTAKE is not ported here: the sale is `public.submit_presale` (Job Sold migration).
Not ported by design: AppSheet request rows and bots, upload retry, CommitJournal recovery states,
script locks, DEV sheet guards, generated bundles (`apps-script/`, `standalone-bridge/`).
| — (registry for R2–R4 commands/reads as data; release modes for any release) | `20260919160000_command_registry.sql` |
| `materials/workflow.js`, `s07/ordering.js` | `20260919161000_r2_materials_ordering.sql` |
| `materials/workflow.js` receive/quarantine, `operations-contract.js` GOODS_IN_RECEIVE / STOCK_QUARANTINE, `s08/picking.js` (survey for the missing `stock/workflow.js`) | `20260919162000_r2_stock.sql` |
| `scaffold/workflow.js`, `s09/scaffold.js` | `20260919163000_r2_scaffold.sql` |
| `calendar/service.js`, `processor/outbox.js` (generic outbox worker protocol), `resource/planning.js`, `s11/planner.js` R2 | `20260919164000_r2_calendar_resourcing.sql` |
| `installer/workflow.js`, `operations-contract.js` IW_* / COMMISSIONING_REVIEW, `s12/commissioning.js` | `20260919165000_r3_installer_commissioning.sql` |
| `s13/payments.js`, `s14/reporting.js`, `xero/adapter.js`, `s16/health.js` archive | `20260919166000_r4_finance_reporting.sql` |
| `r1-appsheet/command-result.js` (R2–R4 codes) | `20260919167000_result_catalogue_r2r4.sql` |
| view-port read models (TASKS, TASK_DETAIL, JOBS, OFFICE_DASHBOARD, MY_REQUESTS) + canonical read visibility | `20260919170000_view_port_reads.sql` |
| view-port booking reads (BOOKING_BOARD, BOOKING_FORM, INTAKE_REVIEW_QUEUE) | `20260919171000_view_port_booking_reads.sql` |
| view-port material list reads (MATERIALS_BOARD, ORDERS_LIST, STOCK_OVERVIEW) | `20260919172000_view_port_materials_reads.sql` |
| view-port resourcing reads (STAFF_AVAILABILITY, INSTALLER_SKILLS, SCAFFOLD_BOARD, COMMISSIONING_QUEUE) | `20260919173000_view_port_resourcing_reads.sql` |
| `r1-appsheet/services.js` COMMISSIONING_RECORD (+ `s12/commissioning.js` office template), CALL_RECORD job-level calls, JOB_OPERATIONS read (Operations tab) | `20260919210000_r1_completion.sql` |

Not in the reference checkout (ported from the survey only): `stock/workflow.js`, `materials/revisions.js`.
External senders (Google Calendar, Xero, email) are a future TypeScript worker using the service-role
`public.outbox_*` functions (contract in the 164000 header; Xero specifics in 166000).

## Deployment status

- `20260919140000`–`20260919150000` (core + R1): applied to the hosted project.
- `20260919160000` onwards: **not yet applied** — waiting for the other stream's reconciliation
  migration. Before applying: re-read `supabase_migrations.schema_migrations`, renumber after any
  newer hosted version if needed, dry-run in a rolled-back transaction, apply.
- Seeds: `supabase/seeds/003_backend_task_assignment_rules.sql` gives every template an owner; run it
  after the migrations.

## Tests without Docker

`npm run test:db:pglite` replays the whole migration chain on PGlite and runs `tests/pglite/t_*.mjs`.

## When the reference changes

1. In the reference repo: `git diff f25002a..HEAD --stat -- s05 s06 s10 s11 s13 s15 s16 s17 r1-appsheet resilience processor schema`
   (ignore `apps-script/` and `standalone-bridge/`: they are generated from these sources).
2. Map each changed file to its migration with the table above and read the diff for business-rule changes.
3. Never edit an applied migration. Write a new migration that `create or replace`s the affected
   `app.*` functions (or `alter`s tables), with a comment citing the reference commit.
4. Re-run the test suites against a local stack, then apply.
5. Update the baseline commit at the top of this file.

## R1 completion after booking (20260919210000)

- `COMMISSIONING_RECORD` is the R1 route to an Accepted commissioning submission
  (office-recorded evidence, `source_system = 'R1A-office-manual'`). It is what
  lets a job with an Electrical work package pass the S10 operational-completion
  gate in R1; the R3 route (`IW_COMMISSIONING_*` + `COMMISSIONING_REVIEW`) is
  unchanged and still needs an approved template.
- Evidence integration point: the command uses only `app.ensure_evidence(job,
  'Commissioning', storage_path)` and `app.job_evidence(job, id_or_path, code)`,
  then links `evidence.submission_id` once (never re-pointed). Changes to
  evidence storage internals must keep those two signatures and that behaviour.
- `CALL_RECORD` without `task_id` is a job-level call (no task, job or package
  side effects; `expected_version` is the job's).
- Open business decision (REF-03 §11.2): nothing moves a job to
  `InProgress` / `Aftercare`. The server gate, not the stage, decides
  completion; the Operations tab offers completion when the gate is ready.
