-- =============================================================================
-- View port: read models for the Next.js operational screens.
--
-- 1. Read visibility follows the canonical permission model (decision of
--    2026-09-19): a person whose roles grant job.read.all (role_permissions)
--    reads every job; job.read.own adds jobs they sold or submitted;
--    otherwise the reference assignment rule applies (owner/backup of a task,
--    issue owner/responsible, salesperson). task.read.all opens the team task
--    views. COMMANDS ARE UNCHANGED: acting on a job still needs the reference
--    assignment (app.authorize_job / app.is_assigned).
--    Replaces the read guard (app.read_authorize_job) and the job search so
--    execute_read agrees with the canonical RLS on jobs/tasks.
--
-- 2. New reads (app.read_registry, served by public.execute_operations_read):
--      TASKS            filterable task list (my / team, status, due window,
--                       queue, owner, job, text) - My Tasks, Team Tasks,
--                       History and the operational queues. The AppSheet My
--                       Tasks view lists every open task the person owns or
--                       backs up; MY_TASKS only returned the Office Home lists.
--      TASK_DETAIL      one task with history and available actions
--      JOBS             job search / browse with next action
--      OFFICE_DASHBOARD counts for the Office Home cards
--      MY_REQUESTS      the person's own commands (the commands ledger) with
--                       their staff-facing result - the genuine successor of
--                       the AppSheet "My Requests" request-row view
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Visibility
-- -----------------------------------------------------------------------------

create function app.actor_has_permission(p_actor jsonb, p_permission text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_permissions rp
    join public.roles r on r.code = rp.role_code and r.active
    where rp.permission_code = p_permission
      and rp.role_code in (select jsonb_array_elements_text(p_actor -> 'roles')))
$$;

create function app.can_read_job(p_actor jsonb, p_job_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_job_id is not null and (
       app.actor_has_permission(p_actor, 'job.read.all')
    or (app.actor_has_permission(p_actor, 'job.read.own')
        and exists (select 1 from public.jobs j where j.id = p_job_id
                    and app.actor_id(p_actor) in (j.salesperson_id, j.created_by)))
    or app.is_assigned(p_actor, p_job_id))
$$;

create function app.can_read_team_tasks(p_actor jsonb)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.actor_has_permission(p_actor, 'task.read.all') or app.is_office_manager(p_actor) $$;

-- Read guard (was: reference assignment only).
create or replace function app.read_authorize_job(p_actor jsonb, p_job_ref text)
returns public.jobs
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_id uuid := app.read_job_id(p_job_ref);
begin
  select * into v_job from public.jobs where id = v_id;
  if v_job.id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.job_in_scope(v_job) then
    perform app.fail('R1A_OUTSIDE_PILOT');
  end if;
  if not app.can_read_job(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  return v_job;
end
$$;

-- JOB_SEARCH with the canonical visibility (body otherwise unchanged).
create or replace function app.read_job_search(p_actor jsonb, p_query text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(p_query));
  v_qc text := regexp_replace(lower(btrim(p_query)), '\s+', '', 'g');
  v_results jsonb;
begin
  select coalesce(jsonb_agg(r.row order by r.job_ref), '[]'::jsonb) into v_results
  from (
    select j.job_ref as job_ref, jsonb_build_object(
             'id', j.id, 'job_ref', j.job_ref, 'display_name', j.display_name,
             'customer_name', coalesce(app.s17_customer_name(c.first_name, c.last_name), ''),
             'postcode', c.postcode, 'quote_reference', j.quote_reference,
             'address_line1', nullif(app.s17_clean(c.address_line1), ''), 'town', nullif(app.s17_clean(c.town), ''),
             'job_label', app.s17_job_label(j.job_ref, c.last_name, c.postcode),
             'workflow_stage', j.workflow_stage) as row
    from public.jobs j
    left join public.customers c on c.id = j.customer_id
    where exists (
            select 1
            from unnest(array[j.job_ref, j.quote_reference, j.display_name,
                              app.s17_customer_name(c.first_name, c.last_name), c.first_name, c.last_name,
                              c.postcode, c.address_line1, c.address_line2, c.town, c.email, c.phone,
                              j.id::text]) as f(v)
            where app.s17_clean(f.v) <> ''
              and (strpos(lower(app.s17_clean(f.v)), v_q) > 0
                   or (length(v_qc) >= 2
                       and strpos(regexp_replace(lower(app.s17_clean(f.v)), '\s+', '', 'g'), v_qc) > 0)))
      and app.job_in_scope(j)
      and app.can_read_job(p_actor, j.id)
    order by j.job_ref
    limit 50
  ) r;
  return jsonb_build_object('query', btrim(p_query), 'count', jsonb_array_length(v_results), 'results', v_results);
end
$$;

-- -----------------------------------------------------------------------------
-- Request helpers
-- -----------------------------------------------------------------------------

create function app.req_text(p_request jsonb, p_key text)
returns text
language sql immutable
set search_path = ''
as $$ select nullif(btrim(coalesce(p_request ->> p_key, '')), '') $$;

create function app.req_uuid(p_request jsonb, p_key text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := app.req_text(p_request, p_key);
begin
  if v is null then
    return null;
  end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', p_key));
  end if;
  return v::uuid;
end
$$;

create function app.req_limit(p_request jsonb, p_default int, p_max int)
returns int
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := app.req_text(p_request, 'limit');
begin
  if v is null then
    return p_default;
  end if;
  if v !~ '^[0-9]{1,5}$' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'limit'));
  end if;
  return least(greatest(v::int, 1), p_max);
end
$$;

create function app.req_keys(p_request jsonb, p_allowed text[])
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_request) loop
    if not v_key = any (p_allowed || array['read_type']) then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', v_key));
    end if;
  end loop;
