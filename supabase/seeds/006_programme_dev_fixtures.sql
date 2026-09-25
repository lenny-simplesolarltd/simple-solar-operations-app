-- =============================================================================
-- SYNTHETIC DEVELOPMENT FIXTURES - programmes.
--
-- Seeds run on `supabase db reset`, which is a LOCAL operation; hosted
-- databases receive migrations only. Even so, nothing here can reach a real
-- programme: the fixture programme is created with synthetic = true, and
-- app.programme_synthetic_guard makes that flag contagious and immutable - a
-- synthetic property or visit can exist only inside a synthetic programme, and
-- neither flag can ever be changed afterwards.
--
-- Every fixture is labelled in its own data as well as by the flag: the
-- programme code starts with DEV-, its name starts with "DEV FIXTURE", and every
-- property reference starts with DEV-.
--
-- Ten properties covering the cases the real programme has to handle:
--
--   DEV-0001  normal SIM success, good CSQ, serial matches
--   DEV-0002  no access (tenant not home)
--   DEV-0003  dead meter
--   DEV-0004  meter serial mismatch (the meter on site is not the expected one)
--   DEV-0005  good CSQ but the portal never goes live
--   DEV-0006  advisory CSQ (an antenna may be needed)
--   DEV-0007  bad CSQ
--   DEV-0008  CSQ exactly on the unresolved boundary (4)
--   DEV-0009  no expected meter serial recorded (comparison impossible)
--   DEV-0010  spare: untouched, so "remaining" is never zero
-- =============================================================================

do $$
declare
  v_programme_id uuid;
  v_form_id uuid;
begin
  if exists (select 1 from public.programmes where code = 'DEV-PCH-SIM') then
    return;
  end if;

  -- The fixture programme shares the real programme's form: the point of the
  -- fixtures is to exercise the real configuration, not a copy of it.
  select visit_form_id into v_form_id from public.programmes where code = 'PCH-SIM-2026';

  insert into public.programmes (code, name, client_name, status, visit_form_id, property_visibility,
                                 synthetic, field_map, outcome_map, signal_config, notes)
  select 'DEV-PCH-SIM', 'DEV FIXTURE - PCH Meter SIM Replacement (synthetic)', 'DEV FIXTURE',
         'Active', v_form_id, 'AllInProgramme', true, p.field_map, p.outcome_map, p.signal_config,
         'SYNTHETIC development fixtures. Never real work. Created by supabase/seeds/006_programme_dev_fixtures.sql.'
  from public.programmes p
  where p.code = 'PCH-SIM-2026'
  returning id into v_programme_id;

  insert into public.programme_properties (
    programme_id, external_ref, address_line1, town, postcode, expected_meter_serial,
    existing_sim_serial, notes, synthetic)
  values
    (v_programme_id, 'DEV-0001', '1 Fixture Terrace', 'Exeter', 'EX1 1AA', 'MTR-1001-A',
     'SIM-OLD-0001', 'Expect a clean SIM swap with a good signal.', true),
    (v_programme_id, 'DEV-0002', '2 Fixture Terrace', 'Exeter', 'EX1 1AA', 'MTR-1002-A',
     'SIM-OLD-0002', 'Expect nobody in.', true),
    (v_programme_id, 'DEV-0003', '3 Fixture Terrace', 'Exeter', 'EX1 1AB', 'MTR-1003-A',
     'SIM-OLD-0003', 'Expect a dead meter.', true),
    (v_programme_id, 'DEV-0004', '4 Fixture Terrace', 'Exeter', 'EX1 1AB', 'MTR-1004-EXPECTED',
     'SIM-OLD-0004', 'Expect the meter on site to be a different serial.', true),
    (v_programme_id, 'DEV-0005', '5 Fixture Terrace', 'Plymouth', 'PL4 6AB', 'MTR-1005-A',
     'SIM-OLD-0005', 'Good CSQ, but the portal never reports. Proves a good signal is not a working meter.', true),
    (v_programme_id, 'DEV-0006', '6 Fixture Terrace', 'Plymouth', 'PL4 6AB', 'MTR-1006-A',
     'SIM-OLD-0006', 'Advisory CSQ: an antenna may be needed.', true),
    (v_programme_id, 'DEV-0007', '7 Fixture Terrace', 'Plymouth', 'PL4 6AC', 'MTR-1007-A',
     'SIM-OLD-0007', 'Bad CSQ.', true),
    (v_programme_id, 'DEV-0008', '8 Fixture Terrace', 'Truro', 'TR1 2AB', 'MTR-1008-A',
     'SIM-OLD-0008', 'CSQ exactly 4 - the boundary Dan/Ben have not yet confirmed.', true),
    (v_programme_id, 'DEV-0009', '9 Fixture Terrace', 'Truro', 'TR1 2AB', null,
     null, 'No expected meter serial recorded, so no comparison is possible.', true),
    (v_programme_id, 'DEV-0010', '10 Fixture Terrace', 'Truro', 'TR1 2AC', 'MTR-1010-A',
     'SIM-OLD-0010', 'Never visited, so "remaining" is never zero.', true);

  -- John Doyle is the Installer in the staff seed; Lucy and Tanya are Office.
  insert into public.programme_assignments (programme_id, person_id, note)
  select v_programme_id, p.id, 'SYNTHETIC fixture assignment.'
  from public.people p
  where p.legacy_id = 'PERSON-john-doyle' and p.active;
end
$$;
