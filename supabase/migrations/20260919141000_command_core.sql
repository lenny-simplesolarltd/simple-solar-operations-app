-- =============================================================================
-- Backend port: command processor core.
--
-- Builds on the identity foundation and Job Sold migrations (restored by
-- 20260919120000), which are canonical: people / roles / person_roles,
-- customers, jobs, presales, task_templates, task_assignment_rules, tasks,
-- commands, audit_events and their app.* helpers are used, never redefined.
--
-- Ports the cross-cutting guarantees of the reference processor
-- (r1-appsheet/adapter.js, s04/processor.js, processor/*.js):
--   * actor = auth.uid() -> exactly one active person -> active person_roles
--     (never taken from the request) (adapter.js:16-25)
--   * role classes admin / director / office / officeManager (adapter.js:26-29)
--   * release modes: exactly one row per function, exact expected mode,
--     fail closed (adapter.js:45)
--   * job access: admin, or owner/backup of a task on the job, or responsible
--     person / office owner of an issue on the job, or salesperson (:37-44)
--   * idempotency by command_id in the Job Sold commands ledger: same command
--     + same content + same actor -> the stored result, no writes; different
--     content -> R1A_COMMAND_CONFLICT; replays still re-authorized.
--   * one transaction per command: any refusal writes nothing, so the
--     reference Prepared/Applying/RecoveryRequired journal states and
--     recovery classification are not needed.
--   * audit: one semantic event per committed change (before/after, initiating
--     person distinct from executing service, command_id); immutable task
--     history in task_events. The identity/Job Sold row-level audit triggers
--     keep running on their tables as well.
--   * Europe/London business dates; staffed days from settings + holidays.
--
-- Deliberate deviations from the reference, each fixing a flagged defect:
--   * Due "09:00"/"17:00" are Europe/London local times (reference wrote
--     literal UTC 'T09:00Z', an hour out in summer - REF-03 §11.9).
--   * Task owners come from task_assignment_rules (Job Sold design) instead of
--     "first Office row" / name matching (REF-03 §11.14). A missing or
--     ineligible owner fails visibly (TASK_ASSIGNMENT_CONFIG).
--   * No pilot_job / release_scope on jobs (Job Sold design); release modes
--     accept scope Pilot or All and still gate every function.
-- =============================================================================

-- Helpers are internal: nothing in app is callable by clients unless granted
-- explicitly (RLS helpers). Commands reach them through the SECURITY DEFINER
-- entry point public.execute_command.
-- (Per-schema default privileges cannot remove the global PUBLIC grant, so
-- this applies to every function the migration role creates from here on;
-- public entry points grant execute explicitly.)
alter default privileges revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Errors
-- -----------------------------------------------------------------------------

-- Raises a business refusal. The message is the machine code the client maps
-- to staff text; optional structured detail travels in DETAIL as JSON.
create function app.fail(p_code text, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_detail is null then
    raise exception '%', p_code using errcode = 'P0001';
  end if;
  raise exception '%', p_code using errcode = 'P0001', detail = p_detail::text;
end
$$;

-- -----------------------------------------------------------------------------
-- Settings (versioned; latest effective version wins)
-- -----------------------------------------------------------------------------

create function app.setting(p_key text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select s.typed_value
  from public.settings s
  where s.key = p_key
    and s.scope = 'Global'
    and s.effective_from <= (now() at time zone 'Europe/London')::date
  order by s.version desc
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- Business calendar (Europe/London)
-- -----------------------------------------------------------------------------

create function app.london_date(p_at timestamptz default now())
returns date
language sql stable
set search_path = ''
as $$ select (p_at at time zone 'Europe/London')::date $$;

-- A London wall-clock time on a date, as an instant.
create function app.london_at(p_date date, p_time time)
returns timestamptz
language sql stable
set search_path = ''
as $$ select (p_date + p_time) at time zone 'Europe/London' $$;

-- Staffed = weekday in office.staffed_weekdays (ISO 1=Mon..7=Sun, default
-- Mon-Fri) and not an office-closed holiday.
create function app.is_staffed_day(p_date date)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_days jsonb := coalesce(app.setting('office.staffed_weekdays'), '[1,2,3,4,5]'::jsonb);
begin
  if jsonb_typeof(v_days) = 'string' then
    v_days := (v_days #>> '{}')::jsonb;
  end if;
  return v_days @> to_jsonb(extract(isodow from p_date)::int)
     and not exists (select 1 from public.holidays h where h.local_date = p_date and h.office_closed);
end
$$;

-- The first staffed day strictly after the given instant's London date.
create function app.next_staffed_date(p_from timestamptz default now())
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_day date := app.london_date(p_from) + 1;
begin
  while not app.is_staffed_day(v_day) loop
    v_day := v_day + 1;
  end loop;
  return v_day;
end
$$;

-- n staffed days after the instant's London date.
create function app.add_staffed_days(p_from timestamptz, p_days int)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_day date := app.london_date(p_from);
  v_left int := p_days;
begin
  while v_left > 0 loop
    v_day := v_day + 1;
    if app.is_staffed_day(v_day) then
      v_left := v_left - 1;
    end if;
  end loop;
  return v_day;
end
$$;

-- The Friday on or before the date, rolled back past non-staffed days
-- (reference s06/gates.js fridayBefore).
create function app.friday_before(p_date date)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_day date := p_date;
begin
  while extract(isodow from v_day) <> 5 loop
    v_day := v_day - 1;
  end loop;
  while not app.is_staffed_day(v_day) loop
    v_day := v_day - 1;
  end loop;
  return v_day;
end
$$;

-- -----------------------------------------------------------------------------
-- Payload helpers
-- -----------------------------------------------------------------------------

-- Strict allow-list: unknown key -> R1A_INVALID_FIELDS; missing/blank
-- required key k -> R1A_REQUIRED_<K> (reference services.js _r1sPayload).
create function app.payload(p_request jsonb, p_allowed text[], p_required text[] default '{}')
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_request -> 'payload', '{}'::jsonb);
  v_key text;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(v_payload) loop
    if not v_key = any (p_allowed) then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;
  foreach v_key in array p_required loop
    if v_payload -> v_key is null or jsonb_typeof(v_payload -> v_key) = 'null'
       or (jsonb_typeof(v_payload -> v_key) = 'string' and v_payload ->> v_key = '') then
      perform app.fail('R1A_REQUIRED_' || upper(v_key));
    end if;
  end loop;
  return v_payload;
end
$$;

-- Trimmed text value, or null when absent/blank.
create function app.txt(p_payload jsonb, p_key text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(btrim(case when jsonb_typeof(p_payload -> p_key) = 'null' then null else p_payload ->> p_key end), '')
$$;

-- Explicit yes / explicit no (JSON booleans, or the reference's strings).
create function app.yes_flag(p_value jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then false
    when jsonb_typeof(p_value) = 'boolean' then p_value::text::boolean
    else lower(btrim(p_value #>> '{}')) in ('yes', 'true', '1', 'y')
  end
$$;

create function app.no_flag(p_value jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then false
    when jsonb_typeof(p_value) = 'boolean' then not p_value::text::boolean
    else lower(btrim(p_value #>> '{}')) in ('no', 'false', '0', 'n')
  end
$$;

-- GBP text/number -> integer pence: strip £ , and spaces; at most 2 dp.
create function app.pounds_to_pence(p_value jsonb, p_code text default 'R1A_INVALID_GROSS_AMOUNT')
returns bigint
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  v_text := regexp_replace(p_value #>> '{}', '[£,[:space:]]', '', 'g');
  if v_text = '' then
    return null;
  end if;
  if v_text !~ '^[0-9]+(\.[0-9]{1,2})?$' then
    perform app.fail(p_code);
  end if;
  return round(v_text::numeric * 100)::bigint;
end
$$;

-- expected_version: integer >= 1 (a digit string is accepted, as the
-- reference did for form-supplied values).
create function app.expected_version(p_request jsonb)
returns int
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb := p_request -> 'expected_version';
begin
  if v is null or jsonb_typeof(v) = 'null' then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[0-9]+$' and (v #>> '{}')::bigint between 1 and 2147483647 then
    return (v #>> '{}')::int;
  end if;
  if jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^[0-9]{1,9}$' and btrim(v #>> '{}')::int >= 1 then
    return btrim(v #>> '{}')::int;
  end if;
  perform app.fail('R1A_STALE_VERSION');
end
$$;

-- A uuid reference from the request envelope, or null.
create function app.ref(p_request jsonb, p_key text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_request ->> p_key), '');
begin
  if v is null then
    return null;
  end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('R1A_INVALID_' || upper(p_key));
  end if;
  return v::uuid;
end
$$;

-- -----------------------------------------------------------------------------
-- Identity
-- -----------------------------------------------------------------------------

-- Identity is the identity foundation's: auth.uid() -> people.auth_user_id
-- (linked by verified email), roles from active person_roles whose role is
-- active. app.current_person_id() / app.current_roles() are that migration's.

-- The authenticated email (Supabase JWT), normalised. Display only.
create function app.auth_email()
returns text
language sql stable
set search_path = ''
as $$ select nullif(lower(btrim(auth.jwt() ->> 'email')), '') $$;

-- Command actor {id, email, roles}. Fails closed exactly as the reference
-- (adapter.js:16-25): unknown -> R1A_UNKNOWN_OR_DUPLICATE_ACTOR, inactive ->
-- R1A_INACTIVE_ACTOR, no active role -> R1A_NO_ACTIVE_ROLE.
create function app.resolve_actor()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_person public.people;
  v_roles text[];
begin
  if v_uid is null then
    perform app.fail('R1A_AUTHENTICATED_EMAIL_REQUIRED');
  end if;
  select * into v_person from public.people p where p.auth_user_id = v_uid;
  if not found then
    perform app.fail('R1A_UNKNOWN_OR_DUPLICATE_ACTOR');
  end if;
  if not v_person.active then
    perform app.fail('R1A_INACTIVE_ACTOR');
  end if;
  select coalesce(array_agg(distinct pr.role_code order by pr.role_code), '{}') into v_roles
  from public.person_roles pr join public.roles r on r.code = pr.role_code and r.active
  where pr.person_id = v_person.id and pr.active;
  if cardinality(v_roles) = 0 then
    perform app.fail('R1A_NO_ACTIVE_ROLE');
  end if;
  return jsonb_build_object('id', v_person.id, 'email', v_person.email, 'roles', to_jsonb(v_roles));
end
$$;

create function app.actor_id(p_actor jsonb)
returns uuid
language sql immutable
set search_path = ''
as $$ select (p_actor ->> 'id')::uuid $$;

create function app.has_role(p_actor jsonb, variadic p_roles text[])
returns boolean
language sql immutable
set search_path = ''
as $$ select coalesce((p_actor -> 'roles') ?| p_roles, false) $$;

-- Role classes, exactly as the reference (adapter.js:26-29).
create function app.is_admin(p_actor jsonb) returns boolean
language sql immutable set search_path = ''
as $$ select app.has_role(p_actor, 'Admin', 'Manager') $$;

create function app.is_director(p_actor jsonb) returns boolean
language sql immutable set search_path = ''
as $$ select app.has_role(p_actor, 'Admin', 'Manager', 'Director') $$;

create function app.is_office(p_actor jsonb) returns boolean
language sql immutable set search_path = ''
as $$ select app.has_role(p_actor, 'Admin', 'Manager', 'Director', 'Office', 'VariationApprover') $$;

create function app.is_office_manager(p_actor jsonb) returns boolean
language sql immutable set search_path = ''
as $$ select app.has_role(p_actor, 'Admin', 'Manager', 'Office') $$;

-- The same classes for the signed-in user (used by RLS policies).
create function app.current_actor()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when app.current_person_id() is null then null
    else jsonb_build_object('id', app.current_person_id(), 'roles', to_jsonb(app.current_roles())) end
$$;

-- -----------------------------------------------------------------------------
-- Release modes (fail closed)
-- -----------------------------------------------------------------------------

create function app.mode_available(p_function_id text, p_wanted text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select count(*) = 1 and bool_and(m.mode = p_wanted and m.target_release = 'R1'
                                   and m.authorised_job_scope in ('Pilot', 'All'))
  from public.release_modes m
  where m.function_id = p_function_id
$$;

create function app.require_mode(p_function_id text, p_wanted text)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.release_modes m where m.function_id = p_function_id) <> 1 then
    perform app.fail('R1A_MODE_MISSING', jsonb_build_object('function_id', p_function_id));
  end if;
  if not app.mode_available(p_function_id, p_wanted) then
    perform app.fail('R1A_MODE_DENIED', jsonb_build_object('function_id', p_function_id, 'required_mode', p_wanted));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Job access ("assignment")
-- -----------------------------------------------------------------------------

create function app.is_assigned(p_actor jsonb, p_job_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_admin(p_actor)
    or exists (select 1 from public.tasks t where t.job_id = p_job_id
               and app.actor_id(p_actor) in (t.owner_id, t.backup_id))
    or exists (select 1 from public.issues i where i.job_id = p_job_id
               and app.actor_id(p_actor) in (i.responsible_person_id, i.office_owner_id))
    or exists (select 1 from public.jobs j where j.id = p_job_id and j.salesperson_id = app.actor_id(p_actor))
$$;

-- Deviation: the canonical jobs table deliberately has no pilot_job /
-- release_scope (Job Sold design §2 "never ported"), so every job is in
-- scope; release modes still gate each function. Kept as a single hook.
create function app.job_in_scope(p_job public.jobs)
returns boolean
language sql stable
set search_path = ''
as $$ select p_job.id is not null $$;

-- Job exists, is in scope, and the actor is assigned. Locks the job row.
create function app.authorize_job(p_actor jsonb, p_job_id uuid)
returns public.jobs
language plpgsql security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  if p_job_id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.job_in_scope(v_job) then
    perform app.fail('R1A_OUTSIDE_PILOT');
  end if;
  if not app.is_assigned(p_actor, p_job_id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  return v_job;
end
$$;

-- Archived / cancelling / cancelled jobs accept no normal commands.
create function app.job_actionable(p_job public.jobs)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_job.archived_at is null
     and p_job.workflow_stage not in ('CancellationInProgress', 'Cancelled')
$$;

-- S15: normal work is suppressed during cancellation and while a reinstated
-- job's reopen review is open (reference "S15_REVIEW: normal work suppressed").
create function app.assert_normal_work(p_job_id uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.jobs j where j.id = p_job_id
             and (j.cancellation_at is not null or j.workflow_stage in ('CancellationInProgress', 'Cancelled')))
     or exists (select 1 from public.tasks t where t.job_id = p_job_id and t.template_code = 'S15-REOPEN-REVIEW'
                and t.status not in ('Complete', 'NotRequired')) then
    perform app.fail('S15_REVIEW: normal work suppressed');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Command context, row stamping, audit, task history
-- -----------------------------------------------------------------------------

create function app.context_actor_id()
returns uuid
language sql stable
set search_path = ''
as $$ select coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, app.current_person_id()) $$;

create function app.context_command_id()
returns text
language sql stable
set search_path = ''
as $$ select nullif(current_setting('app.command_id', true), '') $$;

create function app.context_service()
returns text
language sql stable
set search_path = ''
as $$ select coalesce(nullif(current_setting('app.executing_service', true), ''), 'db') $$;

-- Stamps created/updated columns and bumps version by exactly one per
-- update. A writer that states a version different from the stored one is
-- refused as stale (optimistic concurrency for direct table edits).
create function app.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version    := 1;
    new.created_at := now();
    new.updated_at := new.created_at;
    new.created_by := coalesce(app.context_actor_id(), new.created_by);
    new.updated_by := new.created_by;
    return new;
  end if;
  if new.id is distinct from old.id then
    raise exception 'IMMUTABLE_ID' using errcode = 'P0001';
  end if;
  if new.version is distinct from old.version then
    raise exception 'R1A_STALE_VERSION' using errcode = 'P0001';
  end if;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.version    := old.version + 1;
  new.updated_at := now();
  new.updated_by := coalesce(app.context_actor_id(), new.updated_by);
  return new;
end
$$;

-- Attach stamping to every table that carries the full stamping column set and
-- is not already stamped by the identity/Job Sold app.touch_row trigger.
do $$
declare
  v_table text;
begin
  for v_table in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('created_at', 'created_by', 'updated_at', 'updated_by', 'version')
      and not exists (select 1 from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
                      join pg_namespace n on n.oid = p.pronamespace
                      where tg.tgrelid = format('public.%I', c.table_name)::regclass
                        and n.nspname = 'app' and p.proname = 'touch_row')
    group by c.table_name
    having count(*) = 5
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.stamp_row()',
                   v_table || '_stamp', v_table);
  end loop;
end
$$;

create function app.audit(p_entity_type text, p_entity_id text, p_action text,
                          p_before jsonb, p_after jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (entity_type, entity_id, action, before_json, after_json,
                                   initiating_person_id, executing_service, command_id, reason)
  values (p_entity_type, p_entity_id, p_action, p_before, p_after,
          app.context_actor_id(), app.context_service(), app.context_command_id(), p_reason)
$$;

create function app.task_event(p_before public.tasks, p_after public.tasks, p_action text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_events (task_id, action, old_status, new_status, old_owner, new_owner,
                                  old_due, new_due, reason, actor, occurred_at)
  values (coalesce(p_after.id, p_before.id), p_action, p_before.status, p_after.status,
          p_before.owner_id, p_after.owner_id, p_before.due_at, p_after.due_at, p_reason,
          app.context_actor_id(), now())
$$;

-- -----------------------------------------------------------------------------
-- Task ownership: the Job Sold design's task_assignment_rules (one active rule
-- per template, owner must hold an eligible role, a bad backup is nobody),
-- resolved by app.resolve_task_assignment. Replaces the reference's "first
-- active Office PersonRole", literal PERSON-tanya / PERSON-ben and
-- display-name matching (REF-03 §11.14).
-- -----------------------------------------------------------------------------

create function app.person_has_active_role(p_person_id uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.people p where p.id = p_person_id and p.active)
     and exists (select 1 from public.person_roles pr join public.roles r on r.code = pr.role_code and r.active
                 where pr.person_id = p_person_id and pr.active and pr.role_code = any (p_roles))
$$;

-- Owner of the template's active assignment rule (fails TASK_ASSIGNMENT_CONFIG).
create function app.rule_owner(p_template_code text)
returns uuid
language sql stable security definer
set search_path = ''
as $$ select (app.resolve_task_assignment(p_template_code)).owner_id $$;

-- Its eligible backup, or null (never somebody else).
create function app.rule_backup(p_template_code text)
returns uuid
language sql stable security definer
set search_path = ''
as $$ select (app.resolve_task_assignment(p_template_code)).backup_id $$;

-- -----------------------------------------------------------------------------
-- Task creation (one task per instance_key, ever)
-- -----------------------------------------------------------------------------

-- Creates the task unless its instance_key already exists (in any status).
-- Returns the new id, or null when skipped. Title/group/version come from the
-- active template (every code has one: tasks.template_code is a foreign key);
-- a caller may override the title/group snapshot. With no explicit owner the
-- template's assignment rule decides owner and backup.
create function app.create_task_instance(
  p_job_id uuid,
  p_template_code text,
  p_instance_key text,
  p_owner_id uuid default null,
  p_backup_id uuid default null,
  p_due_at timestamptz default null,
  p_priority int default null,
  p_title text default null,
  p_group text default null,
  p_related_entity_type text default 'jobs',
  p_related_entity_id uuid default null,
  p_status text default 'Open',
  p_blocking_reason text default null,
  p_revision_required boolean default false,
  p_rule_version text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.task_templates;
  v_rule record;
  v_owner uuid := p_owner_id;
  v_backup uuid := p_backup_id;
  v_rule_id uuid;
  v_task public.tasks;
begin
  if exists (select 1 from public.tasks t where t.instance_key = p_instance_key) then
    return null;
  end if;
  select * into v_template from public.task_templates where code = p_template_code and active;
  if not found then
    perform app.fail('TASK_TEMPLATE_CONFIG', jsonb_build_object('template_code', p_template_code));
  end if;
  if v_owner is null then
    v_rule := app.resolve_task_assignment(p_template_code);
    v_owner := v_rule.owner_id;
    v_backup := coalesce(v_backup, v_rule.backup_id);
    v_rule_id := v_rule.rule_id;
  end if;
  insert into public.tasks (job_id, template_code, instance_key, task_group, title, owner_id, backup_id,
                            related_entity_type, related_entity_id, due_at, original_due_at, priority, status,
                            blocking_reason, revision_required, created_rule_version, assignment_rule_id)
  values (p_job_id, p_template_code, p_instance_key,
          coalesce(p_group, v_template.task_group), coalesce(p_title, v_template.title),
          v_owner, nullif(v_backup, v_owner),
          p_related_entity_type,
          coalesce(p_related_entity_id, case when p_related_entity_type = 'jobs' then p_job_id end),
          p_due_at, p_due_at, coalesce(p_priority, v_template.default_priority), p_status, p_blocking_reason,
          p_revision_required, coalesce(p_rule_version, v_template.template_version), v_rule_id)
  on conflict (instance_key) do nothing
  returning * into v_task;
  if v_task.id is null then
    return null;
  end if;
  -- Every task creation is recorded (the reference generators skipped this).
  perform app.task_event(null::public.tasks, v_task, 'Created', null);
  return v_task.id;
end
$$;

-- -----------------------------------------------------------------------------
-- Evidence (files live in Supabase Storage bucket "evidence")
-- -----------------------------------------------------------------------------

-- One evidence row per (job, stored file). The file must already be stored:
-- a command that references a file verifies it before writing anything.
-- Never invents ids; never shares evidence across jobs.
create function app.ensure_evidence(p_job_id uuid, p_category text, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(p_storage_path), '');
  v_id uuid;
  v_exists boolean;
begin
  if v_path is null then
    perform app.fail('R1A_UPLOAD_INVALID');
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.bucket_id = $1 and o.name = $2)'
      into v_exists using 'evidence', v_path;
    if not v_exists then
      perform app.fail('R1A_UPLOAD_MISSING');
    end if;
  end if;
  select e.id into v_id from public.evidence e where e.job_id = p_job_id and e.storage_path = v_path;
  if found then
    return v_id;
  end if;
  if exists (select 1 from public.evidence e where e.storage_path = v_path) then
    perform app.fail('R1A_CROSS_JOB_EVIDENCE');
  end if;
  insert into public.evidence (job_id, category, storage_path, filename, upload_status,
                               captured_at, captured_by, received_at, customer_shareable)
  values (p_job_id, p_category, v_path, regexp_replace(v_path, '^.*/', ''), 'Uploaded',
          now(), app.context_actor_id(), now(), false)
  returning id into v_id;
  return v_id;
