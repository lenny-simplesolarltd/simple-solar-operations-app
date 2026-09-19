-- =============================================================================
-- P0 / R1 integration: reconciles the three P0 streams merged together
-- (20260919183000 Evidence, 20260919202000/202100 audit + health,
-- 20260919210000 R1 completion). Nothing here changes a release mode.
--
--   1. Staff wording for refusals. public.describe_command_error runs as the
--      caller and reads app.result_error_catalogue(); every catalogue link
--      created since 20260919167000 (R2-R4, Evidence, R1 completion) was left
--      without an execute grant, so for signed-in staff the call failed and
--      every refusal fell back to "Something went wrong". Each link of the
--      rename chain is granted to the roles that call it.
--   2. COMMISSIONING_RECORD on the hardened Evidence model (Evidence stream x
--      R1 completion stream):
--        * "evidence_created" comes from app.evidence_attach (first use of the
--          registered upload), not from "no row existed" - under registered
--          uploads a row always exists before the command runs, so the old
--          test always answered false;
--        * the reference keeps ONE office submission per work package
--          (CS-R1A-<wp>, updated in place), so a re-record may quote the file
--          already on that record. Here each re-record is a new row that
--          supersedes the last, so "that record" is the work package's chain
--          of office submissions: a file linked to an earlier office
--          submission of the SAME work package is accepted (the link is never
--          re-pointed) and JOB_OPERATIONS shows the chain's files on the
--          current record. Deviation: a file linked to any OTHER submission
--          (another work package, an installer form) is refused
--          (R1A_EVIDENCE_ALREADY_LINKED) - the reference silently skipped the
--          link, leaving an Accepted record with no evidence of its own.
--   3. One audit trail per change (audit stream x R1 completion stream):
--      commissioning_templates is row-audited again (20260919202000), so the
--      R1 office template helper no longer writes its own app.audit events on
--      top of the trigger's; the reason is carried by app.reason instead.
--   4. SYSTEM_STATUS for Director. Director may record backup / restore
--      evidence (OPS_EVIDENCE_RECORD, 20260919202100) but could not open the
--      System Health page where that is done. The reference names Director
--      (Ben) as System Status audience ("Tanya/Ben/Admin: view/escalate",
--      docs/R1-go-live-readiness.md:188) and backup reviewer (s18 MAN-06,
--      R1-015/016). Only the read is granted; every System Health action other
--      than recording evidence stays Admin / Manager / Office.
--   5. JOB_OPERATIONS carries the cancellation work a person must do
--      (open cancellation tasks, the reopen review) with availability flags,
--      so the R1 screens can drive CANCELLATION_RESOLVE / CANCELLATION_CLOSE /
--      REOPEN_REVIEW_COMPLETE (20260919147000). Read only; the commands
--      re-check everything.
--   6. TASK_EVIDENCE_ATTACH wrote the storage path into its audit reason
--      (20260919144000); the reason now names the evidence id instead.
--      Rows already written by that command keep their text (the audit log is
--      append-only) - see the integration report.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catalogue grants
-- -----------------------------------------------------------------------------

