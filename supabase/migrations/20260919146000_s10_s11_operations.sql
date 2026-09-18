-- =============================================================================
-- Backend port, part 7: R1 office operations - S10 calls, issues and
-- operational completion; S11 planner date updates, move job, change installer.
--
--   CALL_RECORD           s10/operations.js _s10RecordCall + services.js _r1sCallRecord
--   ISSUE_CREATE          s10 _s10CreateIssue + services.js _r1sIssueCreate
--   ISSUE_UPDATE          s10 _s10ReassignIssue / _s10TransitionIssue + _r1sIssueUpdate
--   OPERATIONAL_COMPLETE  s10 _s10ApproveOperationalCompletion + _r1sOperationalComplete
--   PLANNER_UPDATE        s11/planner.js _s11UpdatePlannedDates + _r1sPlannerUpdate
--   MOVE_JOB              s11 _s11MoveJobR1 + _r1sMoveJob
--   CHANGE_INSTALLER      s11 _s11ChangeInstallerR1 + _r1sChangeInstaller
--
-- Scheduled generators (plain functions, no command; a scheduler calls
-- app.s10_run_schedules()):
--   app.s10_schedule_installer_calls      INS01  (_s10ScheduleInstallerCalls, FN-01)
--   app.s10_schedule_customer_call        INS04  (_s10ScheduleCustomerCall, FN-01)
--   app.s10_schedule_missing_commissioning INS02 (_s10ScheduleMissingCommissioning, FN-18 Manual)
--
-- Calendar: R1 never calls the Calendar API. Intent is captured as
-- calendar_links + outbox rows with response_summary
-- 'CAPTURE_ONLY: no Calendar API call' exactly as the reference.
--
-- Deviations (each also marked "-- Deviation:" at the point of change):
--   * Server-side actionability (R1A_JOB_NOT_ACTIONABLE) on CALL_RECORD,
--     ISSUE_UPDATE, PLANNER_UPDATE, MOVE_JOB, CHANGE_INSTALLER, plus the S15
--     normal-work guard and the stage restriction (Booked, AwaitingInstallation,
--     InProgress, BookingInProgress -> else R1A_STAGE_NOT_ELIGIBLE) on
--     MOVE_JOB / CHANGE_INSTALLER (REF-03 §11.7; reference checked read-side only).
--   * MOVE_JOB per-entity impact tasks are keyed per entity (REF-03 §11.8).
--   * Due "09:00" is Europe/London (REF-03 §11.9, core convention).
--   * Owners come from task_assignment_rules (INS01/INS04/REM01/GHL01/ISS02/
--     S11-MOVE-*), the single active VariationApprover (Variation issues) or
--     the Lead allocation (INS02), never "PERSON-tanya" or row order (REF-03 §11.14).
--   * OPERATIONAL_COMPLETE returns the GHL01 task row (reference returned
--     undefined on first completion - REF-03 §11.18).
--   * Installer eligibility uses an active person_roles Installer role_code
--     (reference People.role === 'Installer'; people carry no role here).
--   * Stale versions use R1A_STALE_VERSION (reference S11_STALE: ...).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Date helpers (reference _s10LocalDate / _s11LocalDate / _s10RequireDateTime)
-- -----------------------------------------------------------------------------

-- 'YYYY-MM-DD' or an ISO timestamp -> its literal calendar date.
create function app.s1x_local_date(p_value text, p_prefix text)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_value, ''));
  v_m text[];
  v_date date;
begin
  if v_text = '' then
    perform app.fail(p_prefix || '_DATE_INVALID: date value is required');
  end if;
  v_m := regexp_match(v_text, '^([0-9]{4})-([0-9]{2})-([0-9]{2})($|T)');
  if v_m is null then
    perform app.fail(p_prefix || '_DATE_INVALID: expected YYYY-MM-DD or ISO timestamp');
  end if;
  begin
    v_date := make_date(v_m[1]::int, v_m[2]::int, v_m[3]::int);
  exception when others then
    v_date := null;
  end;
  if v_date is null then
    perform app.fail(p_prefix || '_DATE_INVALID: invalid calendar date');
  end if;
  if length(v_text) > 10 then
    begin
      perform v_text::timestamptz;
    exception when others then
      v_date := null;
    end;
    if v_date is null then
      perform app.fail(p_prefix || '_DATE_INVALID: invalid ISO timestamp');
    end if;
  end if;
  return v_date;
end
$$;

-- ISO timestamp (or date) text -> instant; null/blank -> p_default.
create function app.s10_timestamp(p_value text, p_default timestamptz default null)
returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(coalesce(p_value, '')), '');
  v_at timestamptz;
begin
  if v_text is null then
    return p_default;
  end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    perform app.fail('S10_DATE_INVALID: invalid timestamp');
  end if;
  begin
    v_at := v_text::timestamptz;
  exception when others then
    v_at := null;
  end;
  if v_at is null then
    perform app.fail('S10_DATE_INVALID: invalid timestamp');
  end if;
  return v_at;
end
$$;

-- n staffed days after the instant's London date, at 09:00 London.
-- Deviation: 09:00 Europe/London, not literal 09:00Z (REF-03 §11.9).
create function app.s10_due(p_from timestamptz, p_days int)
returns timestamptz
language sql stable
set search_path = ''
as $$ select app.london_at(app.add_staffed_days(p_from, p_days), '09:00') $$;

create function app.s10_due_from_date(p_date date, p_days int)
returns timestamptz
language sql stable
set search_path = ''
as $$ select app.s10_due(app.london_at(p_date, '12:00'), p_days) $$;

-- -----------------------------------------------------------------------------
-- S10 shared helpers
-- -----------------------------------------------------------------------------

-- R1 pilot job + exact release modes (reference _s10AssertScope). Commands get
-- this from app.authorize_command; the generators check it themselves.
create function app.s10_assert_scope(p_job_id uuid, p_function_ids text[])
returns public.jobs
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_fn text;
  v_wanted text;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null or not app.job_in_scope(v_job) then
    perform app.fail('S10_REFUSED: R1 pilot job required');
  end if;
  foreach v_fn in array p_function_ids loop
    v_wanted := case when v_fn = 'FN-01' then 'Automated' else 'Manual' end;
    if not app.mode_available(v_fn, v_wanted) then
      perform app.fail('S10_REFUSED: ' || v_fn || ' must be ' || v_wanted);
    end if;
  end loop;
  return v_job;
end
$$;

-- The single active VariationApprover (reference _s10OwnerForRole).
-- Deviation: never resolved by name/literal id (REF-03 §11.14).
create function app.s10_variation_approver()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_count int;
  v_id uuid;
begin
  select count(distinct p.id), min(p.id::text)::uuid into v_count, v_id
  from public.people p join public.person_roles r on r.person_id = p.id
  join public.roles ro on ro.code = r.role_code and ro.active
  where p.active and r.active and r.role_code = 'VariationApprover';
  if v_count <> 1 then
    perform app.fail('S10_CONFIG: exactly one active VariationApprover owner required');
  end if;
  return v_id;
end
$$;

