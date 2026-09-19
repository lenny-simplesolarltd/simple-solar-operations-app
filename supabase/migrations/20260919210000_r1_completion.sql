-- =============================================================================
-- R1 completion gaps after booking (reference commit f25002a).
--
--   1. COMMISSIONING_RECORD - office-recorded commissioning evidence
--      (r1-appsheet/services.js:1635-1710 _r1sCommissioningRecord,
--      s12/commissioning.js:155-187 ensureR1OfficeCommissioningTemplate).
--      Without it an R1 job with an Electrical work package can never pass
--      the S10 operational-completion gate: booking intake marks Electrical
--      packages commissioning_required (145000), the gate needs an Accepted
--      submission per such package (146000
--      app.s10_evaluate_operational_completion), and the only other route to
--      Accepted is the R3 COMMISSIONING_REVIEW (FN-06/FN-07, approved
--      template), which R1 does not have.
--   2. Job-level CALL_RECORD - a call logged against the job with no task
--      (services.js:614-623, s10/operations.js:81-102; test
--      r1-appsheet.test.cjs:4403). The port required a task: calls.task_id
--      was NOT NULL and app.authorize_command_r1 refused a missing task.
--   3. JOB_OPERATIONS read - what the R1 job screens need to operate calls,
--      issues, commissioning, completion, installer changes and cancellation,
--      with availability that separates role, access, release-mode and state
--      refusals. Read only; every command re-checks everything.
--   4. Staff-facing wording for the new refusal codes.
--
-- Nothing here changes a release mode: every function stays as seeded
-- (Disabled until an administrator enables R1).
--
-- Deviations (each also marked "-- Deviation:" where it applies):
--   * Re-recording office commissioning inserts a new Accepted row that
--     supersedes the previous office row; the reference updated its single
--     CS-R1A-<wp> row in place. S12 makes Accepted submissions immutable
--     (app.s12_guard_submission, 165000), and the superseded row keeps the
--     history. The gate reads "any Accepted", so the outcome is the same.
--   * Office rows carry source_system = 'R1A-office-manual' and a nullable
--     allocation / installer (the reference wrote null deliberately). A check
--     constraint allows the nulls only on office rows, and office rows only
--     as Accepted, so R3 installer submissions keep their NOT NULL meaning.
--   * The certificate / document reference is stored in its own column
--     (office_reference) as well as in review_notes ("Reference: X - notes"
--     as the reference wrote it).
--   * A job-level call cannot carry actual_completion_confirmed or
--     customer_happy: those only act through an INS01 / INS04 call task, and
--     the reference silently stored them on a job-level call with no effect,
--     which reads as if the work or the customer had been confirmed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------

alter table public.commissioning_submissions
  alter column allocation_id drop not null,
  alter column installer_id drop not null,
  add column source_system text not null default 'InstallerApp',
  add column office_reference text;

alter table public.commissioning_submissions
  add constraint commissioning_submissions_source_check
    check (source_system in ('InstallerApp', 'R1A-office-manual')),
  add constraint commissioning_submissions_shape_check
    check (case when source_system = 'R1A-office-manual'
                then allocation_id is null and installer_id is null and status = 'Accepted'
                else allocation_id is not null and installer_id is not null end);

comment on column public.commissioning_submissions.source_system is
  'InstallerApp: R3 installer form (allocation and installer required). R1A-office-manual: office-recorded evidence of the current commissioning process (COMMISSIONING_RECORD), always Accepted, no allocation/installer.';
comment on column public.commissioning_submissions.office_reference is
  'Certificate / document reference given with an office-recorded submission.';

-- A null task_id is a job-level call (reference: blank or omitted task_id).
alter table public.calls alter column task_id drop not null;
comment on column public.calls.task_id is
  'The INS01/INS04 call task this call completes or follows up; null for a job-level call.';

-- -----------------------------------------------------------------------------
-- R1 office commissioning template (s12 ensureR1OfficeCommissioningTemplate)
-- -----------------------------------------------------------------------------

