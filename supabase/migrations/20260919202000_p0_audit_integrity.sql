-- =============================================================================
-- P0 audit integrity: restore the row-level audit triggers lost in the
-- drop/restore incident, and make the loss detectable from now on.
--
-- What happened (proved by replaying the migration chain and reading
-- pg_trigger before and after):
--   * 20260919100000-107000 installed `<table>_audit` triggers calling
--     app.audit_row_change() on 49 tables, next to the 10 identity/Job Sold ones.
--   * 20260919110000 ran `drop schema app cascade`. Dropping the function
--     dropped every trigger that called it: 59 audited tables -> 0.
--   * 20260919120000 restored the identity/Job Sold objects and their 10
--     triggers only. No later migration re-created the other 49.
--
-- What is restored, and why not all 49:
--   The command architecture (20260919141000 onwards) audits operational
--   changes semantically: each command writes app.audit(...) events for the
--   entities it changes, with actor, command_id and before/after. The 36
--   operational tables (work_packages, orders, intake, communications,
--   commissioning_answers, ...) have no client write path at all - only
--   SECURITY DEFINER commands and service-role workers touch them - and several
--   hold customer response bodies and form answers (intake.raw_payload_json,
--   acknowledgements.response_text, communications.body_snapshot,
--   commissioning_answers) that must not be copied into the audit log. Row
--   snapshots there would double every event and leak those bodies, so they are
--   NOT restored.
--
--   The 13 configuration/reference tables below are different: 10 of them are
--   written DIRECTLY by staff through RLS (no command, so no semantic event:
--   since the incident those edits left no audit trail at all), and the other 3
--   are configuration that only migrations, seeds and the service role change,
--   where the trigger is the only possible record. These get their triggers
--   back, with the operations they originally had.
--
--   Added (never audited before, same reasoning): roles, permissions, skills -
--   the vocabulary the authorization model is built from.
--
-- Actor and source are resolved in the database, never taken from the row:
--   initiating_person_id = app.current_person_id() (auth.uid() -> active
--   person); null for seeds, migrations, schedulers and service-role writes,
--   whose executing_service says what ran ('db:<table>' when nothing set it).
--   command_id is the command's id when the change happened inside one.
-- Rejected mutations roll back with their audit row: nothing is recorded.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Redaction. None of the audited tables carries a secret today; this keeps it
-- that way if one is added later (invitation tokens, API keys, passwords) and
-- masks a setting whose key names a secret.
-- -----------------------------------------------------------------------------

create function app.audit_redact(p_table text, p_row jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case when p_row is null then null else (
    select coalesce(jsonb_object_agg(e.key,
      case
        when e.key ~* '(token|secret|password|passwd|api_?key|credential|private_key)' and e.value <> 'null'::jsonb
          then to_jsonb('[redacted]'::text)
        when p_table = 'settings' and e.key = 'typed_value'
             and coalesce(p_row ->> 'key', '') ~* '(token|secret|password|passwd|api_?key|credential|private_key)'
          then to_jsonb('[redacted]'::text)
        else e.value
      end), '{}'::jsonb)
    from jsonb_each(p_row) e) end
$$;
comment on function app.audit_redact(text, jsonb) is
  'Masks secret-looking columns (and secret-looking settings values) in an audit snapshot.';

-- Same function as Job Sold''s (entity id = id, else code), plus redaction.
create or replace function app.audit_row_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_after  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into public.audit_events (
    entity_type, entity_id, action, before_json, after_json,
    initiating_person_id, executing_service, command_id, reason
  ) values (
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'code', v_before ->> 'code'),
    tg_op,
    app.audit_redact(tg_table_name, v_before),
    app.audit_redact(tg_table_name, v_after),
    app.current_person_id(),
    coalesce(nullif(current_setting('app.executing_service', true), ''), 'db:' || tg_table_name),
    nullif(current_setting('app.command_id', true), ''),
    nullif(current_setting('app.reason', true), '')
  );
  return coalesce(new, old);
end
$$;

