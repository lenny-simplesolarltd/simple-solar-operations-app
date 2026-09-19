-- =============================================================================
-- Backend port, S16 health / heartbeat / daily system tasks + resilience
-- review queue (release R1: FN-14 Automated, FN-16 Manual).
--
-- Reference: s16/health.js (_s16HealthStatus, _s16SystemTasks),
-- s16/heartbeat.js, processor/health.js, processor/outbox.js,
-- resilience/review.js, resilience/cloud-adapter.js (runRsSweep).
-- Survey: REF-02 §6.2-6.3, §9, §11; REF-03 §1.1 (S16), §11.9, §11.14.
--
-- How health is recorded (all rows in public.health_checks, append-only):
--   * integration 'S16-system'        one row per health evaluation; outcome
--                                     Healthy | Degraded | Critical.
--   * integration 'Processing:<comp>' a processing heartbeat of a system
--                                     component (outcome 'OK' or a short failure
--                                     code). Written by app.record_heartbeat;
--                                     the schedulers below write their own
--                                     ('ResilienceSweep', 'SystemTasks').
--                                     Workers (Edge Functions) call it too.
--   * any other integration name      an integration check (processor/health.js
--                                     recordHealthCheck) via
--                                     app.record_integration_check.
--   last_success is carried forward from the latest prior success of the same
--   integration whenever the outcome is not a success.
--
-- Scheduling: pg_cron jobs installed by the integration migration
-- 20260919150000 (app.run_resilience_sweep() every 30 min,
-- app.run_system_tasks() daily at 05:00 UTC).
-- Both run with no human actor: initiating_person_id is null on every audit row
-- and executing_service names the scheduler.
--
-- Not ported (platform plumbing): the backup manifest / validation / restore
-- plan (Supabase backups and PITR), FN-13 archive (R4, separate release),
-- DEV sheet guards, ScriptLock, the CommitJournal RecoveryRequired / stuck
-- commit checks and RS-RECOVERY tasks: every command is one database
-- transaction, so a command is either committed (one public.commands ledger
-- row) or left no trace (REF-02 §6.1 classification).
--
-- Task ownership: SYS01/SYS02/RS-REVIEW/RS-ALERT owners and backups come from
-- the template's task_assignment_rules row (app.create_task_instance with a
-- null owner; a missing/ineligible rule fails TASK_ASSIGNMENT_CONFIG).
-- =============================================================================

-- Heartbeats are idempotent per (integration, caller key) in the reference
-- (HealthChecks id 'HB-{component}-{command_id}'). The ported table has no
-- text id, so the key gets its own nullable unique column.
alter table public.health_checks add column idempotency_key text;
create unique index health_checks_idempotency_key_idx on public.health_checks (idempotency_key)
  where idempotency_key is not null;
comment on column public.health_checks.idempotency_key is
  'Caller key "<integration>/<key>" making a heartbeat/integration check write idempotent (reference HB-{component}-{command_id}).';

-- -----------------------------------------------------------------------------
-- Settings and the staffed window
-- -----------------------------------------------------------------------------