-- One active, never-approved template per trade. It cannot satisfy the R3
-- approved-template rule (app.iw_approved_template / COMMISSIONING_REVIEW),
-- so R1 evidence is never mistaken for an approved technical review.
-- Approval that has drifted onto it is cleared.
create function app.s12_ensure_r1_office_template(p_trade text)
returns public.commissioning_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.commissioning_templates;
  v_after public.commissioning_templates;
begin
  select * into v_row from public.commissioning_templates t
  where t.trade = p_trade and t.equipment_type = 'OfficeRecordedEvidence' and t.template_version = 'R1-OFFICE-MANUAL-1.0'
  for update;
  if v_row.id is null then
    insert into public.commissioning_templates (trade, equipment_type, template_version, effective_from, active)
    values (p_trade, 'OfficeRecordedEvidence', 'R1-OFFICE-MANUAL-1.0', app.london_date(now()), true)
    on conflict (trade, equipment_type, template_version) do nothing
    returning * into v_row;
    if v_row.id is null then
      select * into v_row from public.commissioning_templates t
      where t.trade = p_trade and t.equipment_type = 'OfficeRecordedEvidence' and t.template_version = 'R1-OFFICE-MANUAL-1.0';
    else
      perform app.audit('CommissioningTemplates', v_row.id::text, 'OfficeTemplateCreated', null, to_jsonb(v_row), p_trade);
    end if;
  end if;
  if v_row.approved_by is not null or v_row.approved_at is not null or not v_row.active then
    update public.commissioning_templates set approved_by = null, approved_at = null, active = true
    where id = v_row.id returning * into v_after;
    perform app.audit('CommissioningTemplates', v_row.id::text, 'OfficeTemplateApprovalCleared', to_jsonb(v_row),
                      to_jsonb(v_after), 'R1 office template is never an approved technical form');
    v_row := v_after;
  end if;
  return v_row;
end
$$;

