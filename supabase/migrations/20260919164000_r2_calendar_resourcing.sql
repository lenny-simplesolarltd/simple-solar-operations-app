-- =============================================================================
-- Backend port, R2: generic outbox worker protocol, calendar service (FN-02),
-- resource planning and the S11 R2 planning commands.
--
-- Reference: processor/outbox.js (G1 lifecycle), calendar/service.js (the
-- hardened lifecycle: Processing before the call, bounded retries 1/2/4/8/16
-- minutes, uncertain -> review, reconcile by tag, stalled recovery, human
-- review resolution), resource/planning.js, s11/planner.js (planWorkPackage,
-- moveWorkPackage, changeInstaller), apps-script/OutboundGuard.js (allow-list
-- semantics only); tests calendar / resource / s11 / processor (outbox).
-- Survey: REF-04 §1.5, §1.6, §4, §7, §8; REF-02 §6.2.
--
-- 1. Generic outbox protocol (any TypeScript sender: Calendar, Xero, email)
--    app.outbox_action_types        registry (data): per action type the
--                                   executing service, the release mode that
--                                   must be Automated, the live switch setting
--                                   ("LIVE" or nothing is claimed = CAPTURE),
--                                   retry policy, stalled threshold and optional
--                                   claim/result hooks.
--    app.outbox_claim(types, limit) Pending/RetryDue due rows -> Processing,
--                                   attempt_count + 1, claimed_at, for update
--                                   skip locked; stalled rows released first.
--    app.outbox_record_success(id, external_id, summary)
--    app.outbox_record_failure(id, transient, error [, max_attempts, backoff])
--    app.outbox_record_uncertain(id, summary)       -> NeedsReview, no resend
--    app.outbox_release_stalled(minutes [, types])  -> RetryDue 'STALLED: ...'
--    Service-role entry points (PostgREST RPC): public.outbox_claim,
--    public.outbox_record_success, public.outbox_record_failure,
--    public.outbox_record_uncertain, public.outbox_release_stalled,
--    public.outbound_guard, public.calendar_drift_candidates,
--    public.calendar_record_drift. Nothing else here is reachable by the API
--    except through execute_command / execute_operations_read.
--
-- 2. Calendar (calendar/service.js). SQL never calls Google. The calendar
--    worker claims CalendarCreate/Update/Cancel rows through the generic
--    protocol; the claim hook turns each row into a work item or settles it:
--      work.operation  create | update | reconcile-then-create | delete
--      work.event      {title, start, end (exclusive), all_day, description,
--                       tag '[SSO:<calendar link id>]', guests}
--      work.if_event_missing  create | review
--    Worker algorithm (reference _calProcessOne):
--      delete: deleteEvent -> success 'DELETED: ...'; event absent -> success
--        'ALREADY_REMOVED: ...' with the stored id; no confirmation ->
--        uncertain 'UNCERTAIN_OUTCOME: delete returned no confirmation'.
--      reconcile-then-create: findEventsByTag(tag, start, end); >1 ->
--        failure(false, 'DUPLICATE_EVENTS: tag matched n events: ids');
--        1 -> adopt it and update -> success 'RECONCILED: ...'; 0 -> create.
--      update: getEventById; absent -> if_event_missing = create ? create :
--        failure(false, 'EVENT_MISSING: ...'); else update.
--      create/update result without an id -> uncertain 'UNCERTAIN_OUTCOME: ...'.
--      exceptions -> failure(true, message) (backoff, then MAX_RETRIES_EXCEEDED);
--        refusals -> failure(false, 'REFUSED: ...').
--    The result hook keeps calendar_links in step (Active/Cancelled + external
--    ids on success; Error + error text on retry/review/stall) and audits every
--    attempt (CalendarCreate, CalendarCreateRetry, CalendarCreateFailed,
--    CalendarStalled, ...).
--    Settings: calendar.mode ("LIVE"; anything else = CAPTURE, rows stay
--    Pending), calendar.shared_calendar_id (R1), calendar.allowed_calendar_ids,
--    outbound.allowed_recipients (guests).
--    Command CALENDAR_REVIEW_RESOLVE (AdoptEvent | MarkCancelled | Retry |
--    Retarget). Reads CALENDAR_STATUS, CALENDAR_DISPATCH_PREVIEW (dry run).
--    Drift (REF-04 §1.5/§4; the drift source is not in the surveyed code, built
--    from the survey): app.calendar_drift_candidates / app.calendar_record_drift
--    -> link error 'EXTERNAL_EDIT: ...', one CAL-DRIFT task per link revision,
--    never rewrites the event or moves the job.
--
-- 3. Resource planning (resource/planning.js), configured by Admin/Manager/
--    Office: RP_SET_SKILL (canonical person_skills.skill_code, installers
--    only), RP_SET_AVAILABILITY, RP_CANCEL_AVAILABILITY, RP_UPSERT_TEAM,
--    RP_SET_TEAM_MEMBER; reads RP_ASSESS, RP_CHANGE_INSTALLER_OPTIONS,
--    RP_MOVE_JOB_PREVIEW, RP_TEAMS, RP_TEAM_PLANNER, RP_STATUS.
--
-- 4. S11 R2 (FN-01 + FN-02 Automated): PLAN_WORK_PACKAGE, MOVE_WORK_PACKAGE,
--    CHANGE_INSTALLER_R2 - leave/skill/holiday/capacity checks, NeedsReview
--    (nothing written) on an ineligible installer, calendar intent captured
--    with the R1 helpers app.s11_calendar_capture / app.s11_calendar_cancel.
--
-- Deviations (each also marked "-- Deviation:" where it applies):
--   * Outbox rows get claimed_at (ported table widened): stalled detection
--     measures from the claim, not from row creation (REF-02 §6.2 stalled rule;
--     the reference used link.last_attempt_at for calendar rows only).
--   * A calendar outbox row whose link was re-queued by a later change
--     (plan then move before dispatch) is found through the CalendarRequeued
--     audit (trigger calendar_links_requeued on the ported table audits every
--     re-point of calendar_links.outbox_id); never attempted -> Cancelled
--     'SUPERSEDED', attempted -> NeedsReview. The reference sent it to
--     CALENDAR_LINK_MISSING review, which its own review resolution could not
--     close.
--   * A create for a link that was ever attempted reconciles by tag first
--     (link.last_attempt_at), not only when this very row was attempted.
--   * No DEV sheet/environment guard and no hardcoded DEV calendar: the target
--     must be calendar.shared_calendar_id and be allow-listed (code
--     CALENDAR_TARGET_NOT_SHARED replaces CALENDAR_TARGET_NOT_DEV; resolution
--     Retarget replaces RetargetDev). MarkCancelled also works for a row with
--     no link (the reference refused, leaving it unresolvable).
--   * Retry/Retarget store next_attempt = now() (as OUTBOX_RESOLVE does).
--   * Skill checks apply only when the package trade is a skill code: a
--     ReturnVisit/Other package is not SKILL_MISMATCH for every skilled
--     installer (REF-04 §7 / §8.4 return-visit ambiguity).
--   * MOVE_WORK_PACKAGE / CHANGE_INSTALLER_R2 use the R1 server-side
--     actionability + stage restriction (app.s11_assert_reschedulable,
--     REF-03 §11.7); PLAN_WORK_PACKAGE keeps the reference S15 guard only.
--   * Stale versions: R1A_STALE_VERSION (reference S11_STALE / none for RP).
--   * The S11 R2 commands keep jobs.next_action_at current, as the R1 planner
--     commands do.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------

-- Ported table widened: when the current attempt was claimed (stalled rule).
alter table public.outbox add column claimed_at timestamptz;
comment on column public.outbox.claimed_at is
  'When the row was last marked Processing by app.outbox_claim; stalled Processing is measured from here.';

create table app.outbox_action_types (
  action_type     text primary key check (action_type ~ '^[A-Z][A-Za-z0-9_]*$'),
  -- audit_events.executing_service for worker writes.
  service         text not null check (btrim(service) <> ''),
  -- Release mode that must be Automated before anything is claimed.
  function_id     text check (function_id ~ '^FN-[0-9]{2}$'),
  -- Settings key whose value must be "LIVE"; otherwise CAPTURE: rows stay
  -- Pending and are only reported. Null = no switch.
  live_setting    text,
  max_attempts    integer not null default 5 check (max_attempts between 1 and 50),
  backoff_minutes integer[] not null default '{1,2,4,8,16}' check (cardinality(backoff_minutes) > 0),
  stalled_minutes integer not null default 15 check (stalled_minutes > 0),
  -- app.<claim_hook>(public.outbox) returns jsonb (stable):
  --   {"decision":"send","work":{...}} | {"decision":"review","code":..,"detail":..}
  --   | {"decision":"succeed","external_id":..,"summary":..} | {"decision":"cancel","summary":..}
  claim_hook      text check (claim_hook ~ '^[a-z_][a-z0-9_]*$'),
  -- app.<result_hook>(before public.outbox, after public.outbox, outcome text) returns void;
  -- outcome Claimed | Succeeded | RetryDue | NeedsReview | Stalled | Cancelled.
  result_hook     text check (result_hook ~ '^[a-z_][a-z0-9_]*$'),
  module          text not null,
  notes           text
);
comment on table app.outbox_action_types is
  'Generic outbox protocol registry: only registered action types can be claimed by a worker.';
revoke all on app.outbox_action_types from public, anon, authenticated;

insert into public.task_templates (code, title, task_group, default_priority, due_rule, guidance, template_version) values
  ('CAL-DRIFT', 'Review calendar event changed outside the system', 'System', 1, 'at_creation',
   'External edit reviewed; job dates stay authoritative (never imported as a move)', 'CAL-1.0')
on conflict (code) do nothing;

insert into public.settings (key, typed_value, scope, version, effective_from, reason) values
  ('calendar.mode', '"CAPTURE"'::jsonb, 'Global', 1, '2026-01-01',
   'Calendar service ships CAPTURE: nothing is sent until set to "LIVE"'),
  ('calendar.allowed_calendar_ids', '[]'::jsonb, 'Global', 1, '2026-01-01',
   'Calendar ids the calendar worker may write to (none approved yet)'),
  ('outbound.allowed_recipients', '[]'::jsonb, 'Global', 1, '2026-01-01',
   'Mailboxes an outbound worker may address (OutboundGuard allow-list; none approved yet)')
on conflict (key, scope, version) do nothing;

-- -----------------------------------------------------------------------------
-- Small helpers
-- -----------------------------------------------------------------------------

-- A settings value that is a JSON array of strings, as trimmed text[].
create function app.setting_text_array(p_key text)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array(
    select btrim(e) from jsonb_array_elements_text(
      case when jsonb_typeof(app.setting(p_key)) = 'array' then app.setting(p_key) else '[]'::jsonb end) e
    where btrim(e) <> ''), '{}')
$$;

-- Read requests: every key must be known (reads carry their own parameters).
create function app.r2cal_read_keys(p_request jsonb, p_allowed text[])
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key <> 'read_type' and not v_key = any (p_allowed) then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;
end
$$;

-- Optional optimistic check for upsert-style commands: when the request
-- states expected_version it must match the existing row.
create function app.r2_optional_version(p_request jsonb, p_current int)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_current is not null and p_request -> 'expected_version' is not null
     and jsonb_typeof(p_request -> 'expected_version') <> 'null'
     and app.expected_version(p_request) <> p_current then
    perform app.fail('R1A_STALE_VERSION');
  end if;
end
$$;

-- =============================================================================
-- 1. Generic outbox protocol
-- =============================================================================

-- One transition of an outbox row: update, audit (per attempt), result hook.
create function app.outbox_apply(p_before public.outbox, p_status text, p_summary text, p_next timestamptz,
                                 p_external text, p_attempt int, p_claimed_at timestamptz,
                                 p_audit_action text, p_outcome text)
returns public.outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after public.outbox;
  v_hook text;
begin
  update public.outbox
  set status = p_status, response_summary = left(p_summary, 400), next_attempt = p_next,
      external_id = p_external, attempt_count = p_attempt, claimed_at = p_claimed_at
  where id = p_before.id
  returning * into v_after;
  perform app.audit('Outbox', v_after.id::text, p_audit_action, to_jsonb(p_before), to_jsonb(v_after),
                    v_after.response_summary);
  select r.result_hook into v_hook from app.outbox_action_types r where r.action_type = v_after.action_type;
  if v_hook is not null then
    execute format('select app.%I($1, $2, $3)', v_hook) using p_before, v_after, p_outcome;
  end if;
  return v_after;
end
$$;

create function app.outbox_use_service(p_action_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.executing_service',
    coalesce((select r.service from app.outbox_action_types r where r.action_type = p_action_type), 'OutboxWorker'),
    true);
end
$$;

