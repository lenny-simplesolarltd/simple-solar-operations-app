-- =============================================================================
-- Backend port, part 6: S05 booking intake (BOOKING_INTAKE, reference stage
-- S05, release R1).
--
-- Sources: r1-appsheet/services.js _r1sBookingIntake, _r1sSupersedeBookingHelper,
-- _r1sBookingTaskGeneration, R1A_BOOKING_FIELDS / R1A_BOOKING_FORM_FIELDS,
-- _r1sFieldValue / _r1sPersonName / _r1sCompanyName; s05/intake.js
-- processBookingIntake; s05/mapping.js (Booking rules and transforms);
-- s05/booking-apply.js applyBookingStructured; config/booking-product-map.example.json.
--
-- Business rules preserved:
--   * the booking is keyed by jobs.id + expected_version only (never surname /
--     address); the finance route may be confirmed but never changed
--     (R1A_FINANCE_ROUTE_CONFLICT); stage must be Prebooking / ReadyToBook /
--     BookingInProgress and the job actionable;
--   * customer data is compared (trim / collapse spaces / lower case), never
--     overwritten: differences become customer_changes proposals and send the
--     booking to Intake Review (match status Review);
--   * amount vs canonical gross (current contract value if > 0 else sold value);
--   * one live work package per trade; installers resolved to exactly one active
--     active Installer (person_roles) by display name (a People id resolves to its
--     display name first); merchant / scaffolder resolved to exactly one active
--     company of the type by id or exact name; unresolved -> review reason,
--     never an error; scaffold detail on a job not marked scaffold_required ->
--     review, nothing created; SCAFFOLD_COMPANY_UNRESOLVED is advisory only;
--   * materials from the product map (unapproved SKU -> product_id null +
--     notes 'MAPPING_REQUIRED:{key}'); Renusol hook totals are derived from
--     their components server-side and any submitted total is discarded;
--     component lines are skipped when the derived total is present;
--   * equipment resolves to an approved product by exact sku / model / name,
--     else MappingRequired, and always travels as a Materials "Other" line;
--   * ReadyToBook -> BookingInProgress; an early booking at Prebooking is linked
--     but the stage stays Prebooking (cannot skip the ReadyToBook gate);
--   * any open PRE-COPY-JOBID helper is completed as superseded (the canonical
--     Job Sold flow no longer creates that helper, so the step normally finds
--     nothing); the S06 gate processor then creates BKG01-BKG03 (never
--     BKG04/BKG05, never Booked).
--
-- Not ported (replaced by one transaction + the command journal): the intake
-- duplicate / CONFLICTING_INTAKE path (a replayed command returns the stored
-- result; a different payload under the same command_id is
-- R1A_COMMAND_CONFLICT), mapping-rule self-provisioning, cardinality /
-- overwrite / stage self-checks (R1A_INTAKE_CARDINALITY, R1A_CUSTOMER_OVERWRITE,
-- R1A_STAGE_RULE_BROKEN, R1A_JOB_LINK_MISMATCH: the code below cannot produce
-- them), CUSTOMER_MISSING (jobs.customer_id is a NOT NULL foreign key).
--
-- Deviations:
--   * the reference deterministic ids ALLOC-BOOKING-{job}-{field},
--     MAT-BOOKING-{job}-{key} and JEQ-BOOKING-{job}-{field} become natural keys:
--     an allocation of the same role on the job's package of that trade; a
--     booking material line for the job with the same MAPPING_REQUIRED key (or
--     the same approved product); a job_equipment row of the same type.
--   * the ReadyToBook -> BookingInProgress move is audited as a workflow stage
--     transition in addition to the BookingIntake job audit (REF-03 §11.6).
--   * next_action_at (a timestamptz here) is 00:00 Europe/London on the
--     earliest booked date, so app.london_date() returns that date.
--   * (canonical schema) the incoming postcode is put in the Job Sold canonical
--     form before comparison and before rebuilding display_name
--     ("{last_name} – {postcode}", as submit_presale writes it); installers are
--     active person_roles 'Installer' holders; the raw intake payload carries
--     booking_job_ref (jobs.job_ref) and the result carries job_ref.
--   * product-map approvals come from the optional setting booking.product_map
--     ({"materials": {key: {"product_id": uuid}}, "equipment": {...}}); without
--     it every SKU is NEED_APPROVAL, exactly as the reference example map.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema alignment with the reference booking code paths.
-- The reference booking apply writes these nulls in normal operation although
-- schema/tables.json marks the columns required.
-- -----------------------------------------------------------------------------

-- A booking proposal is unresolved until someone decides Accept/Keep/Correct
-- (s05/booking-apply.js:451 writes resolution null; REF-03 §11.4: no resolve
-- command exists yet).
alter table public.customer_changes alter column resolution drop not null;
-- Booking material lines exist before the work is scheduled (no need-by date)
-- and, for lines such as extras / bird netting on a job with no roof or
-- electrical package, before any package exists (s05/booking-apply.js:255-269,297-298).
alter table public.materials alter column need_by_date drop not null;
alter table public.materials alter column work_package_id drop not null;
-- A Draft scaffold booking may be recorded before the scaffolder is chosen or
-- when the named company does not resolve (s05/booking-apply.js:152-201).
alter table public.scaffold_bookings alter column company_id drop not null;

-- -----------------------------------------------------------------------------
-- Field conversion helpers (services.js _r1sFieldValue)
-- -----------------------------------------------------------------------------

-- Normalised comparison text: trim, collapse whitespace, lower case.
create function app.booking_norm(p_value text)
returns text
language sql immutable
set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g')) $$;

