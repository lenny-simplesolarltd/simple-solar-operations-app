-- =============================================================================
-- Two things the product needed to be usable rather than merely built.
--
-- 1. WHO MAY COMPLETE A FORM.
--
--    Forms had permissions for ADMINISTERING forms (forms.read/create/edit/
--    publish) and nothing at all for FILLING ONE IN. Completion was authorised
--    entirely by whatever other domain happened to call app.forms_staff_submit
--    - which is correct for a programme, and useless for "show me the forms I
--    am supposed to complete". An installer opening /dashboard/forms was
--    redirected away, because seeing the list required forms.read, which is
--    Forms administration and which they rightly do not have.
--
--    So eligibility becomes a first-class property OF THE FORM, in three
--    shapes, and never a fourth:
--
--      Workflow    another domain owns it. A programme's visit form is the
--                  case in hand: the programme decides, using its own
--                  permissions and its own property visibility, and this
--                  model does not get a vote. Completing it goes THROUGH that
--                  workflow, never through a generic submit endpoint.
--      Roles       the form manager names roles that may complete it.
--      Invitation  a recipient link, which is how customers and surveyors
--                  already answer forms. No staff eligibility at all.
--
--    Invitation is the default, because it is what every existing form is:
--    adding this column must not silently widen anything.
--
-- 2. WHAT "PROGRESS" MEANS.
--
--    The overview could only ever say "x% of the properties we have imported",
--    which on day one of a 1,400-property programme with 12 imported rows reads
--    as 100% and means nothing. A programme now carries a delivery target and
--    optional dates, so progress can be stated against what was AGREED rather
--    than against what happens to be loaded.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Delivery targets
-- -----------------------------------------------------------------------------

alter table public.programmes
  -- What was agreed with the client, which is not the same as what has been
  -- imported. Null when no target has been agreed.
  add column target_property_count integer
    check (target_property_count is null or target_property_count > 0),
  add column delivery_start_date date,
  add column delivery_end_date   date,
  add constraint programmes_delivery_window_ordered
    check (delivery_start_date is null
           or delivery_end_date is null
           or delivery_end_date >= delivery_start_date);

comment on column public.programmes.target_property_count is
  'Properties the client expects covered. Progress is reported against this when set, and against imported rows when not.';
comment on column public.programmes.delivery_start_date is
  'Start of the agreed delivery window. Null until confirmed - a required-per-day figure is not invented without it.';

-- PCH: 1,400 properties is the figure Dan gave. The DATES are deliberately
-- left null: "about three weeks" is not a contractual window, and a required
-- run rate computed from a guessed end date would be a fabricated number on a
-- client-facing report.
update public.programmes
set target_property_count = 1400
where code = 'PCH-SIM-2026';

-- The synthetic fixture gets a target too, so the target maths is exercised
-- locally without touching the real programme.
update public.programmes
set target_property_count = 40
where code = 'DEV-PCH-SIM';

-- -----------------------------------------------------------------------------
-- 2. Form completion access
-- -----------------------------------------------------------------------------

alter table public.forms
  add column access_mode text not null default 'Invitation'
    check (access_mode in ('Invitation', 'Roles', 'Workflow'));

comment on column public.forms.access_mode is
  'Who may COMPLETE this form. Invitation: recipient links only. Roles: the roles in form_access_roles. Workflow: another domain decides (a programme''s visit form).';

create table public.form_access_roles (
  form_id    uuid not null references public.forms (id) on delete cascade,
  role_code  text not null references public.roles (code),
  created_at timestamptz not null default now(),
  created_by uuid references public.people (id),
  primary key (form_id, role_code)
);
comment on table public.form_access_roles is
  'Roles allowed to complete a form whose access_mode is Roles. Never consulted in any other mode.';

alter table public.form_access_roles enable row level security;
revoke all on public.form_access_roles from anon, authenticated;
grant select on public.form_access_roles to authenticated;

