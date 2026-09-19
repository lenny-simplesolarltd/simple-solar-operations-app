-- =============================================================================
-- View port D/E: list reads for resourcing, scaffold and commissioning.
--
--   STAFF_AVAILABILITY   availability / unavailability entries of every active
--                        person overlapping a window (AppSheet Staff
--                        Availability + Staff Unavailability in one list)
--   INSTALLER_SKILLS     active installers with their skills, capacity and
--                        teams (AppSheet Installer Skills)
--   SCAFFOLD_BOARD       scaffold bookings across jobs, plus jobs that need
--                        scaffold and have no live booking
--   COMMISSIONING_QUEUE  commissioning submissions awaiting office review
--
-- Read-only; the writes stay on the R2/R3 commands (RP_SET_AVAILABILITY,
-- RP_SET_SKILL, SCAFFOLD_*, COMMISSIONING_REVIEW).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STAFF_AVAILABILITY
-- -----------------------------------------------------------------------------

create function app.read_staff_availability(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(app.read_date(app.req_text(p_request, 'from'), 'RP_DATE_INVALID'), app.london_date(now()));
  v_to date := app.read_date(app.req_text(p_request, 'to'), 'RP_DATE_INVALID');
  v_person uuid := app.req_uuid(p_request, 'person_id');
  v_rows jsonb;
begin
  perform app.req_keys(p_request, array['from', 'to', 'person_id']);
  v_to := coalesce(v_to, v_from + 56);
  if v_to < v_from then
    perform app.fail('RP_REVIEW: end before start');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'availability_id', a.id, 'version', a.version, 'person_id', a.person_id,
           'display_name', p.display_name, 'type', a.type, 'from_date', a.from_date,
           'to_date', coalesce(a.to_date, a.from_date), 'reason', a.reason,
           'approved_by_name', app.s17_person_name(a.approved_by),
           'is_installer', app.person_has_active_role(p.id, array['Installer']),
           'allocations', (select count(*) from public.allocations al
                           join public.work_packages w on w.id = al.work_package_id
                           where al.person_id = a.person_id and al.active and w.status <> 'Cancelled'
                             and al.start_at <= coalesce(a.to_date, a.from_date)
                             and coalesce(al.end_at, al.start_at) >= a.from_date))
           order by a.from_date, p.display_name), '[]'::jsonb)
    into v_rows
  from public.person_availability a
  join public.people p on p.id = a.person_id and p.active
  where a.active
    and a.from_date <= v_to and coalesce(a.to_date, a.from_date) >= v_from
    and (v_person is null or a.person_id = v_person);

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'entries', v_rows,
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name)
                                         order by p.display_name), '[]'::jsonb)
               from public.people p where p.active));
end
$$;

-- -----------------------------------------------------------------------------
-- INSTALLER_SKILLS
-- -----------------------------------------------------------------------------

create function app.read_installer_skills(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := app.london_date(now());
begin
  perform app.req_keys(p_request, array[]::text[]);
  return jsonb_build_object(
    'as_of', v_today,
    'skills', (select coalesce(jsonb_agg(s.code order by s.code), '[]'::jsonb) from public.skills s where s.active),
    'installers', (select coalesce(jsonb_agg(jsonb_build_object(
        'person_id', p.id, 'display_name', p.display_name, 'capacity_per_day', p.capacity_per_day,
        'available_from', p.available_from, 'available_to', p.available_to,
        'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', ps.id, 'version', ps.version, 'skill', ps.skill_code, 'level', ps.level,
                     'certified_until', ps.certified_until, 'active', ps.active, 'notes', ps.notes,
                     'expired', ps.certified_until is not null and ps.certified_until < v_today)
                     order by ps.skill_code), '[]'::jsonb)
                   from public.person_skills ps where ps.person_id = p.id),
        'teams', (select coalesce(jsonb_agg(jsonb_build_object('team_id', t.id, 'team', t.name, 'role', tm.role)
                                            order by t.name), '[]'::jsonb)
                  from public.team_members tm join public.teams t on t.id = tm.team_id and t.active
                  where tm.person_id = p.id and tm.active))
        order by p.display_name), '[]'::jsonb)
      from public.people p
      where p.active and app.person_has_active_role(p.id, array['Installer'])));
end
$$;

-- -----------------------------------------------------------------------------
-- SCAFFOLD_BOARD
-- -----------------------------------------------------------------------------

