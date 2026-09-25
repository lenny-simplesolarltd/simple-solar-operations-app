-- Removes the synthetic scale fixture, leaving the DEV-PCH-SIM programme as
-- `supabase db reset` created it.
--
-- It exists because the fixture is deliberately large, and the integration suite
-- counts rows: a database carrying 1,400 extra properties fails tests that are
-- perfectly correct. So the fixture is something you switch on for scale and
-- browser work and switch off again, not a permanent part of the local database.
--
-- Everything it created is labelled DEV-S in its own data, so this removes
-- exactly that and nothing else.
do $$
declare
  v_programme uuid;
  v_subs uuid[];
begin
  if coalesce(current_setting('app.scale_fixture', true), '') <> 'yes' then
    raise exception 'refusing to run: set app.scale_fixture = ''yes'' first';
  end if;

  select id into v_programme from public.programmes
  where code = 'DEV-PCH-SIM' and synthetic;
  if not found then
    raise notice 'no synthetic fixture programme here; nothing to do';
    return;
  end if;

  select array_agg(v.submission_id) into v_subs
  from public.programme_visits v
  join public.programme_properties pp on pp.id = v.property_id
  where pp.programme_id = v_programme and pp.external_ref like 'DEV-S%'
    and v.submission_id is not null;

  delete from public.programme_visits v
  using public.programme_properties pp
  where pp.id = v.property_id
    and pp.programme_id = v_programme
    and pp.external_ref like 'DEV-S%';

  delete from public.programme_properties
  where programme_id = v_programme and external_ref like 'DEV-S%';

  -- form_submissions has an immutability trigger for real submissions; these are
  -- fixture rows and are removed with it disabled for this statement only.
  if v_subs is not null then
    alter table public.form_submissions disable trigger form_submissions_immutable;
    delete from public.form_submissions where id = any (v_subs);
    alter table public.form_submissions enable trigger form_submissions_immutable;
  end if;

  raise notice 'fixture removed: % properties and % visits remain',
    (select count(*) from public.programme_properties where programme_id = v_programme),
    (select count(*) from public.programme_visits where programme_id = v_programme);
end
$$;
