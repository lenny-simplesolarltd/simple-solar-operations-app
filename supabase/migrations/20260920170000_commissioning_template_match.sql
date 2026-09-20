-- =============================================================================
-- Fix: the installer's commissioning form showed no questions, and the office
-- could never accept the form, whenever the draft had been created for the
-- installer automatically.
--
-- What happened. IW_REPORT_COMPLETION opens the commissioning draft as soon as
-- the installer reports the work finished, and stamps it
-- template_version = 'NOT_CONFIGURED' (20260919165000, cmd_iw_report_completion)
-- because at that moment nobody has chosen a version.
-- app.iw_approved_template already treats 'NOT_CONFIGURED' as "any approved
-- template for this trade", so the DRAFT and SUBMIT commands resolve it
-- correctly. The INSTALLER_WORKFLOW read did not: it required
-- t.template_version = v_sub.template_version exactly, which 'NOT_CONFIGURED'
-- never matches.
--
-- The effect, with an approved template in place: the installer's form said
-- "No approved commissioning template for <trade> yet", offered no questions
-- and allowed photos only; the submission therefore stayed on
-- 'NOT_CONFIGURED'; and Commissioning review disabled Accept, because a form
-- without an approved template cannot be accepted. R3 commissioning could not
-- be completed at all through the installer app.
--
-- The fix makes the read use the same rule the commands use. Nothing else in
-- the function changes, and no historical migration is edited.
-- =============================================================================

create or replace function app.read_installer_workflow(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_wp public.work_packages;
  v_job public.jobs;
  v_sub public.commissioning_submissions;
  v_current int;
begin
  perform app.iw_keys(p_request, array['read_type', 'work_package_id', 'payload']);
  perform app.iw_keys(coalesce(p_request -> 'payload', '{}'::jsonb), '{}');
  v_wp := app.iw_package(p_request, p_actor, '{}'::jsonb, false);
  select * into v_job from public.jobs where id = v_wp.job_id;
  select count(*) into v_current from public.commissioning_submissions s
  where s.work_package_id = v_wp.id
    and not exists (select 1 from public.commissioning_submissions x where x.supersedes_submission_id = s.id);
  if v_current = 1 then
    select * into v_sub from public.commissioning_submissions s
    where s.work_package_id = v_wp.id
      and not exists (select 1 from public.commissioning_submissions x where x.supersedes_submission_id = s.id);
  end if;
  return jsonb_build_object(
    'job_id', v_job.id, 'job_label', v_job.display_name, 'work_package_id', v_wp.id, 'trade', v_wp.trade,
    'status', v_wp.status, 'expected_version', v_wp.version, 'commissioning_required', v_wp.commissioning_required,
    'submission', case when v_sub.id is null then null else jsonb_build_object(
      'id', v_sub.id, 'status', v_sub.status, 'expected_version', v_sub.version,
      'template_version', v_sub.template_version, 'review_notes', v_sub.review_notes) end,
    'answers', coalesce((select jsonb_agg(to_jsonb(a) order by a.question_key) from public.commissioning_answers a
                         where a.submission_id = v_sub.id), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(to_jsonb(q) order by q.display_order, q.question_key)
                           from public.commissioning_questions q join public.commissioning_templates t on t.id = q.template_id
                           where t.trade = v_wp.trade and t.active and t.approved_by is not null and t.approved_at is not null
                             -- Same rule as app.iw_approved_template: a submission
                             -- that has not settled on a version yet takes the
                             -- trade's approved template.
                             and (v_sub.id is null
                                  or v_sub.template_version is null
                                  or v_sub.template_version = 'NOT_CONFIGURED'
                                  or t.template_version = v_sub.template_version)), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'filename', e.filename,
                                                              'storage_path', e.storage_path, 'category', e.category)
                                           order by e.created_at, e.id)
                          from public.evidence e where e.submission_id = v_sub.id), '[]'::jsonb));
end
$$;
