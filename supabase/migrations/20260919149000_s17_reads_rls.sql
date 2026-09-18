-- =============================================================================
-- Backend port: the read side.
--
--   * public.execute_read(request)   - the adapter's read boundary
--     (r1-appsheet/adapter.js read()) over the S17 admin/office read models
--     (s17/admin.js), the S11 planner (s11/planner.js _s11BuildPlanner) and
--     the server-computed action availability mirror (adapter.js:109-131).
--   * app.due_window(due_at, as_of)  - s05/priority.js classifyTaskDue.
--   * public.describe_command_error / public.describe_command_result - the
--     staff-facing result catalogue (r1-appsheet/command-result.js), so the
--     UI never decides wording.
--   * Row-level security for direct reads of the port's (non-canonical)
--     tables, and direct writes to their configuration tables only (every
--     operational write goes through public.execute_command). The canonical
--     identity / Job Sold tables keep their own policies and grants.
--
-- Every read is read-only: nothing here writes.
--
-- Not ported (platform plumbing): DEV sheet/environment guards, IDENTITY_PROBE
-- session/effective-user diagnostics (replaced by WHO_AM_I), AppSheet form
-- view / request-table names and LINKTOFORM prefill expressions, the
-- UploadPending status and request-row result write-back.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Dates and due windows (Europe/London)
-- -----------------------------------------------------------------------------

-- A YYYY-MM-DD (optionally followed by a time) text as a real calendar date;
-- blank -> null; anything else -> p_code (S17_DATE_INVALID / S11_DATE_INVALID).
create function app.read_date(p_value text, p_code text)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_value, '')), '');
  v_iso text;
begin
  if v_text is null then
    return null;
  end if;
  v_iso := substring(v_text from '^([0-9]{4}-[0-9]{2}-[0-9]{2})(?:$|T| )');
  if v_iso is null then
    perform app.fail(p_code);
  end if;
  begin
    return v_iso::date;
  exception when others then
    perform app.fail(p_code);
  end;
end
$$;

-- Due-window class of a task (s05/priority.js classifyTaskDue):
-- OVERDUE | DUE_TODAY | DUE_TOMORROW | NEXT_7_DAYS | NORMAL_LATER | NO_DUE.
-- Dates are Europe/London; as_of defaults to today in London.
create function app.due_window(p_due_at timestamptz, p_as_of date default null)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_today date := coalesce(p_as_of, app.london_date(now()));
  v_due date;
  v_delta int;
begin
  if p_due_at is null then
    return jsonb_build_object('class', 'NO_DUE', 'label', 'No due date', 'days_delta', null,
                              'due_at', null, 'as_of', v_today);
  end if;
  v_due := app.london_date(p_due_at);
  v_delta := v_due - v_today;
  return jsonb_build_object(
    'class', case when v_delta < 0 then 'OVERDUE' when v_delta = 0 then 'DUE_TODAY' when v_delta = 1 then 'DUE_TOMORROW'
                  when v_delta <= 7 then 'NEXT_7_DAYS' else 'NORMAL_LATER' end,
    'label', case when v_delta < 0 then 'OVERDUE (' || -v_delta || ' day' || case when v_delta = -1 then '' else 's' end || ' late)'
                  when v_delta = 0 then 'DUE TODAY' when v_delta = 1 then 'DUE TOMORROW'
                  when v_delta <= 7 then 'NEXT 7 DAYS' else 'NORMAL/LATER' end,
    'days_delta', v_delta, 'due_at', v_due, 'as_of', v_today);
end
$$;

-- -----------------------------------------------------------------------------
-- Staff-facing presentation (s17/admin.js:122-212). Adds human fields derived
-- from Jobs / Customers / People; never copies them onto tasks.
-- -----------------------------------------------------------------------------

create function app.s17_clean(p_value text)
returns text
language sql immutable
set search_path = ''
as $$ select case when p_value is null or btrim(p_value) = 'NOT_CONFIGURED' then '' else btrim(p_value) end $$;

create function app.s17_customer_name(p_first text, p_last text)
returns text
language sql immutable
set search_path = ''
as $$ select nullif(concat_ws(' ', nullif(app.s17_clean(p_first), ''), nullif(app.s17_clean(p_last), '')), '') $$;

create function app.s17_job_label(p_job_ref text, p_last text, p_postcode text)
returns text
language sql immutable
set search_path = ''
as $$
  select nullif(concat_ws(' – ', nullif(app.s17_clean(p_job_ref), ''), nullif(app.s17_clean(p_last), ''),
                          nullif(app.s17_clean(p_postcode), '')), '')
$$;

create function app.s17_person_name(p_person_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$ select nullif(app.s17_clean(p.display_name), '') from public.people p where p.id = p_person_id $$;

-- Lower-case searchable segments joined by ' | ' (s17/admin.js:155 =
-- adapter.js:69). Matching is per segment.
create function app.s17_search_text(p_row jsonb)
returns text
language sql immutable
set search_path = ''
as $$
  select coalesce(string_agg(lower(app.s17_clean(p_row ->> u.k)), ' | ' order by u.ord)
                    filter (where app.s17_clean(p_row ->> u.k) <> ''), '')
  from unnest(array['job_ref', 'customer_name', 'postcode', 'title', 'owner_name', 'backup_name',
                    'template_code']) with ordinality as u(k, ord)
$$;

-- Blank query = no filter; otherwise a segment contains the query, or (for a
-- query of 2+ characters) contains it with all whitespace removed on both
-- sides, so "tq33hy" matches "tq3 3hy" (adapter.js:70).
create function app.task_query_match(p_search_text text, p_query text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_query, '')), '') is null then true
    else exists (
      select 1
      from unnest(string_to_array(coalesce(p_search_text, ''), ' | ')) as seg
      cross join lateral (select lower(btrim(p_query)) as q,
                                 regexp_replace(lower(btrim(p_query)), '\s+', '', 'g') as qc) x
      where strpos(seg, x.q) > 0
         or (length(x.qc) >= 2 and strpos(regexp_replace(seg, '\s+', '', 'g'), x.qc) > 0))
  end
$$;

