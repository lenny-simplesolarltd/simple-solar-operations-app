-- =============================================================================
-- Final convergence: the operational capabilities staff still needed SQL, the
-- Supabase dashboard or one-job-at-a-time screens for.
--
--   1. ISSUES read       cross-job issue list with the JOB_OPERATIONS action
--                        flags (resolve / close / reassign), so the office can
--                        work every open issue without opening each job.
--   2. Issue files       an evidence file quoted by ISSUE_UPDATE is linked to
--                        its issue (evidence.issue_id), so it is listed with
--                        the job's issue files.
--   3. Release control   RELEASE_MODE_SET: the only way to switch a release
--                        function on or off - reason, version check, the
--                        function's planned mode, the FN-01 core dependency,
--                        one audit event (the release_modes row trigger).
--                        Direct table writes by staff are withdrawn.
--                        RELEASE_CONTROL read and app.release_readiness(): the
--                        new-stack replacement for the old S20 release
--                        contract (conditions to meet before switching R1 on).
--   4. Staff access      STAFF_CREATE, STAFF_ROLE_SET, STAFF_SET_ACTIVE for
--                        Admin / Manager, over the existing identity model
--                        (auth.uid() -> people.auth_user_id -> active
--                        person_roles). Logins are still invitations.
--   5. TASK_REASSIGN     move an open task to another eligible person.
--   6. search_evidence   authorized cross-job file search (Files library).
--
-- Nothing here switches a release function on.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ISSUES read
-- -----------------------------------------------------------------------------

-- Request: {status?: 'open' (default) | 'resolved' | 'all', type?, q?, limit?}
-- Rows: every issue on a job the actor may read (app.can_read_job); the action
-- flags follow ISSUE_UPDATE (office class, assigned to the job, FN-01, state).
create function app.read_issues(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_status text := coalesce(nullif(btrim(p_request ->> 'status'), ''), 'open');
  v_type text := nullif(btrim(p_request ->> 'type'), '');
  v_q text := nullif(btrim(p_request ->> 'q'), '');
  v_limit int;
  v_office boolean := app.is_office(p_actor);
  v_fn01 boolean := app.mode_available('FN-01', 'Automated');
  v_rows jsonb;
  v_counts jsonb;
begin
  perform app.req_keys(p_request, array['status', 'type', 'q', 'limit']);
  if v_status not in ('open', 'resolved', 'all') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'status'));
  end if;
  if coalesce(p_request ->> 'limit', '') !~ '^([0-9]{1,3})?$' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'limit'));
  end if;
  v_limit := least(greatest(coalesce(nullif(p_request ->> 'limit', '')::int, 200), 1), 500);

  with visible as (
    select i.*, j.job_ref, j.workflow_stage, j.version as job_version, c.first_name, c.last_name, c.postcode,
           app.job_actionable(j) as active,
           app.job_in_scope(j) and app.is_assigned(p_actor, j.id) as access
    from public.issues i
    join public.jobs j on j.id = i.job_id
    left join public.customers c on c.id = j.customer_id
    where app.can_read_job(p_actor, j.id)
      and (v_type is null or i.type = v_type)
      and (v_q is null or j.job_ref ilike '%' || v_q || '%' or i.category ilike '%' || v_q || '%'
           or i.description ilike '%' || v_q || '%' or c.postcode ilike '%' || v_q || '%'
           or (c.first_name || ' ' || c.last_name) ilike '%' || v_q || '%')
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'job_id', v.job_id, 'job_ref', v.job_ref, 'job_version', v.job_version,
        'workflow_stage', v.workflow_stage, 'customer_name', nullif(btrim(concat_ws(' ', v.first_name, v.last_name)), ''),
        'postcode', v.postcode, 'type', v.type, 'category', v.category, 'description', v.description,
        'severity', v.severity, 'status', v.status, 'blocks_completion', v.blocks_completion,
        'raised_at', v.raised_at, 'raised_by_name', app.s17_person_name(v.raised_by),
        'owner_id', v.office_owner_id, 'owner_name', app.s17_person_name(v.office_owner_id),
        'due_at', v.due_at, 'resolution', v.resolution, 'resolved_at', v.resolved_at, 'closed_at', v.closed_at,
        'version', v.version, 'work_package_id', v.work_package_id,
        'actions', jsonb_build_object(
          'resolve', app.r1x_flag(v_office, v.access, v_fn01, v.active and v.status not in ('Resolved', 'Closed'),
                                  case when not v.active then 'JOB_NOT_ACTIONABLE' else 'ALREADY_RESOLVED' end),
          'close', app.r1x_flag(v_office, v.access, v_fn01, v.active and v.status = 'Resolved',
                                case when not v.active then 'JOB_NOT_ACTIONABLE' else 'RESOLVE_FIRST' end),
          'reassign', app.r1x_flag(v_office, v.access, v_fn01, v.active and v.status <> 'Closed',
                                   case when not v.active then 'JOB_NOT_ACTIONABLE' else 'ISSUE_CLOSED' end)))
        order by (v.blocks_completion and v.status not in ('Resolved', 'Closed')) desc, v.raised_at desc)
      from (select * from visible
            where case v_status when 'open' then status not in ('Resolved', 'Closed')
                                when 'resolved' then status in ('Resolved', 'Closed') else true end
            order by (blocks_completion and status not in ('Resolved', 'Closed')) desc, raised_at desc
            limit v_limit) v), '[]'::jsonb),
    jsonb_build_object(
      'open', (select count(*) from visible where status not in ('Resolved', 'Closed')),
      'blocking', (select count(*) from visible where blocks_completion and status not in ('Resolved', 'Closed')),
      'resolved_awaiting_close', (select count(*) from visible where status = 'Resolved'))
  into v_rows, v_counts;

  return jsonb_build_object('status', v_status, 'counts', v_counts, 'issues', v_rows,
    'office_people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name)
                                                order by p.display_name), '[]'::jsonb)
                      from public.people p
                      where p.active and exists (select 1 from public.person_roles r where r.person_id = p.id and r.active
                                                 and r.role_code in ('Admin', 'Manager', 'Director', 'Office', 'VariationApprover'))));
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('ISSUES', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'convergence',
   'Cross-job issues (Issues Queue): job, customer, status, blocking, owner and ISSUE_UPDATE availability per issue.');