-- Postcode in the Job Sold canonical form (upper case, inner space before the
-- last three characters) when it is a valid UK shape, else upper-trimmed as
-- typed, so comparison and the derived display name match what the sale stored.
create function app.booking_postcode(p_value text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when upper(regexp_replace(p_value, '\s+', '', 'g')) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$'
      then left(upper(regexp_replace(p_value, '\s+', '', 'g')), length(regexp_replace(p_value, '\s+', '', 'g')) - 3)
           || ' ' || right(upper(regexp_replace(p_value, '\s+', '', 'g')), 3)
    else upper(btrim(p_value))
  end
$$;

-- YYYY-MM-DD local date (a longer value keeps its date prefix), else R1A_INVALID_DATE.
create function app.booking_date(p_payload jsonb, p_key text)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text := app.txt(p_payload, p_key);
  v_date date;
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    perform app.fail('R1A_INVALID_DATE');
  end if;
  begin
    v_date := substr(v_text, 1, 10)::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null or to_char(v_date, 'YYYY-MM-DD') <> substr(v_text, 1, 10) then
    perform app.fail('R1A_INVALID_DATE');
  end if;
  return v_date;
end
$$;

-- Whole number >= 0, else R1A_INVALID_INTEGER.
create function app.booking_int(p_payload jsonb, p_key text)
returns int
language plpgsql immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_payload -> p_key;
  v_text text;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_value) not in ('number', 'string') then
    perform app.fail('R1A_INVALID_INTEGER');
  end if;
  v_text := btrim(v_value #>> '{}');
  if v_text = '' then
    return null;
  end if;
  if v_text !~ '^[0-9]{1,9}(\.0*)?$' then
    perform app.fail('R1A_INVALID_INTEGER');
  end if;
  return v_text::numeric::int;
end
$$;

-- A known positive measurement (system kW, annual generation); anything else
-- is "not supplied", never a confirmed zero (booking-apply.js positiveNumber).
create function app.booking_positive(p_payload jsonb, p_key text)
returns numeric
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text := replace(coalesce(app.txt(p_payload, p_key), ''), ',', '');
  v_num numeric;
begin
  if v_text !~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then
    return null;
  end if;
  v_num := v_text::numeric;
  return case when v_num > 0 then v_num end;
end
$$;

create function app.is_uuid_text(p_value text)
returns boolean
language sql immutable
set search_path = ''
as $$ select coalesce(p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) $$;

-- -----------------------------------------------------------------------------
-- Resolution helpers (booking-apply.js resolveInstallerByName,
-- resolveCompanyByRef, resolveProductByRef)
-- -----------------------------------------------------------------------------

-- A People id (active) becomes its display name, then exactly one active
-- active Installer (person_roles.role_code, role active) with that normalised
-- display name. Forced change: the canonical people table has no role column.
create function app.booking_installer(p_value text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_value), '');
  v_count int;
  v_id uuid;
begin
  if v_name is null then
    return jsonb_build_object('status', 'blank');
  end if;
  if app.is_uuid_text(v_name) then
    select coalesce(nullif(btrim(p.display_name), ''), v_name) into v_name
    from public.people p where p.id = v_name::uuid and p.active;
    v_name := coalesce(v_name, btrim(p_value));
  end if;
  select count(*), min(p.id::text)::uuid into v_count, v_id
  from public.people p
  where p.active and app.person_has_active_role(p.id, array['Installer'])
    and app.booking_norm(p.display_name) = app.booking_norm(v_name);
  if v_count = 1 then
    return jsonb_build_object('status', 'resolved', 'person_id', v_id);
  end if;
  return jsonb_build_object('status', case when v_count = 0 then 'unresolved' else 'ambiguous' end,
    'reason', case when v_count = 0 then 'INSTALLER_NOT_FOUND' else 'INSTALLER_AMBIGUOUS' end, 'name', v_name);
end
$$;

