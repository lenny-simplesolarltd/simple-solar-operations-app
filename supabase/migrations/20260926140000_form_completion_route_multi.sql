-- =============================================================================
-- app.form_completion_route: choose the programme THIS person can complete
-- through, rather than an arbitrary one.
--
-- A form may be the visit form of more than one programme - a second rollout
-- reusing a proven form, or a synthetic fixture alongside the real programme.
-- The Workflow branch resolved the owner with an unordered
--
--     select * ... where pr.visit_form_id = p_form.id limit 1
--
-- so it could pick a programme the person is not assigned to, decide they may
-- not complete the form, and return null - while they were correctly assigned
-- to the other one. The form then vanished from "To complete" for an installer
-- who was properly set up, with nothing anywhere saying why.
--
-- It now walks the owning programmes and returns the first route the person can
-- actually use, in a deterministic order: real programmes before synthetic
-- fixtures, then by name, so two people asking the same question get the same
-- answer.
--
-- Unchanged: the programme still decides. This function gains no power to widen
-- anything - it checks the same permission and the same assignment, just for
-- every programme that owns the form instead of for one of them at random.
--
-- ROLLBACK: restore the prior definition from 20260925100000.
-- =============================================================================

create or replace function app.form_completion_route(p_form public.forms)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := app.current_person_id();
  v_programme public.programmes;
begin
  if v_me is null then return null; end if;
  -- Only a live, published form can be completed by anybody.
  if p_form.status <> 'published' or p_form.current_revision_id is null then
    return null;
  end if;

  if p_form.access_mode = 'Workflow' then
    -- Programme-independent, so it is asked once rather than per programme.
    if not app.has_permission('programme.visit.submit') then return null; end if;

    for v_programme in
      select *
      from public.programmes pr
      where pr.visit_form_id = p_form.id
        and pr.status <> 'Archived'
      order by pr.synthetic, pr.name, pr.id
    loop
      -- The PROGRAMME decides, with its own assignment rule. This function does
      -- not get a vote, and cannot widen it.
      if app.has_permission('programme.read.all')
         or app.programme_assigned(v_me, v_programme.id) then
        return jsonb_build_object(
          'kind', 'programme',
          'programme_id', v_programme.id,
          'programme_name', v_programme.name,
          'href', '/dashboard/operations/programmes/' || v_programme.id::text || '/visit',
          'context', 'Pick the property you attended, then record the visit.');
      end if;
    end loop;

    -- Workflow-owned but nothing owns it, or nothing this person may work on.
    -- Failing closed matters more here than being helpful.
    return null;
  end if;

  if p_form.access_mode = 'Roles' then
    if not exists (
      select 1
      from public.form_access_roles far
      join public.person_roles pr
        on pr.role_code = far.role_code and pr.person_id = v_me and pr.active
      where far.form_id = p_form.id
    ) then
      return null;
    end if;
    return jsonb_build_object(
      'kind', 'direct',
      'href', '/dashboard/forms/' || p_form.id::text || '/fill',
      'context', 'Complete this form.');
  end if;

  -- Invitation: answered from an emailed link, never from this surface.
  return null;
end
$$;

grant execute on function app.form_completion_route(public.forms) to authenticated, service_role;