-- JOB_OPERATIONS also lists who an issue can be reassigned to (ISSUE_UPDATE
-- REASSIGN takes an office person), so the job's Operations tab can offer it.
alter function app.read_job_operations(jsonb, jsonb) rename to read_job_operations_pre_convergence;

create function app.read_job_operations(p_request jsonb, p_actor jsonb)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select app.read_job_operations_pre_convergence(p_request, p_actor) || jsonb_build_object('office_people',
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name), '[]'::jsonb)
     from public.people p
     where p.active and exists (select 1 from public.person_roles r where r.person_id = p.id and r.active
                                and r.role_code in ('Admin', 'Manager', 'Director', 'Office', 'VariationApprover'))))
$$;

-- -----------------------------------------------------------------------------
-- 2. Issue files: evidence quoted on an issue event belongs to that issue
-- -----------------------------------------------------------------------------

create function app.issue_event_evidence_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.evidence_id is not null then
    update public.evidence e set issue_id = new.issue_id
    where e.id = new.evidence_id and e.issue_id is null;
  end if;
  return new;
end
$$;

create trigger issue_events_evidence_link after insert on public.issue_events
  for each row execute function app.issue_event_evidence_link();

-- -----------------------------------------------------------------------------
-- 3. Release control
-- -----------------------------------------------------------------------------

-- The functions a release function cannot work without. Every function whose
-- commands also require FN-01 (the office core) depends on it: from the
-- command registry, plus the R1 office functions whose commands are
-- authorized in app.authorize_command_r1 (FN-11, 15, 17, 19, 20) and the
-- S10/S16 schedulers (FN-16, 18). Functions that only work together (FN-17 and
-- FN-20, FN-19 and FN-11) are reported as "works with", not blocked, so
-- neither can deadlock the other.
create function app.release_requires(p_function_id text)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select case when p_function_id = 'FN-01' then '{}'::text[]
              when p_function_id in ('FN-11', 'FN-15', 'FN-16', 'FN-17', 'FN-18', 'FN-19', 'FN-20')
                or exists (select 1 from app.command_registry r
                           where r.modes @> jsonb_build_array(jsonb_build_object('function_id', p_function_id))
                             and r.modes @> '[{"function_id": "FN-01"}]'::jsonb)
                then array['FN-01']
              else '{}'::text[] end
$$;

create function app.release_works_with(p_function_id text)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct f order by f), '{}') from (
    select m ->> 'function_id' as f
    from app.command_registry r, jsonb_array_elements(r.modes) m
    where r.modes @> jsonb_build_array(jsonb_build_object('function_id', p_function_id))
    union all
    select unnest(case p_function_id when 'FN-17' then array['FN-20'] when 'FN-20' then array['FN-17']
                                     when 'FN-19' then array['FN-11'] when 'FN-11' then array['FN-19'] end)
  ) x
  where f <> p_function_id and f <> 'FN-01'
$$;