-- health.heartbeat_stale_minutes: 0 < v <= 10080, otherwise the default 120
-- (s16/heartbeat.js:78-89).
create function app.heartbeat_stale_minutes()
returns int
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb := app.setting('health.heartbeat_stale_minutes');
  v_n numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return 120;
  end if;
  begin
    v_n := btrim(v #>> '{}')::numeric;
  exception when others then
    return 120;
  end;
  if v_n is null or v_n <= 0 or v_n > 10080 then
    return 120;
  end if;
  return floor(v_n)::int;
end
$$;

-- Staffed window at an instant (Europe/London): a staffed day
-- (office.staffed_weekdays + office-closed holidays, app.is_staffed_day) and
-- office.hours start inclusive .. end exclusive, default 09:00-17:00
-- (s16/heartbeat.js:128-138).
create function app.staffed_window(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hours jsonb := app.setting('office.hours');
  v_start text := '09:00';
  v_end text := '17:00';
  v_date date := app.london_date(p_at);
  v_time text := to_char(p_at at time zone 'Europe/London', 'HH24:MI');
  v_reason text;
begin
  if jsonb_typeof(v_hours) = 'string' then
    begin
      v_hours := (v_hours #>> '{}')::jsonb;
    exception when others then
      v_hours := null;
    end;
  end if;
  if jsonb_typeof(v_hours) = 'object' and v_hours ->> 'start' ~ '^\d{2}:\d{2}$' and v_hours ->> 'end' ~ '^\d{2}:\d{2}$' then
    v_start := v_hours ->> 'start';
    v_end := v_hours ->> 'end';
  end if;
  if not app.is_staffed_day(v_date) then
    v_reason := case when exists (select 1 from public.holidays h where h.local_date = v_date and h.office_closed)
                     then 'OFFICE_HOLIDAY' else 'NOT_STAFFED_WEEKDAY' end;
  elsif v_time < v_start or v_time >= v_end then
    v_reason := 'OUTSIDE_OFFICE_HOURS';
  end if;
  return jsonb_build_object('staffed', v_reason is null, 'reason', v_reason, 'local_date', v_date,
                            'local_time', v_time, 'hours', jsonb_build_object('start', v_start, 'end', v_end));
end
$$;

-- -----------------------------------------------------------------------------
-- Recording integration checks and heartbeats (FN-14)
-- -----------------------------------------------------------------------------

-- processor/health.js recordHealthCheck + s16/heartbeat.js _s16RecordHeartbeat:
-- one row per check; success outcome 'OK' sets last_success, anything else
-- carries the latest prior success forward. With a key the write is
-- idempotent: the same (integration, key) returns the stored row.
create function app.record_integration_check(p_integration text, p_outcome text default 'OK',
                                             p_error_code text default null, p_key text default null,
                                             p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration text := nullif(btrim(p_integration), '');
  v_outcome text := coalesce(nullif(btrim(p_outcome), ''), 'OK');
  v_key text := nullif(btrim(p_key), '');
  v_idem text;
  v_prior timestamptz;
  v_error text;
  v_row public.health_checks;
begin
  perform app.require_mode('FN-14', 'Automated');
  if v_integration is null or length(v_integration) > 80 then
    perform app.fail('S16_REVIEW: integration required');
  end if;
  if v_outcome !~ '^[A-Za-z0-9_]{1,40}$' then
    perform app.fail('S16_REVIEW: outcome must be a short code');
  end if;
  if v_key is not null then
    if length(v_key) > 120 then
      perform app.fail('S16_REVIEW: command_id too long');
    end if;
    v_idem := v_integration || '/' || v_key;
    select * into v_row from public.health_checks h where h.idempotency_key = v_idem;
    if found then
      return jsonb_build_object('created', false, 'replay', true, 'health_check_id', v_row.id,
                                'integration', v_row.integration, 'outcome', v_row.outcome,
                                'checked_at', v_row.checked_at, 'last_success', v_row.last_success,
                                'error_code', v_row.error_code);
    end if;
  end if;
  if v_outcome <> 'OK' then
    v_error := coalesce(left(nullif(btrim(regexp_replace(p_error_code, '\s+', ' ', 'g')), ''), 200), v_outcome);
  end if;
  select max(h.last_success) into v_prior from public.health_checks h where h.integration = v_integration;
  insert into public.health_checks (integration, checked_at, outcome, last_success, error_code, idempotency_key)
  values (v_integration, p_at, v_outcome, case when v_outcome = 'OK' then p_at else v_prior end, v_error, v_idem)
  returning * into v_row;
  return jsonb_build_object('created', true, 'replay', false, 'health_check_id', v_row.id,
                            'integration', v_row.integration, 'outcome', v_row.outcome,
                            'checked_at', v_row.checked_at, 'last_success', v_row.last_success,
                            'error_code', v_row.error_code);
end
$$;

-- Component names: 1-48 letters, digits, _ or - (s16/heartbeat.js:36-41).
create function app.heartbeat_component(p_component text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_component), '');
begin
  if v is null then
    perform app.fail('S16_REVIEW: component required');
  end if;
  if v !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$' then
    perform app.fail('S16_REVIEW: component must be 1-48 chars of letters, digits, _ or -');
  end if;
  return v;
end
$$;

-- A processing heartbeat: health_checks row with integration
-- 'Processing:<component>'. p_key (the reference command_id) makes it
-- idempotent; null records unconditionally.
create function app.record_heartbeat(p_component text, p_outcome text default 'OK',
                                     p_error_code text default null, p_key text default null,
                                     p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_component text := app.heartbeat_component(p_component);
begin
  return app.record_integration_check('Processing:' || v_component, p_outcome, p_error_code, p_key, p_at)
         || jsonb_build_object('component', v_component);
end
$$;

-- Fail-safe heartbeat (s16/heartbeat.js _s16WithHeartbeat): a heartbeat
-- refusal is reported, never raised, so it cannot mask the processing result.
create function app.try_heartbeat(p_component text, p_outcome text, p_error_code text,
                                  p_key text, p_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.record_heartbeat(p_component, p_outcome, p_error_code, p_key, p_at);
exception when others then
  return jsonb_build_object('heartbeat_error', sqlerrm);
end
$$;

-- -----------------------------------------------------------------------------
-- Heartbeat status (read-only; s16/heartbeat.js _s16HeartbeatStatus)
--
-- Per component: Never (expected, no rows) | Failing (latest outcome not OK) |
-- Stale (no success within the threshold, inside the staffed window) | Quiet
-- (same, outside it) | Fresh. Alerts: Failing -> Critical when also stale
-- inside the staffed window, else Warning; Stale -> Warning; Never -> Warning
-- only inside the staffed window.
-- -----------------------------------------------------------------------------

create function app.heartbeat_status(p_at timestamptz default now(), p_expected text[] default '{}')
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_stale_minutes int := app.heartbeat_stale_minutes();
  v_window jsonb := app.staffed_window(p_at);
  v_staffed boolean := (v_window ->> 'staffed')::boolean;
  v_expected text[] := '{}';
  v_name text;
  r record;
  v_age int;
  v_aged boolean;
  v_stale boolean;
  v_state text;
  v_error text;
  v_components jsonb := '[]';
  v_alerts jsonb := '[]';
  v_summary jsonb := '{"fresh":0,"stale":0,"failing":0,"quiet":0,"never":0}';
begin
  foreach v_name in array coalesce(p_expected, '{}'::text[]) loop
    v_expected := v_expected || app.heartbeat_component(v_name);
  end loop;
  for r in
    with hb as (
      select substr(h.integration, 12) as comp, h.outcome, h.error_code, h.checked_at, h.last_success, h.created_at
      from public.health_checks h where h.integration like 'Processing:%'),
    comps as (select hb.comp from hb union select unnest(v_expected)),
    latest as (
      select distinct on (hb.comp) hb.comp, hb.outcome, hb.error_code, hb.checked_at
      from hb order by hb.comp, hb.checked_at desc, hb.created_at desc),
    agg as (select hb.comp, count(*)::int as n, max(hb.last_success) as ls from hb group by hb.comp)
    select c.comp, coalesce(a.n, 0) as n, a.ls, l.outcome, l.error_code, l.checked_at
    from comps c left join latest l on l.comp = c.comp left join agg a on a.comp = c.comp
    order by c.comp
  loop
    v_age := case when r.ls is null then null else floor(extract(epoch from (p_at - r.ls)) / 60)::int end;
    v_error := null;
    if r.outcome is null then
      v_state := 'Never';
      v_stale := false;
    else
      v_aged := r.ls is null or v_age > v_stale_minutes;
      v_stale := v_aged and v_staffed;
      if r.outcome <> 'OK' then
        v_state := 'Failing';
        v_error := coalesce(r.error_code, r.outcome);
      elsif v_aged then
        v_state := case when v_staffed then 'Stale' else 'Quiet' end;
      else
        v_state := 'Fresh';
      end if;
    end if;
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component', r.comp, 'integration', 'Processing:' || r.comp, 'checks', r.n,
      'latest_outcome', r.outcome, 'last_checked_at', r.checked_at, 'last_success_at', r.ls,
      'age_minutes', v_age, 'error_code', v_error, 'state', v_state, 'stale', v_stale));
    v_summary := jsonb_set(v_summary, array[lower(v_state)], to_jsonb((v_summary ->> lower(v_state))::int + 1));
    if v_state = 'Failing' then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'severity', case when v_stale then 'Critical' else 'Warning' end,
        'component', 'Heartbeat:' || r.comp, 'state', v_state,
        'detail', 'Last processing attempt failed (' || v_error || ')'
                  || case when v_stale then '; no success for ' || coalesce(v_age::text, 'unknown') || ' min' else '' end,
        'last_success_at', r.ls));
    elsif v_state = 'Stale' then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'severity', 'Warning', 'component', 'Heartbeat:' || r.comp, 'state', v_state,
        'detail', case when r.ls is null then 'No successful processing recorded'
                       else 'No successful processing for ' || v_age || ' min (threshold ' || v_stale_minutes || ')' end,
        'last_success_at', r.ls));
    elsif v_state = 'Never' and v_staffed then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'severity', 'Warning', 'component', 'Heartbeat:' || r.comp, 'state', v_state,
        'detail', 'Expected component has never recorded a heartbeat', 'last_success_at', null));
    end if;
  end loop;
  return jsonb_build_object(
    'generated_at', p_at, 'stale_minutes', v_stale_minutes, 'staffed_window', v_window,
    'components', v_components, 'alerts', v_alerts, 'alert_count', jsonb_array_length(v_alerts),
    'critical_count', (select count(*) from jsonb_array_elements(v_alerts) a where a ->> 'severity' = 'Critical'),
    'summary', v_summary);
