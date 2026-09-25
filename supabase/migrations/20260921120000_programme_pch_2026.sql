-- =============================================================================
-- The first configured programme: PCH Meter SIM Replacement 2026.
--
-- This migration is CONFIGURATION, not data. It creates:
--   * the form "PCH - Installer Meter Visit", published as revision 1, built
--     entirely from generic Form Builder field types;
--   * the programme, wired to that form, with the field map that tells the
--     server which question carries which canonical value, the outcome map, and
--     the signal thresholds (including the unresolved boundary);
--   * public.programme_visit_form, so the person filling the form in can read
--     its definition without being given Forms administration rights.
--
-- No properties are created here. The real hit list has not arrived; synthetic
-- development fixtures live in supabase/seeds (local resets only) inside their
-- own synthetic programme, which the schema keeps separate.
--
-- Why the questions are in this order
-- -----------------------------------
-- Outcome first, then the meter. The brief groups the information as PROPERTY /
-- METER / OUTCOME, which is how it reads on paper, but a condition may only
-- refer to an earlier question, and the meter questions are exactly the ones
-- that do not apply when nobody answers the door. Asking the outcome second
-- makes "Tenant not home" a three-tap form on a doorstep and removes the
-- duplicate "meter reading" that the paper grouping would otherwise need (once
-- under METER, again under "Meter dead").
-- =============================================================================

do $$
declare
  v_form_id uuid := gen_random_uuid();
  v_revision_id uuid;
  v_definition jsonb;
  v_sim_changed jsonb := '["sim_changed_portal_working", "sim_changed_portal_not_working"]'::jsonb;
  v_got_in jsonb := '["sim_changed_portal_working", "sim_changed_portal_not_working", "meter_dead"]'::jsonb;
begin
  v_definition := jsonb_build_object('fields', jsonb_build_array(
    jsonb_build_object(
      'id', 'property', 'type', 'entity', 'entity', 'programme_property',
      'label', 'Property', 'required', true,
      'help', 'Search by address, postcode or PCH property ID.'),

    jsonb_build_object('id', 'outcome_section', 'type', 'section', 'label', 'Visit outcome'),
    jsonb_build_object(
      'id', 'visit_outcome', 'type', 'single_choice', 'label', 'What happened?', 'required', true,
      'options', jsonb_build_array(
        jsonb_build_object('id', 'tenant_not_home', 'label', 'Tenant not home'),
        jsonb_build_object('id', 'sim_changed_portal_working', 'label', 'SIM card changed - portal working'),
        jsonb_build_object('id', 'sim_changed_portal_not_working', 'label', 'SIM card changed - portal not working'),
        jsonb_build_object('id', 'meter_dead', 'label', 'Meter dead'))),

    -- Nobody in.
    jsonb_build_object(
      'id', 'calling_card_photo', 'type', 'photo', 'label', 'Calling card photo', 'required', true, 'max', 2,
      'help', 'Photograph the card you left, in place.',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'equals', 'value', 'tenant_not_home')),
    jsonb_build_object(
      'id', 'no_access_notes', 'type', 'long_text', 'label', 'Notes',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'equals', 'value', 'tenant_not_home')),

    -- Got in: the meter itself, whatever the outcome turned out to be.
    jsonb_build_object(
      'id', 'meter_section', 'type', 'section', 'label', 'Meter',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_got_in)),
    jsonb_build_object(
      'id', 'actual_meter_serial', 'type', 'short_text', 'label', 'Actual meter serial', 'required', true,
      'help', 'Read it from the meter itself, not from the paperwork.',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_got_in)),
    jsonb_build_object(
      'id', 'meter_reading', 'type', 'number', 'label', 'Meter reading', 'required', true, 'min', 0,
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_got_in)),
    jsonb_build_object(
      'id', 'meter_photo', 'type', 'photo', 'label', 'Meter photo', 'required', true, 'max', 4,
      'help', 'Show the serial number and the reading.',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_got_in)),

    -- SIM changed, either way round.
    jsonb_build_object(
      'id', 'sim_serial', 'type', 'short_text', 'label', 'SIM card serial', 'required', true,
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_sim_changed)),
    jsonb_build_object(
      'id', 'sim_serial_photo', 'type', 'photo', 'label', 'SIM serial photo', 'required', true, 'max', 2,
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_sim_changed)),
    jsonb_build_object(
      'id', 'csq_reading', 'type', 'number', 'label', 'CSQ reading', 'required', true, 'min', 0, 'max', 31,
      'help', '14 or above is a good signal. Below that the office may need to arrange an antenna.',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_sim_changed)),
    jsonb_build_object(
      'id', 'csq_photo', 'type', 'photo', 'label', 'CSQ photo', 'required', true, 'max', 2,
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_sim_changed)),
    jsonb_build_object(
      'id', 'installer_comments', 'type', 'long_text', 'label', 'Installer comments',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'in', 'values', v_sim_changed)),

    -- Meter dead. The meter questions above already cover the evidence and the
    -- reading; only the explanation is extra.
    jsonb_build_object(
      'id', 'meter_dead_comments', 'type', 'long_text', 'label', 'What is wrong with the meter?',
      'condition', jsonb_build_object('field', 'visit_outcome', 'op', 'equals', 'value', 'meter_dead'))
  ));

  -- Validated by the same function every other definition goes through.
  perform app.forms_validate_definition(v_definition);

  insert into public.forms (id, kind, title, description, status, definition,
                            current_revision_number, has_unpublished_changes)
  values (v_form_id, 'form', 'PCH - Installer Meter Visit',
          'Completed on site by the installer, once per property visit.',
          'published', v_definition, 1, false);

  insert into public.form_revisions (form_id, revision_number, title, description, definition)
  values (v_form_id, 1, 'PCH - Installer Meter Visit',
          'Completed on site by the installer, once per property visit.', v_definition)
  returning id into v_revision_id;

  update public.forms set current_revision_id = v_revision_id where id = v_form_id;

  insert into public.programmes (
    code, name, client_name, status, visit_form_id, property_visibility, synthetic,
    field_map, outcome_map, signal_config, notes)
  values (
    'PCH-SIM-2026', 'PCH Meter SIM Replacement 2026', 'PCH', 'Planning', v_form_id,
    -- Field workers see the whole programme's property list: a round is worked
    -- by address, and a tenant who is in next door should not need a
    -- re-assignment before the visit can be recorded.
    'AllInProgramme', false,
    jsonb_build_object(
      'property', 'property',
      'outcome', 'visit_outcome',
      'actual_meter_serial', 'actual_meter_serial',
      'meter_reading', 'meter_reading',
      'new_sim_serial', 'sim_serial',
      'csq', 'csq_reading',
      -- The same canonical value is asked under more than one outcome; the first
      -- answered one wins.
      'comments', jsonb_build_array('installer_comments', 'meter_dead_comments', 'no_access_notes'),
      'evidence', jsonb_build_object(
        'MeterPhoto', jsonb_build_array('meter_photo'),
        'SimSerialPhoto', jsonb_build_array('sim_serial_photo'),
        'CsqPhoto', jsonb_build_array('csq_photo'),
        'CallingCard', jsonb_build_array('calling_card_photo'))),
    jsonb_build_object(
      'tenant_not_home', 'TenantNotHome',
      'sim_changed_portal_working', 'SimChangedPortalWorking',
      'sim_changed_portal_not_working', 'SimChangedPortalNotWorking',
      'meter_dead', 'MeterDead'),
    -- UNRESOLVED: the client says "14 or above" is good, "approximately 4 and
    -- 14" is advisory and "4 or below" is bad - which disagrees with itself
    -- about the value 4. Configured as 4-is-bad and flagged, not decided.
    '{"metric": "csq", "min": 0, "max": 31, "good_min": 14, "bad_max": 4,
      "bad_max_inclusive": true, "boundary_unresolved": true,
      "boundary_question": "Is a CSQ of exactly 4 bad, or advisory? The client has said both. Confirm with Dan/Ben, then set bad_max_inclusive and clear boundary_unresolved."}'::jsonb,
    'A good CSQ does not mean the meter is working: the office must confirm it is live in the PCH portal before a visit can be Complete & Working.');