-- -----------------------------------------------------------------------------
-- COMMISSIONING_RECORD
-- -----------------------------------------------------------------------------
--
-- Request: {command_id, command_type, job_id, work_package_id,
--           expected_version (the work package's), payload:
--           {evidence_path | evidence_id, reference?, notes?}}
-- Authorization (app.command_registry): Admin / Manager / Office
-- (reference _r1aOffice + _r1aOfficeManager), assigned to the job
-- (app.authorize_job), FN-01 Automated. Evidence is mandatory. Changes no
-- task, no job field and no work package version (reference).

create function app.cmd_commissioning_record(p_request jsonb, p_actor jsonb)
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

  -- Evidence: a stored upload for this job, or an existing same-job row
  -- (Evidence storage interface: app.ensure_evidence / app.job_evidence).
  if v_path is not null then
    v_created := not exists (select 1 from public.evidence e where e.job_id = v_job.id and e.storage_path = v_path);
    v_evidence := app.ensure_evidence(v_job.id, 'Commissioning', v_path);
  else
    v_evidence := app.job_evidence(v_job.id, v_evidence_ref, 'R1A_EVIDENCE_NOT_FOUND');
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

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('COMMISSIONING_RECORD', array['Admin', 'Manager', 'Office'], true,
   '[{"function_id": "FN-01", "mode": "Automated"}]', 'r1-s12-office',
   'Office-recorded commissioning evidence (reference services.js:1635). Work package expected_version; evidence required.');

-- -----------------------------------------------------------------------------
-- CALL_RECORD: job-level calls
-- -----------------------------------------------------------------------------

-- The R1 matrix exactly as 20260919141000 wrote it (renamed by 160000), with
-- one change: a CALL_RECORD with no task_id is a job-level call, so only a
-- given task is checked for job linkage and ownership (adapter.js:206).
create or replace function app.authorize_command_r1(p_type text, p_request jsonb, p_actor jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_task_id uuid;
  v_job_id uuid := app.ref(p_request, 'job_id');
begin
  if not app.is_office(p_actor) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;

  if p_type in ('TASK_COMPLETE', 'TASK_REOPEN', 'TASK_EVIDENCE_ATTACH') then
    v_task_id := app.ref(p_request, 'task_id');
    select * into v_task from public.tasks where id = v_task_id for update;
    if not found then
      perform app.fail('R1A_TASK_NOT_FOUND');
    end if;
    if v_task.job_id is not null then
      perform app.authorize_job(p_actor, v_task.job_id);
    elsif v_task.owner_id <> app.actor_id(p_actor) and not app.is_admin(p_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    if app.actor_id(p_actor) not in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))
       and not app.is_admin(p_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    perform app.require_mode('FN-01', 'Automated');

  elsif p_type = 'OUTBOX_RESOLVE' then
    if not app.is_office_manager(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.require_mode('FN-14', 'Automated');

  elsif p_type = 'DEPOSIT_CONFIRM' then
    if not app.is_director(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-15', 'Manual');

  elsif p_type = 'OPERATIONAL_COMPLETE' then
    if not app.is_office_manager(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-19', 'Manual');
    perform app.require_mode('FN-11', 'Manual');

  elsif p_type = 'CONFIRM_BOOKING' then
    if not app.is_office_manager(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-01', 'Automated');

  else
    perform app.authorize_job(p_actor, v_job_id);
    perform app.require_mode('FN-01', 'Automated');
    if p_type = 'CALL_RECORD' then
      v_task_id := app.ref(p_request, 'task_id');
      -- Blank or omitted task_id: a job-level call (services.js:615-616).
      if v_task_id is not null then
        select * into v_task from public.tasks where id = v_task_id;
        if not found or v_task.job_id is distinct from v_job_id then
          perform app.fail('R1A_TASK_JOB_MISMATCH');
        end if;
        if app.actor_id(p_actor) not in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))
           and not app.is_admin(p_actor) then
          perform app.fail('R1A_TASK_ACCESS_DENIED');
        end if;
      end if;
    elsif p_type = 'ISSUE_UPDATE' then
      if not exists (select 1 from public.issues i where i.id = app.ref(p_request, 'issue_id') and i.job_id = v_job_id) then
        perform app.fail('R1A_ISSUE_JOB_MISMATCH');
      end if;
    elsif p_type in ('PLANNER_UPDATE', 'CHANGE_INSTALLER') then
      if not exists (select 1 from public.work_packages w
                     where w.id = app.ref(p_request, 'work_package_id') and w.job_id = v_job_id) then
        perform app.fail('R1A_WORK_PACKAGE_JOB_MISMATCH');
      end if;
    elsif p_type in ('CANCEL_JOB', 'REINSTATE_JOB', 'CANCELLATION_RESOLVE', 'CANCELLATION_CLOSE', 'REOPEN_REVIEW_COMPLETE') then
      perform app.require_mode('FN-17', 'Manual');
      perform app.require_mode('FN-20', 'Manual');
    end if;
  end if;
end
$$;

-- The task path is unchanged from 20260919146000. A job-level call
-- (no task_id) checks expected_version against the job, writes the call and
-- its audit, and changes nothing else (s10/operations.js:83-85: no task,
-- no task event, no job/package change).
create or replace function app.cmd_call_record(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['type', 'work_package_id', 'contact_id', 'person_id', 'attempted_at', 'outcome', 'notes', 'next_attempt_at',
          'actual_completion_confirmed', 'customer_happy'],
    array['type', 'outcome']);
  v_actor uuid := app.actor_id(p_actor);
  v_job public.jobs;
  v_task public.tasks;
  v_task_after public.tasks;
  v_wp public.work_packages;
  v_wp_after public.work_packages;
  v_job_after public.jobs;
  v_call public.calls;
  v_type text := app.txt(v_p, 'type');
  v_outcome text := app.txt(v_p, 'outcome');
  v_notes text := app.txt(v_p, 'notes');
  v_at timestamptz;
  v_next timestamptz;
  v_wp_id uuid := app.ref(v_p, 'work_package_id');
  v_contact uuid := app.ref(v_p, 'contact_id');
  v_person uuid := app.ref(v_p, 'person_id');
  v_confirmed boolean := app.yes_flag(v_p -> 'actual_completion_confirmed');
  v_happy boolean := case when app.yes_flag(v_p -> 'customer_happy') then true
                          when app.no_flag(v_p -> 'customer_happy') then false end;
  v_task_id uuid := app.ref(p_request, 'task_id');
  v_issue jsonb;
  v_rem jsonb;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  -- Deviation: server-side actionability (REF-03 §11.7).
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;

  if v_task_id is null then
    if v_job.version <> app.expected_version(p_request) then
      perform app.fail('R1A_STALE_VERSION');
    end if;
    -- Deviation: completion / customer flags act only through a call task.
    if v_confirmed or v_happy is not null then
      perform app.fail('S10_REVIEW: completion and customer outcomes need the INS01 / INS04 call task');
    end if;
  else
    select * into v_task from public.tasks where id = v_task_id for update;
    if v_task.id is null or v_task.version <> app.expected_version(p_request) then
      perform app.fail('R1A_STALE_VERSION');
    end if;
    if v_task.job_id is distinct from v_job.id or v_task.template_code not in ('INS01', 'INS04') then
      perform app.fail('S10_REVIEW: invalid call task');
    end if;
  end if;
  if v_type not in ('Installer', 'Customer', 'Payment', 'Supplier') then
    perform app.fail('S10_REVIEW: invalid call type');
  end if;
  if v_outcome not in ('NoAnswer', 'Complete', 'ReturnRequired', 'Unhappy', 'Confirmed', 'Other') then
    perform app.fail('S10_REVIEW: invalid call outcome');
  end if;
  v_at := app.s10_timestamp(app.txt(v_p, 'attempted_at'), now());
  v_next := app.s10_timestamp(app.txt(v_p, 'next_attempt_at'));
  if v_contact is not null and not exists (select 1 from public.contacts c where c.id = v_contact) then
    perform app.fail('R1A_CONTACT_NOT_FOUND');
  end if;
  if v_person is not null and not exists (select 1 from public.people p where p.id = v_person) then
    perform app.fail('R1A_PERSON_NOT_FOUND');
  end if;
  -- An INS01 call is about the task's work package; a different one is refused.
  if v_task.template_code = 'INS01' and v_task.related_entity_type = 'WorkPackages' then
    if v_wp_id is not null and v_wp_id <> v_task.related_entity_id then
      perform app.fail('S10_REVIEW: work package linkage invalid');
    end if;
    v_wp_id := coalesce(v_wp_id, v_task.related_entity_id);
  end if;
  if v_wp_id is not null then
    select * into v_wp from public.work_packages where id = v_wp_id for update;
    if v_wp.id is null or v_wp.job_id <> v_job.id then
      perform app.fail('S10_REVIEW: work package linkage invalid');
    end if;
  end if;

  insert into public.calls (job_id, work_package_id, task_id, type, contact_id, person_id, attempted_at, attempted_by,
                            outcome, notes, next_attempt_at, actual_completion_confirmed, customer_happy)
  values (v_job.id, v_wp_id, v_task.id, v_type, v_contact, v_person, v_at, v_actor, v_outcome, v_notes, v_next,
          v_confirmed, v_happy)
  returning * into v_call;
  perform app.audit('Calls', v_call.id::text, 'RecordCall', null, to_jsonb(v_call), v_notes);

  if v_task.id is null then
    return jsonb_build_object('status', 'Recorded', 'job_level', true, 'call', to_jsonb(v_call), 'task', null,
                              'external_calls', 0);
  end if;

  if v_outcome = 'NoAnswer' then
    update public.tasks set status = 'Open', next_followup_at = coalesce(v_next, app.s10_due(v_at, 1))
    where id = v_task.id returning * into v_task_after;
  else
    update public.tasks set status = 'Complete', completed_at = v_at, completed_by = v_actor, completion_note = v_outcome
    where id = v_task.id returning * into v_task_after;
  end if;
  perform app.task_event(v_task, v_task_after, 'CallOutcome', v_outcome);
  perform app.audit('Tasks', v_task.id::text, 'CallOutcome', to_jsonb(v_task), to_jsonb(v_task_after), v_outcome);

  if v_task.template_code = 'INS01' and v_confirmed then
    if v_wp.id is null then
      perform app.fail('S10_REVIEW: work package linkage invalid');
    end if;
    update public.work_packages set
      status = case when v_outcome = 'ReturnRequired' then 'ReturnRequired' else 'ConfirmedComplete' end,
      installer_confirmation_at = v_at, installer_confirmation_by = v_actor
    where id = v_wp.id returning * into v_wp_after;
    perform app.audit('WorkPackages', v_wp.id::text, 'InstallerConfirmation', to_jsonb(v_wp), to_jsonb(v_wp_after), v_outcome);
  end if;

  if v_task.template_code = 'INS04' and v_happy is true then
    update public.jobs set customer_happy_at = v_at, customer_happy_by = v_actor
    where id = v_job.id returning * into v_job_after;
    perform app.audit('Jobs', v_job.id::text, 'CustomerHappy', to_jsonb(v_job), to_jsonb(v_job_after), v_outcome);
  end if;

  if v_task.template_code = 'INS04' and v_happy is false then
    v_issue := app.s10_create_issue(v_job.id, null, 'Complaint', 'CustomerCall',
                                    coalesce(v_notes, 'Customer reported unhappy'), v_at);
  end if;

  if v_task.template_code = 'INS01' and v_outcome = 'ReturnRequired' then
    v_issue := app.s10_create_issue(v_job.id, v_wp_id, 'Remedial', 'ReturnRequired',
                                    coalesce(v_notes, 'Return visit required'), v_at);
    v_rem := app.s10_insert_task('REM01', v_job.id, 'Issues', (v_issue #>> '{issue,id}')::uuid, 'E1',
                                 app.s10_due(now(), 1), null);
  end if;

  return jsonb_build_object('status', 'Recorded', 'job_level', false, 'call', to_jsonb(v_call), 'task', to_jsonb(v_task_after),
    'work_package', to_jsonb(v_wp_after), 'job_customer_happy_at', coalesce(v_job_after.customer_happy_at, v_job.customer_happy_at),
    'issue', v_issue -> 'issue', 'issue_task', v_issue -> 'task', 'return_task', v_rem -> 'task',
    'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- JOB_OPERATIONS read
-- -----------------------------------------------------------------------------

-- One availability flag. The checks run in the commands' own order - role,
-- job access, release mode, then the record's state - so the first failing
-- one is the refusal the command would give. 'denied' tells the UI which kind
-- of "no" it is: ROLE (not your job), ACCESS (not assigned / outside pilot),
-- MODE (switched off for this release) or STATE (not possible right now).
create function app.r1x_flag(p_role_ok boolean, p_access_ok boolean, p_mode_ok boolean,
                             p_state_ok boolean, p_state_reason text default null)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'available', coalesce(p_role_ok, false) and coalesce(p_access_ok, false) and coalesce(p_mode_ok, false)
                 and coalesce(p_state_ok, false),
    'denied', case when not coalesce(p_role_ok, false) then 'ROLE'
                   when not coalesce(p_access_ok, false) then 'ACCESS'
                   when not coalesce(p_mode_ok, false) then 'MODE'
                   when not coalesce(p_state_ok, false) then 'STATE' end,
    'reason', case when coalesce(p_role_ok, false) and coalesce(p_access_ok, false) and coalesce(p_mode_ok, false)
                        and not coalesce(p_state_ok, false) then p_state_reason end))
$$;

create function app.read_job_operations(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_access boolean;
  v_active boolean;
  v_normal boolean;
  v_office boolean := app.is_office(p_actor);
  v_office_mgr boolean := app.is_office_manager(p_actor);
  v_fn01 boolean := app.mode_available('FN-01', 'Automated');
  v_complete_modes boolean := app.mode_available('FN-19', 'Manual') and app.mode_available('FN-11', 'Manual');
  v_cancel_modes boolean;
  v_reschedulable boolean;
  v_gate jsonb;
  v_packages jsonb;
  v_issues jsonb;
  v_calls jsonb;
  v_installers jsonb;
begin
  perform app.req_keys(p_request, array['job_id']);
  v_job := app.read_authorize_job(p_actor, app.req_text(p_request, 'job_id'));
  -- Acting needs the reference assignment, not just read visibility.
  v_access := app.job_in_scope(v_job) and app.is_assigned(p_actor, v_job.id);
  v_active := app.job_actionable(v_job);
  v_normal := v_active and not exists (
    select 1 from public.tasks t where t.job_id = v_job.id and t.template_code = 'S15-REOPEN-REVIEW'
      and t.status not in ('Complete', 'NotRequired')) and v_job.cancellation_at is null;
  v_cancel_modes := v_fn01 and app.mode_available('FN-17', 'Manual') and app.mode_available('FN-20', 'Manual');
  v_reschedulable := v_normal and v_job.workflow_stage in ('Booked', 'AwaitingInstallation', 'InProgress', 'BookingInProgress');
  v_gate := app.s10_evaluate_operational_completion(v_job.id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'trade', w.trade, 'status', w.status, 'version', w.version, 'revision', w.revision,
      'required', w.required, 'sequence', w.sequence,
      'planned_start', w.planned_start, 'planned_end', w.planned_end, 'actual_end', w.actual_end,
      'installer_confirmation_at', w.installer_confirmation_at,
      'allocations', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', a.id, 'person_id', a.person_id, 'person_name', app.s17_person_name(a.person_id),
                        'role', a.role, 'start_at', a.start_at, 'end_at', a.end_at) order by a.role, a.created_at), '[]'::jsonb)
                      from public.allocations a where a.work_package_id = w.id and a.active),
      'commissioning', jsonb_build_object(
        'required', w.commissioning_required,
        'accepted', exists (select 1 from public.commissioning_submissions s where s.work_package_id = w.id and s.status = 'Accepted'),
        'installer_accepted', exists (select 1 from public.commissioning_submissions s where s.work_package_id = w.id
                                      and s.status = 'Accepted' and s.source_system <> 'R1A-office-manual'),
        'current', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', s.id, 'status', s.status, 'source_system', s.source_system,
                      'office_reference', s.office_reference, 'review_notes', s.review_notes,
                      'reviewed_at', s.reviewed_at, 'reviewed_by_name', app.s17_person_name(s.reviewed_by),
                      'submitted_at', s.submitted_at,
                      'evidence', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'filename', e.filename)
                                                             order by e.created_at), '[]'::jsonb)
                                   from public.evidence e where e.submission_id = s.id))
                      order by s.created_at desc), '[]'::jsonb)
                    from public.commissioning_submissions s
                    where s.work_package_id = w.id
                      and not exists (select 1 from public.commissioning_submissions x where x.supersedes_submission_id = s.id))),
      'actions', jsonb_build_object(
        'commissioning_record', app.r1x_flag(v_office_mgr, v_access, v_fn01,
          v_active and w.commissioning_required and w.status <> 'Cancelled'
            and not exists (select 1 from public.commissioning_submissions s where s.work_package_id = w.id
                            and s.status = 'Accepted' and s.source_system <> 'R1A-office-manual'),
          case when not v_active then 'JOB_NOT_ACTIONABLE' when not w.commissioning_required then 'COMMISSIONING_NOT_REQUIRED'
               when w.status = 'Cancelled' then 'WORK_PACKAGE_CANCELLED' else 'INSTALLER_FORM_ACCEPTED' end),
        'planner_update', app.r1x_flag(v_office, v_access, v_fn01, v_normal and w.status <> 'Cancelled',
          case when not v_active then 'JOB_NOT_ACTIONABLE' when w.status = 'Cancelled' then 'WORK_PACKAGE_CANCELLED'
               else 'NORMAL_WORK_SUPPRESSED' end),
        'change_installer', app.r1x_flag(v_office, v_access, v_fn01,
          v_reschedulable and w.status <> 'Cancelled'
            and exists (select 1 from public.allocations a where a.work_package_id = w.id and a.active),
          case when not v_active then 'JOB_NOT_ACTIONABLE' when not v_normal then 'NORMAL_WORK_SUPPRESSED'
               when not v_reschedulable then 'STAGE_NOT_ELIGIBLE' when w.status = 'Cancelled' then 'WORK_PACKAGE_CANCELLED'
               else 'NO_ACTIVE_ALLOCATION' end))
    ) order by w.sequence, w.created_at), '[]'::jsonb)
  into v_packages
  from public.work_packages w where w.job_id = v_job.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'type', i.type, 'category', i.category, 'description', i.description, 'severity', i.severity,
      'status', i.status, 'blocks_completion', i.blocks_completion, 'raised_at', i.raised_at,
      'raised_by_name', app.s17_person_name(i.raised_by), 'owner_id', i.office_owner_id,
      'owner_name', app.s17_person_name(i.office_owner_id), 'resolution', i.resolution, 'resolved_at', i.resolved_at,
      'closed_at', i.closed_at, 'version', i.version, 'work_package_id', i.work_package_id,
      'actions', jsonb_build_object(
        'resolve', app.r1x_flag(v_office, v_access, v_fn01, v_active and i.status not in ('Resolved', 'Closed'),
                                case when not v_active then 'JOB_NOT_ACTIONABLE' else 'ALREADY_RESOLVED' end),
        'close', app.r1x_flag(v_office, v_access, v_fn01, v_active and i.status = 'Resolved',
                              case when not v_active then 'JOB_NOT_ACTIONABLE' else 'RESOLVE_FIRST' end),
        'reassign', app.r1x_flag(v_office, v_access, v_fn01, v_active and i.status <> 'Closed',
                                 case when not v_active then 'JOB_NOT_ACTIONABLE' else 'ISSUE_CLOSED' end))
    ) order by (i.status in ('Resolved', 'Closed')), i.raised_at desc), '[]'::jsonb)
  into v_issues
  from public.issues i where i.job_id = v_job.id;

  -- No customer contact details: who called, when, about what, and the outcome.
  select coalesce(jsonb_agg(c.row order by c.attempted_at desc), '[]'::jsonb) into v_calls
  from (
    select cl.attempted_at, jsonb_build_object(
      'id', cl.id, 'attempted_at', cl.attempted_at, 'type', cl.type, 'outcome', cl.outcome, 'notes', cl.notes,
      'next_attempt_at', cl.next_attempt_at, 'attempted_by_name', app.s17_person_name(cl.attempted_by),
      'job_level', cl.task_id is null, 'task_id', cl.task_id, 'task_code', t.template_code, 'task_title', t.title,
      'work_package_trade', w.trade) as row
    from public.calls cl
    left join public.tasks t on t.id = cl.task_id
    left join public.work_packages w on w.id = cl.work_package_id
    where cl.job_id = v_job.id
    order by cl.attempted_at desc
    limit 100) c;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name), '[]'::jsonb)
  into v_installers
  from public.people p
  where p.active and exists (select 1 from public.person_roles r where r.person_id = p.id and r.role_code = 'Installer'
                             and r.active);

  return jsonb_build_object(
    'job', jsonb_build_object(
      'id', v_job.id, 'job_ref', v_job.job_ref, 'version', v_job.version, 'workflow_stage', v_job.workflow_stage,
      'operational_complete_at', v_job.operational_complete_at,
      'operational_complete_by_name', app.s17_person_name(v_job.operational_complete_by),
      'customer_happy_at', v_job.customer_happy_at, 'archived_at', v_job.archived_at,
      'cancellation_at', v_job.cancellation_at, 'cancellation_reason', v_job.cancellation_reason,
      'cancellation_by_name', app.s17_person_name(v_job.cancellation_by),
      'open_cancellation_tasks', (select count(*) from public.tasks t where t.job_id = v_job.id
                                  and t.task_group = 'Cancellation'
                                  and t.status in ('Open', 'Waiting', 'InProgress', 'Blocked'))),
    'packages', v_packages,
    'issues', v_issues,
    'calls', v_calls,
    'installers', v_installers,
    'completion', jsonb_build_object(
      'gate', v_gate,
      -- The server gate decides; the stage is not a precondition (REF-03 §11.2:
      -- nothing moves a job to InProgress / Aftercare, and the reference command
      -- does not check the stage).
      'action', app.r1x_flag(v_office_mgr, v_access, v_complete_modes,
        v_normal and v_job.operational_complete_at is null and (v_gate ->> 'ready')::boolean,
        case when not v_active then 'JOB_NOT_ACTIONABLE' when not v_normal then 'NORMAL_WORK_SUPPRESSED'
             when v_job.operational_complete_at is not null then 'ALREADY_COMPLETE' else 'COMPLETION_GATE_OPEN' end)),
    'actions', jsonb_build_object(
      'call_record', app.r1x_flag(v_office, v_access, v_fn01, v_active, 'JOB_NOT_ACTIONABLE'),
      'issue_create', app.r1x_flag(v_office, v_access, v_fn01, v_active, 'JOB_NOT_ACTIONABLE'),
      'cancel_job', app.r1x_flag(v_office_mgr, v_access, v_cancel_modes, v_active,
                                 case when v_job.archived_at is not null then 'JOB_ARCHIVED' else 'CANCELLATION_STARTED' end),
      'reinstate_job', app.r1x_flag(v_office_mgr, v_access, v_cancel_modes, v_job.workflow_stage = 'Cancelled',
                                    'STAGE_NOT_CANCELLED')));
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('JOB_OPERATIONS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'r1-completion',
   'Job operations after booking: work packages with commissioning and allocations, issues, calls (no customer contact details), completion gate, and command availability (ROLE / ACCESS / MODE / STATE).');