end
$$;

-- -----------------------------------------------------------------------------
-- System health (s16/health.js _s16HealthStatus)
-- -----------------------------------------------------------------------------

-- Read-only evaluation. Critical = any issue, Degraded = any warning, else
-- Healthy. Sources: outbox NeedsReview/RetryDue and Processing-with-attempts
-- (warnings), communications Uncertain/Failed (warning), heartbeat alerts
-- (Critical -> issue, else warning), no prior system check (warning),
-- inconsistent S16 release modes (issue). The reference's CommitJournal
-- RecoveryRequired / in-flight checks do not exist here (single-transaction
-- commands).
create function app.health_status(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_issues jsonb := '[]';
  v_warnings jsonb := '[]';
  v_hb jsonb := app.heartbeat_status(p_at);
  v_alert jsonb;
  v_ids jsonb;
  v_uncertain int;
  v_failed int;
  v_comms int;
  v_last_check timestamptz;
  v_prior_success timestamptz;
  v_mode_issues text[] := '{}';
  v_fn text;
  v_count int;
  v_mode public.release_modes;
  v_overall text;
begin
  select count(*)::int, coalesce(jsonb_agg(o.id order by o.created_at), '[]') into v_uncertain, v_ids
  from public.outbox o where o.status in ('NeedsReview', 'RetryDue');
  if v_uncertain > 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('severity', 'Warning', 'component', 'Outbox',
      'detail', v_uncertain || ' uncertain/needs-review outbox rows', 'ids', v_ids));
  end if;

  select count(*)::int, coalesce(jsonb_agg(o.id order by o.created_at), '[]') into v_failed, v_ids
  from public.outbox o where o.status = 'Processing' and o.attempt_count > 0;
  if v_failed > 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('severity', 'Warning', 'component', 'Outbox',
      'detail', v_failed || ' processing with retries', 'ids', v_ids));
  end if;

  -- Added for the port: uncertain/failed communications are in the review
  -- queue (resilience/review.js:67) and now also degrade health.
  select count(*)::int, coalesce(jsonb_agg(c.id order by c.updated_at), '[]') into v_comms, v_ids
  from public.communications c where c.status in ('Uncertain', 'Failed');
  if v_comms > 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('severity', 'Warning', 'component', 'Communications',
      'detail', v_comms || ' uncertain/failed communications', 'ids', v_ids));
  end if;

  for v_alert in select a from jsonb_array_elements(v_hb -> 'alerts') a loop
    if v_alert ->> 'severity' = 'Critical' then
      v_issues := v_issues || jsonb_build_array(v_alert);
    else
      v_warnings := v_warnings || jsonb_build_array(v_alert);
    end if;
  end loop;

  select max(h.checked_at), max(h.last_success) into v_last_check, v_prior_success
  from public.health_checks h where h.integration = 'S16-system';
  if v_last_check is null then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('severity', 'Warning', 'component', 'HealthChecks',
      'detail', 'No prior S16 system health check recorded'));
  end if;

  foreach v_fn in array array['FN-13', 'FN-14', 'FN-16'] loop
    select count(*)::int into v_count from public.release_modes m where m.function_id = v_fn;
    if v_count <> 1 then
      v_mode_issues := v_mode_issues || (v_fn || ' missing or duplicated');
      continue;
    end if;
    select * into v_mode from public.release_modes m where m.function_id = v_fn;
    if (v_mode.mode = 'Disabled') <> (v_mode.authorised_job_scope = 'None') then
      v_mode_issues := v_mode_issues || (v_fn || ' inconsistent Disabled/scope');
    end if;
  end loop;
  if cardinality(v_mode_issues) > 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('severity', 'Critical', 'component', 'ReleaseModes',
      'detail', array_to_string(v_mode_issues, '; ')));
  end if;

  v_overall := case when jsonb_array_length(v_issues) > 0 then 'Critical'
                    when jsonb_array_length(v_warnings) > 0 then 'Degraded'
                    else 'Healthy' end;

  return jsonb_build_object(
    'checked_at', p_at,
    'overall', v_overall,
    'last_health_check', v_last_check,
    'prior_last_success', v_prior_success,
    'error_code', case when jsonb_array_length(v_issues) > 0
                       then (v_issues -> 0 ->> 'component') || '_' || left(v_issues -> 0 ->> 'detail', 20) end,
    'critical_count', jsonb_array_length(v_issues),
    'warning_count', jsonb_array_length(v_warnings),
    'issues', v_issues,
    'warnings', v_warnings,
    'heartbeats', jsonb_build_object('stale_minutes', v_hb -> 'stale_minutes',
                                     'staffed', v_hb -> 'staffed_window' -> 'staffed',
                                     'components', v_hb -> 'components', 'summary', v_hb -> 'summary'),
    'summary', jsonb_build_object(
      'uncertain_outbox', v_uncertain, 'failed_outbox', v_failed, 'uncertain_communications', v_comms,
      'heartbeat_components', jsonb_array_length(v_hb -> 'components'),
      'heartbeat_alerts', v_hb -> 'alert_count',
      'total_outbox', (select count(*) from public.outbox)));
