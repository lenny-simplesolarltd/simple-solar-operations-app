-- =============================================================================
-- What the installer is asked, in words describing what they can actually see.
--
-- The PCH visit form offered:
--
--   "SIM card changed - portal working"
--   "SIM card changed - portal not working"
--
-- An installer on a doorstep cannot see the PCH portal. They can see whether
-- the meter appears to be running. Asking them to report a portal state invites
-- everyone downstream to read a field observation as portal verification, and
-- that is precisely the confusion that would let a property be called finished
-- while its meter is dark. Dan was explicit that signal quality does not prove
-- the portal is live; neither does the installer's impression of the meter.
--
-- So the QUESTION changes and nothing else does:
--
--   "SIM changed - meter appears working"
--   "SIM changed - meter not working"
--
-- The option ids are untouched, so every canonical value is untouched:
-- sim_changed_portal_working still maps through the programme's outcome_map to
-- SimChangedPortalWorking, the review rules still fire on the same outcomes, and
-- the constraint that a visit cannot be Complete & working without the office
-- recording portal_verification = 'ConfirmedLive' is not weakened by a word.
--
-- Published as a new revision rather than edited in place: form_revisions are
-- immutable, and every visit already submitted keeps the revision it was
-- answered on, so no historical submission is reinterpreted by this change.
-- =============================================================================

do $$
declare
  v_form public.forms;
  v_definition jsonb;
  v_revision uuid;
  v_changed integer := 0;
begin
  select f.* into v_form
  from public.forms f
  join public.programmes p on p.visit_form_id = f.id
  where p.code = 'PCH-SIM-2026';

  if not found then
    raise notice 'no PCH visit form here; nothing to reword';
    return;
  end if;

  -- Rewrite only the `label` of the two options, matched by their ids, wherever
  -- they appear in the definition's field list.
  select jsonb_set(
           v_form.definition,
           '{fields}',
           (select jsonb_agg(
              case
                when field ? 'options' then
                  jsonb_set(field, '{options}', (
                    select jsonb_agg(
                      case option ->> 'id'
                        when 'sim_changed_portal_working'
                          then jsonb_set(option, '{label}',
                               to_jsonb('SIM changed - meter appears working'::text))
                        when 'sim_changed_portal_not_working'
                          then jsonb_set(option, '{label}',
                               to_jsonb('SIM changed - meter not working'::text))
                        else option
                      end
                      order by ordinality)
                    from jsonb_array_elements(field -> 'options')
                         with ordinality as o(option, ordinality)))
                else field
              end
              order by ordinality)
            from jsonb_array_elements(v_form.definition -> 'fields')
                 with ordinality as f(field, ordinality)))
    into v_definition;

  if v_definition is null or v_definition = v_form.definition then
    raise notice 'PCH form wording already current; nothing to publish';
    return;
  end if;

  select count(*) into v_changed
  from jsonb_array_elements(v_definition -> 'fields') field,
       jsonb_array_elements(coalesce(field -> 'options', '[]'::jsonb)) option
  where option ->> 'label' like 'SIM changed - meter%';

  if v_changed <> 2 then
    raise exception 'expected to reword 2 options, reworded %', v_changed;
  end if;

  update public.forms
     set definition = v_definition,
         updated_at = now()
   where id = v_form.id;

  insert into public.form_revisions (
    form_id, revision_number, title, description, definition)
  values (
    v_form.id, v_form.current_revision_number + 1,
    v_form.title, v_form.description, v_definition)
  returning id into v_revision;

  update public.forms
     set current_revision_id = v_revision,
         current_revision_number = v_form.current_revision_number + 1
   where id = v_form.id;

  raise notice 'PCH visit form reworded and published as revision %',
    v_form.current_revision_number + 1;
end
$$;