create function app.read_scaffold_board(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_view text := coalesce(app.req_text(p_request, 'view'), 'active');
  v_bookings jsonb;
  v_needed jsonb;
begin
  perform app.req_keys(p_request, array['view']);
  if v_view not in ('active', 'finished', 'all') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'view'));
  end if;

  select coalesce(jsonb_agg(x.row order by x.d nulls last, x.job_ref), '[]'::jsonb) into v_bookings
  from (
    select coalesce(case when b.status in ('Erected', 'StripAuthorised', 'StripPlanned', 'StripConfirmed')
                         then coalesce(b.strip_planned_at, b.strip_forecast_at) end,
                    b.erect_planned_at) as d,
           j.job_ref, jsonb_build_object(
      'booking_id', b.id, 'version', b.version, 'status', b.status, 'revision', b.revision,
      'acknowledgement_required', coalesce(b.confirmed_revision, 0) < coalesce(b.revision, 0)
                                  and b.status in ('Requested', 'StripPlanned'),
      'erect_planned_at', b.erect_planned_at, 'erect_actual_at', b.erect_actual_at,
      'strip_forecast_at', b.strip_forecast_at, 'strip_planned_at', b.strip_planned_at,
      'strip_actual_at', b.strip_actual_at,
      'company', co.name, 'company_id', b.company_id,
      'job_id', j.id, 'job_ref', j.job_ref, 'job_version', j.version,
      'customer_name', app.s17_customer_name(c.first_name, c.last_name), 'postcode', c.postcode,
      'customer_happy', j.customer_happy_at is not null,
      'open_complaints', (select count(*) from public.issues i
                          where i.id = any (coalesce(b.related_issue_ids, '{}'))
                            and i.status not in ('Resolved', 'Closed'))) as row
    from public.scaffold_bookings b
    join public.jobs j on j.id = b.job_id
    left join public.customers c on c.id = j.customer_id
    left join public.companies co on co.id = b.company_id
    where case v_view
            when 'active' then b.status not in ('Stripped', 'Cancelled')
            when 'finished' then b.status in ('Stripped', 'Cancelled')
            else true end
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.id, 'job_ref', j.job_ref, 'job_version', j.version, 'workflow_stage', j.workflow_stage,
           'customer_name', app.s17_customer_name(c.first_name, c.last_name), 'postcode', c.postcode,
           'install_date', (select min(w.planned_start) from public.work_packages w
                            where w.job_id = j.id and w.status <> 'Cancelled'),
           'draft_booking_id', (select b.id from public.scaffold_bookings b
                                where b.job_id = j.id and b.status in ('Draft', 'Planned') limit 1))
           order by j.job_ref), '[]'::jsonb)
    into v_needed
  from public.jobs j
  left join public.customers c on c.id = j.customer_id
  where j.scaffold_required and j.archived_at is null
    and j.workflow_stage in ('BookingInProgress', 'Booked', 'AwaitingInstallation', 'InProgress')
    and not exists (select 1 from public.scaffold_bookings b
                    where b.job_id = j.id and b.status not in ('Draft', 'Planned', 'Cancelled'));

  return jsonb_build_object('view', v_view, 'bookings', v_bookings, 'needs_request', v_needed,
    'scaffolders', (select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name) order by co.name), '[]'::jsonb)
                    from public.companies co where co.type = 'Scaffolder' and co.active));
end
$$;

-- -----------------------------------------------------------------------------
-- COMMISSIONING_QUEUE
-- -----------------------------------------------------------------------------

create function app.read_commissioning_queue(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_view text := coalesce(app.req_text(p_request, 'view'), 'review');
  v_rows jsonb;
begin
  perform app.req_keys(p_request, array['view']);
  if v_view not in ('review', 'returned', 'accepted') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'view'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'submission_id', s.id, 'version', s.version, 'status', s.status, 'submitted_at', s.submitted_at,
           'reviewed_at', s.reviewed_at, 'review_notes', s.review_notes, 'template_version', s.template_version,
           'work_package_id', s.work_package_id, 'trade', w.trade,
           'installer_name', app.s17_person_name(s.installer_id),
           'job_id', j.id, 'job_ref', j.job_ref,
           'customer_name', app.s17_customer_name(c.first_name, c.last_name), 'postcode', c.postcode,
           'answers', (select count(*) from public.commissioning_answers a where a.submission_id = s.id))
           order by coalesce(s.submitted_at, s.created_at)), '[]'::jsonb)
    into v_rows
  from public.commissioning_submissions s
  join public.jobs j on j.id = s.job_id
  left join public.customers c on c.id = j.customer_id
  left join public.work_packages w on w.id = s.work_package_id
  where not exists (select 1 from public.commissioning_submissions n where n.supersedes_submission_id = s.id)
    and case v_view
          when 'review' then s.status in ('Submitted', 'UnderReview')
          when 'returned' then s.status = 'Returned'
          else s.status = 'Accepted' end
    and app.can_read_job(p_actor, j.id);
  return jsonb_build_object('view', v_view, 'count', jsonb_array_length(v_rows), 'submissions', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('STAFF_AVAILABILITY', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'view-port',
   'Active availability entries of active people overlapping a window.'),
  ('INSTALLER_SKILLS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'view-port',
   'Active installers with skills, capacity and teams.'),
  ('SCAFFOLD_BOARD', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'view-port',
   'Scaffold bookings across jobs and jobs still needing a scaffold request.'),
  ('COMMISSIONING_QUEUE', array['Admin', 'Manager', 'Office'], '[]', 'view-port',
   'Commissioning submissions by review state (canonical job visibility).');