end
$$;

-- Writes the 'S16-system' row for an evaluation.
-- Deviation: a non-Healthy check carries forward the previous system
-- last_success (processor/health.js; REF-02 §6.3 "last_success carried forward
-- on failure"); s16/health.js:177 stored the last *check* time instead, which
-- would report a success that never happened.
create function app.record_health(p_health jsonb, p_next_action_task_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := (p_health ->> 'checked_at')::timestamptz;
  v_id uuid;
begin
  insert into public.health_checks (integration, checked_at, outcome, last_success, error_code, next_action_task_id)
  values ('S16-system', v_at, p_health ->> 'overall',
          case when p_health ->> 'overall' = 'Healthy' then v_at else (p_health ->> 'prior_last_success')::timestamptz end,
          p_health ->> 'error_code', p_next_action_task_id)
  returning id into v_id;
  return v_id;
end
$$;

-- Evaluate and record (FN-14 Automated). Alerts are not raised here: the
-- S16 health check never creates tasks (REF-03 §1.1); the sweep does.
create function app.evaluate_health(p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_health jsonb;
begin
  perform app.require_mode('FN-14', 'Automated');
  v_health := app.health_status(p_at);
  return v_health || jsonb_build_object('health_id', app.record_health(v_health, null));
end
$$;

-- -----------------------------------------------------------------------------
-- Resilience review queue (read-only; resilience/review.js _rsReviewQueue)
-- -----------------------------------------------------------------------------

create function app.review_queue(p_at timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_pending int;
  v_oldest timestamptz;
  v_last_check timestamptz;
  v_last_success timestamptz;
begin
  with ob as (
    select o.*, floor(extract(epoch from (p_at - o.created_at)) / 60)::int as age,
           (o.status = 'Processing' and o.created_at <= p_at - interval '15 minutes') as stalled
    from public.outbox o
    where o.status in ('NeedsReview', 'RetryDue', 'Processing')),
  items as (
    select jsonb_build_object(
             'kind', 'Outbox', 'id', ob.id, 'action_type', ob.action_type,
             'status', case when ob.stalled then 'ProcessingStalled' else ob.status end,
             'attempts', ob.attempt_count, 'target', ob.target, 'summary', ob.response_summary,
             'external_id', ob.external_id, 'age_minutes', ob.age,
             'job_id', (select j.id from public.jobs j
                        where j.id::text = ob.correlation_id or j.job_ref = ob.correlation_id limit 1),
             'owner_service', case when ob.action_type in ('CalendarCreate', 'CalendarUpdate', 'CalendarCancel')
                                   then 'CalendarService' else 'ResilienceReview' end,
             'suggested', case when ob.status = 'RetryDue' then 'Wait for automatic retry; review if attempts exhaust'
                               when ob.stalled then 'Reconcile by external id/reference before retry'
                               else 'Resolve: confirm external result, cancel, or retry' end) as item,
           ob.age
    from ob
    where ob.status <> 'Processing' or ob.stalled
    union all
    select jsonb_build_object(
             'kind', 'Communications', 'id', c.id, 'action_type', c.type, 'status', c.status,
             'summary', c.subject, 'external_id', c.external_message_id,
             'age_minutes', floor(extract(epoch from (p_at - c.updated_at)) / 60)::int,
             'job_id', c.job_id, 'owner_service', 'ResilienceReview',
             'suggested', 'Confirm with recipient before resending; a sent message is not supplier confirmation'),
           floor(extract(epoch from (p_at - c.updated_at)) / 60)::int
    from public.communications c
    where c.status in ('Uncertain', 'Failed'))
  select coalesce(jsonb_agg(items.item order by coalesce(items.age, 0) desc), '[]') into v_items from items;

  select count(*)::int, min(o.created_at) into v_pending, v_oldest from public.outbox o where o.status = 'Pending';
  select max(h.checked_at), max(h.last_success) into v_last_check, v_last_success from public.health_checks h;

  return jsonb_build_object(
    'generated_at', p_at,
    'count', jsonb_array_length(v_items),
    'items', v_items,
    'by_kind', coalesce((select jsonb_object_agg(k.kind, k.n) from (
                  select i ->> 'kind' as kind, count(*) as n from jsonb_array_elements(v_items) i group by 1) k), '{}'),
    'indicators', jsonb_build_object(
      'pending_outbox', v_pending,
      'oldest_pending_outbox_at', v_oldest,
      'oldest_pending_outbox_minutes', case when v_oldest is null then null
                                            else floor(extract(epoch from (p_at - v_oldest)) / 60)::int end,
      'last_health_check_at', v_last_check,
      'last_health_success_at', v_last_success));
end
$$;

-- -----------------------------------------------------------------------------
-- Review tasks (resilience/review.js _rsRaiseReviewTasks)
--
-- One open RS-REVIEW task per uncertain item; RetryDue items are left to the
-- automatic retry. Owner/backup = the RS-REVIEW task_assignment_rules row
-- (never display-name matching, REF-02 §11 / REF-03 §11.14).
-- Deviation: instance keys are unique forever here, so an item that needs
-- review again after its task was closed gets an episode suffix
-- 'RS-REVIEW-{kind}-{id}-E{n}' (the reference re-inserted the same key/id).
-- -----------------------------------------------------------------------------

create function app.raise_review_tasks(p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue jsonb := app.review_queue(p_at);
  v_item jsonb;
  v_kind text;
  v_id uuid;
  v_open uuid;
  v_n int;
  v_key text;
  v_task_id uuid;
  v_task public.tasks;
  v_created jsonb := '[]';
  v_reused jsonb := '[]';
begin
  for v_item in select i from jsonb_array_elements(v_queue -> 'items') i loop
    if v_item ->> 'status' = 'RetryDue' then
      continue;
    end if;
    v_kind := v_item ->> 'kind';
    v_id := (v_item ->> 'id')::uuid;
    select t.id into v_open from public.tasks t
    where t.template_code = 'RS-REVIEW' and t.related_entity_type = v_kind and t.related_entity_id = v_id
      and t.status not in ('Complete', 'Cancelled', 'NotRequired')
    order by t.created_at limit 1;
    if v_open is not null then
      v_reused := v_reused || jsonb_build_array(jsonb_build_object('task_id', v_open, 'kind', v_kind, 'id', v_id));
      continue;
    end if;
    select count(*)::int into v_n from public.tasks t
    where t.template_code = 'RS-REVIEW' and t.related_entity_type = v_kind and t.related_entity_id = v_id;
    v_key := 'RS-REVIEW-' || v_kind || '-' || v_id || case when v_n > 0 then '-E' || (v_n + 1) else '' end;
    v_task_id := app.create_task_instance(
      (v_item ->> 'job_id')::uuid, 'RS-REVIEW', v_key, null, null, p_at, 1,
      'Review uncertain outbound outcome — ' || coalesce(v_item ->> 'action_type', v_kind) || ' ' || v_id
        || ' (' || (v_item ->> 'status') || ')',
      'System', v_kind, v_id, 'Open', null, false, 'RS-1.0');
    if v_task_id is null then
      select t.id into v_task_id from public.tasks t where t.instance_key = v_key;
      v_reused := v_reused || jsonb_build_array(jsonb_build_object('task_id', v_task_id, 'kind', v_kind, 'id', v_id));
      continue;
    end if;
    select * into v_task from public.tasks where id = v_task_id;
    perform app.audit('Tasks', v_task_id::text, 'RaiseReviewTask', null, to_jsonb(v_task),
                      'Uncertain outbound outcome needs human review');
    v_created := v_created || jsonb_build_array(jsonb_build_object('task_id', v_task_id, 'kind', v_kind, 'id', v_id));
  end loop;
  return jsonb_build_object('created', v_created, 'reused', v_reused, 'queue_count', v_queue -> 'count',
                            'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Failure alerts (resilience/review.js _rsFailureAlerts)
--
-- One RS-ALERT task per component per Europe/London calendar day from: the
-- health evaluation's issues (Critical) and Failing/Stale heartbeat warnings;
-- any heartbeat whose latest outcome is not OK with no success inside the
-- threshold (Critical); outbox NeedsReview rows that exhausted retries
-- (attempts >= 5, Warning). The reference's CommitJournal RecoveryRequired
-- source does not exist here.
-- Deviation: the alert day is the London date (REF-02 §9 and §12 Q10: the
-- reference sliced the UTC ISO string, wrong around midnight in BST).
-- -----------------------------------------------------------------------------

create function app.raise_failure_alerts(p_health jsonb, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day text := to_char(app.london_date(p_at), 'YYYY-MM-DD');
  v_alerts jsonb := '[]';
  v_x jsonb;
  v_age int;
  v_stale int := app.heartbeat_stale_minutes();
  v_exhausted int;
  v_key text;
  v_task_id uuid;
  v_task public.tasks;
  v_created jsonb := '[]';
  v_reused jsonb := '[]';
begin
  if p_health is not null then
    for v_x in select i from jsonb_array_elements(coalesce(p_health -> 'issues', '[]')) i loop
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'component', v_x ->> 'component', 'severity', 'Critical', 'detail', v_x ->> 'detail'));
    end loop;
    for v_x in select w from jsonb_array_elements(coalesce(p_health -> 'warnings', '[]')) w loop
      if v_x ->> 'component' like 'Heartbeat:%' and v_x ->> 'state' in ('Failing', 'Stale') then
        v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
          'component', v_x ->> 'component', 'severity', 'Warning', 'detail', v_x ->> 'detail'));
      end if;
    end loop;
  end if;

  for v_x in
    select jsonb_build_object('component', 'Heartbeat:' || l.comp, 'outcome', l.outcome, 'last_success', s.ls) as x
    from (select distinct on (h.integration) substr(h.integration, 12) as comp, h.outcome
          from public.health_checks h where h.integration like 'Processing:%'
          order by h.integration, h.checked_at desc, h.created_at desc) l
    join (select substr(h.integration, 12) as comp, max(h.last_success) as ls
          from public.health_checks h where h.integration like 'Processing:%' group by 1) s on s.comp = l.comp
    order by l.comp
  loop
    v_age := case when v_x ->> 'last_success' is null then null
                  else floor(extract(epoch from (p_at - (v_x ->> 'last_success')::timestamptz)) / 60)::int end;
    if v_x ->> 'outcome' <> 'OK' and (v_age is null or v_age > v_stale)
       and not exists (select 1 from jsonb_array_elements(v_alerts) a where a ->> 'component' = v_x ->> 'component') then
      v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
        'component', v_x ->> 'component', 'severity', 'Critical',
        'detail', 'Last attempt ' || (v_x ->> 'outcome') || ', no success for '
                  || coalesce(v_age::text, '∞') || ' min'));
    end if;
  end loop;

  select count(*)::int into v_exhausted from public.outbox o where o.status = 'NeedsReview' and o.attempt_count >= 5;
  if v_exhausted > 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'component', 'Outbox', 'severity', 'Warning', 'detail', v_exhausted || ' outbox item(s) exhausted retries'));
  end if;

  for v_x in select a from jsonb_array_elements(v_alerts) a loop
    v_key := 'RS-ALERT-' || regexp_replace(v_x ->> 'component', '[^A-Za-z0-9:_-]', '_', 'g') || '-' || v_day;
    select t.id into v_task_id from public.tasks t where t.instance_key = v_key;
    if v_task_id is not null then
      v_reused := v_reused || jsonb_build_array(jsonb_build_object(
        'task_id', v_task_id, 'component', v_x ->> 'component', 'severity', v_x ->> 'severity'));
      continue;
    end if;
    v_task_id := app.create_task_instance(
      null, 'RS-ALERT', v_key, null, null, p_at, 1,
      'Integration failure alert — ' || (v_x ->> 'severity') || ' ' || (v_x ->> 'component') || ': ' || (v_x ->> 'detail'),
      'System', 'HealthChecks', null, 'Open', null, false, 'RS-1.0');
    select * into v_task from public.tasks where id = v_task_id;
    perform app.audit('Tasks', v_task_id::text, 'FailureAlert', null, to_jsonb(v_task), 'Integration failure alert');
    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'task_id', v_task_id, 'component', v_x ->> 'component', 'severity', v_x ->> 'severity'));
  end loop;

  return jsonb_build_object(
    'alerts', v_alerts, 'created', v_created, 'reused', v_reused, 'day', v_day,
    'manual_check', 'If automation itself stops (no heartbeat, no alerts), the SYS01 owner runs the documented '
                    || 'manual daily check (SYS01) and the SYS01 backup covers it.',
    'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Scheduler entry point: resilience sweep (resilience/cloud-adapter.js
-- runRsSweep, 30-minute schedule). Evaluates and records system health,
-- raises review tasks and failure alerts, records its own heartbeat.
-- FN-14 not Automated -> nothing written. A failure rolls back the sweep's
-- work, records a FAILED 'ResilienceSweep' heartbeat (surfaced as Failing by
-- the next evaluation) and returns ok=false instead of raising, so the cron
-- run itself leaves a trace.
-- -----------------------------------------------------------------------------

