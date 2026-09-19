-- =============================================================================
-- P0 operational health: backup / recovery evidence and a heartbeat that cannot
-- look healthy without proof.
--
-- Reference semantics ported (backup/service.js, s16/health.js, s16/heartbeat.js,
-- s18/acceptance.js BKP-01..05, s20/release.js BACKUP_MISSING):
--   * a backup counts only once it has been VERIFIED (Verified | Failed);
--   * recovery must have been REHEARSED, non-destructively, against a verified
--     backup, and the rehearsal is recorded with who / when / why;
--   * going live needs "verified backup reference and recovery route";
--   * health is recorded in health_checks; last_success is carried forward.
-- Not ported (Apps Script mechanics): the Drive JSON export, sheet row-count
-- manifests and checksums, the dry-run restore plan. The database and storage
-- are backed up by the Supabase platform, outside this application.
--
-- The application has no access to the platform's backup API, so it must not
-- claim that a backup happened. Instead it records EVIDENCE:
--   public.operational_evidence  append-only; one row per backup verification
--     or restore drill, written by a named person through the audited command
--     OPS_EVIDENCE_RECORD, or by a future service-role verifier through
--     app.record_operational_evidence (source 'Automation', no person).
--   app.operational_health()     turns evidence into one of four states per
--     item - Verified | Stale | Failed | Unknown. No row is 'Unknown', never a
--     pass; an old row is 'Stale' however good its outcome was.
--     The system health check is Verified only when the latest evaluation is
--     recent AND Healthy: one that reported warnings ran, but did not pass.
--
-- Deviation (added): the reference had no staleness threshold for backups or
-- for the system health check itself (it warned only when NO check existed), so
-- a scheduler that stopped a month ago still read as its last outcome.
-- Thresholds are settings, with defaults:
--   health.check_stale_minutes              90   (sweep runs every 30 min)
--   health.backup_verification_stale_days    8   (reference cadence: weekly verify)
--   health.restore_drill_stale_days         90
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Evidence
-- -----------------------------------------------------------------------------

create table public.operational_evidence (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null
                     check (kind in ('DatabaseBackup', 'StorageBackup', 'DatabaseRestoreDrill', 'StorageRestoreDrill')),
  outcome            text not null check (outcome in ('Verified', 'Failed')),
  -- When the check or drill was carried out.
  performed_at       timestamptz not null,
  -- The backup that was inspected / restored, as the platform reported it.
  subject_at         timestamptz,
  -- How it was checked ("Supabase dashboard: daily backups list", "PITR restore into a scratch project").
  method             text not null check (length(btrim(method)) between 3 and 200),
  -- Where the proof is kept (ticket, document, backup id). Never a credential.
  evidence_reference text not null check (length(btrim(evidence_reference)) between 3 and 500),
  notes              text check (notes is null or length(notes) <= 2000),
  source             text not null check (source in ('Person', 'Automation')),
  -- The person who vouches for it; null only for automation.
  recorded_by        uuid references public.people (id),
  executing_service  text not null,
  command_id         text,
  recorded_at        timestamptz not null default now(),
  constraint operational_evidence_source_actor check ((source = 'Person') = (recorded_by is not null)),
  constraint operational_evidence_not_future check (performed_at <= recorded_at + interval '5 minutes'),
  constraint operational_evidence_subject_before check (subject_at is null or subject_at <= performed_at),
  -- A verified backup names the backup it saw; a drill names the backup it restored.
  constraint operational_evidence_subject_required
    check (subject_at is not null or (outcome = 'Failed' and kind in ('DatabaseBackup', 'StorageBackup')))
);
comment on table public.operational_evidence is
  'Append-only evidence that backups were verified and recovery was rehearsed. Absence of a row means unknown, never a pass.';
create index operational_evidence_kind_idx on public.operational_evidence (kind, performed_at desc);
create unique index operational_evidence_command_idx on public.operational_evidence (command_id)
  where command_id is not null;

create trigger operational_evidence_no_update_delete before update or delete on public.operational_evidence
  for each row execute function app.forbid_mutation();
create trigger operational_evidence_no_truncate before truncate on public.operational_evidence
  for each statement execute function app.forbid_mutation();