end
$$;

-- -----------------------------------------------------------------------------
-- The visit form, for the person filling it in
--
-- Reading a form through public.forms needs forms.read, which is Forms
-- ADMINISTRATION and which installers rightly do not have. A programme's visit
-- form is different: the programme names it, the revision is immutable, and the
-- only thing exposed is the questions the person is about to answer. So the
-- PROGRAMME authorizes this read - programme.visit.submit plus the same
-- property visibility the visit itself requires - and it is gated on FN-22,
-- Programmes' own release switch, rather than on FN-21.
--
-- Nothing about Forms administration is reachable here: no list, no other form,
-- no draft, no invitation, no response.
-- -----------------------------------------------------------------------------

create function public.programme_visit_form(p_programme_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_programme public.programmes;
  v_rev public.form_revisions;
begin
  if not app.programmes_on() then
    return jsonb_build_object('state', 'unavailable');
  end if;
  perform app.resolve_actor();
  if not (app.has_permission('programme.visit.submit') or app.has_permission('programme.read.all')) then
    perform app.fail('PROGRAMME_PERMISSION_DENIED', jsonb_build_object('permission', 'programme.visit.submit'));
  end if;
  select * into v_programme from public.programmes where id = p_programme_id;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;
  if v_programme.visit_form_id is null then perform app.fail('PROGRAMME_NO_VISIT_FORM'); end if;
  -- Someone who may not see any of this programme's properties has no visit to
  -- record and is told nothing about its form.
  if not app.has_permission('programme.read.all')
     and not app.programme_assigned(app.current_person_id(), v_programme.id) then
    perform app.fail('PROGRAMME_NOT_ASSIGNED');
  end if;

  select r.* into v_rev from public.form_revisions r
  join public.forms f on f.id = r.form_id and f.current_revision_id = r.id
  where r.form_id = v_programme.visit_form_id;
  if not found then perform app.fail('PROGRAMME_VISIT_FORM_NOT_PUBLISHED'); end if;

  return jsonb_build_object(
    'state', 'open',
    'form_id', v_rev.form_id,
    'revision_id', v_rev.id,
    'revision', v_rev.revision_number,
    'title', v_rev.title,
    'description', v_rev.description,
    'definition', v_rev.definition,
    'field_map', v_programme.field_map,
    'signal_config', v_programme.signal_config);
end
$$;

revoke execute on function public.programme_visit_form(uuid) from public, anon;
grant execute on function public.programme_visit_form(uuid) to authenticated, service_role;