create function app.run_resilience_sweep(p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stamp text := to_char(p_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS');
  v_health jsonb;
  v_review jsonb;
  v_alerts jsonb;
  v_health_id uuid;
  v_next uuid;
  v_hb jsonb;
  v_error text;
begin
  perform set_config('app.executing_service', 'scheduler:ResilienceReview', true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.command_id', 'RS-SWEEP-' || v_stamp, true);
  if not app.mode_available('FN-14', 'Automated') then
    return jsonb_build_object('ok', false, 'status', 'Disabled', 'code', 'R1A_MODE_DENIED',
                              'function_id', 'FN-14', 'external_calls', 0);
  end if;
  begin
    v_health := app.health_status(p_at);
    v_review := app.raise_review_tasks(p_at);
    v_alerts := app.raise_failure_alerts(v_health, p_at);
    v_next := coalesce((v_alerts -> 'created' -> 0 ->> 'task_id')::uuid, (v_alerts -> 'reused' -> 0 ->> 'task_id')::uuid);
    v_health_id := app.record_health(v_health, v_next);
  exception when others then
    v_error := sqlerrm;
    v_hb := app.try_heartbeat('ResilienceSweep', 'FAILED', v_error, null, p_at);
    return jsonb_build_object('ok', false, 'status', 'Failed', 'error', v_error, 'heartbeat', v_hb,
                              'external_calls', 0);
  end;
  v_hb := app.try_heartbeat('ResilienceSweep', 'OK', null, 'SWEEP-' || v_stamp, p_at);
  return jsonb_build_object(
    'ok', true, 'status', 'Completed',
    'health', jsonb_build_object('health_id', v_health_id, 'overall', v_health ->> 'overall',
                                 'critical_count', v_health -> 'critical_count',
                                 'warning_count', v_health -> 'warning_count'),
    'review_tasks', v_review, 'alerts', v_alerts, 'heartbeat', v_hb,
    'manual_check', v_alerts -> 'manual_check', 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Scheduler entry point: daily system tasks SYS01 / SYS02
-- (s16/health.js _s16SystemTasks, FN-16 Manual).
--
-- Deviations:
--   * due at the template time (SYS01 '09:00', SYS02 '16:30') Europe/London on
--     the given staffed date, not "now"; only staffed days (template trigger
--     "Every staffed day"); key 'S16-{London date}-{code}' so the task exists
--     once per day - the reference had no daily mechanism (REF-03 §11.9).
--   * owner/backup from the template's task_assignment_rules row (fails
--     TASK_ASSIGNMENT_CONFIG visibly); never display-name substrings, never
--     silently skipped (REF-03 §1.1, §11.14).
--   * the canonical task_templates.due_rule is 'none' for SYS01/SYS02, so the
--     reference template times 09:00 / 16:30 are fixed here.
-- -----------------------------------------------------------------------------

create function app.run_system_tasks(p_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, app.london_date(now()));
  v_tpl public.task_templates;
  v_time time;
  v_key text;
  v_id uuid;
  v_task public.tasks;
  v_tasks jsonb := '[]';
  v_error text;
  v_hb jsonb;
begin
  perform set_config('app.executing_service', 'scheduler:S16-system-tasks', true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.command_id', 'S16-' || to_char(v_date, 'YYYY-MM-DD'), true);
  if not app.mode_available('FN-16', 'Manual') then
    return jsonb_build_object('ok', false, 'status', 'Disabled', 'code', 'R1A_MODE_DENIED',
                              'function_id', 'FN-16', 'external_calls', 0);
  end if;
  if not app.is_staffed_day(v_date) then
    return jsonb_build_object('ok', true, 'status', 'NotStaffedDay', 'date', v_date,
                              'tasks_created', 0, 'tasks_reused', 0, 'tasks', '[]'::jsonb, 'external_calls', 0);
  end if;
  begin
    for v_tpl in select * from public.task_templates t
                 where t.active and t.code in ('SYS01', 'SYS02') order by t.code loop
      v_time := case when v_tpl.code = 'SYS01' then time '09:00' else time '16:30' end;
      v_key := 'S16-' || to_char(v_date, 'YYYY-MM-DD') || '-' || v_tpl.code;
      v_id := app.create_task_instance(null, v_tpl.code, v_key, null, null,
                              app.london_at(v_date, v_time), null, null, null, 'HealthChecks', null,
                              'Open', null, false, 'S16-1.0');
      if v_id is null then
        select t.id into v_id from public.tasks t where t.instance_key = v_key;
        v_tasks := v_tasks || jsonb_build_array(jsonb_build_object(
          'created', false, 'reused', true, 'task_id', v_id, 'template', v_tpl.code));
      else
        select * into v_task from public.tasks where id = v_id;
        perform app.audit('Tasks', v_id::text, 'SystemTask', null, to_jsonb(v_task), 'Daily system task');
        v_tasks := v_tasks || jsonb_build_array(jsonb_build_object(
          'created', true, 'reused', false, 'task_id', v_id, 'template', v_tpl.code,
          'owner_id', v_task.owner_id, 'backup_id', v_task.backup_id, 'due_at', v_task.due_at));
      end if;
    end loop;
  exception when others then
    v_error := sqlerrm;
    v_hb := app.try_heartbeat('SystemTasks', 'FAILED', v_error, null, now());
    return jsonb_build_object('ok', false, 'status', 'Failed', 'error', v_error, 'heartbeat', v_hb,
                              'external_calls', 0);
  end;
  v_hb := app.try_heartbeat('SystemTasks', 'OK', null, 'SYS-' || to_char(v_date, 'YYYY-MM-DD'), now());
  return jsonb_build_object(
    'ok', true, 'status', 'Completed', 'date', v_date,
    'tasks_created', (select count(*) from jsonb_array_elements(v_tasks) t where (t ->> 'created')::boolean),
    'tasks_reused', (select count(*) from jsonb_array_elements(v_tasks) t where (t ->> 'reused')::boolean),
    'tasks', v_tasks, 'heartbeat', v_hb, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- OUTBOX_RESOLVE (resilience/review.js _rsResolveOutbox): human resolution of
-- an uncertain non-calendar outbox row. Authorization (office manager class +
-- FN-14 Automated) is in app.authorize_command; idempotency by command_id in
-- the core journal. The outbox row has no version: the row lock serialises
-- concurrent resolutions and the status check refuses the second one.
-- Payload: outbox_id, decision (MarkSucceeded | Cancel | Retry), reason,
-- external_id (required for MarkSucceeded).
-- -----------------------------------------------------------------------------

create function app.cmd_outbox_resolve(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['outbox_id', 'decision', 'reason', 'external_id'],
                           array['outbox_id', 'decision', 'reason']);
  v_outbox_text text := app.txt(v_p, 'outbox_id');
  v_decision text := app.txt(v_p, 'decision');
  v_reason text := app.txt(v_p, 'reason');
  v_external text := app.txt(v_p, 'external_id');
  v_who text := coalesce(p_actor ->> 'email', p_actor ->> 'id');
  v_before public.outbox;
  v_after public.outbox;
  v_task public.tasks;
  v_done public.tasks;
  v_note text;
  v_completed jsonb := '[]';
begin
  if v_decision not in ('MarkSucceeded', 'Cancel', 'Retry') then
    perform app.fail('RS_REVIEW: decision must be MarkSucceeded, Cancel or Retry');
  end if;
  if v_outbox_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('RS_REVIEW: outbox row not found');
  end if;
  select * into v_before from public.outbox where id = v_outbox_text::uuid for update;
  if not found then
    perform app.fail('RS_REVIEW: outbox row not found');
  end if;
  if v_before.action_type in ('CalendarCreate', 'CalendarUpdate', 'CalendarCancel') then
    perform app.fail('RS_REFUSED: calendar rows are resolved by the calendar service');
  end if;
  if v_before.status not in ('NeedsReview', 'RetryDue', 'Processing') then
    perform app.fail('RS_REVIEW: outbox status is not reviewable', jsonb_build_object('status', v_before.status));
  end if;
  if v_decision = 'MarkSucceeded' and v_external is null then
    perform app.fail('RS_REVIEW: external_id required to mark succeeded (confirm the external result first)');
  end if;

  if v_decision = 'MarkSucceeded' then
    update public.outbox set status = 'Succeeded', external_id = v_external,
      response_summary = 'RESOLVED by ' || v_who || ': confirmed external result ' || v_external || ' — ' || v_reason
    where id = v_before.id returning * into v_after;
  elsif v_decision = 'Cancel' then
    update public.outbox set status = 'Cancelled',
      response_summary = 'RESOLVED by ' || v_who || ': cancelled — ' || v_reason
    where id = v_before.id returning * into v_after;
  else
    -- Reference sets next_attempt null; the worker's due index keys on
    -- next_attempt, so "due now" is stored explicitly.
    update public.outbox set status = 'Pending', next_attempt = now(),
      response_summary = 'RESOLVED by ' || v_who || ': queued for retry — ' || v_reason
    where id = v_before.id returning * into v_after;
  end if;
  perform app.audit('Outbox', v_before.id::text, 'Resolve' || v_decision, to_jsonb(v_before), to_jsonb(v_after), v_reason);

  v_note := v_decision || ': ' || v_reason;
  for v_task in select * from public.tasks t
                where t.template_code = 'RS-REVIEW' and t.related_entity_type = 'Outbox'
                  and t.related_entity_id = v_before.id and t.status not in ('Complete', 'Cancelled', 'NotRequired')
                order by t.created_at for update loop
    update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.actor_id(p_actor),
      completion_note = v_note, blocking_reason = null
    where id = v_task.id returning * into v_done;
    perform app.task_event(v_task, v_done, 'Complete', v_note);
    perform app.audit('Tasks', v_task.id::text, 'Complete', to_jsonb(v_task), to_jsonb(v_done), v_note);
    v_completed := v_completed || to_jsonb(v_task.id);
  end loop;

  return jsonb_build_object('status', v_after.status, 'decision', v_decision, 'outbox_id', v_after.id,
                            'entity_type', 'Outbox', 'completed_tasks', v_completed,
                            'outbox', to_jsonb(v_after), 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Staff read models (office manager class): review queue and live health.
-- -----------------------------------------------------------------------------

create function public.resilience_review_queue()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not coalesce(app.is_office_manager(app.current_actor()), false) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  return app.review_queue(now());
end
$$;

-- Evaluated now, not recorded (the recorded history is health_checks).
create function public.system_health()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not coalesce(app.is_office_manager(app.current_actor()), false) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  return app.health_status(now());
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges: schedulers/workers run as service_role; staff use the RPCs.
-- -----------------------------------------------------------------------------

revoke execute on function public.resilience_review_queue(), public.system_health() from public, anon;
grant execute on function public.resilience_review_queue(), public.system_health() to authenticated, service_role;
grant execute on function
  app.run_resilience_sweep(timestamptz), app.run_system_tasks(date), app.evaluate_health(timestamptz),
  app.record_heartbeat(text, text, text, text, timestamptz),
  app.record_integration_check(text, text, text, text, timestamptz),
  app.heartbeat_status(timestamptz, text[]), app.health_status(timestamptz), app.review_queue(timestamptz)
  to service_role;
