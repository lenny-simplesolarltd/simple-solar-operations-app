-- =============================================================================
-- Planner: the historical overlay.
--
-- 277 imported jobs carry genuine dates from the old Job Booking form, and the
-- office wants to see them beside current work. Showing them must not make
-- them operational, so this migration adds a READ PROJECTION and nothing else:
-- no work packages, no allocations, no tasks, no scaffold bookings, no
-- availability. Not one operational row is created to display a fact.
--
-- Where the dates live
-- --------------------
-- The import (20260920160000) writes the whole candidate to
-- intake.raw_payload_json and creates no scheduling rows at all. Three fields
-- under `historicalFacts` are genuine booked work dates, and they are the only
-- ones represented here:
--
--   historicalFacts.work.roofDate        CSV "Date Roofer"       252 of 277
--   historicalFacts.work.electricalDate  CSV "Date Sparky"       263 of 277
--   historicalFacts.scaffold.erectDate   CSV "Date Scaffolding"  196 of 277
--
-- Deliberately NOT events:
--   jobs.sold_at                            when the form was submitted
--   historicalFacts.commercial.invoiceIntentDate
--                                           an office intention to invoice,
--                                           which the importer already refused
--                                           to write to invoice_stages
--   the repurposed panel-count column       never imported; ambiguous meaning
--
-- There is no "install date" column in the source, so no Install event type is
-- invented. A one-day install appears as a Roof and an Electrical event on the
-- same day, which is what the form actually recorded.
--
-- Authorization
-- -------------
-- app.can_read_job, the same predicate the job reads use - NOT app.job_in_scope,
-- which is false for every historical row and would hide the lot. This mirrors
-- 20260920200000_read_authorize_by_readability: being allowed to READ a record
-- and being allowed to WORK on it are different questions. job_in_scope and
-- job_actionable are untouched and stay false.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The projection
-- -----------------------------------------------------------------------------

-- One row per genuine preserved work date. A view, not a table: there is
-- nothing here that is not already in intake, and a copy could drift from it.
--
-- `source_field` names the CSV column the date came from, so the panel can say
-- where a fact originated instead of asserting it.
create view app.historical_work_events as
select
  i.job_id,
  e.kind,
  d.event_date,
  e.source_field,
  i.id as intake_id
from public.intake i
join public.jobs j on j.id = i.job_id and j.record_class = 'HistoricalImport'
cross join lateral (values
  ('Roof',
   nullif(i.raw_payload_json #>> '{historicalFacts,work,roofDate}', ''),
   'Date Roofer'),
  ('Electrical',
   nullif(i.raw_payload_json #>> '{historicalFacts,work,electricalDate}', ''),
   'Date Sparky'),
  ('ScaffoldErect',
   nullif(i.raw_payload_json #>> '{historicalFacts,scaffold,erectDate}', ''),
   'Date Scaffolding')
) as e(kind, raw_date, source_field)
cross join lateral (
  -- The importer already validated and normalised these to ISO, so a cast is
  -- safe; the guard is here so one malformed future import cannot break the
  -- planner for everyone.
  select case when e.raw_date ~ '^\d{4}-\d{2}-\d{2}$' then e.raw_date::date end
) as d(event_date)
where e.raw_date is not null and d.event_date is not null;

comment on view app.historical_work_events is
  'Read projection of the genuine work dates preserved by the historical Job '
  'Booking import. Never a schedule: no operational row exists behind any of '
  'these, and nothing here is actionable.';

revoke all on app.historical_work_events from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Historical events in a window, for one actor
-- -----------------------------------------------------------------------------

-- Staff as the source recorded them. A link only where the import was certain
-- (the historical_job_people CHECK enforces that), and the original text
-- always - so the planner can show "Dave" without deciding which Dave.
create function app.historical_event_people(p_job_id uuid, p_kind text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'role', hp.role,
           'source_value', hp.source_value,
           'match_kind', hp.match_kind,
           -- Null unless the import resolved it to exactly one active person.
           'person_id', hp.person_id,
           'display_name', (select p.display_name from public.people p where p.id = hp.person_id),
           'linked', hp.person_id is not null)
         order by hp.role, hp.source_value), '[]')
  from public.historical_job_people hp
  where hp.job_id = p_job_id
    -- The source's own role vocabulary. Salesperson is never an event's
    -- staff: they sold the job, they did not turn up to it.
    and hp.role = any (case p_kind
                         when 'Roof' then array['Installer', 'Roofer']
                         when 'Electrical' then array['Electrician']
                         when 'ScaffoldErect' then array['Scaffolder']
                         else array[]::text[]
                       end)
$$;

create function app.planner_historical_window(p_actor jsonb, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(r order by r ->> 'event_date', r ->> 'job_ref', r ->> 'kind'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'job_id', e.job_id,
      'job_ref', j.job_ref,
      'job_display', nullif(j.display_name, ''),
      'kind', e.kind,
      'event_date', e.event_date,
      -- Every one of these is a fact about the past, never a plan.
      'read_only', true,
      'record_class', j.record_class,
      'town', c.town,
      'postcode', c.postcode,
      'source_field', e.source_field,
      'source_system', j.source_system,
      'source_reference', j.source_reference,
      'scaffold_company', case when e.kind = 'ScaffoldErect'
        then nullif(i.raw_payload_json #>> '{historicalFacts,scaffold,companyName}', '') end,
      'people', app.historical_event_people(e.job_id, e.kind)) as r
    from app.historical_work_events e
    join public.jobs j on j.id = e.job_id
    join public.intake i on i.id = e.intake_id
    left join public.customers c on c.id = j.customer_id
    where e.event_date between p_from and p_to
      -- Canonical readability, not operational scope.
      and app.can_read_job(p_actor, e.job_id)
  ) s
$$;

comment on function app.planner_historical_window(jsonb, date, date) is
  'Historical work dates inside a window, for the jobs this actor may read. '
  'Read-only projection; authorises with app.can_read_job, never job_in_scope.';

-- -----------------------------------------------------------------------------
-- 3. Live rows gain the address fields historical rows already carry
-- -----------------------------------------------------------------------------

-- Planner search covers customer, job reference and postcode. Historical
-- events get town and postcode from this migration's projection; without the
-- same two fields on live rows, searching "Plymouth" would find imported work
-- and silently miss current work in the same town. Same shape both sides, one
-- field list. Otherwise identical to the 20260920220000 definition.
create or replace function app.planner_window_rows(p_from date, p_to date)
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
             'town', c.town, 'postcode', c.postcode,
             'start_at', coalesce(a.start_at, w.planned_start), 'end_at', coalesce(a.end_at, w.planned_end)) as r,
           coalesce(a.start_at, w.planned_start) as s_at, coalesce(j.job_ref, w.job_id::text, '') as jref,
           w.trade, w.id as wp_id, coalesce(a.id::text, '') as alloc
    from public.work_packages w
    join public.jobs j on j.id = w.job_id and j.record_class = 'Live'
    left join public.customers c on c.id = j.customer_id
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
             'town', c.town, 'postcode', c.postcode,
             'job_ref', j.job_ref, 'job_display', nullif(j.display_name, '')) as r,
           k.d, sb.id
    from public.scaffold_bookings sb
    join public.jobs j on j.id = sb.job_id and j.record_class = 'Live'
    left join public.customers c on c.id = j.customer_id
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

