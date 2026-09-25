-- =============================================================================
-- SYNTHETIC SCALE FIXTURE - programmes.  LOCAL DEVELOPMENT ONLY.
--
-- Deliberately NOT in supabase/seeds: `supabase db reset` must not create it,
-- and it must never travel to a hosted database. The real PCH programme stays
-- at whatever properties have genuinely been imported.
--
-- Why it exists: the screens were built and reviewed against a dozen
-- properties, and at that size a query that quietly returns its first 500 rows
-- looks perfect. This fixture makes the programme the size it will actually be
-- - about 1,400 properties and the best part of a thousand visits - so paging,
-- counts and board columns are exercised by something that can catch them
-- lying.
--
-- Three guards, because a fixture this large in the wrong database would be a
-- serious mess:
--   1. the caller must set app.scale_fixture = 'yes' for the session;
--   2. the target programme must be synthetic (the flag is contagious and
--      immutable - see app.programme_synthetic_guard), so this physically
--      cannot attach rows to a real programme;
--   3. the node wrapper refuses any database that is not on 127.0.0.1.
-- =============================================================================

do $$
declare
  v_programme  public.programmes;
  v_revision   uuid;
  v_installers uuid[];
  v_reviewer   uuid;
  v_target     integer := 1400;
  v_visits     integer := 950;
  v_have       integer;
  v_i          integer;
  v_prop       uuid;
  v_sub        uuid;
  v_disp       text;
  v_outcome    text;
  v_csq        integer;
  v_signal     text;
  v_portal     text;
  v_date       date;
  v_installer  uuid;
