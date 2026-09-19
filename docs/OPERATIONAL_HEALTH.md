# Audit integrity, backup evidence and the health heartbeat

Migrations: `20260919202000_p0_audit_integrity.sql`, `20260919202100_p0_operational_health.sql`.
Tests: `tests/pglite/t_p0_audit.mjs`, `tests/pglite/t_p0_health.mjs`, `tests/p0-audit-health.test.mjs`,
`src/features/system/__tests__/operational-health.test.ts`.

## 1. Audit integrity

### What was lost, and why

`20260919110000_drop_identity_and_job_sold` ran `drop schema app cascade`. Every `<table>_audit` trigger calls
`app.audit_row_change()`, so dropping the function dropped the triggers: **59 audited tables became 0**.
`20260919120000` restored the 10 identity / Job Sold triggers. Nothing restored the other **49**:

`accounting_events, acknowledgements, allocations, archive_index, calendar_links, calls, commissioning_answers,
commissioning_questions, commissioning_submissions, commissioning_templates, communication_jobs, communications,
companies, contacts, customer_changes, deliveries, evidence, finance_plans, ghl_tasks, handover, holidays, intake,
invoice_stages, issues, job_costs, job_equipment, manual_bank_checks, mapping_rules, materials, order_lines, orders,
panel_use, payments, person_availability, products, receipt_lines, release_modes, report_snapshots, reservations,
scaffold_bookings, settings, stock_locations, stocktake_lines, stocktakes, task_dependencies, team_members, teams,
technical_details, work_packages`

(Proved by replaying the migration chain up to each point and reading `pg_trigger`.)

### What is audited now

| Group | Tables | Why |
|---|---|---|
| Identity / Job Sold (unchanged) | people, person_roles, person_skills, role_permissions, customers, jobs, presales (insert), task_templates, task_assignment_rules, tasks | canonical models |
| **Restored** - staff edit these directly through RLS, so no command and no semantic event exists | companies, contacts, holidays, person_availability, teams, team_members, settings (insert), release_modes, products, stock_locations | since the incident these edits left no trail at all |
| **Restored** - configuration with no client write path | mapping_rules, commissioning_templates, commissioning_questions | a trigger is the only possible record of a migration / seed / service-role change |
| **Added** | roles, permissions, skills | the vocabulary the authorization model is built from |

**Deliberately not restored (36 operational tables).** The command architecture audits them semantically: each
command writes `app.audit(<Entity>, ...)` events with actor, `command_id` and before/after. They have no client
write path. Several hold customer responses and form answers (`intake.raw_payload_json`,
`acknowledgements.response_text`, `communications.body_snapshot`, `commissioning_answers`) that must not be
copied into the log, and row snapshots would double every event. Child rows written inside a command (order
lines, receipt lines, evidence, customer_changes ...) are covered by the command's event for its primary
entity, as in the reference ("one event per committed command per primary entity").

### Rules

- Actor = `app.current_person_id()` (from `auth.uid()`), never a column of the row. Seeds, migrations, schedulers
  and the service role have **no** person: `initiating_person_id` is null and `executing_service` says what ran
  (`db:<table>` when nothing named itself). `command_id` is set when the change happened inside a command.
- Rejected commands and refused mutations are not audited (the audit row rolls back with them).
- `app.audit_redact` masks secret-looking columns (`token`, `secret`, `password`, `api_key`, `credential`,
  `private_key`) and the value of a secret-looking `settings` key. No audited table has such a column today.
- `audit_events` stays append-only: no insert/update/delete/truncate grant for clients; update, delete and
  truncate raise `AUDIT_EVENTS_ARE_IMMUTABLE` even for the service role.

### So it cannot happen silently again

`app.audit_required` lists the tables that must be audited. `app.audit_coverage()` compares it with the triggers
actually installed (and enabled) and returns `Verified` or `Failed` with the missing tables. It is

- asserted by `t_p0_audit.mjs` (required tables are a *subset* check; the suite also replays the incident:
  `drop function app.audit_row_change() cascade` -> all 26 reported missing);
- shown on System health as **Audit trail coverage**;
- a **Critical** issue in every recorded health evaluation, so the resilience sweep raises an `RS-ALERT` task.

