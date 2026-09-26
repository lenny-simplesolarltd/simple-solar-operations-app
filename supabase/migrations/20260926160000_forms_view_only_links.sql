-- =============================================================================
-- One link, three answers: a form link that degrades instead of refusing.
--
-- A form carrying a photo or lookup question could not be linked at all
-- (FORMS_NOT_LINKABLE), because a recipient with no account can own no upload
-- and search no table. That reasoning is still correct for SUBMITTING, and
-- nothing here weakens it. What it got wrong was concluding that such a form
-- cannot be SHARED.
--
-- The PCH installer visit form is the case that showed it up. There was no URL
-- anybody could send: not to a subcontractor, not to a new starter, not to the
-- office. The only way to see what the job asks for was to already have the
-- access needed to do it.
--
-- So a link to such a form is now created and opens for anyone, and what the
-- person gets depends on who they are:
--
--   not signed in          the blank questions, read only, and a prompt to sign in
--   signed in, has access  where they actually complete it, from
--                          app.form_completion_route - the visit screen for a
--                          programme form, the fill page for a role-based one
--   signed in, no access   told to ask the office, rather than a dead end
--
-- SUBMITTING ANONYMOUSLY IS STILL REFUSED. forms_public_submit re-checks the
-- definition itself, so the only way to record one of these is signed in,
-- through the command that owns the work. A view link is a signpost, never a
-- second way in.
--
-- The link carries NO answers, NO job and NO property - only the blank
-- revision, which is a list of questions and not customer data. That is the
-- whole reason it is safe to let it open for anyone: binding an address to a
-- publicly readable URL would publish a client's customer.
--
-- ROLLBACK:
--   begin;
--   -- restore the refusal in app.cmd_forms_invitation_create from 20260921100000
--   -- and drop the two added keys from public.forms_public_open.
--   commit;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Creating a link no longer refuses a staff-only form
-- -----------------------------------------------------------------------------

create or replace function app.cmd_forms_invitation_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['invitation_id', 'token_hash', 'form_id', 'recipient_type', 'job_id',
                                            'person_id', 'recipient_label', 'expires_at'],
                           array['invitation_id', 'token_hash', 'form_id', 'recipient_type']);
  v_form public.forms;
  v_rev public.form_revisions;
  v_inv public.form_invitations;
  v_type text := v_p ->> 'recipient_type';
  v_job uuid := app.forms_uuid(v_p, 'job_id');
  v_person uuid := app.forms_uuid(v_p, 'person_id');
  v_label text := app.txt(v_p, 'recipient_label');
  v_expires timestamptz;
  v_view_only boolean;
begin
  perform app.forms_require('forms.send');
  if coalesce(v_p ->> 'token_hash', '') !~ '^[0-9a-f]{64}$' then perform app.fail('FORMS_INVALID_TOKEN_HASH'); end if;
  select * into v_form from public.forms where id = app.forms_uuid(v_p, 'form_id') for share;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;
  if v_form.kind <> 'form' then perform app.fail('FORMS_TEMPLATE_NOT_SENDABLE'); end if;
  if v_form.status <> 'published' then perform app.fail('FORMS_NOT_PUBLISHED'); end if;

  -- A recipient has no account, so they can own no upload and search no table.
  -- That is still true, and it now decides the KIND of link rather than
  -- refusing one: such a form becomes a view link, and public.forms_public_submit
  -- is what refuses an answer through it.
  select * into v_rev from public.form_revisions where id = v_form.current_revision_id;
  v_view_only := app.forms_definition_staff_only(v_rev.definition);

  if v_type = 'customer' then
    if v_job is null then perform app.fail('FORMS_CUSTOMER_NEEDS_JOB'); end if;
    v_person := null;
  elsif v_type = 'surveyor' then
    if v_person is null
       or not exists (select 1 from public.people p where p.id = v_person and p.active)
       or not app.person_has_active_role(v_person, array['Surveyor']) then
      perform app.fail('FORMS_SURVEYOR_NOT_FOUND');
    end if;
  elsif v_type = 'other' then
    if v_label is null then perform app.fail('FORMS_RECIPIENT_LABEL_REQUIRED'); end if;
    v_person := null;
  else
    perform app.fail('FORMS_INVALID_RECIPIENT_TYPE');
  end if;
  if v_label is not null and char_length(v_label) > 200 then perform app.fail('FORMS_INVALID_RECIPIENT_LABEL'); end if;
  if v_job is not null and not app.forms_job_visible(v_job) then perform app.fail('FORMS_JOB_NOT_FOUND'); end if;

  if app.txt(v_p, 'expires_at') is not null then
    begin
      v_expires := (v_p ->> 'expires_at')::timestamptz;
    exception when others then
      perform app.fail('FORMS_INVALID_EXPIRY');
    end;
    if v_expires <= now() or v_expires > now() + interval '366 days' then
      perform app.fail('FORMS_INVALID_EXPIRY');
    end if;
  end if;

  insert into public.form_invitations (id, form_id, revision_id, token_hash, recipient_type,
                                       job_id, person_id, recipient_label, expires_at)
  values (app.forms_uuid(v_p, 'invitation_id'), v_form.id, v_form.current_revision_id,
          decode(v_p ->> 'token_hash', 'hex'), v_type, v_job, v_person, v_label, v_expires)
  returning * into v_inv;

  perform app.audit('form_invitation', v_inv.id::text, 'FORMS_INVITATION_CREATE', null,
    jsonb_build_object('form_id', v_form.id, 'revision', v_form.current_revision_number,
                       'recipient_type', v_type, 'job_id', v_job, 'person_id', v_person,
                       'expires_at', v_expires, 'view_only', v_view_only));
  return jsonb_build_object('invitation_id', v_inv.id, 'form_id', v_form.id,
                            'revision_id', v_inv.revision_id, 'revision', v_form.current_revision_number,
                            'expires_at', v_inv.expires_at, 'version', v_inv.version,
                            -- So the caller can say which kind of link it made,
                            -- without re-deriving the rule in the app.
                            'view_only', v_view_only);
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Opening a link says whether it can be answered here, and where it cannot
-- -----------------------------------------------------------------------------