alter table public.operational_evidence enable row level security;
revoke all on public.operational_evidence from anon, authenticated;
grant select on public.operational_evidence to authenticated;
grant all on public.operational_evidence to service_role;
-- Read by the people who may record it; written only by the functions below.
create policy operational_evidence_select on public.operational_evidence
  for select to authenticated using ((select app.is_director_class()));

-- -----------------------------------------------------------------------------
-- Thresholds (settings, validated, with defaults)
-- -----------------------------------------------------------------------------

create function app.health_threshold(p_key text, p_default int, p_max int)
returns int
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb := app.setting(p_key);
  n numeric;
begin
  if v is null or (v #>> '{}') !~ '^[0-9]{1,6}$' then
    return p_default;
  end if;
  n := (v #>> '{}')::numeric;
  return case when n > 0 and n <= p_max then n::int else p_default end;
end
$$;

-- -----------------------------------------------------------------------------
-- Recording
-- -----------------------------------------------------------------------------

create function app.ops_instant(p_value text, p_field text, p_required boolean)
returns timestamptz
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_value is null then
    if p_required then
      perform app.fail('R1A_REQUIRED_' || upper(p_field));
    end if;
    return null;
  end if;
  -- An instant with an explicit offset: "when" must not depend on a session time zone.
  if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    perform app.fail('OPS_REVIEW: ' || p_field || ' must be a date and time with a time zone');
  end if;
  begin
    return p_value::timestamptz;
  exception when others then
    perform app.fail('OPS_REVIEW: ' || p_field || ' must be a date and time with a time zone');
  end;
  return null;
end
$$;

-- The one writer. p_person null = automation.
create function app.insert_operational_evidence(p_kind text, p_outcome text, p_performed_at timestamptz,
                                                p_subject_at timestamptz, p_method text, p_reference text,
                                                p_notes text, p_person uuid, p_service text)
returns public.operational_evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.operational_evidence;
  v_text text;
begin
  perform app.require_mode('FN-14', 'Automated');
  if p_kind is null or p_kind not in ('DatabaseBackup', 'StorageBackup', 'DatabaseRestoreDrill', 'StorageRestoreDrill') then
    perform app.fail('OPS_REVIEW: kind must be DatabaseBackup, StorageBackup, DatabaseRestoreDrill or StorageRestoreDrill');
  end if;
  if p_outcome is null or p_outcome not in ('Verified', 'Failed') then
    perform app.fail('OPS_REVIEW: outcome must be Verified or Failed');
  end if;
  if p_performed_at > now() + interval '5 minutes' then
    perform app.fail('OPS_REVIEW: performed_at cannot be in the future');
  end if;
  if p_subject_at is null and not (p_outcome = 'Failed' and p_kind in ('DatabaseBackup', 'StorageBackup')) then
    perform app.fail('OPS_REVIEW: subject_at (the time of the backup that was checked or restored) is required');
  end if;
  if p_subject_at > p_performed_at then
    perform app.fail('OPS_REVIEW: the backup cannot be newer than the check');
  end if;
  if length(coalesce(p_method, '')) not between 3 and 200 then
    perform app.fail('OPS_REVIEW: method must say how it was checked (3-200 characters)');
  end if;
  if length(coalesce(p_reference, '')) not between 3 and 500 then
    perform app.fail('OPS_REVIEW: evidence_reference must say where the proof is kept (3-500 characters)');
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    perform app.fail('OPS_REVIEW: notes too long');
  end if;
  -- Evidence is a pointer, not a place for connection strings or keys.
  foreach v_text in array array[p_method, p_reference, coalesce(p_notes, '')] loop
    if v_text ~* '(postgres(ql)?://|eyJ[A-Za-z0-9_-]{16,}|sb_secret_|sbp_[a-z0-9]{8,}|service_role|password\s*[=:]|secret\s*[=:]|api[_-]?key\s*[=:])' then
      perform app.fail('OPS_REFUSED: evidence must not contain credentials, keys or connection strings');
    end if;
  end loop;

  insert into public.operational_evidence (kind, outcome, performed_at, subject_at, method, evidence_reference, notes,
                                           source, recorded_by, executing_service, command_id)
  values (p_kind, p_outcome, p_performed_at, p_subject_at, btrim(p_method), btrim(p_reference), nullif(btrim(p_notes), ''),
          case when p_person is null then 'Automation' else 'Person' end, p_person, p_service, app.context_command_id())
  returning * into v_row;
  perform app.audit('OperationalEvidence', v_row.id::text, 'Recorded' || v_row.outcome, null, to_jsonb(v_row), v_row.notes);
  return v_row;
end
$$;

-- OPS_EVIDENCE_RECORD: a named person vouches for a backup check or a restore drill.
-- Payload: kind, outcome, performed_at, subject_at?, method, evidence_reference, notes?
create function app.cmd_ops_evidence_record(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['kind', 'outcome', 'performed_at', 'subject_at', 'method', 'evidence_reference', 'notes'],
    array['kind', 'outcome', 'performed_at', 'method', 'evidence_reference']);
  v_row public.operational_evidence;
begin
  v_row := app.insert_operational_evidence(
    app.txt(v_p, 'kind'), app.txt(v_p, 'outcome'),
    app.ops_instant(app.txt(v_p, 'performed_at'), 'performed_at', true),
    app.ops_instant(app.txt(v_p, 'subject_at'), 'subject_at', false),
    app.txt(v_p, 'method'), app.txt(v_p, 'evidence_reference'), app.txt(v_p, 'notes'),
    app.actor_id(p_actor), app.context_service());
  return jsonb_build_object('status', 'Recorded', 'entity_type', 'OperationalEvidence', 'evidence_id', v_row.id,
                            'kind', v_row.kind, 'outcome', v_row.outcome, 'performed_at', v_row.performed_at,
                            'external_calls', 0);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('OPS_EVIDENCE_RECORD', array['Admin', 'Manager', 'Director'], false,
   '[{"function_id":"FN-14","mode":"Automated"}]', 'operational-health',
   'backup/service.js _bkVerify + _bkRestoreRehearsal as recorded evidence; s18 MAN-06 / MAN-13');

-- For a future service-role verifier that can really see the platform (for
-- example a worker calling the Supabase Management API). Never callable by staff.
create function app.record_operational_evidence(p_kind text, p_outcome text, p_performed_at timestamptz,
                                                p_subject_at timestamptz, p_method text, p_reference text,
                                                p_service text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service text := nullif(btrim(p_service), '');
  v_row public.operational_evidence;
begin
  if v_service is null or v_service !~ '^[A-Za-z0-9:_-]{3,60}$' then
    perform app.fail('OPS_REVIEW: executing service name required');
  end if;
  if p_performed_at is null then
    perform app.fail('R1A_REQUIRED_PERFORMED_AT');
  end if;
  perform set_config('app.executing_service', 'automation:' || v_service, true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.command_id', '', true);
  v_row := app.insert_operational_evidence(p_kind, p_outcome, p_performed_at, p_subject_at, p_method, p_reference,
                                           p_notes, null, 'automation:' || v_service);
  return jsonb_build_object('status', 'Recorded', 'evidence_id', v_row.id, 'kind', v_row.kind, 'outcome', v_row.outcome);
end
$$;
grant execute on function app.record_operational_evidence(text, text, timestamptz, timestamptz, text, text, text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- States
-- -----------------------------------------------------------------------------

-- Evidence of one kind: no row -> Unknown; latest row Failed -> Failed; latest
-- row older than the threshold -> Stale (whatever it said); otherwise Verified.
create function app.evidence_state(p_kind text, p_label text, p_stale_days int, p_at timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_latest public.operational_evidence;
  v_last_ok public.operational_evidence;
  v_state text;
  v_detail text;
begin
  select * into v_latest from public.operational_evidence e
  where e.kind = p_kind and e.performed_at <= p_at order by e.performed_at desc, e.recorded_at desc limit 1;
  select * into v_last_ok from public.operational_evidence e
  where e.kind = p_kind and e.outcome = 'Verified' and e.performed_at <= p_at
  order by e.performed_at desc, e.recorded_at desc limit 1;

  if v_latest.id is null then
    v_state := 'Unknown';
    v_detail := 'No evidence has been recorded.';
  elsif v_latest.outcome = 'Failed' then
    v_state := 'Failed';
    v_detail := 'The latest check failed.';
  elsif v_latest.performed_at < p_at - make_interval(days => p_stale_days) then
    v_state := 'Stale';
    v_detail := 'The latest check is older than ' || p_stale_days || ' days.';
  else
    v_state := 'Verified';
    v_detail := 'Checked within the last ' || p_stale_days || ' days.';
  end if;

  return jsonb_build_object(
    'key', p_kind, 'label', p_label, 'state', v_state, 'detail', v_detail,
    'evidence_at', v_latest.performed_at, 'subject_at', v_latest.subject_at,
    'last_verified_at', v_last_ok.performed_at,
    'stale_after_days', p_stale_days,
    'method', v_latest.method, 'evidence_reference', v_latest.evidence_reference,
    'source', v_latest.source,
    'recorded_by', (select p.display_name from public.people p where p.id = v_latest.recorded_by),
    'executing_service', v_latest.executing_service);
end
$$;

-- pg_cron: is the sweep actually scheduled? null = cannot tell (no pg_cron here).
create function app.sweep_schedule()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_found boolean;
  v_active boolean;
begin
  if to_regclass('cron.job') is null then
    return null;
  end if;
  execute $q$select count(*) > 0, coalesce(bool_or(active), false) from cron.job where jobname = 'ss-resilience-sweep'$q$
    into v_found, v_active;
  return jsonb_build_object('scheduled', v_found, 'active', v_active);
exception when insufficient_privilege then
  return null;
end
$$;

-- Everything System Health needs, each item with evidence and a state.
create function app.operational_health(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items jsonb := '[]';
  v_check_minutes int := app.health_threshold('health.check_stale_minutes', 90, 10080);
  v_backup_days int := app.health_threshold('health.backup_verification_stale_days', 8, 366);
  v_drill_days int := app.health_threshold('health.restore_drill_stale_days', 90, 1100);
  v_monitoring boolean := app.mode_available('FN-14', 'Automated');
  v_check public.health_checks;
  v_sweep public.health_checks;
  v_cron jsonb := app.sweep_schedule();
  v_audit jsonb := app.audit_coverage();
  v_state text;
  v_detail text;
  v_modes jsonb;
  v_mode_problems text[] := '{}';
  v_fn text;
  v_n int;
  v_mode public.release_modes;
begin
  -- 1. Database: this function is running in it.
  v_items := v_items || jsonb_build_object('key', 'Database', 'label', 'Database', 'state', 'Verified',
    'detail', 'Answered this request.', 'evidence_at', clock_timestamp());

  -- 2. Latest recorded system health check (integration S16-system).
  select * into v_check from public.health_checks h
  where h.integration = 'S16-system' and h.checked_at <= p_at order by h.checked_at desc, h.created_at desc limit 1;
  if v_check.id is null then
    v_state := 'Unknown';
    v_detail := case when v_monitoring then 'No system health check has been recorded yet.'
                     else 'Health monitoring (FN-14) is not switched on, so no checks are being recorded.' end;
  elsif v_check.checked_at < p_at - make_interval(mins => v_check_minutes) then
    v_state := 'Stale';
    v_detail := 'No system health check for more than ' || v_check_minutes || ' minutes'
                || case when v_monitoring then '.' else ' (FN-14 is not switched on).' end;
  elsif v_check.outcome = 'Healthy' then
    v_state := 'Verified';
    v_detail := 'The latest check was healthy.';
  elsif v_check.outcome = 'Critical' then
    v_state := 'Failed';
    v_detail := 'The latest check found a critical problem' || coalesce(': ' || v_check.error_code, '') || '.';
  else
    -- A recent check that reported warnings ran, but it is not a pass.
    v_state := 'Failed';
    v_detail := 'The latest check did not pass: it reported warnings (' || v_check.outcome || ').';
  end if;
  v_items := v_items || jsonb_build_object('key', 'HealthCheck', 'label', 'System health check', 'state', v_state,
    'detail', v_detail, 'evidence_at', v_check.checked_at, 'outcome', v_check.outcome,
    'last_success_at', v_check.last_success, 'error_code', v_check.error_code, 'stale_after_minutes', v_check_minutes);

  -- 3. The scheduler that produces those checks.
  select * into v_sweep from public.health_checks h
  where h.integration = 'Processing:ResilienceSweep' and h.checked_at <= p_at
  order by h.checked_at desc, h.created_at desc limit 1;
  if not v_monitoring then
    v_state := 'Unknown';
    v_detail := 'Health monitoring (FN-14) is not switched on, so the background sweep does nothing.';
  elsif v_cron is not null and not (v_cron ->> 'scheduled')::boolean then
    v_state := 'Failed';
    v_detail := 'The background sweep is not scheduled in pg_cron.';
  elsif v_cron is not null and not (v_cron ->> 'active')::boolean then
    v_state := 'Failed';
    v_detail := 'The background sweep is scheduled but switched off in pg_cron.';
  elsif v_sweep.id is null then
    v_state := 'Unknown';
    v_detail := case when v_cron is null then 'No sweep has run, and this database has no pg_cron scheduler.'
                     else 'The background sweep has not run yet.' end;
  elsif v_sweep.outcome <> 'OK' then
    v_state := 'Failed';
    v_detail := 'The latest background sweep failed' || coalesce(': ' || v_sweep.error_code, '') || '.';
  elsif v_sweep.checked_at < p_at - make_interval(mins => v_check_minutes) then
    v_state := 'Stale';
    v_detail := 'The background sweep has not run for more than ' || v_check_minutes || ' minutes.';
  else
    v_state := 'Verified';
    v_detail := 'The background sweep is running.';
  end if;
  v_items := v_items || jsonb_build_object('key', 'Scheduler', 'label', 'Background scheduler', 'state', v_state,
    'detail', v_detail, 'evidence_at', v_sweep.checked_at, 'last_success_at', v_sweep.last_success,
    'pg_cron', v_cron, 'stale_after_minutes', v_check_minutes);

  -- 4. Release functions: read now, so the state is about consistency, and the
  --    modes themselves are reported as they are.
  foreach v_fn in array array['FN-13', 'FN-14', 'FN-16'] loop
    select count(*)::int into v_n from public.release_modes m where m.function_id = v_fn;
    if v_n <> 1 then
      v_mode_problems := v_mode_problems || (v_fn || ' missing or duplicated');
      continue;
    end if;
    select * into v_mode from public.release_modes m where m.function_id = v_fn;
    if (v_mode.mode = 'Disabled') <> (v_mode.authorised_job_scope = 'None') then
      v_mode_problems := v_mode_problems || (v_fn || ' inconsistent Disabled/scope');
    end if;
  end loop;
  select jsonb_build_object(
    'total', count(*), 'automated', count(*) filter (where m.mode = 'Automated'),
    'manual', count(*) filter (where m.mode = 'Manual'), 'disabled', count(*) filter (where m.mode = 'Disabled'),
    'health_functions', coalesce(jsonb_agg(jsonb_build_object('function_id', m.function_id, 'mode', m.mode,
        'scope', m.authorised_job_scope) order by m.function_id)
        filter (where m.function_id in ('FN-13', 'FN-14', 'FN-16')), '[]'::jsonb))
    into v_modes from public.release_modes m;
  v_items := v_items || jsonb_build_object('key', 'ReleaseFunctions', 'label', 'Release functions',
    'state', case when cardinality(v_mode_problems) = 0 then 'Verified' else 'Failed' end,
    'detail', case when cardinality(v_mode_problems) > 0 then array_to_string(v_mode_problems, '; ') || '.'
                   else (v_modes ->> 'automated') || ' automated, ' || (v_modes ->> 'manual') || ' manual, '
                        || (v_modes ->> 'disabled') || ' switched off. Health monitoring (FN-14) is '
                        || case when v_monitoring then 'on.' else 'not switched on.' end end,
    'evidence_at', clock_timestamp(), 'modes', v_modes, 'monitoring_enabled', v_monitoring);

  -- 5. Audit triggers still installed.
  v_items := v_items || jsonb_build_object('key', 'AuditCoverage', 'label', 'Audit trail coverage',
    'state', v_audit ->> 'state',
    'detail', case when v_audit ->> 'state' = 'Verified'
                   then 'All ' || (v_audit ->> 'required_tables') || ' audited tables have their triggers.'
                   else 'Audit triggers are missing: ' || coalesce((select string_agg(m ->> 'table', ', ')
                          from jsonb_array_elements(v_audit -> 'missing') m), '')
                        || case when jsonb_array_length(v_audit -> 'append_only_guards_missing') > 0
                                then ' (audit log guards missing)' else '' end || '.' end,
    'evidence_at', clock_timestamp(), 'coverage', v_audit);

  -- 6-9. Backups and recovery: recorded evidence only.
  v_items := v_items
    || app.evidence_state('DatabaseBackup', 'Database backup verified', v_backup_days, p_at)
    || app.evidence_state('DatabaseRestoreDrill', 'Database recovery tested', v_drill_days, p_at)
    || app.evidence_state('StorageBackup', 'File storage backup verified', v_backup_days, p_at)
    || app.evidence_state('StorageRestoreDrill', 'File storage recovery tested', v_drill_days, p_at);

  return jsonb_build_object(
    'generated_at', p_at,
    'overall_state', (select case when bool_or(i ->> 'state' = 'Failed') then 'Failed'
                                  when bool_or(i ->> 'state' = 'Stale') then 'Stale'
                                  when bool_or(i ->> 'state' = 'Unknown') then 'Unknown'
                                  else 'Verified' end from jsonb_array_elements(v_items) i),
    'counts', (select jsonb_object_agg(s, (select count(*) from jsonb_array_elements(v_items) i where i ->> 'state' = s))
               from unnest(array['Verified', 'Stale', 'Failed', 'Unknown']) s),
    'thresholds', jsonb_build_object('check_stale_minutes', v_check_minutes,
                                     'backup_verification_stale_days', v_backup_days,
                                     'restore_drill_stale_days', v_drill_days),
    'items', v_items);
end
$$;
grant execute on function app.operational_health(timestamptz) to service_role;

-- The recorded health evaluation now also degrades on stale / failed / missing
-- operational evidence, so the S16-system row cannot be Healthy without it.
-- (Only the HealthCheck and Scheduler items are skipped: they describe the very
-- check being evaluated; "no prior check" is already a warning of its own.)
alter function app.health_status(timestamptz) rename to health_status_s16;

create function app.health_status(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_health jsonb := app.health_status_s16(p_at);
  v_ops jsonb := app.operational_health(p_at);
  v_item jsonb;
  v_issues jsonb := v_health -> 'issues';
  v_warnings jsonb := v_health -> 'warnings';
  v_alert jsonb;
begin
  for v_item in select i from jsonb_array_elements(v_ops -> 'items') i
                where i ->> 'key' not in ('Database', 'HealthCheck', 'Scheduler', 'ReleaseFunctions')
                  and i ->> 'state' <> 'Verified' loop
    v_alert := jsonb_build_object('component', 'Operational:' || (v_item ->> 'key'),
                                  'detail', (v_item ->> 'state') || ': ' || (v_item ->> 'detail'),
                                  'severity', case when v_item ->> 'key' = 'AuditCoverage' then 'Critical' else 'Warning' end);
    if v_alert ->> 'severity' = 'Critical' then
      v_issues := v_issues || jsonb_build_array(v_alert);
    else
      v_warnings := v_warnings || jsonb_build_array(v_alert);
    end if;
  end loop;
  return v_health || jsonb_build_object(
    'overall', case when jsonb_array_length(v_issues) > 0 then 'Critical'
                    when jsonb_array_length(v_warnings) > 0 then 'Degraded' else 'Healthy' end,
    'error_code', case when jsonb_array_length(v_issues) > 0
                       then (v_issues -> 0 ->> 'component') || '_' || left(v_issues -> 0 ->> 'detail', 20) end,
    'critical_count', jsonb_array_length(v_issues),
    'warning_count', jsonb_array_length(v_warnings),
    'issues', v_issues, 'warnings', v_warnings,
    'operational', v_ops);
end
$$;
grant execute on function app.health_status(timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- SYSTEM_STATUS read model (replaces 20260919149000's): same keys, plus
-- 'operational'. Two changes to what it already returned:
--   * health.latest_check was the newest health_checks row of ANY integration
--     (usually a heartbeat saying 'OK'); it is now the latest S16-system
--     evaluation, with its state.
--   * the Apps Script entries "Backup Drive destination" and "Destructive
--     restore procedure" are replaced by the evidence they stood for.
-- -----------------------------------------------------------------------------

create or replace function app.read_system_status()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ops jsonb := app.operational_health(now());
  v_check jsonb := (select i from jsonb_array_elements(v_ops -> 'items') i where i ->> 'key' = 'HealthCheck');
  v_item jsonb;
  v_not_configured jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.ghl_tasks g where nullif(g.opportunity_id, 'NOT_CONFIGURED') is not null) then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'GHL pipeline/stage IDs', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No GHL opportunity_id configured');
  end if;
  if not exists (select 1 from public.invoice_stages s where nullif(s.xero_invoice_id, 'NOT_CONFIGURED') is not null) then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'Xero API integration', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No real Xero invoice IDs present');
  end if;
  for v_item in select i from jsonb_array_elements(v_ops -> 'items') i
                where i ->> 'key' in ('DatabaseBackup', 'DatabaseRestoreDrill', 'StorageBackup', 'StorageRestoreDrill')
                  and i ->> 'state' = 'Unknown' loop
    v_not_configured := v_not_configured || jsonb_build_object('area', v_item ->> 'label', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No evidence has been recorded');
  end loop;
  if not exists (select 1 from public.commissioning_templates) then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'Commissioning templates/forms', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No commissioning templates present');
  end if;
  if not exists (select 1 from public.contacts c join public.companies co on co.id = c.company_id where co.type = 'Scaffolder') then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'Scaffolder contacts', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No scaffolder company contacts configured');
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'health', jsonb_build_object(
      'latest_check', case when v_check ->> 'evidence_at' is null then null else jsonb_build_object(
        'checked_at', v_check -> 'evidence_at', 'outcome', v_check -> 'outcome', 'last_success', v_check -> 'last_success_at',
        'error_code', v_check -> 'error_code', 'integration', 'S16-system', 'state', v_check -> 'state') end,
      'state', v_check -> 'state',
      'detail', v_check -> 'detail',
      'total_checks', (select count(*) from public.health_checks)),
    'operational', v_ops,
    'commit_journal', jsonb_build_object(
      'stalled', (select count(*) from public.commit_journal where state <> 'Committed'),
      'recovery_required', (select count(*) from public.commit_journal where state = 'RecoveryRequired'),
      'recovery_ids', (select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb)
                       from public.commit_journal where state = 'RecoveryRequired')),
    'outbox', jsonb_build_object(
      'uncertain', (select count(*) from public.outbox where status in ('NeedsReview', 'RetryDue')),
      'uncertain_ids', (select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb)
                        from public.outbox where status in ('NeedsReview', 'RetryDue'))),
    'not_configured', v_not_configured,
    'not_configured_count', jsonb_array_length(v_not_configured));
end
$$;

-- -----------------------------------------------------------------------------
-- Liveness for an external monitor: GET /api/health calls this as anon. It says
-- only that the database answered, and the four coarse states - no details, no
-- names, no references.
-- -----------------------------------------------------------------------------

create function public.health_ping()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ops jsonb := app.operational_health(now());
  v_state jsonb;
begin
  select jsonb_object_agg(i ->> 'key', i ->> 'state') into v_state from jsonb_array_elements(v_ops -> 'items') i;
  return jsonb_build_object('database', 'responding', 'database_time', now(),
                            'overall_state', v_ops -> 'overall_state', 'states', v_state);
end
$$;
revoke execute on function public.health_ping() from public;
grant execute on function public.health_ping() to anon, authenticated, service_role;

-- Staff wording for the new refusals.
alter function app.result_error_catalogue() rename to result_error_catalogue_pre_ops;
create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_ops() || '{
  "R1A_REQUIRED_KIND": ["ActionRequired", "Choose what was checked and try again."],
  "R1A_REQUIRED_OUTCOME": ["ActionRequired", "Say whether the check passed or failed and try again."],
  "R1A_REQUIRED_PERFORMED_AT": ["ActionRequired", "Enter when the check was carried out and try again."],
  "R1A_REQUIRED_METHOD": ["ActionRequired", "Say how it was checked and try again."],
  "R1A_REQUIRED_EVIDENCE_REFERENCE": ["ActionRequired", "Say where the proof is kept and try again."]
}'::jsonb
$$;
grant execute on function app.result_error_catalogue() to authenticated, service_role;
