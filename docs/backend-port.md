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
Not yet ported: R2 (materials, stock, scaffold, calendar), R3 (installer, commissioning), R4 (Xero,
reporting, archive).

## When the reference changes

1. In the reference repo: `git diff f25002a..HEAD --stat -- s05 s06 s10 s11 s13 s15 s16 s17 r1-appsheet resilience processor schema`
   (ignore `apps-script/` and `standalone-bridge/`: they are generated from these sources).
2. Map each changed file to its migration with the table above and read the diff for business-rule changes.
3. Never edit an applied migration. Write a new migration that `create or replace`s the affected
   `app.*` functions (or `alter`s tables), with a comment citing the reference commit.
4. Re-run the test suites against a local stack, then apply.
5. Update the baseline commit at the top of this file.