end
$$;

-- Queues for the task list: the S17 R1 queues plus the R2-R4 work groups.
create function app.task_in_queue(p_queue text, p_task public.tasks)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_queue
    when 'materials' then p_task.task_group = 'Materials' or p_task.template_code like 'MAT0%'
    when 'scaffold' then p_task.task_group = 'Scaffold' or p_task.template_code like 'SCA0%'
    when 'install' then p_task.task_group = 'Install'
    when 'system' then p_task.task_group = 'System'
    else app.s17_in_queue(p_queue, p_task)
  end
$$;

-- -----------------------------------------------------------------------------
-- TASKS
-- -----------------------------------------------------------------------------

create function app.read_tasks(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_scope text := coalesce(app.req_text(p_request, 'scope'), 'my');
  v_status text := coalesce(app.req_text(p_request, 'status'), 'open');
  v_due text := coalesce(app.req_text(p_request, 'due'), 'any');
  v_queue text := app.req_text(p_request, 'queue');
  v_owner uuid := app.req_uuid(p_request, 'owner_id');
  v_job uuid := app.read_job_id(app.req_text(p_request, 'job_id'));
  v_query text := app.req_text(p_request, 'q');
  v_limit int := app.req_limit(p_request, 200, 500);
  v_as_of date := coalesce(app.read_date(app.req_text(p_request, 'as_of'), 'S17_DATE_INVALID'), app.london_date(now()));
  v_team_ok boolean := app.can_read_team_tasks(p_actor);
  v_rows jsonb;
  v_total int;
begin
  perform app.req_keys(p_request, array['scope', 'status', 'due', 'queue', 'owner_id', 'job_id', 'q', 'limit', 'as_of']);
  if v_scope not in ('my', 'team', 'all') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'scope'));
  end if;
  if v_status not in ('open', 'closed', 'all') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'status'));
  end if;
  if v_due not in ('any', 'overdue', 'today', 'soon', 'later', 'none', 'dated') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'due'));
  end if;
  if v_queue is not null and v_queue not in ('booking', 'calls', 'issues', 'payments', 'ghl', 'cancellation',
                                             'materials', 'scaffold', 'install', 'system') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'queue'));
  end if;
  -- team / all: everyone's tasks, only with team visibility (hidden nav is not security).
  if v_scope in ('team', 'all') and not v_team_ok then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  if v_job is not null and not app.can_read_job(p_actor, v_job) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;

  with base as (
    select t.*
    from public.tasks t
    where (v_status = 'all'
           or (v_status = 'open' and t.status not in ('Complete', 'Cancelled', 'NotRequired'))
           or (v_status = 'closed' and t.status in ('Complete', 'Cancelled', 'NotRequired')))
      and case v_scope
            when 'my' then app.actor_id(p_actor) in (t.owner_id, coalesce(t.backup_id, t.owner_id))
            when 'team' then app.actor_id(p_actor) not in (t.owner_id, coalesce(t.backup_id, t.owner_id))
            else true end
      and (v_owner is null or v_owner in (t.owner_id, coalesce(t.backup_id, t.owner_id)))
      and (v_job is null or t.job_id = v_job)
      and (v_queue is null or app.task_in_queue(v_queue, t))
      and (t.job_id is null or app.job_in_scope((select j from public.jobs j where j.id = t.job_id)))
      and case v_due
            when 'any' then true
            when 'none' then t.due_at is null
            when 'dated' then t.due_at is not null
            when 'overdue' then t.due_at is not null and app.london_date(t.due_at) < v_as_of
            when 'today' then t.due_at is not null and app.london_date(t.due_at) = v_as_of
            when 'soon' then t.due_at is not null and app.london_date(t.due_at) > v_as_of
                             and app.london_date(t.due_at) <= v_as_of + 7
            else t.due_at is not null and app.london_date(t.due_at) > v_as_of + 7 end
  ), views as (
    select b.priority, b.due_at, b.completed_at, b.created_at, b.id,
           (case when b.job_id is not null and not app.can_read_job(p_actor, b.job_id)
                 then app.s17_redact(app.s17_task_view(b, v_as_of))
                 else app.s17_task_view(b, v_as_of) end)
           || jsonb_build_object('completed_at', b.completed_at,
                                 'completed_by_name', app.s17_person_name(b.completed_by),
                                 'next_followup_at', b.next_followup_at) as v
    from base b
  ), matched as (
    select * from views where app.task_query_match(v ->> 'search_text', v_query)
  )
  select (select count(*) from matched),
         coalesce((select jsonb_agg(v order by
                     case when v_status = 'closed' then null else (v ->> 'due_class') = 'OVERDUE' end desc nulls last,
                     case when v_status = 'closed' then completed_at end desc nulls last,
                     due_at nulls last, priority, created_at, id)
                   from (select * from matched
                         order by case when v_status = 'closed' then completed_at end desc nulls last,
                                  due_at nulls last, priority, created_at, id
                         limit v_limit) m), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('scope', v_scope, 'status', v_status, 'due', v_due, 'queue', v_queue,
                            'as_of', v_as_of, 'count', jsonb_array_length(v_rows), 'total', v_total,
                            'truncated', v_total > jsonb_array_length(v_rows),
                            'can_view_team', v_team_ok, 'tasks', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- TASK_DETAIL
-- -----------------------------------------------------------------------------

create function app.read_task_detail(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_job public.jobs;
  v_customer public.customers;
  v_today date := app.london_date(now());
begin
  perform app.req_keys(p_request, array['task_id']);
  select * into v_task from public.tasks where id = app.req_uuid(p_request, 'task_id');
  if v_task.id is null then
    perform app.fail('R1A_TASK_NOT_FOUND');
  end if;
  -- Same shape as the adapter's task reads: a job task needs job visibility;
  -- a job-less task is its owner's (or backup's, or an admin's).
  if v_task.job_id is not null then
    v_job := app.read_authorize_job(p_actor, v_task.job_id::text);
    select * into v_customer from public.customers where id = v_job.customer_id;
  elsif app.actor_id(p_actor) not in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))
        and not app.is_admin(p_actor) then
    perform app.fail('R1A_TASK_ACCESS_DENIED');
  end if;

  return jsonb_build_object(
    'task', app.s17_task_view(v_task, v_today) || jsonb_build_object(
      'completion_note', v_task.completion_note, 'completed_at', v_task.completed_at,
      'completed_by_name', app.s17_person_name(v_task.completed_by), 'evidence_id', v_task.evidence_id,
      'next_followup_at', v_task.next_followup_at, 'original_due_at', v_task.original_due_at,
      'revision_required', v_task.revision_required, 'created_at', v_task.created_at,
      'is_mine', app.actor_id(p_actor) in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))),
    'job', case when v_job.id is not null then jsonb_build_object(
      'id', v_job.id, 'job_ref', v_job.job_ref, 'workflow_stage', v_job.workflow_stage, 'version', v_job.version,
      'finance_route', v_job.finance_route,
      'customer_name', app.s17_customer_name(v_customer.first_name, v_customer.last_name),
      'postcode', v_customer.postcode) end,
    'evidence', case when v_task.evidence_id is not null then
      (select jsonb_build_object('id', e.id, 'category', e.category, 'filename', e.filename,
                                 'storage_path', e.storage_path, 'received_at', e.received_at)
       from public.evidence e where e.id = v_task.evidence_id) end,
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', ev.id, 'action', ev.action, 'old_status', ev.old_status, 'new_status', ev.new_status,
                 'old_owner_name', app.s17_person_name(ev.old_owner), 'new_owner_name', app.s17_person_name(ev.new_owner),
                 'old_due', ev.old_due, 'new_due', ev.new_due, 'reason', ev.reason,
                 'actor_name', coalesce(app.s17_person_name(ev.actor), 'System'), 'occurred_at', ev.occurred_at)
                 order by ev.occurred_at desc, ev.created_at desc), '[]'::jsonb)
               from public.task_events ev where ev.task_id = v_task.id),
    'availability', app.read_task_action_availability(p_actor, v_task));