-- Task summary + presentation fields (s17/admin.js _s17TaskView/_s17TaskSummary).
-- Deviation: due_class is computed against the read's as_of date; the
-- reference used the wall-clock date even when as_of was supplied.
create function app.s17_task_view(p_task public.tasks, p_as_of date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_customer public.customers;
  v_due jsonb := app.due_window(p_task.due_at, p_as_of);
  v_row jsonb;
begin
  if p_task.job_id is not null then
    select * into v_job from public.jobs where id = p_task.job_id;
    if v_job.customer_id is not null then
      select * into v_customer from public.customers where id = v_job.customer_id;
    end if;
  end if;
  v_row := jsonb_build_object(
    'id', p_task.id, 'job_id', p_task.job_id, 'title', p_task.title, 'group', p_task.task_group,
    'owner_id', p_task.owner_id, 'backup_id', p_task.backup_id, 'due_at', v_due -> 'due_at',
    'status', p_task.status, 'priority', p_task.priority, 'blocking_reason', p_task.blocking_reason,
    'template_code', p_task.template_code, 'related_entity_type', p_task.related_entity_type,
    'related_entity_id', p_task.related_entity_id, 'version', p_task.version,
    'due_class', v_due -> 'class', 'due_class_label', v_due -> 'label', 'days_delta', v_due -> 'days_delta',
    'job_ref', nullif(app.s17_clean(v_job.job_ref), ''),
    'customer_name', app.s17_customer_name(v_customer.first_name, v_customer.last_name),
    'postcode', nullif(app.s17_clean(v_customer.postcode), ''),
    'owner_name', app.s17_person_name(p_task.owner_id),
    'backup_name', app.s17_person_name(p_task.backup_id),
    'job_label', case when v_job.id is not null
                      then app.s17_job_label(v_job.job_ref, v_customer.last_name, v_customer.postcode) end);
  return v_row || jsonb_build_object('search_text', app.s17_search_text(v_row));
end
$$;

-- TEAM_TASKS withholds customer identity for jobs the actor could not open
-- (adapter.js:72).
create function app.s17_redact(p_view jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select v || jsonb_build_object('search_text', app.s17_search_text(v))
  from (select p_view || jsonb_build_object('customer_name', null, 'postcode', null,
                                            'job_label', p_view -> 'job_ref', 'customer_redacted', true) as v) s
$$;

-- -----------------------------------------------------------------------------
-- Read-side access (adapter.js:37-44, 66)
-- -----------------------------------------------------------------------------

-- A job reference from a read request: the internal uuid or the public job id.
create function app.read_job_id(p_value text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select case
    when nullif(btrim(coalesce(p_value, '')), '') is null then null
    when btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then btrim(p_value)::uuid
    else (select j.id from public.jobs j where j.job_ref = upper(btrim(p_value)))
  end
$$;

-- app.authorize_job without the row lock (reads never lock).
create function app.read_authorize_job(p_actor jsonb, p_job_ref text)
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
  if not app.is_assigned(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  return v_job;
end
$$;

-- A job-less task, or a task on a job the pilot scope admits.
create function app.task_job_in_scope(p_job_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_job_id is null
      or exists (select 1 from public.jobs j where j.id = p_job_id and app.job_in_scope(j))
$$;

-- _r1aFilterTasks: owner, backup or admin; job-less or in-scope job.
create function app.actor_task(p_actor jsonb, p_task public.tasks)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (app.actor_id(p_actor) in (p_task.owner_id, coalesce(p_task.backup_id, p_task.owner_id)) or app.is_admin(p_actor))
     and app.task_job_in_scope(p_task.job_id)
$$;

-- -----------------------------------------------------------------------------
-- 1. OFFICE HOME / MY_TASKS / TEAM_TASKS (s17/admin.js:51-120)
-- -----------------------------------------------------------------------------

-- Open tasks per office-home list; a task can be in several lists
-- (e.g. overdue and booking review). ord is the list order used to dedupe.
create function app.s17_open_task_lists(p_as_of date)
returns table (list text, ord int, task public.tasks)
language sql stable security definer
set search_path = ''
as $$
  select l.list, l.ord, t
  from public.tasks t
  cross join lateral (values
    ('overdue', 1, t.due_at is not null and app.london_date(t.due_at) < p_as_of),
    ('due_today', 2, t.due_at is not null and app.london_date(t.due_at) = p_as_of),
    ('due_soon', 3, t.due_at is not null and app.london_date(t.due_at) > p_as_of
                    and app.london_date(t.due_at) <= p_as_of + 7),
    ('booking_review', 4, t.task_group in ('Booking', 'Prebooking'))) as l(list, ord, hit)
  where t.status not in ('Cancelled', 'Complete', 'NotRequired') and l.hit
$$;

create function app.read_office_home(p_actor jsonb, p_as_of date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_out jsonb := jsonb_build_object('as_of', p_as_of, 'generated_at', now());
  v_list text;
  v_items jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_n int;
begin
  foreach v_list in array array['overdue', 'due_today', 'due_soon', 'booking_review'] loop
    select coalesce(jsonb_agg(app.s17_task_view(x.task, p_as_of)
                              order by (x.task).due_at nulls last, (x.task).created_at, (x.task).id), '[]'::jsonb)
      into v_items
    from app.s17_open_task_lists(p_as_of) x
    where x.list = v_list and app.actor_task(p_actor, x.task);
    v_out := v_out || jsonb_build_object(v_list, v_items, v_list || '_count', jsonb_array_length(v_items));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'job_id', i.job_id, 'type', i.type, 'category', i.category, 'description', i.description,
           'severity', i.severity, 'status', i.status, 'raised_at', app.london_date(i.raised_at),
           'office_owner_id', i.office_owner_id, 'blocks_completion', i.blocks_completion,
           'blocks_strip', i.blocks_strip) order by i.raised_at, i.id), '[]'::jsonb)
    into v_items
  from public.issues i
  where i.status not in ('Resolved', 'Closed') and app.is_assigned(p_actor, i.job_id);
  v_out := v_out || jsonb_build_object('unresolved_issues', v_items, 'unresolved_issues_count', jsonb_array_length(v_items));

  select count(*) into v_n from public.commit_journal where state <> 'Committed';
  if v_n > 0 then
    v_alerts := v_alerts || jsonb_build_object('type', 'stalled_commits', 'count', v_n,
                                               'detail', v_n || ' commit(s) not committed');
  end if;
  select count(*) into v_n from public.outbox where status in ('NeedsReview', 'RetryDue');
  if v_n > 0 then
    v_alerts := v_alerts || jsonb_build_object('type', 'uncertain_outbox', 'count', v_n,
                                               'detail', v_n || ' outbox item(s) need review');
  end if;
  return v_out || jsonb_build_object('health_alerts', v_alerts, 'health_alerts_count', jsonb_array_length(v_alerts));
end
$$;

-- MY_TASKS / TEAM_TASKS: the four office-home lists concatenated and
-- deduplicated by id (first list wins), then filtered by the staff query.
create function app.read_task_list(p_actor jsonb, p_as_of date, p_team boolean, p_query text)
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
           case when p_team and t.job_id is not null and not app.is_assigned(p_actor, t.job_id)
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

-- -----------------------------------------------------------------------------
-- 2. JOB OVERVIEW (s17/admin.js:214-363)
-- -----------------------------------------------------------------------------

create function app.read_job_overview(p_job public.jobs)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := app.london_date(now());
  v_booking_tasks jsonb;
  v_cancel_tasks jsonb;
  v_stages jsonb;
begin
  select coalesce(jsonb_agg(app.s17_task_view(t, v_today) order by t.due_at nulls last, t.created_at, t.id), '[]'::jsonb)
    into v_booking_tasks
  from public.tasks t
  where t.job_id = p_job.id and t.task_group in ('Booking', 'Prebooking') and t.status not in ('Cancelled', 'Complete');

  select coalesce(jsonb_agg(app.s17_task_view(t, v_today) order by t.due_at nulls last, t.created_at, t.id), '[]'::jsonb)
    into v_cancel_tasks
  from public.tasks t
  where t.job_id = p_job.id and t.task_group = 'Cancellation' and t.status not in ('Complete', 'NotRequired');

  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', s.id, 'stage', s.stage, 'gross_pence', coalesce(s.gross_pence, 0), 'paid_pence', p.paid,
           'outstanding_pence', coalesce(s.gross_pence, 0) - p.paid, 'due_date', s.due_date, 'status', s.status,
           'xero_invoice_id', s.xero_invoice_id) order by s.due_date nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_stages
  from public.invoice_stages s
  cross join lateral (select coalesce(sum(pay.amount_pence), 0)::bigint as paid
                      from public.payments pay where pay.invoice_stage_id = s.id) p
  where s.job_id = p_job.id;

  return jsonb_build_object(
    'found', true,
    'identity', jsonb_build_object(
      'id', p_job.id, 'job_ref', p_job.job_ref, 'display_name', p_job.display_name, 'customer_id', p_job.customer_id,
      'workflow_stage', p_job.workflow_stage, 'salesperson_id', p_job.salesperson_id,
      'financial_status', p_job.financial_status, 'handover_status', p_job.handover_status, 'version', p_job.version),
    'booking', jsonb_build_object(
      -- The sold document is the Job Sold presale (no jobs.sold_submission_id).
      'presale_id', (select ps.id from public.presales ps where ps.job_id = p_job.id),
      'booking_submission_id', p_job.booking_submission_id,
      'booking_approved_at', app.london_date(p_job.booking_approved_at), 'booking_approved_by', p_job.booking_approved_by,
      'sold_booking_match_status', p_job.sold_booking_match_status,
      'outstanding_tasks', jsonb_array_length(v_booking_tasks), 'tasks', v_booking_tasks),
    'work', jsonb_build_object(
      'roof_required', p_job.roof_required, 'electrical_required', p_job.electrical_required,
      'scaffold_required', p_job.scaffold_required,
      'packages', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', w.id, 'trade', w.trade, 'status', w.status, 'planned_start', w.planned_start,
                     'planned_end', w.planned_end, 'commissioning_required', w.commissioning_required,
                     'actual_start', w.actual_start, 'actual_end', w.actual_end, 'version', w.version)
                     order by w.sequence nulls last, w.created_at, w.id), '[]'::jsonb)
                   from public.work_packages w where w.job_id = p_job.id),
      'allocations', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', a.id, 'work_package_id', a.work_package_id, 'person_id', a.person_id,
                        'person_name', app.s17_person_name(a.person_id), 'role', a.role,
                        'start_at', a.start_at, 'end_at', a.end_at) order by a.start_at nulls last, a.id), '[]'::jsonb)
                      from public.allocations a join public.work_packages w on w.id = a.work_package_id
                      where w.job_id = p_job.id and a.active),
      'calls_count', (select count(*) from public.calls c where c.job_id = p_job.id),
      'unresolved_issues', (select count(*) from public.issues i
                            where i.job_id = p_job.id and i.status not in ('Resolved', 'Closed')),
      'operational_complete_at', app.london_date(p_job.operational_complete_at),
      'customer_happy_at', app.london_date(p_job.customer_happy_at)),
    'materials', jsonb_build_object(
      'materials_count', (select count(*) from public.materials m where m.job_id = p_job.id),
      'required_quantity', (select coalesce(sum(m.required_quantity), 0) from public.materials m where m.job_id = p_job.id),
      'cancelled_quantity', (select coalesce(sum(m.cancelled_quantity), 0) from public.materials m where m.job_id = p_job.id),
      'active_reservations', (select count(*) from public.reservations r join public.materials m on m.id = r.material_id
                              where m.job_id = p_job.id and r.status = 'Active'),
      'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'merchant_id', o.merchant_id,
                                                              'supplier_reference', o.supplier_reference)
                                           order by o.created_at, o.id), '[]'::jsonb)
                 from public.orders o where o.job_id = p_job.id)),
    'scaffold', jsonb_build_object(
      'scaffold_required', p_job.scaffold_required,
      'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', b.id, 'status', b.status, 'erect_planned_at', b.erect_planned_at,
                     'erect_actual_at', b.erect_actual_at, 'strip_actual_at', b.strip_actual_at,
                     'company_id', b.company_id) order by b.created_at, b.id), '[]'::jsonb)
                   from public.scaffold_bookings b where b.job_id = p_job.id)),
    'commissioning', jsonb_build_object(
      'submissions', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', s.id, 'status', s.status, 'submitted_at', app.london_date(s.submitted_at),
                        'reviewed_at', app.london_date(s.reviewed_at), 'installer_id', s.installer_id,
                        'work_package_id', s.work_package_id) order by s.created_at, s.id), '[]'::jsonb)
                      from public.commissioning_submissions s where s.job_id = p_job.id),
      'equipment_count', (select count(*) from public.job_equipment e where e.job_id = p_job.id),
      'needs_review', exists (select 1 from public.commissioning_submissions s
                              where s.job_id = p_job.id and s.status = 'Submitted')),
    'handover', jsonb_build_object(
      'status', p_job.handover_status,
      -- The ported handover table has completeness_status (no status column).
      'records', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'sent_at', app.london_date(h.sent_at),
                                                               'status', h.completeness_status)
                                            order by h.created_at, h.id), '[]'::jsonb)
                  from public.handover h where h.job_id = p_job.id)),
    'finance', jsonb_build_object(
      'original_gross_pence', coalesce(nullif(p_job.original_gross_pence, 0), p_job.current_contract_gross_pence, 0),
      'deposit_confirmed', p_job.deposit_bank_confirmed_at is not null,
      'deposit_confirmed_at', app.london_date(p_job.deposit_bank_confirmed_at),
      'deposit_confirmed_by', p_job.deposit_bank_confirmed_by,
      'finance_route', p_job.finance_route, 'contract_status', p_job.contract_status,
      'stages', v_stages,
      'total_invoiced', (select coalesce(sum((x ->> 'gross_pence')::bigint), 0) from jsonb_array_elements(v_stages) x),
      'total_paid', (select coalesce(sum((x ->> 'paid_pence')::bigint), 0) from jsonb_array_elements(v_stages) x),
      'total_outstanding', (select coalesce(sum((x ->> 'outstanding_pence')::bigint), 0) from jsonb_array_elements(v_stages) x)),
    'crm', jsonb_build_object(
      'ghl_tasks', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', g.id, 'task_id', g.task_id, 'opportunity_id', g.opportunity_id,
                      'target_pipeline_id', g.target_pipeline_id, 'completed_at', app.london_date(g.completed_at))
                      order by g.created_at, g.id), '[]'::jsonb)
                    from public.ghl_tasks g where g.job_id = p_job.id)),
    'cancellation', jsonb_build_object(
      'is_cancelled', p_job.workflow_stage in ('CancellationInProgress', 'Cancelled'),
      'cancellation_at', app.london_date(p_job.cancellation_at), 'cancellation_by', p_job.cancellation_by,
      'cancellation_reason', p_job.cancellation_reason,
      'open_review_tasks', jsonb_array_length(v_cancel_tasks), 'tasks', v_cancel_tasks),
    'archive', jsonb_build_object('archived_at', app.london_date(p_job.archived_at)),
    'system', jsonb_build_object(
      'pending_outbox', (select count(*) from public.outbox o
                         where o.status not in ('Succeeded', 'Cancelled')
                           and o.correlation_id in (p_job.id::text, 'XI-' || p_job.id || '-deposit',
                                                    'XI-' || p_job.id || '-interim', 'XI-' || p_job.id || '-final')),
      'audit_events', (select count(*) from public.audit_events a where a.entity_id = p_job.id::text)));
end
$$;

-- -----------------------------------------------------------------------------
-- 3. JOB SEARCH (s17/admin.js:367-398)
-- -----------------------------------------------------------------------------

-- Deviation: the adapter's pilot/assignment filter is applied before the
-- 50-row display limit (the reference cut to 50 matches first, so an
-- assigned job could be hidden behind unassigned matches).
create function app.read_job_search(p_actor jsonb, p_query text)
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
      and app.is_assigned(p_actor, j.id)
    order by j.job_ref
    limit 50
  ) r;
  return jsonb_build_object('query', btrim(p_query), 'count', jsonb_array_length(v_results), 'results', v_results);
end
$$;

-- -----------------------------------------------------------------------------
-- 4. OPERATIONAL QUEUES (s17/admin.js:402-427; R1 queues adapter.js:7)
-- -----------------------------------------------------------------------------

create function app.s17_in_queue(p_queue text, p_task public.tasks)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_queue
    when 'booking' then p_task.task_group in ('Booking', 'Prebooking')
    -- Deviation (REF-03 §1.1 S17): the reference also matched group 'Calls'
    -- and template CAL01, neither of which exists; call tasks are INS01/INS04.
    when 'calls' then p_task.template_code in ('INS01', 'INS04')
    when 'issues' then lower(p_task.related_entity_type) = 'issues'
    when 'payments' then p_task.task_group = 'Finance' or p_task.template_code in ('FIN01', 'FIN03')
    -- Deviation (REF-03 §1.1 S17): S13 GHL progression tasks (group
    -- Aftercare) are GHL work too; the reference queue never showed them.
    when 'ghl' then p_task.task_group = 'CRM' or p_task.template_code = 'GHL01' or p_task.template_code like 'S13-GHL%'
    when 'cancellation' then p_task.task_group = 'Cancellation'
    else false
  end
$$;

create function app.read_intake_review()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('queue', 'intake_review', 'count', count(*),
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'intake_id', i.intake_id, 'form_type', i.form_type, 'submission_id', i.submission_id,
      'job_id', i.job_id, 'validation_errors', i.validation_errors, 'received_at', i.received_at)
      order by i.received_at, i.id), '[]'::jsonb))
  from public.intake i
  where i.processing_status = 'Review'
$$;

create function app.read_operational_queue(p_actor jsonb, p_queue text, p_query text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := app.london_date(now());
  v_tasks jsonb;
begin
  if p_queue is null or p_queue not in ('booking', 'calls', 'issues', 'payments', 'ghl', 'cancellation', 'intake_review') then
    perform app.fail('R1A_QUEUE_NOT_IN_R1');
  end if;
  if p_queue = 'intake_review' then
    -- Deviation: the reference allowed this queue but its queue map had no
    -- entry, so it always returned UNKNOWN_QUEUE with no rows. It now shows
    -- the Intake Review rows, under INTAKE_REVIEW's office-manager rule.
    if not app.is_office_manager(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    return app.read_intake_review() || jsonb_build_object('tasks', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(v order by due_at nulls last, created_at, id), '[]'::jsonb) into v_tasks
  from (
    select t.due_at, t.created_at, t.id, app.s17_task_view(t, v_today) as v
    from public.tasks t
    where t.status not in ('Complete', 'NotRequired', 'Cancelled')
      and app.s17_in_queue(p_queue, t)
      and app.actor_task(p_actor, t)
  ) x
  where app.task_query_match(v ->> 'search_text', p_query);
  return jsonb_build_object('queue', p_queue, 'count', jsonb_array_length(v_tasks), 'tasks', v_tasks);
end
$$;

-- -----------------------------------------------------------------------------
-- 5-6. ADMIN: release modes, system status (s17/admin.js:431-517)
-- -----------------------------------------------------------------------------

create function app.read_release_modes()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'function_id', m.function_id, 'function_name', m.function_name, 'target_release', m.target_release,
    'mode', m.mode, 'authorised_job_scope', m.authorised_job_scope, 'planned_target_mode', m.planned_target_mode,
    'current_system', m.current_system, 'fallback', m.fallback, 'scope_boundary_notes', m.scope_boundary_notes,
    'activation_time', m.activation_time, 'approved_version', m.approved_version,
    'ben_approval_reference', m.ben_approval_reference, 'version', m.version) order by m.function_id), '[]'::jsonb)
  from public.release_modes m
$$;

create function app.read_system_status()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_latest public.health_checks;
  v_not_configured jsonb := '[]'::jsonb;
begin
  select * into v_latest from public.health_checks order by checked_at desc, created_at desc limit 1;

  if not exists (select 1 from public.ghl_tasks g where nullif(g.opportunity_id, 'NOT_CONFIGURED') is not null) then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'GHL pipeline/stage IDs', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No GHL opportunity_id configured');
  end if;
  if not exists (select 1 from public.invoice_stages s where nullif(s.xero_invoice_id, 'NOT_CONFIGURED') is not null) then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'Xero API integration', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No real Xero invoice IDs present');
  end if;
  if not exists (select 1 from public.report_snapshots r where r.report_type = 'BackupManifest' and nullif(r.file_id, '') is not null) then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'Backup Drive destination', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No Drive file_id on backup manifests');
  end if;
  v_not_configured := v_not_configured || jsonb_build_object('area', 'Destructive restore procedure', 'status', 'NOT_CONFIGURED',
                                                             'detail', 'Restore is dry-run only; full procedure not implemented');
  if not exists (select 1 from public.commissioning_templates) then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'Commissioning templates/forms', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No commissioning templates present');
  end if;
  if not exists (select 1 from public.contacts c join public.companies co on co.id = c.company_id where co.type = 'Scaffolder') then
    v_not_configured := v_not_configured || jsonb_build_object('area', 'Scaffolder contacts', 'status', 'NOT_CONFIGURED',
                                                               'detail', 'No scaffolder company contacts configured');
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'health', jsonb_build_object(
      'latest_check', case when v_latest.id is null then null else jsonb_build_object(
        'checked_at', v_latest.checked_at, 'outcome', v_latest.outcome, 'last_success', v_latest.last_success,
        'error_code', v_latest.error_code, 'integration', v_latest.integration) end,
      'total_checks', (select count(*) from public.health_checks)),
    'commit_journal', jsonb_build_object(
      'stalled', (select count(*) from public.commit_journal where state <> 'Committed'),
      'recovery_required', (select count(*) from public.commit_journal where state = 'RecoveryRequired'),
      'recovery_ids', (select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb)
                       from public.commit_journal where state = 'RecoveryRequired')),
    'outbox', jsonb_build_object(
      'uncertain', (select count(*) from public.outbox where status in ('NeedsReview', 'RetryDue')),
      'uncertain_ids', (select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb)
                        from public.outbox where status in ('NeedsReview', 'RetryDue'))),
    'not_configured', v_not_configured,
    'not_configured_count', jsonb_array_length(v_not_configured));
