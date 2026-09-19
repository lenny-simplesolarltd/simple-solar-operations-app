-- =============================================================================
-- View port B: read models for the booking screens and Intake Review.
--
--   BOOKING_BOARD       jobs in one booking view (prebooking, ready, in
--                       progress, upcoming) with their gate status, booked
--                       dates, team and the booking commands they allow.
--                       Replaces the AppSheet Booking Queue / Ready to
--                       Continue Booking / Booking In Progress / Upcoming
--                       Booked slices (the task queue stays TASKS queue=booking).
--   BOOKING_FORM        what the Job Booking form starts from: the job, the
--                       current booking, the pick lists (installers,
--                       merchants, scaffolders), the material catalogue, the
--                       gates and whether BOOKING_INTAKE is available.
--   INTAKE_REVIEW_QUEUE intake rows waiting for review with their reasons and
--                       the job's unresolved customer-change proposals.
--
-- Read-only. Visibility is app.can_read_job (canonical permissions); the
-- command availability comes from app.read_action_availability, so the UI
-- only offers what execute_command will accept.
-- =============================================================================

-- Parses the intake validation_errors text (a JSON array written by
-- BOOKING_INTAKE); anything else is returned as one plain message.
create function app.intake_errors(p_text text)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if nullif(btrim(coalesce(p_text, '')), '') is null then
    return '[]'::jsonb;
  end if;
  begin
    v := p_text::jsonb;
  exception when others then
    return jsonb_build_array(jsonb_build_object('error', 'NOTE', 'detail', p_text));
  end;
  return case when jsonb_typeof(v) = 'array' then v
              else jsonb_build_array(jsonb_build_object('error', 'NOTE', 'detail', p_text)) end;
end
$$;

-- The booked dates and team of a job (one row per live work package).
create function app.booking_schedule(p_job_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'roof_date', (select min(w.planned_start) from public.work_packages w
                  where w.job_id = p_job_id and w.trade = 'Roof' and w.status <> 'Cancelled'),
    'electrical_date', (select min(w.planned_start) from public.work_packages w
                        where w.job_id = p_job_id and w.trade = 'Electrical' and w.status <> 'Cancelled'),
    'scaffold_date', (select min(s.erect_planned_at) from public.scaffold_bookings s
                      where s.job_id = p_job_id and s.status <> 'Cancelled'),
    'team', (select coalesce(jsonb_agg(jsonb_build_object('trade', w.trade, 'role', a.role,
                                                           'person_id', a.person_id,
                                                           'name', app.s17_person_name(a.person_id))
                                        order by w.sequence nulls last, a.role), '[]'::jsonb)
             from public.allocations a join public.work_packages w on w.id = a.work_package_id
             where w.job_id = p_job_id and a.active and w.status <> 'Cancelled'))
$$;