-- -----------------------------------------------------------------------------
-- The tables that must be audited, as data. app.audit_coverage() compares this
-- with pg_trigger, so System Health and the test suite both notice if a future
-- drop/recreate removes a trigger again.
-- -----------------------------------------------------------------------------

create table app.audit_required (
  table_name text primary key,
  operations text[] not null check (operations <@ array['INSERT', 'UPDATE', 'DELETE'] and cardinality(operations) > 0),
  reason     text not null
);
comment on table app.audit_required is
  'Tables that must carry a row-level audit trigger (app.audit_row_change) for the listed operations.';
revoke all on app.audit_required from public, anon, authenticated;

insert into app.audit_required (table_name, operations, reason) values
  -- Identity / Job Sold (already audited; listed so their loss is detected too).
  ('people',                  '{INSERT,UPDATE,DELETE}', 'identity'),
  ('person_roles',            '{INSERT,UPDATE,DELETE}', 'identity: who may do what'),
  ('person_skills',           '{INSERT,UPDATE,DELETE}', 'identity: installer competence'),
  ('role_permissions',        '{INSERT,UPDATE,DELETE}', 'authorization model'),
  ('customers',               '{INSERT,UPDATE,DELETE}', 'canonical customer'),
  ('jobs',                    '{INSERT,UPDATE,DELETE}', 'canonical job'),
  ('presales',                '{INSERT}',               'immutable sold document'),
  ('task_templates',          '{INSERT,UPDATE,DELETE}', 'workflow configuration'),
  ('task_assignment_rules',   '{INSERT,UPDATE,DELETE}', 'workflow configuration: task ownership'),
  ('tasks',                   '{INSERT,UPDATE,DELETE}', 'canonical task'),
  -- Restored: staff edit these directly through RLS (no command, no semantic event).
  ('companies',               '{INSERT,UPDATE,DELETE}', 'directory, edited directly by Admin'),
  ('contacts',                '{INSERT,UPDATE,DELETE}', 'directory, edited directly by Admin'),
  ('holidays',                '{INSERT,UPDATE,DELETE}', 'staffed-day configuration, edited directly by Admin'),
  ('person_availability',     '{INSERT,UPDATE,DELETE}', 'resourcing, edited directly by office managers'),
  ('teams',                   '{INSERT,UPDATE,DELETE}', 'resourcing, edited directly by office managers'),
  ('team_members',            '{INSERT,UPDATE,DELETE}', 'resourcing, edited directly by office managers'),
  ('settings',                '{INSERT}',               'versioned system configuration (rows are immutable)'),
  ('release_modes',           '{INSERT,UPDATE,DELETE}', 'release gates: which functions are switched on'),
  ('products',                '{INSERT,UPDATE,DELETE}', 'catalogue, edited directly by Admin'),
  ('stock_locations',         '{INSERT,UPDATE,DELETE}', 'stock configuration, edited directly by Admin'),
  -- Restored: configuration with no client write path (migrations, seeds, service role).
  ('mapping_rules',           '{INSERT,UPDATE,DELETE}', 'intake mapping configuration'),
  ('commissioning_templates', '{INSERT,UPDATE,DELETE}', 'commissioning form definitions'),
  ('commissioning_questions', '{INSERT,UPDATE,DELETE}', 'commissioning form definitions'),
  -- Added: the authorization vocabulary (never audited before).
  ('roles',                   '{INSERT,UPDATE,DELETE}', 'authorization vocabulary'),
  ('permissions',             '{INSERT,UPDATE,DELETE}', 'authorization vocabulary'),
  ('skills',                  '{INSERT,UPDATE,DELETE}', 'competence vocabulary');

