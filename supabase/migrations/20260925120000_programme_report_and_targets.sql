-- =============================================================================
-- Two gaps in the programme reads, both of the same kind: a figure the client
-- asks about that the read did not return, so the screen either left it out or
-- would have had to guess.
--
-- 1. Delivery progress had no target to be measured against. "1,036 attended"
--    answers nothing on its own; "1,036 of 1,400" is the question being asked.
--    The target and the delivery window are columns on the programme (added in
--    20260925100000), so the dashboard read returns them - along with the count
--    of properties actually COMPLETED, which is not the same as attended and was
--    the figure being quietly conflated.
--
-- 2. The daily report knew how many meters were awaiting a portal check but not
--    how many had been confirmed live, or checked and found not live, THAT DAY.
--    Those are the two sentences a client's daily report exists to say, so they
--    are counted here rather than inferred in a browser - or, as was happening,
--    computed and then thrown away because the only consumer was a CSV.
--
-- Contractual dates are NOT invented. Where a programme has no delivery window
-- recorded, the read returns null and the screen says so, rather than printing a
-- required-per-day figure derived from a date nobody agreed.
--
-- Both functions are reproduced in full because Postgres has no way to alter
-- part of one. Every line other than the additions marked below is unchanged.
-- =============================================================================

create or replace function app.read_programme_daily_report(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_request -> 'payload', p_request);
  v_programme_id uuid := app.programme_uuid(v_payload, 'programme_id');
  v_date date := coalesce(nullif(btrim(coalesce(v_payload ->> 'date', '')), '')::date, app.london_date());
  v_programme public.programmes;
begin
  if not app.programmes_on() then perform app.fail('R1A_MODE_DENIED'); end if;
  perform app.programme_require('programme.report');
  select * into v_programme from public.programmes where id = v_programme_id;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;

  return (
    with visit as (
      select v.*, pp.external_ref, pp.address_line1, pp.postcode, pp.expected_meter_serial,
             pe.display_name as installer
      from public.programme_visits v
      join public.programme_properties pp on pp.id = v.property_id
      left join public.people pe on pe.id = v.installer_id
      where v.programme_id = v_programme.id and v.visit_date = v_date and v.review_status <> 'Draft'
    )
    select jsonb_build_object(
      'programme', jsonb_build_object('id', v_programme.id, 'code', v_programme.code,
                                      'name', v_programme.name, 'client_name', v_programme.client_name),
      'date', v_date,
      'properties_attended', (select count(distinct property_id) from visit),
      'visits', (select count(*) from visit),
      'sims_swapped', (select count(*) from visit where app.programme_outcome_is_sim_change(outcome)),
      'no_access', (select count(*) from visit where outcome = 'TenantNotHome'),
      'meters_requiring_replacement', (select count(*) from visit
                                       where outcome = 'MeterDead' or disposition = 'MeterRequiresChanging'),
      'action_required', (select count(*) from visit where disposition = 'ActionRequired'),
      'complete_and_live', (select count(*) from visit where disposition = 'CompleteAndWorking'),
      'awaiting_review', (select count(*) from visit where review_status = 'AwaitingReview'),
      'awaiting_portal_confirmation', (select count(*) from visit
                                       where portal_check_required and portal_verification is null),
      -- The two facts the client's report is really for: what went live, and
      -- what was checked and is not live.
      'portal_confirmed_live', (select count(*) from visit where portal_verification = 'ConfirmedLive'),
      'portal_not_live', (select count(*) from visit where portal_verification = 'NotLive'),
      'portal_unable_to_verify', (select count(*) from visit where portal_verification = 'UnableToVerify'),
      'serial_mismatches', (select count(*) from visit where meter_serial_matches is false),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'external_ref', external_ref, 'address', address_line1, 'postcode', postcode,
          'installer', installer, 'outcome', outcome,
          'expected_meter_serial', expected_meter_serial, 'actual_meter_serial', actual_meter_serial,
          'meter_serial_matches', meter_serial_matches, 'meter_reading', meter_reading,
          'new_sim_serial', new_sim_serial, 'csq', csq, 'signal_classification', signal_classification,
          'portal_verification', portal_verification, 'disposition', disposition,
          'review_status', review_status, 'comments', installer_comments)
        order by external_ref) from visit), '[]'::jsonb))
  );
end
$$;