end
$$;

-- An existing evidence id that must belong to the job.
create function app.job_evidence(p_job_id uuid, p_evidence_id text, p_missing_code text)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_row public.evidence;
begin
  if nullif(btrim(p_evidence_id), '') is null then
    perform app.fail('R1A_REQUIRED_EVIDENCE_ID');
  end if;
  if btrim(p_evidence_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_row from public.evidence where id = btrim(p_evidence_id)::uuid;
  end if;
  if v_row.id is null then
    select * into v_row from public.evidence where job_id = p_job_id and storage_path = btrim(p_evidence_id);
  end if;
  if v_row.id is null then
    perform app.fail(p_missing_code);
  end if;
  if v_row.job_id <> p_job_id then
    perform app.fail('R1A_CROSS_JOB_EVIDENCE');
  end if;
  return v_row.id;
end
$$;

-- -----------------------------------------------------------------------------
-- Command registry and dispatcher
-- -----------------------------------------------------------------------------

-- The adapter's authorization matrix (adapter.js:168-219), per command type.
-- Handlers are app.cmd_<command_type in lower case>(request, actor).
create function app.authorize_command(p_type text, p_request jsonb, p_actor jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_task_id uuid;
  v_job_id uuid := app.ref(p_request, 'job_id');
begin
  if not app.is_office(p_actor) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;

  if p_type in ('TASK_COMPLETE', 'TASK_REOPEN', 'TASK_EVIDENCE_ATTACH') then
    v_task_id := app.ref(p_request, 'task_id');
    select * into v_task from public.tasks where id = v_task_id for update;
    if not found then
      perform app.fail('R1A_TASK_NOT_FOUND');
    end if;
    if v_task.job_id is not null then
      perform app.authorize_job(p_actor, v_task.job_id);
    elsif v_task.owner_id <> app.actor_id(p_actor) and not app.is_admin(p_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    if app.actor_id(p_actor) not in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))
       and not app.is_admin(p_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    perform app.require_mode('FN-01', 'Automated');

  elsif p_type = 'OUTBOX_RESOLVE' then
    -- Human resolution of an uncertain external outcome (resilience/review.js,
    -- FN-14). Not job-scoped: office staff who own the review queue.
    if not app.is_office_manager(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.require_mode('FN-14', 'Automated');

  elsif p_type = 'DEPOSIT_CONFIRM' then
    if not app.is_director(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-15', 'Manual');

  elsif p_type = 'OPERATIONAL_COMPLETE' then
    if not app.is_office_manager(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-19', 'Manual');
    perform app.require_mode('FN-11', 'Manual');

  elsif p_type = 'CONFIRM_BOOKING' then
    if not app.is_office_manager(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-01', 'Automated');

  else
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-01', 'Automated');
    if p_type = 'CALL_RECORD' then
      v_task_id := app.ref(p_request, 'task_id');
      select * into v_task from public.tasks where id = v_task_id;
      if not found or v_task.job_id is distinct from v_job_id then
        perform app.fail('R1A_TASK_JOB_MISMATCH');
      end if;
      if app.actor_id(p_actor) not in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))
         and not app.is_admin(p_actor) then
        perform app.fail('R1A_TASK_ACCESS_DENIED');
      end if;
    elsif p_type = 'ISSUE_UPDATE' then
      if not exists (select 1 from public.issues i where i.id = app.ref(p_request, 'issue_id') and i.job_id = v_job_id) then
        perform app.fail('R1A_ISSUE_JOB_MISMATCH');
      end if;
    elsif p_type in ('PLANNER_UPDATE', 'CHANGE_INSTALLER') then
      if not exists (select 1 from public.work_packages w
                     where w.id = app.ref(p_request, 'work_package_id') and w.job_id = v_job_id) then
        perform app.fail('R1A_WORK_PACKAGE_JOB_MISMATCH');
      end if;
    elsif p_type in ('CANCEL_JOB', 'REINSTATE_JOB', 'CANCELLATION_RESOLVE', 'CANCELLATION_CLOSE', 'REOPEN_REVIEW_COMPLETE') then
      perform app.require_mode('FN-17', 'Manual');
      perform app.require_mode('FN-20', 'Manual');
    end if;
  end if;
end
$$;

-- Commands implemented by this backend. A type listed here must have a
-- handler app.cmd_<lower(type)>(jsonb, jsonb) returning jsonb. The sale
-- itself (reference SOLD_INTAKE) is public.submit_presale from Job Sold.
create function app.command_types()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array['BOOKING_INTAKE', 'BOOKING_GATES', 'CONFIRM_BOOKING',
               'TASK_COMPLETE', 'TASK_REOPEN', 'TASK_EVIDENCE_ATTACH', 'DEPOSIT_CONFIRM',
               'CALL_RECORD', 'ISSUE_CREATE', 'ISSUE_UPDATE', 'OPERATIONAL_COMPLETE',
               'PLANNER_UPDATE', 'MOVE_JOB', 'CHANGE_INSTALLER',
               'CANCEL_JOB', 'REINSTATE_JOB', 'CANCELLATION_RESOLVE', 'CANCELLATION_CLOSE',
               'REOPEN_REVIEW_COMPLETE', 'OUTBOX_RESOLVE']
$$;

-- The one entry point for every staff action after the sale.
--
-- Request: {command_id (uuid), command_type, job_id?, task_id?, issue_id?,
--           work_package_id?, old_allocation_id?, expected_version?, payload?}
-- Success: {ok: true, command_type, actor_id, result, replayed}
-- Refusal: raises with the reference code as the message (nothing written).
--
-- Idempotency uses the Job Sold commands ledger: same command_id + same
-- content + same actor -> the stored result, no writes; otherwise
-- R1A_COMMAND_CONFLICT. Authorization is re-checked on every replay.
create function public.execute_command(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_type text;
  v_command_id uuid;
  v_key text;
  v_fingerprint text;
  v_prior public.commands;
  v_result jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('command_id', 'command_type', 'job_id', 'task_id', 'issue_id', 'work_package_id',
                     'old_allocation_id', 'expected_version', 'payload') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;

  v_actor := app.resolve_actor();

  if nullif(btrim(p_request ->> 'command_id'), '') is null then
    perform app.fail('R1A_COMMAND_ID_REQUIRED');
  end if;
  if btrim(p_request ->> 'command_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('R1A_INVALID_COMMAND_ID');
  end if;
  v_command_id := btrim(p_request ->> 'command_id')::uuid;
  v_type := p_request ->> 'command_type';
  if v_type is null or not v_type = any (app.command_types()) then
    perform app.fail('R1A_UNKNOWN_COMMAND');
  end if;

  perform set_config('app.actor_id', app.actor_id(v_actor)::text, true);
  perform set_config('app.command_id', v_command_id::text, true);
  perform set_config('app.executing_service', 'command:' || v_type, true);

  -- Serialise concurrent submissions of the same command.
  perform pg_advisory_xact_lock(hashtextextended('command:' || v_command_id, 0));

  -- Current authorization always applies, including to replays.
  perform app.authorize_command(v_type, p_request, v_actor);

  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'type', v_type, 'actor', app.actor_id(v_actor), 'request', p_request - 'command_id')::text, 'UTF8')), 'hex');

  select * into v_prior from public.commands where command_id = v_command_id;
  if found then
    if v_prior.fingerprint <> v_fingerprint or v_prior.command_type <> v_type then
      perform app.fail('R1A_COMMAND_CONFLICT');
    end if;
    return jsonb_build_object('ok', true, 'command_type', v_type, 'actor_id', app.actor_id(v_actor),
                              'result', v_prior.result, 'replayed', true);
  end if;

  execute format('select app.%I($1, $2)', 'cmd_' || lower(v_type))
    into v_result using p_request, v_actor;

  insert into public.commands (command_id, command_type, actor_person_id, fingerprint, result)
  values (v_command_id, v_type, app.actor_id(v_actor), v_fingerprint, v_result);

  return jsonb_build_object('ok', true, 'command_type', v_type, 'actor_id', app.actor_id(v_actor),
                            'result', v_result, 'replayed', false);
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges. The identity/Job Sold helpers keep their own grants; functions
-- created here are not executable by clients (see the default privileges at
-- the top) except the entry point and the helpers RLS policies call.
-- -----------------------------------------------------------------------------

grant execute on function app.auth_email(), app.current_actor(), app.actor_id(jsonb), app.has_role(jsonb, text[]),
  app.is_admin(jsonb), app.is_director(jsonb), app.is_office(jsonb), app.is_office_manager(jsonb),
  app.is_assigned(jsonb, uuid), app.job_in_scope(public.jobs), app.context_actor_id(), app.london_date(timestamptz)
  to authenticated;
revoke execute on function public.execute_command(jsonb) from public, anon;
grant execute on function public.execute_command(jsonb) to authenticated, service_role;