grant execute on function app.result_error_catalogue_r1(), app.result_error_catalogue_pre_evidence(),
  app.result_error_catalogue_pre_ops(), app.result_error_catalogue_pre_r1_completion()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. COMMISSIONING_RECORD (replaces 20260919210000's; unchanged otherwise)
-- -----------------------------------------------------------------------------

create or replace function app.cmd_commissioning_record(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_job public.jobs;
  v_wp public.work_packages;
  v_template public.commissioning_templates;
  v_prior public.commissioning_submissions;
  v_sub public.commissioning_submissions;
  v_path text;
  v_evidence_ref text;
  v_evidence uuid;
  v_linked uuid;
  v_created boolean := false;
  v_reference text;
  v_notes text;
  v_review_notes text;
begin
  if p_request ?| array['task_id', 'issue_id', 'old_allocation_id'] then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_p := app.payload(p_request, array['evidence_path', 'evidence_id', 'reference', 'notes']);
  v_path := app.txt(v_p, 'evidence_path');
  v_evidence_ref := app.txt(v_p, 'evidence_id');
  v_reference := app.txt(v_p, 'reference');
  v_notes := app.txt(v_p, 'notes');
  if v_path is null and v_evidence_ref is null then
    perform app.fail('R1A_REQUIRED_EVIDENCE');
  end if;

  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  select * into v_wp from public.work_packages where id = app.ref(p_request, 'work_package_id') for update;
  if v_wp.id is null or v_wp.job_id <> v_job.id then
    perform app.fail('R1A_WORK_PACKAGE_JOB_MISMATCH');
  end if;
  if not v_wp.commissioning_required then
    perform app.fail('R1A_COMMISSIONING_NOT_REQUIRED');
  end if;
  if v_wp.status = 'Cancelled' then
    perform app.fail('R1A_WORK_PACKAGE_NOT_ACTIONABLE');
  end if;
  if v_wp.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;

  -- Evidence: a registered upload of this job (confirmed durable inside this
  -- transaction), or an existing same-job row whose file has arrived.
  if v_path is not null then
    select a.evidence_id, a.newly_attached into v_evidence, v_created
    from app.evidence_attach(v_job.id, 'Commissioning', v_path) a;
  else
    v_evidence := app.job_evidence(v_job.id, v_evidence_ref, 'R1A_EVIDENCE_NOT_FOUND');
  end if;
  select e.submission_id into v_linked from public.evidence e where e.id = v_evidence for update;
  if v_linked is not null and not exists (
       select 1 from public.commissioning_submissions s
       where s.id = v_linked and s.work_package_id = v_wp.id and s.source_system = 'R1A-office-manual') then
    perform app.fail('R1A_EVIDENCE_ALREADY_LINKED');
  end if;

  -- An accepted installer (R3) submission is the technical record; the office
  -- does not overwrite it.
  if exists (select 1 from public.commissioning_submissions s
             where s.work_package_id = v_wp.id and s.status = 'Accepted' and s.source_system <> 'R1A-office-manual') then
    perform app.fail('R1A_COMMISSIONING_ALREADY_ACCEPTED');
  end if;

  v_template := app.s12_ensure_r1_office_template(v_wp.trade);
  v_review_notes := coalesce(nullif(concat_ws(' - ', 'Reference: ' || v_reference, v_notes), ''),
                             'Office-recorded commissioning evidence');

  select * into v_prior from public.commissioning_submissions s
  where s.work_package_id = v_wp.id and s.source_system = 'R1A-office-manual'
    and not exists (select 1 from public.commissioning_submissions x where x.supersedes_submission_id = s.id)
  order by s.created_at desc, s.id desc
  limit 1;

  -- Deviation: a re-record supersedes the previous office row (S12 immutability).
  insert into public.commissioning_submissions (job_id, work_package_id, allocation_id, installer_id, template_version,
                                                status, submitted_at, reviewed_at, reviewed_by, review_notes,
                                                supersedes_submission_id, source_system, office_reference)
  values (v_job.id, v_wp.id, null, null, v_template.template_version, 'Accepted', now(), now(), app.actor_id(p_actor),
          v_review_notes, v_prior.id, 'R1A-office-manual', v_reference)
  returning * into v_sub;

  -- The evidence is linked to the submission once; never re-pointed.
  update public.evidence set submission_id = v_sub.id where id = v_evidence and submission_id is null;

  perform app.audit('CommissioningSubmissions', v_sub.id::text, 'OfficeCommissioningRecorded',
                    case when v_prior.id is not null then to_jsonb(v_prior) end,
                    to_jsonb(v_sub) || jsonb_build_object('evidence_id', v_evidence), v_review_notes);

  return jsonb_build_object('status', 'Recorded', 'submission_id', v_sub.id, 'evidence_id', v_evidence,
                            'evidence_created', v_created, 'template_version', v_sub.template_version,
                            'supersedes_submission_id', v_prior.id, 'work_package_id', v_wp.id,
                            'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- 3. R1 office template: the row trigger is the audit record
-- -----------------------------------------------------------------------------

create or replace function app.s12_ensure_r1_office_template(p_trade text)
returns public.commissioning_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.commissioning_templates;
  v_reason text := current_setting('app.reason', true);
begin
  select * into v_row from public.commissioning_templates t
  where t.trade = p_trade and t.equipment_type = 'OfficeRecordedEvidence' and t.template_version = 'R1-OFFICE-MANUAL-1.0'
  for update;
  if v_row.id is null then
    perform set_config('app.reason', 'R1 office commissioning template for ' || p_trade, true);
    insert into public.commissioning_templates (trade, equipment_type, template_version, effective_from, active)
    values (p_trade, 'OfficeRecordedEvidence', 'R1-OFFICE-MANUAL-1.0', app.london_date(now()), true)
    on conflict (trade, equipment_type, template_version) do nothing
    returning * into v_row;
    perform set_config('app.reason', coalesce(v_reason, ''), true);
    if v_row.id is null then
      select * into v_row from public.commissioning_templates t
      where t.trade = p_trade and t.equipment_type = 'OfficeRecordedEvidence' and t.template_version = 'R1-OFFICE-MANUAL-1.0';
    end if;
  end if;
  if v_row.approved_by is not null or v_row.approved_at is not null or not v_row.active then
    perform set_config('app.reason', 'R1 office template is never an approved technical form', true);
    update public.commissioning_templates set approved_by = null, approved_at = null, active = true
    where id = v_row.id returning * into v_row;
    perform set_config('app.reason', coalesce(v_reason, ''), true);
  end if;
  return v_row;
end
$$;

-- -----------------------------------------------------------------------------
-- 4. SYSTEM_STATUS: Director may read (public.execute_read from 20260919149000,
--    unchanged except the SYSTEM_STATUS role check)
-- -----------------------------------------------------------------------------

create or replace function public.execute_read(p_request jsonb)
returns jsonb
language plpgsql
stable security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_type text;
  v_actor jsonb;
  v_email text;
  v_person public.people;
  v_roles text[];
  v_as_of date;
  v_query text;
  v_job public.jobs;
  v_task public.tasks;
  v_out jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('read_type', 'job_id', 'task_id', 'queue', 'as_of', 'query') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
    if jsonb_typeof(p_request -> v_key) not in ('string', 'null') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;
  v_type := p_request ->> 'read_type';

  -- WHO_AM_I replaces IDENTITY_PROBE: who the signed-in user resolves to,
  -- without failing for an unknown user (the probe's purpose).
  if v_type = 'WHO_AM_I' then
    if (select count(*) from jsonb_object_keys(p_request)) <> 1 then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
    -- Identity foundation: auth.uid() -> people.auth_user_id (active) -> active roles.
    v_email := app.auth_email();
    select * into v_person from public.people p where p.id = app.current_person_id();
    v_roles := coalesce(app.current_roles(), '{}');
    v_actor := jsonb_build_object('id', v_person.id, 'roles', to_jsonb(v_roles));
    return jsonb_build_object('ok', true, 'read_type', v_type, 'actor_id', v_person.id, 'data', jsonb_build_object(
      'email', coalesce(v_person.email, v_email),
      'active_user_maps_to_active_people', v_person.id is not null,
      'person', case when v_person.id is null then null else jsonb_build_object(
        'id', v_person.id, 'email', v_person.email, 'display_name', v_person.display_name) end,
      'roles', to_jsonb(v_roles),
      'authenticated', v_person.id is not null and cardinality(v_roles) > 0,
      'classes', jsonb_build_object('admin', app.is_admin(v_actor), 'director', app.is_director(v_actor),
                                    'office', app.is_office(v_actor), 'office_manager', app.is_office_manager(v_actor))));
  end if;

  if v_type is null or v_type not in ('OFFICE_HOME', 'JOB_SEARCH', 'JOB_OVERVIEW', 'OPERATIONAL_QUEUE',
                                      'RELEASE_MODE_STATUS', 'SYSTEM_STATUS', 'AUDIT_HISTORY', 'ACTION_AVAILABILITY',
                                      'TASK_ACTION_AVAILABILITY', 'MY_TASKS', 'TEAM_TASKS', 'PLANNER_3_WEEKS',
                                      'PLANNER_6_WEEKS', 'INTAKE_REVIEW') then
    -- INSTALLER_WORKFLOW / GOODS_IN_DETAIL / STOCK_BALANCE belong to the
    -- R2/R3 operations contract, not this boundary.
    if v_type in ('INSTALLER_WORKFLOW', 'GOODS_IN_DETAIL', 'STOCK_BALANCE') then
      perform app.fail('R1A_READ_UNSUPPORTED');
    end if;
    perform app.fail('R1A_UNKNOWN_READ');
  end if;

  v_actor := app.resolve_actor();
  if not app.is_office(v_actor) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  v_query := p_request ->> 'query';

  if v_type in ('OFFICE_HOME', 'MY_TASKS', 'TEAM_TASKS') then
    v_as_of := coalesce(app.read_date(p_request ->> 'as_of', 'S17_DATE_INVALID'), app.london_date(now()));
    if v_type = 'OFFICE_HOME' then
      v_out := app.read_office_home(v_actor, v_as_of);
    elsif v_type = 'MY_TASKS' then
      v_out := app.read_task_list(v_actor, v_as_of, false, v_query);
    else
      if not app.is_office_manager(v_actor) then
        perform app.fail('R1A_ROLE_DENIED');
      end if;
      v_out := app.read_task_list(v_actor, v_as_of, true, v_query);
    end if;

  elsif v_type = 'JOB_SEARCH' then
    if nullif(btrim(coalesce(v_query, '')), '') is null then
      perform app.fail('R1A_QUERY_REQUIRED');
    end if;
    v_out := app.read_job_search(v_actor, v_query);

  elsif v_type in ('JOB_OVERVIEW', 'AUDIT_HISTORY', 'ACTION_AVAILABILITY') then
    v_job := app.read_authorize_job(v_actor, p_request ->> 'job_id');
    v_out := case v_type
      when 'JOB_OVERVIEW' then app.read_job_overview(v_job)
      when 'AUDIT_HISTORY' then app.read_audit_history(v_job)
      else app.read_action_availability(v_actor, v_job) end;

  elsif v_type = 'OPERATIONAL_QUEUE' then
    v_out := app.read_operational_queue(v_actor, nullif(btrim(coalesce(p_request ->> 'queue', '')), ''), v_query);

  elsif v_type = 'RELEASE_MODE_STATUS' then
    if not app.is_admin(v_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    v_out := app.read_release_modes();

  elsif v_type = 'SYSTEM_STATUS' then
    -- P0 integration: Director reads System Health (see the header).
    if not app.is_admin(v_actor) and not app.has_role(v_actor, 'Office') and not app.has_role(v_actor, 'Director') then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    v_out := app.read_system_status();

  elsif v_type = 'TASK_ACTION_AVAILABILITY' then
    if coalesce(p_request ->> 'task_id', '') ~* '^\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$' then
      select * into v_task from public.tasks where id = btrim(p_request ->> 'task_id')::uuid;
    end if;
    if v_task.id is null then
      perform app.fail('R1A_TASK_NOT_FOUND');
    end if;
    if v_task.job_id is not null then
      perform app.read_authorize_job(v_actor, v_task.job_id::text);
    elsif v_task.owner_id <> app.actor_id(v_actor) and not app.is_admin(v_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    v_out := app.read_task_action_availability(v_actor, v_task);

  elsif v_type in ('PLANNER_3_WEEKS', 'PLANNER_6_WEEKS') then
    v_out := app.read_planner(coalesce(app.read_date(p_request ->> 'as_of', 'S11_DATE_INVALID'), app.london_date(now())),
                              case when v_type = 'PLANNER_3_WEEKS' then 3 else 6 end);

  else -- INTAKE_REVIEW
    if not app.is_office_manager(v_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    v_out := app.read_intake_review();
  end if;

  return jsonb_build_object('ok', true, 'read_type', v_type, 'actor_id', app.actor_id(v_actor), 'data', v_out);
end
$function$;

-- -----------------------------------------------------------------------------
-- 5. JOB_OPERATIONS + cancellation work
-- -----------------------------------------------------------------------------

alter function app.read_job_operations(jsonb, jsonb) rename to read_job_operations_pre_integration;

-- Same read as 20260919210000's (which still authorizes the job), with the
-- current office commissioning record showing every file of the work
-- package's office chain (the reference's single CS-R1A-<wp> row), plus
-- 'cancellation': the open S15 tasks, the reopen review, and whether
-- CANCELLATION_RESOLVE / CANCELLATION_CLOSE / REOPEN_REVIEW_COMPLETE can run.
-- The checks follow the commands: office-manager actor (app.s15_scope), job
-- assignment (app.authorize_job), FN-01 Automated + FN-17 / FN-20 Manual, then
-- the stage. A confirmation task (merchant / scaffold / strip / calendar)
-- carries the revision it must be confirmed against.
create function app.read_job_operations(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_out jsonb := app.read_job_operations_pre_integration(p_request, p_actor);
  v_job public.jobs;
  v_role boolean := app.is_office_manager(p_actor);
  v_access boolean;
  v_modes boolean := app.mode_available('FN-01', 'Automated') and app.mode_available('FN-17', 'Manual')
                     and app.mode_available('FN-20', 'Manual');
  v_tasks jsonb;
  v_review jsonb;
  v_confirm_open boolean;
begin
  select * into v_job from public.jobs where id = (v_out #>> '{job,id}')::uuid;

  select coalesce(jsonb_agg(p.pkg || jsonb_build_object('commissioning', (p.pkg -> 'commissioning') || jsonb_build_object(
           'current', (select coalesce(jsonb_agg(
                         case when c.sub ->> 'source_system' = 'R1A-office-manual'
                              then c.sub || jsonb_build_object('evidence', (
                                     select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'filename', e.filename)
                                                               order by e.created_at, e.id), '[]'::jsonb)
                                     from public.evidence e
                                     join public.commissioning_submissions s on s.id = e.submission_id
                                     where s.work_package_id = (p.pkg ->> 'id')::uuid
                                       and s.source_system = 'R1A-office-manual'))
                              else c.sub end order by c.n), '[]'::jsonb)
                       from jsonb_array_elements(p.pkg #> '{commissioning,current}') with ordinality c (sub, n))))
         order by p.n), '[]'::jsonb)
  into v_tasks
  from jsonb_array_elements(v_out -> 'packages') with ordinality p (pkg, n);
  v_out := v_out || jsonb_build_object('packages', v_tasks);
  v_access := app.job_in_scope(v_job) and app.is_assigned(p_actor, v_job.id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'template_code', t.template_code, 'title', t.title, 'status', t.status, 'version', t.version,
      'blocking_reason', t.blocking_reason, 'owner_name', app.s17_person_name(t.owner_id),
      'confirmation', t.template_code in ('S15-CAN-MERCHANT', 'S15-CAN-SCAFFOLD', 'S15-CAN-STRIP', 'S15-CAN-CALENDAR'),
      'needs_actual_date', t.template_code = 'S15-CAN-STRIP',
      'confirm_revision', case t.template_code
          when 'S15-CAN-MERCHANT' then (select o.revision from public.orders o where o.id = t.related_entity_id)
          when 'S15-CAN-CALENDAR' then (select l.entity_revision from public.calendar_links l where l.id = t.related_entity_id)
          when 'S15-CAN-SCAFFOLD' then (select b.revision from public.scaffold_bookings b where b.id = t.related_entity_id)
          when 'S15-CAN-STRIP' then (select b.revision from public.scaffold_bookings b where b.id = t.related_entity_id)
        end,
      -- GHL resolution needs configured GHL IDs (S15_NOT_CONFIGURED otherwise):
      -- such a task is tracked when the cancellation is closed instead.
      'resolvable', t.template_code <> 'S15-CAN-GHL' or exists (
          select 1 from public.ghl_tasks g where g.task_id = t.id
            and 'NOT_CONFIGURED' <> all (array[g.opportunity_id, g.target_pipeline_id, g.target_stage_id])
            and g.opportunity_id is not null and g.target_pipeline_id is not null and g.target_stage_id is not null))
      order by t.created_at, t.id), '[]'::jsonb)
  into v_tasks
  from public.tasks t
  where t.job_id = v_job.id and t.task_group = 'Cancellation' and t.template_code <> 'S15-REOPEN-REVIEW'
    and t.status in ('Open', 'Blocked', 'Waiting', 'InProgress');

  v_confirm_open := exists (select 1 from jsonb_array_elements(v_tasks) x where (x ->> 'confirmation')::boolean);

  select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'version', t.version)
  into v_review
  from public.tasks t
  where t.job_id = v_job.id and t.template_code = 'S15-REOPEN-REVIEW' and t.status not in ('Complete', 'NotRequired', 'Cancelled')
  order by t.created_at desc, t.id
  limit 1;

  return v_out || jsonb_build_object('cancellation', jsonb_build_object(
    'tasks', v_tasks,
    'reopen_review', v_review,
    'actions', jsonb_build_object(
      'resolve', app.r1x_flag(v_role, v_access, v_modes,
        v_job.workflow_stage in ('CancellationInProgress', 'Cancelled') and jsonb_array_length(v_tasks) > 0,
        case when v_job.workflow_stage not in ('CancellationInProgress', 'Cancelled') then 'CANCELLATION_NOT_ACTIVE'
             else 'NO_OPEN_CANCELLATION_TASKS' end),
      'close', app.r1x_flag(v_role, v_access, v_modes,
        v_job.workflow_stage = 'CancellationInProgress' and not v_confirm_open,
        case when v_job.workflow_stage <> 'CancellationInProgress' then 'CANCELLATION_NOT_IN_PROGRESS'
             else 'CONFIRMATION_OUTSTANDING' end),
      'reopen_review_complete', app.r1x_flag(v_role, v_access, v_modes,
        v_review is not null and v_job.cancellation_at is null
          and v_job.workflow_stage not in ('CancellationInProgress', 'Cancelled'),
        case when v_review is null then 'NO_REOPEN_REVIEW' else 'CANCELLATION_ACTIVE' end))));
end
$$;

-- -----------------------------------------------------------------------------
-- Staff wording for the new refusal (append-only extension of the catalogue)
-- -----------------------------------------------------------------------------

alter function app.result_error_catalogue() rename to result_error_catalogue_pre_integration;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_integration() || '{
  "R1A_EVIDENCE_ALREADY_LINKED": ["ActionRequired", "That file is already the evidence for a different commissioning record. Upload the certificate for this work again."]
}'::jsonb
$$;

grant execute on function app.result_error_catalogue(), app.result_error_catalogue_pre_integration()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. TASK_EVIDENCE_ATTACH audit reason (20260919144000, unchanged otherwise):
--    it recorded the raw storage path as the audit reason. Evidence audit is
--    metadata only (20260919183000), so the reason now names the evidence id.
-- -----------------------------------------------------------------------------

create or replace function app.cmd_task_evidence_attach(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_p jsonb := app.payload(p_request, array['evidence_path'], array['evidence_path']);
  v_task public.tasks;
  v_after public.tasks;
  v_mode text;
  v_evidence uuid;
  v_readiness jsonb;
begin
  select * into v_task from public.tasks where id = app.ref(p_request, 'task_id') for update;
  if v_task.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  v_mode := case
    when v_task.template_code <> 'PRE02' then null
    when v_task.status = 'Complete' then case when v_task.evidence_id is null then 'Repair' else 'AlreadyAttached' end
    when v_task.status in ('Open', 'Waiting', 'InProgress') and not v_task.revision_required then 'Pending'
  end;
  if v_mode is null then
    perform app.fail('R1A_TASK_NOT_ATTACHABLE');
  end if;
  if v_mode = 'AlreadyAttached' then
    perform app.fail('R1A_EVIDENCE_ALREADY_ATTACHED');
  end if;
  if v_task.job_id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;

  v_evidence := app.ensure_evidence(v_task.job_id, 'Contract', app.txt(v_p, 'evidence_path'));
  update public.tasks set evidence_id = v_evidence where id = v_task.id returning * into v_after;
  perform app.task_event(v_task, v_after, 'EvidenceAttach',
    case when v_mode = 'Pending' then 'TASK_EVIDENCE_ATTACH:PendingCompletion' else 'TASK_EVIDENCE_ATTACH' end);
  if v_mode = 'Repair' then
    perform app.apply_pre02_contract(v_task.job_id, v_evidence, null);
    v_readiness := app.reevaluate_prebooking(v_task.job_id);
  end if;
  -- P0 integration: the reason names the evidence row, never its storage path.
  perform app.audit('Tasks', v_task.id::text, 'EvidenceAttach', to_jsonb(v_task), to_jsonb(v_after),
                    'evidence ' || v_evidence);
  return jsonb_build_object(
    'status', case when v_mode = 'Pending' then 'EvidenceUploaded' else 'Attached' end,
    'completion_required', v_mode = 'Pending',
    'task', (select to_jsonb(t) from public.tasks t where t.id = v_task.id),
    'job', (select to_jsonb(j) from public.jobs j where j.id = v_task.job_id),
    'evidence_id', v_evidence, 'readiness', v_readiness -> 'readiness', 'external_calls', 0);
end
$function$;