-- Readable by anyone who may see forms at all, and by anyone the row names:
-- a person has to be able to learn why a form is offered to them.
create policy form_access_roles_select on public.form_access_roles
  for select to authenticated
  using (
    app.has_permission('forms.read')
    or role_code in (select role_code from public.person_roles pr
                     where pr.person_id = app.current_person_id() and pr.active)
  );

-- No row-level audit trigger here, deliberately. This is a join table: its key
-- is (form_id, role_code) and it has no id and no code, and app.audit_row_change
-- names the row it changed with coalesce(id, code) - so a row trigger would fail
-- on audit_events.entity_id being not null and take the whole command with it.
-- app.cmd_form_access_set below records the change properly instead: one
-- FormAccessChanged event against the FORM, carrying the mode and the entire
-- role list before and after. That is the entity somebody would look under, and
-- it is one event rather than a row per role.

-- The programme's visit form is workflow-owned: the programme's own
-- permissions and property visibility decide, exactly as they already did.
update public.forms f
set access_mode = 'Workflow'
where exists (select 1 from public.programmes p where p.visit_form_id = f.id);

-- -----------------------------------------------------------------------------
-- 3. The single authority on "may this person complete this form"
-- -----------------------------------------------------------------------------

/**
 * Whether the signed-in person may complete this form, and through which
 * workflow.
 *
 * SECURITY DEFINER because it reads role_permissions and programme assignment,
 * which a field worker cannot select directly. It takes no caller-supplied
 * identity: the actor is always app.current_person_id(). A form manager
 * cannot use it to grant anything - it only ever reports what the
 * configuration already says.
 */
create function app.form_completion_route(p_form public.forms)
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
    select * into v_programme
    from public.programmes pr
    where pr.visit_form_id = p_form.id and pr.status <> 'Archived'
    limit 1;
    if not found then
      -- Workflow-owned but nothing owns it: nobody may complete it. Failing
      -- closed matters more here than being helpful.
      return null;
    end if;
    -- The PROGRAMME decides, with its own permission and its own assignment
    -- rule. This function does not get a vote, and cannot widen it.
    if not app.has_permission('programme.visit.submit') then return null; end if;
    if not app.has_permission('programme.read.all')
       and not app.programme_assigned(v_me, v_programme.id) then
      return null;
    end if;
    return jsonb_build_object(
      'kind', 'programme',
      'programme_id', v_programme.id,
      'programme_name', v_programme.name,
      'href', '/dashboard/operations/programmes/' || v_programme.id::text || '/visit',
      'context', 'Pick the property you attended, then record the visit.');
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

-- -----------------------------------------------------------------------------
-- 4. MY_FORMS - the completion surface
--
-- Deliberately requires NO forms.* permission. Needing Forms administration in
-- order to be shown the form you are expected to fill in is the whole problem
-- this read exists to remove.
-- -----------------------------------------------------------------------------

create function app.read_my_forms(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'forms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'form_id', f.id,
        'title', f.title,
        'description', f.description,
        'access_mode', f.access_mode,
        'revision', f.current_revision_number,
        'route', app.form_completion_route(f))
        order by f.title)
      from public.forms f
      where f.status = 'published'
        and f.kind = 'form'
        and f.archived_at is null
        and app.form_completion_route(f) is not null), '[]'::jsonb),
    'retrieved_at', now());
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('MY_FORMS',
   array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   '[]', 'forms',
   'The forms this person may complete, with the workflow each one is completed through. Requires no Forms administration permission - that is the point.');

-- -----------------------------------------------------------------------------
-- 5. Configuring it: a form manager sets the mode and the roles
-- -----------------------------------------------------------------------------

/**
 * The actor-aware form of app.forms_require.
 *
 * The command and the read below both ask whether the ACTOR holds a permission,
 * and only app.forms_require(text) existed, which can answer only for the
 * session. Without this overload both fail with "function app.forms_require
 * (jsonb, unknown) does not exist" the first time anybody uses them.
 */
