-- =============================================================================
-- Hotfix: a property's identity, and the import result's invalid_rows.
--
-- Two defects introduced by 20260925170000, both live.
--
-- 1. source_identity was backfilled once and then maintained ONLY by the
--    import path. Anything else that creates a property - a seed fixture, a
--    property added by hand - left it null, and a null never matches. The next
--    import of that property therefore created a SECOND row instead of
--    updating the one already there.
--
--    Identity is a property of the ROW, so it is filled in by the row's own
--    trigger. Every writer then gets the same answer without having to know
--    the rule, and the unique constraint stays authoritative.
--
--    Nothing here knows what PCH is: the trigger reads the programme's
--    import_identity_key, so a programme keyed by property reference and one
--    keyed by meter serial are the same code path.
--
-- 2. Rewriting cmd_programme_import_apply for the new identity key dropped
--    invalid_rows from its result. Callers reporting "2 rows were skipped" got
--    undefined. Restored, with no other change to what the command does.
--
-- Deployed on its own, ahead of the unfinished reporting work, because both
-- defects affect hosted behaviour today.
--
-- BACKFILL: rows written since 20260925170000 by a non-import path have a null
-- identity. They are given one here, from their programme's own key.
--
-- ROLLBACK:
--   begin;
--   drop trigger if exists programme_properties_identity on public.programme_properties;
--   drop function if exists app.programme_property_identity();
--   -- Then re-run cmd_programme_import_apply from 20260925170000 (which
--   -- restores the missing invalid_rows defect).
--   commit;
-- =============================================================================

-- -- Identity belongs to the row, not to the importer -------------------------
--
-- source_identity was filled in by the import path only. Anything else that
-- creates a property - the seed fixtures, a property added by hand - left it
-- null, and a null never matches: the next import of that property created a
-- SECOND row rather than updating the one already there.
--
-- Filling it here makes identity a property of the row, whoever wrote it, so
-- every writer gets the same answer without having to know the rule.

create function app.programme_property_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_key text;
begin
  if new.source_identity is not null then return new; end if;
  select import_identity_key into v_key from public.programmes where id = new.programme_id;
  new.source_identity := app.programme_source_identity(
    coalesce(v_key, 'external_ref'),
    case coalesce(v_key, 'external_ref')
      when 'expected_meter_serial' then new.expected_meter_serial
      else new.external_ref
    end);
  return new;
end
$$;

create trigger programme_properties_identity
  before insert or update of external_ref, expected_meter_serial
  on public.programme_properties
  for each row execute function app.programme_property_identity();


-- Any row written since 20260925170000 without going through the importer.
update public.programme_properties pp
set source_identity = app.programme_source_identity(
      coalesce(p.import_identity_key, 'external_ref'),
      case coalesce(p.import_identity_key, 'external_ref')
        when 'expected_meter_serial' then pp.expected_meter_serial
        else pp.external_ref
      end)
from public.programmes p
where p.id = pp.programme_id and pp.source_identity is null;

-- -- A field this file's predecessor dropped ------------------------------------
--
-- 20260925170000 rewrote cmd_programme_import_apply for the new identity key
-- and, in doing so, stopped returning invalid_rows. Callers that report "2 rows
-- were skipped" got undefined instead. Restored here rather than by editing a
-- migration that has already run.

create or replace function app.cmd_programme_import_apply(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['import_id'], array['import_id']);
  v_import public.programme_imports;
  v_after public.programme_imports;
  v_programme public.programmes;
  v_row public.programme_import_rows;
  v_property public.programme_properties;
  v_identity text;
  v_created integer := 0;
  v_updated integer := 0;
begin
  perform app.programme_require('programme.manage');
  select * into v_import from public.programme_imports
  where id = app.programme_uuid(v_p, 'import_id') for update;
  if not found then perform app.fail('PROGRAMME_IMPORT_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_import.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_import.version));
  end if;
  if v_import.status <> 'Mapped' then perform app.fail('PROGRAMME_IMPORT_NOT_MAPPED'); end if;

  select * into v_programme from public.programmes where id = v_import.programme_id for share;
  v_identity := v_programme.import_identity_key;

  for v_row in
    select * from public.programme_import_rows
    where import_id = v_import.id and action in ('Create', 'Update')
    order by row_index
  loop
    insert into public.programme_properties (
      programme_id, source_identity, external_ref, address_line1, address_line2, town, postcode,
      expected_meter_serial, existing_sim_serial, existing_sim_type, notes, source_row, import_id, synthetic)
    values (
      v_import.programme_id,
      app.programme_source_identity(v_identity, v_row.mapped ->> v_identity),
      v_row.mapped ->> 'external_ref', v_row.mapped ->> 'address_line1',
      v_row.mapped ->> 'address_line2', v_row.mapped ->> 'town', v_row.mapped ->> 'postcode',
      v_row.mapped ->> 'expected_meter_serial', v_row.mapped ->> 'existing_sim_serial',
      v_row.mapped ->> 'existing_sim_type',
      v_row.mapped ->> 'notes',
      jsonb_build_object('header', v_import.header, 'cells', v_row.cells, 'row_index', v_row.row_index),
      v_import.id, v_programme.synthetic)
    on conflict (programme_id, source_identity) do update set
      external_ref          = coalesce(excluded.external_ref, programme_properties.external_ref),
      address_line1         = excluded.address_line1,
      address_line2         = coalesce(excluded.address_line2, programme_properties.address_line2),
      town                  = coalesce(excluded.town, programme_properties.town),
      postcode              = coalesce(excluded.postcode, programme_properties.postcode),
      expected_meter_serial = coalesce(excluded.expected_meter_serial, programme_properties.expected_meter_serial),
      existing_sim_serial   = coalesce(excluded.existing_sim_serial, programme_properties.existing_sim_serial),
      existing_sim_type     = coalesce(excluded.existing_sim_type, programme_properties.existing_sim_type),
      notes                 = coalesce(excluded.notes, programme_properties.notes),
      source_row            = excluded.source_row,
      import_id             = excluded.import_id
    returning * into v_property;

    if v_row.action = 'Create' then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
    update public.programme_import_rows set property_id = v_property.id where id = v_row.id;
  end loop;

  update public.programme_imports set
    status = 'Applied', created_count = v_created, updated_count = v_updated,
    applied_at = now(), applied_by = app.actor_id(p_actor)
  where id = v_import.id
  returning * into v_after;

  perform app.audit('programme_import', v_after.id::text, 'PROGRAMME_IMPORT_APPLY',
    jsonb_build_object('status', v_import.status),
    jsonb_build_object('status', 'Applied', 'created', v_created, 'updated', v_updated));
  return jsonb_build_object('import_id', v_after.id, 'status', v_after.status,
                            'created', v_created, 'updated', v_updated,
                            'invalid_rows', v_after.invalid_rows, 'version', v_after.version);
end
$$;