create or replace function app.read_programme_dashboard(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_programme_id uuid := app.programme_uuid(coalesce(p_request -> 'payload', p_request), 'programme_id');
  v_f jsonb := app.programme_visit_filter(p_request);
  v_programme public.programmes;
  v_today date := app.london_date();
  v_result jsonb;
begin
  if not app.programmes_on() then perform app.fail('R1A_MODE_DENIED'); end if;
  perform app.programme_require('programme.report');
  select * into v_programme from public.programmes where id = v_programme_id;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;

  with prop as (
    select pp.* from public.programme_properties pp
    where pp.programme_id = v_programme.id and pp.active
  ), visit as (
    select v.* from public.programme_visits v
    where v.programme_id = v_programme.id and v.review_status <> 'Draft'
      and (v_f ->> 'from' is null or v.visit_date >= (v_f ->> 'from')::date)
      and (v_f ->> 'to' is null or v.visit_date <= (v_f ->> 'to')::date)
      and (v_f ->> 'installer_id' is null or v.installer_id = (v_f ->> 'installer_id')::uuid)
      and (v_f ->> 'outcome' is null or v.outcome = v_f ->> 'outcome')
      and (v_f ->> 'disposition' is null or v.disposition = v_f ->> 'disposition')
      and (v_f ->> 'review_status' is null or v.review_status = v_f ->> 'review_status')
      and (v_f ->> 'signal_classification' is null or v.signal_classification = v_f ->> 'signal_classification')
      and (v_f ->> 'portal_verification' is null or v.portal_verification = v_f ->> 'portal_verification')
      and (v_f ->> 'postcode' is null or exists (
            select 1 from prop p where p.id = v.property_id
              and p.postcode_norm like app.programme_norm_postcode(v_f ->> 'postcode') || '%'))
  ), attended as (
    select distinct property_id from visit
  ), completed as (
    -- A property is DONE when one of its visits is Complete & working, which the
    -- table constraint already guarantees means the portal confirmed the meter
    -- live. Attended is not completed, and reporting the one as the other is how
    -- a programme looks finished while meters are still dark.
    select distinct property_id from visit where disposition = 'CompleteAndWorking'
  )
  select jsonb_build_object(
    'programme', jsonb_build_object('id', v_programme.id, 'code', v_programme.code, 'name', v_programme.name,
                                    'status', v_programme.status, 'client_name', v_programme.client_name,
                                    'starts_on', v_programme.starts_on, 'ends_on', v_programme.ends_on,
                                    'signal_config', v_programme.signal_config,
                                    'synthetic', v_programme.synthetic),
    -- The target and the window are the programme's own recorded figures.
    -- Everything derived from them belongs to the screen, which can then say
    -- plainly when there is nothing to derive from.
    'target_property_count', v_programme.target_property_count,
    'delivery_start_date', v_programme.delivery_start_date,
    'delivery_end_date', v_programme.delivery_end_date,
    'today', v_today,
    'total_properties', (select count(*) from prop),
    'attended', (select count(*) from attended),
    'completed_properties', (select count(*) from completed),
    'remaining', (select count(*) from prop) - (select count(*) from attended),
    'visits_total', (select count(*) from visit),
    'visits_today', (select count(*) from visit where visit_date = v_today),
    'sims_changed', (select count(*) from visit where app.programme_outcome_is_sim_change(outcome)),
    'no_access', (select count(*) from visit where outcome = 'TenantNotHome'),
    'meter_dead', (select count(*) from visit where outcome = 'MeterDead'),
    'awaiting_review', (select count(*) from visit where review_status = 'AwaitingReview'),
    'action_required', (select count(*) from visit where disposition = 'ActionRequired'),
    'meter_replacements_required', (select count(*) from visit where disposition = 'MeterRequiresChanging'),
    'no_access_rebook', (select count(*) from visit where disposition = 'NoAccessRebook'),
    'complete_and_working', (select count(*) from visit where disposition = 'CompleteAndWorking'),
    'serial_mismatches', (select count(*) from visit where meter_serial_matches is false),
    'portal_confirmed_live', (select count(*) from visit where portal_verification = 'ConfirmedLive'),
    'portal_not_live', (select count(*) from visit where portal_verification = 'NotLive'),
    'portal_unable_to_verify', (select count(*) from visit where portal_verification = 'UnableToVerify'),
    'portal_outstanding', (select count(*) from visit where portal_check_required and portal_verification is null),
    'csq_bands', jsonb_build_object(
      'good', (select count(*) from visit where signal_classification = 'Good'),
      'advisory', (select count(*) from visit where signal_classification = 'Advisory'),
      'bad', (select count(*) from visit where signal_classification = 'Bad'),
      'not_recorded', (select count(*) from visit where csq is null)),
    'by_day', coalesce((select jsonb_agg(d order by (d ->> 'date'))
                        from (select jsonb_build_object('date', visit_date, 'visits', count(*),
                                'sims_changed', count(*) filter (where app.programme_outcome_is_sim_change(outcome)),
                                'no_access', count(*) filter (where outcome = 'TenantNotHome'),
                                'meter_dead', count(*) filter (where outcome = 'MeterDead')) as d
                              from visit where visit_date is not null group by visit_date) x), '[]'::jsonb),
    'by_installer', coalesce((select jsonb_agg(d order by (d ->> 'visits')::int desc)
                        from (select jsonb_build_object('installer_id', v.installer_id,
                                'installer', pe.display_name, 'visits', count(*),
                                'sims_changed', count(*) filter (where app.programme_outcome_is_sim_change(v.outcome)),
                                'no_access', count(*) filter (where v.outcome = 'TenantNotHome')) as d
                              from visit v left join public.people pe on pe.id = v.installer_id
                              group by v.installer_id, pe.display_name) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;