-- RELEASE_MODE_SET
-- Request: {command_id, command_type, expected_version (the release_modes row's),
--           payload: {function_id, mode: 'Disabled' | <planned mode>, scope?: 'Pilot' | 'All', reason}}
create function app.cmd_release_mode_set(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['function_id', 'mode', 'scope', 'reason'], array['function_id', 'mode', 'reason']);
  v_fn text := app.txt(v_p, 'function_id');
  v_mode text := app.txt(v_p, 'mode');
  v_scope text := app.txt(v_p, 'scope');
  v_reason text := app.txt(v_p, 'reason');
  v_row public.release_modes;
  v_after public.release_modes;
  v_req text;
  v_dependant text;
  v_prev_reason text := current_setting('app.reason', true);
begin
  select * into v_row from public.release_modes m where m.function_id = v_fn for update;
  if v_row.id is null then
    perform app.fail('RELEASE_FUNCTION_UNKNOWN');
  end if;
  if v_row.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if length(coalesce(v_reason, '')) < 5 then
    perform app.fail('RELEASE_REASON_REQUIRED');
  end if;
  if v_mode = 'Disabled' then
    v_scope := 'None';
  else
    -- Release semantics: a function runs only in its planned mode (commands
    -- check the exact mode), so no other mode is ever offered.
    if v_mode is distinct from v_row.planned_target_mode then
      perform app.fail('RELEASE_MODE_NOT_PLANNED', jsonb_build_object('planned', v_row.planned_target_mode));
    end if;
    v_scope := coalesce(v_scope, 'Pilot');
    if v_scope not in ('Pilot', 'All') then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'scope'));
    end if;
    foreach v_req in array app.release_requires(v_fn) loop
      if exists (select 1 from public.release_modes m where m.function_id = v_req and m.mode = 'Disabled') then
        perform app.fail('RELEASE_DEPENDENCY_DISABLED', jsonb_build_object('requires', v_req));
      end if;
    end loop;
  end if;
  if v_mode = 'Disabled' then
    select m.function_id into v_dependant from public.release_modes m
    where m.mode <> 'Disabled' and m.function_id <> v_fn and v_fn = any (app.release_requires(m.function_id))
    order by m.function_id limit 1;
    if v_dependant is not null then
      perform app.fail('RELEASE_DEPENDANT_ENABLED', jsonb_build_object('dependant', v_dependant));
    end if;
  end if;
  if v_row.mode = v_mode and v_row.authorised_job_scope = v_scope then
    return jsonb_build_object('status', 'Unchanged', 'function_id', v_fn, 'mode', v_mode, 'scope', v_scope,
                              'version', v_row.version, 'external_calls', 0);
  end if;

  -- One audit event: the release_modes row trigger, carrying the reason.
  perform set_config('app.reason', v_reason, true);
  update public.release_modes
  set mode = v_mode, authorised_job_scope = v_scope,
      activation_time = case when v_mode <> 'Disabled' and v_row.mode = 'Disabled' then now() else activation_time end
  where id = v_row.id
  returning * into v_after;
  perform set_config('app.reason', coalesce(v_prev_reason, ''), true);

  return jsonb_build_object('status', case when v_mode = 'Disabled' then 'Disabled' else 'Enabled' end,
    'function_id', v_fn, 'mode', v_after.mode, 'scope', v_after.authorised_job_scope, 'version', v_after.version,
    'previous_mode', v_row.mode, 'external_calls', 0);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('RELEASE_MODE_SET', array['Admin', 'Manager'], false, '[]', 'convergence',
   'Switch a release function to Disabled or its planned mode (Pilot/All), with a reason; FN-01 dependency enforced. Not release-gated itself.');

-- Staff writes to release_modes go through RELEASE_MODE_SET only.
drop policy if exists release_modes_insert on public.release_modes;
drop policy if exists release_modes_update on public.release_modes;
revoke insert, update, delete on public.release_modes from authenticated, anon;

-- The conditions to meet before R1 is switched on (the old S20 release
-- contract, for the new stack). Each item: Pass | Fail | Unknown, never a
-- guess. Read only; enabling stays a deliberate RELEASE_MODE_SET.
create function app.release_readiness()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_ops jsonb := app.operational_health(now());
  v_item jsonb;
  v_n int;
  v_cron jsonb;
  v_missing text[];
  v_bad text[];
  v_add jsonb;