-- Gate status in a compact form: {summary, ready, failing: [{name, detail, blocking}]}.
create function app.gate_summary(p_gates jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'summary', p_gates ->> 'summary',
    'ready', coalesce((p_gates ->> 'ready')::boolean, false),
    'failing', coalesce((select jsonb_agg(jsonb_build_object('name', g ->> 'name', 'detail', g ->> 'detail',
                                                             'blocking', coalesce((g ->> 'blocking')::boolean, true)))
                         from jsonb_array_elements(p_gates -> 'gates') g
                         where not coalesce((g ->> 'pass')::boolean, false)), '[]'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- BOOKING_BOARD
-- -----------------------------------------------------------------------------

create function app.read_booking_board(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_view text := coalesce(app.req_text(p_request, 'view'), 'ready');
  v_query text := app.req_text(p_request, 'q');
  v_q text := lower(coalesce(app.req_text(p_request, 'q'), ''));
  v_limit int := app.req_limit(p_request, 100, 300);
  v_today date := app.london_date(now());
  v_stages text[];
  v_rows jsonb;
  v_total int;
  v_counts jsonb;
begin
  perform app.req_keys(p_request, array['view', 'q', 'limit']);
  v_stages := case v_view
    when 'prebooking' then array['Prebooking']
    when 'ready' then array['ReadyToBook']
    when 'in_progress' then array['BookingInProgress']
    when 'upcoming' then array['Booked', 'AwaitingInstallation']
  end;
  if v_stages is null then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'view'));
  end if;

  with visible as (
    select j.*, c.first_name, c.last_name, c.postcode, c.town
    from public.jobs j
    left join public.customers c on c.id = j.customer_id
    where app.job_in_scope(j) and app.can_read_job(p_actor, j.id)
      and j.archived_at is null
  )
  select jsonb_build_object(
           'prebooking', count(*) filter (where workflow_stage = 'Prebooking'),
           'ready', count(*) filter (where workflow_stage = 'ReadyToBook'),
           'in_progress', count(*) filter (where workflow_stage = 'BookingInProgress'),
           'upcoming', count(*) filter (where workflow_stage in ('Booked', 'AwaitingInstallation')))
    into v_counts
  from visible;

  with rows as (
    select j.sold_at, j.job_ref, j.id, j.next_action_at, j.workflow_stage,
           jsonb_build_object(
             'id', j.id, 'job_ref', j.job_ref, 'version', j.version, 'workflow_stage', j.workflow_stage,
             'customer_name', app.s17_customer_name(c.first_name, c.last_name), 'postcode', c.postcode,
             'town', nullif(app.s17_clean(c.town), ''), 'finance_route', j.finance_route, 'sold_at', j.sold_at,
             'salesperson_name', app.s17_person_name(j.salesperson_id),
             'match_status', j.sold_booking_match_status,
             'booking_submitted', j.booking_submission_id is not null,
             'booking_approved_at', j.booking_approved_at,
             'in_review', exists (select 1 from public.intake i where i.job_id = j.id and i.processing_status = 'Review'),
             'open_booking_tasks', (select count(*) from public.tasks t where t.job_id = j.id
                                      and t.task_group in ('Booking', 'Prebooking')
                                      and t.status not in ('Complete', 'Cancelled', 'NotRequired')),
             'schedule', app.booking_schedule(j.id),
             'gates', case
               when j.workflow_stage = 'Prebooking' then app.gate_summary(app.evaluate_ready_to_book(j.id))
               when j.workflow_stage = 'BookingInProgress' then app.gate_summary(app.evaluate_booking_gates(j.id))
             end,
             'commands', (select jsonb_build_object('booking_intake', a #> '{commands,booking_intake}',
                                                    'confirm_booking', a #> '{commands,confirm_booking}')
                          from (select app.read_action_availability(p_actor, j) as a) x)) as row
    from public.jobs j
    left join public.customers c on c.id = j.customer_id
    where j.workflow_stage = any (v_stages)
      and j.archived_at is null
      and app.job_in_scope(j) and app.can_read_job(p_actor, j.id)
      and (v_view <> 'upcoming'
           or exists (select 1 from public.work_packages w where w.job_id = j.id and w.status <> 'Cancelled'
                        and coalesce(w.planned_end, w.planned_start) >= v_today)
           or not exists (select 1 from public.work_packages w where w.job_id = j.id and w.status <> 'Cancelled'))
      and (v_query is null or exists (
            select 1 from unnest(array[j.job_ref, j.quote_reference, app.s17_customer_name(c.first_name, c.last_name),
                                       c.postcode, c.address_line1, c.town]) f(v)
            where strpos(lower(coalesce(app.s17_clean(f.v), '')), v_q) > 0))
  )
  select (select count(*) from rows),
         coalesce((select jsonb_agg(row order by
                     case when v_view = 'upcoming' then coalesce(row #>> '{schedule,roof_date}', row #>> '{schedule,electrical_date}') end nulls last,
                     sold_at, job_ref)
                   from (select * from rows
                         order by case when v_view = 'upcoming'
                                       then coalesce(row #>> '{schedule,roof_date}', row #>> '{schedule,electrical_date}') end nulls last,
                                  sold_at, job_ref
                         limit v_limit) x), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('view', v_view, 'q', v_query, 'as_of', v_today, 'counts', v_counts,
                            'count', jsonb_array_length(v_rows), 'total', v_total,
                            'truncated', v_total > jsonb_array_length(v_rows),
                            'can_confirm', app.is_office_manager(p_actor), 'jobs', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- BOOKING_FORM
-- -----------------------------------------------------------------------------

create function app.read_booking_form(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_customer public.customers;
  v_tech public.technical_details;
  v_scaffold public.scaffold_bookings;
  v_intake public.intake;
  v_avail jsonb;
begin
  perform app.req_keys(p_request, array['job_id']);
  v_job := app.read_authorize_job(p_actor, app.req_text(p_request, 'job_id'));
  select * into v_customer from public.customers where id = v_job.customer_id;
  select * into v_tech from public.technical_details where job_id = v_job.id;
  select * into v_scaffold from public.scaffold_bookings s
  where s.job_id = v_job.id and s.status <> 'Cancelled' order by s.created_at, s.id limit 1;
  select * into v_intake from public.intake i
  where i.job_id = v_job.id and i.form_type = 'Booking' order by i.received_at desc, i.created_at desc limit 1;
  v_avail := app.read_action_availability(p_actor, v_job);

  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', v_job.id, 'job_ref', v_job.job_ref, 'version', v_job.version, 'workflow_stage', v_job.workflow_stage,
      'finance_route', v_job.finance_route, 'roof_required', v_job.roof_required,
      'electrical_required', v_job.electrical_required, 'scaffold_required', v_job.scaffold_required,
      'match_status', v_job.sold_booking_match_status, 'booking_submitted', v_job.booking_submission_id is not null,
      'gross_pence', coalesce(nullif(v_job.current_contract_gross_pence, 0), v_job.original_gross_pence)),
    'customer', jsonb_build_object(
      'first_name', v_customer.first_name, 'last_name', v_customer.last_name,
      'street_address', v_customer.address_line1, 'city', v_customer.town, 'postcode', v_customer.postcode,
      'phone', v_customer.phone, 'email', v_customer.email),
    'current', jsonb_build_object(
      'schedule', app.booking_schedule(v_job.id),
      'scaffold', case when v_scaffold.id is not null then jsonb_build_object(
        'status', v_scaffold.status, 'company_id', v_scaffold.company_id,
        'company', (select co.name from public.companies co where co.id = v_scaffold.company_id),
        'erect_planned_at', v_scaffold.erect_planned_at, 'access_notes', v_scaffold.access_notes) end,
      'merchant', (select jsonb_build_object('id', co.id, 'name', co.name)
                   from public.materials m join public.companies co on co.id = m.merchant_id
                   where m.job_id = v_job.id order by m.created_at limit 1),
      'technical', case when v_tech.id is not null then jsonb_build_object(
        'solar_kw', v_tech.system_kw, 'annual_generation', v_tech.annual_generation_kwh,
        'roofing_notes', v_tech.roof_notes, 'electrical_notes', v_tech.electrical_notes,
        'roof_hooks_type', v_tech.mounting_orientation, 'ordering_notes', v_tech.ordering_notes) end,
      'last_intake', case when v_intake.id is not null then jsonb_build_object(
        'status', v_intake.processing_status, 'received_at', v_intake.received_at,
        'errors', app.intake_errors(v_intake.validation_errors)) end),
    'options', jsonb_build_object(
      'installers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name)
                                               order by p.display_name), '[]'::jsonb)
                     from public.people p
                     where p.active and app.person_has_active_role(p.id, array['Installer'])),
      'merchants', (select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name) order by co.name), '[]'::jsonb)
                    from public.companies co where co.active and co.type = 'Merchant'),
      'scaffolders', (select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name) order by co.name), '[]'::jsonb)
                      from public.companies co where co.active and co.type = 'Scaffolder')),
    'materials', (select jsonb_agg(jsonb_build_object('key', m.payload_key, 'description', m.description,
                                                      'unit', m.unit, 'category', m.category,
                                                      'derived_total', m.authoritative_total) order by m.ord)
                  from app.booking_material_catalogue() m),
    'gates', case
      when v_job.workflow_stage in ('BookingInProgress', 'Booked') then app.gate_summary(app.evaluate_booking_gates(v_job.id))
      when v_job.workflow_stage = 'Prebooking' then app.gate_summary(app.evaluate_ready_to_book(v_job.id))
    end,
    'commands', jsonb_build_object('booking_intake', v_avail #> '{commands,booking_intake}',
                                   'confirm_booking', v_avail #> '{commands,confirm_booking}'),
    'assigned', v_avail -> 'assigned');
