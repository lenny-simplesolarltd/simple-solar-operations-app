-- =============================================================================
-- Which channel a command came through.
--
-- The audit already answers "who": initiating_person_id is the signed-in staff
-- member, and that does not change here - there is no assistant user, and the
-- assistant never acts as anybody but the person who asked it to.
--
-- What it could not answer is "how". executing_service names the COMMAND
-- ("command:PROGRAMME_VISIT_REVIEW"), not the caller, so "Lenny completed that
-- visit" and "Lenny completed that visit by asking SimpleBot to" were the same
-- record. With staff able to drive the whole programme conversationally, that
-- distinction is worth having - for reviewing what the assistant actually did,
-- and for anyone asking later how a decision was made.
--
-- The design is deliberately small and generic: one `origin` column on
-- public.commands and on public.audit_events, one of UI, SimpleBot, API or
-- System. It is not programme-specific and nothing about it is assistant-aware
-- beyond the derivation below.
--
-- ORIGIN IS DERIVED, NOT DECLARED. No caller passes it. execute_command works
-- it out from state that already exists: a command is SimpleBot's only when a
-- pending action with the same id was raised for the same person, and only the
-- assistant's confirmation path can create one of those. So a model cannot put
-- it in its arguments (nothing reads arguments for this), and a person calling
-- the RPC by hand cannot claim it either. A command with no person behind it is
-- System; everything else is UI, which is what every existing caller becomes
-- without changing a line.
--
-- Backward compatible: both columns default to 'UI', every existing command and
-- every existing audit row keeps working, and the fingerprint that makes
-- replays idempotent does not include origin - so replaying a command returns
-- the first result and writes nothing new, exactly as before.
--
-- ROLLBACK (verified to restore the previous behaviour):
--   begin;
--   alter table public.commands      drop column origin;
--   alter table public.audit_events  drop column origin;
--   drop function app.command_origin(uuid, jsonb);
--   drop function app.context_origin();
--   -- then re-run the previous definitions of public.execute_command(jsonb),
--   -- app.audit_row_change() and app.audit(...) from 20260919141000 /
--   -- 20260919202000, which differ from these only by the origin column.
--   commit;
-- =============================================================================

-- The four channels. Kept as a check rather than an enum so adding one later is
-- a one-line migration rather than a type rewrite.
alter table public.commands
  add column origin text not null default 'UI'
    check (origin in ('UI', 'SimpleBot', 'API', 'System'));

alter table public.audit_events
  add column origin text not null default 'UI'
    check (origin in ('UI', 'SimpleBot', 'API', 'System'));

comment on column public.commands.origin is
  'How the command was issued: UI, SimpleBot, API or System. Derived by '
  'execute_command from state, never supplied by a caller.';
comment on column public.audit_events.origin is
  'The channel the change came through. The accountable actor remains '
  'initiating_person_id.';

/**
 * The channel for one command.
 *
 * SimpleBot only when the assistant genuinely raised and confirmed this exact
 * command for this exact person - the pending action id IS the command id, by
 * the assistant''s own contract. System when there is no person behind the
 * call, which is how the schedulers and workers appear. UI otherwise.
 */
create function app.command_origin(p_command_id uuid, p_actor jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.assistant_pending_actions a
      where a.id = p_command_id
        and a.person_id = app.actor_id(p_actor)
    ) then 'SimpleBot'
    when app.actor_id(p_actor) is null then 'System'
    else 'UI'
  end
$$;

/** What the audit writers stamp on a row. Defaults to UI, like the columns. */
create function app.context_origin()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('app.origin', true), ''), 'UI')
$$;

grant execute on function app.command_origin(uuid, jsonb), app.context_origin()
  to authenticated, service_role;

create or replace function public.execute_command(p_request jsonb)
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
  -- The channel is DERIVED, never declared. Nothing in p_request says where the
  -- command came from, so neither a model's arguments nor a hand-written RPC
  -- call can claim to be the assistant: a command is the assistant's only when a
  -- pending action with this very id was raised for this very person, which
  -- only the assistant's confirmation path creates.
  perform set_config('app.origin', app.command_origin(v_command_id, v_actor), true);

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

  insert into public.commands (command_id, command_type, actor_person_id, fingerprint, result, origin)
  values (v_command_id, v_type, app.actor_id(v_actor), v_fingerprint, v_result,
          app.context_origin());

  return jsonb_build_object('ok', true, 'command_type', v_type, 'actor_id', app.actor_id(v_actor),
                            'result', v_result, 'replayed', false);
end
$$;

create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_after  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into public.audit_events (
    entity_type, entity_id, action, before_json, after_json,
    initiating_person_id, executing_service, command_id, reason, origin
  ) values (
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'code', v_before ->> 'code'),
    tg_op,
    app.audit_redact(tg_table_name, v_before),
    app.audit_redact(tg_table_name, v_after),
    app.current_person_id(),
    coalesce(nullif(current_setting('app.executing_service', true), ''), 'db:' || tg_table_name),
    nullif(current_setting('app.command_id', true), ''),
    nullif(current_setting('app.reason', true), ''),
    app.context_origin()
  );
  return coalesce(new, old);
end
$$;

create or replace function app.audit(p_entity_type text, p_entity_id text, p_action text, p_before jsonb, p_after jsonb, p_reason text DEFAULT NULL::text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (entity_type, entity_id, action, before_json, after_json,
                                   initiating_person_id, executing_service, command_id, reason, origin)
  values (p_entity_type, p_entity_id, p_action, p_before, p_after,
          app.context_actor_id(), app.context_service(), app.context_command_id(), p_reason,
          app.context_origin())
$$;