end
$$;

-- -----------------------------------------------------------------------------
-- 7. AUDIT / HISTORY (s17/admin.js:521-581)
-- -----------------------------------------------------------------------------

create function app.s17_first_keys(p_json jsonb)
returns text
language sql immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_json) = 'object'
    then (select string_agg(k, ',') from (select jsonb_object_keys(p_json) as k limit 5) s) end
$$;

create function app.read_audit_history(p_job public.jobs)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with events as (
    select a.occurred_at as ts, a.id::text as tie, jsonb_build_object(
             'type', 'audit', 'timestamp', a.occurred_at, 'action', a.action, 'entity_type', a.entity_type,
             'entity_id', a.entity_id, 'actor', a.initiating_person_id, 'reason', a.reason,
             'before_keys', app.s17_first_keys(a.before_json), 'after_keys', app.s17_first_keys(a.after_json)) as ev,
           'audit' as kind
    from public.audit_events a
    where a.entity_id = p_job.id::text or a.command_id = p_job.id::text
    union all
    select e.occurred_at, e.id::text, jsonb_build_object(
             'type', 'task_event', 'timestamp', e.occurred_at, 'action', e.action, 'task_id', e.task_id,
             'actor', e.actor, 'note', e.reason, 'old_status', e.old_status, 'new_status', e.new_status), 'task'
    from public.task_events e join public.tasks t on t.id = e.task_id
    where t.job_id = p_job.id
    union all
    select e.occurred_at, e.id::text, jsonb_build_object(
             'type', 'issue_event', 'timestamp', e.occurred_at, 'action', e.event_type, 'issue_id', e.issue_id,
             'actor', e.actor, 'note', e.note), 'issue'
    from public.issue_events e join public.issues i on i.id = e.issue_id
    where i.job_id = p_job.id
  )
  select jsonb_build_object(
    'job_id', p_job.id, 'found', true,
    'total_events', (select count(*) from events),
    'audit_events', (select count(*) from events where kind = 'audit'),
    'task_events', (select count(*) from events where kind = 'task'),
    'issue_events', (select count(*) from events where kind = 'issue'),
    'events', coalesce((select jsonb_agg(ev order by ts, tie)
                        from (select ev, ts, tie from events order by ts, tie limit 200) l), '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- 8. ACTION AVAILABILITY (s17/admin.js:585-640 + adapter.js:109-131)
-- -----------------------------------------------------------------------------

create function app.s17_flag(p_ok boolean, p_type text, p_entity text, p_reason text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('command_type', p_type, 'available', coalesce(p_ok, false),
                                              'expected_version_entity', p_entity,
                                              'reason', case when not coalesce(p_ok, false) then p_reason end))
$$;

-- The Start Job Booking launch (r1-appsheet/services.js _r1sBookingLaunch),
-- read-only. The AppSheet form view / request table / LINKTOFORM prefill are
-- not ported; the flag carries the job fields a booking form starts from.
create function app.s17_booking_launch(p_job public.jobs, p_task public.tasks, p_mode_ok boolean, p_access_ok boolean)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_ok boolean;
  v_flag jsonb;
  v_customer public.customers;
begin
  if p_job.id is null then
    v_reason := 'JOB_NOT_FOUND';
  elsif p_job.archived_at is not null or p_job.cancellation_at is not null
        or p_job.workflow_stage in ('CancellationInProgress', 'Cancelled') then
    v_reason := 'JOB_NOT_ACTIONABLE';
  elsif not app.job_in_scope(p_job) then
    v_reason := 'OUTSIDE_PILOT';
  elsif p_job.workflow_stage <> 'ReadyToBook' then
    v_reason := 'STAGE_NOT_READY_TO_BOOK';
  elsif p_job.booking_submission_id is not null then
    v_reason := 'BOOKING_ALREADY_SUBMITTED';
  -- The Job Sold sale creates no PRE-COPY-JOBID helper, so a task never launches it now.
  elsif p_task.id is not null and (p_task.template_code <> 'PRE-COPY-JOBID'
                                   or p_task.status not in ('Open', 'Waiting', 'InProgress')) then
    v_reason := 'NOT_A_BOOKING_HELPER_TASK';
  end if;
  v_ok := v_reason is null and p_mode_ok and p_access_ok;
  v_flag := app.s17_flag(v_ok, 'BOOKING_INTAKE', 'Jobs',
                         coalesce(v_reason, case when not p_mode_ok then 'MODE_UNAVAILABLE' else 'TASK_OWNER_OR_BACKUP_REQUIRED' end));
  if v_ok then
    select * into v_customer from public.customers where id = p_job.customer_id;
    v_flag := v_flag || jsonb_build_object('prefill', jsonb_strip_nulls(jsonb_build_object(
      'job_id', p_job.id, 'job_ref', p_job.job_ref, 'expected_version', p_job.version,
      'finance_route', p_job.finance_route, 'customer_first_name', v_customer.first_name,
      'customer_last_name', v_customer.last_name, 'street_address', v_customer.address_line1,
      'city', v_customer.town, 'postcode', v_customer.postcode, 'roof_required', p_job.roof_required,
      'electrical_required', p_job.electrical_required, 'scaffold_required', p_job.scaffold_required)));
  end if;
  return v_flag;
end
$$;

create function app.read_action_availability(p_actor jsonb, p_job public.jobs)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_stage text := p_job.workflow_stage;
  v_cancelled boolean := p_job.workflow_stage in ('CancellationInProgress', 'Cancelled');
  v_archived boolean := p_job.archived_at is not null;
  v_operational boolean := p_job.operational_complete_at is not null;
  v_modes jsonb;
  v_actions jsonb;
  -- adapter.js:111-114
  v_active boolean := p_job.archived_at is null and p_job.workflow_stage not in ('CancellationInProgress', 'Cancelled');
  v_fn01 boolean := app.mode_available('FN-01', 'Automated');
  v_cancel_modes boolean;
  v_fn15 boolean := app.mode_available('FN-15', 'Manual');
  v_fn19 boolean := app.mode_available('FN-19', 'Manual');
  v_fn11 boolean := app.mode_available('FN-11', 'Manual');
  v_office_mgr boolean := app.is_office_manager(p_actor);
  v_director boolean := app.is_director(p_actor);
  v_move_ok boolean;
  v_gates_ready boolean := false;
begin
  v_cancel_modes := v_fn01 and app.mode_available('FN-17', 'Manual') and app.mode_available('FN-20', 'Manual');
  v_move_ok := v_active and v_fn01 and v_stage in ('Booked', 'AwaitingInstallation', 'InProgress', 'BookingInProgress');
  if v_active and v_fn01 and v_office_mgr and v_stage = 'BookingInProgress' then
    v_gates_ready := coalesce((app.evaluate_booking_gates(p_job.id) ->> 'ready')::boolean, false);
  end if;

  -- The S17 per-function view (mode per release function).
  select coalesce(jsonb_object_agg(m.function_id, jsonb_build_object('mode', m.mode, 'scope', m.authorised_job_scope)), '{}'::jsonb)
    into v_modes from public.release_modes m;
  with f(fn) as (select unnest(array['FN-01', 'FN-07', 'FN-08', 'FN-11', 'FN-13', 'FN-15', 'FN-17'])),
       s as (
         select fn,
                coalesce(v_modes #>> array[fn, 'mode'], 'Disabled') as mode,
                coalesce(v_modes #>> array[fn, 'scope'], 'None') as scope
         from f),
       e as (
         select fn, mode, scope,
                (mode <> 'Disabled' and scope <> 'None') as enabled,
                (mode <> 'Disabled' and scope <> 'None' and app.job_in_scope(p_job)) as gated
         from s)
  select jsonb_object_agg(fn, jsonb_build_object('mode', case when enabled then mode else 'Disabled' end,
                                                 'enabled', enabled, 'gated', gated))
    into v_actions from e;

  return jsonb_build_object(
    'job_id', p_job.id, 'job_ref', p_job.job_ref, 'found', true, 'workflow_stage', v_stage, 'version', p_job.version,
    'actions', jsonb_build_object(
      'record_call', jsonb_build_object('available', not v_cancelled and not v_archived and (v_actions #>> '{FN-01,gated}')::boolean,
                                        'mode', v_actions #>> '{FN-01,mode}'),
      'resolve_issue', jsonb_build_object('available', not v_cancelled and not v_archived and (v_actions #>> '{FN-01,gated}')::boolean,
                                          'mode', v_actions #>> '{FN-01,mode}'),
      'approve_booking', jsonb_build_object('available', not v_cancelled and not v_archived
                                              and v_stage in ('Prebooking', 'ReadyToBook', 'BookingInProgress')
                                              and (v_actions #>> '{FN-01,gated}')::boolean,
                                            'mode', v_actions #>> '{FN-01,mode}'),
      'move_job', jsonb_build_object('available', not v_cancelled and not v_archived
                                       and v_stage in ('Booked', 'AwaitingInstallation', 'InProgress', 'BookingInProgress')
                                       and (v_actions #>> '{FN-01,gated}')::boolean,
                                     'mode', v_actions #>> '{FN-01,mode}'),
      'change_installer', jsonb_build_object('available', not v_cancelled and not v_archived
                                               and v_stage in ('Booked', 'AwaitingInstallation', 'InProgress', 'BookingInProgress')
                                               and (v_actions #>> '{FN-01,gated}')::boolean,
                                             'mode', v_actions #>> '{FN-01,mode}'),
      'operational_completion', jsonb_build_object('available', not v_cancelled and not v_archived
                                                     and v_stage in ('InProgress', 'Aftercare') and not v_operational
                                                     and (v_actions #>> '{FN-01,gated}')::boolean,
                                                   'mode', v_actions #>> '{FN-01,mode}'),
      'commissioning_review', jsonb_build_object('available', not v_cancelled and not v_archived and (v_actions #>> '{FN-07,gated}')::boolean,
                                                 'mode', v_actions #>> '{FN-07,mode}'),
      'handover_approval', jsonb_build_object('available', not v_cancelled and not v_archived and (v_actions #>> '{FN-08,gated}')::boolean,
                                              'mode', v_actions #>> '{FN-08,mode}'),
      'deposit_confirmation', jsonb_build_object('available', not v_cancelled and not v_archived
                                                   and p_job.deposit_bank_confirmed_at is null and (v_actions #>> '{FN-15,gated}')::boolean,
                                                 'mode', v_actions #>> '{FN-15,mode}'),
      'cancel_job', jsonb_build_object('available', not v_cancelled and not v_archived
                                         and (v_actions #>> '{FN-01,enabled}')::boolean and (v_actions #>> '{FN-17,enabled}')::boolean,
                                       'mode', case when 'Disabled' in (v_actions #>> '{FN-01,mode}', v_actions #>> '{FN-17,mode}') then 'Disabled'
                                                    when 'Manual' in (v_actions #>> '{FN-01,mode}', v_actions #>> '{FN-17,mode}') then 'Manual'
                                                    else 'Automated' end,
                                       'note', 'FN-01 + FN-17 required; GHL cancellation task is Manual'),
      'reinstate_job', jsonb_build_object('available', v_stage = 'Cancelled'
                                            and (v_actions #>> '{FN-01,enabled}')::boolean and (v_actions #>> '{FN-17,enabled}')::boolean,
                                          'mode', case when 'Disabled' in (v_actions #>> '{FN-01,mode}', v_actions #>> '{FN-17,mode}') then 'Disabled'
                                                       when 'Manual' in (v_actions #>> '{FN-01,mode}', v_actions #>> '{FN-17,mode}') then 'Manual'
                                                       else 'Automated' end),
      'archive_job', jsonb_build_object('available', not v_archived and v_operational and (v_actions #>> '{FN-13,gated}')::boolean,
                                        'mode', v_actions #>> '{FN-13,mode}'),
      'ghl_progression', jsonb_build_object('available', not v_cancelled and not v_archived and (v_actions #>> '{FN-11,gated}')::boolean,
                                            'mode', v_actions #>> '{FN-11,mode}')),
    -- Server-computed command availability (adapter.js:115-131): the same
    -- role / stage / mode rules as app.authorize_command and the handlers.
    'commands', jsonb_build_object(
      'call_record', app.s17_flag(v_active and v_fn01, 'CALL_RECORD', 'Tasks',
                                  case when not v_active then 'JOB_NOT_ACTIONABLE' else 'MODE_UNAVAILABLE' end),
      'issue_update', app.s17_flag(v_active and v_fn01, 'ISSUE_UPDATE', 'Issues',
                                   case when not v_active then 'JOB_NOT_ACTIONABLE' else 'MODE_UNAVAILABLE' end),
      'issue_create', app.s17_flag(v_active and v_fn01, 'ISSUE_CREATE', 'Jobs',
                                   case when not v_active then 'JOB_NOT_ACTIONABLE' else 'MODE_UNAVAILABLE' end),
      'planner_update', app.s17_flag(v_active and v_fn01, 'PLANNER_UPDATE', 'WorkPackages',
                                     case when not v_active then 'JOB_NOT_ACTIONABLE' else 'MODE_UNAVAILABLE' end),
      'move_job', app.s17_flag(v_move_ok, 'MOVE_JOB', 'Jobs',
                               case when not v_active then 'JOB_NOT_ACTIONABLE' when not v_fn01 then 'MODE_UNAVAILABLE'
                                    else 'STAGE_NOT_ELIGIBLE' end),
      'change_installer', app.s17_flag(v_move_ok, 'CHANGE_INSTALLER', 'WorkPackages',
                                       case when not v_active then 'JOB_NOT_ACTIONABLE' when not v_fn01 then 'MODE_UNAVAILABLE'
                                            else 'STAGE_NOT_ELIGIBLE' end),
      'cancel_job', app.s17_flag(v_active and v_cancel_modes, 'CANCEL_JOB', 'Jobs',
                                 case when not v_active then 'JOB_NOT_ACTIONABLE' else 'MODE_UNAVAILABLE' end),
      'reinstate_job', app.s17_flag(v_stage = 'Cancelled' and v_cancel_modes, 'REINSTATE_JOB', 'Jobs',
                                    case when v_stage <> 'Cancelled' then 'STAGE_NOT_CANCELLED' else 'MODE_UNAVAILABLE' end),
      'deposit_confirm', app.s17_flag(v_active and v_fn15 and v_director and p_job.deposit_bank_confirmed_at is null,
                                      'DEPOSIT_CONFIRM', 'Jobs',
                                      case when not v_active then 'JOB_NOT_ACTIONABLE' when not v_director then 'DIRECTOR_REQUIRED'
                                           when not v_fn15 then 'MODE_UNAVAILABLE' else 'ALREADY_CONFIRMED' end),
      'operational_complete', app.s17_flag(v_active and v_fn19 and v_fn11 and v_office_mgr and not v_operational
                                             and v_stage in ('InProgress', 'Aftercare'),
                                           'OPERATIONAL_COMPLETE', 'Jobs',
                                           case when not v_active then 'JOB_NOT_ACTIONABLE'
                                                when not v_office_mgr then 'OFFICE_OR_ADMIN_REQUIRED'
                                                when not (v_fn19 and v_fn11) then 'MODE_UNAVAILABLE'
                                                when v_operational then 'ALREADY_COMPLETE' else 'STAGE_NOT_ELIGIBLE' end),
      'booking_intake', app.s17_flag(v_active and v_fn01 and v_stage in ('Prebooking', 'ReadyToBook', 'BookingInProgress'),
                                     'BOOKING_INTAKE', 'Jobs',
                                     case when not v_active then 'JOB_NOT_ACTIONABLE' when not v_fn01 then 'MODE_UNAVAILABLE'
                                          else 'STAGE_NOT_ELIGIBLE' end),
      'confirm_booking', app.s17_flag(v_active and v_fn01 and v_office_mgr and v_stage = 'BookingInProgress' and v_gates_ready,
                                      'CONFIRM_BOOKING', 'Jobs',
                                      case when not v_active then 'JOB_NOT_ACTIONABLE'
                                           when not v_office_mgr then 'OFFICE_OR_ADMIN_REQUIRED'
                                           when not v_fn01 then 'MODE_UNAVAILABLE'
                                           when v_stage = 'Booked' then 'ALREADY_BOOKED'
                                           when v_stage <> 'BookingInProgress' then 'STAGE_NOT_ELIGIBLE'
                                           else 'BOOKING_CHECKS_OUTSTANDING' end),
      'start_job_booking', app.s17_booking_launch(p_job, null::public.tasks, v_fn01, true)));
end
$$;

-- -----------------------------------------------------------------------------
-- 9. TASK ACTION AVAILABILITY (s17/admin.js:644-667 + adapter.js:154-164)
-- -----------------------------------------------------------------------------

create function app.read_task_action_availability(p_actor jsonb, p_task public.tasks)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_completable boolean := p_task.status in ('Open', 'Waiting', 'InProgress') and not p_task.revision_required;
  v_reopenable boolean := p_task.status in ('Complete', 'NotRequired');
  v_attachable boolean := p_task.template_code = 'PRE02'
    and ((p_task.status = 'Complete' and p_task.evidence_id is null)
         or (p_task.status in ('Open', 'Waiting', 'InProgress') and not p_task.revision_required));
  v_owner_ok boolean := app.actor_id(p_actor) in (p_task.owner_id, coalesce(p_task.backup_id, p_task.owner_id))
                        or app.is_admin(p_actor);
  v_job public.jobs;
begin
  if p_task.job_id is not null then
    select * into v_job from public.jobs where id = p_task.job_id;
  end if;
  return jsonb_build_object(
    'task_id', p_task.id, 'found', true, 'job_id', p_task.job_id, 'status', p_task.status, 'title', p_task.title,
    'template_code', p_task.template_code, 'version', p_task.version,
    'actions', jsonb_build_object(
      'complete', jsonb_build_object('available', v_completable, 'note', case when v_completable then null
        when p_task.status in ('Complete', 'NotRequired', 'Cancelled') then 'Already ' || p_task.status
        else 'Status ' || p_task.status || ' not completable' end),
      'reopen', jsonb_build_object('available', v_reopenable, 'note', case when v_reopenable then null
        else 'Status ' || p_task.status || ' not reopenable' end)),
    'commands', jsonb_build_object(
      'task_complete', app.s17_flag(v_completable and v_owner_ok, 'TASK_COMPLETE', 'Tasks',
                                    case when not v_completable then 'COMPLETE_NOT_AVAILABLE' else 'TASK_OWNER_OR_BACKUP_REQUIRED' end),
      'task_reopen', app.s17_flag(v_reopenable and v_owner_ok, 'TASK_REOPEN', 'Tasks',
                                  case when not v_reopenable then 'REOPEN_NOT_AVAILABLE' else 'TASK_OWNER_OR_BACKUP_REQUIRED' end),
      'task_evidence_attach', app.s17_flag(v_attachable and v_owner_ok, 'TASK_EVIDENCE_ATTACH', 'Tasks',
                                           case when not v_attachable then 'ATTACH_NOT_AVAILABLE' else 'TASK_OWNER_OR_BACKUP_REQUIRED' end),
      'start_job_booking', app.s17_booking_launch(v_job, p_task, app.mode_available('FN-01', 'Automated'), v_owner_ok)));
end
$$;

-- -----------------------------------------------------------------------------
-- PLANNER (s11/planner.js:167-184)
-- -----------------------------------------------------------------------------

-- Live work packages whose planned window overlaps [from, to] (inclusive),
-- LEFT JOINED to active allocations: booked work with no active allocation
-- stays visible (it is exactly the work still to allocate). A null
-- allocation date falls back to the planned dates. Not person-scoped.
create function app.read_planner(p_from date, p_weeks int)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with bounds as (select p_from as d_from, p_from + p_weeks * 7 - 1 as d_to),
  wp_rows as (
    select jsonb_build_object(
             'job_id', w.job_id, 'job_ref', j.job_ref, 'job_display', nullif(j.display_name, ''),
             'work_package_id', w.id, 'trade', w.trade, 'work_package_status', w.status,
             'planned_start', w.planned_start, 'planned_end', w.planned_end, 'work_package_version', w.version,
             'allocation_id', a.id, 'person_id', a.person_id, 'person_name', app.s17_person_name(a.person_id),
             'role', a.role, 'allocated', a.id is not null,
             'start_at', coalesce(a.start_at, w.planned_start), 'end_at', coalesce(a.end_at, w.planned_end)) as r,
           coalesce(a.start_at, w.planned_start) as s_at, coalesce(j.job_ref, w.job_id::text, '') as jref,
           w.trade, w.id as wp_id, coalesce(a.id::text, '') as alloc
    from public.work_packages w
    cross join bounds b
    left join public.jobs j on j.id = w.job_id
    left join public.allocations a on a.work_package_id = w.id and a.active
    where w.planned_start is not null and w.planned_end is not null
      and w.planned_end >= b.d_from and w.planned_start <= b.d_to
      and w.status <> 'Cancelled'
  ),
  scaffold as (
    select jsonb_build_object('job_id', sb.job_id, 'scaffold_booking_id', sb.id, 'company_id', sb.company_id,
             'company', co.name, 'kind', k.kind, 'date', k.d, 'status', sb.status, 'revision', sb.revision,
             'acknowledged', coalesce(sb.confirmed_revision, 0) >= coalesce(sb.revision, 0),
             'confirmed', k.confirmed, 'actual_recorded', k.actual) as r,
           k.d, sb.id
    from public.scaffold_bookings sb
    cross join bounds b
    left join public.companies co on co.id = sb.company_id
    cross join lateral (values
      ('Erect', sb.erect_planned_at, sb.erect_actual_at is not null, sb.erect_confirmed_at is not null),
      ('Strip', sb.strip_planned_at, sb.strip_actual_at is not null, sb.strip_confirmed_at is not null),
      ('StripForecast', case when sb.strip_planned_at is null and sb.strip_actual_at is null then sb.strip_forecast_at end,
       false, false)) as k(kind, d, actual, confirmed)
    where sb.status <> 'Cancelled' and k.d is not null and k.d between b.d_from and b.d_to
  )
  select jsonb_build_object(
    'from', b.d_from, 'to', b.d_to, 'weeks', p_weeks,
    'rows', coalesce((select jsonb_agg(r order by s_at, jref, trade, wp_id, alloc) from wp_rows), '[]'::jsonb),
    'scaffold', coalesce((select jsonb_agg(r order by d, id) from scaffold), '[]'::jsonb))
  from bounds b
$$;

-- -----------------------------------------------------------------------------
-- The read boundary (adapter.js read())
-- -----------------------------------------------------------------------------

-- Request: {read_type, job_id?, task_id?, queue?, as_of?, query?}
-- Response: {ok: true, read_type, actor_id, data}. Refusals raise the
-- reference code (R1A_ROLE_DENIED, R1A_UNKNOWN_READ, ...).
create function public.execute_read(p_request jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_type text;
  v_actor jsonb;
  v_email text;
  v_person public.people;
  v_roles text[];
  v_as_of date;
  v_query text;
  v_job public.jobs;
  v_task public.tasks;
  v_out jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('read_type', 'job_id', 'task_id', 'queue', 'as_of', 'query') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
    if jsonb_typeof(p_request -> v_key) not in ('string', 'null') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;
  v_type := p_request ->> 'read_type';

  -- WHO_AM_I replaces IDENTITY_PROBE: who the signed-in user resolves to,
  -- without failing for an unknown user (the probe's purpose).
  if v_type = 'WHO_AM_I' then
    if (select count(*) from jsonb_object_keys(p_request)) <> 1 then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
    -- Identity foundation: auth.uid() -> people.auth_user_id (active) -> active roles.
    v_email := app.auth_email();
    select * into v_person from public.people p where p.id = app.current_person_id();
    v_roles := coalesce(app.current_roles(), '{}');
    v_actor := jsonb_build_object('id', v_person.id, 'roles', to_jsonb(v_roles));
    return jsonb_build_object('ok', true, 'read_type', v_type, 'actor_id', v_person.id, 'data', jsonb_build_object(
      'email', coalesce(v_person.email, v_email),
      'active_user_maps_to_active_people', v_person.id is not null,
      'person', case when v_person.id is null then null else jsonb_build_object(
        'id', v_person.id, 'email', v_person.email, 'display_name', v_person.display_name) end,
      'roles', to_jsonb(v_roles),
      'authenticated', v_person.id is not null and cardinality(v_roles) > 0,
      'classes', jsonb_build_object('admin', app.is_admin(v_actor), 'director', app.is_director(v_actor),
                                    'office', app.is_office(v_actor), 'office_manager', app.is_office_manager(v_actor))));
  end if;

  if v_type is null or v_type not in ('OFFICE_HOME', 'JOB_SEARCH', 'JOB_OVERVIEW', 'OPERATIONAL_QUEUE',
                                      'RELEASE_MODE_STATUS', 'SYSTEM_STATUS', 'AUDIT_HISTORY', 'ACTION_AVAILABILITY',
                                      'TASK_ACTION_AVAILABILITY', 'MY_TASKS', 'TEAM_TASKS', 'PLANNER_3_WEEKS',
                                      'PLANNER_6_WEEKS', 'INTAKE_REVIEW') then
    -- INSTALLER_WORKFLOW / GOODS_IN_DETAIL / STOCK_BALANCE belong to the
    -- R2/R3 operations contract, not this boundary.
    if v_type in ('INSTALLER_WORKFLOW', 'GOODS_IN_DETAIL', 'STOCK_BALANCE') then
      perform app.fail('R1A_READ_UNSUPPORTED');
    end if;
    perform app.fail('R1A_UNKNOWN_READ');
  end if;

  v_actor := app.resolve_actor();
  if not app.is_office(v_actor) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  v_query := p_request ->> 'query';

  if v_type in ('OFFICE_HOME', 'MY_TASKS', 'TEAM_TASKS') then
    v_as_of := coalesce(app.read_date(p_request ->> 'as_of', 'S17_DATE_INVALID'), app.london_date(now()));
    if v_type = 'OFFICE_HOME' then
      v_out := app.read_office_home(v_actor, v_as_of);
    elsif v_type = 'MY_TASKS' then
      v_out := app.read_task_list(v_actor, v_as_of, false, v_query);
    else
      if not app.is_office_manager(v_actor) then
        perform app.fail('R1A_ROLE_DENIED');
      end if;
      v_out := app.read_task_list(v_actor, v_as_of, true, v_query);
    end if;

  elsif v_type = 'JOB_SEARCH' then
    if nullif(btrim(coalesce(v_query, '')), '') is null then
      perform app.fail('R1A_QUERY_REQUIRED');
    end if;
    v_out := app.read_job_search(v_actor, v_query);

  elsif v_type in ('JOB_OVERVIEW', 'AUDIT_HISTORY', 'ACTION_AVAILABILITY') then
    v_job := app.read_authorize_job(v_actor, p_request ->> 'job_id');
    v_out := case v_type
      when 'JOB_OVERVIEW' then app.read_job_overview(v_job)
      when 'AUDIT_HISTORY' then app.read_audit_history(v_job)
      else app.read_action_availability(v_actor, v_job) end;

  elsif v_type = 'OPERATIONAL_QUEUE' then
    v_out := app.read_operational_queue(v_actor, nullif(btrim(coalesce(p_request ->> 'queue', '')), ''), v_query);

  elsif v_type = 'RELEASE_MODE_STATUS' then
    if not app.is_admin(v_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    v_out := app.read_release_modes();

  elsif v_type = 'SYSTEM_STATUS' then
    if not app.is_admin(v_actor) and not app.has_role(v_actor, 'Office') then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    v_out := app.read_system_status();

  elsif v_type = 'TASK_ACTION_AVAILABILITY' then
    if coalesce(p_request ->> 'task_id', '') ~* '^\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$' then
      select * into v_task from public.tasks where id = btrim(p_request ->> 'task_id')::uuid;
    end if;
    if v_task.id is null then
      perform app.fail('R1A_TASK_NOT_FOUND');
    end if;
    if v_task.job_id is not null then
      perform app.read_authorize_job(v_actor, v_task.job_id::text);
    elsif v_task.owner_id <> app.actor_id(v_actor) and not app.is_admin(v_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    v_out := app.read_task_action_availability(v_actor, v_task);

  elsif v_type in ('PLANNER_3_WEEKS', 'PLANNER_6_WEEKS') then
    v_out := app.read_planner(coalesce(app.read_date(p_request ->> 'as_of', 'S11_DATE_INVALID'), app.london_date(now())),
                              case when v_type = 'PLANNER_3_WEEKS' then 3 else 6 end);

  else -- INTAKE_REVIEW
    if not app.is_office_manager(v_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    v_out := app.read_intake_review();
  end if;

  return jsonb_build_object('ok', true, 'read_type', v_type, 'actor_id', app.actor_id(v_actor), 'data', v_out);
end
$$;

-- -----------------------------------------------------------------------------
-- Staff-facing command result catalogue (r1-appsheet/command-result.js)
--
--   Succeeded (SUCCESS) | FollowUpRequired (SAVED – FOLLOW-UP NEEDED) |
--   ActionRequired (ACTION REQUIRED: nothing written, user can fix) |
--   Failed (COULD NOT COMPLETE: nothing written, user cannot fix).
-- UploadPending is AppSheet upload plumbing and is not ported.
-- -----------------------------------------------------------------------------

create function app.result_heading(p_status text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_status when 'Succeeded' then 'SUCCESS' when 'FollowUpRequired' then 'SAVED – FOLLOW-UP NEEDED'
                       when 'ActionRequired' then 'ACTION REQUIRED' else 'COULD NOT COMPLETE' end
$$;

-- Shared messages (R1R_MSG).
create function app.result_message(p_key text)
returns text
language sql immutable
set search_path = ''
as $$
  select $j${
    "STALE": "This record changed after you opened the form. Go back, refresh, and try again.",
    "PERMISSION": "You don't have permission to do this. Ask the task owner or an administrator.",
    "TASK_PERMISSION": "Only the task owner, their backup, or an administrator can do this.",
    "IDENTITY": "This request was submitted by a different user, so it wasn't processed. Sign in as that person and submit it again.",
    "SIGN_IN": "Your sign-in isn't set up for this app. Ask an administrator to check your staff record.",
    "MODE": "This action is switched off at the moment. Ask an administrator.",
    "PILOT": "This job isn't part of the R1 pilot, so this action isn't available.",
    "CONFIG": "The app setup needs attention before this can run. Tell an administrator.",
    "RECOVERY": "An earlier change to this record didn't finish. An administrator needs to check it before you try again.",
    "CONFLICT": "This request clashes with an earlier request that used the same ID. Start a new request from the task or job.",
    "NOT_FOUND": "The record couldn't be found. Go back, refresh, and try again.",
    "NOT_READY": "This request wasn't marked as ready, so it wasn't processed.",
    "INVALID": "Some of the information entered isn't valid. Check the form and try again.",
    "DATE": "A date entered isn't valid. Check the dates and try again.",
    "NOT_ACTIONABLE": "This job is cancelled or archived, so no changes can be made.",
    "UNKNOWN": "The request couldn't be completed. Tell an administrator."
  }$j$::jsonb ->> p_key
$$;

-- Per-code outcomes (R1R_ERRORS): code -> [status, message]. A value that is
-- a single upper-case word refers to a shared message.
create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select $j${
    "R1A_REQUIRED_COMPLETION_NOTE": ["ActionRequired", "A completion note is required. Add a note and try again."],
    "R1A_REQUIRED_EVIDENCE_ID": ["ActionRequired", "Signed contract evidence is required. Add the signed contract evidence and try again."],
    "R1A_REQUIRED_EVIDENCE_PATH": ["ActionRequired", "Upload the signed contract file and try again."],
    "R1A_REQUIRED_CONTRACT_EVIDENCE": ["ActionRequired", "The contract evidence doesn't match a file saved for this job. Upload the signed contract file and try again."],
    "R1A_CROSS_JOB_EVIDENCE": ["ActionRequired", "That evidence belongs to a different job. Add the evidence for this job and try again."],
    "R1C_CROSS_JOB_EVIDENCE": ["ActionRequired", "That evidence belongs to a different job. Add the evidence for this job and try again."],
    "R1A_EVIDENCE_AMBIGUOUS": ["ActionRequired", "More than one saved file matches that evidence. Upload the signed contract file directly and try again."],
    "R1A_EVIDENCE_CONFLICT": ["ActionRequired", "The uploaded file and the evidence reference don't match. Use one of them and try again."],
    "R1A_EVIDENCE_ALREADY_ATTACHED": ["Failed", "Contract evidence is already attached to this task, so nothing was changed."],
    "R1A_REQUIRED_CONTRACT_ID": ["ActionRequired", "The contract reference is required. Enter the Signable or contract reference and try again."],
    "R1A_REQUIRED_CONTRACT_SIGNED": ["ActionRequired", "Say whether the contract is signed. Choose Yes or No and try again."],
    "R1A_CONTRACT_ALREADY_SIGNED": ["Failed", "This contract is already recorded as signed, so it was not changed to sent."],
    "R1A_REQUIRED_INVOICE_NUMBER": ["ActionRequired", "The deposit invoice number is required. Enter the invoice number and try again."],
    "R1A_REQUIRED_INVOICE_SENT": ["ActionRequired", "Confirm the deposit invoice was sent by choosing Yes, or set the outcome to Failed if it could not be sent."],
    "R1A_REQUIRED_DEPOSIT_BANK_CONFIRMED": ["ActionRequired", "Say whether the deposit has been seen in the bank. Choose Yes or No and try again."],
    "R1A_REQUIRED_DEPOSIT_AMOUNT": ["ActionRequired", "Enter the deposit amount shown in the bank and try again."],
    "R1A_INVALID_DEPOSIT_AMOUNT": ["ActionRequired", "The deposit amount isn't valid. Enter pounds and pence, for example 2612.95."],
    "R1A_REQUIRED_DEPOSIT_RECEIVED_DATE": ["ActionRequired", "Enter the date the deposit was received and try again."],
    "R1A_INVALID_DEPOSIT_RECEIVED_DATE": ["ActionRequired", "The deposit received date isn't valid. Enter a real date that isn't in the future."],
    "R1A_REQUIRED_DEPOSIT_BANK_REFERENCE": ["ActionRequired", "Enter the bank payment reference and try again."],
    "R1A_DEPOSIT_NOT_CONFIRMED": ["ActionRequired", "The deposit can only be confirmed once it has been seen in the bank. Choose Yes when it has arrived."],
    "R1A_DEPOSIT_AMOUNT_MISMATCH": ["ActionRequired", "The amount entered doesn't match the expected deposit for this job. Check the bank amount and try again."],
    "R1A_DEPOSIT_STAGE_MISSING": ["Failed", "This job doesn't have a deposit invoice set up yet. Ask an administrator to check the job's invoices."],
    "R1A_DEPOSIT_AMOUNT_REQUIRED": ["Failed", "This job doesn't have a deposit amount set up yet. Ask an administrator to check the job's invoices."],
    "R1A_REQUIRED_CUSTOMER_DETAILS_VERIFIED": ["ActionRequired", "Say whether the customer details are correct. Choose Yes or No and try again."],
    "R1A_REQUIRED_SOLD_VALUE_VERIFIED": ["ActionRequired", "Say whether the sold value is correct. Choose Yes or No and try again."],
    "R1A_REQUIRED_VERIFIED_GROSS_AMOUNT": ["ActionRequired", "Enter the verified contract value in pounds and try again."],
    "R1A_VERIFIED_AMOUNT_MISMATCH": ["ActionRequired", "The verified value doesn't match the job's contract value. Check the amount and try again."],
    "R1A_SOLD_VALUE_REQUIRED": ["Failed", "This job doesn't have a sold value recorded. Ask an administrator to check the job."],
    "R1A_REQUIRED_REOPEN_REASON": ["ActionRequired", "A reason is required to reopen a task. Add the reason and try again."],
    "R1A_TASK_NOT_COMPLETABLE": ["ActionRequired", "This task can't be completed in its current state. It may already be complete. Go back and check the task."],
    "R1A_TASK_NOT_REOPENABLE": ["ActionRequired", "Only completed or not-required tasks can be reopened. Go back and check the task."],
    "R1A_TASK_NOT_ATTACHABLE": ["ActionRequired", "Contract evidence can only be added to an open contract task, or to a completed one that has no evidence yet."],
    "R1A_REQUIRED_OWNER_ID": ["ActionRequired", "Choose the new owner and try again."],
    "R1A_REQUIRED_OLD_ALLOCATION_ID": ["ActionRequired", "Choose the allocation to change and try again."],
    "R1A_REQUIRED_ACTIVITIES": ["ActionRequired", "Choose at least one activity to move and try again."],
    "R1A_INVALID_DATE": ["ActionRequired", "DATE"],
    "R1A_INVALID_INTEGER": ["ActionRequired", "A number entered must be a whole number. Check the form and try again."],
    "R1A_INVALID_BOOLEAN": ["ActionRequired", "A Yes/No answer is missing or not valid. Check the form and try again."],
    "R1A_INVALID_GROSS_AMOUNT": ["ActionRequired", "The amount isn't valid. Enter pounds and pence, for example 10451.78."],
    "R1A_INVALID_FINANCE_ROUTE": ["ActionRequired", "Choose a finance route: Standard, Phoenix or OtherReview."],
    "R1A_FINANCE_ROUTE_CONFLICT": ["ActionRequired", "The finance route doesn't match the one agreed at sale. The booking form shows the agreed route. Change it through the finance route change process, not through booking."],
    "R1A_INVALID_ISSUE_TYPE": ["ActionRequired", "Choose an issue type: Variation, Remedial or Complaint."],
    "R1A_INVALID_SEVERITY": ["ActionRequired", "Choose a severity: Normal or Medium."],
    "R1A_INVALID_CUSTOMER_IMPACT": ["ActionRequired", "Say whether the customer is affected. Choose Yes or No."],
    "R1A_INVALID_FIELDS": ["Failed", "The form sent information this action does not accept. Ask an administrator to check the form setup."],
    "R1A_SALESPERSON_NOT_FOUND": ["ActionRequired", "The salesperson couldn't be found. Choose an active salesperson and try again."],
    "R1A_CUSTOMER_OVERWRITE": ["ActionRequired", "The customer details don't match the existing job. Check them in Intake Review."],
    "R1A_JOB_LINK_MISMATCH": ["ActionRequired", "This request doesn't match the selected job. Start again from the job."],
    "R1A_JOB_ID_INVALID": ["ActionRequired", "The job reference isn't valid. Start again from the job."],
    "R1A_TASK_JOB_MISMATCH": ["ActionRequired", "That task doesn't belong to this job. Start again from the job."],
    "R1A_ISSUE_JOB_MISMATCH": ["ActionRequired", "That issue doesn't belong to this job. Start again from the job."],
    "R1A_WORK_PACKAGE_JOB_MISMATCH": ["ActionRequired", "That work package doesn't belong to this job. Start again from the job."],
    "R1A_STAGE_NOT_ELIGIBLE": ["ActionRequired", "This job isn't at a stage where this action is allowed."],
    "R1A_JOB_NOT_ACTIONABLE": ["Failed", "NOT_ACTIONABLE"],
    "R1C_JOB_NOT_ACTIONABLE": ["Failed", "NOT_ACTIONABLE"],
    "R1A_ACTOR_MISMATCH": ["Failed", "IDENTITY"],
    "R1C_ACTOR_MISMATCH": ["Failed", "IDENTITY"],
    "R1A_INTAKE_MAPPING_INCOMPLETE": ["ActionRequired", "The booking form's field mapping is incomplete, so nothing was booked. Nothing on this job changed. Ask an administrator to check the intake field mapping, then submit a new booking."],
    "R1A_BOOKING_NOT_LINKED": ["ActionRequired", "This job has no booking intake yet, so the booking checklist cannot be created. Submit the booking form first."],
    "R1A_BOOKING_GATES_NOT_SATISFIED": ["ActionRequired", "The booking can't be confirmed yet. Finish the outstanding booking checks on this job, then try again."],
    "R1A_STAGE_NOT_BOOKING_IN_PROGRESS": ["ActionRequired", "This job is not at the booking stage, so it cannot be confirmed."],
    "R1A_BOOKING_NOT_CONFIRMED": ["Failed", "The booking could not be confirmed. Nothing on the job was changed. Tell an administrator."],
    "R1A_AUTHENTICATED_EMAIL_REQUIRED": ["Failed", "SIGN_IN"],
    "R1C_AUTHENTICATED_EMAIL_REQUIRED": ["Failed", "SIGN_IN"],
    "R1A_UNKNOWN_OR_DUPLICATE_ACTOR": ["Failed", "SIGN_IN"],
    "R1A_INACTIVE_ACTOR": ["Failed", "SIGN_IN"],
    "R1A_NO_ACTIVE_ROLE": ["Failed", "SIGN_IN"],
    "R1A_TASK_ACCESS_DENIED": ["Failed", "TASK_PERMISSION"],
    "R1A_OUTSIDE_PILOT": ["Failed", "PILOT"],
    "R1C_PILOT_REQUIRED": ["Failed", "PILOT"],
    "R1A_MODE_MISSING": ["Failed", "MODE"],
    "R1A_STALE_VERSION": ["ActionRequired", "STALE"],
    "R1C_STALE_VERSION": ["ActionRequired", "STALE"],
    "R1C_STALE_SUBMISSION": ["ActionRequired", "The commissioning form changed after you opened it. Go back, refresh, and try again."],
    "R1A_COMMAND_CONFLICT": ["Failed", "CONFLICT"],
    "R1C_COMMAND_CONFLICT": ["Failed", "CONFLICT"],
    "R1A_TASK_NOT_FOUND": ["Failed", "NOT_FOUND"],
    "R1A_JOB_NOT_FOUND": ["Failed", "NOT_FOUND"],
    "R1C_WORK_PACKAGE_NOT_FOUND": ["Failed", "NOT_FOUND"],
    "R1C_DELIVERY_NOT_FOUND": ["Failed", "NOT_FOUND"],
    "R1C_ORDER_NOT_FOUND": ["Failed", "NOT_FOUND"],
    "R1C_ROW_MISSING": ["Failed", "NOT_FOUND"],
    "R1A_UPLOAD_INVALID": ["ActionRequired", "The uploaded file couldn't be read. Upload the file again from the form."],
    "R1A_UPLOAD_MISSING": ["ActionRequired", "Your uploaded file never arrived. Upload the file again and try again."],
    "R1C_UPLOAD_MISSING": ["ActionRequired", "Your uploaded file never arrived. Upload the file again and try again."],
    "R1C_UPLOAD_PATH_INVALID": ["ActionRequired", "The uploaded file couldn't be read. Upload the file again from the form."],
    "R1C_UPLOAD_AMBIGUOUS": ["ActionRequired", "More than one file has that name. Rename the file and upload it again."],
    "R1C_EVIDENCE_FILE_REQUIRED": ["ActionRequired", "A photo or file is required. Add it and try again."],
    "R1C_INVALID_EVIDENCE": ["ActionRequired", "The attached file isn't valid. Upload it again."],
    "R1C_OFFICE_REASON_REQUIRED": ["ActionRequired", "Office staff must give a reason when acting for an installer. Add the reason and try again."],
    "R1C_INVALID_QUANTITY": ["ActionRequired", "A quantity isn't valid. Check the quantities and try again."],
    "R1C_INVALID_NUMBER": ["ActionRequired", "A number entered isn't valid. Check the form and try again."],
    "R1C_INVALID_BOOLEAN": ["ActionRequired", "A Yes/No answer is missing or not valid. Check the form and try again."],
    "R1C_INVALID_ANSWER": ["ActionRequired", "A commissioning answer isn't valid. Check the answers and try again."],
    "R1C_INVALID_ANSWERS": ["ActionRequired", "A commissioning answer isn't valid. Check the answers and try again."],
    "R1C_RECEIPT_LINES_REQUIRED": ["ActionRequired", "Add at least one delivery line and try again."],
    "R1C_DUPLICATE_RECEIPT_LINE": ["ActionRequired", "The same delivery line was entered twice. Remove the duplicate and try again."],
    "R1C_RECEIPT_PARENT_MISMATCH": ["ActionRequired", "A delivery line doesn't belong to this delivery. Check the lines and try again."],
    "R1C_STOCK_PRODUCT_REQUIRED": ["ActionRequired", "Choose the product and try again."],
    "R1C_APPROVED_TEMPLATE_REQUIRED": ["Failed", "There's no approved commissioning template for this work yet. Ask an administrator."],
    "R1C_APPROVED_QUESTION_REQUIRED": ["ActionRequired", "That commissioning question isn't on the approved template. Check the answers and try again."],
    "R1C_REVIEW_STATE_OR_NOTES": ["ActionRequired", "Choose a review outcome and add review notes, then try again."],
    "R1C_REVIEW_REFUSED": ["ActionRequired", "This commissioning submission can't be reviewed in its current state."],
    "R1C_SUBMISSION_MISMATCH": ["ActionRequired", "That commissioning submission doesn't belong to this work. Start again from the work package."],
    "R1C_AMBIGUOUS_SUBMISSION": ["Failed", "More than one commissioning draft matches. Ask an administrator."],
    "R1C_TEMPLATE_AMBIGUOUS": ["Failed", "More than one commissioning template matches. Ask an administrator."],
    "R1C_JOB_MISMATCH": ["ActionRequired", "This request doesn't match the selected job. Start again from the job."],
    "R1C_EXPECTED_VERSION_REQUIRED": ["Failed", "CONFIG"],
    "R1A_JOB_AMBIGUOUS": ["Failed", "More than one job matches that reference. Use the internal job ID instead."],
    "R1A_JOB_REF_REQUIRED": ["ActionRequired", "A job reference is required. Enter the public job ID and try again."],
    "R1A_PRE03_NOT_APPLICABLE": ["Failed", "This job isn't on the Standard finance route, so it has no bank deposit task."],
    "R1A_PRE03_MISSING": ["Failed", "This job has no bank deposit task to repair."],
    "R1A_PRE03_AMBIGUOUS": ["Failed", "This job has more than one bank deposit task. Ask an administrator to check it."],
    "R1A_PRE03_NOT_OPEN": ["Failed", "The bank deposit task is already finished, so its owner can't be changed."],
    "R1A_QUERY_REQUIRED": ["ActionRequired", "Enter a job number, customer name or postcode to search for, then try again."],
    "R1A_QUEUE_NOT_IN_R1": ["Failed", "That work queue isn't available yet."],
    "INVALID_FIELDS": ["Failed", "The form sent information this action does not accept. Ask an administrator to check the form setup."],
    "INVALID_POSTCODE": ["ActionRequired", "The postcode isn't valid. Enter a full UK postcode, for example LS1 1AA."],
    "INVALID_EMAIL": ["ActionRequired", "The email address isn't valid. Check it and try again."],
    "CONTACT_METHOD_REQUIRED": ["ActionRequired", "Enter a phone number or an email address for the customer and try again."],
    "INVALID_FINANCE_ROUTE": ["ActionRequired", "Choose a finance route: Standard, Phoenix or OtherReview."],
    "INVALID_GROSS_AMOUNT": ["ActionRequired", "The amount isn't valid. Enter pounds and pence, for example 10451.78."],
    "SALESPERSON_NOT_FOUND": ["ActionRequired", "The salesperson couldn't be found. Choose an active salesperson and try again."],
    "SALESPERSON_MUST_BE_SELF": ["ActionRequired", "You can only submit a sale as yourself. Choose yourself as the salesperson."],
    "NOT_AUTHENTICATED": ["Failed", "SIGN_IN"],
    "COMMAND_ID_CONFLICT": ["Failed", "CONFLICT"],
    "COMMAND_IN_PROGRESS": ["ActionRequired", "This request is still being processed. Wait a moment, refresh, and check before trying again."],
    "STALE_VERSION": ["ActionRequired", "STALE"],
    "TASK_ASSIGNMENT_CONFIG": ["Failed", "CONFIG"]
  }$j$::jsonb
$$;

-- Field labels for R1x_REQUIRED_<FIELD> codes (R1R_FIELD_LABELS).
create function app.result_field_label(p_field text)
returns text
language sql immutable
set search_path = ''
as $$
  select coalesce($j${
    "completion_note": "A completion note", "reopen_reason": "A reason for reopening", "reference": "The bank reference",
    "type": "The call type", "outcome": "The outcome", "action": "The issue action", "reason": "A reason",
    "planned_start": "The planned start date", "planned_end": "The planned end date", "effective_date": "The effective date",
    "work_performed": "The work performed", "material_state": "The material state", "scaffold_state": "The scaffold state",
    "finance_review": "The finance review", "legacy_state": "The legacy system state", "new_date": "The new date",
    "commitment_review": "The commitment review", "evidence_reference": "The evidence reference",
    "customer_first_name": "The customer's first name", "customer_last_name": "The customer's last name",
    "street_address": "The street address", "city": "The town or city", "postcode": "The postcode",
    "finance_route": "The finance route", "mode": "The change type", "person_id": "The installer",
    "first_name": "The customer's first name", "last_name": "The customer's last name",
    "address_line1": "The first line of the address", "town": "The town", "salesperson_id": "The salesperson",
    "agreed_price_pence": "The agreed price"
  }$j$::jsonb ->> p_field, 'The ' || replace(p_field, '_', ' '))
$$;

-- Staff-facing outcome of a refused command or read. Accepts the raised
-- message ('R1A_FOO', 'S15_REVIEW: normal work suppressed', plain text).
-- Returns {status, heading, message, code, detail, field?}. With a
-- command_id, a Failed message ends with 'Reference: <command_id>.'.
create function public.describe_command_error(p_error text, p_command_id text default null, p_field text default null)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_error, ''));
  v_match text[];
  v_code text;
  v_detail text := '';
  v_hit jsonb;
  v_status text;
  v_message text;
  v_field text;
begin
  v_match := regexp_match(v_text, '^([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])(?::\s*(.*))?$');
  if v_match is null then
    v_code := 'UNCLASSIFIED';
    v_detail := v_text;
  else
    v_code := v_match[1];
    v_detail := btrim(coalesce(v_match[2], ''));
  end if;
  v_hit := app.result_error_catalogue() -> v_code;
  if v_code ~ '^(R1[ACU]_)?REQUIRED_[A-Z0-9_]+$' then
    v_field := lower(regexp_replace(v_code, '^(R1[ACU]_)?REQUIRED_', ''));
  end if;
  -- Job Sold refusals (app.reject) carry the offending field in HINT.
  if nullif(btrim(coalesce(p_field, '')), '') is not null then
    v_field := btrim(p_field);
  end if;

  if v_hit is not null then
    v_status := v_hit ->> 0;
    v_message := coalesce(app.result_message(v_hit ->> 1), v_hit ->> 1);
  elsif v_code ~ '^TOO_LONG_' then
    v_field := coalesce(v_field, lower(regexp_replace(v_code, '^TOO_LONG_', '')));
    v_status := 'ActionRequired';
    v_message := app.result_field_label(v_field) || ' is too long. Shorten it and try again.';
  elsif v_code ~ '^(R1[ACU]_)?REQUIRED_' and v_field is not null then
    v_status := 'ActionRequired';
    v_message := app.result_field_label(v_field) || ' is required. Add it and try again.';
  elsif v_code ~ 'STALE' or (v_code ~ '^S[0-9]+_REVIEW$' and v_detail ~* 'stale') then
    v_status := 'ActionRequired'; v_message := app.result_message('STALE');
  elsif v_code ~ 'RECOVERY_REQUIRED$' then
    v_status := 'Failed'; v_message := app.result_message('RECOVERY');
  elsif v_code ~ '_MODE_DENIED|_MODE_MISSING' then
    v_status := 'Failed'; v_message := app.result_message('MODE');
  elsif v_code ~ '_DENIED' then
    v_status := 'Failed'; v_message := app.result_message('PERMISSION');
  elsif v_code ~ '_DEV_ONLY$|_SCHEMA$|^R1A_SCHEMA_|_TABLE_MISSING$|_UNSUPPORTED$|_NOT_CONFIGURED$|_RESOLVER_MISSING$|_COMMAND_ID_REQUIRED$|_BACKEND_MISSING|^S[0-9]+_CONFIG$' then
    v_status := 'Failed'; v_message := app.result_message('CONFIG');
  elsif (v_code ~ '_CONFLICT$' or v_code ~ '^S[0-9]+_REVIEW$') and (v_code || ' ' || v_detail) ~* 'conflict' then
    v_status := 'Failed'; v_message := app.result_message('CONFLICT');
  elsif v_code ~ '_DATE_INVALID$' then
    v_status := 'ActionRequired'; v_message := app.result_message('DATE');
  elsif v_code ~ '^(R1[ACU]_)?INVALID_' then
    v_status := 'ActionRequired'; v_message := app.result_message('INVALID');
  elsif v_code ~ '^S[0-9]+_REVIEW$' then
    v_status := 'ActionRequired';
    v_message := 'This needs checking before it can go ahead'
      || case when v_detail <> '' and v_detail !~ '[A-Z0-9]+_[A-Z0-9_]{2,}'
              then ': ' || regexp_replace(v_detail, '[.[:space:]]+$', '') else '' end || '.';
  elsif v_code ~ '^S[0-9]+_REFUSED$' then
    v_status := 'Failed'; v_message := 'This action isn''t allowed for this job at the moment.';
  elsif v_code ~ '_NOT_FOUND$' then
    v_status := 'Failed'; v_message := app.result_message('NOT_FOUND');
  else
    v_status := 'Failed'; v_message := app.result_message('UNKNOWN');
  end if;

  if v_status = 'Failed' and nullif(btrim(coalesce(p_command_id, '')), '') is not null then
    v_message := v_message || ' Reference: ' || btrim(p_command_id) || '.';
  end if;
  return jsonb_strip_nulls(jsonb_build_object('status', v_status, 'heading', app.result_heading(v_status),
                                              'message', v_message, 'code', v_code,
                                              'detail', nullif(left(v_detail, 300), ''), 'field', v_field));
end
$$;

-- 'd Mon yyyy' in Europe/London (R1R _r1rDateLabel).
create function app.result_date_label(p_value text)
returns text
language plpgsql stable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return '';
  end if;
  if btrim(p_value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return to_char(btrim(p_value)::date, 'FMDD Mon YYYY');
  end if;
  return to_char(app.london_date(btrim(p_value)::timestamptz), 'FMDD Mon YYYY');
exception when others then
  return '';
end
$$;

-- Staff-facing outcome of a successful command (_r1rSuccessFeedback +
-- _r1rExtras). Accepts either the execute_command response
-- {ok, command_type, result, replayed} or its inner result object.
-- Returns {status, heading, message, business_status, replay, extras}.
create function public.describe_command_result(p_command_type text, p_result jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_inner jsonb := coalesce(p_result, '{}'::jsonb);
  v_replay boolean := false;
  v_s text;
  v_task jsonb;
  v_status text;
  v_message text;
  v_suffix text := '';
  v_ref text := '';
  v_follow text := '';
  v_extras jsonb := '{}'::jsonb;
  v_stage text;
begin
  if jsonb_typeof(v_inner) = 'object' and v_inner ? 'ok' and v_inner ? 'result' then
    v_replay := coalesce((v_inner ->> 'replayed')::boolean, false);
    v_inner := coalesce(v_inner -> 'result', '{}'::jsonb);
  end if;
  if jsonb_typeof(v_inner) <> 'object' then
    v_inner := '{}'::jsonb;
  end if;
  v_s := v_inner ->> 'status';
  v_replay := v_replay or coalesce(v_inner ->> 'replay', '') = 'true' or v_s = 'Replayed';
  v_task := case when jsonb_typeof(v_inner -> 'task') = 'object' then v_inner -> 'task' end;
  if not v_replay then
    if coalesce(v_inner #>> '{readiness,stage_advanced}', '') = 'true'
       and 'ReadyToBook' in (v_inner #>> '{job,workflow_stage}', v_inner #>> '{readiness,workflow_stage}') then
      v_suffix := ' The job is now Ready to Book.';
    elsif coalesce(v_inner #>> '{readiness,stage_demoted}', '') = 'true' then
      v_suffix := ' The job has moved back to Prebooking until this task is done again.';
    end if;
  end if;
  if nullif(btrim(coalesce(v_inner ->> 'job_ref', '')), '') is not null then
    v_ref := ' ' || btrim(v_inner ->> 'job_ref');
  end if;

  case p_command_type
    when 'TASK_COMPLETE' then
      if v_s = 'FollowUpRequired' or (v_replay and v_task is not null and v_task ->> 'status' <> 'Complete'
                                      and nullif(btrim(coalesce(v_task ->> 'blocking_reason', '')), '') is not null) then
        if app.result_date_label(v_task ->> 'next_followup_at') <> '' then
          v_follow := ' Next follow-up: ' || app.result_date_label(v_task ->> 'next_followup_at') || '.';
        end if;
        v_status := 'FollowUpRequired';
        v_message := coalesce($j${
          "PRE01_INVOICE_SEND_FAILED": "Saved. The deposit invoice was not sent, so this task is waiting for follow-up.",
          "PRE02_AWAITING_SIGNATURE": "Saved. The contract is recorded as sent and awaiting signature, so this task is waiting for follow-up.",
          "PRE03_DEPOSIT_NOT_RECEIVED": "Saved. The deposit hasn't arrived in the bank yet, so this task is waiting for follow-up.",
          "PRE03_DEPOSIT_AMOUNT_MISMATCH": "Saved. The bank amount doesn't match the expected deposit, so this task is waiting for follow-up. Check the amount with the customer.",
          "PRE04_VALUE_MISMATCH": "Saved. The verified value doesn't match the contract value, so this task is waiting for review.",
          "PRE04_CUSTOMER_DETAILS_MISMATCH": "Saved. The customer details need correcting, so this task is waiting for review.",
          "PRE04_SOLD_VALUE_MISMATCH": "Saved. The sold value needs checking, so this task is waiting for review."
        }$j$::jsonb ->> (v_task ->> 'blocking_reason'), 'Saved. This task is waiting for follow-up.') || v_follow;
      elsif v_s = 'Completed' or (v_replay and v_task ->> 'status' = 'Complete') then
        v_status := 'Succeeded'; v_message := 'Task completed successfully.' || v_suffix;
      elsif v_replay then
        v_status := 'Succeeded'; v_message := 'This request was already processed.';
      end if;
    when 'TASK_REOPEN' then
      if v_s = 'Reopened' or v_replay then
        v_status := 'Succeeded'; v_message := 'Task reopened. It is back in the task list.' || v_suffix;
      end if;
    when 'TASK_EVIDENCE_ATTACH' then
      -- An upload to an open PRE02 is not the signed-contract transition.
      if coalesce(v_inner ->> 'completion_required', '') = 'true' or v_s = 'EvidenceUploaded' then
        v_status := 'FollowUpRequired';
        v_message := 'Signed contract evidence uploaded. Complete the contract task to confirm it is signed.';
      elsif v_s = 'Attached' or v_replay then
        v_status := 'Succeeded'; v_message := 'Contract evidence added.' || v_suffix;
      end if;
    when 'DEPOSIT_CONFIRM' then
      if v_s = 'Confirmed' or (v_replay and v_s is distinct from 'AlreadyConfirmed') then
        v_status := 'Succeeded'; v_message := 'Deposit confirmed.' || v_suffix;
      elsif v_s = 'AlreadyConfirmed' then
        v_status := 'Succeeded'; v_message := 'The deposit was already confirmed. Nothing else is needed.';
      end if;
    -- The sale is public.submit_presale (Job Sold); SOLD_INTAKE no longer exists.
    when 'SUBMIT_PRESALE' then
      v_status := 'Succeeded';
      if v_replay then
        v_message := 'This sale was already recorded' || case when v_ref <> '' then ' as job' || v_ref else '' end
                     || '. No new job was created.';
      else
        v_message := case when v_ref <> '' then 'New job created:' || v_ref || '.' else 'New job created.' end;
      end if;
    when 'BOOKING_INTAKE' then
      if v_s = 'Review' then
        v_status := 'FollowUpRequired'; v_message := 'The booking was saved but needs checking in Intake Review.';
      elsif coalesce(v_inner ->> 'duplicate', '') = 'true' then
        v_status := 'Succeeded';
        v_message := 'This booking was already recorded' || case when v_ref <> '' then ' for job' || v_ref else '' end || '.';
      elsif v_s = 'Processed' or v_replay then
        v_status := 'Succeeded';
        v_message := 'Booking saved' || case when v_ref <> '' then ' for job' || v_ref else '' end || '.'
          || case v_inner ->> 'workflow_stage' when 'BookingInProgress' then ' The job is now Booking In Progress.'
                                               when 'Booked' then ' The job is now Booked.' else '' end;
      end if;
    when 'ISSUE_CREATE' then
      if v_s = 'Created' or v_replay then v_status := 'Succeeded'; v_message := 'Issue raised.'; end if;
    when 'ISSUE_UPDATE' then
      if v_s = 'Updated' or v_replay then v_status := 'Succeeded'; v_message := 'Issue updated.'; end if;
    when 'CALL_RECORD' then
      if v_s = 'Recorded' or v_replay then v_status := 'Succeeded'; v_message := 'Call recorded.'; end if;
    when 'PLANNER_UPDATE' then
      if v_s = 'Updated' or v_replay then v_status := 'Succeeded'; v_message := 'Planned dates updated.'; end if;
    when 'MOVE_JOB' then
      if v_s = 'Moved' or (v_replay and v_s is distinct from 'NeedsReview') then
        v_status := 'Succeeded'; v_message := 'Job moved.';
      elsif v_s = 'NeedsReview' then
        v_status := 'ActionRequired';
        v_message := 'The move needs checking before it can go ahead' || app.result_reason_suffix(v_inner ->> 'reason') || '.';
      end if;
    when 'CHANGE_INSTALLER' then
      if v_s in ('Moved', 'Planned', 'Replaced', 'Added') or (v_replay and v_s is distinct from 'NeedsReview') then
        v_status := 'Succeeded'; v_message := 'Installer changed.';
      elsif v_s = 'NeedsReview' then
        v_status := 'ActionRequired';
        v_message := 'The installer change needs checking before it can go ahead'
                     || app.result_reason_suffix(v_inner ->> 'reason') || '.';
      end if;
    when 'CANCEL_JOB' then
      v_status := 'Succeeded';
      v_message := 'Job cancellation recorded.' || case when app.result_truthy(v_inner -> 'review') then ' Some items need review.' else '' end;
    when 'REINSTATE_JOB' then
      v_status := 'Succeeded';
      v_message := 'Job reinstated.' || case when app.result_truthy(v_inner -> 'review') then ' Some items need review.' else '' end;
    when 'OPERATIONAL_COMPLETE' then
      if v_s = 'Completed' then
        v_status := 'Succeeded'; v_message := 'Job marked operationally complete.';
      elsif v_s = 'AlreadyComplete' then
        v_status := 'Succeeded'; v_message := 'The job was already operationally complete. Nothing else is needed.';
      elsif v_s = 'NeedsReview' then
        v_status := 'ActionRequired';
        v_message := 'The job can''t be marked operationally complete yet. Check the outstanding items on the job.';
      end if;
    when 'CONFIRM_BOOKING' then
      if v_s = 'AlreadyBooked' then
        v_status := 'Succeeded'; v_message := 'This booking was already confirmed. Nothing else is needed.';
      elsif v_s = 'Booked' or v_replay then
        v_status := 'Succeeded'; v_message := 'Booking confirmed. The customer email and calendar checks are now on the job.';
      end if;
    when 'BOOKING_GATES' then
      if v_s in ('ReadyToBook', 'Booked') then
        v_status := 'Succeeded';
        v_message := 'Booking checks passed. The job is ' || case when v_s = 'Booked' then 'Booked.' else 'Ready to Book.' end;
      elsif v_s in ('Blocked', 'NeedsReview') then
        v_status := 'FollowUpRequired';
        v_message := 'Booking checks aren''t complete yet. Check the outstanding tasks on the job.';
      end if;
    when 'IW_START' then v_status := 'Succeeded'; v_message := 'Work started.';
    when 'IW_PROGRESS' then v_status := 'Succeeded'; v_message := 'Progress update saved.';
    when 'IW_REPORT_COMPLETION' then
      v_status := 'Succeeded';
      v_message := case when v_s = 'ReturnRequired' then 'Return visit recorded. The office will arrange it.'
                        else 'Completion reported. The office will confirm it.' end;
    when 'IW_REPORT_PROBLEM' then v_status := 'Succeeded'; v_message := 'Problem reported.';
    when 'IW_REPORT_VARIATION' then v_status := 'Succeeded'; v_message := 'Variation reported.';
    when 'IW_COMMISSIONING_DRAFT' then v_status := 'Succeeded'; v_message := 'Commissioning draft saved.';
    when 'IW_COMMISSIONING_SUBMIT' then v_status := 'Succeeded'; v_message := 'Commissioning submitted for review.';
    when 'COMMISSIONING_REVIEW' then
      v_status := 'Succeeded';
      v_message := case when v_s = 'Returned' then 'Commissioning returned to the installer.' else 'Commissioning review saved.' end;
    when 'GOODS_IN_RECEIVE' then
      v_status := 'Succeeded';
      v_message := 'Delivery received.' || case when v_inner ->> 'complete' = 'false' then ' Some lines are still outstanding.' else '' end;
    when 'STOCK_QUARANTINE' then v_status := 'Succeeded'; v_message := 'Stock moved to quarantine.';
    else
      null;
  end case;

  if v_status is null then
    if coalesce(v_s, '') in ('NeedsReview', 'Review', 'Blocked', 'Failed', 'Refused') then
      v_status := 'ActionRequired';
      v_message := 'The request was received but needs checking before it can go ahead.';
    else
      v_status := 'Succeeded'; v_message := 'Request completed successfully.';
    end if;
  end if;

  if v_status in ('Succeeded', 'FollowUpRequired') then
    if p_command_type in ('SUBMIT_PRESALE', 'BOOKING_INTAKE') then
      v_extras := jsonb_build_object('result_job_id', v_inner -> 'job_id', 'result_job_ref', v_inner -> 'job_ref',
                                     'result_version', v_inner -> 'version');
      if p_command_type = 'BOOKING_INTAKE' then
        v_extras := v_extras || jsonb_build_object('result_workflow_stage', v_inner -> 'workflow_stage');
      end if;
    elsif p_command_type = 'ISSUE_CREATE' then
      v_extras := jsonb_build_object('result_issue_id', v_inner -> 'issue_id');
    elsif p_command_type = 'DEPOSIT_CONFIRM' then
      v_extras := jsonb_build_object('result_stage_id', v_inner #> '{deposit,stage_id}');
    end if;
    v_extras := coalesce((select jsonb_object_agg(k, v) from jsonb_each(jsonb_strip_nulls(v_extras)) e(k, v)
                          where v <> '""'::jsonb), '{}'::jsonb);
  end if;
  v_stage := coalesce(v_inner ->> 'workflow_stage', v_inner #>> '{job,workflow_stage}');

  return jsonb_strip_nulls(jsonb_build_object(
    'status', v_status, 'heading', app.result_heading(v_status), 'message', v_message,
    'command_type', p_command_type, 'business_status', v_s, 'replay', v_replay,
    'task_status', v_task ->> 'status', 'blocking_reason', v_task ->> 'blocking_reason',
    'job_ref', v_inner ->> 'job_ref', 'workflow_stage', v_stage, 'extras', v_extras));
end
$$;

create function app.result_reason_suffix(p_reason text)
returns text
language sql immutable
set search_path = ''
as $$
  select case when nullif(btrim(coalesce(p_reason, '')), '') is null then ''
    else ': ' || btrim(lower(replace(regexp_replace(p_reason, '^(R1[ACU]|S[0-9]+)_', ''), '_', ' '))) end
$$;

create function app.result_truthy(p_value jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case when p_value is null or jsonb_typeof(p_value) = 'null' then false
              when jsonb_typeof(p_value) = 'boolean' then p_value::text::boolean
              when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) > 0
              when jsonb_typeof(p_value) = 'object' then p_value <> '{}'::jsonb
              when jsonb_typeof(p_value) = 'string' then p_value #>> '{}' <> ''
              else p_value::text <> '0' end
$$;

-- =============================================================================
-- Row-level security for the port's (non-canonical) tables
--
-- The canonical identity / Job Sold tables (people, roles, person_roles,
-- skills, person_skills, audit_events, customers, jobs, presales,
-- task_templates, tasks, task_assignment_rules, commands, role_permissions,
-- permissions) keep their own grants and policies; nothing here touches them.
--
-- Visibility of the other tables (REF-02 §2.4 read-side matrix, §12 Q14):
--   * unknown / inactive / role-less users see nothing;
--   * job data follows the canonical jobs policy: a child row is visible when
--     its job is (exists on public.jobs runs under that policy), so the
--     port never disagrees with the canonical job visibility;
--   * task history follows the canonical tasks policy the same way;
--   * installers see the packages they hold an active allocation on, their
--     own and their crew's active allocations, the equipment on those
--     packages and their own commissioning submissions;
--   * a person sees their own availability; office class see everyone's;
--   * configuration/reference tables: any active actor;
--   * journals, outbox, health, archive, raw intake, settings, mapping
--     rules: Admin/Manager (office managers also see Intake Review rows);
--   * finance: rows of visible jobs, plus the Finance role; stock: Store.
-- No client insert/update/delete on operational tables: every write goes
-- through public.execute_command. Configuration tables accept direct
-- insert/update from Admin/Manager (and Office for the resource-planning
-- tables); rows are never deleted (deactivate instead).
-- Policies use the identity foundation's helpers (app.is_admin(),
-- app.is_office_class(), app.is_office_manager(), app.is_director_class(),
-- app.is_active_actor(), app.has_any_role(), app.current_person_id()).
-- =============================================================================

-- Work packages the signed-in person holds an active allocation on.
-- SECURITY DEFINER so the allocations policy can use it without recursing.
create function app.rls_allocated_work_package_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct a.work_package_id from public.allocations a
  where a.person_id = app.current_person_id() and a.active and app.is_active_actor()
$$;

-- Privileges on the port's tables: nothing for anon; authenticated reads
-- what RLS admits.
do $$
declare
  v_table text;
begin
  for v_table in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in ('people', 'roles', 'person_roles', 'skills', 'person_skills', 'audit_events',
                            'customers', 'jobs', 'presales', 'task_templates', 'tasks', 'task_assignment_rules',
                            'commands', 'role_permissions', 'permissions')
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
    execute format('grant all on public.%I to service_role', v_table);
  end loop;
end
$$;

grant insert, update on public.person_availability, public.teams, public.team_members, public.companies,
                        public.contacts, public.products, public.stock_locations, public.holidays,
                        public.release_modes
  to authenticated;
-- Settings are versioned rows: a change is a new row, never an update.
grant insert on public.settings to authenticated;

-- ---- Resource planning: configured by Admin / Manager / Office (reference RP_CONFIG_ROLES) ----
create policy person_availability_select on public.person_availability for select to authenticated
  using (((select app.is_active_actor()) and person_id = (select app.current_person_id()))
         or (select app.is_office_class()));
create policy person_availability_insert on public.person_availability for insert to authenticated
  with check ((select app.is_office_manager()));
create policy person_availability_update on public.person_availability for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy teams_select on public.teams for select to authenticated using ((select app.is_active_actor()));
create policy teams_insert on public.teams for insert to authenticated with check ((select app.is_office_manager()));
create policy teams_update on public.teams for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy team_members_select on public.team_members for select to authenticated using ((select app.is_active_actor()));
create policy team_members_insert on public.team_members for insert to authenticated with check ((select app.is_office_manager()));
create policy team_members_update on public.team_members for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

-- ---- Reference / configuration data: readable by any active actor; Admin/Manager maintain ----
create policy companies_select on public.companies for select to authenticated using ((select app.is_active_actor()));
create policy companies_insert on public.companies for insert to authenticated with check ((select app.is_admin()));
create policy companies_update on public.companies for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy contacts_select on public.contacts for select to authenticated using ((select app.is_active_actor()));
create policy contacts_insert on public.contacts for insert to authenticated with check ((select app.is_admin()));
create policy contacts_update on public.contacts for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy products_select on public.products for select to authenticated using ((select app.is_active_actor()));
create policy products_insert on public.products for insert to authenticated with check ((select app.is_admin()));
create policy products_update on public.products for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy stock_locations_select on public.stock_locations for select to authenticated using ((select app.is_active_actor()));
create policy stock_locations_insert on public.stock_locations for insert to authenticated with check ((select app.is_admin()));
create policy stock_locations_update on public.stock_locations for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy holidays_select on public.holidays for select to authenticated using ((select app.is_active_actor()));
create policy holidays_insert on public.holidays for insert to authenticated with check ((select app.is_admin()));
create policy holidays_update on public.holidays for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Release mode status is visible to every active actor (the UI shows what is
-- switched off); only Admin/Manager change it.
create policy release_modes_select on public.release_modes for select to authenticated using ((select app.is_active_actor()));
create policy release_modes_insert on public.release_modes for insert to authenticated with check ((select app.is_admin()));
create policy release_modes_update on public.release_modes for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Settings: Admin/Manager; a change is a new version row attributed to its author.
create policy settings_select on public.settings for select to authenticated using ((select app.is_admin()));
create policy settings_insert on public.settings for insert to authenticated
  with check ((select app.is_admin()) and changed_by = (select app.current_person_id()));

create policy commissioning_templates_select on public.commissioning_templates for select to authenticated
  using ((select app.is_active_actor()));
create policy commissioning_questions_select on public.commissioning_questions for select to authenticated
  using ((select app.is_active_actor()));
create policy mapping_rules_select on public.mapping_rules for select to authenticated using ((select app.is_admin()));

-- ---- Task history follows the canonical tasks policy ----
create policy task_events_select on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy task_dependencies_select on public.task_dependencies for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));

-- ---- Job-owned rows follow the canonical jobs policy ----
create policy customer_changes_select on public.customer_changes for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));

-- Raw intake payloads: Admin/Manager; office managers see the Intake Review rows.
create policy intake_select on public.intake for select to authenticated
  using ((select app.is_admin()) or ((select app.is_office_manager()) and processing_status = 'Review'));

create policy work_packages_select on public.work_packages for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id)
         or id in (select app.rls_allocated_work_package_ids()));
create policy allocations_select on public.allocations for select to authenticated
  using (((select app.is_active_actor()) and person_id = (select app.current_person_id()))
         -- crew mates: the active allocations on a package the installer works on
         or (active and work_package_id in (select app.rls_allocated_work_package_ids()))
         or ((select app.is_office_class()) and exists (select 1 from public.work_packages w where w.id = work_package_id)));
create policy calls_select on public.calls for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
create policy issues_select on public.issues for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
create policy issue_events_select on public.issue_events for select to authenticated
  using (exists (select 1 from public.issues i where i.id = issue_id));

-- ---- Stock and ordering: Store sees all; others the rows of visible jobs ----
create policy materials_select on public.materials for select to authenticated
  using ((select app.has_any_role('Store')) or exists (select 1 from public.jobs j where j.id = job_id));
create policy orders_select on public.orders for select to authenticated
  using ((select app.has_any_role('Store')) or exists (select 1 from public.jobs j where j.id = job_id));
create policy order_lines_select on public.order_lines for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy deliveries_select on public.deliveries for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy receipt_lines_select on public.receipt_lines for select to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id));
create policy reservations_select on public.reservations for select to authenticated
  using ((select app.has_any_role('Store')) or exists (select 1 from public.materials m where m.id = material_id));
create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select app.is_office_class()) or (select app.has_any_role('Store')));
create policy stocktakes_select on public.stocktakes for select to authenticated
  using ((select app.is_office_class()) or (select app.has_any_role('Store')));
create policy stocktake_lines_select on public.stocktake_lines for select to authenticated
  using ((select app.is_office_class()) or (select app.has_any_role('Store')));
create policy panel_use_select on public.panel_use for select to authenticated
  using ((select app.has_any_role('Store')) or exists (select 1 from public.jobs j where j.id = job_id)
         or ((select app.is_active_actor()) and reported_by = (select app.current_person_id())));

-- ---- Scaffold, communications, calendar ----
-- (The canonical people table has no company link, so the reference's
-- "scaffolder sees own company" rule has nothing to key on.)
create policy scaffold_bookings_select on public.scaffold_bookings for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
create policy communications_select on public.communications for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id)
         or (job_id is null and (select app.is_office_class())));
create policy communication_jobs_select on public.communication_jobs for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
create policy acknowledgements_select on public.acknowledgements for select to authenticated
  using ((select app.is_office_class()));
create policy calendar_links_select on public.calendar_links for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id)
         or ((select app.is_active_actor()) and (select app.current_person_id()) = any (guest_person_ids)));

-- ---- Commissioning, evidence, technical, handover ----
create policy commissioning_submissions_select on public.commissioning_submissions for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id)
         or ((select app.is_active_actor()) and installer_id = (select app.current_person_id())));
create policy commissioning_answers_select on public.commissioning_answers for select to authenticated
  using (exists (select 1 from public.commissioning_submissions s where s.id = submission_id));
create policy evidence_select on public.evidence for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
create policy technical_details_select on public.technical_details for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));
create policy job_equipment_select on public.job_equipment for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id)
         or work_package_id in (select app.rls_allocated_work_package_ids()));
create policy handover_select on public.handover for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));

-- ---- Finance: rows of visible jobs (JOB_OVERVIEW finance summary), Finance role all ----
create policy finance_plans_select on public.finance_plans for select to authenticated
  using ((select app.has_any_role('Finance')) or exists (select 1 from public.jobs j where j.id = job_id));
create policy invoice_stages_select on public.invoice_stages for select to authenticated
  using ((select app.has_any_role('Finance')) or exists (select 1 from public.jobs j where j.id = job_id));
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.invoice_stages s where s.id = invoice_stage_id));
create policy manual_bank_checks_select on public.manual_bank_checks for select to authenticated
  using ((select app.has_any_role('Finance'))
         or ((select app.is_director_class()) and exists (select 1 from public.jobs j where j.id = job_id)));
create policy accounting_events_select on public.accounting_events for select to authenticated
  using ((select app.is_director_class()) or (select app.has_any_role('Finance')));
create policy job_costs_select on public.job_costs for select to authenticated
  using ((select app.is_director_class()) or (select app.has_any_role('Finance')));
create policy report_snapshots_select on public.report_snapshots for select to authenticated
  using ((select app.is_director_class()) or (select app.has_any_role('Finance')));
create policy ghl_tasks_select on public.ghl_tasks for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id));

-- ---- Server journals: Admin/Manager only ----
create policy commit_journal_select on public.commit_journal for select to authenticated using ((select app.is_admin()));
create policy outbox_select on public.outbox for select to authenticated using ((select app.is_admin()));
create policy health_checks_select on public.health_checks for select to authenticated using ((select app.is_admin()));
create policy archive_index_select on public.archive_index for select to authenticated using ((select app.is_admin()));

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke execute on function public.execute_read(jsonb), public.describe_command_error(text, text, text),
  public.describe_command_result(text, jsonb) from public, anon;
grant execute on function public.execute_read(jsonb), public.describe_command_error(text, text, text),
  public.describe_command_result(text, jsonb) to authenticated, service_role;

-- Helpers the result catalogue and due_window call run as the caller.
grant execute on function app.result_heading(text), app.result_message(text), app.result_error_catalogue(),
  app.result_field_label(text), app.result_date_label(text), app.result_reason_suffix(text),
  app.result_truthy(jsonb), app.due_window(timestamptz, date)
  to authenticated, service_role;

-- RLS helper evaluated as the querying user.
grant execute on function app.rls_allocated_work_package_ids() to authenticated, service_role;

grant execute on all functions in schema app to service_role;
