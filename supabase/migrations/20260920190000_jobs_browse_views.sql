-- =============================================================================
-- Browsing historical jobs, without letting them into operational scope.
--
-- The Jobs screen could show the 2 live jobs, and could FIND an imported job
-- if you already knew something to search for, but there was no way to browse
-- the 277 archived records - JOB_SEARCH demands a query and returns at most 50
-- rows with no total, and JOBS is scoped to live work.
--
-- Rather than weaken app.job_in_scope (which would make historical records
-- operational everywhere, including the command path), the canonical JOBS read
-- gains an optional `view`:
--
--   active      (the default, and what every existing caller gets)
--               exactly today's predicate, app.job_in_scope
--   historical  record_class = 'HistoricalImport'
--   all         both
--
-- and an optional `offset`, so the archive can be paged rather than loaded in
-- one lump. It also returns `counts`, so the screen can label the views with
-- authoritative numbers instead of hard-coding them, and `record_class` per
-- row so an archived record can be badged.
--
-- Visibility is unchanged: every row still passes app.can_read_job, the same
-- check the operational list and Job Search already use. Nothing here grants a
-- permission, relaxes a policy, or makes a historical job actionable -
-- app.job_in_scope and app.job_actionable are untouched.
--
-- Omitting `view` and `offset` reproduces the previous behaviour exactly.
-- =============================================================================

create or replace function app.read_jobs(p_request jsonb, p_actor jsonb)
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
  v_view text := lower(coalesce(app.req_text(p_request, 'view'), 'active'));
  v_offset int := greatest(coalesce((app.req_text(p_request, 'offset'))::int, 0), 0);
  v_counts jsonb;
  v_today date := app.london_date(now());
  v_rows jsonb;
  v_total int;
begin
  perform app.req_keys(p_request, array['q', 'stage', 'limit', 'view', 'offset']);
  if v_view not in ('active', 'historical', 'all') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'view'));
  end if;
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
    where (case v_view
             when 'active' then app.job_in_scope(j)
             when 'historical' then j.record_class = 'HistoricalImport'
             else true
           end)
      and app.can_read_job(p_actor, j.id)
      and (v_stages is null or j.workflow_stage = any (v_stages))
      and (v_query is null or exists (
            select 1
            from unnest(array[j.job_ref, j.quote_reference, j.display_name,
                              app.s17_customer_name(c.first_name, c.last_name), c.postcode, c.address_line1,
                              c.town, c.email, c.phone,
                              -- An imported job is as likely to be looked up by
                              -- the reference the office used before this system
                              -- as by its new job_ref, exactly as JOB_SEARCH does.
                              j.source_reference]) as f(v)
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
      'record_class', v.record_class,
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
                                               limit v_limit offset v_offset) x), '[]'::jsonb)
    into v_total, v_rows;
  -- Authoritative per-view totals over the jobs this actor may read, so the
  -- screen never hard-codes them.
  select jsonb_build_object(
           'active', count(*) filter (where app.job_in_scope(j)),
           'historical', count(*) filter (where j.record_class = 'HistoricalImport'),
           'all', count(*))
    into v_counts
    from public.jobs j where app.can_read_job(p_actor, j.id);
  return jsonb_build_object('q', v_query, 'stage', v_stages, 'view', v_view, 'offset', v_offset,
                            'count', jsonb_array_length(v_rows), 'total', v_total,
                            'truncated', v_total > v_offset + jsonb_array_length(v_rows),
                            'counts', v_counts, 'jobs', v_rows);
end
$$;