-- A Companies id becomes its name, then exactly one active company of the
-- type by id or normalised name.
create function app.booking_company(p_value text, p_type text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_raw text := nullif(btrim(p_value), '');
  v_count int;
  v_id uuid;
begin
  if v_raw is null then
    return jsonb_build_object('status', 'blank');
  end if;
  if app.is_uuid_text(v_raw) then
    select coalesce(nullif(btrim(c.name), ''), v_raw) into v_raw from public.companies c where c.id = v_raw::uuid;
    v_raw := coalesce(v_raw, btrim(p_value));
    if app.is_uuid_text(v_raw) then
      select c.id into v_id from public.companies c where c.id = v_raw::uuid and c.active and c.type = p_type;
      if v_id is not null then
        return jsonb_build_object('status', 'resolved', 'company_id', v_id);
      end if;
    end if;
  end if;
  select count(*), min(c.id::text)::uuid into v_count, v_id
  from public.companies c
  where c.active and c.type = p_type and app.booking_norm(c.name) = app.booking_norm(v_raw);
  if v_count = 1 then
    return jsonb_build_object('status', 'resolved', 'company_id', v_id);
  end if;
  return jsonb_build_object('status', case when v_count = 0 then 'unresolved' else 'ambiguous' end, 'value', v_raw);
end
$$;

-- Exactly one active product whose sku, model or name equals the text
-- (trimmed, case-insensitive). Never fuzzy, never invented.
create function app.booking_product(p_value text)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select case when count(*) = 1 then min(p.id::text)::uuid end
  from public.products p
  where p.active and nullif(btrim(p_value), '') is not null
    and lower(btrim(p_value)) in (lower(btrim(p.sku)), lower(btrim(coalesce(p.model, ''))), lower(btrim(p.name)))
$$;

-- An approved product id from the optional booking.product_map setting, or
-- null (NEED_APPROVAL).
create function app.booking_mapped_product(p_section text, p_key text)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_text text := app.setting('booking.product_map') -> p_section -> p_key ->> 'product_id';
begin
  if not app.is_uuid_text(v_text) then
    return null;
  end if;
  return (select p.id from public.products p where p.id = v_text::uuid and p.active);
end
$$;

-- -----------------------------------------------------------------------------
-- Booking material catalogue (payload field -> product-map key), from
-- s05/mapping.js and config/booking-product-map.example.json.
-- -----------------------------------------------------------------------------

create function app.booking_material_catalogue()
returns table (ord int, payload_key text, map_key text, description text, unit text, category text,
               authoritative_total boolean)
language sql immutable
set search_path = ''
as $$
  values
    (1,  'mat_slate_portrait',     'renusol_hook_r420181_slate_portrait',     'Slate Portrait - Renusol Roof Hook (R420181) - & screws',     'ea', 'RoofHook', false),
    (2,  'mat_slate_landscape',    'renusol_hook_r420181_slate_landscape',    'Slate Landscape - Renusol Roof Hook (R420181) - & screws',    'ea', 'RoofHook', false),
    (3,  'mat_r420181_total',      'renusol_hook_r420181_total',              'Total Renusol Roof Hook (R420181) -& screws',                 'ea', 'RoofHook', true),
    (4,  'mat_concrete_portrait',  'renusol_hook_r420150_concrete_portrait',  'Concrete Portrait - Renusol Roof hook (R420150) - & screws',  'ea', 'RoofHook', false),
    (5,  'mat_concrete_landscape', 'renusol_hook_r420150_concrete_landscape', 'Concrete Landscape - Renusol Roof Hook (R420150) - & screws', 'ea', 'RoofHook', false),
    (6,  'mat_r420150_total',      'renusol_hook_r420150_total',              'Total Renusol Roof Hook (R420150) -& screws',                 'ea', 'RoofHook', true),
    (7,  'mat_l_bracket',          'renusol_l_bracket_ren_420353',            'L bracket for landscape hooks - REN-420353',                  'ea', null, false),
    (8,  'mat_hook_rest',          'renusol_hook_rest_rubber',                'Hook Rest Rubber Tile H-Rest',                                'ea', null, false),
    (9,  'mat_end_clamps',         'renusol_end_clamps_ren_420081_b',         'Renusol End clamps REN-420081-B',                             'ea', null, false),
    (10, 'mat_end_caps',           'renusol_end_caps_ren_900276',             'Renusol End caps REN-900276',                                 'ea', null, false),
    (11, 'mat_mid_clamps',         'renusol_mid_clamps_ren_420082_b',         'Renusol Mid clamps REN-420082-B',                             'ea', null, false),
    (12, 'mat_rail',               'renusol_rail_ren_400572',                 'Renusol Rail REN-400572',                                     'ea', null, false),
    (13, 'mat_splice',             'renusol_splice_ren_400531',               'Renusol Splice REN-400531',                                   'ea', null, false),
    (14, 'mat_k2_flat_multi',      'k2_flat_multi_rail_landscape',            'K2 Flat multi rail - landscape',                              'ea', null, false),
    (15, 'mat_k2_curved_multi',    'k2_curved_multi_rail_landscape',          'K2 Curved multi rail - landscape',                            'ea', null, false),
    (16, 'mat_k2_flat_mini',       'k2_flat_mini_rail_portrait',              'K2 Flat mini rail - portrait',                                'ea', null, false),
    (17, 'mat_k2_curved_mini',     'k2_curved_mini_rail_portrait',            'K2 Curved mini rail - portrait',                              'ea', null, false),
    (18, 'mat_genius',             'genius_speed_flashing',                   'Genius Speed flashing',                                       'ea', null, false),
    (19, 'mat_k2_1000074',         'k2_1000074_hook',                         'K2 1000074 15CM Roof Hook for Flat Tiles',                    'ea', null, false),
    (20, 'mat_k2_mid',             'k2_mid_clamps_2004540',                   'K2 Mid Clamps 2004540',                                       'ea', null, false),
    (21, 'mat_k2_end',             'k2_end_clamps_2004545',                   'K2 End Clamps 2004545',                                       'ea', null, false),
    (22, 'mat_k2_end_caps',        'k2_end_caps',                             'K2 End Caps',                                                 'ea', null, false),
    (23, 'mat_k2_rail',            'k2_rail',                                 'K2 Rail',                                                     'ea', null, false),
    (24, 'mat_k2_splice',          'k2_splice',                               'K2 Splice',                                                   'ea', null, false),
    (25, 'mat_panel_515',          'panel_515',                               'Amount of 515 Panels',                                        'ea', 'Panel', false),
    (26, 'mat_panel_460',          'panel_460',                               'Amount of 460 Panels',                                        'ea', 'Panel', false),
    (27, 'mat_panel_m',            'panel_m_class',                           'Amount of M-Class Panels',                                    'ea', 'Panel', false),
    (28, 'mat_bird_netting',       'bird_netting_m',                          'Bird netting (m)',                                            'm',  null, false),
    (29, 'mat_optimisers',         'optimisers',                              'Optimisers',                                                  'ea', 'Electrical', false),
    (30, 'mat_fox_jb',             'fox_junction_box',                        'Fox Junction Box',                                            'ea', 'Electrical', false),
    (31, 'mat_dongle',             'dongle',                                  'Dongle',                                                      'ea', 'Electrical', false),
    (32, 'mat_gateway',            'gateway',                                 'Gateway',                                                     'ea', 'Electrical', false),
    (33, 'mat_ev',                 'ev_charger',                              'EV Charger',                                                  'ea', 'Electrical', false)
$$;

-- -----------------------------------------------------------------------------
-- Structured apply helpers
-- -----------------------------------------------------------------------------

-- One live package per trade (booking-apply.js ensureWorkPackage): an existing
-- non-cancelled package takes the new dates (never blanked) and required=true;
-- otherwise a new package, Scheduled when dated.
create function app.booking_work_package(p_job_id uuid, p_trade text, p_date date)
returns public.work_packages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wp public.work_packages;
  v_after public.work_packages;
begin
  select * into v_wp from public.work_packages w
  where w.job_id = p_job_id and w.trade = p_trade and w.status <> 'Cancelled'
  order by (w.parent_package_id is not null), w.created_at, w.id
  limit 1
  for update;
  if found then
    if v_wp.required and (p_date is null or (v_wp.planned_start = p_date and v_wp.planned_end = p_date)) then
      return v_wp;
    end if;
    update public.work_packages set required = true,
      planned_start = coalesce(p_date, planned_start), planned_end = coalesce(p_date, planned_end)
    where id = v_wp.id returning * into v_after;
    perform app.audit('WorkPackages', v_wp.id::text, 'BookingIntake', to_jsonb(v_wp), to_jsonb(v_after), null);
    return v_after;
  end if;
  insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status, need_by_date,
                                    commissioning_required, sequence, revision)
  values (p_job_id, p_trade, true, p_date, p_date, case when p_date is not null then 'Scheduled' else 'Unscheduled' end,
          p_date, p_trade = 'Electrical', case p_trade when 'Roof' then 1 when 'Electrical' then 2 else 9 end, 1)
  returning * into v_after;
  perform app.audit('WorkPackages', v_after.id::text, 'BookingIntake', null, to_jsonb(v_after), null);
  return v_after;
