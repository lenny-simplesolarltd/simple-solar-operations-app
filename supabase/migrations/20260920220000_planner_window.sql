-- =============================================================================
-- Planner: date-windowed reads for the operations calendar.
--
-- The calendar surface needs two things the existing reads cannot give it, and
-- nothing else. No table changes, no new business rules: both functions are
-- stable, read-only, and derive everything from the same rows the R1 planner
-- read already serves.
--
--   PLANNER_WINDOW       app.read_planner (S17) answers a fixed 3 or 6 weeks
--                        from a date. A calendar whose user can pick Day,
--                        Week, 3 weeks, 6 weeks or Month has to ask for the
--                        range it is actually showing, or every view but one
--                        over-fetches. Same row and scaffold shapes as
--                        app.read_planner, so the client types are unchanged.
--
--   PLANNER_UNSCHEDULED  RP_TEAM_PLANNER.unallocated_work means "planned, but
--                        nobody allocated". Work that has no dates at all is
--                        returned by no read, so the planner cannot offer a
--                        "needs scheduling" list. Readiness here is the
--                        predicate the scheduling command itself applies
--                        (app.job_actionable + a live, non-cancelled package),
--                        not a new one.
--
-- Both are registered for the roles that already hold RP_TEAM_PLANNER, and
-- both are bounded: the window is capped and the unscheduled list is limited.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PLANNER_WINDOW: {from?, to?} -> the scheduled work and scaffold in a range
-- -----------------------------------------------------------------------------

-- The rows a calendar draws between two dates. Body is app.read_planner's,
-- with the window taken from the request instead of a week count, and with
-- record_class asserted rather than assumed.
--
-- HistoricalImport jobs have no work packages, allocations or scaffold
-- bookings (the import writes customers, jobs, technical_details,
-- historical_job_people and intake only), so they cannot reach this read by
-- construction. The join condition states it anyway: a calendar is an
-- operational surface, and "cannot happen today" is worth one predicate.
create function app.planner_window_rows(p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with wp_rows as (
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
    join public.jobs j on j.id = w.job_id and j.record_class = 'Live'
    left join public.allocations a on a.work_package_id = w.id and a.active
    where w.planned_start is not null and w.planned_end is not null
      and w.planned_end >= p_from and w.planned_start <= p_to
      and w.status <> 'Cancelled'
  ),
  scaffold as (
    select jsonb_build_object('job_id', sb.job_id, 'scaffold_booking_id', sb.id, 'company_id', sb.company_id,
             'company', co.name, 'kind', k.kind, 'date', k.d, 'status', sb.status, 'revision', sb.revision,
             'acknowledged', coalesce(sb.confirmed_revision, 0) >= coalesce(sb.revision, 0),
             'confirmed', k.confirmed, 'actual_recorded', k.actual,
             'job_ref', j.job_ref, 'job_display', nullif(j.display_name, '')) as r,
           k.d, sb.id
    from public.scaffold_bookings sb
    join public.jobs j on j.id = sb.job_id and j.record_class = 'Live'
    left join public.companies co on co.id = sb.company_id
    cross join lateral (values
      ('Erect', sb.erect_planned_at, sb.erect_actual_at is not null, sb.erect_confirmed_at is not null),
      ('Strip', sb.strip_planned_at, sb.strip_actual_at is not null, sb.strip_confirmed_at is not null),
      ('StripForecast', case when sb.strip_planned_at is null and sb.strip_actual_at is null then sb.strip_forecast_at end,
       false, false)) as k(kind, d, actual, confirmed)
    where sb.status <> 'Cancelled' and k.d is not null and k.d between p_from and p_to
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(r order by s_at, jref, trade, wp_id, alloc) from wp_rows), '[]'::jsonb),
    'scaffold', coalesce((select jsonb_agg(r order by d, id) from scaffold), '[]'::jsonb))
$$;