create or replace function public.forms_public_open(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_inv public.form_invitations := app.forms_invitation_by_token(p_token);
  v_form public.forms;
  v_rev public.form_revisions;
  v_state text;
  v_view_only boolean;
begin
  if not app.forms_on() then return jsonb_build_object('state', 'unavailable'); end if;
  if v_inv.id is null then return jsonb_build_object('state', 'not_found'); end if;
  select * into v_form from public.forms where id = v_inv.form_id;
  v_state := app.forms_link_state(v_inv, v_form);
  select * into v_rev from public.form_revisions where id = v_inv.revision_id;
  v_view_only := app.forms_definition_staff_only(v_rev.definition);

  return jsonb_build_object(
    'state', v_state,
    'title', v_rev.title,
    'description', case when v_state = 'open' then v_rev.description end,
    'definition', case when v_state = 'open' then v_rev.definition end,
    'submitted_at', v_inv.submitted_at,
    -- Read only: the questions need an account, so they are shown but not asked.
    'view_only', v_view_only,
    -- Where the person reading this would actually complete it. Null for a
    -- visitor with no account, and for a staff member the programme has not
    -- given this work to - both of which the page words differently. The route
    -- is the same one the app's own "To complete" list uses, so a link can
    -- never send somebody somewhere they are not allowed to be.
    'completion_route',
      case when v_state = 'open' and v_view_only
           then app.form_completion_route(v_form) end);
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Submitting anonymously stays refused, checked against the revision itself
-- -----------------------------------------------------------------------------

/**
 * Belt and braces, and the only check that actually matters.
 *
 * Creating a link no longer refuses a staff-only form, so this is now the
 * thing standing between a shared URL and an anonymous submission carrying
 * photo or lookup answers. It reads the revision the link was bound to, not
 * anything the caller sent.
 */
create or replace function app.forms_public_submit_guard(p_revision_id uuid)
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  v_def jsonb;
begin
  select definition into v_def from public.form_revisions where id = p_revision_id;
  if v_def is not null and app.forms_definition_staff_only(v_def) then
    perform app.fail('FORMS_NOT_LINKABLE');
  end if;
end
$$;

-- The submit entry point, unchanged except that it now asks the guard first.
create or replace function public.forms_public_submit(p_token text, p_submission_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.form_invitations := app.forms_invitation_by_token(p_token);
  v_form public.forms;
  v_rev public.form_revisions;
  v_clean jsonb;
  v_state text;
  v_existing public.form_submissions;
begin
  if not app.forms_on() then return jsonb_build_object('ok', false, 'state', 'unavailable'); end if;
  if v_inv.id is null then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  if p_submission_id is null then perform app.fail('FORMS_SUBMISSION_ID_REQUIRED'); end if;

  -- A view link is readable by anyone, and answerable by nobody through here.
  -- Checked before the row is locked and before anything is written.
  perform app.forms_public_submit_guard(v_inv.revision_id);

  -- One submission per link, even under concurrent requests.
  select * into v_inv from public.form_invitations where id = v_inv.id for update;
  select * into v_existing from public.form_submissions where invitation_id = v_inv.id;
  if found then
    return jsonb_build_object('ok', v_existing.id = p_submission_id, 'state', 'submitted',
                              'submitted_at', v_existing.submitted_at);
  end if;

  select * into v_form from public.forms where id = v_inv.form_id;
  v_state := app.forms_link_state(v_inv, v_form);
  if v_state <> 'open' then return jsonb_build_object('ok', false, 'state', v_state); end if;

  select * into v_rev from public.form_revisions where id = v_inv.revision_id;
  v_clean := app.forms_validate_answers(v_rev.definition, p_answers);

  perform set_config('app.executing_service', 'forms:public-link', true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.command_id', '', true);

  insert into public.form_submissions (id, invitation_id, form_id, revision_id, answers)
  values (p_submission_id, v_inv.id, v_inv.form_id, v_inv.revision_id, v_clean);
  update public.form_invitations set submitted_at = now() where id = v_inv.id;

  -- Identifiers only: answers are not copied into the audit log.
  perform app.audit('form_submission', p_submission_id::text, 'FORMS_SUBMITTED', null,
    jsonb_build_object('form_id', v_inv.form_id, 'revision_id', v_inv.revision_id, 'invitation_id', v_inv.id));
  return jsonb_build_object('ok', true, 'state', 'submitted', 'submitted_at', now());
end
$$;