begin
  -- Audit trail, backups and recovery drills: the operational evidence states.
  for v_item in select i from jsonb_array_elements(v_ops -> 'items') i
                where i ->> 'key' in ('AuditCoverage', 'DatabaseBackup', 'DatabaseRestoreDrill', 'StorageBackup',
                                      'StorageRestoreDrill') loop
    v_items := v_items || jsonb_build_object('key', v_item ->> 'key', 'label', v_item ->> 'label',
      'state', case v_item ->> 'state' when 'Verified' then 'Pass' when 'Unknown' then 'Unknown' else 'Fail' end,
      'detail', v_item ->> 'detail');
  end loop;

  -- Schedulers: the pg_cron jobs R1 relies on (INS01 / INS04 call tasks, the
  -- resilience sweep, daily system tasks).
  if to_regclass('cron.job') is null then
    v_items := v_items || jsonb_build_object('key', 'Scheduler', 'label', 'Background schedules (pg_cron)',
      'state', 'Unknown', 'detail', 'pg_cron is not installed in this database.');
  else
    execute $q$select coalesce(array_agg(n), '{}') from unnest(array['ss-s10-schedules', 'ss-resilience-sweep', 'ss-system-tasks']) n
               where not exists (select 1 from cron.job j where j.jobname = n and j.active)$q$ into v_missing;
    v_items := v_items || jsonb_build_object('key', 'Scheduler', 'label', 'Background schedules (pg_cron)',
      'state', case when cardinality(v_missing) = 0 then 'Pass' else 'Fail' end,
      'detail', case when cardinality(v_missing) = 0 then 'ss-s10-schedules, ss-resilience-sweep and ss-system-tasks are scheduled and active.'
                     else 'Not scheduled or inactive: ' || array_to_string(v_missing, ', ') || '.' end);
  end if;

  -- Staff: an active Admin who can sign in.
  select count(*) into v_n from public.people p
  where p.active and p.auth_user_id is not null
    and exists (select 1 from public.person_roles r where r.person_id = p.id and r.active and r.role_code = 'Admin');
  v_items := v_items || jsonb_build_object('key', 'AdminLogin', 'label', 'An administrator can sign in',
    'state', case when v_n > 0 then 'Pass' else 'Fail' end,
    'detail', v_n || ' active Admin login(s).');

  -- Task ownership: every active R1 task template has an active rule whose
  -- owner is an active person. INS02 is owned by the work package's lead
  -- installer (s10 INS02 rule), so it has no rule by design.
  select coalesce(array_agg(t.code order by t.code), '{}') into v_missing
  from public.task_templates t
  where t.active and t.code ~ '^(PRE0[1-5]|BKG0[1-5]|INS0[134]|ISS0[1-2]|REM01)$'
    and not exists (select 1 from public.task_assignment_rules r join public.people p on p.id = r.owner_person_id
                    where r.template_code = t.code and r.active and p.active);
  v_items := v_items || jsonb_build_object('key', 'TaskOwners', 'label', 'Every R1 task has an owner',
    'state', case when cardinality(v_missing) = 0 then 'Pass' else 'Fail' end,
    'detail', case when cardinality(v_missing) = 0 then 'Every PRE, BKG, INS (except INS02, the lead installer), ISS and REM template has an active owner.'
                   else 'No active owner for: ' || array_to_string(v_missing, ', ') || '.' end);

  -- Release modes are consistent: Disabled <=> scope None, and a function only
  -- ever runs in its planned mode.
  select coalesce(array_agg(m.function_id order by m.function_id), '{}') into v_bad
  from public.release_modes m
  where (m.mode = 'Disabled') <> (m.authorised_job_scope = 'None')
     or (m.mode <> 'Disabled' and m.mode is distinct from m.planned_target_mode);
  v_items := v_items || jsonb_build_object('key', 'ModeConsistency', 'label', 'Release modes are consistent',
    'state', case when cardinality(v_bad) = 0 then 'Pass' else 'Fail' end,
    'detail', case when cardinality(v_bad) = 0 then 'Every function is Disabled (scope None) or in its planned mode.'
                   else 'Inconsistent: ' || array_to_string(v_bad, ', ') || '.' end);

  -- Unfinished commits needing recovery.
  select count(*) into v_n from public.commit_journal where state = 'RecoveryRequired';
  v_items := v_items || jsonb_build_object('key', 'CommitJournal', 'label', 'No commits awaiting recovery',
    'state', case when v_n = 0 then 'Pass' else 'Fail' end, 'detail', v_n || ' awaiting recovery.');

  -- Files stay private.
  if to_regclass('storage.buckets') is not null then
    execute $q$select count(*) from storage.buckets where id = 'evidence' and not public$q$ into v_n;
    v_add := jsonb_build_object('key', 'PrivateFiles', 'label', 'Customer files are private',
      'state', case when v_n = 1 then 'Pass' else 'Fail' end,
      'detail', case when v_n = 1 then 'The evidence bucket exists and is private.' else 'The private evidence bucket is missing or public.' end);
  else
    v_add := jsonb_build_object('key', 'PrivateFiles', 'label', 'Customer files are private', 'state', 'Unknown',
      'detail', 'This database has no Storage.');
  end if;
  v_items := v_items || v_add;

  return jsonb_build_object(
    'release', 'R1',
    'ready', not exists (select 1 from jsonb_array_elements(v_items) i where i ->> 'state' <> 'Pass'),
    'counts', (select jsonb_object_agg(s, (select count(*) from jsonb_array_elements(v_items) i where i ->> 'state' = s))
               from unnest(array['Pass', 'Fail', 'Unknown']) s),
    'external_prerequisites', jsonb_build_array(
      'Supabase Auth: sign-ups off, invitations only, SMTP sender configured',
      'An external uptime monitor polls /api/health',
      'Hosted database carries every repository migration'),
    'items', v_items);
end
$$;

