-- =============================================================================
-- Remove the identity-foundation and job-sold tables, and everything built on
-- them, leaving the remaining tables as plain, empty tables.
--
-- Dropped tables: people, roles, person_roles, skills, person_skills,
-- audit_events, customers, jobs, presales, task_templates, tasks,
-- task_assignment_rules, commands, role_permissions.
--
-- The app.* helpers (row stamping, audit, role predicates, RLS helpers) all read
-- those tables, so the schema is dropped with them. CASCADE also removes every
-- trigger and RLS policy that uses the helpers, including the auth.users ->
-- people link trigger. Foreign-key constraints pointing at the dropped tables
-- are removed; the columns themselves are kept.
--
-- RLS stays enabled on the remaining tables with no policies: only the service
-- role can read or write them until new policies are added.
-- =============================================================================

drop function if exists public.submit_presale(uuid, jsonb);
drop function if exists public.current_actor();

drop schema if exists app cascade;

drop table if exists
  public.people,
  public.roles,
  public.person_roles,
  public.skills,
  public.person_skills,
  public.audit_events,
  public.customers,
  public.jobs,
  public.presales,
  public.task_templates,
  public.tasks,
  public.task_assignment_rules,
  public.commands,
  public.role_permissions
  cascade;

-- Empty every remaining table.
do $$
declare
  v_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into v_tables
    from pg_tables
   where schemaname = 'public';
  if v_tables is not null then
    execute 'truncate table ' || v_tables || ' restart identity';
  end if;
end
$$;

