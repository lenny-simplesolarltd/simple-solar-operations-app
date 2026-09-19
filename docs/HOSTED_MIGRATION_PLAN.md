# Hosted migration plan

Hosted Supabase project `ocpwrrajskywpqpatwea`. Inspected **read only** on
2026-09-20 (session forced to `default_transaction_read_only=on`). Nothing was
applied, changed or deleted on hosted.

## Where hosted is

| | Hosted | Repository (`feature/dev` after convergence) |
|---|---|---|
| Migrations | 23 (`20260918200000` .. `20260919150000`) | 47 |
| Applied migrations that differ from the repository file | none (all 23 identical after removing comments and whitespace) | |
| Migrations on hosted but not in the repository | none | |
| Data | 2 jobs, 7 tasks, 22 people, 1 login, 0 evidence rows, 0 Storage objects, 147 audit rows | |
| Release functions | FN-01 .. FN-20 all `Disabled / None` (FN-21 does not exist yet) | all Disabled after replay |
| Extensions | pg_cron 1.6.4, pgcrypto, uuid-ossp, supabase_vault, pg_stat_statements | |
| pg_cron jobs | `ss-resilience-sweep`, `ss-s10-schedules`, `ss-system-tasks` (all active) | + `ss-outbox-stalled` (164000), `ss-s13-milestones` (166000) |
| Storage | bucket `evidence` (private), 0 objects | |

This is why the owner's local app (pointed at hosted) shows "needs a backend
update that is not deployed to this database yet": every registry read
(`execute_operations_read`, TASKS, JOBS, OFFICE_DASHBOARD ...) is created by
`20260919160000` or later. Against a database with all 47 migrations no such
message appears (see `FINAL_ROUTE_ACCEPTANCE.md`).

## Pending migrations, in order

```
20260919160000_command_registry
20260919161000_r2_materials_ordering
20260919162000_r2_stock
20260919163000_r2_scaffold
20260919164000_r2_calendar_resourcing        (schedules ss-outbox-stalled)
20260919165000_r3_installer_commissioning
20260919166000_r4_finance_reporting          (schedules ss-s13-milestones)
20260919167000_result_catalogue_r2r4
20260919170000_view_port_reads
20260919171000_view_port_booking_reads
20260919172000_view_port_materials_reads
20260919173000_view_port_resourcing_reads
20260919180000_assistant_conversations
20260919183000_p0_evidence
20260919185000_assistant_pending_actions
20260919190000_forms                          (FN-21 seeded Disabled)
20260919202000_p0_audit_integrity
20260919202100_p0_operational_health
20260919210000_r1_completion
20260919220000_p0_r1_integration
20260920100000_help_center
20260920100100_help_center_seed
20260920120000_convergence_operations
20260920130000_help_center_seed_v2
```

(Exact file list: `ls supabase/migrations`; every file after
`20260919150000_integration.sql`.)

## Preconditions checked on hosted (read only)

| Pending change | Could it fail on hosted data? | Result |
|---|---|---|
| `evidence_storage_path_key` unique index, `upload_status` / context checks (183000) | duplicate paths or other statuses | 0 evidence rows: safe |
| `commissioning_submissions` shape check (210000) | existing submissions | none: safe |
| objects created by pending migrations (`app.command_registry`, `execute_operations_read`, `assistant_conversations`, `forms`, `help_articles`, `operational_evidence`) | already exist (hand-made) | none exist: safe |
| audit triggers restored (202000) | already present | idempotent by design |
| pg_cron schedules (164000, 166000) | extension present | present |
| release modes | a migration switching something on | no migration enables anything; FN-21 arrives Disabled |

Migrations amended in place during development (conversations 180000, Forms
190000) were **never applied to hosted**, so their current bytes are what
hosted will run. No reconciliation migration is needed.

## Audit path leak (TASK_EVIDENCE_ATTACH)

`20260919144000` (on hosted) wrote the evidence storage path into the audit
reason of `TASK_EVIDENCE_ATTACH`; `20260919220000` fixes it. Hosted has **0**
`Tasks / EvidenceAttach` audit rows and **0** audit reasons shaped like a
storage path (`<uuid>/...`). Nothing to remediate. Even had there been rows:
a path alone grants nothing (the bucket is private; Storage policies look the
object up in `public.evidence` and apply `app.can_read_evidence`), and audit
rows are append-only, so the decision would have been "document, do not
rewrite".

## How to apply (when the owner authorises it)

1. Take a fresh backup / confirm PITR point in the Supabase dashboard; record it
   with **System health > Record a check** afterwards.
2. `supabase link --project-ref ocpwrrajskywpqpatwea`, then
   `supabase migration list` - hosted must show exactly the 23 above as applied.
3. Dry run: `supabase db push --dry-run` must list exactly the pending files
   above, in order, and nothing else.
4. `supabase db push` (applies in one go; each migration is its own
   transaction).
5. Verify read only:
   - `select count(*) from supabase_migrations.schema_migrations` = 47 (23 applied + 24 pending);
   - `select mode, count(*) from public.release_modes group by 1` = `Disabled | 21`;
   - `select app.audit_coverage()->>'state'` = `Verified`;
   - `select jobname, schedule, active from cron.job` shows the 5 jobs.
6. Point the app at hosted and open Office home, Tasks, Jobs, Booking, Issues,
   Files, Help, System health, Release control: no "not deployed" message.
7. Do not switch anything on until the R1 pilot runbook says so
   (`docs/R1_PILOT_RUNBOOK.md`).

Rollback: migrations are forward-only. If a migration fails, the push stops at
that transaction and hosted keeps the earlier ones; fix forward with a new
migration. Operationally, "rollback" of a feature is switching its release
function off in Release control.
