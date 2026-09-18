-- =============================================================================
-- Backend port, part 11: wiring - evidence storage, scheduled jobs and the
-- cancellation preview entry point.
--
-- Each block is guarded so the migration also applies where the Supabase
-- platform pieces (storage schema, pg_cron) are absent (local test engines).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Evidence files: private bucket "evidence", objects stored under
-- "<jobs.id>/<file name>". Office staff may upload/read files only for jobs
-- they are assigned to (the same rule as commands). The evidence row itself is
-- created by the command that references the file (app.ensure_evidence).
-- -----------------------------------------------------------------------------

create function app.storage_job_id(p_name text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
declare
  v_first text := split_part(p_name, '/', 1);
begin
  if v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end
$$;

create function app.can_access_job_files(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.current_actor() is not null
     and app.is_office(app.current_actor())
     and app.storage_job_id(p_name) is not null
     and app.is_assigned(app.current_actor(), app.storage_job_id(p_name))
$$;
grant execute on function app.storage_job_id(text), app.can_access_job_files(text) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
  on conflict (id) do nothing;
  execute $p$create policy evidence_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'evidence' and app.can_access_job_files(name))$p$;
  execute $p$create policy evidence_select on storage.objects for select to authenticated
    using (bucket_id = 'evidence' and app.can_access_job_files(name))$p$;
end
$$;

-- -----------------------------------------------------------------------------
-- Cancellation preview for staff (s15 _s15Preview, read-only).
-- -----------------------------------------------------------------------------

create function public.cancellation_preview(p_job_id uuid, p_effective_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
begin
  if not app.is_office_manager(v_actor) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.is_assigned(v_actor, p_job_id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  if p_effective_date is null then
    return app.s15_preview(p_job_id);
  end if;
  return app.s15_preview(p_job_id, p_effective_date);
end
$$;
revoke execute on function public.cancellation_preview(uuid, date) from public, anon;
grant execute on function public.cancellation_preview(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Scheduled jobs (pg_cron). All times UTC; each function checks its own
-- release mode and does nothing while that function is Disabled.
--   * resilience sweep (FN-14): review tasks, failure alerts, health - every 30 min
--   * installer / customer / missing-commissioning calls (S10) - every 30 min
--   * daily system tasks SYS01 / SYS02 (FN-16) - 05:00 UTC (before 09:00 London)
-- -----------------------------------------------------------------------------

grant execute on function app.run_resilience_sweep(timestamptz), app.run_system_tasks(date),
  app.s10_run_schedules(timestamptz) to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('ss-resilience-sweep', '*/30 * * * *', 'select app.run_resilience_sweep()');
  perform cron.schedule('ss-s10-schedules', '5,35 * * * *', 'select app.s10_run_schedules()');
  perform cron.schedule('ss-system-tasks', '0 5 * * *', 'select app.run_system_tasks()');
end
$$;
