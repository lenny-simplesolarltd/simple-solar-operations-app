-- =============================================================================
-- Programme imports: the source's own identity, and the SIM it arrived with.
--
-- WHY
-- ---
-- programme_properties.external_ref was doing two jobs at once. Its comment and
-- its label ("Property ID (the client's reference)") say what it is: the
-- CLIENT'S identifier for a property. But it was also the import's upsert key -
-- unique (programme_id, external_ref), on conflict ... do update - so every
-- programme was forced to be given one, whether or not the client had ever
-- issued such a thing.
--
-- The real PCH register (DEC MET Meters.csv, 1,468 rows) has no property
-- reference at all. Its columns are Address, Meter No, Sim Type, ICCID. The
-- stable thing the client actually supplies is the METER, and a meter is what
-- the work is about: several meters at one address are several work items, and
-- must stay several records.
--
-- Putting the meter serial into external_ref would have been a lie in the
-- column that staff read as "the client's property ID", so the two jobs are
-- separated instead:
--
--   external_ref     stays exactly what it says it is, and becomes OPTIONAL.
--   source_identity  is the new upsert key: the normalised value of whichever
--                    canonical field that programme declares as its identity.
--
-- programmes.import_identity_key names that field. It defaults to external_ref,
-- so every existing programme keeps the behaviour it has today, and the backfill
-- below gives their properties the identity they already had.
--
-- The application's own uuid primary key is untouched. Visits, assignments,
-- evidence and every URL still key on it; nothing here changes what a property
-- IS, only how a row of somebody's spreadsheet is recognised as one.
--
-- Identity is compared NORMALISED (app.programme_source_identity), so a meter
-- serial that arrives as " eml1409032559 " in a revised register updates the
-- property it already belongs to instead of creating a second one. external_ref
-- identities are only trimmed, which is what they were already compared as -
-- normalising them would be a silent semantic change to live programmes.
--
-- Also adds existing_sim_type: the register's "Sim Type" (Velos, 1N) is baseline
-- data about what is on site, exactly like existing_sim_serial beside it. It is
-- stored as supplied, trimmed and no more: an unrecognised value is somebody's
-- fact about the world, not an error to normalise away.
--
-- ROLLBACK:
--   begin;
--   alter table public.programme_properties
--     drop constraint programme_properties_programme_id_source_identity_key,
--     drop column source_identity,
--     drop column existing_sim_type,
--     alter column external_ref set not null,
--     add constraint programme_properties_programme_id_external_ref_key
--       unique (programme_id, external_ref);
--   alter table public.programmes drop column import_identity_key;
--   -- Then re-run app.programme_import_keys, app.programme_import_required_keys,
--   -- app.cmd_programme_import_map and app.cmd_programme_import_apply from
--   -- 20260921110000_programmes.sql, and drop app.programme_source_identity.
--   commit;
-- =============================================================================

-- -- Which canonical field carries this programme's source identity -------------

alter table public.programmes
  add column import_identity_key text not null default 'external_ref'
    check (import_identity_key in ('external_ref', 'expected_meter_serial'));

comment on column public.programmes.import_identity_key is
  'The canonical import field whose value identifies a property in this programme''s source data. Defaults to external_ref; a register that has no client property reference (PCH) uses expected_meter_serial. Never the address: several meters at one address are several properties.';

/**
 * The comparable form of a source identity.
 *
 * Meter serials are normalised the same way expected_serial_norm is, so case and
 * punctuation in a revised register cannot fork a property. Everything else is
 * trimmed only - external_ref was compared exactly before this migration and
 * must keep being compared the same way.
 */