-- -----------------------------------------------------------------------------
-- Staff-facing wording
-- -----------------------------------------------------------------------------

alter function app.result_error_catalogue() rename to result_error_catalogue_pre_r1_completion;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_r1_completion() || '{
  "R1A_REQUIRED_EVIDENCE": [
    "ActionRequired",
    "Attach the commissioning certificate or evidence file, then try again."
  ],
  "R1A_COMMISSIONING_NOT_REQUIRED": [
    "Failed",
    "This work package does not need commissioning."
  ],
  "R1A_WORK_PACKAGE_NOT_ACTIONABLE": [
    "Failed",
    "This work package has been cancelled."
  ],
  "R1A_COMMISSIONING_ALREADY_ACCEPTED": [
    "Failed",
    "An installer commissioning form has already been accepted for this work package."
  ],
  "R1A_WORK_PACKAGE_JOB_MISMATCH": [
    "Failed",
    "That work package belongs to a different job."
  ],
  "R1A_TASK_JOB_MISMATCH": [
    "Failed",
    "That task belongs to a different job."
  ]
}'::jsonb
$$;

-- Success wording for COMMISSIONING_RECORD (otherwise the generic "Request
-- completed successfully."). Every other command is described exactly as
-- before by the renamed original.
alter function public.describe_command_result(text, jsonb) rename to describe_command_result_pre_r1_completion;

create function public.describe_command_result(p_command_type text, p_result jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_out jsonb := public.describe_command_result_pre_r1_completion(p_command_type, p_result);
begin
  if p_command_type = 'COMMISSIONING_RECORD' and v_out ->> 'status' = 'Succeeded' then
    return v_out || jsonb_build_object('message', 'Commissioning evidence recorded. It counts towards completion for this work package.');
  end if;
  return v_out;
end
$$;