end
$$;

-- -----------------------------------------------------------------------------
-- INTAKE_REVIEW_QUEUE
-- -----------------------------------------------------------------------------

create function app.read_intake_review_queue(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  perform app.req_keys(p_request, array[]::text[]);
  select coalesce(jsonb_agg(x.row order by x.received_at, x.id), '[]'::jsonb) into v_rows
  from (
    select i.received_at, i.id, jsonb_build_object(
      'id', i.id, 'intake_id', i.intake_id, 'form_type', i.form_type, 'received_at', i.received_at,
      'errors', app.intake_errors(i.validation_errors),
      'job', case when j.id is not null then jsonb_build_object(
        'id', j.id, 'job_ref', j.job_ref, 'workflow_stage', j.workflow_stage, 'match_status', j.sold_booking_match_status,
        'customer_name', app.s17_customer_name(c.first_name, c.last_name), 'postcode', c.postcode,
        'can_open', app.can_read_job(p_actor, j.id)) end,
      'customer_changes', (select coalesce(jsonb_agg(jsonb_build_object(
                                   'field_name', cc.field_name, 'previous_value', cc.previous_value,
                                   'incoming_value', cc.incoming_value, 'created_at', cc.created_at)
                                   order by cc.created_at, cc.field_name), '[]'::jsonb)
                           from public.customer_changes cc
                           where cc.job_id = i.job_id and cc.resolution is null
                             and cc.source_submission_id = i.intake_id)) as row
    from public.intake i
    left join public.jobs j on j.id = i.job_id
    left join public.customers c on c.id = j.customer_id
    where i.processing_status = 'Review'
  ) x;
  return jsonb_build_object('count', jsonb_array_length(v_rows), 'items', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('BOOKING_BOARD', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'view-port',
   'Booking views (prebooking, ready, in progress, upcoming) with gates, schedule and command availability.'),
  ('BOOKING_FORM', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'view-port',
   'Job Booking form data: job, current booking, pick lists, material catalogue, gates, availability.'),
  ('INTAKE_REVIEW_QUEUE', array['Admin', 'Manager', 'Office'], '[]', 'view-port',
   'Intake rows in Review with reasons and unresolved customer-change proposals.');