-- -----------------------------------------------------------------------------
-- 4. PLANNER_WINDOW gains a records mode
-- -----------------------------------------------------------------------------

-- Replaces the 20260920220000 definition, which is already deployed: the
-- window, the 186-day cap and the live payload are unchanged, and `records`
-- defaults to 'live' so every existing caller keeps exactly what it had.
--
-- The filter is applied HERE, in the database, for the requested window -
-- never by fetching everything and hiding some of it in the browser.
create or replace function app.read_planner_window(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
  v_days int;
  v_records text;
  v_live jsonb;
begin
  perform app.r2cal_read_keys(p_request, array['from', 'to', 'records']);
  v_from := coalesce(app.r2cal_opt_date(p_request, 'from'), app.london_date(now()));
  v_to := coalesce(app.r2cal_opt_date(p_request, 'to'), v_from + 20);
  if v_to < v_from then
    perform app.fail('RP_REVIEW: the end of the window is before its start');
  end if;
  v_days := (v_to - v_from) + 1;
  if v_days > 186 then
    perform app.fail('RP_REVIEW: a planner window covers at most 186 days');
  end if;

  v_records := coalesce(nullif(btrim(p_request ->> 'records'), ''), 'live');
  if v_records not in ('live', 'historical', 'both') then
    perform app.fail('RP_REVIEW: records must be live, historical or both');
  end if;

  -- Live work is skipped entirely in historical-only mode, rather than
  -- computed and discarded.
  v_live := case when v_records in ('live', 'both')
                 then app.planner_window_rows(v_from, v_to)
                 else jsonb_build_object('rows', '[]'::jsonb, 'scaffold', '[]'::jsonb) end;

  return v_live || jsonb_build_object(
    'from', v_from, 'to', v_to, 'days', v_days, 'records', v_records,
    'holidays', (select coalesce(jsonb_agg(h.local_date order by h.local_date), '[]')
                 from public.holidays h
                 where h.office_closed and h.local_date between v_from and v_to),
    'historical', case when v_records in ('historical', 'both')
                       then app.planner_historical_window(p_actor, v_from, v_to)
                       else '[]'::jsonb end);
end
$$;

-- -----------------------------------------------------------------------------
-- 5. A count, so an empty live window can offer what is actually there
-- -----------------------------------------------------------------------------

-- The planner opens on live work. When a window has none, it should be able to
-- say "12 historical records have dates here" without fetching them, and
-- without the browser counting 277 rows it was never sent.
create function app.read_planner_historical_count(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
begin
  perform app.r2cal_read_keys(p_request, array['from', 'to']);
  v_from := coalesce(app.r2cal_opt_date(p_request, 'from'), app.london_date(now()));
  v_to := coalesce(app.r2cal_opt_date(p_request, 'to'), v_from + 20);
  if v_to < v_from or (v_to - v_from) + 1 > 186 then
    perform app.fail('RP_REVIEW: a planner window covers at most 186 days');
  end if;
  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'events', (select count(*) from app.historical_work_events e
               where e.event_date between v_from and v_to
                 and app.can_read_job(p_actor, e.job_id)),
    'jobs', (select count(distinct e.job_id) from app.historical_work_events e
             where e.event_date between v_from and v_to
               and app.can_read_job(p_actor, e.job_id)));
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('PLANNER_HISTORICAL_COUNT', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'],
   '[]', 'planner',
   'How many historical events fall in a window, without returning them; {from?, to?}')
on conflict (read_type) do nothing;

update app.read_registry
   set notes = 'Operations calendar: scheduled work and scaffold between two dates; '
               '{from?, to?, records? live|historical|both}'
 where read_type = 'PLANNER_WINDOW';