-- Operations (INSERT/UPDATE/DELETE) on which a row-level AFTER trigger calling
-- app.audit_row_change fires for the table. Disabled triggers do not count.
create function app.audit_trigger_operations(p_table text)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct op.name order by op.name), '{}')
  from pg_catalog.pg_trigger tg
  join pg_catalog.pg_class c on c.oid = tg.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = tg.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  cross join lateral (values ('INSERT', 4), ('DELETE', 8), ('UPDATE', 16)) as op (name, bit)
  where n.nspname = 'public' and c.relname = p_table
    and pn.nspname = 'app' and p.proname = 'audit_row_change'
    and not tg.tgisinternal
    and tg.tgenabled <> 'D'
    and (tg.tgtype & 1) = 1           -- row level
    and (tg.tgtype & 2) = 0           -- after
    and (tg.tgtype & op.bit) <> 0
$$;

-- Install what is missing. Idempotent: a table that already has full coverage is
-- left alone (the hosted project may have been repaired by hand); a table that
-- does not exist is skipped and stays reported as missing.
do $$
declare
  v_req app.audit_required;
begin
  for v_req in select * from app.audit_required order by table_name loop
    if to_regclass(format('public.%I', v_req.table_name)) is null then
      raise notice 'audit: table public.% does not exist, trigger not installed', v_req.table_name;
      continue;
    end if;
    if v_req.operations <@ app.audit_trigger_operations(v_req.table_name) then
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', v_req.table_name || '_audit', v_req.table_name);
    execute format('create trigger %I after %s on public.%I for each row execute function app.audit_row_change()',
                   v_req.table_name || '_audit', array_to_string(v_req.operations, ' or '), v_req.table_name);
  end loop;
end
$$;

-- The append-only guards on the log itself, re-asserted (same names and
-- definitions as the identity foundation; created only where missing).
do $$
begin
  if not exists (select 1 from pg_catalog.pg_trigger
                 where tgrelid = 'public.audit_events'::regclass and tgname = 'audit_events_no_update_delete') then
    create trigger audit_events_no_update_delete before update or delete on public.audit_events
      for each row execute function app.forbid_audit_mutation();
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger
                 where tgrelid = 'public.audit_events'::regclass and tgname = 'audit_events_no_truncate') then
    create trigger audit_events_no_truncate before truncate on public.audit_events
      for each statement execute function app.forbid_audit_mutation();
  end if;
end
$$;
revoke insert, update, delete, truncate on public.audit_events from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Coverage report: evidence, not an assumption. 'Verified' only when every
-- required table is fully covered and the log's own guards are enabled.
-- -----------------------------------------------------------------------------

create function app.audit_coverage()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_missing jsonb;
  v_required int;
  v_guards text[];
  v_guard_missing text[];
begin
  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'table', r.table_name,
           'exists', to_regclass(format('public.%I', r.table_name)) is not null,
           'missing_operations', (select coalesce(jsonb_agg(o order by o), '[]'::jsonb) from unnest(r.operations) o
                                  where not o = any (app.audit_trigger_operations(r.table_name))))
           order by r.table_name)
           filter (where not r.operations <@ app.audit_trigger_operations(r.table_name)), '[]'::jsonb)
    into v_required, v_missing
  from app.audit_required r;

  select coalesce(array_agg(tg.tgname::text), '{}') into v_guards
  from pg_catalog.pg_trigger tg
  where tg.tgrelid = 'public.audit_events'::regclass and tg.tgenabled <> 'D'
    and tg.tgname in ('audit_events_no_update_delete', 'audit_events_no_truncate');
  select coalesce(array_agg(g), '{}') into v_guard_missing
  from unnest(array['audit_events_no_update_delete', 'audit_events_no_truncate']) g
  where not g = any (v_guards);

  return jsonb_build_object(
    'state', case when jsonb_array_length(v_missing) = 0 and cardinality(v_guard_missing) = 0
                  then 'Verified' else 'Failed' end,
    'required_tables', v_required,
    'covered_tables', v_required - jsonb_array_length(v_missing),
    'missing', v_missing,
    'append_only_guards_missing', to_jsonb(v_guard_missing));
end
$$;
comment on function app.audit_coverage() is
  'Compares app.audit_required with the triggers actually installed. state = Verified | Failed.';
grant execute on function app.audit_coverage() to service_role;