begin
  if coalesce(current_setting('app.scale_fixture', true), '') <> 'yes' then
    raise exception
      'refusing to run: set app.scale_fixture = ''yes'' for this session first';
  end if;

  select * into v_programme from public.programmes where code = 'DEV-PCH-SIM';
  if not found then
    raise exception 'the DEV-PCH-SIM fixture programme does not exist here; run supabase db reset first';
  end if;
  if not v_programme.synthetic then
    raise exception 'refusing to run: % is not a synthetic programme', v_programme.code;
  end if;

  select id into v_revision
  from public.form_revisions
  where form_id = v_programme.visit_form_id
  order by revision_number desc
  limit 1;
  if v_revision is null then
    raise exception 'the fixture programme has no published form revision';
  end if;

  select array_agg(id) into v_installers
  from (select id from public.people where active order by id limit 6) p;
  v_reviewer := v_installers[1];

  -- ---------------------------------------------------------------- properties
  select count(*) into v_have
  from public.programme_properties where programme_id = v_programme.id;

  if v_have < v_target then
    insert into public.programme_properties (
      programme_id, external_ref, address_line1, town, postcode,
      expected_meter_serial, existing_sim_serial, notes, synthetic)
    select
      v_programme.id,
      'DEV-S' || lpad(n::text, 5, '0'),
      n || ' '
        || (array['Fixture Road','Scale Avenue','Volume Close','Sample Street',
                  'Pilot Lane','Survey Way'])[1 + (n % 6)],
      (array['Exeter','Plymouth','Truro','Torquay','Barnstaple'])[1 + (n % 5)],
      (array['EX2 ','PL4 ','TR1 ','TQ2 ','EX31 '])[1 + (n % 5)]
        || (1 + (n % 9)) || (array['AA','AB','BD','DE','EF','GH'])[1 + (n % 6)],
      'MTR-S' || lpad(n::text, 5, '0') || '-A',
      'SIM-OLD-S' || lpad(n::text, 5, '0'),
      'SYNTHETIC scale fixture.',
      true
    from generate_series(v_have + 1, v_target) as n;
  end if;

  -- ------------------------------------------------------------------- visits
  select count(*) into v_have
  from public.programme_visits where programme_id = v_programme.id;
  if v_have >= v_visits then
    raise notice 'already % visits; nothing to add', v_have;
    return;
  end if;

  for v_i in 1 .. (v_visits - v_have) loop
    -- One visit per property, taking properties that have never been attended,
    -- because "attended" and "remaining" are counted by distinct property.
    select pp.id into v_prop
    from public.programme_properties pp
    where pp.programme_id = v_programme.id
      and pp.active
      and not exists (
        select 1 from public.programme_visits v where v.property_id = pp.id)
    order by pp.external_ref
    limit 1;
    exit when v_prop is null;

    v_installer := v_installers[1 + (v_i % array_length(v_installers, 1))];
    v_date := current_date - ((v_i % 45))::integer;

    -- A shape roughly like the real programme: mostly clean swaps that went
    -- live, a working queue of submissions, and a tail of problems.
    if v_i % 20 = 0 then
      v_disp := 'NoAccessRebook';  v_outcome := 'TenantNotHome';
      v_csq := null;               v_signal := null;   v_portal := null;
    elsif v_i % 19 = 0 then
      v_disp := 'MeterRequiresChanging'; v_outcome := 'MeterDead';
      v_csq := null;               v_signal := null;   v_portal := null;
    elsif v_i % 11 = 0 then
      v_disp := 'ActionRequired';
      v_outcome := 'SimChangedPortalNotWorking';
      v_csq := 3;                  v_signal := 'Bad';  v_portal := 'NotLive';
    elsif v_i % 4 = 0 then
      v_disp := 'AwaitingReview';
      v_outcome := 'SimChangedPortalWorking';
      v_csq := 5 + (v_i % 15);     v_signal := 'Good'; v_portal := null;
    else
      v_disp := 'CompleteAndWorking';
      v_outcome := 'SimChangedPortalWorking';
      v_csq := 8 + (v_i % 12);     v_signal := 'Good';
      v_portal := 'ConfirmedLive';
    end if;

    insert into public.form_submissions (
      id, form_id, revision_id, answers, submitted_at, source, submitted_by)
    values (
      gen_random_uuid(), v_programme.visit_form_id, v_revision,
      jsonb_build_object('scale_fixture', true),
      v_date::timestamptz + interval '9 hours' + (v_i % 480) * interval '1 minute',
      'Staff', v_installer)
    returning id into v_sub;

    insert into public.programme_visits (
      id, programme_id, property_id, installer_id, form_id, form_revision_id,
      submission_id, outcome, actual_meter_serial, meter_reading, new_sim_serial,
      csq, installer_comments, meter_serial_matches, signal_classification,
      portal_check_required, review_required, review_status, disposition,
      portal_verification, reviewed_by, reviewed_at, visit_date, submitted_at,
      synthetic)
    select
      gen_random_uuid(), v_programme.id, v_prop, v_installer,
      v_programme.visit_form_id, v_revision, v_sub, v_outcome,
      case when v_outcome like 'SimChanged%' then pp.expected_meter_serial end,
      case when v_outcome like 'SimChanged%' then 1000 + v_i end,
      case when v_outcome like 'SimChanged%'
           then 'SIM-NEW-S' || lpad(v_i::text, 5, '0') end,
      v_csq, 'SYNTHETIC scale fixture.',
      case when v_outcome like 'SimChanged%' then true end,
      v_signal,
      v_outcome like 'SimChanged%',
      true,
      case when v_disp = 'AwaitingReview' then 'AwaitingReview' else 'Reviewed' end,
      v_disp, v_portal,
      case when v_disp <> 'AwaitingReview' then v_reviewer end,
      case when v_disp <> 'AwaitingReview'
           then v_date::timestamptz + interval '17 hours' end,
      v_date,
      v_date::timestamptz + interval '9 hours' + (v_i % 480) * interval '1 minute',
      true
    from public.programme_properties pp where pp.id = v_prop;

    v_prop := null;
  end loop;

  raise notice 'scale fixture: % properties, % visits',
    (select count(*) from public.programme_properties where programme_id = v_programme.id),
    (select count(*) from public.programme_visits where programme_id = v_programme.id);
end
$$;
