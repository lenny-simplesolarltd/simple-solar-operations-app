-- =============================================================================
-- Backend port: command / read registry for the R2-R4 modules.
--
-- The R1 command list and authorization matrix are code in
-- 20260919141000_command_core.sql. Later modules register themselves here as
-- data instead of each re-replacing those functions (migrations are
-- append-only; several modules would otherwise overwrite one another).
--
--   app.command_registry  one row per command type: which roles may call it,
--                         whether it is job-scoped (app.authorize_job), and
--                         the release modes it needs. Object-level rules
--                         (allocation, work package / job linkage, office
--                         acting for an installer) stay in the handler.
--   app.read_registry     one row per read type served by
--                         public.execute_operations_read (reference
--                         r1-appsheet operations-contract reads).
--
-- Handlers: app.cmd_<lower(command_type)>(request jsonb, actor jsonb) -> jsonb
--           app.read_<lower(read_type)>(request jsonb, actor jsonb) -> jsonb
-- =============================================================================

create table app.command_registry (
  command_type text primary key check (command_type ~ '^[A-Z][A-Z0-9_]*$'),
  -- The actor must hold at least one of these active roles.
  roles        text[] not null check (cardinality(roles) > 0),
  -- true: request.job_id must name a job the actor is assigned to.
  job_scoped   boolean not null,
  -- [{"function_id": "FN-03", "mode": "Automated"}, ...] - all required.
  modes        jsonb not null default '[]'::jsonb check (jsonb_typeof(modes) = 'array'),
  module       text not null,
  notes        text
);
comment on table app.command_registry is
  'Declarative authorization for commands added after R1. R1 commands keep their coded matrix (app.authorize_command_r1).';

create table app.read_registry (
  read_type text primary key check (read_type ~ '^[A-Z][A-Z0-9_]*$'),
  roles     text[] not null check (cardinality(roles) > 0),
  modes     jsonb not null default '[]'::jsonb check (jsonb_typeof(modes) = 'array'),
  module    text not null,
  notes     text
);

-- Release modes: the function's own row decides its release; the reference
-- checked target_release against the calling module's release, which is the
-- same row by construction, so only mode and scope are compared now. (R1-only
-- in 141000, which would refuse every R2-R4 function.)
create or replace function app.mode_available(p_function_id text, p_wanted text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select count(*) = 1 and bool_and(m.mode = p_wanted and m.authorised_job_scope in ('Pilot', 'All'))
  from public.release_modes m
  where m.function_id = p_function_id
$$;

create function app.require_modes(p_modes jsonb)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_mode jsonb;
begin
  for v_mode in select * from jsonb_array_elements(p_modes) loop
    perform app.require_mode(v_mode ->> 'function_id', v_mode ->> 'mode');
  end loop;
end
$$;

-- Keep the R1 matrix exactly as applied; route registered types first.
alter function app.authorize_command(text, jsonb, jsonb) rename to authorize_command_r1;

create function app.authorize_command(p_type text, p_request jsonb, p_actor jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg app.command_registry;
begin
  select * into v_reg from app.command_registry where command_type = p_type;
  if not found then
    perform app.authorize_command_r1(p_type, p_request, p_actor);
    return;
  end if;
  if not app.has_role(p_actor, variadic v_reg.roles) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  if v_reg.job_scoped then
    perform app.authorize_job(p_actor, app.ref(p_request, 'job_id'));
  end if;
  perform app.require_modes(v_reg.modes);
end
$$;

create or replace function app.command_types()
returns text[]
language sql stable
set search_path = ''
as $$
  select array['BOOKING_INTAKE', 'BOOKING_GATES', 'CONFIRM_BOOKING',
               'TASK_COMPLETE', 'TASK_REOPEN', 'TASK_EVIDENCE_ATTACH', 'DEPOSIT_CONFIRM',
               'CALL_RECORD', 'ISSUE_CREATE', 'ISSUE_UPDATE', 'OPERATIONAL_COMPLETE',
               'PLANNER_UPDATE', 'MOVE_JOB', 'CHANGE_INSTALLER',
               'CANCEL_JOB', 'REINSTATE_JOB', 'CANCELLATION_RESOLVE', 'CANCELLATION_CLOSE',
               'REOPEN_REVIEW_COMPLETE', 'OUTBOX_RESOLVE']
         || coalesce((select array_agg(command_type order by command_type) from app.command_registry), '{}')
$$;

-- Reads for the R2/R3 operations modules (reference _r1cRead): installer
-- workflow, goods-in detail, stock balance, and later ones.
create function public.execute_operations_read(p_request jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_type text;
  v_reg app.read_registry;
  v_data jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_actor := app.resolve_actor();
  v_type := p_request ->> 'read_type';
  select * into v_reg from app.read_registry where read_type = v_type;
  if not found then
    perform app.fail('R1A_UNKNOWN_READ');
  end if;
  if not app.has_role(v_actor, variadic v_reg.roles) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  perform app.require_modes(v_reg.modes);
  execute format('select app.%I($1, $2)', 'read_' || lower(v_type)) into v_data using p_request, v_actor;
  return jsonb_build_object('ok', true, 'read_type', v_type, 'actor_id', app.actor_id(v_actor), 'data', v_data);
end
$$;

revoke all on app.command_registry, app.read_registry from public, anon, authenticated;
revoke execute on function public.execute_operations_read(jsonb) from public, anon;
grant execute on function public.execute_operations_read(jsonb) to authenticated, service_role;
