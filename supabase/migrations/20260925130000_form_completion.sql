-- =============================================================================
-- COMPLETING A ROLES-MODE FORM.
--
-- 20260925100000 made eligibility a property of the form and added MY_FORMS, so
-- an installer is finally SHOWN the form they are expected to fill in. For a
-- Roles-mode form app.form_completion_route points them at
-- /dashboard/forms/<id>/fill - and nothing behind that link existed:
--
--   * the form and its revisions are readable only with forms.read (RLS), which
--     a filler rightly does not have, so the page could not even load the
--     questions;
--   * app.forms_staff_submit is executable by postgres alone. It is a helper
--     called INSIDE another domain's command (the programme's visit submit), so
--     there was no command through which a Roles-mode form could be submitted
--     at all.
--
-- So the list offered a link to a page that could not work. This migration adds
-- the two missing halves, and nothing else:
--
--   FORM_TO_COMPLETE  the questions, for a person the form itself entitles.
--   FORM_COMPLETE     their submission.
--
-- Both ask app.form_completion_route the same question the list asked, and both
-- accept only kind 'direct'. A Workflow-owned form is refused here even to
-- somebody who could complete it through its programme: the programme decides
-- which property was visited and what the answers mean, and a generic submit
-- would write a submission that belongs to no visit.
--
-- Neither requires any forms.* permission. Needing Forms administration in
-- order to fill in a form is the problem this pair finishes removing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The questions
-- -----------------------------------------------------------------------------

/**
 * One form to complete: the published revision's questions, for a person the
 * form's own access model entitles.
 *
 * SECURITY DEFINER because public.forms and public.form_revisions are readable
 * only with forms.read. It widens nothing: the row is returned only when
 * app.form_completion_route already says this person may complete this form
 * directly, and the route function takes no caller-supplied identity.
 *
 * The CURRENT revision is returned, and its id with it, so the submission
 * records the revision that was actually on screen rather than whichever one is
 * current when Submit is pressed.
 */
create function app.read_form_to_complete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid := app.ref(p_request, 'form_id');
  v_form public.forms;
  v_rev public.form_revisions;
  v_route jsonb;
begin
  if v_id is null then perform app.fail('FORMS_NOT_FOUND'); end if;
  select * into v_form from public.forms where id = v_id;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;

  v_route := app.form_completion_route(v_form);
  -- Not entitled, not published, or owned by a workflow: the same refusal in
  -- every case. Which of the three it was is not this person's business, and
  -- saying would leak the existence and state of forms they cannot see. The
  -- code ends in _DENIED so the read boundary classifies it as a refusal rather
  -- than logging every stale link as a server error.
  if v_route is null or v_route ->> 'kind' <> 'direct' then
    perform app.fail('FORMS_COMPLETION_DENIED');
  end if;

  select * into v_rev from public.form_revisions where id = v_form.current_revision_id;
  if not found then perform app.fail('FORMS_REVISION_NOT_FOUND'); end if;

  return jsonb_build_object(
    'form_id', v_form.id,
    'revision_id', v_rev.id,
    'revision', v_rev.revision_number,
    'title', v_rev.title,
    'description', v_rev.description,
    'definition', v_rev.definition,
    'retrieved_at', now());
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('FORM_TO_COMPLETE',
   array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   '[]', 'forms',
   'The questions of one form this person may complete directly. Gated by app.form_completion_route, not by forms.read - a filler is not an administrator.');

-- -----------------------------------------------------------------------------
-- 2. The submission
-- -----------------------------------------------------------------------------

/**
 * Records a Roles-mode form's answers as a Staff submission.
 *
 * The entitlement is re-asked here, against the form as it is NOW: a role
 * removed, or an access mode changed, while the form sat open on a phone must
 * refuse the submission rather than accept it because the page had once been
 * allowed to load.
 *
 * app.forms_staff_submit does the rest - it validates the answers against the
 * revision that was answered and returns the existing row on a replay - so
 * there is exactly one place in the database that writes a staff submission.
 */
create function app.cmd_form_complete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_request -> 'payload', '{}'::jsonb);
  v_form public.forms;
  v_id uuid := app.ref(v_payload, 'form_id');
  v_submission uuid := app.ref(v_payload, 'submission_id');
  v_revision uuid := app.ref(v_payload, 'revision_id');
  v_answers jsonb := coalesce(v_payload -> 'answers', '{}'::jsonb);
  v_route jsonb;
begin
  if v_id is null then perform app.fail('FORMS_NOT_FOUND'); end if;
  if v_submission is null then perform app.fail('FORMS_SUBMISSION_ID_REQUIRED'); end if;
  if jsonb_typeof(v_answers) <> 'object' then perform app.fail('FORMS_INVALID_ANSWER'); end if;

  select * into v_form from public.forms where id = v_id for share;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;

  v_route := app.form_completion_route(v_form);
  if v_route is null or v_route ->> 'kind' <> 'direct' then
    perform app.fail('FORMS_COMPLETION_DENIED');
  end if;

  -- The revision the person had on screen, defaulting to the current one. It is
  -- checked against the form inside app.forms_staff_submit.
  return app.forms_staff_submit(v_submission, v_form.id,
                                coalesce(v_revision, v_form.current_revision_id),
                                v_answers, p_actor);
end
$$;

-- ReadOnly is deliberately absent. Every other role is here because the form's
-- own configuration decides, not this list - but an account whose whole purpose
-- is that it writes nothing must not be able to write a submission, whatever
-- app.form_access_roles says.
insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('FORM_COMPLETE',
   array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'forms',
   'Submit a Roles-mode form. Authorised by app.form_completion_route (kind direct), so a Workflow-owned form is refused here and stays with its programme.');
