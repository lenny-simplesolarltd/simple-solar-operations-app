-- =============================================================================
-- One search box over a programme's visits.
--
-- Office is handed whatever the caller has: an address, a postcode, a PCH
-- reference, a meter serial, a SIM serial. They should be able to type it into
-- one box. The obvious implementation - OR together the visit's own columns and
-- the property's - cannot be expressed as a single PostgREST read: a logic tree
-- may not span an embedded resource, so it takes two OR groups, and two OR
-- groups are ANDed. That silently requires the address AND the serial to match,
-- which finds nothing.
--
-- Splitting it into two round trips would be worse: the count would stop
-- describing the rows, which is the exact defect this work exists to remove.
--
-- So the searchable text is kept on the visit, maintained by trigger from the
-- visit and from its property. One column, one filter, composes with every
-- other filter, and the exact count still describes the same set as the rows.
--
-- Deliberately no trigram index: a programme is a few thousand visits, where
-- the scan is immaterial, and installing an extension on a shared database to
-- pre-empt a problem nobody has is not a trade worth making. If a programme
-- ever reaches a size where this shows up in a query plan, add pg_trgm and a
-- gin index on this column - no application code has to change.
-- =============================================================================

alter table public.programme_visits add column search_text text;

comment on column public.programme_visits.search_text is
  'Denormalised, trigger-maintained. The address, town, postcode, PCH reference, '
  'expected meter serial, actual meter serial and new SIM serial, lowercased, so '
  'one search box can match any of them in a single query.';

create function app.programme_visit_search_text(
  p_visit public.programme_visits
) returns text
language sql
stable
set search_path = ''
as $$
  select lower(
    concat_ws(' ',
      pp.external_ref,
      pp.address_line1,
      pp.address_line2,
      pp.town,
      pp.postcode,
      pp.postcode_norm,
      pp.expected_meter_serial,
      pp.expected_serial_norm,
      pp.existing_sim_serial,
      p_visit.actual_meter_serial,
      p_visit.actual_serial_norm,
      p_visit.new_sim_serial,
      app.programme_norm_serial(p_visit.new_sim_serial)))
  from public.programme_properties pp
  where pp.id = p_visit.property_id;
$$;

create function app.programme_visit_search_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text := app.programme_visit_search_text(new);
  return new;
end
$$;

-- Before the row is written, so the column can never disagree with the row.
create trigger programme_visits_search_sync
  before insert or update of property_id, actual_meter_serial, new_sim_serial
  on public.programme_visits
  for each row execute function app.programme_visit_search_sync();

create function app.programme_property_search_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A corrected address must not leave its visits findable only under the old
  -- one. Properties are edited rarely and have few visits each, so refreshing
  -- them here is cheaper than any of the alternatives.
  update public.programme_visits v
     set search_text = app.programme_visit_search_text(v)
   where v.property_id = new.id;
  return null;
end
$$;

create trigger programme_properties_search_sync
  after update of external_ref, address_line1, address_line2, town, postcode,
                  expected_meter_serial, existing_sim_serial
  on public.programme_properties
  for each row execute function app.programme_property_search_sync();

-- Backfill. Written as an update of the trigger's own columns would be a no-op
-- change, so it is set directly from the same function the trigger uses.
update public.programme_visits v
   set search_text = app.programme_visit_search_text(v);

-- Execute is granted explicitly, not inherited: the default privileges were
-- revoked from public early on, and the blanket grants in earlier migrations
-- only covered the functions that existed when they ran.
grant execute on function
  app.programme_visit_search_text(public.programme_visits),
  app.programme_visit_search_sync(),
  app.programme_property_search_sync()
to authenticated, service_role;