end
$$;

-- One booking material line (booking-apply.js createMaterialLines /
-- createOtherLines). Skipped when the job already has the booking line for
-- this key. Returns the line summary, or null when skipped.
create function app.booking_material_line(p_job_id uuid, p_key text, p_wp_id uuid, p_product_id uuid,
                                          p_description text, p_quantity numeric, p_unit text,
                                          p_need_by date, p_merchant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.materials;
begin
  if exists (select 1 from public.materials m
             where m.job_id = p_job_id and m.source = 'ToOrder'
               and (m.notes = 'MAPPING_REQUIRED:' || p_key
                    or (p_product_id is not null and m.product_id = p_product_id))) then
    return jsonb_build_object('key', p_key, 'replayed', true);
  end if;
  insert into public.materials (job_id, work_package_id, product_id, description, required_quantity, unit, source,
                                need_by_date, merchant_id, notes, revision, cancelled_quantity)
  values (p_job_id, p_wp_id, p_product_id, p_description, p_quantity, p_unit, 'ToOrder', p_need_by, p_merchant_id,
          case when p_product_id is null then 'MAPPING_REQUIRED:' || p_key end, 1, 0)
  returning * into v_row;
  perform app.audit('Materials', v_row.id::text, 'BookingIntake', null, to_jsonb(v_row), null);
  return jsonb_build_object('id', v_row.id, 'key', p_key, 'description', p_description, 'quantity', p_quantity,
                            'product_id', p_product_id, 'need_approval', p_product_id is null);
end
$$;

-- -----------------------------------------------------------------------------
-- BOOKING_INTAKE
-- -----------------------------------------------------------------------------

create function app.cmd_booking_intake(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_intake_id text := 'R1A-BOOK-' || app.context_command_id();
  v_route text;
  v_job public.jobs;
  v_after public.jobs;
  v_customer public.customers;
  v_intake public.intake;
  v_task public.tasks;
  v_task_after public.tasks;
  -- converted fields
  v_roof_date date;
  v_elec_date date;
  v_scaffold_date date;
  v_booking_gross bigint;
  v_canonical_gross bigint;
  v_battery_qty int;
  -- apply state
  v_needs_review boolean := false;
  v_reasons text[] := '{}';
  v_changes jsonb := '[]'::jsonb;
  v_amount_mismatch jsonb;
  v_display text;
  v_last text;
  v_pc text;
  v_roof_wp public.work_packages;
  v_elec_wp public.work_packages;
  v_wp public.work_packages;
  v_scaffold public.scaffold_bookings;
  v_scaffold_before public.scaffold_bookings;
  v_scaffold_company jsonb;
  v_scaffold_supplied boolean;
  v_scaffold_notes text;
  v_scaffold_pdf text;
  v_scaffold_set boolean := false;
  v_inst record;
  v_res jsonb;
  v_alloc public.allocations;
  v_installers_resolved jsonb := '[]'::jsonb;
  v_installers_unresolved jsonb := '[]'::jsonb;
  v_merchant jsonb;
  v_merchant_id uuid;
  v_mat record;
  v_qty numeric;
  v_total_181 int;
  v_total_150 int;
  v_c1 int;
  v_c2 int;
  v_mat_wp uuid;
  v_need_by date;
  v_product uuid;
  v_materials jsonb := '[]'::jsonb;
  v_requirements jsonb := '[]'::jsonb;
  v_equipment jsonb := '[]'::jsonb;
  v_eq record;
  v_eq_row public.job_equipment;
  v_line jsonb;
  v_tech public.technical_details;
  v_tech_after public.technical_details;
  v_kw numeric;
  v_gen numeric;
  v_ordering text;
  v_technical jsonb;
  v_next date;
  v_status text;
  v_match text;
  v_errors jsonb;
  v_helpers jsonb := '[]'::jsonb;
  v_note text;
  v_gates jsonb;
  v_booking_tasks jsonb;
  v_customer_keys text[] := array['first_name', 'last_name', 'address_line1', 'town', 'postcode', 'phone', 'email'];
  v_incoming text[];
  i int;
begin
  -- ---- request validation (services.js _r1sBookingIntake) -------------------
  if p_request ?| array['task_id', 'issue_id', 'work_package_id', 'old_allocation_id'] then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_p := app.payload(p_request, array[
    'customer_first_name', 'customer_last_name', 'street_address', 'city', 'postcode', 'phone', 'email',
    'solar_kw', 'cost', 'finance_route', 'merchant_name', 'annual_generation', 'date_roofer', 'date_sparky',
    'date_scaffold', 'roofer', 'sparky', 'second_sparky', 'scaffold_company', 'scaffold_pdf', 'scaffold_notes',
    'roofing_notes', 'electrical_notes', 'ordering_notes', 'roof_hooks_type',
    'mat_slate_portrait', 'mat_slate_landscape', 'mat_r420181_total', 'mat_concrete_portrait',
    'mat_concrete_landscape', 'mat_r420150_total', 'mat_l_bracket', 'mat_hook_rest', 'mat_end_clamps',
    'mat_end_caps', 'mat_mid_clamps', 'mat_rail', 'mat_splice', 'mat_k2_flat_multi', 'mat_k2_curved_multi',
    'mat_k2_flat_mini', 'mat_k2_curved_mini', 'mat_genius', 'mat_k2_1000074', 'mat_k2_mid', 'mat_k2_end',
    'mat_k2_end_caps', 'mat_k2_rail', 'mat_k2_splice', 'mat_panel_515', 'mat_panel_460', 'mat_panel_m',
    'mat_bird_netting', 'mat_optimisers', 'mat_fox_jb', 'mat_dongle', 'mat_gateway', 'mat_ev',
    'inverter', 'battery', 'battery_qty', 'fox_jb_calc', 'extras', 'sig_extras', 'tesla_extras', 'submitted_by']);
  -- Identity echo only; authorization never comes from it.
  if app.txt(v_p, 'submitted_by') is not null
     and lower(app.txt(v_p, 'submitted_by')) not in (lower(p_actor ->> 'id'), p_actor ->> 'email') then
    perform app.fail('R1A_ACTOR_MISMATCH');
  end if;
  v_route := app.txt(v_p, 'finance_route');
  if v_route is not null and v_route not in ('Standard', 'Phoenix', 'OtherReview') then
    perform app.fail('R1A_INVALID_FINANCE_ROUTE');
  end if;

  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if not found then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  -- The route is established at Sold and decides the prebooking gate: a
  -- booking may confirm it, never change it.
  if v_route is not null and v_route <> v_job.finance_route then
    perform app.fail('R1A_FINANCE_ROUTE_CONFLICT');
  end if;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  if v_job.workflow_stage not in ('Prebooking', 'ReadyToBook', 'BookingInProgress') then
    perform app.fail('R1A_STAGE_NOT_ELIGIBLE');
  end if;

  -- ---- field conversions (refusals before any write) ------------------------
  v_roof_date := app.booking_date(v_p, 'date_roofer');
  v_elec_date := app.booking_date(v_p, 'date_sparky');
  v_scaffold_date := app.booking_date(v_p, 'date_scaffold');
  for v_mat in select * from app.booking_material_catalogue() loop
    perform app.booking_int(v_p, v_mat.payload_key);
  end loop;
  v_battery_qty := app.booking_int(v_p, 'battery_qty');
  v_booking_gross := app.pounds_to_pence(v_p -> 'cost', 'R1A_INVALID_GROSS_AMOUNT');

  select * into v_customer from public.customers where id = v_job.customer_id;

  -- ---- customer comparison: proposals, never overwrites ---------------------
  v_incoming := array[app.txt(v_p, 'customer_first_name'), app.txt(v_p, 'customer_last_name'),
                      app.txt(v_p, 'street_address'), app.txt(v_p, 'city'), app.booking_postcode(app.txt(v_p, 'postcode')),
                      app.txt(v_p, 'phone'), lower(app.txt(v_p, 'email'))];
  for i in 1 .. cardinality(v_customer_keys) loop
    continue when v_incoming[i] is null;
    continue when app.booking_norm(to_jsonb(v_customer) ->> v_customer_keys[i]) = app.booking_norm(v_incoming[i]);
    insert into public.customer_changes (job_id, field_name, previous_value, incoming_value, source_submission_id,
                                         resolution, reason)
    values (v_job.id, v_customer_keys[i], nullif(to_jsonb(v_customer) ->> v_customer_keys[i], ''), v_incoming[i],
            v_intake_id, null, 'BOOKING_CUSTOMER_MISMATCH');
    v_changes := v_changes || jsonb_build_object('field_name', v_customer_keys[i],
      'previous_value', nullif(to_jsonb(v_customer) ->> v_customer_keys[i], ''), 'incoming_value', v_incoming[i]);
  end loop;
  if jsonb_array_length(v_changes) > 0 then
    v_needs_review := true;
    v_reasons := array_append(v_reasons, 'CUSTOMER_MISMATCH'::text);
  end if;

  -- ---- amount vs canonical contract value -----------------------------------
  v_canonical_gross := case when coalesce(v_job.current_contract_gross_pence > 0, false) then v_job.current_contract_gross_pence
                            when coalesce(v_job.original_gross_pence > 0, false) then v_job.original_gross_pence end;
  if v_booking_gross is not null and v_canonical_gross is not null and v_booking_gross <> v_canonical_gross then
    v_amount_mismatch := jsonb_build_object('previous', v_canonical_gross, 'incoming', v_booking_gross);
    v_needs_review := true;
    v_reasons := array_append(v_reasons, 'AMOUNT_MISMATCH'::text);
  end if;

  -- Display name from surname + postcode (derived, never a match key).
  v_last := coalesce(app.txt(v_p, 'customer_last_name'), btrim(v_customer.last_name));
  v_pc := coalesce(app.booking_postcode(app.txt(v_p, 'postcode')), btrim(v_customer.postcode));
  if nullif(v_last, '') is not null and nullif(v_pc, '') is not null then
    v_display := v_last || ' – ' || v_pc;
  end if;

  -- ---- work packages ----------------------------------------------------------
  if v_roof_date is not null or v_job.roof_required
     or exists (select 1 from app.booking_material_catalogue() c
                where app.txt(v_p, c.payload_key) is not null
                  and (c.map_key like 'panel%' or c.map_key like 'renusol%' or c.map_key like 'k2%')) then
    v_roof_wp := app.booking_work_package(v_job.id, 'Roof', v_roof_date);
  end if;
  if v_elec_date is not null or v_job.electrical_required
     or app.txt(v_p, 'inverter') is not null or app.txt(v_p, 'battery') is not null then
    v_elec_wp := app.booking_work_package(v_job.id, 'Electrical', v_elec_date);
  end if;

  -- ---- scaffold ---------------------------------------------------------------
  v_scaffold_notes := app.txt(v_p, 'scaffold_notes');
  v_scaffold_pdf := app.txt(v_p, 'scaffold_pdf');
  v_scaffold_supplied := v_scaffold_date is not null or app.txt(v_p, 'scaffold_company') is not null
                         or v_scaffold_pdf is not null;
  if v_scaffold_supplied and not v_job.scaffold_required then
    -- Inconsistent: nothing is created; a person decides.
    v_needs_review := true;
    v_reasons := array_append(v_reasons, 'SCAFFOLD_NOT_REQUIRED'::text);
  elsif v_scaffold_supplied or v_job.scaffold_required then
    v_scaffold_company := app.booking_company(app.txt(v_p, 'scaffold_company'), 'Scaffolder');
    select * into v_scaffold_before from public.scaffold_bookings s
    where s.job_id = v_job.id and s.status <> 'Cancelled'
    order by s.created_at, s.id limit 1 for update;
    if v_scaffold_before.id is not null then
      update public.scaffold_bookings set
        erect_planned_at = coalesce(v_scaffold_date, erect_planned_at),
        access_notes = coalesce(v_scaffold_notes, access_notes),
        scope_file_id = coalesce(v_scaffold_pdf, scope_file_id),
        company_id = coalesce((v_scaffold_company ->> 'company_id')::uuid, company_id)
      where id = v_scaffold_before.id
        and (erect_planned_at is distinct from coalesce(v_scaffold_date, erect_planned_at)
             or access_notes is distinct from coalesce(v_scaffold_notes, access_notes)
             or scope_file_id is distinct from coalesce(v_scaffold_pdf, scope_file_id)
             or company_id is distinct from coalesce((v_scaffold_company ->> 'company_id')::uuid, company_id))
      returning * into v_scaffold;
      if v_scaffold.id is not null then
        perform app.audit('ScaffoldBookings', v_scaffold.id::text, 'BookingIntake', to_jsonb(v_scaffold_before),
                          to_jsonb(v_scaffold), null);
      else
        v_scaffold := v_scaffold_before;
      end if;
      v_scaffold_set := true;
    elsif v_scaffold_date is not null or app.txt(v_p, 'scaffold_company') is not null
          or v_scaffold_notes is not null or v_scaffold_pdf is not null then
      insert into public.scaffold_bookings (job_id, company_id, erect_planned_at, status, revision, access_notes,
                                            scope_file_id)
      values (v_job.id, (v_scaffold_company ->> 'company_id')::uuid, v_scaffold_date,
              case when v_scaffold_date is not null then 'Planned' else 'Draft' end, 1, v_scaffold_notes, v_scaffold_pdf)
      returning * into v_scaffold;
      perform app.audit('ScaffoldBookings', v_scaffold.id::text, 'BookingIntake', null, to_jsonb(v_scaffold), null);
      v_scaffold_set := true;
    end if;
    if v_scaffold_set and app.txt(v_p, 'scaffold_company') is not null
       and v_scaffold_company ->> 'status' <> 'resolved' then
      -- Advisory only: does not by itself send the booking to review.
      v_reasons := array_append(v_reasons, 'SCAFFOLD_COMPANY_UNRESOLVED'::text);
    end if;
  end if;

  -- ---- installers -> allocations (no capacity/leave/skill check, as reference)
  for v_inst in select * from (values (1, 'roofer', 'Roof', 'Lead'), (2, 'sparky', 'Electrical', 'Lead'),
                                      (3, 'second_sparky', 'Electrical', 'Second')) t(ord, field, trade, alloc_role)
                order by ord loop
    continue when app.txt(v_p, v_inst.field) is null;
    v_res := app.booking_installer(app.txt(v_p, v_inst.field));
    if v_res ->> 'status' = 'resolved' then
      v_installers_resolved := v_installers_resolved || jsonb_build_object('field', v_inst.field,
        'person_id', v_res -> 'person_id', 'trade', v_inst.trade, 'role', v_inst.alloc_role);
      v_wp := case when v_inst.trade = 'Roof' then v_roof_wp else v_elec_wp end;
      if v_wp.id is not null and not exists (
           select 1 from public.allocations a join public.work_packages w on w.id = a.work_package_id
           where w.job_id = v_job.id and w.trade = v_inst.trade and a.role = v_inst.alloc_role) then
        insert into public.allocations (work_package_id, person_id, role, start_at, end_at, active)
        values (v_wp.id, (v_res ->> 'person_id')::uuid, v_inst.alloc_role, v_wp.planned_start,
                coalesce(v_wp.planned_end, v_wp.planned_start), true)
        returning * into v_alloc;
        perform app.audit('Allocations', v_alloc.id::text, 'BookingIntake', null, to_jsonb(v_alloc), null);
      end if;
    elsif v_res ->> 'status' <> 'blank' then
      v_installers_unresolved := v_installers_unresolved || (v_res || jsonb_build_object('field', v_inst.field));
      v_needs_review := true;
      v_reasons := array_append(v_reasons, v_res ->> 'reason');
    end if;
  end loop;

  -- ---- materials (product map) ----------------------------------------------
  v_merchant := app.booking_company(app.txt(v_p, 'merchant_name'), 'Merchant');
  v_merchant_id := (v_merchant ->> 'company_id')::uuid;
  v_need_by := coalesce(v_roof_wp.planned_start, v_elec_wp.planned_start);
  -- Hook totals are derived from the components; a submitted total is ignored.
  v_c1 := nullif(app.booking_int(v_p, 'mat_slate_portrait'), 0);
  v_c2 := nullif(app.booking_int(v_p, 'mat_slate_landscape'), 0);
  v_total_181 := case when v_c1 is not null or v_c2 is not null then coalesce(v_c1, 0) + coalesce(v_c2, 0) end;
  v_c1 := nullif(app.booking_int(v_p, 'mat_concrete_portrait'), 0);
  v_c2 := nullif(app.booking_int(v_p, 'mat_concrete_landscape'), 0);
  v_total_150 := case when v_c1 is not null or v_c2 is not null then coalesce(v_c1, 0) + coalesce(v_c2, 0) end;
  for v_mat in select * from app.booking_material_catalogue() order by ord loop
    v_qty := case v_mat.map_key when 'renusol_hook_r420181_total' then v_total_181
                                when 'renusol_hook_r420150_total' then v_total_150
                                else app.booking_int(v_p, v_mat.payload_key) end;
    continue when v_qty is null or v_qty <= 0;
    -- skip_component_when_authoritative_total_present
    continue when not v_mat.authoritative_total and v_mat.map_key like '%r420181%' and v_total_181 is not null;
    continue when not v_mat.authoritative_total and v_mat.map_key like '%r420150%' and v_total_150 is not null;
    v_product := app.booking_mapped_product('materials', v_mat.map_key);
    if v_product is null then
      v_requirements := v_requirements || jsonb_build_object('key', v_mat.map_key, 'reason', 'PRODUCT_ID_NEED_APPROVAL',
                                                             'description', v_mat.description, 'quantity', v_qty);
    end if;
    v_mat_wp := case when v_mat.category = 'Panel' then v_roof_wp.id
                     when v_mat.category = 'Electrical' then coalesce(v_elec_wp.id, v_roof_wp.id)
                     else coalesce(v_roof_wp.id, v_elec_wp.id) end;
    v_line := app.booking_material_line(v_job.id, v_mat.map_key, v_mat_wp, v_product, v_mat.description, v_qty,
                                        v_mat.unit, v_need_by, v_merchant_id);
    v_materials := v_materials || v_line;
  end loop;
  -- A supplied merchant that resolves to no single active Merchant goes to review.
  if v_merchant ->> 'status' in ('unresolved', 'ambiguous') then
    v_needs_review := true;
    v_reasons := array_append(v_reasons, 'MERCHANT_UNRESOLVED'::text);
  end if;

  -- ---- equipment + "Other" lines (equipment and extras) ----------------------
  for v_eq in select * from (values
      (1, 'inverter_to_order', 'Inverter', app.txt(v_p, 'inverter'), 1),
      (2, 'battery_to_order', 'Battery', app.txt(v_p, 'battery'), coalesce(nullif(v_battery_qty, 0), 1)),
      (3, 'extras', null, app.txt(v_p, 'extras'), 1),
      (4, 'sig_extras', null, app.txt(v_p, 'sig_extras'), 1),
      (5, 'tesla_extras', null, app.txt(v_p, 'tesla_extras'), 1)) t(ord, key, equipment_type, text_value, quantity)
    order by ord loop
    continue when v_eq.text_value is null;
    v_product := null;
    if v_eq.equipment_type is not null then
      v_product := coalesce(app.booking_product(v_eq.text_value), app.booking_mapped_product('equipment', v_eq.key));
      if v_product is null then
        v_requirements := v_requirements || jsonb_build_object('key', v_eq.key, 'reason', 'PRODUCT_ID_NEED_APPROVAL',
                                                               'value', v_eq.text_value);
      end if;
      if exists (select 1 from public.job_equipment e where e.job_id = v_job.id and e.equipment_type = v_eq.equipment_type) then
        v_equipment := v_equipment || jsonb_build_object('equipment_type', v_eq.equipment_type, 'replayed', true);
      else
        insert into public.job_equipment (job_id, work_package_id, equipment_type, planned_product_id, quantity,
                                          technical_review_status)
        values (v_job.id, v_elec_wp.id, v_eq.equipment_type, v_product, v_eq.quantity,
                case when v_product is not null then 'Planned' else 'MappingRequired' end)
        returning * into v_eq_row;
        perform app.audit('JobEquipment', v_eq_row.id::text, 'BookingIntake', null, to_jsonb(v_eq_row), null);
        v_equipment := v_equipment || jsonb_build_object('id', v_eq_row.id, 'equipment_type', v_eq.equipment_type,
          'planned_product_id', v_product, 'need_approval', v_product is null);
      end if;
    end if;
    v_line := app.booking_material_line(v_job.id, v_eq.key, coalesce(v_elec_wp.id, v_roof_wp.id), v_product,
                                        v_eq.text_value, v_eq.quantity, 'ea', v_need_by, v_merchant_id);
    v_materials := v_materials || v_line;
  end loop;

  -- ---- technical details (non-blank values only; never blanks a value) -------
  v_kw := app.booking_positive(v_p, 'solar_kw');
  v_gen := app.booking_positive(v_p, 'annual_generation');
  v_ordering := nullif(concat_ws(E'\n\n', app.txt(v_p, 'ordering_notes'),
    'Fox junction box calculation: ' || app.txt(v_p, 'fox_jb_calc')), '');
  if coalesce(v_kw, v_gen) is not null or v_ordering is not null or app.txt(v_p, 'roofing_notes') is not null
     or app.txt(v_p, 'electrical_notes') is not null or app.txt(v_p, 'roof_hooks_type') is not null then
    select * into v_tech from public.technical_details where job_id = v_job.id for update;
    if v_tech.id is null then
      insert into public.technical_details (job_id, system_kw, annual_generation_kwh, roof_notes, electrical_notes,
                                            mounting_orientation, ordering_notes)
      values (v_job.id, v_kw, v_gen, app.txt(v_p, 'roofing_notes'), app.txt(v_p, 'electrical_notes'),
              app.txt(v_p, 'roof_hooks_type'), v_ordering)
      returning * into v_tech_after;
      perform app.audit('TechnicalDetails', v_tech_after.id::text, 'BookingIntake', null, to_jsonb(v_tech_after), null);
      v_technical := jsonb_build_object('id', v_tech_after.id, 'changed', true, 'created', true);
    elsif (v_kw is null or v_tech.system_kw = v_kw)
          and (v_gen is null or v_tech.annual_generation_kwh = v_gen)
          and (app.txt(v_p, 'roofing_notes') is null or v_tech.roof_notes = app.txt(v_p, 'roofing_notes'))
          and (app.txt(v_p, 'electrical_notes') is null or v_tech.electrical_notes = app.txt(v_p, 'electrical_notes'))
          and (app.txt(v_p, 'roof_hooks_type') is null or v_tech.mounting_orientation = app.txt(v_p, 'roof_hooks_type'))
          and (v_ordering is null or v_tech.ordering_notes = v_ordering) then
      v_technical := jsonb_build_object('id', v_tech.id, 'changed', false);
    else
      update public.technical_details set
        system_kw = coalesce(v_kw, system_kw),
        annual_generation_kwh = coalesce(v_gen, annual_generation_kwh),
        roof_notes = coalesce(app.txt(v_p, 'roofing_notes'), roof_notes),
        electrical_notes = coalesce(app.txt(v_p, 'electrical_notes'), electrical_notes),
        mounting_orientation = coalesce(app.txt(v_p, 'roof_hooks_type'), mounting_orientation),
        ordering_notes = coalesce(v_ordering, ordering_notes)
      where id = v_tech.id returning * into v_tech_after;
      perform app.audit('TechnicalDetails', v_tech.id::text, 'BookingIntake', to_jsonb(v_tech), to_jsonb(v_tech_after), null);
      v_technical := jsonb_build_object('id', v_tech.id, 'changed', true);
    end if;
  end if;

  -- ---- intake record ----------------------------------------------------------
  v_status := case when v_needs_review then 'Review' else 'Processed' end;
  v_match := case when v_needs_review then 'Review' else 'Match' end;
  if v_needs_review then
    select coalesce(jsonb_agg(jsonb_build_object('error', r, 'detail', 'Booking structured apply flagged for Intake Review')), '[]'::jsonb)
      into v_errors from unnest(v_reasons) r;
    if v_amount_mismatch is not null then
      v_errors := v_errors || jsonb_build_object('error', 'AMOUNT_MISMATCH', 'detail', v_amount_mismatch::text);
    end if;
    select v_errors || coalesce(jsonb_agg(jsonb_build_object('error', 'CUSTOMER_MISMATCH', 'field', c ->> 'field_name')), '[]'::jsonb)
      into v_errors from jsonb_array_elements(v_changes) c;
  end if;
  insert into public.intake (intake_id, form_type, form_id, submission_id, received_at, raw_payload_json, payload_hash,
                             job_id, processing_status, validation_errors, processed_at, retry_count)
  values (v_intake_id, 'Booking', 'R1A-BOOK', app.context_command_id(), now(),
          v_p || jsonb_build_object('booking_job_ref', v_job.job_ref),
          encode(sha256(convert_to(v_p::text, 'UTF8')), 'hex'), v_job.id, v_status, v_errors::text,
          case when v_status = 'Processed' then now() end, 0)
  returning * into v_intake;

  -- ---- link the job -----------------------------------------------------------
  select min(d) into v_next from unnest(array[v_roof_date, v_elec_date, v_scaffold_date]) d;
  update public.jobs set
    booking_submission_id = v_intake.id,
    sold_booking_match_status = v_match,
    -- An early booking is linked but cannot skip the explicit ReadyToBook gate.
    workflow_stage = case when workflow_stage = 'ReadyToBook' then 'BookingInProgress' else workflow_stage end,
    roof_required = roof_required or v_roof_wp.id is not null,
    electrical_required = electrical_required or v_elec_wp.id is not null,
    scaffold_required = scaffold_required or v_scaffold_set,
    next_action_at = coalesce(app.london_at(v_next, '00:00'), next_action_at),
    display_name = coalesce(v_display, display_name)
  where id = v_job.id
  returning * into v_after;
  perform app.audit('Jobs', v_job.id::text, 'BookingIntake', to_jsonb(v_job), to_jsonb(v_after),
    case when v_status = 'Processed' then 'Booking intake processed successfully'
         else 'Booking linked but Intake Review required (mismatch/unresolved installer/amount)' end);
  if v_after.workflow_stage <> v_job.workflow_stage then
    -- Deviation: every stage transition is audited (REF-03 §11.6).
    perform app.audit('Jobs', v_job.id::text, 'WorkflowStage:' || v_after.workflow_stage, to_jsonb(v_job),
                      to_jsonb(v_after), 'Booking intake linked');
  end if;

  -- ---- supersede the "Prepare job booking" helper ---------------------------
  v_note := 'Superseded by Job Booking intake ' || v_intake_id
            || case when v_status = 'Review' then ' (Intake Review required)' else '' end;
  for v_task in select * from public.tasks t
                where t.job_id = v_job.id and t.template_code = 'PRE-COPY-JOBID'
                  and t.status in ('Open', 'Waiting', 'InProgress', 'Blocked')
                order by t.created_at, t.id
                for update loop
    update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.actor_id(p_actor),
                            completion_note = v_note, blocking_reason = null
    where id = v_task.id returning * into v_task_after;
    perform app.task_event(v_task, v_task_after, 'Complete', v_note);
    perform app.audit('Tasks', v_task.id::text, 'Complete', to_jsonb(v_task), to_jsonb(v_task_after), v_note);
    v_helpers := v_helpers || to_jsonb(v_task.id);
  end loop;

  -- ---- booking checklist (BKG01-BKG03) via the canonical S06 evaluation ------
  if v_after.workflow_stage in ('BookingInProgress', 'Booked') then
    v_gates := app.process_booking_gates(v_job.id);
    v_booking_tasks := jsonb_build_object(
      'created', coalesce((select jsonb_agg(t -> 'template') from jsonb_array_elements(v_gates #> '{tasks,created}') t), '[]'::jsonb),
      'skipped', coalesce((select jsonb_agg(t -> 'template') from jsonb_array_elements(v_gates #> '{tasks,skipped}') t), '[]'::jsonb),
      -- A missing active template fails the command (S06_CONFIG), never a silent skip.
      'missing_templates', '[]'::jsonb);
  end if;

  select * into v_after from public.jobs where id = v_job.id;
  return jsonb_build_object(
    'status', v_status,
    'duplicate', false,
    'intake_id', v_intake_id,
    'job_id', v_job.id,
    'job_ref', v_after.job_ref,
    'version', v_after.version,
    'workflow_stage', v_after.workflow_stage,
    'match_status', v_match,
    'customer_changes', v_changes,
    'review_reasons', to_jsonb(v_reasons),
    'amount_mismatch', v_amount_mismatch,
    'installers', jsonb_build_object('resolved', v_installers_resolved, 'unresolved', v_installers_unresolved),
    'work_packages', to_jsonb(array_remove(array[v_roof_wp.id, v_elec_wp.id], null)),
    'scaffold_booking_id', v_scaffold.id,
    'merchant_id', v_merchant_id,
    'materials', v_materials,
    'equipment', v_equipment,
    'mapping_requirements', v_requirements,
    'technical', v_technical,
    'helper_tasks_completed', v_helpers,
    'booking_tasks', v_booking_tasks,
    'error', null,
    'message', case when v_status = 'Processed' then 'Booking intake processed successfully'
                    else 'Booking linked but Intake Review required (mismatch/unresolved installer/amount)' end,
    'external_calls', 0);
end
$$;