-- RELEASE_CONTROL read: every function with its dependencies, last change and
-- the R1 readiness verdict. Admin / Manager act; Director (go-live approver)
-- may look.
create function app.read_release_control(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.req_keys(p_request, array[]::text[]);
  return jsonb_build_object(
    'can_change', app.is_admin(p_actor),
    'functions', (select coalesce(jsonb_agg(jsonb_build_object(
        'function_id', m.function_id, 'name', m.function_name, 'target_release', m.target_release,
        'mode', m.mode, 'scope', m.authorised_job_scope, 'planned_mode', m.planned_target_mode,
        'current_system', m.current_system, 'fallback', m.fallback, 'notes', m.scope_boundary_notes,
        'activation_time', m.activation_time, 'version', m.version,
        'requires', to_jsonb(app.release_requires(m.function_id)),
        'works_with', to_jsonb(app.release_works_with(m.function_id)),
        'blocked_by', (select coalesce(jsonb_agg(r), '[]'::jsonb) from unnest(app.release_requires(m.function_id)) r
                       where exists (select 1 from public.release_modes x where x.function_id = r and x.mode = 'Disabled')),
        'required_by', (select coalesce(jsonb_agg(x.function_id order by x.function_id), '[]'::jsonb)
                        from public.release_modes x
                        where x.mode <> 'Disabled' and m.function_id = any (app.release_requires(x.function_id))),
        'last_change', (select jsonb_build_object('at', a.occurred_at, 'by', app.s17_person_name(a.initiating_person_id),
                                                  'service', a.executing_service, 'reason', a.reason,
                                                  'from', a.before_json ->> 'mode', 'to', a.after_json ->> 'mode')
                        from public.audit_events a
                        where a.entity_type = 'release_modes' and a.entity_id = m.id::text
                        order by a.occurred_at desc limit 1))
      order by m.function_id), '[]'::jsonb) from public.release_modes m),
    'readiness', app.release_readiness());
end
$$;

create function app.read_release_readiness(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.req_keys(p_request, array[]::text[]);
  return app.release_readiness();
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('RELEASE_CONTROL', array['Admin', 'Manager', 'Director'], '[]', 'convergence',
   'Release functions: mode, scope, planned mode, dependencies, last change (who/why) and R1 readiness.'),
  ('RELEASE_READINESS', array['Admin', 'Manager', 'Director', 'Office'], '[]', 'convergence',
   'R1 readiness checklist (S20 replacement): Pass / Fail / Unknown per condition.');

-- -----------------------------------------------------------------------------
-- 4. Staff and access administration
-- -----------------------------------------------------------------------------

create function app.staff_admin_guard(p_actor jsonb, p_person uuid, p_removing_admin boolean)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_person = app.actor_id(p_actor) and p_removing_admin then
    perform app.fail('STAFF_SELF_LOCKOUT');
  end if;
  if p_removing_admin and not exists (
       select 1 from public.person_roles r join public.people p on p.id = r.person_id
       where r.role_code = 'Admin' and r.active and p.active and p.id <> p_person) then
    perform app.fail('STAFF_LAST_ADMIN');
  end if;
end
$$;

-- STAFF_CREATE: {payload: {display_name, email, roles?: [role codes]}}. The
-- login is sent afterwards from People & access (invitation).
create function app.cmd_staff_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['display_name', 'email', 'roles'], array['display_name', 'email']);
  v_name text := app.txt(v_p, 'display_name');
  v_email text := lower(app.txt(v_p, 'email'));
  v_role text;
  v_person public.people;
begin
  if length(coalesce(v_name, '')) < 2 then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'display_name'));
  end if;
  if coalesce(v_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'email'));
  end if;
  if exists (select 1 from public.people p where lower(p.email) = v_email) then
    perform app.fail('STAFF_EMAIL_EXISTS');
  end if;
  insert into public.people (email, display_name, active) values (v_email, v_name, true) returning * into v_person;
  for v_role in select jsonb_array_elements_text(coalesce(v_p -> 'roles', '[]'::jsonb)) loop
    if not exists (select 1 from public.roles r where r.code = v_role) then
      perform app.fail('STAFF_ROLE_UNKNOWN', jsonb_build_object('role', v_role));
    end if;
    if v_role = 'Admin' and not app.has_role(p_actor, 'Admin') then
      perform app.fail('STAFF_ADMIN_GRANT_DENIED');
    end if;
    insert into public.person_roles (person_id, role_code) values (v_person.id, v_role);
  end loop;
  return jsonb_build_object('status', 'Created', 'person_id', v_person.id, 'external_calls', 0);
end
$$;