To audit a new table: add the trigger **and** a row in `app.audit_required`, in a new migration.

## 2. Backup and recovery evidence

The database and file storage are backed up by the Supabase platform. The application cannot see the platform's
backup API, so it never claims a backup happened. It records **evidence that someone checked**.

`public.operational_evidence` (append-only, audited as `OperationalEvidence`):

| kind | meaning (reference) |
|---|---|
| `DatabaseBackup` / `StorageBackup` | a backup was looked at and is complete (`backup/service.js _bkVerify`: Verified / Failed) |
| `DatabaseRestoreDrill` / `StorageRestoreDrill` | recovery was rehearsed non-destructively (`_bkRestoreRehearsal`; S18 MAN-13; S20 "recovery route required") |

Each row: outcome `Verified | Failed`, `performed_at`, `subject_at` (the backup checked or restored), `method`,
`evidence_reference` (where the proof is kept - credentials are refused), who recorded it.

- **People**: command `OPS_EVIDENCE_RECORD` (Admin, Manager, Director; release gate FN-14 Automated). Button
  "Record a check" on System health.
- **Automation (not built)**: `app.record_operational_evidence(...)` is the service-role entry point for a future
  verifier that can really see the platform (e.g. a worker calling the Supabase Management API). It records
  `source = 'Automation'` and no person.

## 3. States - never a pass without proof

`app.operational_health()` (inside the `SYSTEM_STATUS` read) reports nine items, each
`Verified | Stale | Failed | Unknown`:

| item | Verified when | otherwise |
|---|---|---|
| Database | it answered this request | - |
| System health check | latest `S16-system` evaluation is newer than `health.check_stale_minutes` (90) **and Healthy** | none = Unknown, old = Stale, Degraded or Critical = Failed (it ran, but did not pass) |
| Background scheduler | latest `ResilienceSweep` heartbeat is OK and fresh, and the pg_cron job exists and is active | FN-14 off / never ran = Unknown; job missing, inactive or sweep failed = Failed |
| Release functions | FN-13/14/16 rows exist once and are consistent (Disabled <=> scope None); modes are listed as they are | Failed |
| Audit trail coverage | `app.audit_coverage()` | Failed |
| Database / storage backup verified | latest evidence is Verified and newer than `health.backup_verification_stale_days` (8) | none = Unknown, old = Stale, latest Failed = Failed |
| Database / storage recovery tested | same, `health.restore_drill_stale_days` (90) | same |

No row is **Unknown**, not a pass. An old row is **Stale** whatever it said. The recorded health evaluation
(`app.health_status`, written by the sweep) is `Degraded` while any evidence is missing, stale or failed, so an
`S16-system` row can no longer be `Healthy` without it. Thresholds are ordinary `settings` rows.

Two things the old read did that it no longer does: `health.latest_check` was the newest `health_checks` row of
*any* integration (usually a heartbeat saying `OK`); and "Backup Drive destination" / "Destructive restore
procedure" were Apps Script placeholders. Both are replaced by the evidence above.

## 4. Heartbeat, and what still needs infrastructure

Inside the database (already there): pg_cron runs `app.run_resilience_sweep()` every 30 minutes; it records the
`S16-system` evaluation and its own heartbeat - **only while FN-14 is Automated**. With FN-14 off (how the system
ships) both items read `Unknown`, and say why.

Outside the database: `GET /api/health` (unauthenticated, no details)

```
200  {"app":"responding","database":"responding","operational_health":"reported",
      "overall_state":"Unknown","states":{"Database":"Verified","DatabaseBackup":"Unknown", ...}}
503  when the database does not answer
GET /api/health?strict=1   200 only when every item is Verified
```

**Not built, needs external infrastructure:**

1. An uptime monitor polling `/api/health` (and alerting). Nothing in this repo polls it; if the app, the
   database or pg_cron stop, only an outside monitor can notice.
2. An automated backup verifier with platform credentials (see `app.record_operational_evidence`). Until then
   backup and recovery evidence is recorded by people.
3. A scheduled recovery drill (restore into a scratch project and compare) - a procedure for a person today.