-- One task per {code}-{entity}-{episode} (reference _s10InsertTask): an
-- existing task in any status is reused, never re-dated or reassigned.
create function app.s10_insert_task(p_code text, p_job_id uuid, p_entity_type text, p_entity_id uuid,
                                    p_episode text, p_due_at timestamptz, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := p_code || '-' || p_entity_id || '-' || p_episode;
  v_id uuid;
  v_task public.tasks;
begin
  if not exists (select 1 from public.task_templates t where t.code = p_code and t.active) then
    perform app.fail('S10_CONFIG: exactly one active _s10Template ' || p_code || ' required');
  end if;
  v_id := app.create_task_instance(p_job_id, p_code, v_key, p_owner, null, p_due_at, 1, null, null, p_entity_type, p_entity_id);
  select * into v_task from public.tasks where instance_key = v_key;
  return jsonb_build_object('created', v_id is not null, 'task', to_jsonb(v_task));
end
$$;

-- Issue + Opened event + ISS01 (Variation) / ISS02 task (reference _s10CreateIssue).
create function app.s10_create_issue(p_job_id uuid, p_work_package_id uuid, p_type text, p_category text,
                                     p_description text, p_raised_at timestamptz, p_owner uuid default null,
                                     p_severity text default 'Normal', p_blocks_completion boolean default true,
                                     p_due_at timestamptz default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.issues;
  v_task jsonb;
  v_owner uuid;
begin
  if p_type is null or p_type not in ('Variation', 'Remedial', 'Complaint') then
    perform app.fail('S10_REVIEW: invalid issue type');
  end if;
  v_owner := coalesce(p_owner, case when p_type = 'Variation' then app.s10_variation_approver() else app.rule_owner('ISS02') end);
  insert into public.issues (job_id, work_package_id, type, category, description, raised_at, raised_by,
                             office_owner_id, severity, status, due_at, blocks_completion, blocks_strip,
                             approval_status)
  values (p_job_id, p_work_package_id, p_type, p_category, p_description, p_raised_at, app.context_actor_id(),
          v_owner, coalesce(p_severity, 'Normal'), 'Open', coalesce(p_due_at, app.s10_due(p_raised_at, 1)),
          coalesce(p_blocks_completion, true), false, 'NotRequired')
  returning * into v_issue;
  insert into public.issue_events (issue_id, event_type, actor, occurred_at, note, previous_status, new_status)
  values (v_issue.id, 'Opened', app.context_actor_id(), p_raised_at, p_description, null, 'Open');
  -- A default-owned ISS02 takes owner and backup from its assignment rule.
  v_task := app.s10_insert_task(case when p_type = 'Variation' then 'ISS01' else 'ISS02' end, p_job_id,
                                'Issues', v_issue.id, 'E1', v_issue.due_at,
                                case when p_owner is null and p_type <> 'Variation' then null else v_issue.office_owner_id end);
  perform app.audit('Issues', v_issue.id::text, 'Create', null, to_jsonb(v_issue), coalesce(p_reason, p_category));
  return jsonb_build_object('issue', to_jsonb(v_issue), 'task', v_task -> 'task');
end
$$;

-- -----------------------------------------------------------------------------
-- S10 scheduled generators
-- -----------------------------------------------------------------------------

-- INS01 per required, live, unconfirmed work package with an end date: due one
-- staffed day after actual_end (else planned_end); key INS01-{wp}-R{revision}.
create function app.s10_schedule_installer_calls(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_wp public.work_packages;
  v_r jsonb;
  v_created jsonb := '[]'::jsonb;
  v_reused jsonb := '[]'::jsonb;
begin
  perform app.s10_assert_scope(p_job_id, array['FN-01']);
  -- Owner and backup from the INS01 assignment rule.
  v_owner := null;
  for v_wp in
    select * from public.work_packages w
    where w.job_id = p_job_id and w.required and w.status not in ('Cancelled', 'ConfirmedComplete')
      and coalesce(w.actual_end, w.planned_end) is not null
    order by w.sequence, w.id
  loop
    v_r := app.s10_insert_task('INS01', p_job_id, 'WorkPackages', v_wp.id, 'R' || v_wp.revision,
                               app.s10_due_from_date(coalesce(v_wp.actual_end, v_wp.planned_end), 1), v_owner);
    if (v_r ->> 'created')::boolean then
      v_created := v_created || jsonb_build_array(v_r -> 'task');
    else
      v_reused := v_reused || jsonb_build_array(v_r -> 'task');
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'reused', v_reused);
end
$$;

-- INS04 once every required live package is ConfirmedComplete with an
-- installer confirmation: due one staffed day after the latest confirmation.
create function app.s10_schedule_customer_call(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest date;
  v_r jsonb;
begin
  perform app.s10_assert_scope(p_job_id, array['FN-01']);
  if not exists (select 1 from public.work_packages w where w.job_id = p_job_id and w.required and w.status <> 'Cancelled')
     or exists (select 1 from public.work_packages w where w.job_id = p_job_id and w.required and w.status <> 'Cancelled'
                and (w.status <> 'ConfirmedComplete' or w.installer_confirmation_at is null)) then
    return jsonb_build_object('status', 'Blocked', 'reason', 'INSTALLER_CONFIRMATIONS_MISSING', 'created', '[]'::jsonb);
  end if;
  select max(app.london_date(w.installer_confirmation_at)) into v_latest
  from public.work_packages w where w.job_id = p_job_id and w.required and w.status <> 'Cancelled';
  v_r := app.s10_insert_task('INS04', p_job_id, 'Jobs', p_job_id, 'ROOT', app.s10_due_from_date(v_latest, 1), null);
  return jsonb_build_object('status', 'Ready',
    'created', case when (v_r ->> 'created')::boolean then jsonb_build_array(v_r -> 'task') else '[]'::jsonb end,
    'reused', case when (v_r ->> 'created')::boolean then '[]'::jsonb else jsonb_build_array(v_r -> 'task') end);
end
$$;

-- INS02 (FN-18 Manual): commissioning-required package reported/confirmed/
-- return-required with an actual end, no Submitted/UnderReview/Accepted
-- submission, and p_now at or after the due (2 staffed days after actual_end).
-- Owner = the single active Lead allocation's person.
create function app.s10_schedule_missing_commissioning(p_job_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wp public.work_packages;
  v_due timestamptz;
  v_count int;
  v_lead uuid;
  v_r jsonb;
  v_created jsonb := '[]'::jsonb;
  v_reused jsonb := '[]'::jsonb;
begin
  perform app.s10_assert_scope(p_job_id, array['FN-18']);
  if p_now is null then
    perform app.fail('S10_DATE_INVALID: timestamp value is required');
  end if;
  for v_wp in
    select * from public.work_packages w
    where w.job_id = p_job_id and w.required and w.commissioning_required
      and w.status in ('ReportedComplete', 'ConfirmedComplete', 'ReturnRequired') and w.actual_end is not null
    order by w.sequence, w.id
  loop
    continue when exists (select 1 from public.commissioning_submissions s
                          where s.job_id = p_job_id and s.work_package_id = v_wp.id
                            and s.status in ('Submitted', 'UnderReview', 'Accepted'));
    v_due := app.s10_due_from_date(v_wp.actual_end, 2);
    continue when p_now < v_due;
    select count(*), min(a.person_id::text)::uuid into v_count, v_lead
    from public.allocations a where a.work_package_id = v_wp.id and a.active and a.role = 'Lead';
    if v_count <> 1 then
      perform app.fail('S10_REVIEW: commissioning owner ambiguous');
    end if;
    v_r := app.s10_insert_task('INS02', p_job_id, 'WorkPackages', v_wp.id, 'R' || v_wp.revision, v_due, v_lead);
    if (v_r ->> 'created')::boolean then
      v_created := v_created || jsonb_build_array(v_r -> 'task');
    else
      v_reused := v_reused || jsonb_build_array(v_r -> 'task');
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'reused', v_reused);
end
$$;

-- Runs the S10 generators for every eligible job (in pilot scope, actionable,
-- not S15-suppressed, with work packages). One job's failure (e.g. ambiguous
-- commissioning owner) is rolled back for that generator only and reported.
-- A generator whose release mode is not enabled is skipped.
create function app.s10_run_schedules(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_r jsonb;
  v_fn01 boolean := app.mode_available('FN-01', 'Automated');
  v_fn18 boolean := app.mode_available('FN-18', 'Manual');
  v_jobs int := 0;
  v_suppressed int := 0;
  v_ins01_created int := 0;
  v_ins01_reused int := 0;
  v_ins04_created int := 0;
  v_ins04_blocked int := 0;
  v_ins02_created int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if nullif(current_setting('app.executing_service', true), '') is null then
    perform set_config('app.executing_service', 'scheduler:s10', true);
  end if;
  for v_job in
    select * from public.jobs j
    where app.job_in_scope(j) and app.job_actionable(j)
      and exists (select 1 from public.work_packages w where w.job_id = j.id)
    order by j.created_at, j.id
  loop
    if exists (select 1 from public.tasks t where t.job_id = v_job.id and t.template_code = 'S15-REOPEN-REVIEW'
               and t.status not in ('Complete', 'NotRequired')) or v_job.cancellation_at is not null then
      v_suppressed := v_suppressed + 1;
      continue;
    end if;
    v_jobs := v_jobs + 1;
    if v_fn01 then
      begin
        v_r := app.s10_schedule_installer_calls(v_job.id);
        v_ins01_created := v_ins01_created + jsonb_array_length(v_r -> 'created');
        v_ins01_reused := v_ins01_reused + jsonb_array_length(v_r -> 'reused');
      exception when others then
        v_errors := v_errors || jsonb_build_object('job_id', v_job.id, 'job_ref', v_job.job_ref, 'generator', 'INS01', 'error', sqlerrm);
      end;
      begin
        v_r := app.s10_schedule_customer_call(v_job.id);
        if v_r ->> 'status' = 'Blocked' then
          v_ins04_blocked := v_ins04_blocked + 1;
        else
          v_ins04_created := v_ins04_created + jsonb_array_length(v_r -> 'created');
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object('job_id', v_job.id, 'job_ref', v_job.job_ref, 'generator', 'INS04', 'error', sqlerrm);
      end;
    end if;
    if v_fn18 then
      begin
        v_r := app.s10_schedule_missing_commissioning(v_job.id, p_now);
        v_ins02_created := v_ins02_created + jsonb_array_length(v_r -> 'created');
      exception when others then
        v_errors := v_errors || jsonb_build_object('job_id', v_job.id, 'job_ref', v_job.job_ref, 'generator', 'INS02', 'error', sqlerrm);
      end;
    end if;
  end loop;
  return jsonb_build_object(
    'evaluated_at', p_now, 'jobs_evaluated', v_jobs, 'jobs_suppressed', v_suppressed,
    'modes', jsonb_build_object('FN-01', v_fn01, 'FN-18', v_fn18),
    'installer_calls', jsonb_build_object('created', v_ins01_created, 'reused', v_ins01_reused),
    'customer_calls', jsonb_build_object('created', v_ins04_created, 'blocked', v_ins04_blocked),
    'commissioning_reminders', jsonb_build_object('created', v_ins02_created),
    'errors', v_errors, 'external_calls', 0);
end
$$;

grant execute on function app.s10_run_schedules(timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- CALL_RECORD
-- -----------------------------------------------------------------------------

create function app.cmd_call_record(p_request jsonb, p_actor jsonb)
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
  v_issue jsonb;
  v_rem jsonb;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  -- Deviation: server-side actionability (REF-03 §11.7).
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  select * into v_task from public.tasks where id = app.ref(p_request, 'task_id') for update;
  if v_task.id is null or v_task.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_task.job_id is distinct from v_job.id or v_task.template_code not in ('INS01', 'INS04') then
    perform app.fail('S10_REVIEW: invalid call task');
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

  return jsonb_build_object('status', 'Recorded', 'call', to_jsonb(v_call), 'task', to_jsonb(v_task_after),
    'work_package', to_jsonb(v_wp_after), 'job_customer_happy_at', coalesce(v_job_after.customer_happy_at, v_job.customer_happy_at),
    'issue', v_issue -> 'issue', 'issue_task', v_issue -> 'task', 'return_task', v_rem -> 'task',
    'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- ISSUE_CREATE
-- -----------------------------------------------------------------------------

create function app.cmd_issue_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_job public.jobs;
  v_type text;
  v_severity text;
  v_owner uuid;
  v_impact boolean;
  v_raw text;
  v_at timestamptz;
  v_res jsonb;
begin
  if p_request ?| array['task_id', 'issue_id', 'work_package_id', 'old_allocation_id'] then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_p := app.payload(p_request,
    array['issue_type', 'title', 'description', 'severity', 'owner_id', 'customer_impact', 'requested_by', 'requested_at'],
    array['issue_type', 'title', 'description']);
  v_type := app.txt(v_p, 'issue_type');
  if v_type not in ('Variation', 'Remedial', 'Complaint') then
    perform app.fail('R1A_INVALID_ISSUE_TYPE');
  end if;
  v_severity := coalesce(app.txt(v_p, 'severity'), 'Normal');
  if v_severity not in ('Normal', 'Medium') then
    perform app.fail('R1A_INVALID_SEVERITY');
  end if;
  if app.txt(v_p, 'owner_id') is not null then
    -- Reference code (services.js _r1sActivePerson) for an unknown/inactive owner.
    if app.txt(v_p, 'owner_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.fail('R1A_SALESPERSON_NOT_FOUND');
    end if;
    v_owner := app.txt(v_p, 'owner_id')::uuid;
    if not exists (select 1 from public.people p where p.id = v_owner and p.active) then
      perform app.fail('R1A_SALESPERSON_NOT_FOUND');
    end if;
  end if;
  if app.txt(v_p, 'requested_by') is not null
     and lower(app.txt(v_p, 'requested_by')) not in (lower(p_actor ->> 'id'), p_actor ->> 'email') then
    perform app.fail('R1A_ACTOR_MISMATCH');
  end if;
  if v_p ? 'customer_impact' and jsonb_typeof(v_p -> 'customer_impact') <> 'null'
     and coalesce(v_p ->> 'customer_impact', '') <> '' then
    v_raw := lower(btrim(v_p ->> 'customer_impact'));
    if v_raw in ('yes', 'true', '1', 'y') then
      v_impact := true;
    elsif v_raw in ('no', 'false', '0', 'n') then
      v_impact := false;
    else
      perform app.fail('R1A_INVALID_CUSTOMER_IMPACT');
    end if;
  end if;
  v_at := app.s10_timestamp(app.txt(v_p, 'requested_at'), now());

  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;

  -- The job row itself is never changed by an issue.
  v_res := app.s10_create_issue(v_job.id, null, v_type, app.txt(v_p, 'title'), app.txt(v_p, 'description'), v_at,
                                v_owner, v_severity, coalesce(v_impact, true), null, app.txt(v_p, 'title'));
  return jsonb_build_object('status', 'Created', 'issue_id', v_res #>> '{issue,id}', 'issue', v_res -> 'issue',
                            'task', v_res -> 'task', 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- ISSUE_UPDATE
-- -----------------------------------------------------------------------------

create function app.cmd_issue_update(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['action', 'owner_id', 'status', 'resolution', 'evidence_id', 'customer_resolution_confirmed'], array['action']);
  v_job public.jobs;
  v_issue public.issues;
  v_after public.issues;
  v_action text := app.txt(v_p, 'action');
  v_status text := app.txt(v_p, 'status');
  v_resolution text := app.txt(v_p, 'resolution');
  v_owner uuid;
  v_evidence uuid;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  -- Deviation: server-side actionability (REF-03 §11.7).
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  select * into v_issue from public.issues where id = app.ref(p_request, 'issue_id') for update;
  if v_issue.id is null or v_issue.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;

  if v_action = 'REASSIGN' then
    if app.txt(v_p, 'owner_id') is null then
      perform app.fail('R1A_REQUIRED_OWNER_ID');
    end if;
    if app.txt(v_p, 'owner_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.fail('R1A_SALESPERSON_NOT_FOUND');
    end if;
    v_owner := app.txt(v_p, 'owner_id')::uuid;
    if not exists (select 1 from public.people p where p.id = v_owner and p.active) then
      perform app.fail('R1A_SALESPERSON_NOT_FOUND');
    end if;
    update public.issues set office_owner_id = v_owner where id = v_issue.id returning * into v_after;
    insert into public.issue_events (issue_id, event_type, actor, occurred_at, note, previous_status, new_status)
    values (v_issue.id, 'Reassigned', app.actor_id(p_actor), now(), v_owner::text, v_issue.status, v_issue.status);

  elsif v_action = 'TRANSITION' then
    if v_status is null or v_status not in ('Resolved', 'Closed') then
      perform app.fail('S10_REVIEW: invalid issue transition');
    end if;
    if v_status = 'Resolved' and v_resolution is null then
      perform app.fail('S10_REVIEW: resolution required');
    end if;
    if v_status = 'Closed' and (v_issue.status <> 'Resolved'
                                or not app.yes_flag(v_p -> 'customer_resolution_confirmed')) then
      perform app.fail('S10_REVIEW: resolved issue and customer confirmation required');
    end if;
    if app.txt(v_p, 'evidence_id') is not null then
      v_evidence := app.job_evidence(v_issue.job_id, app.txt(v_p, 'evidence_id'), 'R1A_EVIDENCE_NOT_FOUND');
    end if;
    if v_status = 'Resolved' then
      update public.issues set status = 'Resolved', resolution = v_resolution, resolved_at = now()
      where id = v_issue.id returning * into v_after;
    else
      update public.issues set status = 'Closed', closed_at = now(), closed_by = app.actor_id(p_actor),
                               customer_resolution_confirmed = true
      where id = v_issue.id returning * into v_after;
    end if;
    insert into public.issue_events (issue_id, event_type, actor, occurred_at, note, previous_status, new_status, evidence_id)
    values (v_issue.id, v_status, app.actor_id(p_actor), now(), v_resolution, v_issue.status, v_status, v_evidence);

  else
    perform app.fail('R1A_ISSUE_ACTION_DENIED');
  end if;

  perform app.audit('Issues', v_issue.id::text, v_action, to_jsonb(v_issue), to_jsonb(v_after), v_resolution);
  return jsonb_build_object('status', 'Updated', 'issue', to_jsonb(v_after), 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- OPERATIONAL_COMPLETE
-- -----------------------------------------------------------------------------

-- Reference _s10EvaluateOperationalCompletion (REF-03 §7.5). Cash, handover
-- and scaffold strip are deliberately not part of this gate.
create function app.s10_evaluate_operational_completion(p_job_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_reasons text[] := '{}';
  v_wp public.work_packages;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.operational_complete_at is not null then
    return jsonb_build_object('status', 'AlreadyComplete', 'ready', true, 'reasons', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.work_packages w where w.job_id = p_job_id and w.required and w.status <> 'Cancelled')
     or exists (select 1 from public.work_packages w where w.job_id = p_job_id and w.required and w.status <> 'Cancelled'
                and (w.status <> 'ConfirmedComplete' or w.installer_confirmation_at is null)) then
    v_reasons := array_append(v_reasons, 'REQUIRED_WORK_UNCONFIRMED');
  end if;
  for v_wp in
    select * from public.work_packages w
    where w.job_id = p_job_id and w.required and w.status <> 'Cancelled' and w.commissioning_required
    order by w.sequence, w.id
  loop
    if not exists (select 1 from public.commissioning_submissions s
                   where s.job_id = p_job_id and s.work_package_id = v_wp.id and s.status = 'Accepted') then
      v_reasons := array_append(v_reasons, 'COMMISSIONING_NOT_ACCEPTED:' || v_wp.id);
    end if;
  end loop;
  if v_job.customer_happy_at is null then
    v_reasons := array_append(v_reasons, 'CUSTOMER_NOT_HAPPY');
  end if;
  if exists (select 1 from public.issues i where i.job_id = p_job_id and i.blocks_completion
             and i.status not in ('Resolved', 'Closed')) then
    v_reasons := array_append(v_reasons, 'BLOCKING_ISSUE_OPEN');
  end if;
  return jsonb_build_object('status', case when cardinality(v_reasons) > 0 then 'NeedsReview' else 'Ready' end,
                            'ready', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons));
end
$$;

-- GHL01 human task (due next staffed day after completion) + one ghl_tasks
-- tracking row (no GHL identifiers configured, no GHL call). Idempotent.
create function app.s10_ensure_ghl_tracking(p_job_id uuid, p_completed_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r jsonb;
  v_task_id uuid;
begin
  perform app.assert_normal_work(p_job_id);
  v_r := app.s10_insert_task('GHL01', p_job_id, 'Jobs', p_job_id, 'OPCOMPLETE', app.s10_due(p_completed_at, 1), null);
  v_task_id := (v_r #>> '{task,id}')::uuid;
  if not exists (select 1 from public.ghl_tasks g where g.job_id = p_job_id and g.task_id = v_task_id) then
    insert into public.ghl_tasks (job_id, task_id, readiness_snapshot)
    values (p_job_id, v_task_id, '{"status":"Ready","ready":true,"reasons":[]}');
  end if;
  return v_r -> 'task';
end
$$;

create function app.cmd_operational_complete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_after public.jobs;
  v_gate jsonb;
  v_task jsonb;
  v_stages jsonb;
begin
  perform app.payload(p_request, '{}');
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  perform app.assert_normal_work(v_job.id);
  -- Open question (REF-03 §11.2): the reference does not check the stage here
  -- and never writes AwaitingInstallation/InProgress/Aftercare; not invented.
  v_gate := app.s10_evaluate_operational_completion(v_job.id);
  if v_gate ->> 'status' = 'AlreadyComplete' then
    v_task := app.s10_ensure_ghl_tracking(v_job.id, v_job.operational_complete_at);
    return jsonb_build_object('status', 'AlreadyComplete', 'created', false, 'gate', v_gate, 'ghl_task', v_task,
                              'external_calls', 0);
  end if;
  if not (v_gate ->> 'ready')::boolean then
    -- Not ready: nothing is written.
    return jsonb_build_object('status', 'NeedsReview', 'created', false, 'gate', v_gate, 'ghl_task', null,
                              'external_calls', 0);
  end if;
  update public.jobs set workflow_stage = 'OperationallyComplete', operational_complete_at = now(),
                         operational_complete_by = app.actor_id(p_actor)
  where id = v_job.id returning * into v_after;
  perform app.audit('Jobs', v_job.id::text, 'OperationalComplete', to_jsonb(v_job), to_jsonb(v_after), 'Completed');
  -- Deviation: the created GHL01 task is returned (reference returned undefined - REF-03 §11.18).
  v_task := app.s10_ensure_ghl_tracking(v_job.id, v_after.operational_complete_at);
  -- S13: the balance stage becomes available once operational completion is recorded.
  v_stages := app.build_invoice_stages(v_job.id);
  select * into v_after from public.jobs where id = v_job.id;
  return jsonb_build_object('status', 'Completed', 'created', true, 'gate', v_gate, 'ghl_task', v_task,
                            'job', to_jsonb(v_after), 'invoice_stages', v_stages, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- S11 shared helpers
-- -----------------------------------------------------------------------------

-- Deviation: MOVE_JOB / CHANGE_INSTALLER enforce actionability, the S15 guard
-- and the stage restriction server-side (REF-03 §11.7; reference read-side only,
-- r1-appsheet/adapter.js:113).
create function app.s11_assert_reschedulable(p_job public.jobs)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not app.job_actionable(p_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  perform app.assert_normal_work(p_job.id);
  if p_job.workflow_stage not in ('Booked', 'AwaitingInstallation', 'InProgress', 'BookingInProgress') then
    perform app.fail('R1A_STAGE_NOT_ELIGIBLE');
  end if;
end
$$;

-- jobs.next_action_at = the earliest live planned work date (work package
-- planned_start or scaffold erect), as booking intake derives it
-- (s05/booking-apply.js:635-638). Returns null when there is none.
create function app.s11_next_action_at(p_job_id uuid)
returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  select app.london_at(min(d), '00:00')
  from (select w.planned_start d from public.work_packages w
        where w.job_id = p_job_id and w.status <> 'Cancelled' and w.planned_start is not null
        union all
        select s.erect_planned_at from public.scaffold_bookings s
        where s.job_id = p_job_id and s.status <> 'Cancelled' and s.erect_planned_at is not null) x
$$;

-- Calendar intent capture (reference _s11QueueCalendar). No Calendar API call:
-- one outbox row (CalendarCreate / CalendarUpdate) plus the calendar link
-- created or updated. p_alloc carries the allocation's new dates. The caller
-- stores the returned link id on the allocation.
create function app.s11_calendar_capture(p_job public.jobs, p_wp public.work_packages, p_alloc public.allocations,
                                         p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.calendar_links;
  v_out public.outbox;
  v_payload jsonb;
  v_calendar text := coalesce(app.setting('calendar.shared_calendar_id') #>> '{}', 'NOT_CONFIGURED');
begin
  if p_alloc.start_at is null or p_alloc.end_at is null then
    perform app.fail('S11_DATE_INVALID: date value is required');
  end if;
  if p_alloc.calendar_link_id is not null then
    select * into v_link from public.calendar_links where id = p_alloc.calendar_link_id for update;
  end if;
  if v_link.id is null then
    select * into v_link from public.calendar_links
    where allocation_id = p_alloc.id and status <> 'Cancelled'
    order by created_at desc limit 1 for update;
  end if;
  v_payload := jsonb_build_object('job_id', p_job.id, 'work_package_id', p_wp.id, 'allocation_id', p_alloc.id,
    'title', p_job.display_name || ' — ' || p_wp.trade, 'start_at', p_alloc.start_at, 'end_at', p_alloc.end_at + 1,
    'all_day', true, 'internal_reference', p_job.id, 'guests', '[]'::jsonb);
  insert into public.outbox (idempotency_key, action_type, target, payload_hash, job_revision, external_id,
                             response_summary, correlation_id, status)
  values ('S11-CALENDAR-' || app.context_command_id() || '-' || p_kind,
          case when v_link.external_event_id is not null then 'CalendarUpdate' else 'CalendarCreate' end,
          v_calendar, encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex'), p_wp.revision,
          v_link.external_event_id, 'CAPTURE_ONLY: no Calendar API call', app.context_command_id(), 'Pending')
  returning * into v_out;
  if v_link.id is null then
    insert into public.calendar_links (job_id, allocation_id, calendar_id, producer, entity_revision, status,
                                       start_at, end_at, all_day, description_snapshot, outbox_id)
    values (p_job.id, p_alloc.id, v_calendar, 'NewSystem', p_wp.revision, 'Pending',
            app.london_at(p_alloc.start_at, '00:00'), app.london_at(p_alloc.end_at + 1, '00:00'), true,
            v_payload::text, v_out.id)
    returning * into v_link;
  else
    update public.calendar_links set allocation_id = p_alloc.id, calendar_id = v_calendar,
      entity_revision = p_wp.revision,
      status = case when external_event_id is not null then 'UpdatePending' else 'Pending' end,
      start_at = app.london_at(p_alloc.start_at, '00:00'), end_at = app.london_at(p_alloc.end_at + 1, '00:00'),
      all_day = true, description_snapshot = v_payload::text, outbox_id = v_out.id
    where id = v_link.id returning * into v_link;
  end if;
  return jsonb_build_object('link', to_jsonb(v_link), 'outbox', to_jsonb(v_out), 'payload', v_payload);
end
$$;

-- Calendar cancellation intent for a replaced installer (_s11QueueCalendarCancel).
create function app.s11_calendar_cancel(p_link_id uuid, p_revision int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.calendar_links;
  v_out public.outbox;
  v_payload jsonb;
begin
  if p_link_id is null then
    return null;
  end if;
  select * into v_link from public.calendar_links where id = p_link_id for update;
  if v_link.id is null then
    return null;
  end if;
  v_payload := jsonb_build_object('calendar_link_id', v_link.id, 'external_event_id', v_link.external_event_id,
                                  'action', 'Cancel');
  insert into public.outbox (idempotency_key, action_type, target, payload_hash, job_revision, external_id,
                             response_summary, correlation_id, status)
  values ('S11-CALENDAR-' || app.context_command_id() || '-OLD_INSTALLER', 'CalendarCancel', v_link.calendar_id,
          encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex'), p_revision, v_link.external_event_id,
          'CAPTURE_ONLY: no Calendar API call', app.context_command_id(), 'Pending')
  returning * into v_out;
  update public.calendar_links set status = 'Cancelled', entity_revision = p_revision, outbox_id = v_out.id
  where id = v_link.id;
  return to_jsonb(v_out);
end
$$;

-- Installer eligibility (_s11ValidatePerson). The R1 variant passes no trade,
-- so the skill check does not apply. Returns {ready, reason?, detail?}.
-- Deviation: role from active person_roles 'Installer' (people.role is descriptive).
create function app.s11_validate_person(p_person_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_person public.people;
  v_leave public.person_availability;
begin
  select * into v_person from public.people where id = p_person_id;
  if v_person.id is null or not v_person.active or not app.person_has_active_role(p_person_id, array['Installer']) then
    return jsonb_build_object('ready', false, 'reason', 'INSTALLER_INACTIVE_OR_WRONG_ROLE');
  end if;
  if coalesce(v_person.capacity_per_day, 0) < 1 then
    return jsonb_build_object('ready', false, 'reason', 'CAPACITY_NOT_CONFIGURED');
  end if;
  if (v_person.available_from is not null and p_start < v_person.available_from)
     or (v_person.available_to is not null and p_end > v_person.available_to) then
    return jsonb_build_object('ready', false, 'reason', 'INSTALLER_UNAVAILABLE');
  end if;
  select * into v_leave from public.person_availability a
  where a.person_id = p_person_id and a.active and a.type <> 'Available'
    and a.from_date <= p_end and coalesce(a.to_date, a.from_date) >= p_start
  order by a.from_date limit 1;
  if v_leave.id is not null then
    return jsonb_build_object('ready', false, 'reason', 'ON_LEAVE', 'detail', jsonb_build_object(
      'conflict', true, 'availability_id', v_leave.id, 'type', v_leave.type, 'from_date', v_leave.from_date,
      'to_date', coalesce(v_leave.to_date, v_leave.from_date)));
  end if;
  return jsonb_build_object('ready', true);
end
$$;

-- Capacity (_s11Capacity): an office-closed holiday in range -> OFFICE_HOLIDAY;
-- on each staffed weekday the person's active allocations covering the date
-- must stay below capacity_per_day -> else CAPACITY_CONFLICT.
create function app.s11_capacity(p_person_id uuid, p_start date, p_end date, p_exclude_allocation uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_check jsonb := app.s11_validate_person(p_person_id, p_start, p_end);
  v_capacity int;
  v_day date;
  v_used int;
begin
  if p_end < p_start then
    perform app.fail('S11_DATE_INVALID: end before start');
  end if;
  if not (v_check ->> 'ready')::boolean then
    return v_check;
  end if;
  select capacity_per_day into v_capacity from public.people where id = p_person_id;
  v_day := p_start;
  while v_day <= p_end loop
    if exists (select 1 from public.holidays h where h.local_date = v_day and h.office_closed) then
      return jsonb_build_object('ready', false, 'reason', 'OFFICE_HOLIDAY', 'date', v_day);
    end if;
    if app.is_staffed_day(v_day) then
      select count(*) into v_used from public.allocations a
      where a.active and a.person_id = p_person_id and a.id is distinct from p_exclude_allocation
        and a.start_at is not null and a.end_at is not null and a.start_at <= v_day and a.end_at >= v_day;
      if v_used >= v_capacity then
        return jsonb_build_object('ready', false, 'reason', 'CAPACITY_CONFLICT', 'date', v_day, 'used', v_used,
                                  'capacity', v_capacity);
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return jsonb_build_object('ready', true);
end
$$;

-- -----------------------------------------------------------------------------
-- PLANNER_UPDATE
-- -----------------------------------------------------------------------------

create function app.cmd_planner_update(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['planned_start', 'planned_end', 'reason'], array['planned_start', 'planned_end']);
  v_job public.jobs;
  v_wp public.work_packages;
  v_after public.work_packages;
  v_start date := app.s1x_local_date(v_p ->> 'planned_start', 'S11');
  v_end date := app.s1x_local_date(v_p ->> 'planned_end', 'S11');
  v_next timestamptz;
begin
  if v_end < v_start then
    perform app.fail('S11_DATE_INVALID: end before start');
  end if;
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  -- Deviation: server-side actionability and S15 guard (REF-03 §11.7).
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  perform app.assert_normal_work(v_job.id);
  select * into v_wp from public.work_packages where id = app.ref(p_request, 'work_package_id') for update;
  if v_wp.id is null or v_wp.job_id <> v_job.id then
    perform app.fail('S11_REVIEW: work package linkage invalid');
  end if;
  if v_wp.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  update public.work_packages set planned_start = v_start, planned_end = v_end, revision = revision + 1
  where id = v_wp.id returning * into v_after;
  perform app.audit('WorkPackages', v_wp.id::text, 'PlanDates', to_jsonb(v_wp), to_jsonb(v_after), app.txt(v_p, 'reason'));
  -- Keep the job's derived earliest work date current (written only when it changes).
  v_next := coalesce(app.s11_next_action_at(v_job.id), v_job.next_action_at);
  if v_next is distinct from v_job.next_action_at then
    update public.jobs set next_action_at = v_next where id = v_job.id;
    perform app.audit('Jobs', v_job.id::text, 'NextActionAt', to_jsonb(v_job),
                      (select to_jsonb(j) from public.jobs j where j.id = v_job.id), app.txt(v_p, 'reason'));
  end if;
  return jsonb_build_object('status', 'Updated', 'work_package', to_jsonb(v_after), 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- MOVE_JOB
-- -----------------------------------------------------------------------------

create function app.cmd_move_job(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['activities', 'planned_start', 'planned_end', 'scaffold_erect', 'scaffold_strip', 'reason'],
    array['activities', 'reason']);
  v_reason text := app.txt(v_p, 'reason');
  v_activities text[];
  v_activity text;
  v_start date;
  v_end date;
  v_erect date;
  v_strip date;
  v_job public.jobs;
  v_after_job public.jobs;
  v_trade text;
  v_trade_name text;
  v_wp public.work_packages;
  v_wp_after public.work_packages;
  v_alloc public.allocations;
  v_alloc_new public.allocations;
  v_alloc_after public.allocations;
  v_scb public.scaffold_bookings;
  v_scb_after public.scaffold_bookings;
  v_cal jsonb;
  v_moved jsonb := '[]'::jsonb;
  v_preserved jsonb := '[]'::jsonb;
  v_calendar jsonb := '[]'::jsonb;
  v_impacts jsonb := '[]'::jsonb;
  v_impact jsonb;
  v_impact_tasks jsonb := '[]'::jsonb;
  v_key text;
  v_task_id uuid;
  v_owner uuid;
  v_found boolean;
begin
  if jsonb_typeof(v_p -> 'activities') <> 'array' or jsonb_array_length(v_p -> 'activities') = 0 then
    perform app.fail('R1A_REQUIRED_ACTIVITIES');
  end if;
  for v_activity in select jsonb_array_elements_text(v_p -> 'activities') loop
    if v_activity not in ('Roof', 'Electrical', 'Return', 'Scaffold') then
      perform app.fail('S11_REVIEW: invalid activity ' || v_activity);
    end if;
  end loop;
  select array_agg(distinct a order by a) into v_activities from jsonb_array_elements_text(v_p -> 'activities') a;
  if app.txt(v_p, 'planned_start') is not null then v_start := app.s1x_local_date(v_p ->> 'planned_start', 'S11'); end if;
  if app.txt(v_p, 'planned_end') is not null then v_end := app.s1x_local_date(v_p ->> 'planned_end', 'S11'); end if;
  if app.txt(v_p, 'scaffold_erect') is not null then v_erect := app.s1x_local_date(v_p ->> 'scaffold_erect', 'S11'); end if;
  if app.txt(v_p, 'scaffold_strip') is not null then v_strip := app.s1x_local_date(v_p ->> 'scaffold_strip', 'S11'); end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    perform app.fail('S11_DATE_INVALID: end before start');
  end if;

  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  perform app.s11_assert_reschedulable(v_job);
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;

  foreach v_trade in array array['Roof', 'Electrical', 'Return'] loop
    v_trade_name := case when v_trade = 'Return' then 'ReturnVisit' else v_trade end;
    if not v_trade = any (v_activities) then
      select v_preserved || coalesce(jsonb_agg(jsonb_build_object('work_package_id', w.id, 'trade', w.trade,
               'planned_start', w.planned_start, 'planned_end', w.planned_end) order by w.sequence, w.id), '[]'::jsonb)
        into v_preserved
      from public.work_packages w where w.job_id = v_job.id and w.trade = v_trade_name and w.status <> 'Cancelled';
      continue;
    end if;
    v_found := false;
    for v_wp in
      select * from public.work_packages w
      where w.job_id = v_job.id and w.trade = v_trade_name and w.status <> 'Cancelled'
      order by w.sequence, w.id for update
    loop
      if v_start is null or v_end is null then
        perform app.fail('S11_REVIEW: planned_start/planned_end required for ' || v_trade);
      end if;
      v_found := true;
      update public.work_packages set planned_start = v_start, planned_end = v_end, revision = revision + 1
      where id = v_wp.id returning * into v_wp_after;
      perform app.audit('WorkPackages', v_wp.id::text, 'MoveJob', to_jsonb(v_wp), to_jsonb(v_wp_after), v_reason);
      v_moved := v_moved || jsonb_build_object('work_package_id', v_wp.id, 'trade', v_trade_name);
      for v_alloc in
        select * from public.allocations a where a.work_package_id = v_wp.id and a.active
        order by a.created_at, a.id for update
      loop
        v_alloc_new := v_alloc;
        v_alloc_new.start_at := v_start;
        v_alloc_new.end_at := v_end;
        -- Deviation: outbox kind per allocation so two allocations on one
        -- package do not collide on the idempotency key (cf. REF-03 §11.8).
        v_cal := app.s11_calendar_capture(v_job, v_wp_after, v_alloc_new, 'MOVE_' || v_alloc.id);
        update public.allocations set start_at = v_start, end_at = v_end,
                                      calendar_link_id = (v_cal #>> '{link,id}')::uuid
        where id = v_alloc.id returning * into v_alloc_after;
        perform app.audit('Allocations', v_alloc.id::text, 'MoveJob', to_jsonb(v_alloc), to_jsonb(v_alloc_after), v_reason);
        v_calendar := v_calendar || to_jsonb(v_cal #>> '{outbox,id}');
        v_impacts := v_impacts || jsonb_build_object('code', 'ASSIGNED_PEOPLE',
          'title', 'Notify assigned installer of ' || v_trade_name || ' date change',
          'entity_type', 'Allocations', 'entity_id', v_alloc.id, 'group', 'Install');
      end loop;
      v_impacts := v_impacts || jsonb_build_object('code', 'CALENDAR',
          'title', 'Confirm calendar update for ' || v_trade_name || ' (CAPTURE_ONLY — no real Calendar API)',
          'entity_type', 'WorkPackages', 'entity_id', v_wp.id, 'group', 'Booking')
        || jsonb_build_object('code', 'MATERIALS', 'title', 'Review materials/delivery need-by for moved ' || v_trade_name,
          'entity_type', 'WorkPackages', 'entity_id', v_wp.id, 'group', 'Materials');
    end loop;
    if not v_found then
      perform app.fail('S11_REVIEW: no ' || v_trade_name || ' work package to move');
    end if;
  end loop;

  if 'Scaffold' = any (v_activities) then
    v_found := false;
    for v_scb in
      select * from public.scaffold_bookings s where s.job_id = v_job.id and s.status <> 'Cancelled'
      order by s.created_at, s.id for update
    loop
      v_found := true;
      if v_erect is null and v_strip is null then
        perform app.fail('S11_REVIEW: scaffold_erect or scaffold_strip required');
      end if;
      update public.scaffold_bookings set erect_planned_at = coalesce(v_erect, erect_planned_at),
                                          strip_planned_at = coalesce(v_strip, strip_planned_at),
                                          revision = revision + 1
      where id = v_scb.id returning * into v_scb_after;
      perform app.audit('ScaffoldBookings', v_scb.id::text, 'MoveJob', to_jsonb(v_scb), to_jsonb(v_scb_after), v_reason);
      v_moved := v_moved || jsonb_build_object('scaffold_booking_id', v_scb.id);
      v_impacts := v_impacts || jsonb_build_object('code', 'SCAFFOLD',
        'title', 'Notify scaffolder of erect/strip date change (manual — no real send)',
        'entity_type', 'ScaffoldBookings', 'entity_id', v_scb.id, 'group', 'Materials');
    end loop;
    if not v_found then
      perform app.fail('S11_REVIEW: no scaffold booking to move');
    end if;
  else
    select v_preserved || coalesce(jsonb_agg(jsonb_build_object('scaffold_booking_id', s.id,
             'erect_planned_at', s.erect_planned_at, 'strip_planned_at', s.strip_planned_at) order by s.created_at, s.id), '[]'::jsonb)
      into v_preserved
    from public.scaffold_bookings s where s.job_id = v_job.id and s.status <> 'Cancelled';
  end if;

  v_impacts := v_impacts
    || jsonb_build_object('code', 'CUSTOMER_NOTICE', 'title', 'Customer notice of agreed date change (manual — no real email)',
                          'entity_type', 'Jobs', 'entity_id', v_job.id, 'group', 'Booking')
    || jsonb_build_object('code', 'INTERIM_INVOICE', 'title', 'Review interim invoice timing after move',
                          'entity_type', 'Jobs', 'entity_id', v_job.id, 'group', 'Finance');

  -- Impact tasks (_s11ImpactTasks): owner/backup from the template's assignment
  -- rule, due now, priority 1. Template codes are the canonical hyphenated form
  -- (S11-MOVE-ASSIGNED-PEOPLE ...); results keep the reference impact codes.
  -- Deviation: per-entity impacts are keyed per entity, so a move touching two
  -- packages/allocations creates one task each (REF-03 §11.8); job-level
  -- impacts keep the reference key S11-MOVE-{code}-{command_id}.
  v_owner := null;
  for v_impact in select * from jsonb_array_elements(v_impacts) loop
    v_key := 'S11-MOVE-' || replace(v_impact ->> 'code', '_', '-') || '-' || app.context_command_id()
             || case when v_impact ->> 'entity_type' = 'Jobs' then '' else '-' || (v_impact ->> 'entity_id') end;
    v_task_id := app.create_task_instance(v_job.id, 'S11-MOVE-' || replace(v_impact ->> 'code', '_', '-'), v_key, v_owner, null, now(), 1,
                                 v_impact ->> 'title', v_impact ->> 'group', v_impact ->> 'entity_type',
                                 (v_impact ->> 'entity_id')::uuid, 'Open', null, false, 'S11-1.0');
    if v_task_id is not null then
      v_impact_tasks := v_impact_tasks || jsonb_build_object('code', v_impact ->> 'code', 'task_id', v_task_id,
                                                             'entity_id', v_impact ->> 'entity_id');
    end if;
  end loop;

  -- The job's earliest live work date follows the move (always a job write,
  -- as the reference bumps Jobs.version on every move).
  update public.jobs set next_action_at = coalesce(app.s11_next_action_at(v_job.id), next_action_at)
  where id = v_job.id returning * into v_after_job;
  perform app.audit('Jobs', v_job.id::text, 'MoveJob', to_jsonb(v_job), to_jsonb(v_after_job), v_reason);

  return jsonb_build_object('status', 'Moved', 'activities', to_jsonb(v_activities), 'moved', v_moved,
    'preserved', v_preserved, 'calendar_outbox_ids', v_calendar, 'impact_tasks', v_impact_tasks, 'impacts', v_impacts,
    'job', to_jsonb(v_after_job), 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- CHANGE_INSTALLER
-- -----------------------------------------------------------------------------

create function app.cmd_change_installer(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['mode', 'person_id', 'reason', 'role', 'old_allocation_id'],
                           array['mode', 'person_id', 'reason']);
  v_mode text := app.txt(v_p, 'mode');
  v_reason text := app.txt(v_p, 'reason');
  v_role text := app.txt(v_p, 'role');
  v_old_id uuid := coalesce(app.ref(v_p, 'old_allocation_id'), app.ref(p_request, 'old_allocation_id'));
  v_person uuid := app.ref(v_p, 'person_id');
  v_job public.jobs;
  v_wp public.work_packages;
  v_wp_after public.work_packages;
  v_old public.allocations;
  v_old_after public.allocations;
  v_new public.allocations;
  v_start date;
  v_end date;
  v_check jsonb;
  v_cancel jsonb;
  v_cal jsonb;
begin
  if v_old_id is null then
    perform app.fail('R1A_REQUIRED_OLD_ALLOCATION_ID');
  end if;
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  perform app.s11_assert_reschedulable(v_job);
  select * into v_wp from public.work_packages where id = app.ref(p_request, 'work_package_id') for update;
  select * into v_old from public.allocations where id = v_old_id for update;
  if v_wp.id is null or v_wp.job_id <> v_job.id or v_old.id is null or v_old.work_package_id <> v_wp.id then
    perform app.fail('S11_REVIEW: allocation linkage invalid');
  end if;
  if v_mode is null or v_mode not in ('Replace', 'Add') or v_reason is null then
    perform app.fail('S11_REVIEW: mode and reason required');
  end if;
  if v_role is not null and v_role not in ('Lead', 'Second', 'Support') then
    perform app.fail('S11_REVIEW: invalid role');
  end if;
  if v_wp.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if not v_old.active then
    perform app.fail('S11_REVIEW: active allocation linkage invalid');
  end if;

  v_start := coalesce(v_old.start_at, v_wp.planned_start);
  v_end := coalesce(v_old.end_at, v_wp.planned_end, v_wp.planned_start);
  if v_start is null or v_end is null then
    perform app.fail('S11_DATE_INVALID: date value is required');
  end if;
  -- Validation failures are a review outcome, not an error: nothing is written.
  v_check := app.s11_validate_person(v_person, v_start, v_end);
  if (v_check ->> 'ready')::boolean then
    v_check := app.s11_capacity(v_person, v_start, v_end, null);
  end if;
  if not (v_check ->> 'ready')::boolean then
    return jsonb_build_object('status', 'NeedsReview', 'reason', v_check ->> 'reason', 'detail', v_check - 'ready' - 'reason',
                              'external_calls', 0);
  end if;

  update public.work_packages set revision = revision + 1 where id = v_wp.id returning * into v_wp_after;
  perform app.audit('WorkPackages', v_wp.id::text, 'ChangeInstaller', to_jsonb(v_wp), to_jsonb(v_wp_after), v_reason);

  if v_mode = 'Replace' then
    update public.allocations set active = false, cancellation_reason = v_reason
    where id = v_old.id returning * into v_old_after;
    v_cancel := app.s11_calendar_cancel(
      coalesce(v_old.calendar_link_id,
               (select c.id from public.calendar_links c where c.allocation_id = v_old.id and c.status <> 'Cancelled'
                order by c.created_at desc limit 1)),
      v_wp_after.revision);
    perform app.audit('Allocations', v_old.id::text, 'ReplaceInstaller', to_jsonb(v_old), to_jsonb(v_old_after), v_reason);
  end if;

  insert into public.allocations (work_package_id, person_id, role, start_at, end_at, active, replaced_allocation_id)
  values (v_wp.id, v_person,
          case when v_mode = 'Add' then coalesce(v_role, 'Second') else coalesce(v_role, v_old.role) end,
          v_old.start_at, v_old.end_at, true, case when v_mode = 'Replace' then v_old.id end)
  returning * into v_new;
  if v_new.start_at is not null and v_new.end_at is not null then
    v_cal := app.s11_calendar_capture(v_job, v_wp_after, v_new, 'NEW_INSTALLER');
    update public.allocations set calendar_link_id = (v_cal #>> '{link,id}')::uuid
    where id = v_new.id returning * into v_new;
  else
    -- The reference captured the calendar failure into the result instead of refusing.
    v_cal := jsonb_build_object('error', 'S11_DATE_INVALID: date value is required');
  end if;
  perform app.audit('Allocations', v_new.id::text, case when v_mode = 'Replace' then 'ReplaceInstaller' else 'AddInstaller' end,
                    to_jsonb(v_old), to_jsonb(v_new), v_reason);

  return jsonb_build_object('status', case when v_mode = 'Replace' then 'Replaced' else 'Added' end, 'created', true,
    'allocation', to_jsonb(v_new), 'old_allocation', case when v_old_after.id is not null then to_jsonb(v_old_after) else to_jsonb(v_old) end,
    'work_package', to_jsonb(v_wp_after), 'calendar', v_cal, 'calendar_cancel', v_cancel, 'external_calls', 0);
end
$$;