-- STAFF_ROLE_SET: {payload: {person_id, role_code, active, reason},
-- expected_version: the person_roles row's version, or - for a role the
-- person has never held - the people row's version}.
create function app.cmd_staff_role_set(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['person_id', 'role_code', 'active', 'reason'],
                           array['person_id', 'role_code', 'active', 'reason']);
  v_person uuid := app.ref(v_p, 'person_id');
  v_role text := app.txt(v_p, 'role_code');
  v_active boolean := app.yes_flag(v_p -> 'active');
  v_reason text := app.txt(v_p, 'reason');
  v_row public.person_roles;
  v_prev text := current_setting('app.reason', true);
begin
  if not exists (select 1 from public.people p where p.id = v_person) then
    perform app.fail('R1A_PERSON_NOT_FOUND');
  end if;
  if not exists (select 1 from public.roles r where r.code = v_role) then
    perform app.fail('STAFF_ROLE_UNKNOWN');
  end if;
  if v_role = 'Admin' and not app.has_role(p_actor, 'Admin') then
    perform app.fail('STAFF_ADMIN_GRANT_DENIED');
  end if;
  if length(coalesce(v_reason, '')) < 3 then
    perform app.fail('R1A_REQUIRED_REASON');
  end if;
  select * into v_row from public.person_roles r where r.person_id = v_person and r.role_code = v_role for update;
  if coalesce(v_row.version, (select p.version from public.people p where p.id = v_person)) <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_role = 'Admin' and not v_active then
    perform app.staff_admin_guard(p_actor, v_person, true);
  end if;
  if v_row.id is not null and v_row.active = v_active then
    return jsonb_build_object('status', 'Unchanged', 'person_id', v_person, 'role_code', v_role, 'active', v_active,
                              'external_calls', 0);
  end if;
  perform set_config('app.reason', v_reason, true);
  if v_row.id is null then
    insert into public.person_roles (person_id, role_code, active) values (v_person, v_role, v_active) returning * into v_row;
  else
    update public.person_roles set active = v_active where id = v_row.id returning * into v_row;
  end if;
  perform set_config('app.reason', coalesce(v_prev, ''), true);
  return jsonb_build_object('status', case when v_active then 'Granted' else 'Revoked' end, 'person_id', v_person,
                            'role_code', v_role, 'version', v_row.version, 'external_calls', 0);
end
$$;

-- STAFF_SET_ACTIVE: {payload: {person_id, active, reason}, expected_version:
-- the people row's}. An inactive person is refused by every read and command
-- at once (app.resolve_actor).
create function app.cmd_staff_set_active(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['person_id', 'active', 'reason'], array['person_id', 'active', 'reason']);
  v_person public.people;
  v_active boolean := app.yes_flag(v_p -> 'active');
  v_reason text := app.txt(v_p, 'reason');
  v_prev text := current_setting('app.reason', true);
begin
  select * into v_person from public.people p where p.id = app.ref(v_p, 'person_id') for update;
  if v_person.id is null then
    perform app.fail('R1A_PERSON_NOT_FOUND');
  end if;
  if v_person.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if length(coalesce(v_reason, '')) < 3 then
    perform app.fail('R1A_REQUIRED_REASON');
  end if;
  if not v_active then
    if v_person.id = app.actor_id(p_actor) then
      perform app.fail('STAFF_SELF_LOCKOUT');
    end if;
    if exists (select 1 from public.person_roles r where r.person_id = v_person.id and r.role_code = 'Admin' and r.active) then
      perform app.staff_admin_guard(p_actor, v_person.id, true);
    end if;
  end if;
  if v_person.active = v_active then
    return jsonb_build_object('status', 'Unchanged', 'person_id', v_person.id, 'active', v_active, 'external_calls', 0);
  end if;
  perform set_config('app.reason', v_reason, true);
  update public.people set active = v_active where id = v_person.id returning * into v_person;
  perform set_config('app.reason', coalesce(v_prev, ''), true);
  return jsonb_build_object('status', case when v_active then 'Reactivated' else 'Deactivated' end,
                            'person_id', v_person.id, 'version', v_person.version, 'external_calls', 0);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('STAFF_CREATE', array['Admin', 'Manager'], false, '[]', 'convergence',
   'Add a staff member (name, email, roles). Login by invitation. Only an Admin grants Admin.'),
  ('STAFF_ROLE_SET', array['Admin', 'Manager'], false, '[]', 'convergence',
   'Grant or withdraw one role (reason required). Never your own Admin, never the last Admin.'),
  ('STAFF_SET_ACTIVE', array['Admin', 'Manager'], false, '[]', 'convergence',
   'Deactivate or reactivate a person (reason required). Never yourself, never the last Admin.');

-- STAFF_ADMIN read: people with roles, login state and versions.
create function app.read_staff_admin(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.req_keys(p_request, array[]::text[]);
  return jsonb_build_object(
    'actor_is_admin', app.has_role(p_actor, 'Admin'),
    'roles', (select coalesce(jsonb_agg(r.code order by r.code), '[]'::jsonb) from public.roles r),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_name', p.display_name, 'email', p.email, 'active', p.active, 'version', p.version,
        'has_login', p.auth_user_id is not null,
        'roles', (select coalesce(jsonb_agg(jsonb_build_object('role_code', r.role_code, 'active', r.active,
                                                               'version', r.version) order by r.role_code), '[]'::jsonb)
                  from public.person_roles r where r.person_id = p.id))
      order by p.active desc, p.display_name), '[]'::jsonb) from public.people p));
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('STAFF_ADMIN', array['Admin', 'Manager'], '[]', 'convergence',
   'People & access: every person with roles (active / withdrawn), login state and versions.');

-- -----------------------------------------------------------------------------
-- 5. TASK_REASSIGN
-- -----------------------------------------------------------------------------