create function app.programme_source_identity(p_key text, p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_key = 'expected_meter_serial' then app.programme_norm_serial(p_value)
    else nullif(btrim(coalesce(p_value, '')), '')
  end
$$;

grant execute on function app.programme_source_identity(text, text) to authenticated, service_role;

-- -- The property: an optional client reference, an identity, a SIM type -------

alter table public.programme_properties
  alter column external_ref drop not null,
  add column existing_sim_type text
    check (existing_sim_type is null or char_length(btrim(existing_sim_type)) between 1 and 100),
  add column source_identity text
    check (source_identity is null or char_length(source_identity) between 1 and 100);

comment on column public.programme_properties.external_ref is
  'The client''s own identifier for the property, when they issue one. Optional: the PCH register does not have one. Not the import key - see source_identity.';
comment on column public.programme_properties.source_identity is
  'The normalised value of this programme''s import_identity_key for this row: what a re-imported register is matched against. Unique within the programme.';
comment on column public.programme_properties.existing_sim_type is
  'The SIM type or provider the client''s records say is fitted (Velos, 1N). Baseline, as supplied; the visit records what was actually found.';

-- Every existing property was identified by its external_ref, so that is its
-- identity. Trimmed, matching how the old unique constraint compared it.
update public.programme_properties
  set source_identity = nullif(btrim(external_ref), '')
  where source_identity is null;

alter table public.programme_properties
  drop constraint programme_properties_programme_id_external_ref_key,
  add constraint programme_properties_programme_id_source_identity_key
    unique (programme_id, source_identity);

-- The old index led with external_ref because that was the lookup. Identity is.
drop index if exists public.programme_properties_programme_idx;
create index programme_properties_programme_idx
  on public.programme_properties (programme_id, source_identity);
create index programme_properties_external_ref_idx
  on public.programme_properties (programme_id, external_ref) where external_ref is not null;

-- -- The canonical import fields ------------------------------------------------

create or replace function app.programme_import_keys()
returns text[]
language sql immutable set search_path = ''
as $$
  select array['external_ref', 'address_line1', 'address_line2', 'town', 'postcode',
               'expected_meter_serial', 'existing_sim_serial', 'existing_sim_type', 'notes']
$$;

/**
 * What a file must carry before it can be imported into THIS programme.
 *
 * The identity field and an address. Nothing else: a SIM serial or type the
 * client happened to omit is missing baseline data, not an unimportable
 * property - the installer records what is actually there on the visit.
 */
create or replace function app.programme_import_required_keys(p_identity_key text default 'external_ref')
returns text[]
language sql immutable set search_path = ''
as $$ select array[p_identity_key, 'address_line1'] $$;

-- -- Mapping and checking the staged rows ---------------------------------------

create or replace function app.cmd_programme_import_map(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['import_id', 'mapping'], array['import_id', 'mapping']);
  v_import public.programme_imports;
  v_after public.programme_imports;
  v_mapping jsonb := v_p -> 'mapping';
  v_key text;
  v_width integer;
  v_seen integer[] := '{}';
  v_column integer;
  v_identity text;
begin
  perform app.programme_require('programme.manage');
  select * into v_import from public.programme_imports
  where id = app.programme_uuid(v_p, 'import_id') for update;
  if not found then perform app.fail('PROGRAMME_IMPORT_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_import.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_import.version));
  end if;
  if v_import.status not in ('Draft', 'Mapped') then perform app.fail('PROGRAMME_IMPORT_NOT_DRAFT'); end if;
  if v_import.row_count = 0 then perform app.fail('PROGRAMME_IMPORT_EMPTY'); end if;

  select import_identity_key into v_identity from public.programmes where id = v_import.programme_id;

  v_width := jsonb_array_length(v_import.header);
  if jsonb_typeof(v_mapping) <> 'object' then perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID'); end if;
  for v_key in select jsonb_object_keys(v_mapping) loop
    if not v_key = any (app.programme_import_keys()) then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID', jsonb_build_object('key', v_key));
    end if;
    if jsonb_typeof(v_mapping -> v_key) <> 'number' then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID', jsonb_build_object('key', v_key));
    end if;
    v_column := (v_mapping ->> v_key)::int;
    if v_column < 0 or v_column >= v_width then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID', jsonb_build_object('key', v_key, 'column', v_column));
    end if;
    if v_column = any (v_seen) then
      perform app.fail('PROGRAMME_IMPORT_COLUMN_REUSED', jsonb_build_object('column', v_column));
    end if;
    v_seen := v_seen || v_column;
  end loop;
  foreach v_key in array app.programme_import_required_keys(v_identity) loop
    if not v_mapping ? v_key then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_REQUIRED', jsonb_build_object('key', v_key));
    end if;
  end loop;

  -- One pass over the staged rows: canonical values, problems, and the action.
  -- Identity is this programme's configured field, compared normalised, so a
  -- property is recognised across re-imports however the source spelled it.
  with mapped as (
    select r.id, r.row_index,
           (select jsonb_object_agg(m.key, nullif(btrim(coalesce(r.cells ->> (m.value #>> '{}')::int, '')), ''))
            from jsonb_each(v_mapping) m) as values
    from public.programme_import_rows r
    where r.import_id = v_import.id
  ), keyed as (
    select m.*, app.programme_source_identity(v_identity, m.values ->> v_identity) as identity
    from mapped m
  ), judged as (
    select k.id, k.row_index, k.values, k.identity,
           (select pp.id from public.programme_properties pp
            where pp.programme_id = v_import.programme_id
              and pp.source_identity = k.identity) as existing_id,
           (
             select coalesce(jsonb_agg(problem), '[]'::jsonb) from (
               select jsonb_build_object('field', v_identity, 'problem', 'missing') as problem
               where k.identity is null
               union all
               select jsonb_build_object('field', v_identity, 'problem', 'too long')
               where char_length(k.identity) > 100
               union all
               select jsonb_build_object('field', 'address_line1', 'problem', 'missing')
               where k.values ->> 'address_line1' is null
               union all
               select jsonb_build_object('field', 'address_line1', 'problem', 'too long')
               where char_length(k.values ->> 'address_line1') > 200
               union all
               select jsonb_build_object('field', 'external_ref', 'problem', 'too long')
               where char_length(k.values ->> 'external_ref') > 100
               union all
               -- The same identity twice in one file: importing both would make
               -- the second silently overwrite the first.
               select jsonb_build_object('field', v_identity, 'problem', 'repeated in this file')
               where k.identity is not null
                 and exists (
                   select 1 from keyed k2
                   where k2.row_index < k.row_index and k2.identity = k.identity)
             ) p
           ) as problems
    from keyed k
  )
  update public.programme_import_rows r set
    mapped = j.values,
    problems = j.problems,
    action = case when jsonb_array_length(j.problems) > 0 then 'Invalid'
                  when j.existing_id is not null then 'Update'
                  else 'Create' end,
    property_id = j.existing_id
  from judged j
  where r.id = j.id;

  update public.programme_imports set
    mapping = v_mapping,
    status = 'Mapped',
    valid_rows = (select count(*) from public.programme_import_rows r
                  where r.import_id = v_import.id and r.action in ('Create', 'Update')),
    invalid_rows = (select count(*) from public.programme_import_rows r
                    where r.import_id = v_import.id and r.action = 'Invalid')
  where id = v_import.id
  returning * into v_after;

  perform app.audit('programme_import', v_after.id::text, 'PROGRAMME_IMPORT_MAP',
    jsonb_build_object('mapping', v_import.mapping),
    jsonb_build_object('mapping', v_mapping, 'valid_rows', v_after.valid_rows,
                       'invalid_rows', v_after.invalid_rows));
  return jsonb_build_object('import_id', v_after.id, 'status', v_after.status,
                            'valid_rows', v_after.valid_rows, 'invalid_rows', v_after.invalid_rows,
                            'version', v_after.version);
end
$$;

-- -- Applying ------------------------------------------------------------------

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
      -- Baseline facts are refreshed from the newer register. A field the new
      -- file leaves blank keeps what is on record rather than being erased:
      -- a revised register is usually a correction, not a replacement, and
      -- nothing here touches the visits already recorded against the property.
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
                            'created', v_created, 'updated', v_updated, 'version', v_after.version);
end
$$;

-- -- The PCH programme's identity ----------------------------------------------
--
-- The delivered register (Address, Meter No, Sim Type, ICCID) carries no
-- property reference, and the work item is the meter. Scoped to this one
-- programme by code: every other programme keeps the external_ref default.
update public.programmes
  set import_identity_key = 'expected_meter_serial'
  where code = 'PCH-SIM-2026';