end
$$;

-- -----------------------------------------------------------------------------
-- JOBS
-- -----------------------------------------------------------------------------

create function app.read_jobs(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_query text := app.req_text(p_request, 'q');
  v_q text := lower(coalesce(app.req_text(p_request, 'q'), ''));
  v_qc text := regexp_replace(lower(coalesce(app.req_text(p_request, 'q'), '')), '\s+', '', 'g');
  v_stages text[];
  v_limit int := app.req_limit(p_request, 100, 300);
  v_today date := app.london_date(now());
  v_rows jsonb;
  v_total int;
begin
  perform app.req_keys(p_request, array['q', 'stage', 'limit']);
  if app.req_text(p_request, 'stage') is not null then
    v_stages := string_to_array(app.req_text(p_request, 'stage'), ',');
    if exists (select 1 from unnest(v_stages) s
               where s not in ('Prebooking', 'ReadyToBook', 'BookingInProgress', 'Booked', 'AwaitingInstallation',
                               'InProgress', 'Aftercare', 'OperationallyComplete', 'CancellationInProgress',
                               'Cancelled')) then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'stage'));
    end if;
  end if;

  with visible as (
    select j.*, c.first_name, c.last_name, c.postcode, c.town, c.address_line1, c.phone, c.email
    from public.jobs j
    left join public.customers c on c.id = j.customer_id
    where app.job_in_scope(j)
      and app.can_read_job(p_actor, j.id)
      and (v_stages is null or j.workflow_stage = any (v_stages))
      and (v_query is null or exists (
            select 1
            from unnest(array[j.job_ref, j.quote_reference, j.display_name,
                              app.s17_customer_name(c.first_name, c.last_name), c.postcode, c.address_line1,
                              c.town, c.email, c.phone]) as f(v)
            where app.s17_clean(f.v) <> ''
              and (strpos(lower(app.s17_clean(f.v)), v_q) > 0
                   or (length(v_qc) >= 2
                       and strpos(regexp_replace(lower(app.s17_clean(f.v)), '\s+', '', 'g'), v_qc) > 0))))
  ), rows as (
    select v.sold_at, v.job_ref, jsonb_build_object(
      'id', v.id, 'job_ref', v.job_ref, 'display_name', v.display_name,
      'customer_name', app.s17_customer_name(v.first_name, v.last_name), 'postcode', v.postcode,
      'town', nullif(app.s17_clean(v.town), ''), 'quote_reference', v.quote_reference,
      'workflow_stage', v.workflow_stage, 'finance_route', v.finance_route, 'sold_at', v.sold_at,
      'salesperson_name', app.s17_person_name(v.salesperson_id), 'next_action_at', v.next_action_at,
      'booking_approved_at', v.booking_approved_at,
      'open_tasks', (select count(*) from public.tasks t where t.job_id = v.id
                     and t.status not in ('Complete', 'Cancelled', 'NotRequired')),
      'overdue_tasks', (select count(*) from public.tasks t where t.job_id = v.id
                        and t.status not in ('Complete', 'Cancelled', 'NotRequired')
                        and t.due_at is not null and app.london_date(t.due_at) < v_today),
      'next_task', (select jsonb_build_object('id', t.id, 'title', t.title, 'due_at', t.due_at,
                                              'owner_name', app.s17_person_name(t.owner_id), 'status', t.status)
                    from public.tasks t where t.job_id = v.id
                      and t.status not in ('Complete', 'Cancelled', 'NotRequired')
                    order by t.due_at nulls last, t.priority, t.created_at limit 1)) as row
    from visible v
  )
  select (select count(*) from rows),
         coalesce((select jsonb_agg(row) from (select row from rows order by sold_at desc nulls last, job_ref
                                               limit v_limit) x), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('q', v_query, 'stage', v_stages, 'count', jsonb_array_length(v_rows), 'total', v_total,
                            'truncated', v_total > jsonb_array_length(v_rows), 'jobs', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- OFFICE_DASHBOARD
-- -----------------------------------------------------------------------------

create function app.read_office_dashboard(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := app.london_date(now());
  v_me uuid := app.actor_id(p_actor);
  v_team boolean := app.can_read_team_tasks(p_actor);
  v_mine jsonb;
  v_stages jsonb;
  v_ops jsonb;
begin
  perform app.req_keys(p_request, array[]::text[]);

  select jsonb_build_object(
      'open', count(*),
      'overdue', count(*) filter (where t.due_at is not null and app.london_date(t.due_at) < v_today),
      'due_today', count(*) filter (where t.due_at is not null and app.london_date(t.due_at) = v_today),
      'due_soon', count(*) filter (where t.due_at is not null and app.london_date(t.due_at) > v_today
                                   and app.london_date(t.due_at) <= v_today + 7),
      'waiting', count(*) filter (where t.status = 'Waiting'),
      'booking', count(*) filter (where app.s17_in_queue('booking', t)))
    into v_mine
  from public.tasks t
  where t.status not in ('Complete', 'Cancelled', 'NotRequired')
    and v_me in (t.owner_id, coalesce(t.backup_id, t.owner_id));

  select coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) into v_stages
  from (select j.workflow_stage as stage, count(*) as n
        from public.jobs j where app.can_read_job(p_actor, j.id) group by j.workflow_stage) s;

  v_ops := jsonb_build_object(
    'team_overdue', case when v_team then
      (select count(*) from public.tasks t where t.status not in ('Complete', 'Cancelled', 'NotRequired')
         and t.due_at is not null and app.london_date(t.due_at) < v_today) end,
    'booking_queue', case when v_team then
      (select count(*) from public.tasks t where t.status not in ('Complete', 'Cancelled', 'NotRequired')
         and app.s17_in_queue('booking', t)) end,
    'intake_review', case when app.is_office_manager(p_actor) then
      (select count(*) from public.intake i where i.processing_status = 'Review') end,
    'commissioning_review',
      (select count(*) from public.commissioning_submissions s
       where s.status in ('Submitted', 'UnderReview') and app.can_read_job(p_actor, s.job_id)),
    'open_issues',
      (select count(*) from public.issues i
       where i.status not in ('Resolved', 'Closed') and app.can_read_job(p_actor, i.job_id)),
    'blocking_issues',
      (select count(*) from public.issues i
       where i.status not in ('Resolved', 'Closed') and i.blocks_completion and app.can_read_job(p_actor, i.job_id)),
    'draft_orders',
      (select count(*) from public.orders o where o.status in ('Draft', 'Review') and app.can_read_job(p_actor, o.job_id)),
    'installs_next_14_days',
      (select count(*) from public.work_packages w
       where w.status not in ('Cancelled', 'ConfirmedComplete') and w.planned_start between v_today and v_today + 14
         and app.can_read_job(p_actor, w.job_id)),
    'unallocated_next_14_days',
      (select count(*) from public.work_packages w
       where w.status not in ('Cancelled', 'ConfirmedComplete') and w.planned_start between v_today and v_today + 14
         and app.can_read_job(p_actor, w.job_id)
         and not exists (select 1 from public.allocations a where a.work_package_id = w.id and a.active)),
    'outbox_needs_review', case when app.is_admin(p_actor) or app.is_office_manager(p_actor) then
      (select count(*) from public.outbox o where o.status in ('NeedsReview', 'RetryDue')) end);

  return jsonb_build_object('as_of', v_today, 'my_tasks', v_mine, 'jobs_by_stage', v_stages,
                            'operations', v_ops, 'can_view_team', v_team,
                            'can_review_intake', app.is_office_manager(p_actor));
end
$$;

-- -----------------------------------------------------------------------------
-- MY_REQUESTS
-- -----------------------------------------------------------------------------

create function app.read_my_requests(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_limit int := app.req_limit(p_request, 100, 300);
  v_type text := app.req_text(p_request, 'command_type');
  v_rows jsonb;
begin
  perform app.req_keys(p_request, array['limit', 'command_type']);
  select coalesce(jsonb_agg(x.row order by x.created_at desc), '[]'::jsonb) into v_rows
  from (
    select c.created_at, jsonb_build_object(
      'command_id', c.command_id, 'command_type', c.command_type, 'created_at', c.created_at,
      'job_id', coalesce(c.result ->> 'job_id', c.result #>> '{task,job_id}', c.result #>> '{job,id}'),
      'job_ref', coalesce(c.result ->> 'job_ref', c.result #>> '{job,job_ref}',
                          (select j.job_ref from public.jobs j
                           where j.id::text = coalesce(c.result ->> 'job_id', c.result #>> '{task,job_id}'))),
      -- Staff wording for the stored result (SOLD_INTAKE rows come from submit_presale).
      'outcome', public.describe_command_result(case when c.command_type = 'SOLD_INTAKE' then 'SUBMIT_PRESALE'
                                                     else c.command_type end, c.result)) as row
    from public.commands c
    where c.actor_person_id = app.actor_id(p_actor)
      and (v_type is null or c.command_type = v_type)
    order by c.created_at desc
    limit v_limit
  ) x;
  return jsonb_build_object('count', jsonb_array_length(v_rows), 'requests', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('TASKS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance', 'Store',
                  'Installer', 'Scaffolder', 'ReadOnly'], '[]', 'view-port',
   'Task list: my / team (task.read.all or office manager), status, due window, queue, owner, job, text.'),
  ('TASK_DETAIL', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance', 'Store',
                        'Installer', 'Scaffolder', 'ReadOnly'], '[]', 'view-port',
   'One task with history and available actions.'),
  ('JOBS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance'], '[]', 'view-port',
   'Job search / browse with next action; canonical job visibility.'),
  ('OFFICE_DASHBOARD', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance',
                             'Store', 'Installer', 'Scaffolder', 'ReadOnly'], '[]', 'view-port',
   'Office Home counts; each count scoped by the actor''s visibility.'),
  ('MY_REQUESTS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance', 'Store',
                        'Installer', 'Scaffolder', 'ReadOnly'], '[]', 'view-port',
   'The actor''s own commands and their staff-facing outcome.');


-- -----------------------------------------------------------------------------
-- Reading is not acting: availability for readers who are not assigned
-- -----------------------------------------------------------------------------

-- With canonical read visibility a person can open a job they are not
-- assigned to, but every command still requires the reference assignment
-- (app.authorize_job). The availability mirrors therefore mark each
-- otherwise-available command unavailable with reason NOT_ASSIGNED, so the UI
-- never offers an action the server will refuse.
create function app.availability_for_reader(p_flags jsonb, p_assigned boolean)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_out jsonb := p_flags;
  v_key text;
begin
  if p_assigned or p_flags is null or jsonb_typeof(p_flags -> 'commands') <> 'object' then
    return p_flags || jsonb_build_object('assigned', coalesce(p_assigned, true));
  end if;
  for v_key in select jsonb_object_keys(p_flags -> 'commands') loop
    if coalesce((p_flags #>> array['commands', v_key, 'available'])::boolean, false) then
      v_out := jsonb_set(v_out, array['commands', v_key],
                         ((p_flags #> array['commands', v_key]) - 'prefill')
                         || jsonb_build_object('available', false, 'reason', 'NOT_ASSIGNED'));
    end if;
  end loop;
  return v_out || jsonb_build_object('assigned', false);
end
$$;

alter function app.read_action_availability(jsonb, public.jobs) rename to read_action_availability_base;

create function app.read_action_availability(p_actor jsonb, p_job public.jobs)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select app.availability_for_reader(app.read_action_availability_base(p_actor, p_job),
                                     app.is_assigned(p_actor, p_job.id))
$$;

alter function app.read_task_action_availability(jsonb, public.tasks) rename to read_task_action_availability_base;

create function app.read_task_action_availability(p_actor jsonb, p_task public.tasks)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select app.availability_for_reader(app.read_task_action_availability_base(p_actor, p_task),
                                     p_task.job_id is null or app.is_assigned(p_actor, p_task.job_id))
$$;

-- TEAM_TASKS redaction follows read visibility: customer identity is withheld
-- only for jobs the person cannot open (reference adapter.js:71-72 intent).
create or replace function app.read_task_list(p_actor jsonb, p_as_of date, p_team boolean, p_query text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_tasks jsonb;
begin
  with firsts as (
    select (x.task).id as id, min(x.ord) as ord
    from app.s17_open_task_lists(p_as_of) x
    where case when p_team then app.task_job_in_scope((x.task).job_id) else app.actor_task(p_actor, x.task) end
    group by (x.task).id
  ), views as (
    select f.ord, t.due_at, t.created_at, t.id,
           case when p_team and t.job_id is not null and not app.can_read_job(p_actor, t.job_id)
                then app.s17_redact(app.s17_task_view(t, p_as_of))
                else app.s17_task_view(t, p_as_of) end as v
    from firsts f join public.tasks t on t.id = f.id
  )
  select coalesce(jsonb_agg(v order by ord, due_at nulls last, created_at, id), '[]'::jsonb) into v_tasks
  from views
  where app.task_query_match(v ->> 'search_text', p_query);
  return jsonb_build_object('scope', case when p_team then 'team' else 'my' end, 'as_of', p_as_of,
                            'count', jsonb_array_length(v_tasks), 'tasks', v_tasks);
end
$$;