-- Request: {task_id, job_id?, expected_version (task), payload: {owner_id, backup_id?, reason}}
-- Office manager (the same people who run the job's work), assigned to the job,
-- FN-01. The new owner must be active and hold a role the template's
-- assignment rule allows (any office role when the template has no rule).
create function app.cmd_task_reassign(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['owner_id', 'backup_id', 'reason'], array['owner_id', 'reason']);
  v_task public.tasks;
  v_after public.tasks;
  v_owner uuid := app.ref(v_p, 'owner_id');
  v_backup uuid := app.ref(v_p, 'backup_id');
  v_reason text := app.txt(v_p, 'reason');
  v_roles text[];
  v_who uuid;
  v_prev text := current_setting('app.reason', true);
begin
  select * into v_task from public.tasks where id = app.ref(p_request, 'task_id') for update;
  if v_task.id is null then
    perform app.fail('R1A_TASK_NOT_FOUND');
  end if;
  if v_task.job_id is not null then
    perform app.authorize_job(p_actor, v_task.job_id);
  elsif not app.is_admin(p_actor) then
    perform app.fail('R1A_TASK_ACCESS_DENIED');
  end if;
  if v_task.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_task.status in ('Complete', 'NotRequired', 'Cancelled') then
    perform app.fail('TASK_NOT_OPEN');
  end if;
  if length(coalesce(v_reason, '')) < 3 then
    perform app.fail('R1A_REQUIRED_REASON');
  end if;
  select r.eligible_owner_roles into v_roles from public.task_assignment_rules r
  where r.template_code = v_task.template_code and r.active limit 1;
  v_roles := coalesce(v_roles, array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover']);
  foreach v_who in array array_remove(array[v_owner, v_backup], null) loop
    if not exists (select 1 from public.people p where p.id = v_who and p.active
                   and exists (select 1 from public.person_roles r where r.person_id = p.id and r.active
                               and r.role_code = any (v_roles))) then
      perform app.fail('TASK_OWNER_NOT_ELIGIBLE', jsonb_build_object('person_id', v_who));
    end if;
  end loop;
  if v_backup = v_owner then
    v_backup := null;
  end if;
  perform set_config('app.reason', v_reason, true);
  update public.tasks set owner_id = v_owner, backup_id = v_backup where id = v_task.id returning * into v_after;
  perform set_config('app.reason', coalesce(v_prev, ''), true);
  perform app.task_event(v_task, v_after, 'Reassign', v_reason);
  return jsonb_build_object('status', 'Reassigned', 'task', to_jsonb(v_after), 'external_calls', 0);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('TASK_REASSIGN', array['Admin', 'Manager', 'Office'], false, '[{"function_id": "FN-01", "mode": "Automated"}]',
   'convergence', 'Move an open task to another eligible person (reason required); assignment to the job checked in the handler.');

-- TASK_REASSIGN_CANDIDATES read: {task_id} -> the active people who may own
-- the task (the template rule's eligible roles, else the office roles), with
-- whether the actor may reassign it right now.
create function app.read_task_reassign_candidates(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_roles text[];
begin
  perform app.req_keys(p_request, array['task_id']);
  select * into v_task from public.tasks t where t.id = app.ref(p_request, 'task_id');
  if v_task.id is null then
    perform app.fail('R1A_TASK_NOT_FOUND');
  end if;
  if v_task.job_id is not null then
    perform app.read_authorize_job(p_actor, v_task.job_id::text);
  elsif not app.is_admin(p_actor) then
    perform app.fail('R1A_TASK_ACCESS_DENIED');
  end if;
  select r.eligible_owner_roles into v_roles from public.task_assignment_rules r
  where r.template_code = v_task.template_code and r.active limit 1;
  v_roles := coalesce(v_roles, array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover']);
  return jsonb_build_object(
    'task_id', v_task.id, 'version', v_task.version, 'owner_id', v_task.owner_id, 'backup_id', v_task.backup_id,
    'available', app.r1x_flag(app.is_office_manager(p_actor),
                              v_task.job_id is null or app.is_assigned(p_actor, v_task.job_id),
                              app.mode_available('FN-01', 'Automated'),
                              v_task.status not in ('Complete', 'NotRequired', 'Cancelled'), 'TASK_NOT_OPEN'),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name), '[]'::jsonb)
               from public.people p
               where p.active and exists (select 1 from public.person_roles r where r.person_id = p.id and r.active
                                          and r.role_code = any (v_roles))));
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('TASK_REASSIGN_CANDIDATES', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'convergence',
   'Who may own a task (eligible roles of its assignment rule) and whether the actor may reassign it.');

-- -----------------------------------------------------------------------------
-- 6. search_evidence: the Files library
-- -----------------------------------------------------------------------------

-- Request: {q?, category?, job_id?, from?, to?, limit?, offset?}. Only files
-- the actor may read (app.can_read_evidence) and that have arrived. Never
-- returns a storage path; files open through /api/evidence/<id>.
create function public.search_evidence(p_request jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_key text;
  v_q text := nullif(btrim(coalesce(p_request ->> 'q', '')), '');
  v_category text := nullif(btrim(coalesce(p_request ->> 'category', '')), '');
  v_job uuid;
  v_from date;
  v_to date;
  v_limit int;
  v_offset int;
  v_rows jsonb;
  v_total int;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('q', 'category', 'job_id', 'from', 'to', 'limit', 'offset') then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', v_key));
    end if;
  end loop;
  if coalesce(p_request ->> 'job_id', '') <> '' then
    if p_request ->> 'job_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'job_id'));
    end if;
    v_job := (p_request ->> 'job_id')::uuid;
  end if;
  begin
    v_from := nullif(p_request ->> 'from', '')::date;
    v_to := nullif(p_request ->> 'to', '')::date;
    v_limit := least(greatest(coalesce(nullif(p_request ->> 'limit', '')::int, 50), 1), 200);
    v_offset := greatest(coalesce(nullif(p_request ->> 'offset', '')::int, 0), 0);
  exception when others then
    perform app.fail('R1A_INVALID_FIELDS');
  end;

  with hits as (
    select e.*, j.job_ref, j.workflow_stage, c.first_name, c.last_name, c.postcode
    from public.evidence e
    join public.jobs j on j.id = e.job_id
    left join public.customers c on c.id = j.customer_id
    where e.upload_status = 'Uploaded'
      and app.can_read_evidence(v_actor, e)
      and (v_job is null or e.job_id = v_job)
      and (v_category is null or e.category = v_category)
      and (v_from is null or coalesce(e.received_at, e.created_at) >= v_from::timestamptz)
      and (v_to is null or coalesce(e.received_at, e.created_at) < (v_to + 1)::timestamptz)
      and (v_q is null or j.job_ref ilike '%' || v_q || '%'
           or coalesce(e.original_filename, e.filename) ilike '%' || v_q || '%'
           or c.postcode ilike '%' || v_q || '%'
           or concat_ws(' ', c.first_name, c.last_name) ilike '%' || v_q || '%')
  )
  select (select count(*) from hits),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'id', h.id, 'job_id', h.job_id, 'job_ref', h.job_ref, 'workflow_stage', h.workflow_stage,
             'customer_name', nullif(btrim(concat_ws(' ', h.first_name, h.last_name)), ''), 'postcode', h.postcode,
             'category', h.category, 'filename', coalesce(h.original_filename, h.filename), 'mime_type', h.mime_type,
             'size_bytes', h.size_bytes, 'added_at', coalesce(h.received_at, h.created_at),
             'added_by_name', app.s17_person_name(coalesce(h.uploaded_by, h.captured_by)),
             'task_id', h.task_id, 'task_title', (select t.title from public.tasks t where t.id = h.task_id),
             'issue_id', h.issue_id, 'submission_id', h.submission_id, 'work_package_id', h.work_package_id,
             'context_type', h.context_type)
           order by coalesce(h.received_at, h.created_at) desc, h.id), '[]'::jsonb)
          from (select * from hits order by coalesce(received_at, created_at) desc, id limit v_limit offset v_offset) h)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'files', v_rows);