-- Stalled Processing rows -> RetryDue 'STALLED: ...' (calendar/service.js
-- _calRecoverStalled): visible and retryable; the next attempt reconciles
-- before any re-create. p_minutes null = each type's registered threshold
-- (reference 15). p_action_types null = every type.
create function app.outbox_release_stalled(p_minutes int default null, p_action_types text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out public.outbox;
  v_min int;
  v_ids jsonb := '[]';
begin
  if p_minutes is not null and p_minutes < 1 then
    perform app.fail('OUTBOX_REFUSED: stalled minutes must be positive');
  end if;
  for v_out in
    select o.* from public.outbox o
    left join app.outbox_action_types r on r.action_type = o.action_type
    where o.status = 'Processing'
      and (p_action_types is null or o.action_type = any (p_action_types))
      -- Deviation: measured from claimed_at (REF-02 §6.2), created_at for rows never claimed here.
      and coalesce(o.claimed_at, o.created_at) <= now() - make_interval(mins => coalesce(p_minutes, r.stalled_minutes, 15))
    order by o.created_at, o.id
    for update of o skip locked
  loop
    select coalesce(p_minutes, r.stalled_minutes, 15) into v_min
    from (select 1) x left join app.outbox_action_types r on r.action_type = v_out.action_type;
    perform app.outbox_use_service(v_out.action_type);
    perform app.outbox_apply(v_out, 'RetryDue',
      'STALLED: Processing for >' || v_min || ' min; reconcile before retry', now(), v_out.external_id,
      v_out.attempt_count, v_out.claimed_at, 'OutboxStalled', 'Stalled');
    v_ids := v_ids || to_jsonb(v_out.id);
  end loop;
  return jsonb_build_object('released', v_ids, 'count', jsonb_array_length(v_ids));
end
$$;

-- Claim due rows for a worker. Every requested type must be registered and
-- its release mode Automated (else nothing is written). Types whose live
-- switch is not "LIVE" are CAPTURE: due rows are only reported.
create function app.outbox_claim(p_action_types text[], p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := case when coalesce(p_limit, 0) > 0 then least(p_limit, 200) else 20 end;
  v_type text;
  v_reg app.outbox_action_types;
  v_live text[] := '{}';
  v_capture text[] := '{}';
  v_out public.outbox;
  v_after public.outbox;
  v_dec jsonb;
  v_kind text;
  v_claimed jsonb := '[]';
  v_settled jsonb := '[]';
  v_skipped jsonb;
  v_stalled jsonb;
begin
  if p_action_types is null or cardinality(p_action_types) = 0 then
    perform app.fail('OUTBOX_REFUSED: action types required');
  end if;
  foreach v_type in array p_action_types loop
    select * into v_reg from app.outbox_action_types where action_type = v_type;
    if not found then
      perform app.fail('OUTBOX_REFUSED: unregistered action type ' || coalesce(v_type, 'null'));
    end if;
    if v_reg.function_id is not null and not app.mode_available(v_reg.function_id, 'Automated') then
      perform app.fail('OUTBOX_REFUSED: ' || v_reg.function_id || ' must be Automated',
                       jsonb_build_object('action_type', v_type));
    end if;
    if v_reg.live_setting is null or coalesce(app.setting(v_reg.live_setting) #>> '{}', '') = 'LIVE' then
      v_live := array_append(v_live, v_type);
    else
      v_capture := array_append(v_capture, v_type);
    end if;
  end loop;

  v_stalled := app.outbox_release_stalled(null, p_action_types) -> 'released';

  select coalesce(jsonb_agg(jsonb_build_object('outbox_id', d.id, 'action_type', d.action_type,
                                               'reason', 'CAPTURE_MODE') order by d.created_at, d.id), '[]')
  into v_skipped
  from (select o.id, o.action_type, o.created_at from public.outbox o
        where o.action_type = any (v_capture) and o.status in ('Pending', 'RetryDue')
          and (o.next_attempt is null or o.next_attempt <= now())
        order by o.created_at, o.id limit v_limit) d;

  for v_out in
    select o.* from public.outbox o
    where o.action_type = any (v_live) and o.status in ('Pending', 'RetryDue')
      and (o.next_attempt is null or o.next_attempt <= now())
    order by o.created_at, o.id
    limit v_limit
    for update skip locked
  loop
    select * into v_reg from app.outbox_action_types where action_type = v_out.action_type;
    perform app.outbox_use_service(v_out.action_type);
    v_dec := null;
    if v_reg.claim_hook is not null then
      execute format('select app.%I($1)', v_reg.claim_hook) into v_dec using v_out;
    end if;
    v_kind := coalesce(v_dec ->> 'decision', 'send');

    if v_kind = 'review' then
      -- Permanent/config problems go to review before any external call.
      v_after := app.outbox_apply(v_out, 'NeedsReview',
        'NEEDS_REVIEW ' || coalesce(v_dec ->> 'code', 'REVIEW') || coalesce(': ' || (v_dec ->> 'detail'), ''),
        null, v_out.external_id, v_out.attempt_count, v_out.claimed_at, 'OutboxNeedsReview', 'NeedsReview');
      v_settled := v_settled || jsonb_build_object('outbox_id', v_after.id, 'action_type', v_after.action_type,
        'outcome', 'NeedsReview', 'code', v_dec ->> 'code', 'summary', v_after.response_summary);
    elsif v_kind = 'cancel' then
      v_after := app.outbox_apply(v_out, 'Cancelled', coalesce(v_dec ->> 'summary', 'CANCELLED'), null,
        v_out.external_id, v_out.attempt_count, v_out.claimed_at, 'OutboxCancelled', 'Cancelled');
      v_settled := v_settled || jsonb_build_object('outbox_id', v_after.id, 'action_type', v_after.action_type,
        'outcome', 'Cancelled', 'summary', v_after.response_summary);
    else
      -- Processing and the attempt are recorded BEFORE any external call.
      v_after := app.outbox_apply(v_out, 'Processing', v_out.response_summary, v_out.next_attempt,
        v_out.external_id, v_out.attempt_count + 1, now(), 'OutboxClaimed', 'Claimed');
      if v_kind = 'succeed' then
        -- Nothing to do externally (e.g. cancel with no event): settled now.
        v_after := app.outbox_apply(v_after, 'Succeeded', coalesce(v_dec ->> 'summary', 'SUCCEEDED'), null,
          coalesce(nullif(v_dec ->> 'external_id', ''), v_after.external_id), v_after.attempt_count,
          v_after.claimed_at, 'OutboxSucceeded', 'Succeeded');
        v_settled := v_settled || jsonb_build_object('outbox_id', v_after.id, 'action_type', v_after.action_type,
          'outcome', 'Succeeded', 'summary', v_after.response_summary);
      else
        v_claimed := v_claimed || jsonb_build_object(
          'outbox_id', v_after.id, 'action_type', v_after.action_type, 'target', v_after.target,
          'idempotency_key', v_after.idempotency_key, 'correlation_id', v_after.correlation_id,
          'job_revision', v_after.job_revision, 'attempt', v_after.attempt_count,
          'prior_uncertain', v_out.attempt_count > 0 or v_out.status = 'RetryDue',
          'external_id', v_after.external_id, 'work', v_dec -> 'work');
      end if;
    end if;
  end loop;

  return jsonb_build_object('now', now(), 'claimed', v_claimed, 'settled', v_settled, 'skipped', v_skipped,
    'stalled_recovered', v_stalled, 'live_action_types', to_jsonb(v_live),
    'capture_action_types', to_jsonb(v_capture), 'external_calls', 0);
end
$$;

-- Success: persist the external id. Accepted from Processing, or RetryDue
-- (a late confirmation after a stall/failure is still the truth). The same
-- success reported twice is a replay (no writes).
create function app.outbox_record_success(p_outbox_id uuid, p_external_id text, p_summary text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out public.outbox;
  v_after public.outbox;
  v_ext text;
begin
  select * into v_out from public.outbox where id = p_outbox_id for update;
  if not found then
    perform app.fail('OUTBOX_NOT_FOUND');
  end if;
  v_ext := coalesce(nullif(btrim(p_external_id), ''), v_out.external_id);
  if v_out.status = 'Succeeded' and v_out.external_id is not distinct from v_ext then
    return jsonb_build_object('outbox_id', v_out.id, 'outcome', 'Succeeded', 'status', v_out.status,
                              'external_id', v_out.external_id, 'replay', true);
  end if;
  if v_out.status not in ('Processing', 'RetryDue') then
    perform app.fail('OUTBOX_NOT_PROCESSING', jsonb_build_object('status', v_out.status));
  end if;
  perform app.outbox_use_service(v_out.action_type);
  v_after := app.outbox_apply(v_out, 'Succeeded', coalesce(nullif(btrim(p_summary), ''), 'SUCCEEDED'), null, v_ext,
                              v_out.attempt_count, v_out.claimed_at, 'OutboxSucceeded', 'Succeeded');
  return jsonb_build_object('outbox_id', v_after.id, 'outcome', 'Succeeded', 'status', v_after.status,
                            'external_id', v_after.external_id, 'replay', false);
end
$$;

-- Failure of the current attempt. Transient: RetryDue with the registered
-- backoff (reference 1,2,4,8,16 minutes) until max_attempts (reference 5),
-- then NeedsReview MAX_RETRIES_EXCEEDED. Permanent: NeedsReview now. The
-- optional overrides let a sender apply its own policy (e.g. Xero: 3 attempts).
create function app.outbox_record_failure(p_outbox_id uuid, p_transient boolean, p_error text,
                                          p_max_attempts int default null, p_backoff_minutes int[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out public.outbox;
  v_after public.outbox;
  v_reg app.outbox_action_types;
  v_max int;
  v_backoff int[];
  v_err text := coalesce(nullif(btrim(p_error), ''), 'unspecified error');
  v_minutes int;
begin
  if p_transient is null then
    perform app.fail('OUTBOX_REFUSED: transient flag required');
  end if;
  if p_max_attempts is not null and p_max_attempts < 1
     or p_backoff_minutes is not null and (cardinality(p_backoff_minutes) = 0
        or exists (select 1 from unnest(p_backoff_minutes) b where b is null or b < 0)) then
    perform app.fail('OUTBOX_REFUSED: invalid retry policy');
  end if;
  select * into v_out from public.outbox where id = p_outbox_id for update;
  if not found then
    perform app.fail('OUTBOX_NOT_FOUND');
  end if;
  if v_out.status <> 'Processing' then
    perform app.fail('OUTBOX_NOT_PROCESSING', jsonb_build_object('status', v_out.status));
  end if;
  select * into v_reg from app.outbox_action_types where action_type = v_out.action_type;
  v_max := coalesce(p_max_attempts, v_reg.max_attempts, 5);
  v_backoff := coalesce(p_backoff_minutes, v_reg.backoff_minutes, '{1,2,4,8,16}'::int[]);
  perform app.outbox_use_service(v_out.action_type);
  if not p_transient then
    v_after := app.outbox_apply(v_out, 'NeedsReview', 'NEEDS_REVIEW ' || v_err, null, v_out.external_id,
                                v_out.attempt_count, v_out.claimed_at, 'OutboxNeedsReview', 'NeedsReview');
  elsif v_out.attempt_count >= v_max then
    v_after := app.outbox_apply(v_out, 'NeedsReview', 'NEEDS_REVIEW MAX_RETRIES_EXCEEDED: ' || v_err, null,
                                v_out.external_id, v_out.attempt_count, v_out.claimed_at, 'OutboxNeedsReview', 'NeedsReview');
  else
    v_minutes := v_backoff[least(greatest(v_out.attempt_count, 1), cardinality(v_backoff))];
    v_after := app.outbox_apply(v_out, 'RetryDue', 'RETRY_DUE attempt ' || v_out.attempt_count || ': ' || v_err,
                                now() + make_interval(mins => v_minutes), v_out.external_id, v_out.attempt_count,
                                v_out.claimed_at, 'OutboxRetry', 'RetryDue');
  end if;
  return jsonb_build_object('outbox_id', v_after.id, 'outcome', v_after.status, 'status', v_after.status,
                            'attempt', v_after.attempt_count, 'next_attempt', v_after.next_attempt,
                            'summary', v_after.response_summary);
end
$$;

-- Uncertain outcome (timeout, no confirmation, result without an id):
-- NeedsReview, never a blind resend.
create function app.outbox_record_uncertain(p_outbox_id uuid, p_summary text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out public.outbox;
  v_after public.outbox;
begin
  select * into v_out from public.outbox where id = p_outbox_id for update;
  if not found then
    perform app.fail('OUTBOX_NOT_FOUND');
  end if;
  if v_out.status <> 'Processing' then
    perform app.fail('OUTBOX_NOT_PROCESSING', jsonb_build_object('status', v_out.status));
  end if;
  perform app.outbox_use_service(v_out.action_type);
  v_after := app.outbox_apply(v_out, 'NeedsReview',
    'NEEDS_REVIEW ' || coalesce(nullif(btrim(p_summary), ''), 'UNCERTAIN_OUTCOME: Uncertain outcome — requires manual review'),
    null, v_out.external_id, v_out.attempt_count, v_out.claimed_at, 'OutboxUncertain', 'NeedsReview');
  return jsonb_build_object('outbox_id', v_after.id, 'outcome', 'NeedsReview', 'status', v_after.status,
                            'summary', v_after.response_summary);
end
$$;

-- -----------------------------------------------------------------------------
-- Outbound allow-lists (apps-script/OutboundGuard.js semantics): one bare
-- mailbox per address, lower-cased; empty allow-list refuses; every to/cc/bcc
-- must be allow-listed; a calendar target must be allow-listed. A transport
-- response proves only submission - receipt needs separate human evidence.
-- (Environment DEV/TEST and CAPTURE/PROBE modes are not ported: the per-type
-- live switch in app.outbox_action_types replaces them.)
-- -----------------------------------------------------------------------------

create function app.outbound_mailbox(p_value text)
returns text
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^[A-Za-z0-9_+.-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' then
    perform app.fail('S01_REFUSED: invalid mailbox');
  end if;
  return lower(p_value);
end
$$;

create function app.outbound_guard(p_kind text, p_to text[], p_cc text[] default '{}', p_bcc text[] default '{}',
                                   p_calendar_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_approved text[];
  v_to text[];
  v_cc text[];
  v_bcc text[];
begin
  if p_kind is null or p_kind not in ('EMAIL', 'CALENDAR') then
    perform app.fail('S01_REFUSED: unsupported action');
  end if;
  if p_kind = 'CALENDAR' and (cardinality(coalesce(p_cc, '{}')) > 0 or cardinality(coalesce(p_bcc, '{}')) > 0) then
    perform app.fail('S01_REFUSED: unsupported request field');
  end if;
  v_approved := array(select app.outbound_mailbox(x) from unnest(app.setting_text_array('outbound.allowed_recipients')) x);
  if cardinality(v_approved) = 0 then
    perform app.fail('S01_REFUSED: empty allowlist');
  end if;
  v_to := array(select app.outbound_mailbox(x) from unnest(coalesce(p_to, '{}')) x);
  v_cc := array(select app.outbound_mailbox(x) from unnest(coalesce(p_cc, '{}')) x);
  v_bcc := array(select app.outbound_mailbox(x) from unnest(coalesce(p_bcc, '{}')) x);
  if cardinality(v_to) = 0 then
    perform app.fail('S01_REFUSED: no destination');
  end if;
  if exists (select 1 from unnest(v_to || v_cc || v_bcc) e where not e = any (v_approved)) then
    perform app.fail('S01_REFUSED: destination outside allowlist');
  end if;
  if p_kind = 'CALENDAR' and (p_calendar_id is null
      or not btrim(p_calendar_id) = any (app.setting_text_array('calendar.allowed_calendar_ids'))) then
    perform app.fail('S01_REFUSED: calendar outside allowlist');
  end if;
  return jsonb_build_object('kind', p_kind, 'to', to_jsonb(v_to), 'cc', to_jsonb(v_cc), 'bcc', to_jsonb(v_bcc),
                            'calendar_id', p_calendar_id, 'delivery_confirmed', false);
end
$$;

-- =============================================================================
-- 2. Calendar service (FN-02)
-- =============================================================================

create function app.calendar_action(p_action_type text)
returns boolean
language sql immutable
set search_path = ''
as $$ select coalesce(p_action_type in ('CalendarCreate', 'CalendarUpdate', 'CalendarCancel'), false) $$;

-- The calendar link an outbox row belongs to (_calLinkForOutbox): the one link
-- whose outbox_id is the row, else the calendar_link_id in a JSON payload
-- (S15 cancellations), else - Deviation - the link that pointed at the row
-- before a later change re-queued it (calendar_links audit history).
create function app.calendar_link_id_for_outbox(p_out public.outbox)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_text text;
  v_id uuid;
begin
  select array_agg(c.id) into v_ids from public.calendar_links c where c.outbox_id = p_out.id;
  if cardinality(v_ids) = 1 then
    return v_ids[1];
  elsif cardinality(v_ids) > 1 then
    return null;
  end if;
  begin
    v_text := (p_out.payload_hash::jsonb) ->> 'calendar_link_id';
  exception when others then
    v_text := null;
  end;
  if app.is_uuid_text(v_text) then
    select c.id into v_id from public.calendar_links c where c.id = btrim(v_text)::uuid;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  select a.entity_id::uuid into v_id from public.audit_events a
  where a.entity_type = 'CalendarLinks' and a.action = 'CalendarRequeued'
    and a.before_json ->> 'outbox_id' = p_out.id::text
  order by a.occurred_at desc
  limit 1;
  return v_id;
end
$$;

-- Every re-point of a link to a newer outbox row is audited (the R1 capture
-- helpers and S15 re-queue links without a link audit); the audit is also how
-- a superseded row finds its link.
create function app.calendar_link_requeued()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.audit('CalendarLinks', new.id::text, 'CalendarRequeued',
                    jsonb_build_object('outbox_id', old.outbox_id, 'status', old.status),
                    jsonb_build_object('outbox_id', new.outbox_id, 'status', new.status),
                    'calendar intent re-queued');
  return null;
end
$$;

create trigger calendar_links_requeued after update of outbox_id on public.calendar_links
  for each row when (old.outbox_id is not null and old.outbox_id is distinct from new.outbox_id)
  execute function app.calendar_link_requeued();

-- The all-day event a link describes (_calSpec): dates from the link (end
-- exclusive) or its snapshot; title from the S11 snapshot; description carries
-- the tag used to reconcile after an uncertain attempt.
create function app.calendar_event_spec(p_link public.calendar_links)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_snap jsonb;
  v_start date;
  v_end date;
  v_ref text;
  v_tag text := '[SSO:' || p_link.id || ']';
  v_lines text[];
begin
  begin
    v_snap := p_link.description_snapshot::jsonb;
  exception when others then
    v_snap := null;
  end;
  if jsonb_typeof(v_snap) is distinct from 'object' then
    v_snap := null;
  end if;
  begin
    v_start := coalesce(app.london_date(p_link.start_at), (v_snap ->> 'start_at')::date);
    v_end := coalesce(app.london_date(p_link.end_at), (v_snap ->> 'end_at')::date);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'EVENT_SPEC_INVALID', 'detail', 'unreadable event dates');
  end;
  if v_start is null or v_end is null then
    return jsonb_build_object('ok', false, 'code', 'EVENT_DATES_MISSING');
  end if;
  if v_end <= v_start then
    return jsonb_build_object('ok', false, 'code', 'EVENT_DATES_INVALID');
  end if;
  select j.job_ref into v_ref from public.jobs j where j.id = p_link.job_id;
  v_lines := array[v_tag, 'Job: ' || coalesce(v_ref, p_link.job_id::text)];
  if nullif(v_snap ->> 'work_package_id', '') is not null then
    v_lines := v_lines || ('Work package: ' || (v_snap ->> 'work_package_id'));
  end if;
  v_lines := v_lines || array['Revision: ' || p_link.entity_revision, 'System managed; do not edit in Calendar'];
  return jsonb_build_object('ok', true,
    'title', coalesce(nullif(btrim(v_snap ->> 'title'), ''), 'Simple Solar — ' || coalesce(v_ref, p_link.job_id::text)),
    'start', v_start, 'end', v_end, 'all_day', true, 'tag', v_tag,
    'description', array_to_string(v_lines, E'\n'));
end
$$;

-- Claim hook for Calendar* rows (_calProcessOne up to the external call).
-- Stable: also used by the dry-run preview. Raises CAL_REFUSED (whole claim
-- rolls back) when LIVE is not safely configured.
create function app.calendar_claim_decision(p_out public.outbox)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_shared text := nullif(btrim(app.setting('calendar.shared_calendar_id') #>> '{}'), '');
  v_allow text[] := app.setting_text_array('calendar.allowed_calendar_ids');
  v_link_id uuid;
  v_link public.calendar_links;
  v_cal text;
  v_spec jsonb;
  v_guests text[];
  v_bad text[];
  v_approved text[];
  v_operation text;
begin
  if v_shared is null or not v_shared = any (v_allow) then
    perform app.fail('CAL_REFUSED: LIVE mode requires calendar.shared_calendar_id in calendar.allowed_calendar_ids');
  end if;
  v_link_id := app.calendar_link_id_for_outbox(p_out);
  if v_link_id is null then
    return jsonb_build_object('decision', 'review', 'code', 'CALENDAR_LINK_MISSING',
                              'detail', 'no calendar_links row references outbox ' || p_out.id);
  end if;
  select * into v_link from public.calendar_links where id = v_link_id;
  if v_link.outbox_id is distinct from p_out.id then
    -- Deviation: superseded row (link re-queued by a later change).
    if p_out.attempt_count = 0 and p_out.status = 'Pending' then
      return jsonb_build_object('decision', 'cancel', 'summary',
        'SUPERSEDED: calendar link ' || v_link.id || ' was re-queued as outbox ' || coalesce(v_link.outbox_id::text, 'none')
        || '; this row was never sent');
    end if;
    return jsonb_build_object('decision', 'review', 'code', 'SUPERSEDED_AFTER_ATTEMPT',
      'detail', 'link ' || v_link.id || ' re-queued as outbox ' || coalesce(v_link.outbox_id::text, 'none')
                || '; a prior attempt may have reached the calendar');
  end if;

  v_cal := nullif(btrim(v_link.calendar_id), '');
  if v_cal is null or v_cal = 'NOT_CONFIGURED' then
    return jsonb_build_object('decision', 'review', 'code', 'CALENDAR_TARGET_MISSING',
                              'detail', 'link.calendar_id=' || coalesce(v_link.calendar_id, 'null'));
  end if;
  if v_cal <> v_shared then
    -- Deviation: the configured shared calendar replaces the hardcoded DEV id.
    return jsonb_build_object('decision', 'review', 'code', 'CALENDAR_TARGET_NOT_SHARED',
                              'detail', 'link.calendar_id=' || v_cal);
  end if;
  if not v_cal = any (v_allow) then
    return jsonb_build_object('decision', 'review', 'code', 'CALENDAR_TARGET_NOT_ALLOWLISTED',
                              'detail', 'link.calendar_id=' || v_cal);
  end if;
  if nullif(btrim(p_out.target), '') is not null and btrim(p_out.target) <> v_cal and p_out.target <> 'NOT_CONFIGURED' then
    return jsonb_build_object('decision', 'review', 'code', 'CALENDAR_TARGET_MISMATCH',
                              'detail', 'outbox.target differs from link.calendar_id');
  end if;

  if p_out.action_type = 'CalendarCancel' then
    if nullif(btrim(v_link.external_event_id), '') is null then
      return jsonb_build_object('decision', 'succeed', 'external_id', null,
                                'summary', 'NO_EXTERNAL_EVENT: nothing to cancel in Calendar');
    end if;
    return jsonb_build_object('decision', 'send', 'work', jsonb_build_object(
      'operation', 'delete', 'calendar_id', v_cal, 'link_id', v_link.id, 'job_id', v_link.job_id,
      'external_event_id', v_link.external_event_id));
  end if;

  v_spec := app.calendar_event_spec(v_link);
  if not (v_spec ->> 'ok')::boolean then
    return jsonb_build_object('decision', 'review', 'code', v_spec ->> 'code', 'detail', v_spec ->> 'detail');
  end if;
  -- Guests (none today, S11 payload guests: []) must be allow-listed mailboxes.
  v_guests := array(select lower(coalesce(p.notification_email, p.email)) from public.people p
                    where p.id = any (coalesce(v_link.guest_person_ids, '{}')));
  if cardinality(v_guests) > 0 then
    v_approved := array(select lower(x) from unnest(app.setting_text_array('outbound.allowed_recipients')) x);
    v_bad := array(select g from unnest(v_guests) g where g is null or not g = any (v_approved));
    if cardinality(v_bad) > 0 or cardinality(v_guests) <> cardinality(coalesce(v_link.guest_person_ids, '{}')) then
      return jsonb_build_object('decision', 'review', 'code', 'GUEST_NOT_ALLOWLISTED',
                                'detail', 'guest outside outbound.allowed_recipients');
    end if;
  end if;

  if nullif(btrim(v_link.external_event_id), '') is not null then
    v_operation := 'update';
  elsif p_out.attempt_count > 0 or p_out.status = 'RetryDue' or v_link.last_attempt_at is not null then
    -- Deviation: any earlier attempt for this link (not only this row) reconciles first.
    v_operation := 'reconcile-then-create';
  else
    v_operation := 'create';
  end if;
  return jsonb_build_object('decision', 'send', 'work', jsonb_build_object(
    'operation', v_operation, 'calendar_id', v_cal, 'link_id', v_link.id, 'job_id', v_link.job_id,
    'external_event_id', v_link.external_event_id,
    'if_event_missing', case when v_operation = 'update' and p_out.action_type = 'CalendarCreate' then 'create' else 'review' end,
    'event', (v_spec - 'ok') || jsonb_build_object('guests', to_jsonb(v_guests))));
end
$$;

-- Result hook: keep the link in step and audit every attempt (_calSucceed,
-- _calRetry, _calNeedsReview, _calRecoverStalled). A superseded row never
-- touches the link (its state belongs to the newer row).
create function app.calendar_on_result(p_before public.outbox, p_after public.outbox, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_id uuid := app.calendar_link_id_for_outbox(p_after);
  v_link public.calendar_links;
  v_after public.calendar_links;
  v_action text;
begin
  if v_link_id is null then
    return;
  end if;
  select * into v_link from public.calendar_links where id = v_link_id for update;
  if v_link.outbox_id is distinct from p_after.id then
    return;
  end if;
  if p_outcome = 'Claimed' then
    update public.calendar_links set last_attempt_at = now() where id = v_link.id;
    return;
  elsif p_outcome = 'Succeeded' then
    update public.calendar_links
    set external_event_id = coalesce(p_after.external_id, external_event_id),
        event_uid = coalesce(p_after.external_id, event_uid),
        last_success_at = now(), last_synced_revision = entity_revision, error = null,
        status = case when p_after.action_type = 'CalendarCancel' then 'Cancelled' else 'Active' end
    where id = v_link.id returning * into v_after;
    v_action := p_after.action_type;
  elsif p_outcome = 'RetryDue' then
    update public.calendar_links set status = 'Error', error = p_after.response_summary
    where id = v_link.id returning * into v_after;
    v_action := p_after.action_type || 'Retry';
  elsif p_outcome = 'NeedsReview' then
    update public.calendar_links set status = 'Error', error = p_after.response_summary
    where id = v_link.id returning * into v_after;
    v_action := p_after.action_type || 'Failed';
  elsif p_outcome = 'Stalled' then
    update public.calendar_links set status = 'Error', error = 'STALLED: prior attempt outcome unknown'
    where id = v_link.id returning * into v_after;
    v_action := 'CalendarStalled';
  else
    return;
  end if;
  perform app.audit('CalendarLinks', v_link.id::text, v_action, to_jsonb(v_link), to_jsonb(v_after),
                    p_after.response_summary);
end
$$;

insert into app.outbox_action_types (action_type, service, function_id, live_setting, max_attempts, backoff_minutes,
                                     stalled_minutes, claim_hook, result_hook, module, notes) values
  ('CalendarCreate', 'CalendarService', 'FN-02', 'calendar.mode', 5, '{1,2,4,8,16}', 15,
   'calendar_claim_decision', 'calendar_on_result', 'calendar', 'calendar/service.js CAL_* constants'),
  ('CalendarUpdate', 'CalendarService', 'FN-02', 'calendar.mode', 5, '{1,2,4,8,16}', 15,
   'calendar_claim_decision', 'calendar_on_result', 'calendar', 'calendar/service.js CAL_* constants'),
  ('CalendarCancel', 'CalendarService', 'FN-02', 'calendar.mode', 5, '{1,2,4,8,16}', 15,
   'calendar_claim_decision', 'calendar_on_result', 'calendar', 'calendar/service.js CAL_* constants'),
  -- Registered on behalf of the finance module (xero/adapter.js policy, see
  -- app.xero_retry_policy): 3 attempts, next attempt after 2^attempt minutes.
  ('XeroInvoice', 'XeroAdapter', 'FN-09', 'xero.mode', 3, '{2,4,8}', 15,
   null, null, 'finance', 'xero/adapter.js: FN-09 Automated + xero.mode LIVE; worker calls app.xero_prepare_dispatch after claiming');

-- Links with a live event and no queued work: the worker compares each with
-- the calendar and reports drift (REF-04 §1.5 _calDetectDrift).
create function app.calendar_drift_candidates(p_limit int default 50)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('link_id', c.id, 'job_id', c.job_id, 'calendar_id', c.calendar_id,
                                               'external_event_id', c.external_event_id,
                                               'expected', app.calendar_event_spec(c)) order by c.last_success_at, c.id), '[]')
  from (select c.* from public.calendar_links c
        left join public.outbox o on o.id = c.outbox_id
        where c.status = 'Active' and c.external_event_id is not null
          and (o.id is null or o.status in ('Succeeded', 'Cancelled'))
        order by c.last_success_at nulls first, c.id
        limit case when coalesce(p_limit, 0) > 0 then least(p_limit, 500) else 50 end) c
$$;

-- Drift report for one link: p_observed {missing: true} or {start, end, title}
-- (end exclusive). Never rewrites the event and never moves the job: the
-- link error is set, one CAL-DRIFT review task per link revision, audited
-- CalendarExternalEdit once per distinct finding.
create function app.calendar_record_drift(p_link_id uuid, p_observed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.calendar_links;
  v_after public.calendar_links;
  v_out public.outbox;
  v_spec jsonb;
  v_diffs text[] := '{}';
  v_error text;
  v_task uuid;
begin
  perform set_config('app.executing_service', 'CalendarService', true);
  if p_observed is null or jsonb_typeof(p_observed) <> 'object' then
    perform app.fail('CAL_REVIEW: observed event required');
  end if;
  select * into v_link from public.calendar_links where id = p_link_id for update;
  if not found then
    perform app.fail('CAL_REVIEW: calendar link not found');
  end if;
  select * into v_out from public.outbox where id = v_link.outbox_id;
  if v_link.status <> 'Active' or v_link.external_event_id is null
     or (v_out.id is not null and v_out.status not in ('Succeeded', 'Cancelled')) then
    return jsonb_build_object('checked', false, 'reason', 'NOT_ELIGIBLE', 'link_id', v_link.id);
  end if;
  v_spec := app.calendar_event_spec(v_link);
  if not (v_spec ->> 'ok')::boolean then
    return jsonb_build_object('checked', false, 'reason', v_spec ->> 'code', 'link_id', v_link.id);
  end if;
  if app.yes_flag(p_observed -> 'missing') then
    v_diffs := array['event missing from calendar'];
  else
    if (p_observed ->> 'start') is distinct from (v_spec ->> 'start') then
      v_diffs := v_diffs || ('start ' || coalesce(p_observed ->> 'start', 'null') || ' <> ' || (v_spec ->> 'start'));
    end if;
    if (p_observed ->> 'end') is distinct from (v_spec ->> 'end') then
      v_diffs := v_diffs || ('end ' || coalesce(p_observed ->> 'end', 'null') || ' <> ' || (v_spec ->> 'end'));
    end if;
    if (p_observed ->> 'title') is distinct from (v_spec ->> 'title') then
      v_diffs := v_diffs || 'title changed'::text;
    end if;
  end if;
  if cardinality(v_diffs) = 0 then
    return jsonb_build_object('checked', true, 'drift', false, 'link_id', v_link.id);
  end if;
  v_error := left('EXTERNAL_EDIT: ' || array_to_string(v_diffs, '; '), 400);
  if v_link.error is distinct from v_error then
    update public.calendar_links set error = v_error where id = v_link.id returning * into v_after;
    perform app.audit('CalendarLinks', v_link.id::text, 'CalendarExternalEdit', to_jsonb(v_link), to_jsonb(v_after), v_error);
  end if;
  v_task := app.create_task_instance(v_link.job_id, 'CAL-DRIFT', 'CAL-DRIFT-' || v_link.id || '-R' || v_link.entity_revision,
                                     null, null, now(), null, null, null, 'CalendarLinks', v_link.id);
  return jsonb_build_object('checked', true, 'drift', true, 'link_id', v_link.id, 'differences', to_jsonb(v_diffs),
                            'task_id', v_task, 'task_created', v_task is not null, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Calendar reads
-- -----------------------------------------------------------------------------

-- _calStatus (read-only).
create function app.read_calendar_status(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_mode text := case when coalesce(app.setting('calendar.mode') #>> '{}', '') = 'LIVE' then 'LIVE' else 'CAPTURE' end;
  v_shared text := nullif(btrim(app.setting('calendar.shared_calendar_id') #>> '{}'), '');
  v_allow text[] := app.setting_text_array('calendar.allowed_calendar_ids');
  v_rm public.release_modes;
  v_allowlisted boolean;
begin
  perform app.r2cal_read_keys(p_request, '{}');
  select * into v_rm from public.release_modes where function_id = 'FN-02';
  v_allowlisted := v_shared is not null and v_shared = any (v_allow);
  return jsonb_build_object(
    'generated_at', now(), 'calendar_mode', v_mode,
    'release_mode', jsonb_build_object('mode', v_rm.mode, 'scope', v_rm.authorised_job_scope),
    'shared_calendar_id', v_shared, 'shared_calendar_allowlisted', v_allowlisted,
    'live_ready', v_mode = 'LIVE' and app.mode_available('FN-02', 'Automated') and v_allowlisted,
    'outbox', (select jsonb_build_object(
        'total', count(*),
        'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (
            select o2.status, count(*) n from public.outbox o2 where app.calendar_action(o2.action_type) group by 1) s), '{}'),
        'by_action', coalesce((select jsonb_object_agg(s.action_type, s.n) from (
            select o2.action_type, count(*) n from public.outbox o2 where app.calendar_action(o2.action_type) group by 1) s), '{}'),
        'due_now', count(*) filter (where o.status in ('Pending', 'RetryDue') and (o.next_attempt is null or o.next_attempt <= now())),
        'processing', count(*) filter (where o.status = 'Processing'))
      from public.outbox o where app.calendar_action(o.action_type)),
    'links', (select jsonb_build_object(
        'total', count(*),
        'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (
            select c2.status, count(*) n from public.calendar_links c2 group by 1) s), '{}'),
        'with_external_id', count(*) filter (where c.external_event_id is not null),
        'last_success_at', max(c.last_success_at))
      from public.calendar_links c),
    'needs_review', (select coalesce(jsonb_agg(jsonb_build_object(
        'outbox_id', o.id, 'action', o.action_type, 'link_id', l.id, 'job_id', l.job_id,
        'summary', o.response_summary, 'external_event_id', l.external_event_id) order by o.created_at), '[]')
      from public.outbox o
      left join public.calendar_links l on l.id = app.calendar_link_id_for_outbox(o)
      where app.calendar_action(o.action_type) and o.status = 'NeedsReview'));
end
$$;

-- Dry run (_calDispatch dry_run): what the next claim would do; no writes.
create function app.read_calendar_dispatch_preview(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_mode text := case when coalesce(app.setting('calendar.mode') #>> '{}', '') = 'LIVE' then 'LIVE' else 'CAPTURE' end;
  v_out public.outbox;
  v_dec jsonb;
  v_items jsonb := '[]';
  v_would text;
begin
  perform app.r2cal_read_keys(p_request, array['limit']);
  v_limit := case when jsonb_typeof(p_request -> 'limit') = 'number' and (p_request ->> 'limit')::numeric >= 1
                  then least((p_request ->> 'limit')::numeric, 200)::int else 20 end;
  for v_out in
    select o.* from public.outbox o
    where app.calendar_action(o.action_type) and o.status in ('Pending', 'RetryDue')
      and (o.next_attempt is null or o.next_attempt <= now())
    order by o.created_at, o.id limit v_limit
  loop
    begin
      v_dec := app.calendar_claim_decision(v_out);
    exception when others then
      v_dec := jsonb_build_object('decision', 'refused', 'detail', sqlerrm);
    end;
    v_would := case v_dec ->> 'decision'
      when 'review' then 'NeedsReview:' || (v_dec ->> 'code')
      when 'cancel' then 'Cancel:SUPERSEDED'
      when 'succeed' then 'mark-cancelled'
      when 'refused' then 'Refused:' || (v_dec ->> 'detail')
      else v_dec #>> '{work,operation}' end;
    v_items := v_items || jsonb_build_object('outbox_id', v_out.id, 'action', v_out.action_type,
                                             'link_id', app.calendar_link_id_for_outbox(v_out), 'would', v_would);
  end loop;
  return jsonb_build_object('mode', v_mode, 'release_mode_automated', app.mode_available('FN-02', 'Automated'),
    'planned', v_items,
    'summary', 'DRY RUN (' || v_mode || '): ' || jsonb_array_length(v_items) || ' row(s) planned; no writes',
    'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- CALENDAR_REVIEW_RESOLVE (_calResolveReview): human recovery of an
-- uncertain calendar row. Idempotent through the command ledger.
-- Payload: outbox_id, resolution (AdoptEvent | MarkCancelled | Retry |
-- Retarget), external_event_id (AdoptEvent), reason.
-- -----------------------------------------------------------------------------

create function app.cmd_calendar_review_resolve(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['outbox_id', 'resolution', 'external_event_id', 'reason'], '{}');
  v_outbox_text text := app.txt(v_p, 'outbox_id');
  v_resolution text := app.txt(v_p, 'resolution');
  v_ext text := app.txt(v_p, 'external_event_id');
  v_reason text := app.txt(v_p, 'reason');
  v_who text := coalesce(p_actor ->> 'email', p_actor ->> 'id');
  v_shared text := nullif(btrim(app.setting('calendar.shared_calendar_id') #>> '{}'), '');
  v_out public.outbox;
  v_out2 public.outbox;
  v_link public.calendar_links;
  v_link2 public.calendar_links;
  v_link_id uuid;
  v_current boolean := false;
  v_task public.tasks;
  v_done public.tasks;
  v_note text;
  v_completed jsonb := '[]';
begin
  if v_outbox_text is null or v_reason is null then
    perform app.fail('CAL_REVIEW: outbox_id and reason required');
  end if;
  if v_resolution is null or v_resolution not in ('AdoptEvent', 'MarkCancelled', 'Retry', 'Retarget') then
    perform app.fail('CAL_REVIEW: resolution must be AdoptEvent, MarkCancelled, Retry or Retarget');
  end if;
  if app.is_uuid_text(v_outbox_text) then
    select * into v_out from public.outbox where id = v_outbox_text::uuid for update;
  end if;
  if v_out.id is null or not app.calendar_action(v_out.action_type) then
    perform app.fail('CAL_REVIEW: calendar outbox row not found');
  end if;
  if v_out.status not in ('NeedsReview', 'RetryDue', 'Processing') then
    perform app.fail('CAL_REVIEW: outbox status ' || v_out.status || ' is not reviewable');
  end if;
  v_link_id := app.calendar_link_id_for_outbox(v_out);
  if v_link_id is not null then
    select * into v_link from public.calendar_links where id = v_link_id for update;
    v_current := v_link.outbox_id is not distinct from v_out.id;
  end if;
  -- Deviation: a row without a (current) link can still be closed by MarkCancelled.
  if v_link.id is null and v_resolution <> 'MarkCancelled' then
    perform app.fail('CAL_REVIEW: calendar link not found for outbox ' || v_out.id);
  end if;
  if v_link.id is not null and not v_current and v_resolution <> 'MarkCancelled' then
    perform app.fail('CAL_REVIEW: outbox row superseded by a later calendar change; only MarkCancelled applies');
  end if;
  if v_resolution = 'AdoptEvent' and v_ext is null then
    perform app.fail('CAL_REVIEW: external_event_id required to adopt');
  end if;
  if v_resolution = 'Retarget' and v_shared is null then
    perform app.fail('CAL_REVIEW: calendar.shared_calendar_id is not configured');
  end if;

  if v_resolution = 'AdoptEvent' then
    update public.calendar_links set external_event_id = v_ext, event_uid = v_ext,
      status = case when v_out.action_type = 'CalendarCancel' then 'Cancelled' else 'Active' end,
      error = null, last_success_at = now(), last_synced_revision = entity_revision
    where id = v_link.id returning * into v_link2;
    update public.outbox set status = 'Succeeded', external_id = v_ext, next_attempt = null,
      response_summary = left('RESOLVED by ' || v_who || ': adopted event ' || v_ext || ' — ' || v_reason, 400)
    where id = v_out.id returning * into v_out2;
  elsif v_resolution = 'MarkCancelled' then
    if v_current then
      update public.calendar_links set status = 'Cancelled', error = null, last_synced_revision = entity_revision
      where id = v_link.id returning * into v_link2;
    end if;
    update public.outbox set status = 'Cancelled', next_attempt = null,
      response_summary = left('RESOLVED by ' || v_who || ': cancelled without external change — ' || v_reason, 400)
    where id = v_out.id returning * into v_out2;
  elsif v_resolution = 'Retarget' then
    update public.calendar_links set calendar_id = v_shared, error = null,
      status = case when external_event_id is not null then 'UpdatePending' else 'Pending' end
    where id = v_link.id returning * into v_link2;
    update public.outbox set status = 'Pending', next_attempt = now(), target = v_shared,
      response_summary = left('RESOLVED by ' || v_who || ': retargeted to the shared calendar — ' || v_reason, 400)
    where id = v_out.id returning * into v_out2;
  else
    update public.calendar_links set error = null,
      status = case when external_event_id is not null then 'UpdatePending' else 'Pending' end
    where id = v_link.id returning * into v_link2;
    update public.outbox set status = 'Pending', next_attempt = now(),
      response_summary = left('RESOLVED by ' || v_who || ': queued for retry — ' || v_reason, 400)
    where id = v_out.id returning * into v_out2;
  end if;
  perform app.audit('Outbox', v_out.id::text, 'CalendarReview' || v_resolution, to_jsonb(v_out), to_jsonb(v_out2), v_reason);
  if v_link2.id is not null then
    perform app.audit('CalendarLinks', v_link.id::text, 'CalendarReview' || v_resolution, to_jsonb(v_link),
                      to_jsonb(v_link2), v_reason);
  end if;

  -- The resilience review task for this row (S16 RS-REVIEW) is done.
  v_note := v_resolution || ': ' || v_reason;
  for v_task in select * from public.tasks t
                where t.template_code = 'RS-REVIEW' and t.related_entity_type = 'Outbox'
                  and t.related_entity_id = v_out.id and t.status not in ('Complete', 'Cancelled', 'NotRequired')
                order by t.created_at for update loop
    update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.actor_id(p_actor),
      completion_note = v_note, blocking_reason = null
    where id = v_task.id returning * into v_done;
    perform app.task_event(v_task, v_done, 'Complete', v_note);
    perform app.audit('Tasks', v_task.id::text, 'Complete', to_jsonb(v_task), to_jsonb(v_done), v_note);
    v_completed := v_completed || to_jsonb(v_task.id);
  end loop;

  return jsonb_build_object('status', 'Resolved', 'resolved', true, 'outbox_id', v_out.id,
    'link_id', v_link.id, 'resolution', v_resolution, 'outbox_status', v_out2.status,
    'link_status', coalesce(v_link2.status, v_link.status), 'completed_tasks', v_completed, 'external_calls', 0);
end
$$;

-- =============================================================================
-- 3. Resource planning (resource/planning.js)
-- =============================================================================

-- Skill-aware (_s11SkillCheck): only when the person has active skills; none
-- matching the trade is a mismatch. No skills configured = flexible.
-- Deviation: a trade that is not a skill code (ReturnVisit, Other) is not
-- checked (REF-04 §7/§8.4); the reference mismatched every skilled installer.
create function app.rp_skill_check(p_person_id uuid, p_trade text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_skills text[];
begin
  if p_trade is null or not exists (select 1 from public.skills s where s.code = p_trade) then
    return jsonb_build_object('ok', true, 'configured', false);
  end if;
  select coalesce(array_agg(ps.skill_code order by ps.skill_code), '{}') into v_skills
  from public.person_skills ps where ps.person_id = p_person_id and ps.active;
  if cardinality(v_skills) = 0 then
    return jsonb_build_object('ok', true, 'configured', false);
  end if;
  return jsonb_build_object('ok', p_trade = any (v_skills), 'configured', true, 'skills', to_jsonb(v_skills));
end
$$;

-- Authoritative commit-time check for the S11 R2 commands (_s11ValidatePerson
-- with trade, then _s11Capacity): first failing reason.
create function app.r2_person_ready(p_person_id uuid, p_start date, p_end date, p_trade text, p_exclude uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_check jsonb := app.s11_validate_person(p_person_id, p_start, p_end);
  v_skill jsonb;
begin
  if not (v_check ->> 'ready')::boolean then
    return v_check;
  end if;
  v_skill := app.rp_skill_check(p_person_id, p_trade);
  if not (v_skill ->> 'ok')::boolean then
    return jsonb_build_object('ready', false, 'reason', 'SKILL_MISMATCH', 'detail', v_skill);
  end if;
  return app.s11_capacity(p_person_id, p_start, p_end, p_exclude);
end
$$;

-- Readiness assessment of one person (_rpAssessPerson): every reason, plus
-- warnings, per-day capacity and load. Pure read.
create function app.rp_assess_person(p_person_id uuid, p_trade text, p_start date, p_end date, p_exclude uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_p public.people;
  v_reasons text[] := '{}';
  v_warnings text[] := '{}';
  v_teams jsonb;
  v_skills jsonb;
  v_configured boolean;
  v_level text;
  v_cert date;
  v_matches boolean;
  v_leave jsonb;
  v_capacity jsonb := '[]';
  v_day date := p_start;
  v_n int := 0;
  v_used int;
  v_ids jsonb;
  v_load int := 0;
begin
  select * into v_p from public.people where id = p_person_id;
  select coalesce(jsonb_agg(jsonb_build_object('team_id', m.team_id, 'team', t.name, 'role', m.role) order by t.name), '[]')
  into v_teams
  from public.team_members m join public.teams t on t.id = m.team_id
  where m.person_id = p_person_id and m.active;
  if v_p.id is null or not v_p.active or not app.person_has_active_role(p_person_id, array['Installer']) then
    return jsonb_build_object('person_id', p_person_id, 'display_name', coalesce(v_p.display_name, p_person_id::text),
      'ready', false, 'reasons', jsonb_build_array('INSTALLER_INACTIVE_OR_WRONG_ROLE'), 'warnings', '[]'::jsonb,
      'skill', null, 'leave_conflicts', '[]'::jsonb, 'capacity', '[]'::jsonb, 'teams', v_teams, 'load', 0);
  end if;
  if v_p.capacity_per_day is null or v_p.capacity_per_day < 1 then
    v_reasons := array_append(v_reasons, 'CAPACITY_NOT_CONFIGURED');
  end if;
  if (v_p.available_from is not null and p_start < v_p.available_from)
     or (v_p.available_to is not null and p_end > v_p.available_to) then
    v_reasons := array_append(v_reasons, 'INSTALLER_UNAVAILABLE');
  end if;

  select coalesce(jsonb_agg(ps.skill_code || ':' || ps.level order by ps.skill_code), '[]'), count(*) > 0
  into v_skills, v_configured
  from public.person_skills ps where ps.person_id = p_person_id and ps.active;
  select ps.level, ps.certified_until into v_level, v_cert
  from public.person_skills ps where ps.person_id = p_person_id and ps.active and ps.skill_code = p_trade;
  v_matches := found;
  if v_configured and not v_matches then
    v_reasons := array_append(v_reasons, 'SKILL_MISMATCH');
  end if;
  if v_matches and v_cert is not null and v_cert < p_end then
    v_warnings := array_append(v_warnings, 'CERTIFICATION_EXPIRES_BEFORE_END');
  end if;
  if v_matches and v_level = 'Apprentice' then
    v_warnings := array_append(v_warnings, 'APPRENTICE_NEEDS_SUPERVISION');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('availability_id', a.id, 'type', a.type, 'from_date', a.from_date,
                                               'to_date', coalesce(a.to_date, a.from_date)) order by a.from_date), '[]')
  into v_leave
  from public.person_availability a
  where a.person_id = p_person_id and a.active and a.type <> 'Available'
    and a.from_date <= p_end and coalesce(a.to_date, a.from_date) >= p_start;
  if jsonb_array_length(v_leave) > 0 then
    v_reasons := array_append(v_reasons, 'ON_LEAVE');
  end if;

  -- Reference caps the range at 400 days.
  while v_day <= p_end and v_n < 400 loop
    v_n := v_n + 1;
    if exists (select 1 from public.holidays h where h.local_date = v_day and h.office_closed) then
      if not 'OFFICE_HOLIDAY' = any (v_reasons) then
        v_reasons := array_append(v_reasons, 'OFFICE_HOLIDAY');
      end if;
    elsif app.is_staffed_day(v_day) then
      select count(*)::int, coalesce(jsonb_agg(a.id order by a.id), '[]') into v_used, v_ids
      from public.allocations a
      where a.active and a.person_id = p_person_id and a.id is distinct from p_exclude
        and a.start_at is not null and a.end_at is not null and a.start_at <= v_day and a.end_at >= v_day;
      v_capacity := v_capacity || jsonb_build_object('date', v_day, 'used', v_used, 'capacity', v_p.capacity_per_day,
                                                     'allocations', v_ids);
      v_load := v_load + v_used;
      if coalesce(v_p.capacity_per_day, 0) >= 1 and v_used >= v_p.capacity_per_day
         and not 'CAPACITY_CONFLICT' = any (v_reasons) then
        v_reasons := array_append(v_reasons, 'CAPACITY_CONFLICT');
      end if;
    end if;
    v_day := v_day + 1;
  end loop;

  return jsonb_build_object('person_id', p_person_id, 'display_name', v_p.display_name,
    'ready', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'warnings', to_jsonb(v_warnings),
    'skill', jsonb_build_object('configured', v_configured, 'matches', v_matches, 'level', v_level, 'skills', v_skills),
    'leave_conflicts', v_leave, 'capacity', v_capacity, 'teams', v_teams, 'load', v_load);
end
$$;

-- Ranked assessment (_rpAssess): ready first, then Lead/Member/Apprentice,
-- least load, name. Team mode reports all_ready and lead readiness.
create function app.rp_assess(p_trade text, p_start date, p_end date, p_person_ids uuid[], p_team_id uuid,
                              p_exclude uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_candidates jsonb;
  v_lead uuid;
  v_result jsonb;
begin
  if p_trade is null or not exists (select 1 from public.skills s where s.code = p_trade and s.active) then
    perform app.fail('RP_REVIEW: trade must be Roof or Electrical');
  end if;
  if p_start is null or p_end is null then
    perform app.fail('RP_REVIEW: start and end dates required');
  end if;
  if p_end < p_start then
    perform app.fail('RP_REVIEW: end before start');
  end if;
  if cardinality(p_person_ids) > 0 then
    v_ids := p_person_ids;
  elsif p_team_id is not null then
    select coalesce(array_agg(m.person_id order by m.person_id), '{}') into v_ids
    from public.team_members m where m.team_id = p_team_id and m.active;
    select m.person_id into v_lead from public.team_members m
    where m.team_id = p_team_id and m.active and m.role = 'Lead' limit 1;
  else
    select coalesce(array_agg(p.id order by p.id), '{}') into v_ids
    from public.people p where p.active and app.person_has_active_role(p.id, array['Installer']);
  end if;

  select coalesce(jsonb_agg(c.j order by
           (c.j ->> 'ready')::boolean desc,
           case when (c.j #>> '{skill,matches}')::boolean
                then coalesce(array_position(array['Lead', 'Member', 'Apprentice'], c.j #>> '{skill,level}') - 1, 3)
                else 3 end,
           (c.j ->> 'load')::int, c.j ->> 'display_name'), '[]')
  into v_candidates
  from (select app.rp_assess_person(x, p_trade, p_start, p_end, p_exclude) j from unnest(v_ids) x) c;

  v_result := jsonb_build_object('trade', p_trade, 'start_at', p_start, 'end_at', p_end,
    'working_days', (select count(*) from generate_series(p_start, p_end, interval '1 day') d
                     where app.is_staffed_day(d::date)),
    'candidates', v_candidates,
    'ready_count', (select count(*) from jsonb_array_elements(v_candidates) e where (e ->> 'ready')::boolean));
  if p_team_id is not null and coalesce(cardinality(p_person_ids), 0) = 0 then
    v_result := v_result || jsonb_build_object('team', jsonb_build_object(
      'team_id', p_team_id,
      'all_ready', jsonb_array_length(v_candidates) > 0
                   and not exists (select 1 from jsonb_array_elements(v_candidates) e where not (e ->> 'ready')::boolean),
      'lead_person_id', v_lead,
      'lead_ready', coalesce((select (e ->> 'ready')::boolean from jsonb_array_elements(v_candidates) e
                              where e ->> 'person_id' = v_lead::text), false),
      'members', jsonb_array_length(v_candidates)));
  end if;
  return v_result;
end
$$;

-- _rpTeams.
create function app.rp_teams()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', t.id, 'name', t.name, 'trade', t.trade, 'active', t.active, 'version', t.version,
    'lead', (select m.person_id from public.team_members m where m.team_id = t.id and m.active and m.role = 'Lead' limit 1),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('person_id', m.person_id, 'display_name', p.display_name,
                                                            'role', m.role, 'active_person', p.active)
                                          order by p.display_name), '[]')
                from public.team_members m join public.people p on p.id = m.person_id
                where m.team_id = t.id and m.active)) order by t.name), '[]')
  from public.teams t
$$;

-- -----------------------------------------------------------------------------
-- RP commands (configuration: Admin / Manager / Office - app.command_registry)
-- -----------------------------------------------------------------------------

-- _rpSetSkill: one row per person + skill (canonical person_skills), installers only.
create function app.cmd_rp_set_skill(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['person_id', 'skill', 'level', 'certified_until', 'active', 'notes', 'reason'], '{}');
  v_person uuid := app.ref(v_p, 'person_id');
  v_skill text := app.txt(v_p, 'skill');
  v_level text := coalesce(app.txt(v_p, 'level'), 'Member');
  v_until date;
  v_active boolean := case when v_p ? 'active' then app.yes_flag(v_p -> 'active') else true end;
  v_before public.person_skills;
  v_after public.person_skills;
begin
  if v_person is null or not app.person_has_active_role(v_person, array['Installer']) then
    perform app.fail('RP_REVIEW: active Installer required');
  end if;
  if v_skill is null or not exists (select 1 from public.skills s where s.code = v_skill and s.active) then
    perform app.fail('RP_REVIEW: skill must be Roof or Electrical');
  end if;
  if v_level not in ('Lead', 'Member', 'Apprentice') then
    perform app.fail('RP_REVIEW: level must be Lead, Member or Apprentice');
  end if;
  if app.txt(v_p, 'certified_until') is not null then
    v_until := app.s1x_local_date(app.txt(v_p, 'certified_until'), 'RP');
  end if;
  select * into v_before from public.person_skills where person_id = v_person and skill_code = v_skill for update;
  if v_before.id is null then
    insert into public.person_skills (person_id, skill_code, level, certified_until, active, notes)
    values (v_person, v_skill, v_level, v_until, v_active, app.txt(v_p, 'notes'))
    returning * into v_after;
  else
    perform app.r2_optional_version(p_request, v_before.version);
    update public.person_skills set level = v_level, certified_until = v_until, active = v_active,
      notes = app.txt(v_p, 'notes')
    where id = v_before.id returning * into v_after;
  end if;
  perform app.audit('PersonSkills', v_after.id::text, case when v_before.id is null then 'SetSkill' else 'UpdateSkill' end,
                    case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_after),
                    app.txt(v_p, 'reason'));
  return jsonb_build_object('status', case when v_before.id is null then 'Created' else 'Updated' end,
                            'created', v_before.id is null, 'skill', to_jsonb(v_after), 'external_calls', 0);
end
$$;

-- _rpSetAvailability: leave periods; overlapping active allocations are
-- returned for re-planning (type Available never conflicts).
create function app.cmd_rp_set_availability(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['person_id', 'type', 'from_date', 'to_date', 'reason', 'approved_by',
                                            'availability_id'], '{}');
  v_person uuid := app.ref(v_p, 'person_id');
  v_type text := app.txt(v_p, 'type');
  v_from date;
  v_to date;
  v_approver uuid := coalesce(app.ref(v_p, 'approved_by'), app.actor_id(p_actor));
  v_avail_id uuid := app.ref(v_p, 'availability_id');
  v_before public.person_availability;
  v_after public.person_availability;
  v_conflicts jsonb := '[]';
begin
  if v_person is null or not exists (select 1 from public.people p where p.id = v_person and p.active) then
    perform app.fail('RP_REVIEW: active person required');
  end if;
  if v_type is null or v_type not in ('Leave', 'Sick', 'Training', 'Unavailable', 'Available') then
    perform app.fail('RP_REVIEW: type must be Leave, Sick, Training, Unavailable or Available');
  end if;
  if app.txt(v_p, 'from_date') is null then
    perform app.fail('RP_REVIEW: from_date required');
  end if;
  v_from := app.s1x_local_date(app.txt(v_p, 'from_date'), 'RP');
  v_to := case when app.txt(v_p, 'to_date') is null then v_from else app.s1x_local_date(app.txt(v_p, 'to_date'), 'RP') end;
  if v_to < v_from then
    perform app.fail('RP_REVIEW: to_date before from_date');
  end if;
  if not exists (select 1 from public.people p where p.id = v_approver) then
    perform app.fail('RP_REVIEW: approved_by must be a person');
  end if;
  if v_avail_id is not null then
    select * into v_before from public.person_availability where id = v_avail_id for update;
    if v_before.id is null or v_before.person_id <> v_person then
      perform app.fail('RP_REVIEW: availability not found');
    end if;
    perform app.r2_optional_version(p_request, v_before.version);
    update public.person_availability set type = v_type, from_date = v_from, to_date = v_to,
      reason = app.txt(v_p, 'reason'), approved_by = v_approver, active = true
    where id = v_before.id returning * into v_after;
  else
    insert into public.person_availability (person_id, type, from_date, to_date, reason, approved_by, active)
    values (v_person, v_type, v_from, v_to, app.txt(v_p, 'reason'), v_approver, true)
    returning * into v_after;
  end if;
  if v_type <> 'Available' then
    select coalesce(jsonb_agg(jsonb_build_object('allocation_id', a.id, 'work_package_id', a.work_package_id,
                                                 'job_id', w.job_id, 'trade', w.trade, 'start_at', a.start_at,
                                                 'end_at', a.end_at) order by a.start_at, a.id), '[]')
    into v_conflicts
    from public.allocations a join public.work_packages w on w.id = a.work_package_id
    where a.person_id = v_person and a.active and a.start_at is not null and a.end_at is not null
      and a.start_at <= v_to and a.end_at >= v_from;
  end if;
  perform app.audit('PersonAvailability', v_after.id::text,
                    case when v_before.id is null then 'SetAvailability' else 'UpdateAvailability' end,
                    case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_after),
                    app.txt(v_p, 'reason'));
  return jsonb_build_object('status', case when v_before.id is null then 'Created' else 'Updated' end,
    'created', v_before.id is null, 'availability', to_jsonb(v_after), 'allocation_conflicts', v_conflicts,
    'replan_required', jsonb_array_length(v_conflicts) > 0, 'external_calls', 0);
end
$$;

-- _rpCancelAvailability.
create function app.cmd_rp_cancel_availability(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['availability_id', 'reason'], '{}');
  v_id uuid := app.ref(v_p, 'availability_id');
  v_reason text := app.txt(v_p, 'reason');
  v_before public.person_availability;
  v_after public.person_availability;
begin
  if v_id is not null then
    select * into v_before from public.person_availability where id = v_id for update;
  end if;
  if v_before.id is null then
    perform app.fail('RP_REVIEW: availability not found');
  end if;
  if v_reason is null then
    perform app.fail('RP_REVIEW: reason required');
  end if;
  perform app.r2_optional_version(p_request, v_before.version);
  update public.person_availability set active = false where id = v_before.id returning * into v_after;
  perform app.audit('PersonAvailability', v_after.id::text, 'CancelAvailability', to_jsonb(v_before), to_jsonb(v_after), v_reason);
  return jsonb_build_object('status', 'Cancelled', 'availability', to_jsonb(v_after), 'external_calls', 0);
end
$$;

-- _rpUpsertTeam: by team_id, else by name slug (reference id TEAM-<slug>).
create function app.cmd_rp_upsert_team(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['team_id', 'name', 'trade', 'active', 'notes'], '{}');
  v_team_id uuid := app.ref(v_p, 'team_id');
  v_name text := app.txt(v_p, 'name');
  v_trade text := app.txt(v_p, 'trade');
  v_active boolean := case when v_p ? 'active' then app.yes_flag(v_p -> 'active') else true end;
  v_before public.teams;
  v_after public.teams;
begin
  if v_name is null then
    perform app.fail('RP_REVIEW: name required');
  end if;
  if v_trade is null or v_trade not in ('Roof', 'Electrical', 'Mixed') then
    perform app.fail('RP_REVIEW: trade must be Roof, Electrical or Mixed');
  end if;
  if v_team_id is not null then
    select * into v_before from public.teams where id = v_team_id for update;
    if v_before.id is null then
      perform app.fail('RP_REVIEW: team not found');
    end if;
  else
    select * into v_before from public.teams t
    where btrim(regexp_replace(lower(btrim(t.name)), '[^a-z0-9]+', '-', 'g'), '-')
        = btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-')
    order by t.created_at limit 1 for update;
  end if;
  if v_before.id is null then
    insert into public.teams (name, trade, active, notes) values (v_name, v_trade, v_active, app.txt(v_p, 'notes'))
    returning * into v_after;
  else
    perform app.r2_optional_version(p_request, v_before.version);
    update public.teams set name = v_name, trade = v_trade, active = v_active, notes = app.txt(v_p, 'notes')
    where id = v_before.id returning * into v_after;
  end if;
  perform app.audit('Teams', v_after.id::text, case when v_before.id is null then 'CreateTeam' else 'UpdateTeam' end,
                    case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_after), null);
  return jsonb_build_object('status', case when v_before.id is null then 'Created' else 'Updated' end,
                            'created', v_before.id is null, 'team', to_jsonb(v_after), 'external_calls', 0);
end
$$;

-- _rpSetTeamMember: installers only, one active Lead per team.
create function app.cmd_rp_set_team_member(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['team_id', 'person_id', 'role', 'from_date', 'to_date', 'active'], '{}');
  v_team public.teams;
  v_person uuid := app.ref(v_p, 'person_id');
  v_role text := coalesce(app.txt(v_p, 'role'), 'Member');
  v_active boolean := case when v_p ? 'active' then app.yes_flag(v_p -> 'active') else true end;
  v_from date;
  v_to date;
  v_other public.team_members;
  v_before public.team_members;
  v_after public.team_members;
begin
  if app.ref(v_p, 'team_id') is not null then
    -- The team row lock serialises the one-Lead rule.
    select * into v_team from public.teams where id = app.ref(v_p, 'team_id') for update;
  end if;
  if v_team.id is null then
    perform app.fail('RP_REVIEW: team not found');
  end if;
  if v_person is null or not app.person_has_active_role(v_person, array['Installer']) then
    perform app.fail('RP_REVIEW: active Installer required');
  end if;
  if v_role not in ('Lead', 'Member', 'Apprentice') then
    perform app.fail('RP_REVIEW: role must be Lead, Member or Apprentice');
  end if;
  if app.txt(v_p, 'from_date') is not null then
    v_from := app.s1x_local_date(app.txt(v_p, 'from_date'), 'RP');
  end if;
  if app.txt(v_p, 'to_date') is not null then
    v_to := app.s1x_local_date(app.txt(v_p, 'to_date'), 'RP');
  end if;
  if v_from is not null and v_to is not null and v_to < v_from then
    perform app.fail('RP_REVIEW: to_date before from_date');
  end if;
  if v_active and v_role = 'Lead' then
    select * into v_other from public.team_members m
    where m.team_id = v_team.id and m.person_id <> v_person and m.active and m.role = 'Lead' limit 1;
    if v_other.id is not null then
      perform app.fail('RP_REVIEW: team already has an active Lead (' || v_other.person_id || '); change that member first');
    end if;
  end if;
  select * into v_before from public.team_members where team_id = v_team.id and person_id = v_person for update;
  if v_before.id is null then
    insert into public.team_members (team_id, person_id, role, from_date, to_date, active)
    values (v_team.id, v_person, v_role, v_from, v_to, v_active) returning * into v_after;
  else
    perform app.r2_optional_version(p_request, v_before.version);
    update public.team_members set role = v_role, from_date = v_from, to_date = v_to, active = v_active
    where id = v_before.id returning * into v_after;
  end if;
  perform app.audit('TeamMembers', v_after.id::text, case when v_before.id is null then 'AddTeamMember' else 'UpdateTeamMember' end,
                    case when v_before.id is null then null else to_jsonb(v_before) end, to_jsonb(v_after), null);
  return jsonb_build_object('status', case when v_before.id is null then 'Created' else 'Updated' end,
                            'created', v_before.id is null, 'member', to_jsonb(v_after), 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- RP reads (office class; pure)
-- -----------------------------------------------------------------------------

create function app.r2cal_opt_date(p_request jsonb, p_key text)
returns date
language plpgsql stable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_request ->> p_key, '')), '') is null then
    return null;
  end if;
  return app.s1x_local_date(p_request ->> p_key, 'RP');
end
$$;

create function app.read_rp_assess(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  perform app.r2cal_read_keys(p_request, array['trade', 'start_at', 'end_at', 'person_ids', 'team_id', 'exclude_allocation_id']);
  if p_request ? 'person_ids' and jsonb_typeof(p_request -> 'person_ids') <> 'null' then
    if jsonb_typeof(p_request -> 'person_ids') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_request -> 'person_ids') e
                  where jsonb_typeof(e) <> 'string' or not app.is_uuid_text(e #>> '{}')) then
      perform app.fail('R1A_INVALID_PERSON_IDS');
    end if;
    v_ids := array(select (e #>> '{}')::uuid from jsonb_array_elements(p_request -> 'person_ids') e);
  end if;
  return app.rp_assess(p_request ->> 'trade', app.r2cal_opt_date(p_request, 'start_at'),
                       app.r2cal_opt_date(p_request, 'end_at'), v_ids, app.ref(p_request, 'team_id'),
                       app.ref(p_request, 'exclude_allocation_id'));
end
$$;

-- _rpChangeInstallerOptions.
create function app.read_rp_change_installer_options(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_wp public.work_packages;
  v_start date;
  v_end date;
  v_exclude uuid;
  v_assess jsonb;
  v_current jsonb;
  v_candidates jsonb;
  v_teams jsonb;
begin
  perform app.r2cal_read_keys(p_request, array['work_package_id', 'old_allocation_id', 'start_at', 'end_at']);
  select * into v_wp from public.work_packages where id = app.ref(p_request, 'work_package_id');
  if v_wp.id is null then
    perform app.fail('RP_REVIEW: work package not found');
  end if;
  v_start := coalesce(app.r2cal_opt_date(p_request, 'start_at'), v_wp.planned_start);
  v_end := coalesce(app.r2cal_opt_date(p_request, 'end_at'), v_wp.planned_end);
  if v_start is null or v_end is null then
    perform app.fail('RP_REVIEW: work package has no planned dates');
  end if;
  if not exists (select 1 from public.skills s where s.code = v_wp.trade and s.active) then
    perform app.fail('RP_REVIEW: work package trade ' || v_wp.trade || ' is not Roof/Electrical');
  end if;
  v_exclude := app.ref(p_request, 'old_allocation_id');
  v_assess := app.rp_assess(v_wp.trade, v_start, v_end, null, null, v_exclude);
  select coalesce(jsonb_agg(jsonb_build_object('allocation_id', a.id, 'person_id', a.person_id, 'role', a.role)
                            order by a.created_at, a.id), '[]')
  into v_current from public.allocations a where a.work_package_id = v_wp.id and a.active;
  select coalesce(jsonb_agg(c || jsonb_build_object(
           'currently_allocated', exists (select 1 from jsonb_array_elements(v_current) x where x ->> 'person_id' = c ->> 'person_id'),
           'allocation_id', (select x -> 'allocation_id' from jsonb_array_elements(v_current) x
                             where x ->> 'person_id' = c ->> 'person_id' limit 1)) order by n), '[]')
  into v_candidates
  from jsonb_array_elements(v_assess -> 'candidates') with ordinality as t(c, n);
  select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'trade', t.trade,
           'all_ready', a.r #>> '{team,all_ready}', 'lead_ready', a.r #>> '{team,lead_ready}',
           'members', (select coalesce(jsonb_agg(jsonb_build_object('person_id', m ->> 'person_id',
                         'display_name', m ->> 'display_name', 'ready', m -> 'ready', 'reasons', m -> 'reasons')), '[]')
                       from jsonb_array_elements(a.r -> 'candidates') m)) order by t.name), '[]')
  into v_teams
  from public.teams t
  cross join lateral (select app.rp_assess(v_wp.trade, v_start, v_end, null, t.id, v_exclude) r) a
  where t.active and t.trade in (v_wp.trade, 'Mixed')
    and exists (select 1 from public.team_members m where m.team_id = t.id and m.active);
  return jsonb_build_object('work_package_id', v_wp.id, 'job_id', v_wp.job_id, 'trade', v_wp.trade,
    'start_at', v_start, 'end_at', v_end, 'current_allocations', v_current, 'candidates', v_candidates,
    'ready_count', v_assess -> 'ready_count', 'teams', v_teams);
end
$$;

-- _rpMoveJobPreview (read-only impact of proposed dates).
create function app.read_rp_move_job_preview(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_acts text[];
  v_start date;
  v_end date;
  v_erect date;
  v_strip date;
  v_wp public.work_packages;
  v_alloc public.allocations;
  v_scb public.scaffold_bookings;
  v_as jsonb;
  v_entry jsonb;
  v_people jsonb;
  v_wps jsonb := '[]';
  v_preserved jsonb := '[]';
  v_scaffold jsonb := '[]';
  v_materials jsonb := '[]';
  v_warnings text[] := '{}';
  v_conflicts int := 0;
  v_links int := 0;
  v_m record;
  v_flag text;
  v_moving boolean;
begin
  perform app.r2cal_read_keys(p_request, array['job_id', 'activities', 'planned_start', 'planned_end',
                                               'scaffold_erect', 'scaffold_strip']);
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id');
  if v_job.id is null then
    perform app.fail('RP_REVIEW: job not found');
  end if;
  if jsonb_typeof(p_request -> 'activities') = 'array' then
    v_acts := array(select e #>> '{}' from jsonb_array_elements(p_request -> 'activities') e);
  end if;
  if coalesce(cardinality(v_acts), 0) = 0 then
    perform app.fail('RP_REVIEW: select at least one activity (Roof|Electrical|Scaffold)');
  end if;
  v_start := app.r2cal_opt_date(p_request, 'planned_start');
  v_end := app.r2cal_opt_date(p_request, 'planned_end');
  v_erect := app.r2cal_opt_date(p_request, 'scaffold_erect');
  v_strip := app.r2cal_opt_date(p_request, 'scaffold_strip');

  for v_wp in select * from public.work_packages w where w.job_id = v_job.id and w.status <> 'Cancelled'
              order by w.sequence, w.id loop
    if not v_wp.trade = any (v_acts) then
      v_preserved := v_preserved || jsonb_build_object('work_package_id', v_wp.id, 'trade', v_wp.trade,
        'planned_start', v_wp.planned_start, 'planned_end', v_wp.planned_end,
        'allocations', (select count(*) from public.allocations a where a.work_package_id = v_wp.id and a.active));
      continue;
    end if;
    if v_start is null or v_end is null then
      perform app.fail('RP_REVIEW: planned_start/planned_end required for ' || v_wp.trade);
    end if;
    if v_end < v_start then
      perform app.fail('RP_REVIEW: end before start');
    end if;
    v_people := '[]';
    if exists (select 1 from public.skills s where s.code = v_wp.trade) then
      for v_alloc in select * from public.allocations a where a.work_package_id = v_wp.id and a.active
                     order by a.created_at, a.id loop
        v_as := app.rp_assess_person(v_alloc.person_id, v_wp.trade, v_start, v_end, v_alloc.id);
        v_people := v_people || jsonb_build_object('allocation_id', v_alloc.id, 'person_id', v_alloc.person_id,
          'display_name', v_as -> 'display_name', 'role', v_alloc.role, 'ready', v_as -> 'ready',
          'reasons', v_as -> 'reasons', 'warnings', v_as -> 'warnings', 'leave_conflicts', v_as -> 'leave_conflicts');
        if not (v_as ->> 'ready')::boolean then
          v_conflicts := v_conflicts + 1;
        end if;
        if v_alloc.calendar_link_id is not null
           and exists (select 1 from public.calendar_links c where c.id = v_alloc.calendar_link_id) then
          v_links := v_links + 1;
        end if;
      end loop;
    end if;
    for v_m in
      select m.id, m.need_by_date, o.id as order_id, o.status as order_status
      from public.materials m
      left join public.order_lines ol on ol.id = m.order_line_id
      left join public.orders o on o.id = ol.order_id
      where m.work_package_id = v_wp.id and m.required_quantity - m.cancelled_quantity > 0
      order by m.need_by_date, m.id
    loop
      v_flag := case when v_m.need_by_date > v_start then 'NEED_BY_AFTER_NEW_START'
                     when v_m.order_status in ('Requested', 'Confirmed') and v_m.need_by_date < v_start - 14
                       then 'DELIVERY_WELL_BEFORE_NEW_START' end;
      v_materials := v_materials || jsonb_build_object('material_id', v_m.id, 'work_package_id', v_wp.id,
        'need_by_date', v_m.need_by_date, 'order_id', v_m.order_id, 'order_status', v_m.order_status, 'flag', v_flag);
      if v_flag is not null then
        v_warnings := array_append(v_warnings, v_wp.trade || ' material ' || v_m.id || ': ' || v_flag);
      end if;
    end loop;
    v_wps := v_wps || jsonb_build_object('work_package_id', v_wp.id, 'trade', v_wp.trade,
      'current', jsonb_build_object('planned_start', v_wp.planned_start, 'planned_end', v_wp.planned_end),
      'proposed', jsonb_build_object('planned_start', v_start, 'planned_end', v_end),
      'revision', v_wp.revision, 'expected_version', v_wp.version, 'people', v_people);
  end loop;

  for v_scb in select * from public.scaffold_bookings b where b.job_id = v_job.id and b.status <> 'Cancelled'
               order by b.created_at, b.id loop
    v_moving := 'Scaffold' = any (v_acts);
    v_scaffold := v_scaffold || jsonb_build_object('scaffold_booking_id', v_scb.id, 'status', v_scb.status,
      'moving', v_moving,
      'current', jsonb_build_object('erect_planned_at', v_scb.erect_planned_at, 'strip_planned_at', v_scb.strip_planned_at),
      'proposed', case when v_moving then jsonb_build_object('erect_planned_at', coalesce(v_erect, v_scb.erect_planned_at),
                                                             'strip_planned_at', coalesce(v_strip, v_scb.strip_planned_at)) end,
      'acknowledgement_required_after_move', v_moving, 'erected', v_scb.erect_actual_at is not null);
    if v_moving and v_scb.erect_actual_at is not null and v_erect is not null then
      v_warnings := array_append(v_warnings, 'Scaffold ' || v_scb.id || ' already erected; erect date cannot move');
    end if;
    if not v_moving and 'Roof' = any (v_acts) and v_scb.erect_planned_at is not null and v_start is not null
       and v_scb.erect_planned_at > v_start then
      v_warnings := array_append(v_warnings, 'Scaffold erect ' || v_scb.erect_planned_at
                                 || ' is after the proposed roof start ' || v_start);
    end if;
  end loop;

  return jsonb_build_object('job_id', v_job.id, 'job_version', v_job.version, 'activities', to_jsonb(v_acts),
    'proposed', jsonb_build_object('planned_start', v_start, 'planned_end', v_end, 'scaffold_erect', v_erect,
                                   'scaffold_strip', v_strip),
    'work_packages', v_wps, 'preserved', v_preserved, 'scaffold', v_scaffold, 'calendar_links', v_links,
    'materials', v_materials, 'conflicts', v_conflicts, 'warnings', to_jsonb(v_warnings),
    'ok_to_move', v_conflicts = 0);
end
$$;

create function app.read_rp_teams(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  perform app.r2cal_read_keys(p_request, '{}');
  return jsonb_build_object('teams', app.rp_teams());
end
$$;

-- _rpTeamPlanner: team-grouped allocations and leave over a window, the
-- installers in no team, and booked work with no active allocation.
create function app.read_rp_team_planner(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  v_weeks int := 3;
begin
  perform app.r2cal_read_keys(p_request, array['start', 'weeks']);
  v_from := coalesce(app.r2cal_opt_date(p_request, 'start'), app.london_date(now()));
  if p_request ? 'weeks' and jsonb_typeof(p_request -> 'weeks') <> 'null' then
    if jsonb_typeof(p_request -> 'weeks') <> 'number' or (p_request ->> 'weeks') !~ '^[0-9]+$'
       or (p_request ->> 'weeks')::int not between 1 and 26 then
      perform app.fail('RP_REVIEW: weeks must be a whole number from 1 to 26');
    end if;
    v_weeks := (p_request ->> 'weeks')::int;
  end if;
  v_to := v_from + v_weeks * 7 - 1;
  return jsonb_build_object('from', v_from, 'to', v_to, 'weeks', v_weeks,
    'holidays', (select coalesce(jsonb_agg(h.local_date order by h.local_date), '[]') from public.holidays h
                 where h.office_closed and h.local_date between v_from and v_to),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'trade', t.trade,
                'lead', (select m.person_id from public.team_members m where m.team_id = t.id and m.active and m.role = 'Lead' limit 1),
                'members', (select coalesce(jsonb_agg(jsonb_build_object('person_id', m.person_id, 'display_name', p.display_name,
                              'role', m.role, 'allocations', app.rp_person_window(m.person_id, v_from, v_to),
                              'leave', app.rp_person_leave(m.person_id, v_from, v_to)) order by p.display_name), '[]')
                            from public.team_members m join public.people p on p.id = m.person_id
                            where m.team_id = t.id and m.active)) order by t.name), '[]')
              from public.teams t where t.active),
    'unassigned_installers', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.id, 'display_name', p.display_name,
                'allocations', app.rp_person_window(p.id, v_from, v_to), 'leave', app.rp_person_leave(p.id, v_from, v_to))
                order by p.display_name), '[]')
              from public.people p
              where p.active and app.person_has_active_role(p.id, array['Installer'])
                and not exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
                                where m.person_id = p.id and m.active and t.active)),
    'unallocated_work', (select coalesce(jsonb_agg(jsonb_build_object('work_package_id', w.id, 'job_id', w.job_id,
                'job_id_human', j.job_ref, 'job_display', j.display_name, 'trade', w.trade, 'status', w.status,
                'planned_start', w.planned_start, 'planned_end', w.planned_end) order by w.planned_start, w.id), '[]')
              from public.work_packages w join public.jobs j on j.id = w.job_id
              where w.status <> 'Cancelled' and w.planned_start is not null and w.planned_end is not null
                and w.planned_start <= v_to and w.planned_end >= v_from
                and not exists (select 1 from public.allocations a where a.work_package_id = w.id and a.active)));
end
$$;

-- A person's active allocations overlapping a window (_rpAllocationsFor rows).
create function app.rp_person_window(p_person_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('allocation_id', a.id, 'work_package_id', a.work_package_id,
           'job_id', w.job_id, 'job_display', j.display_name, 'trade', w.trade, 'role', a.role,
           'start_at', a.start_at, 'end_at', a.end_at) order by a.start_at, a.id), '[]')
  from public.allocations a
  join public.work_packages w on w.id = a.work_package_id
  join public.jobs j on j.id = w.job_id
  where a.person_id = p_person_id and a.active and a.start_at is not null and a.end_at is not null
    and a.start_at <= p_to and a.end_at >= p_from
$$;

create function app.rp_person_leave(p_person_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('type', a.type, 'from_date', a.from_date,
           'to_date', coalesce(a.to_date, a.from_date)) order by a.from_date), '[]')
  from public.person_availability a
  where a.person_id = p_person_id and a.active and a.type <> 'Available'
    and a.from_date <= p_to and coalesce(a.to_date, a.from_date) >= p_from
$$;

-- _rpStatus.
create function app.read_rp_status(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  perform app.r2cal_read_keys(p_request, '{}');
  return jsonb_build_object(
    'tables', jsonb_build_object(
      'person_skills', (select jsonb_build_object('rows', count(*), 'active', count(*) filter (where active)) from public.person_skills),
      'person_availability', (select jsonb_build_object('rows', count(*), 'active', count(*) filter (where active)) from public.person_availability),
      'teams', (select jsonb_build_object('rows', count(*), 'active', count(*) filter (where active)) from public.teams),
      'team_members', (select jsonb_build_object('rows', count(*), 'active', count(*) filter (where active)) from public.team_members)),
    'installers', (select count(*) from public.people p where p.active and app.person_has_active_role(p.id, array['Installer'])),
    'installers_with_skills', (select count(*) from public.people p where p.active
                                 and app.person_has_active_role(p.id, array['Installer'])
                                 and exists (select 1 from public.person_skills s where s.person_id = p.id and s.active)),
    'installers_without_capacity', (select count(*) from public.people p where p.active
                                      and app.person_has_active_role(p.id, array['Installer'])
                                      and coalesce(p.capacity_per_day, 0) < 1),
    'teams', (select count(*) from public.teams t where t.active));
end
$$;

-- =============================================================================
-- 4. S11 R2 planning commands (s11/planner.js)
-- =============================================================================

-- jobs.next_action_at kept current (as the R1 planner commands do).
create function app.r2_refresh_next_action(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_after public.jobs;
  v_next timestamptz;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  v_next := coalesce(app.s11_next_action_at(v_job.id), v_job.next_action_at);
  if v_next is distinct from v_job.next_action_at then
    update public.jobs set next_action_at = v_next where id = v_job.id returning * into v_after;
    perform app.audit('Jobs', v_job.id::text, 'NextActionAt', to_jsonb(v_job), to_jsonb(v_after), p_reason);
  end if;
end
$$;

-- _s11PlanWorkPackage: first allocation + planned dates + calendar intent.
create function app.cmd_plan_work_package(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['person_id', 'role', 'start_at', 'end_at'],
                           array['person_id', 'start_at', 'end_at']);
  v_person uuid := app.ref(v_p, 'person_id');
  v_role text := coalesce(app.txt(v_p, 'role'), 'Lead');
  v_start date := app.s1x_local_date(v_p ->> 'start_at', 'S11');
  v_end date := app.s1x_local_date(v_p ->> 'end_at', 'S11');
  v_job public.jobs;
  v_wp public.work_packages;
  v_wp_after public.work_packages;
  v_alloc public.allocations;
  v_check jsonb;
  v_cal jsonb;
begin
  if v_end < v_start then
    perform app.fail('S11_DATE_INVALID: end before start');
  end if;
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  perform app.assert_normal_work(v_job.id);
  select * into v_wp from public.work_packages where id = app.ref(p_request, 'work_package_id') for update;
  if v_wp.id is null or v_wp.job_id <> v_job.id then
    perform app.fail('S11_REVIEW: work package linkage invalid');
  end if;
  if v_role not in ('Lead', 'Second', 'Support') then
    perform app.fail('S11_REVIEW: invalid role');
  end if;
  if v_wp.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  -- Ineligible installer: a review outcome, nothing written.
  v_check := app.r2_person_ready(v_person, v_start, v_end, v_wp.trade, null);
  if not (v_check ->> 'ready')::boolean then
    return jsonb_build_object('status', 'NeedsReview', 'reason', v_check ->> 'reason',
                              'detail', coalesce(v_check -> 'detail', v_check - 'ready' - 'reason'), 'external_calls', 0);
  end if;
  update public.work_packages set planned_start = v_start, planned_end = v_end, status = 'Scheduled',
                                  revision = revision + 1
  where id = v_wp.id returning * into v_wp_after;
  insert into public.allocations (work_package_id, person_id, role, start_at, end_at, active)
  values (v_wp.id, v_person, v_role, v_start, v_end, true) returning * into v_alloc;
  v_cal := app.s11_calendar_capture(v_job, v_wp_after, v_alloc, 'UPSERT');
  update public.allocations set calendar_link_id = (v_cal #>> '{link,id}')::uuid
  where id = v_alloc.id returning * into v_alloc;
  perform app.audit('WorkPackages', v_wp.id::text, 'Plan', to_jsonb(v_wp), to_jsonb(v_wp_after), null);
  perform app.audit('Allocations', v_alloc.id::text, 'Plan', null, to_jsonb(v_alloc), null);
  perform app.r2_refresh_next_action(v_job.id, 'Plan');
  return jsonb_build_object('status', 'Planned', 'created', true, 'allocation', to_jsonb(v_alloc),
                            'work_package', to_jsonb(v_wp_after), 'calendar', v_cal, 'external_calls', 0);
end
$$;

-- _s11MoveWorkPackage: one allocation and its package to new dates.
create function app.cmd_move_work_package(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['allocation_id', 'start_at', 'end_at', 'reason'],
                           array['allocation_id', 'start_at', 'end_at']);
  v_start date := app.s1x_local_date(v_p ->> 'start_at', 'S11');
  v_end date := app.s1x_local_date(v_p ->> 'end_at', 'S11');
  v_reason text := app.txt(v_p, 'reason');
  v_job public.jobs;
  v_wp public.work_packages;
  v_wp_after public.work_packages;
  v_alloc public.allocations;
  v_alloc_after public.allocations;
  v_check jsonb;
  v_cal jsonb;
begin
  if v_end < v_start then
    perform app.fail('S11_DATE_INVALID: end before start');
  end if;
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  -- Deviation: server-side actionability + stage restriction as the R1 S11 commands (REF-03 §11.7).
  perform app.s11_assert_reschedulable(v_job);
  select * into v_wp from public.work_packages where id = app.ref(p_request, 'work_package_id') for update;
  select * into v_alloc from public.allocations where id = app.ref(v_p, 'allocation_id') for update;
  if v_wp.id is null or v_wp.job_id <> v_job.id or v_alloc.id is null or v_alloc.work_package_id <> v_wp.id
     or not v_alloc.active then
    perform app.fail('S11_REVIEW: active allocation linkage invalid');
  end if;
  if v_wp.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_reason is null then
    perform app.fail('S11_REVIEW: move reason required');
  end if;
  -- Reference passes no trade on a move (_s11Capacity only).
  v_check := app.r2_person_ready(v_alloc.person_id, v_start, v_end, null, v_alloc.id);
  if not (v_check ->> 'ready')::boolean then
    return jsonb_build_object('status', 'NeedsReview', 'reason', v_check ->> 'reason',
                              'detail', coalesce(v_check -> 'detail', v_check - 'ready' - 'reason'), 'external_calls', 0);
  end if;
  update public.work_packages set planned_start = v_start, planned_end = v_end, revision = revision + 1
  where id = v_wp.id returning * into v_wp_after;
  update public.allocations set start_at = v_start, end_at = v_end
  where id = v_alloc.id returning * into v_alloc_after;
  v_cal := app.s11_calendar_capture(v_job, v_wp_after, v_alloc_after, 'MOVE');
  if v_alloc_after.calendar_link_id is distinct from (v_cal #>> '{link,id}')::uuid then
    update public.allocations set calendar_link_id = (v_cal #>> '{link,id}')::uuid
    where id = v_alloc.id returning * into v_alloc_after;
  end if;
  perform app.audit('WorkPackages', v_wp.id::text, 'Move', to_jsonb(v_wp), to_jsonb(v_wp_after), v_reason);
  perform app.audit('Allocations', v_alloc.id::text, 'Move', to_jsonb(v_alloc), to_jsonb(v_alloc_after), v_reason);
  perform app.r2_refresh_next_action(v_job.id, v_reason);
  return jsonb_build_object('status', 'Moved', 'created', true, 'allocation', to_jsonb(v_alloc_after),
                            'work_package', to_jsonb(v_wp_after), 'calendar', v_cal, 'external_calls', 0);
end
$$;

-- _s11ChangeInstaller (R2: skill-aware; Replace keeps the old role).
create function app.cmd_change_installer_r2(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['mode', 'person_id', 'reason', 'role', 'old_allocation_id'],
                           array['person_id']);
  v_mode text := app.txt(v_p, 'mode');
  v_reason text := app.txt(v_p, 'reason');
  v_role text := app.txt(v_p, 'role');
  v_old_id uuid := coalesce(app.ref(v_p, 'old_allocation_id'), app.ref(p_request, 'old_allocation_id'));
  v_person uuid := app.ref(v_p, 'person_id');
  v_job public.jobs;
  v_wp public.work_packages;
  v_wp_after public.work_packages;
  v_old public.allocations;
  v_old_after public.allocations;
  v_new public.allocations;
  v_check jsonb;
  v_cancel jsonb;
  v_cal jsonb;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  -- Deviation: server-side actionability + stage restriction as the R1 S11 commands (REF-03 §11.7).
  perform app.s11_assert_reschedulable(v_job);
  select * into v_wp from public.work_packages where id = app.ref(p_request, 'work_package_id') for update;
  if v_old_id is not null then
    select * into v_old from public.allocations where id = v_old_id for update;
  end if;
  if v_wp.id is null or v_wp.job_id <> v_job.id or v_old.id is null or v_old.work_package_id <> v_wp.id then
    perform app.fail('S11_REVIEW: allocation linkage invalid');
  end if;
  if not v_old.active then
    perform app.fail('S11_REVIEW: active allocation linkage invalid');
  end if;
  if v_wp.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_mode is null or v_mode not in ('Replace', 'Add') or v_reason is null then
    perform app.fail('S11_REVIEW: mode and reason required');
  end if;
  if v_role is not null and v_role not in ('Lead', 'Second', 'Support') then
    perform app.fail('S11_REVIEW: invalid role');
  end if;
  if v_old.start_at is null or v_old.end_at is null then
    perform app.fail('S11_DATE_INVALID: date value is required');
  end if;
  v_check := app.r2_person_ready(v_person, v_old.start_at, v_old.end_at, v_wp.trade, null);
  if not (v_check ->> 'ready')::boolean then
    return jsonb_build_object('status', 'NeedsReview', 'reason', v_check ->> 'reason',
                              'detail', coalesce(v_check -> 'detail', v_check - 'ready' - 'reason'), 'external_calls', 0);
  end if;

  update public.work_packages set revision = revision + 1 where id = v_wp.id returning * into v_wp_after;
  perform app.audit('WorkPackages', v_wp.id::text, 'ChangeInstaller', to_jsonb(v_wp), to_jsonb(v_wp_after), v_reason);
  if v_mode = 'Replace' then
    update public.allocations set active = false, cancellation_reason = v_reason
    where id = v_old.id returning * into v_old_after;
    v_cancel := app.s11_calendar_cancel(
      coalesce(v_old.calendar_link_id,
               (select c.id from public.calendar_links c where c.allocation_id = v_old.id and c.status <> 'Cancelled'
                order by c.created_at desc limit 1)),
      v_wp_after.revision);
    perform app.audit('Allocations', v_old.id::text, 'ReplaceInstaller', to_jsonb(v_old), to_jsonb(v_old_after), v_reason);
  end if;
  insert into public.allocations (work_package_id, person_id, role, start_at, end_at, active, replaced_allocation_id)
  values (v_wp.id, v_person,
          case when v_mode = 'Add' then coalesce(v_role, 'Second') else v_old.role end,
          v_old.start_at, v_old.end_at, true, case when v_mode = 'Replace' then v_old.id end)
  returning * into v_new;
  v_cal := app.s11_calendar_capture(v_job, v_wp_after, v_new, 'NEW_INSTALLER');
  update public.allocations set calendar_link_id = (v_cal #>> '{link,id}')::uuid
  where id = v_new.id returning * into v_new;
  perform app.audit('Allocations', v_new.id::text, case when v_mode = 'Replace' then 'ReplaceInstaller' else 'AddInstaller' end,
                    to_jsonb(v_old), to_jsonb(v_new), v_reason);
  return jsonb_build_object('status', case when v_mode = 'Replace' then 'Replaced' else 'Added' end, 'created', true,
    'allocation', to_jsonb(v_new),
    'old_allocation', case when v_old_after.id is not null then to_jsonb(v_old_after) else to_jsonb(v_old) end,
    'work_package', to_jsonb(v_wp_after), 'calendar', v_cal, 'calendar_cancel', v_cancel, 'external_calls', 0);
end
$$;

-- =============================================================================
-- Registry
-- =============================================================================

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('PLAN_WORK_PACKAGE', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], true,
   '[{"function_id":"FN-01","mode":"Automated"},{"function_id":"FN-02","mode":"Automated"}]',
   'calendar_resourcing', 's11/planner.js _s11PlanWorkPackage'),
  ('MOVE_WORK_PACKAGE', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], true,
   '[{"function_id":"FN-01","mode":"Automated"},{"function_id":"FN-02","mode":"Automated"}]',
   'calendar_resourcing', 's11/planner.js _s11MoveWorkPackage'),
  ('CHANGE_INSTALLER_R2', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], true,
   '[{"function_id":"FN-01","mode":"Automated"},{"function_id":"FN-02","mode":"Automated"}]',
   'calendar_resourcing', 's11/planner.js _s11ChangeInstaller (skill-aware R2 variant of CHANGE_INSTALLER)'),
  ('CALENDAR_REVIEW_RESOLVE', array['Admin', 'Manager', 'Office'], false, '[]',
   'calendar_resourcing', 'calendar/service.js _calResolveReview'),
  ('RP_SET_SKILL', array['Admin', 'Manager', 'Office'], false, '[]',
   'calendar_resourcing', 'resource/planning.js _rpSetSkill'),
  ('RP_SET_AVAILABILITY', array['Admin', 'Manager', 'Office'], false, '[]',
   'calendar_resourcing', 'resource/planning.js _rpSetAvailability'),
  ('RP_CANCEL_AVAILABILITY', array['Admin', 'Manager', 'Office'], false, '[]',
   'calendar_resourcing', 'resource/planning.js _rpCancelAvailability'),
  ('RP_UPSERT_TEAM', array['Admin', 'Manager', 'Office'], false, '[]',
   'calendar_resourcing', 'resource/planning.js _rpUpsertTeam'),
  ('RP_SET_TEAM_MEMBER', array['Admin', 'Manager', 'Office'], false, '[]',
   'calendar_resourcing', 'resource/planning.js _rpSetTeamMember');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('CALENDAR_STATUS', array['Admin', 'Manager', 'Office'], '[]', 'calendar_resourcing', 'calendar/service.js _calStatus'),
  ('CALENDAR_DISPATCH_PREVIEW', array['Admin', 'Manager', 'Office'], '[]', 'calendar_resourcing',
   'calendar/service.js _calDispatch dry_run; {limit?}'),
  ('RP_ASSESS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'calendar_resourcing',
   'resource/planning.js _rpAssess; {trade, start_at, end_at, person_ids?, team_id?, exclude_allocation_id?}'),
  ('RP_CHANGE_INSTALLER_OPTIONS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]',
   'calendar_resourcing', 'resource/planning.js _rpChangeInstallerOptions; {work_package_id, old_allocation_id?, start_at?, end_at?}'),
  ('RP_MOVE_JOB_PREVIEW', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]',
   'calendar_resourcing', 'resource/planning.js _rpMoveJobPreview; {job_id, activities, planned_start?, planned_end?, scaffold_erect?, scaffold_strip?}'),
  ('RP_TEAMS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'calendar_resourcing',
   'resource/planning.js _rpTeams'),
  ('RP_TEAM_PLANNER', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'calendar_resourcing',
   'resource/planning.js _rpTeamPlanner; {start?, weeks?}'),
  ('RP_STATUS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'calendar_resourcing',
   'resource/planning.js _rpStatus');

-- =============================================================================
-- Worker entry points (service role only; PostgREST RPC)
-- =============================================================================

create function public.outbox_claim(p_action_types text[], p_limit int default 20)
returns jsonb language sql security definer set search_path = ''
as $$ select app.outbox_claim(p_action_types, p_limit) $$;

create function public.outbox_record_success(p_outbox_id uuid, p_external_id text, p_summary text)
returns jsonb language sql security definer set search_path = ''
as $$ select app.outbox_record_success(p_outbox_id, p_external_id, p_summary) $$;

create function public.outbox_record_failure(p_outbox_id uuid, p_transient boolean, p_error text,
                                             p_max_attempts int default null, p_backoff_minutes int[] default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app.outbox_record_failure(p_outbox_id, p_transient, p_error, p_max_attempts, p_backoff_minutes) $$;

create function public.outbox_record_uncertain(p_outbox_id uuid, p_summary text)
returns jsonb language sql security definer set search_path = ''
as $$ select app.outbox_record_uncertain(p_outbox_id, p_summary) $$;

create function public.outbox_release_stalled(p_minutes int default null, p_action_types text[] default null)
returns jsonb language sql security definer set search_path = ''
as $$ select app.outbox_release_stalled(p_minutes, p_action_types) $$;

create function public.outbound_guard(p_kind text, p_to text[], p_cc text[] default '{}', p_bcc text[] default '{}',
                                      p_calendar_id text default null)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.outbound_guard(p_kind, p_to, p_cc, p_bcc, p_calendar_id) $$;

create function public.calendar_drift_candidates(p_limit int default 50)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.calendar_drift_candidates(p_limit) $$;

create function public.calendar_record_drift(p_link_id uuid, p_observed jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select app.calendar_record_drift(p_link_id, p_observed) $$;

revoke all on function public.outbox_claim(text[], int), public.outbox_record_success(uuid, text, text),
  public.outbox_record_failure(uuid, boolean, text, int, int[]), public.outbox_record_uncertain(uuid, text),
  public.outbox_release_stalled(int, text[]), public.outbound_guard(text, text[], text[], text[], text),
  public.calendar_drift_candidates(int), public.calendar_record_drift(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.outbox_claim(text[], int), public.outbox_record_success(uuid, text, text),
  public.outbox_record_failure(uuid, boolean, text, int, int[]), public.outbox_record_uncertain(uuid, text),
  public.outbox_release_stalled(int, text[]), public.outbound_guard(text, text[], text[], text[], text),
  public.calendar_drift_candidates(int), public.calendar_record_drift(uuid, jsonb)
  to service_role;

-- Stalled Processing rows surface even when no worker is claiming
-- (pg_cron where available; every 5 minutes).
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('ss-outbox-stalled', '*/5 * * * *', 'select app.outbox_release_stalled()');
end
$$;