create function app.forms_require(p_actor jsonb, p_permission text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not app.actor_has_permission(p_actor, p_permission) then
    perform app.fail('FORMS_PERMISSION_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end
$$;

create function app.cmd_form_access_set(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_form public.forms;
  v_id uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'form_id');
  v_mode text := nullif(btrim(coalesce(p_request -> 'payload' ->> 'access_mode', '')), '');
  v_roles text[];
  v_role text;
  v_before jsonb;
begin
  -- Editing a form is what configuring its audience is.
  perform app.forms_require(p_actor, 'forms.edit');
  select * into v_form from public.forms where id = v_id for update;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;
  perform app.r2_optional_version(p_request, v_form.version);

  if v_mode is null or v_mode not in ('Invitation', 'Roles', 'Workflow') then
    perform app.fail('FORMS_ACCESS_MODE_INVALID');
  end if;

  -- Workflow ownership is a fact about who points at the form, not a setting.
  -- Letting a manager declare it would produce a form nothing owns, which
  -- app.form_completion_route then refuses to anybody - a silent dead end.
  if v_mode = 'Workflow'
     and not exists (select 1 from public.programmes p where p.visit_form_id = v_form.id) then
    perform app.fail('FORMS_ACCESS_NOT_WORKFLOW_OWNED');
  end if;

  select coalesce(array_agg(distinct t.value), '{}') into v_roles
  from jsonb_array_elements_text(coalesce(p_request -> 'payload' -> 'role_codes', '[]'::jsonb)) t(value);

  if v_mode = 'Roles' and coalesce(array_length(v_roles, 1), 0) = 0 then
    perform app.fail('FORMS_ACCESS_ROLES_REQUIRED');
  end if;

  foreach v_role in array v_roles loop
    if not exists (select 1 from public.roles r where r.code = v_role and r.active) then
      perform app.fail('FORMS_ACCESS_ROLE_UNKNOWN', jsonb_build_object('role', v_role));
    end if;
  end loop;

  v_before := jsonb_build_object(
    'access_mode', v_form.access_mode,
    'roles', coalesce((select jsonb_agg(role_code order by role_code)
                       from public.form_access_roles where form_id = v_id), '[]'::jsonb));

  update public.forms set access_mode = v_mode where id = v_id;
  delete from public.form_access_roles where form_id = v_id;
  if v_mode = 'Roles' then
    insert into public.form_access_roles (form_id, role_code)
    select v_id, unnest(v_roles);
  end if;

  perform app.audit('Forms', v_id::text, 'FormAccessChanged', v_before,
                    jsonb_build_object('access_mode', v_mode, 'roles', to_jsonb(v_roles)),
                    nullif(btrim(coalesce(p_request -> 'payload' ->> 'reason', '')), ''));

  return jsonb_build_object('form_id', v_id, 'access_mode', v_mode,
                            'roles', to_jsonb(v_roles));
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('FORM_ACCESS_SET', array['Admin', 'Manager', 'Office'], false, '[]', 'forms',
   'Configure who may complete a form. Workflow mode is refused unless a workflow actually owns the form, so a manager cannot create a form nobody can reach.');

-- The form detail read must carry the access configuration, so the editor can
-- show it rather than the manager having to guess.
create or replace function app.read_form_access(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid := app.ref(p_request, 'form_id');
  v_form public.forms;
begin
  perform app.forms_require(p_actor, 'forms.read');
  select * into v_form from public.forms where id = v_id;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;
  return jsonb_build_object(
    'form_id', v_form.id,
    'access_mode', v_form.access_mode,
    'workflow_owned', exists (select 1 from public.programmes p where p.visit_form_id = v_form.id),
    'workflow_name', (select p.name from public.programmes p where p.visit_form_id = v_form.id limit 1),
    'roles', coalesce((select jsonb_agg(role_code order by role_code)
                       from public.form_access_roles where form_id = v_form.id), '[]'::jsonb),
    'all_roles', coalesce((select jsonb_agg(code order by code)
                           from public.roles where active), '[]'::jsonb),
    'retrieved_at', now());
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('FORM_ACCESS', array['Admin', 'Manager', 'Office', 'Director'], '[]', 'forms',
   'One form''s completion-access configuration, and the roles available to choose from.');