end
$$;

revoke execute on function public.search_evidence(jsonb) from public, anon;
grant execute on function public.search_evidence(jsonb) to authenticated, service_role;

create index if not exists evidence_received_idx on public.evidence (coalesce(received_at, created_at) desc);

-- -----------------------------------------------------------------------------
-- Staff wording for the new refusals
-- -----------------------------------------------------------------------------

alter function app.result_error_catalogue() rename to result_error_catalogue_pre_convergence;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_convergence() || '{
  "RELEASE_FUNCTION_UNKNOWN": ["Failed", "That release function does not exist."],
  "RELEASE_REASON_REQUIRED": ["ActionRequired", "Say why this function is being switched (at least a few words)."],
  "RELEASE_MODE_NOT_PLANNED": ["Failed", "A function can only be switched off or to its planned mode."],
  "RELEASE_DEPENDENCY_DISABLED": ["ActionRequired", "Switch on the function this one depends on first (office core FN-01)."],
  "RELEASE_DEPENDANT_ENABLED": ["ActionRequired", "Other switched-on functions depend on this one. Switch them off first."],
  "STAFF_EMAIL_EXISTS": ["Failed", "Someone with that email address already exists."],
  "STAFF_ROLE_UNKNOWN": ["Failed", "That role does not exist."],
  "STAFF_ADMIN_GRANT_DENIED": ["Failed", "Only an Admin can give or remove the Admin role."],
  "STAFF_SELF_LOCKOUT": ["Failed", "You cannot remove your own administrator access."],
  "STAFF_LAST_ADMIN": ["Failed", "There must always be at least one active Admin."],
  "TASK_NOT_OPEN": ["Failed", "Only an open task can be reassigned."],
  "TASK_OWNER_NOT_ELIGIBLE": ["ActionRequired", "That person cannot own this task. Choose someone active with the right role."]
}'::jsonb
$$;

grant execute on function app.result_error_catalogue(), app.result_error_catalogue_pre_convergence()
  to authenticated, service_role;