create function app.read_planner_window(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  v_days int;
begin
  perform app.r2cal_read_keys(p_request, array['from', 'to']);
  v_from := coalesce(app.r2cal_opt_date(p_request, 'from'), app.london_date(now()));
  v_to := coalesce(app.r2cal_opt_date(p_request, 'to'), v_from + 20);
  if v_to < v_from then
    perform app.fail('RP_REVIEW: the end of the window is before its start');
  end if;
  v_days := (v_to - v_from) + 1;
  -- A planner shows a month or two, never a history. 186 days is the six-week
  -- view plus a generous buffer; beyond that the caller is asking for a report.
  if v_days > 186 then
    perform app.fail('RP_REVIEW: a planner window covers at most 186 days');
  end if;
  return app.planner_window_rows(v_from, v_to)
    || jsonb_build_object(
         'from', v_from, 'to', v_to, 'days', v_days,
         'holidays', (select coalesce(jsonb_agg(h.local_date order by h.local_date), '[]')
                      from public.holidays h
                      where h.office_closed and h.local_date between v_from and v_to));
end
$$;

-- -----------------------------------------------------------------------------
-- PLANNER_UNSCHEDULED: {limit?} -> work that is ready to schedule but has no slot
-- -----------------------------------------------------------------------------

-- Ready means exactly what PLAN_WORK_PACKAGE means by it, so nothing in this
-- list can be dragged onto the calendar only to be refused for a reason the
-- list could have known: the job is actionable (Live, not archived, not in or
-- past cancellation), the package is required, not cancelled, and has no
-- planned dates. Installer readiness is deliberately NOT pre-computed here -
-- it depends on the dates the user is about to choose, and RP_ASSESS answers
-- it for those dates when they do.
create function app.read_planner_unscheduled(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_limit int;
begin
  perform app.r2cal_read_keys(p_request, array['limit']);
  v_limit := case when jsonb_typeof(p_request -> 'limit') = 'number' and (p_request ->> 'limit')::numeric >= 1
                  then least((p_request ->> 'limit')::numeric, 200)::int else 50 end;
  return jsonb_build_object(
    'generated_at', now(),
    'limit', v_limit,
    'total', (select count(*)
              from public.work_packages w
              join public.jobs j on j.id = w.job_id
              where app.job_actionable(j) and w.required
                and w.status not in ('Cancelled', 'ConfirmedComplete', 'ReportedComplete')
                and (w.planned_start is null or w.planned_end is null)),
    'work', (select coalesce(jsonb_agg(x.r order by x.need_by nulls last, x.jref, x.seq), '[]')
             from (
               select jsonb_build_object(
                        'work_package_id', w.id, 'work_package_version', w.version,
                        'job_id', w.job_id, 'job_ref', j.job_ref, 'job_display', nullif(j.display_name, ''),
                        'trade', w.trade, 'status', w.status, 'need_by_date', w.need_by_date,
                        'sequence', w.sequence, 'workflow_stage', j.workflow_stage,
                        'town', c.town, 'postcode', c.postcode,
                        -- What the office needs to see before choosing dates.
                        'scaffold', (select jsonb_build_object('scaffold_booking_id', sb.id, 'status', sb.status,
                                              'erect_planned_at', sb.erect_planned_at,
                                              'strip_planned_at', sb.strip_planned_at)
                                     from public.scaffold_bookings sb
                                     where sb.job_id = w.job_id and sb.status <> 'Cancelled'
                                     order by sb.erect_planned_at nulls last limit 1),
                        'open_issues', (select count(*) from public.issues i
                                        where i.job_id = w.job_id and i.status not in ('Resolved', 'Closed'))) as r,
                      w.need_by_date as need_by, coalesce(j.job_ref, '') as jref, w.sequence as seq
               from public.work_packages w
               join public.jobs j on j.id = w.job_id
               left join public.customers c on c.id = j.customer_id
               where app.job_actionable(j) and w.required
                 and w.status not in ('Cancelled', 'ConfirmedComplete', 'ReportedComplete')
                 and (w.planned_start is null or w.planned_end is null)
               order by w.need_by_date nulls last, coalesce(j.job_ref, ''), w.sequence
               limit v_limit) x));
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('PLANNER_WINDOW', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'planner',
   'Operations calendar: scheduled work and scaffold between two dates; {from?, to?}'),
  ('PLANNER_UNSCHEDULED', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'planner',
   'Operations calendar: required work on actionable jobs with no planned dates; {limit?}')
on conflict (read_type) do nothing;
