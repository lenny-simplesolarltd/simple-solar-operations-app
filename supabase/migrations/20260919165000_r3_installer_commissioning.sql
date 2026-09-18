-- =============================================================================
-- Backend port, R3: installer mobile workflow (FN-06), commissioning review
-- (FN-07) and handover (FN-08).
--
-- Sources (reference D:\projets\simple-solar-operations):
--   installer/workflow.js            _iwStart, _iwProgress, _iwReportCompletion,
--                                    _iwReportProblem, _iwReportVariation,
--                                    _iwSaveCommissioningDraft, _iwSubmitCommissioning,
--                                    _iwMyWork
--   r1-appsheet/operations-contract.js  the R1C boundary: roles, FN-06/FN-07,
--                                    allocation rule (R1C_ASSIGNMENT_DENIED), office
--                                    reason (R1C_OFFICE_REASON_REQUIRED), payload
--                                    allow-lists, expected_version on the target
--                                    row, expected_submission_version for drafts,
--                                    approved questions/templates, append-only
--                                    commands consuming the package version,
--                                    installer-safe responses, COMMISSIONING_REVIEW,
--                                    INSTALLER_WORKFLOW read
--   s12/commissioning.js             one submission per package, answers never
--                                    overwritten once submitted, review
--                                    Accepted/Returned, evaluateHandover,
--                                    createHandover (HO-{job})
--
-- Commands (app.command_registry): IW_START, IW_PROGRESS, IW_REPORT_COMPLETION,
--   IW_REPORT_PROBLEM, IW_REPORT_VARIATION, IW_COMMISSIONING_DRAFT,
--   IW_COMMISSIONING_SUBMIT, COMMISSIONING_REVIEW, HANDOVER_CREATE.
-- Reads (app.read_registry): INSTALLER_WORKFLOW, INSTALLER_MY_WORK,
--   HANDOVER_READINESS.
--
-- Not ported: DEV sheet guards, pilot_job, CommitJournal Prepared/Recovery
-- (one transaction per command), request-row/upload-retry plumbing, name-based
-- owner lookup (owners come from task_assignment_rules / the single active
-- VariationApprover).
--
-- Commissioning content is BLOCKED - INPUT REQUIRED in the reference: no
-- templates or questions are seeded here. Templates/questions are configuration
-- (commissioning_templates / commissioning_questions, approved_by/approved_at);
-- until an approved active template exists for a trade, drafts carry
-- template_version 'NOT_CONFIGURED', answers are refused
-- (R1C_APPROVED_QUESTION_REQUIRED) and a review can only Return, never Accept
-- (R1C_APPROVED_TEMPLATE_REQUIRED).
--
-- Deviations (each also marked "-- Deviation:" where it applies):
--   * Evidence is one row per (job, stored file) (evidence_job_path_key,
--     140000): a file already linked to another commissioning submission cannot
--     get a second row for a superseding draft (reference EV-IW-...-{sub});
--     the installer must upload the file again. An unlinked row is linked.
--   * commissioning_submissions.allocation_id is NOT NULL: when office staff act
--     on a package the submission uses the installer's allocation (reference
--     wrote null); with no allocation at all the command is refused.
--   * Draft selection is explicit: with no open (Draft/Returned, not
--     superseded) submission a new draft is created, never a second superseding
--     copy of an older Returned row (the contract's own comment, :167).
--   * Handover readiness counts current (not superseded) submissions only; the
--     reference evaluateHandover counted superseded Returned rows, so a job with
--     any returned form could never become ready.
--   * INSTALLER_MY_WORK (_iwMyWork) is exposed as a read: installers cannot see
--     jobs/customers through RLS, so there is no "slice" equivalent. It is
--     gated on FN-06 (the reference read had no mode check). Its evidence count
--     covers evidence linked to the package's submissions/issues (evidence rows
--     carry no work package column).
--   * Installer uploads: storage insert policy for installers on the jobs of
--     packages they hold an active allocation on; every IW evidence path must be
--     under "<job id>/" (R1C_UPLOAD_PATH_INVALID).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Natural keys and immutability (ported tables, not canonical)
-- -----------------------------------------------------------------------------

-- Reference HO-{jobId}: one handover row per job.
create unique index handover_job_key on public.handover (job_id);

-- Answers belong to a Draft; once submitted they are never overwritten
-- (s12 submitAnswers; installer "submit is immutable").
create function app.s12_guard_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select s.status into v_status from public.commissioning_submissions s
  where s.id = coalesce(new.submission_id, old.submission_id);
  if tg_op = 'DELETE' or v_status is distinct from 'Draft'
     or (tg_op = 'UPDATE' and (new.submission_id <> old.submission_id or new.question_key <> old.question_key)) then
    raise exception 'S12_REVIEW: commissioning answers are immutable once submitted' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end
$$;
create trigger commissioning_answers_guard before insert or update or delete on public.commissioning_answers
  for each row execute function app.s12_guard_answer();

-- Submitted forms only move to review outcomes; Returned/Accepted are final.
create function app.s12_guard_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'S12_REVIEW: commissioning submissions are never deleted' using errcode = 'P0001';
  end if;
  if old.status in ('Accepted', 'Returned') then
    raise exception 'S12_REVIEW: reviewed submission is immutable' using errcode = 'P0001';
  end if;
  if old.status in ('Submitted', 'UnderReview') and new.status not in ('UnderReview', 'Accepted', 'Returned') then
    raise exception 'S12_REVIEW: submitted form is immutable' using errcode = 'P0001';
  end if;
  if old.status = 'Draft' and new.status not in ('Draft', 'Submitted') then
    raise exception 'S12_REVIEW: only a submitted form can be reviewed' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger commissioning_submissions_guard before update or delete on public.commissioning_submissions
  for each row execute function app.s12_guard_submission();

-- -----------------------------------------------------------------------------
-- R1C boundary helpers (operations-contract.js)
-- -----------------------------------------------------------------------------

-- Object with only the allowed keys (_r1cKeys) -> R1C_INVALID_FIELDS.
create function app.iw_keys(p_obj jsonb, p_allowed text[])
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then
    perform app.fail('R1C_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_obj) loop
    if not v_key = any (p_allowed) then
      perform app.fail('R1C_INVALID_FIELDS');
    end if;
  end loop;
  return p_obj;
end
$$;

-- _r1cVersion: integer >= 1 (a digit string is accepted).
create function app.iw_version(p_value jsonb)
returns int
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_value is not null and jsonb_typeof(p_value) = 'number' and (p_value #>> '{}') ~ '^[0-9]+$'
     and (p_value #>> '{}')::numeric between 1 and 2147483647 then
    return (p_value #>> '{}')::int;
  end if;
  if p_value is not null and jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[1-9][0-9]{0,8}$' then
    return (p_value #>> '{}')::int;
  end if;
  perform app.fail('R1C_EXPECTED_VERSION_REQUIRED');
end
$$;

-- Envelope + payload for an R1C command: only the contract's envelope keys,
-- a valid expected_version, and the command's payload allow-list.
create function app.iw_payload(p_request jsonb, p_allowed text[])
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
begin
  perform app.iw_keys(p_request, array['command_id', 'command_type', 'job_id', 'work_package_id', 'expected_version', 'payload']);
  perform app.iw_version(p_request -> 'expected_version');
  return app.iw_keys(coalesce(p_request -> 'payload', '{}'::jsonb), p_allowed);
end
$$;

-- _iwText
create function app.iw_text(p_value jsonb)
returns text
language sql immutable
set search_path = ''
as $$ select case when jsonb_typeof(p_value) = 'string' then nullif(btrim(p_value #>> '{}'), '') end $$;

-- _iwDate: 'YYYY-MM-DD' (optionally followed by a time) -> date; blank -> null.
create function app.iw_date(p_value jsonb)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text;
  v_m text[];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  v_text := btrim(p_value #>> '{}');
  if v_text = '' then
    return null;
  end if;
  v_m := regexp_match(v_text, '^([0-9]{4})-([0-9]{2})-([0-9]{2})');
  if v_m is null then
    perform app.fail('IW_DATE_INVALID');
  end if;
  begin
    return make_date(v_m[1]::int, v_m[2]::int, v_m[3]::int);
  exception when others then
    perform app.fail('IW_DATE_INVALID');
  end;
end
$$;

-- _r1cJob actionability: archived, cancelling/cancelled, or an open S15
-- reopen review -> R1C_JOB_NOT_ACTIONABLE.
create function app.iw_job_actionable(p_job public.jobs)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_job.id is not null and p_job.archived_at is null and p_job.cancellation_at is null
     and p_job.workflow_stage not in ('Cancelled', 'CancellationInProgress')
     and not exists (select 1 from public.tasks t where t.job_id = p_job.id and t.template_code = 'S15-REOPEN-REVIEW'
                     and t.status not in ('Complete', 'NotRequired'))
$$;

create function app.iw_allocated(p_work_package_id uuid, p_person_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.allocations a
                 where a.work_package_id = p_work_package_id and a.person_id = p_person_id and a.active)
$$;

-- _r1cOffice: Admin / Manager / Office.
create function app.iw_office(p_actor jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$ select app.has_role(p_actor, 'Admin', 'Manager', 'Office') $$;

-- _r1cAccess for work-package commands and reads: package exists (locked for
-- a command), job actionable, request job matches (commands), the actor holds
-- an active allocation or is office class, and office staff acting on an
-- installer package give a reason (commands). Review skips the allocation rule.
create function app.iw_package(p_request jsonb, p_actor jsonb, p_payload jsonb, p_mutate boolean, p_review boolean default false)
returns public.work_packages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wp public.work_packages;
  v_job public.jobs;
  v_wp_id uuid := app.ref(p_request, 'work_package_id');
  v_assigned boolean;
begin
  if p_mutate then
    select * into v_wp from public.work_packages where id = v_wp_id for update;
  else
    select * into v_wp from public.work_packages where id = v_wp_id;
  end if;
  if v_wp.id is null then
    perform app.fail('R1C_WORK_PACKAGE_NOT_FOUND');
  end if;
  select * into v_job from public.jobs where id = v_wp.job_id;
  if not app.iw_job_actionable(v_job) then
    perform app.fail('R1C_JOB_NOT_ACTIONABLE');
  end if;
  if p_mutate and app.ref(p_request, 'job_id') is distinct from v_job.id then
    perform app.fail('R1C_JOB_MISMATCH');
  end if;
  if not p_review then
    v_assigned := app.iw_allocated(v_wp.id, app.actor_id(p_actor));
    if not v_assigned and not app.iw_office(p_actor) then
      perform app.fail('R1C_ASSIGNMENT_DENIED');
    end if;
    if p_mutate and not v_assigned and app.iw_text(p_payload -> 'reason') is null then
      perform app.fail('R1C_OFFICE_REASON_REQUIRED');
    end if;
  end if;
  return v_wp;
end
$$;

-- The submission named in the payload, on this package and job (locked).
create function app.iw_submission(p_payload jsonb, p_wp public.work_packages)
returns public.commissioning_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := app.iw_text(p_payload -> 'submission_id');
  v_sub public.commissioning_submissions;
begin
  if v_id is not null and v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_sub from public.commissioning_submissions where id = v_id::uuid for update;
  end if;
  if v_sub.id is null or v_sub.work_package_id <> p_wp.id or v_sub.job_id <> p_wp.job_id then
    perform app.fail('R1C_SUBMISSION_MISMATCH');
  end if;
  return v_sub;
end
$$;

-- Append-only commands still consume the package version (contract :175).
create function app.iw_consume_version(p_wp_id uuid)
returns int
language sql
security definer
set search_path = ''
as $$ update public.work_packages set updated_at = now() where id = p_wp_id returning version $$;

-- The installer a command acts for (_iwReportCompletion :182 / draft :263):
-- the allocated actor, else (office acting) the Lead allocation's person when
-- p_lead_first, else the first active allocation's person, else the actor.
create function app.iw_installer(p_wp_id uuid, p_actor jsonb, p_lead_first boolean)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select case when app.iw_allocated(p_wp_id, app.actor_id(p_actor)) then app.actor_id(p_actor)
    else coalesce((select a.person_id from public.allocations a where a.work_package_id = p_wp_id and a.active
                   order by case when p_lead_first and a.role = 'Lead' then 0 else 1 end, a.created_at, a.id limit 1),
                  app.actor_id(p_actor)) end
$$;

-- -----------------------------------------------------------------------------
-- Evidence (_r1cEvidence + _iwEvidenceRows)
-- -----------------------------------------------------------------------------

-- Validates every evidence item before anything is written: array, keys
-- {storage_path, filename, mime_type}, a stored file under the job's folder,
-- never a file already linked to another job.
create function app.iw_validate_evidence(p_job_id uuid, p_payload jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items jsonb := p_payload -> 'evidence';
  v_item jsonb;
  v_path text;
begin
  if v_items is null or jsonb_typeof(v_items) = 'null' then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    perform app.fail('R1C_INVALID_EVIDENCE');
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    perform app.iw_keys(v_item, array['storage_path', 'filename', 'mime_type']);
    v_path := app.iw_text(v_item -> 'storage_path');
    if v_path is null then
      perform app.fail('R1C_EVIDENCE_FILE_REQUIRED');
    end if;
    if exists (select 1 from public.evidence e where e.storage_path = v_path and e.job_id <> p_job_id) then
      perform app.fail('R1C_CROSS_JOB_EVIDENCE');
    end if;
    -- Deviation: installer files live under "<job id>/" (integration.sql storage layout).
    if app.storage_job_id(v_path) is distinct from p_job_id then
      perform app.fail('R1C_UPLOAD_PATH_INVALID');
    end if;
  end loop;
  return v_items;
end
$$;

-- Creates or reuses the evidence rows; returns [{evidence_id, created}].
-- New rows get the category, submission and issue; an existing row is linked
-- to the submission only when it has none (see Deviation in the header).
create function app.iw_evidence(p_job_id uuid, p_items jsonb, p_category text,
                                p_submission_id uuid default null, p_issue_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_path text;
  v_row public.evidence;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_path := app.iw_text(v_item -> 'storage_path');
    select * into v_row from public.evidence e where e.job_id = p_job_id and e.storage_path = v_path;
    if v_row.id is null then
      v_id := app.ensure_evidence(p_job_id, p_category, v_path);
      update public.evidence set submission_id = p_submission_id, issue_id = p_issue_id,
                                 filename = coalesce(app.iw_text(v_item -> 'filename'), filename),
                                 mime_type = app.iw_text(v_item -> 'mime_type')
      where id = v_id;
      v_out := v_out || jsonb_build_array(jsonb_build_object('evidence_id', v_id, 'created', true));
    else
      if p_submission_id is not null and v_row.submission_id is distinct from p_submission_id then
        if v_row.submission_id is not null then
          -- Deviation: one evidence row per (job, file) - a returned version keeps its link.
          perform app.fail('IW_REVIEW: evidence file already linked to another submission; upload it again');
        end if;
        update public.evidence set submission_id = p_submission_id where id = v_row.id;
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('evidence_id', v_row.id, 'created', false));
    end if;
    v_row := null;
  end loop;
  return v_out;
end
$$;

-- -----------------------------------------------------------------------------
-- Issues and tasks raised by installers (_iwIssue / _iwTask)
-- -----------------------------------------------------------------------------

-- The installer module keeps its own issue shape (responsible installer,
-- linked return package, Pending variation approval, per-type tasks), so it
-- does not go through app.s10_create_issue (which always raises ISS01/ISS02
-- with approval NotRequired); the Opened event and audit follow the same form.
create function app.iw_create_issue(p_job_id uuid, p_wp_id uuid, p_type text, p_category text, p_description text,
                                    p_owner uuid, p_severity text, p_blocks boolean, p_due_at timestamptz,
                                    p_approval text, p_responsible uuid default null, p_return_wp uuid default null,
                                    p_reason text default null)
returns public.issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.issues;
begin
  insert into public.issues (job_id, work_package_id, type, category, description, raised_at, raised_by,
                             responsible_person_id, office_owner_id, severity, status, due_at,
                             blocks_completion, blocks_strip, approval_status, linked_return_package_id)
  values (p_job_id, p_wp_id, p_type, p_category, p_description, now(), app.context_actor_id(),
          p_responsible, p_owner, p_severity, 'Open', p_due_at, p_blocks, false, p_approval, p_return_wp)
  returning * into v_issue;
  insert into public.issue_events (issue_id, event_type, actor, occurred_at, note, previous_status, new_status)
  values (v_issue.id, 'Opened', app.context_actor_id(), now(), p_description, null, 'Open');
  perform app.audit('Issues', v_issue.id::text, 'Create', null, to_jsonb(v_issue), coalesce(p_reason, p_category));
  return v_issue;
end
$$;

-- Task with the reference title suffix; owner null = the template's
-- assignment rule. Returns {created, task_id, code, owner_id}.
create function app.iw_task(p_code text, p_job_id uuid, p_related_type text, p_related_id uuid, p_key text,
                            p_due_at timestamptz, p_owner uuid, p_suffix text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_id uuid;
  v_task public.tasks;
begin
  select t.title into v_title from public.task_templates t where t.code = p_code and t.active;
  if v_title is null then
    perform app.fail('IW_CONFIG: active ' || p_code || ' template required');
  end if;
  v_id := app.create_task_instance(p_job_id, p_code, p_key, p_owner, null, p_due_at, 1,
                                   v_title || coalesce(' — ' || p_suffix, ''), null, p_related_type, p_related_id,
                                   'Open', null, false, 'IW-1.0');
  select * into v_task from public.tasks where instance_key = p_key;
  return jsonb_build_object('created', v_id is not null, 'task_id', v_task.id, 'code', p_code, 'owner_id', v_task.owner_id);
end
$$;

-- 09:00 London on the next staffed day (_iwLondon(_iwNextStaffed(today))).
create function app.iw_next_staffed_0900()
returns timestamptz
language sql stable
set search_path = ''
as $$ select app.london_at(app.next_staffed_date(now()), '09:00') $$;

-- Installer-safe response (contract :178): no issue/package rows, no finance.
create function app.iw_safe(p_result jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'status', p_result -> 'status', 'outcome', p_result -> 'outcome', 'submission_id', p_result -> 'submission_id',
    'template_version', p_result -> 'template_version', 'evidence', p_result -> 'evidence',
    'return_allocation_id', p_result -> 'return_allocation_id', 'next', p_result -> 'next',
    'issue_id', p_result -> 'issue_id', 'return_package_id', p_result -> 'return_package_id',
    'commissioning_submission', p_result -> 'commissioning_submission'))
  || jsonb_build_object('replay', false, 'external_calls', 0, 'expected_version', p_result -> 'expected_version')
$$;

-- -----------------------------------------------------------------------------
-- IW_START (_iwStart)
-- -----------------------------------------------------------------------------

create function app.cmd_iw_start(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['reason']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true);
  v_after public.work_packages;
begin
  if v_wp.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  if v_wp.status not in ('Scheduled', 'InProgress', 'ReturnRequired') then
    perform app.fail('IW_REVIEW: cannot start from ' || v_wp.status);
  end if;
  update public.work_packages set status = 'InProgress', actual_start = coalesce(actual_start, app.london_date(now()))
  where id = v_wp.id returning * into v_after;
  perform app.audit('WorkPackages', v_wp.id::text, 'InstallerStart', to_jsonb(v_wp), to_jsonb(v_after), app.iw_text(v_p -> 'reason'));
  return app.iw_safe(jsonb_build_object('status', v_after.status, 'expected_version', v_after.version));
end
$$;

-- -----------------------------------------------------------------------------
-- IW_PROGRESS (_iwProgress)
-- -----------------------------------------------------------------------------

create function app.cmd_iw_progress(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['note', 'evidence', 'reason']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true);
  v_items jsonb;
  v_ev jsonb;
  v_note text := app.iw_text(v_p -> 'note');
begin
  if v_wp.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_items := app.iw_validate_evidence(v_wp.job_id, v_p);
  if v_note is null and jsonb_array_length(v_items) = 0 then
    perform app.fail('IW_REVIEW: note or evidence required');
  end if;
  if v_wp.status not in ('InProgress', 'Scheduled', 'ReturnRequired') then
    perform app.fail('IW_REVIEW: progress can only be reported on open work (status ' || v_wp.status || ')');
  end if;
  v_ev := app.iw_evidence(v_wp.job_id, v_items, 'Progress');
  perform app.audit('WorkPackages', v_wp.id::text, 'InstallerProgress', null,
                    jsonb_build_object('note', v_note, 'evidence', (select coalesce(jsonb_agg(e -> 'evidence_id'), '[]') from jsonb_array_elements(v_ev) e)),
                    coalesce(app.iw_text(v_p -> 'reason'), v_note));
  return app.iw_safe(jsonb_build_object('evidence', v_ev, 'expected_version', app.iw_consume_version(v_wp.id)));
end
$$;

-- -----------------------------------------------------------------------------
-- IW_REPORT_COMPLETION (_iwReportCompletion)
-- -----------------------------------------------------------------------------

create function app.cmd_iw_report_completion(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['outcome', 'actual_end', 'return_reason', 'evidence', 'reason']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true);
  v_after public.work_packages;
  v_ret public.work_packages;
  v_alloc public.allocations;
  v_issue public.issues;
  v_sub public.commissioning_submissions;
  v_items jsonb;
  v_ev jsonb;
  v_outcome text := app.iw_text(v_p -> 'outcome');
  v_end date;
  v_reason text := app.iw_text(v_p -> 'return_reason');
  v_installer uuid;
  v_alloc_id uuid;
  v_rem jsonb;
  v_bkg jsonb;
begin
  if v_wp.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_items := app.iw_validate_evidence(v_wp.job_id, v_p);
  if v_outcome is null or v_outcome not in ('Complete', 'ReturnRequired') then
    perform app.fail('IW_REVIEW: outcome must be Complete or ReturnRequired');
  end if;
  v_end := app.iw_date(v_p -> 'actual_end');
  if v_end is null then
    perform app.fail('IW_REVIEW: actual_end required');
  end if;
  if v_outcome = 'ReturnRequired' and v_reason is null then
    perform app.fail('IW_REVIEW: return_reason required');
  end if;
  if v_wp.status not in ('InProgress', 'Scheduled', 'ReturnRequired') then
    perform app.fail('IW_REVIEW: cannot report completion from ' || v_wp.status);
  end if;
  if v_end > app.london_date(now()) then
    perform app.fail('IW_REVIEW: actual_end cannot be in the future');
  end if;
  v_installer := app.iw_installer(v_wp.id, p_actor, true);

  if v_outcome = 'Complete' then
    -- Reporting never confirms: ConfirmedComplete comes from the S10 INS01 call.
    update public.work_packages set status = 'ReportedComplete', completion_outcome = 'Complete',
                                    actual_start = coalesce(actual_start, v_end), actual_end = v_end
    where id = v_wp.id returning * into v_after;
    v_ev := app.iw_evidence(v_wp.job_id, v_items, 'Completion');
    if v_wp.commissioning_required then
      -- One submission per package (CS-{wp}): reuse whatever exists.
      select * into v_sub from public.commissioning_submissions s where s.work_package_id = v_wp.id
      order by s.created_at, s.id limit 1;
      if v_sub.id is null then
        select a.id into v_alloc_id from public.allocations a
        where a.work_package_id = v_wp.id and a.person_id = v_installer and a.active order by a.created_at, a.id limit 1;
        if v_alloc_id is null then
          -- Deviation: allocation_id is NOT NULL (reference allowed null).
          perform app.fail('IW_REVIEW: commissioning installer allocation required');
        end if;
        insert into public.commissioning_submissions (job_id, work_package_id, allocation_id, installer_id, template_version, status)
        values (v_wp.job_id, v_wp.id, v_alloc_id, v_installer, 'NOT_CONFIGURED', 'Draft')
        returning * into v_sub;
        perform app.audit('CommissioningSubmissions', v_sub.id::text, 'DraftCreated', null, to_jsonb(v_sub), 'ReportedComplete');
      end if;
    end if;
    perform app.audit('WorkPackages', v_wp.id::text, 'InstallerReportedComplete', to_jsonb(v_wp), to_jsonb(v_after),
                      app.iw_text(v_p -> 'reason'));
    return app.iw_safe(jsonb_build_object(
      'status', v_after.status, 'outcome', v_outcome, 'evidence', v_ev, 'expected_version', v_after.version,
      'commissioning_submission', case when v_sub.id is null then null
                                       else jsonb_build_object('id', v_sub.id, 'status', v_sub.status) end,
      'next', 'Office confirmation call (INS01) is scheduled by S10 from the reported completion; '
              || case when v_sub.id is null then 'no commissioning required'
                      else 'commissioning form ' || v_sub.status || ' — submit within two working days' end));
  end if;

  -- ReturnRequired: remedial + linked same-trade return package; the original
  -- installer keeps responsibility through a dateless Lead allocation.
  update public.work_packages set status = 'ReturnRequired', completion_outcome = 'ReturnRequired',
                                  actual_start = coalesce(actual_start, v_end), actual_end = v_end
  where id = v_wp.id returning * into v_after;
  insert into public.work_packages (job_id, trade, required, status, commissioning_required, sequence, revision, parent_package_id)
  values (v_wp.job_id, v_wp.trade, true, 'Unscheduled', v_wp.commissioning_required,
          (select coalesce(max(w.sequence), 0) + 1 from public.work_packages w where w.job_id = v_wp.job_id), 1, v_wp.id)
  returning * into v_ret;
  perform app.audit('WorkPackages', v_ret.id::text, 'ReturnPackageCreated', null, to_jsonb(v_ret), v_reason);
  insert into public.allocations (work_package_id, person_id, role, active)
  values (v_ret.id, v_installer, 'Lead', true) returning * into v_alloc;
  perform app.audit('Allocations', v_alloc.id::text, 'Create', null, to_jsonb(v_alloc), v_reason);
  v_issue := app.iw_create_issue(v_wp.job_id, v_wp.id, 'Remedial', 'ReturnRequired', v_reason, app.rule_owner('REM01'),
                                 'Normal', true, app.iw_next_staffed_0900(), 'NotRequired', v_installer, v_ret.id, v_reason);
  v_ev := app.iw_evidence(v_wp.job_id, v_items, 'Return', null, v_issue.id);
  v_rem := app.iw_task('REM01', v_wp.job_id, 'Issues', v_issue.id, 'REM01-' || v_issue.id, v_issue.due_at, null,
                       v_wp.trade || ' return visit');
  v_bkg := app.iw_task('BKG02', v_wp.job_id, 'WorkPackages', v_ret.id, 'BKG02-' || v_ret.id, app.iw_next_staffed_0900(), null,
                       'customer date for return visit ' || v_ret.id);
  perform app.audit('WorkPackages', v_wp.id::text, 'InstallerReturnRequired', to_jsonb(v_wp), to_jsonb(v_after), v_reason);
  return app.iw_safe(jsonb_build_object(
    'status', v_after.status, 'outcome', v_outcome, 'evidence', v_ev, 'expected_version', v_after.version,
    'return_package_id', v_ret.id, 'return_allocation_id', v_alloc.id, 'issue_id', v_issue.id,
    'next', 'Remedial raised; the office books the return visit date (BKG02); original installer remains responsible; INS01 call scheduled by S10.'));
end
$$;

-- -----------------------------------------------------------------------------
-- IW_REPORT_PROBLEM (_iwReportProblem) / IW_REPORT_VARIATION (_iwReportVariation)
-- -----------------------------------------------------------------------------

create function app.cmd_iw_report_problem(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['category', 'description', 'evidence', 'reason']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true);
  v_items jsonb;
  v_category text := app.iw_text(v_p -> 'category');
  v_description text := app.iw_text(v_p -> 'description');
  v_issue public.issues;
  v_ev jsonb;
begin
  if v_wp.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_items := app.iw_validate_evidence(v_wp.job_id, v_p);
  if v_category is null or v_category not in ('Access', 'Damage', 'Technical', 'Safety', 'MaterialsShort', 'Other') then
    perform app.fail('IW_REVIEW: category must be one of Access/Damage/Technical/Safety/MaterialsShort/Other');
  end if;
  if v_description is null then
    perform app.fail('IW_REVIEW: description required');
  end if;
  -- The contract has no blocks_completion field: Safety/Technical block by default.
  v_issue := app.iw_create_issue(v_wp.job_id, v_wp.id, 'Remedial', v_category, v_description, app.rule_owner('ISS02'),
                                 case when v_category = 'Safety' then 'High' else 'Normal' end,
                                 v_category in ('Safety', 'Technical'), app.iw_next_staffed_0900(), 'NotRequired',
                                 null, null, coalesce(app.iw_text(v_p -> 'reason'), v_category));
  v_ev := app.iw_evidence(v_wp.job_id, v_items, 'Problem', null, v_issue.id);
  perform app.iw_task('ISS02', v_wp.job_id, 'Issues', v_issue.id, 'ISS02-' || v_issue.id, v_issue.due_at, null,
                      v_category || ' on ' || v_wp.trade);
  return app.iw_safe(jsonb_build_object('issue_id', v_issue.id, 'evidence', v_ev,
                                        'expected_version', app.iw_consume_version(v_wp.id)));
end
$$;

create function app.cmd_iw_report_variation(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['description', 'evidence', 'reason']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true);
  v_items jsonb;
  v_description text := app.iw_text(v_p -> 'description');
  v_approver uuid;
  v_today date := app.london_date(now());
  v_issue public.issues;
  v_ev jsonb;
begin
  if v_wp.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_items := app.iw_validate_evidence(v_wp.job_id, v_p);
  if v_description is null then
    perform app.fail('IW_REVIEW: description required');
  end if;
  -- Owner: the single active VariationApprover (S10 rule, never by name).
  v_approver := app.s10_variation_approver();
  v_issue := app.iw_create_issue(v_wp.job_id, v_wp.id, 'Variation', 'Variation', v_description, v_approver, 'Normal', false,
                                 app.london_at(case when app.is_staffed_day(v_today) then v_today
                                                    else app.next_staffed_date(now()) end, '17:00'),
                                 'Pending', null, null, coalesce(app.iw_text(v_p -> 'reason'), 'Variation'));
  v_ev := app.iw_evidence(v_wp.job_id, v_items, 'Variation', null, v_issue.id);
  perform app.iw_task('ISS01', v_wp.job_id, 'Issues', v_issue.id, 'ISS01-' || v_issue.id, v_issue.due_at, v_approver,
                      'installer-reported variation on ' || v_wp.trade);
  return app.iw_safe(jsonb_build_object('issue_id', v_issue.id, 'evidence', v_ev,
                                        'expected_version', app.iw_consume_version(v_wp.id)));
end
$$;

-- -----------------------------------------------------------------------------
-- Commissioning templates (configuration) and drafts
-- -----------------------------------------------------------------------------

-- _r1cApprovedTemplate: the active, approved template for the package's trade
-- (and the submission's version unless it is NOT_CONFIGURED); >1 ambiguous.
create function app.iw_approved_template(p_trade text, p_template_version text)
returns public.commissioning_templates
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_count int;
  v_t public.commissioning_templates;
begin
  select count(*) into v_count from public.commissioning_templates t
  where t.trade = p_trade and t.active and t.approved_at is not null and t.approved_by is not null
    and (p_template_version is null or p_template_version = 'NOT_CONFIGURED' or t.template_version = p_template_version);
  if v_count > 1 then
    perform app.fail('R1C_TEMPLATE_AMBIGUOUS');
  end if;
  select * into v_t from public.commissioning_templates t
  where t.trade = p_trade and t.active and t.approved_at is not null and t.approved_by is not null
    and (p_template_version is null or p_template_version = 'NOT_CONFIGURED' or t.template_version = p_template_version);
  return v_t;
end
$$;

create function app.cmd_iw_commissioning_draft(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['submission_id', 'expected_submission_version', 'answers', 'evidence', 'reason']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true);
  v_items jsonb;
  v_answers jsonb := v_p -> 'answers';
  v_answer jsonb;
  v_open public.commissioning_submissions;
  v_open_count int;
  v_sub public.commissioning_submissions;
  v_before public.commissioning_submissions;
  v_template public.commissioning_templates;
  v_template_version text;
  v_installer uuid;
  v_alloc_id uuid;
  v_created boolean := false;
  v_saved int := 0;
  v_ev jsonb;
begin
  if v_wp.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_items := app.iw_validate_evidence(v_wp.job_id, v_p);

  -- Explicit draft selection (contract :113-118): the open form is the
  -- Draft/Returned submission nobody supersedes.
  select count(*) into v_open_count from public.commissioning_submissions s
  where s.work_package_id = v_wp.id and s.status in ('Draft', 'Returned')
    and not exists (select 1 from public.commissioning_submissions x where x.supersedes_submission_id = s.id);
  if v_open_count > 1 then
    perform app.fail('R1C_AMBIGUOUS_SUBMISSION');
  end if;
  select * into v_open from public.commissioning_submissions s
  where s.work_package_id = v_wp.id and s.status in ('Draft', 'Returned')
    and not exists (select 1 from public.commissioning_submissions x where x.supersedes_submission_id = s.id)
  for update;
  if v_open.id is not null then
    if app.iw_text(v_p -> 'submission_id') is distinct from v_open.id::text then
      perform app.fail('R1C_STALE_SUBMISSION');
    end if;
    if app.iw_version(v_p -> 'expected_submission_version') <> v_open.version then
      perform app.fail('R1C_STALE_SUBMISSION');
    end if;
  elsif (v_p ? 'submission_id' and jsonb_typeof(v_p -> 'submission_id') <> 'null' and v_p ->> 'submission_id' <> '')
     or (v_p ? 'expected_submission_version' and jsonb_typeof(v_p -> 'expected_submission_version') <> 'null'
         and v_p ->> 'expected_submission_version' <> '') then
    perform app.fail('R1C_STALE_SUBMISSION');
  end if;

  -- Answers: only questions of the approved template, typed values.
  if v_answers is not null and jsonb_typeof(v_answers) <> 'null' and jsonb_typeof(v_answers) <> 'array' then
    perform app.fail('R1C_INVALID_ANSWERS');
  end if;
  v_answers := case when jsonb_typeof(v_answers) = 'array' then v_answers else '[]'::jsonb end;
  for v_answer in select * from jsonb_array_elements(v_answers) loop
    perform app.iw_keys(v_answer, array['question_key', 'value_text', 'value_number', 'value_date', 'value_boolean', 'not_applicable_reason']);
    v_template := app.iw_approved_template(v_wp.trade, v_open.template_version);
    if v_template.id is null or (select count(*) from public.commissioning_questions q
                                 where q.template_id = v_template.id and q.question_key = v_answer ->> 'question_key') <> 1 then
      perform app.fail('R1C_APPROVED_QUESTION_REQUIRED');
    end if;
    if (v_answer ? 'value_number' and jsonb_typeof(v_answer -> 'value_number') <> 'number')
       or (v_answer ? 'value_boolean' and jsonb_typeof(v_answer -> 'value_boolean') <> 'boolean')
       or (v_answer ? 'value_text' and jsonb_typeof(v_answer -> 'value_text') <> 'string') then
      perform app.fail('R1C_INVALID_ANSWER');
    end if;
    perform app.iw_date(v_answer -> 'value_date');
  end loop;
  -- The version a new draft is written against (contract :168-171).
  v_template := app.iw_approved_template(v_wp.trade, v_open.template_version);
  v_template_version := coalesce(v_template.template_version, 'NOT_CONFIGURED');

  if jsonb_array_length(v_answers) = 0 and jsonb_array_length(v_items) = 0 then
    perform app.fail('IW_REVIEW: answers or evidence required');
  end if;
  if exists (select 1 from public.commissioning_submissions s where s.work_package_id = v_wp.id and s.status = 'Accepted') then
    perform app.fail('IW_REVIEW: commissioning already accepted for this package');
  end if;

  v_sub := v_open;
  if v_sub.id is null then
    if exists (select 1 from public.commissioning_submissions s
               where s.work_package_id = v_wp.id and s.status in ('Submitted', 'UnderReview')) then
      perform app.fail('IW_REVIEW: a submission is awaiting review; wait for Returned or Accepted');
    end if;
    v_installer := app.iw_installer(v_wp.id, p_actor, false);
    select a.id into v_alloc_id from public.allocations a
    where a.work_package_id = v_wp.id and a.person_id = v_installer and a.active order by a.created_at, a.id limit 1;
    if v_alloc_id is null then
      -- Deviation: allocation_id is NOT NULL (reference allowed null for office).
      perform app.fail('IW_REVIEW: commissioning installer allocation required');
    end if;
    insert into public.commissioning_submissions (job_id, work_package_id, allocation_id, installer_id, template_version, status)
    values (v_wp.job_id, v_wp.id, v_alloc_id, v_installer, v_template_version, 'Draft')
    returning * into v_sub;
    v_created := true;
  elsif v_sub.status = 'Returned' then
    -- Returned forms are immutable: corrections go into a superseding draft.
    insert into public.commissioning_submissions (job_id, work_package_id, allocation_id, installer_id, template_version,
                                                  status, supersedes_submission_id)
    values (v_sub.job_id, v_sub.work_package_id, v_sub.allocation_id, v_sub.installer_id, v_sub.template_version,
            'Draft', v_sub.id)
    returning * into v_sub;
    v_created := true;
  end if;

  for v_answer in select * from jsonb_array_elements(v_answers) loop
    insert into public.commissioning_answers (submission_id, question_key, value_text, value_number, value_date,
                                              value_boolean, not_applicable_reason)
    values (v_sub.id, v_answer ->> 'question_key', v_answer ->> 'value_text', (v_answer ->> 'value_number')::numeric,
            app.iw_date(v_answer -> 'value_date'), (v_answer ->> 'value_boolean')::boolean,
            nullif(v_answer ->> 'not_applicable_reason', ''))
    on conflict (submission_id, question_key) do update set
      value_text = excluded.value_text, value_number = excluded.value_number, value_date = excluded.value_date,
      value_boolean = excluded.value_boolean, not_applicable_reason = excluded.not_applicable_reason;
    v_saved := v_saved + 1;
  end loop;
  v_ev := app.iw_evidence(v_wp.job_id, v_items, 'Commissioning', v_sub.id);

  if not v_created then
    v_before := v_sub;
    update public.commissioning_submissions
    set template_version = case when template_version = 'NOT_CONFIGURED' then v_template_version else template_version end
    where id = v_sub.id returning * into v_sub;
  end if;
  perform app.audit('CommissioningSubmissions', v_sub.id::text, case when v_created then 'DraftCreated' else 'DraftSaved' end,
                    case when v_created then null else to_jsonb(v_before) end,
                    jsonb_build_object('answers', v_saved, 'evidence', jsonb_array_length(v_ev)), app.iw_text(v_p -> 'reason'));
  return app.iw_safe(jsonb_build_object('submission_id', v_sub.id, 'status', 'Draft', 'template_version', v_sub.template_version,
                                        'evidence', v_ev, 'expected_version', app.iw_consume_version(v_wp.id)));
end
$$;

-- -----------------------------------------------------------------------------
-- IW_COMMISSIONING_SUBMIT (_iwSubmitCommissioning)
-- -----------------------------------------------------------------------------

create function app.cmd_iw_commissioning_submit(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['submission_id', 'reason']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true);
  v_sub public.commissioning_submissions := app.iw_submission(v_p, v_wp);
  v_after public.commissioning_submissions;
begin
  if v_sub.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  if v_sub.status <> 'Draft' then
    perform app.fail('IW_REVIEW: only a Draft can be submitted (status ' || v_sub.status || ')');
  end if;
  if not exists (select 1 from public.commissioning_answers a where a.submission_id = v_sub.id)
     and not exists (select 1 from public.evidence e where e.submission_id = v_sub.id) then
    perform app.fail('IW_REVIEW: nothing to submit (no answers or evidence)');
  end if;
  update public.commissioning_submissions set status = 'Submitted', submitted_at = now()
  where id = v_sub.id returning * into v_after;
  perform app.audit('CommissioningSubmissions', v_sub.id::text, 'Submitted', to_jsonb(v_sub), to_jsonb(v_after),
                    app.iw_text(v_p -> 'reason'));
  return app.iw_safe(jsonb_build_object('submission_id', v_sub.id, 'status', 'Submitted',
                                        'next', 'Office technical review (S12) — Accepted or Returned',
                                        'expected_version', v_after.version));
end
$$;

-- -----------------------------------------------------------------------------
-- COMMISSIONING_REVIEW (_r1cReviewSubmission + s12 reviewSubmission)
-- -----------------------------------------------------------------------------

create function app.cmd_commissioning_review(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.iw_payload(p_request, array['submission_id', 'status', 'review_notes']);
  v_wp public.work_packages := app.iw_package(p_request, p_actor, v_p, true, true);
  v_sub public.commissioning_submissions := app.iw_submission(v_p, v_wp);
  v_after public.commissioning_submissions;
  v_status text := app.iw_text(v_p -> 'status');
  v_notes text := app.iw_text(v_p -> 'review_notes');
begin
  if v_sub.version <> app.iw_version(p_request -> 'expected_version') then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  if v_sub.status not in ('Submitted', 'UnderReview') or v_status is null or v_status not in ('Accepted', 'Returned')
     or v_notes is null then
    perform app.fail('R1C_REVIEW_STATE_OR_NOTES');
  end if;
  -- Approval is a human technical decision against an approved template,
  -- never a fabricated rule.
  if v_status = 'Accepted' and (v_sub.template_version = 'NOT_CONFIGURED'
     or not exists (select 1 from public.commissioning_templates t
                    where t.template_version = v_sub.template_version and t.trade = v_wp.trade and t.active
                      and t.approved_by is not null and t.approved_at is not null)) then
    perform app.fail('R1C_APPROVED_TEMPLATE_REQUIRED');
  end if;
  update public.commissioning_submissions set status = v_status, reviewed_at = now(), reviewed_by = app.actor_id(p_actor),
                                              review_notes = v_notes
  where id = v_sub.id returning * into v_after;
  perform app.audit('CommissioningSubmissions', v_sub.id::text, 'Review' || v_status, to_jsonb(v_sub), to_jsonb(v_after), v_notes);
  return jsonb_build_object('ok', true, 'submission_id', v_sub.id, 'status', v_status, 'replay', false,
                            'expected_version', v_after.version, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Handover (s12 evaluateHandover / createHandover), FN-08
-- -----------------------------------------------------------------------------

create function app.s12_evaluate_handover(p_job_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_total int;
  v_accepted int;
  v_equipment int;
  v_issues text[] := '{}';
begin
  if not exists (select 1 from public.jobs j where j.id = p_job_id) then
    return jsonb_build_object('ready', false, 'reason', 'Job not found');
  end if;
  -- Deviation: superseded (Returned then corrected) submissions are history,
  -- not outstanding forms (reference counted every row).
  select count(*), count(*) filter (where s.status = 'Accepted') into v_total, v_accepted
  from public.commissioning_submissions s
  where s.job_id = p_job_id
    and not exists (select 1 from public.commissioning_submissions x where x.supersedes_submission_id = s.id);
  select count(*) into v_equipment from public.job_equipment e where e.job_id = p_job_id;
  if not (v_total > 0 and v_total = v_accepted) then
    v_issues := array_append(v_issues, 'Not all commissioning submissions accepted');
  end if;
  if v_equipment = 0 then
    v_issues := array_append(v_issues, 'No equipment recorded');
  end if;
  return jsonb_build_object('job_id', p_job_id, 'ready', cardinality(v_issues) = 0,
                            'submissions_count', v_total, 'submissions_accepted', v_accepted,
                            'equipment_count', v_equipment, 'issues', to_jsonb(v_issues),
                            'summary', case when cardinality(v_issues) = 0 then 'Ready' else 'NotReady' end);
end
$$;

-- createHandover: one row per job (HO-{job}), completeness Pending, S15
-- guarded; like the reference it does not require readiness (returned for
-- the caller to see).
create function app.cmd_handover_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_job public.jobs;
  v_ho public.handover;
  v_types text[];
begin
  if p_request ?| array['task_id', 'issue_id', 'work_package_id', 'old_allocation_id'] then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_p := app.payload(p_request, array['checklist_version', 'required_document_types'],
                     array['checklist_version', 'required_document_types']);
  if jsonb_typeof(v_p -> 'required_document_types') <> 'array'
     or exists (select 1 from jsonb_array_elements(v_p -> 'required_document_types') d
                where jsonb_typeof(d) <> 'string' or btrim(d #>> '{}') = '') then
    perform app.fail('S12_REVIEW: required_document_types must be a list of document types');
  end if;
  select coalesce(array_agg(btrim(d #>> '{}')), '{}') into v_types
  from jsonb_array_elements(v_p -> 'required_document_types') d;
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  perform app.assert_normal_work(v_job.id);
  select * into v_ho from public.handover h where h.job_id = v_job.id;
  if v_ho.id is not null then
    return jsonb_build_object('status', 'AlreadyExists', 'created', false, 'handover', to_jsonb(v_ho),
                              'readiness', app.s12_evaluate_handover(v_job.id), 'external_calls', 0);
  end if;
  insert into public.handover (job_id, checklist_version, required_document_types, completeness_status)
  values (v_job.id, app.txt(v_p, 'checklist_version'), v_types, 'Pending')
  returning * into v_ho;
  perform app.audit('Handover', v_ho.id::text, 'Create', null, to_jsonb(v_ho), app.txt(v_p, 'checklist_version'));
  return jsonb_build_object('status', 'Created', 'created', true, 'handover', to_jsonb(v_ho),
                            'readiness', app.s12_evaluate_handover(v_job.id), 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------

-- INSTALLER_WORKFLOW (_r1cRead): the package, its current submission, its
-- answers/evidence and the approved questions. No finance fields.
create function app.read_installer_workflow(p_request jsonb, p_actor jsonb)
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
                             and (v_sub.id is null or t.template_version = v_sub.template_version)), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'filename', e.filename,
                                                              'storage_path', e.storage_path, 'category', e.category)
                                           order by e.created_at, e.id)
                          from public.evidence e where e.submission_id = v_sub.id), '[]'::jsonb));
end
$$;

-- INSTALLER_MY_WORK (_iwMyWork): the actor's active allocations with site,
-- dates, status, version, commissioning state, open issues and own tasks.
-- Excludes finance, invoices and private issue notes.
create function app.read_installer_my_work(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_from date;
  v_to date;
  v_me uuid := app.actor_id(p_actor);
  v_items jsonb;
begin
  perform app.iw_keys(p_request, array['read_type', 'payload']);
  v_payload := app.iw_keys(coalesce(p_request -> 'payload', '{}'::jsonb), array['from', 'to']);
  v_from := app.iw_date(v_payload -> 'from');
  v_to := app.iw_date(v_payload -> 'to');
  select coalesce(jsonb_agg(x.item order by x.sort_key, x.item ->> 'work_package_id'), '[]'::jsonb) into v_items
  from (
    select coalesce(w.planned_start::text, '9999') as sort_key, jsonb_build_object(
      'allocation_id', a.id, 'role', a.role, 'work_package_id', w.id, 'trade', w.trade, 'status', w.status,
      'planned_start', w.planned_start, 'planned_end', w.planned_end, 'actual_start', w.actual_start,
      'actual_end', w.actual_end, 'completion_outcome', w.completion_outcome,
      'commissioning_required', w.commissioning_required, 'expected_version', w.version,
      'parent_package_id', w.parent_package_id,
      'job', jsonb_build_object('id', j.id, 'display_name', j.display_name, 'job_reference', j.job_ref,
                                'workflow_stage', j.workflow_stage),
      'site', jsonb_build_object('address_line1', c.address_line1, 'town', c.town, 'postcode', c.postcode, 'phone', c.phone),
      'commissioning', (select jsonb_build_object('submission_id', s.id, 'status', s.status, 'submitted_at', s.submitted_at,
                                                  'review_notes', case when s.status = 'Returned' then s.review_notes end)
                        from public.commissioning_submissions s where s.work_package_id = w.id
                        order by s.created_at desc, s.id desc limit 1),
      'evidence_count', (select count(*) from public.evidence e
                         where e.submission_id in (select s.id from public.commissioning_submissions s where s.work_package_id = w.id)
                            or e.issue_id in (select i.id from public.issues i where i.work_package_id = w.id)),
      'open_issues', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'type', i.type, 'category', i.category,
                                                                   'status', i.status, 'raised_by_me', i.raised_by = v_me)
                                                order by i.raised_at, i.id)
                               from public.issues i where i.work_package_id = w.id and i.status not in ('Resolved', 'Closed')), '[]'::jsonb),
      'my_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'template_code', t.template_code,
                                                                'title', t.title, 'due_at', t.due_at) order by t.due_at, t.id)
                            from public.tasks t where t.owner_id = v_me and t.related_entity_id = w.id
                              and t.status not in ('Complete', 'Cancelled', 'NotRequired')), '[]'::jsonb)) as item
    from public.allocations a
    join public.work_packages w on w.id = a.work_package_id
    join public.jobs j on j.id = w.job_id
    join public.customers c on c.id = j.customer_id
    where a.person_id = v_me and a.active and w.status <> 'Cancelled' and j.cancellation_at is null
      and not (v_from is not null and w.planned_end is not null and w.planned_end < v_from)
      and not (v_to is not null and w.planned_start is not null and w.planned_start > v_to)
  ) x;
  return jsonb_build_object('person_id', v_me,
                            'display_name', (select p.display_name from public.people p where p.id = v_me),
                            'count', jsonb_array_length(v_items), 'items', v_items,
                            'excluded', jsonb_build_array('finance', 'invoices', 'private issue notes'));
end
$$;

-- HANDOVER_READINESS: evaluateHandover for a job the office actor may access.
create function app.read_handover_readiness(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  perform app.iw_keys(p_request, array['read_type', 'job_id']);
  v_job_id := app.ref(p_request, 'job_id');
  if v_job_id is null or not exists (select 1 from public.jobs j where j.id = v_job_id) then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.is_assigned(p_actor, v_job_id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  return app.s12_evaluate_handover(v_job_id);
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('IW_START', array['Installer', 'Office', 'Manager', 'Admin'], false, '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', 'installer/workflow.js _iwStart via r1-appsheet/operations-contract.js; allocation checked in the handler'),
  ('IW_PROGRESS', array['Installer', 'Office', 'Manager', 'Admin'], false, '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', '_iwProgress; consumes the package version'),
  ('IW_REPORT_COMPLETION', array['Installer', 'Office', 'Manager', 'Admin'], false, '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', '_iwReportCompletion; Complete -> ReportedComplete (+ commissioning Draft), ReturnRequired -> remedial + return package'),
  ('IW_REPORT_PROBLEM', array['Installer', 'Office', 'Manager', 'Admin'], false, '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', '_iwReportProblem; Remedial issue + ISS02'),
  ('IW_REPORT_VARIATION', array['Installer', 'Office', 'Manager', 'Admin'], false, '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', '_iwReportVariation; Variation issue (Pending) + ISS01 for the VariationApprover'),
  ('IW_COMMISSIONING_DRAFT', array['Installer', 'Office', 'Manager', 'Admin'], false, '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', '_iwSaveCommissioningDraft; expected_submission_version for an open form'),
  ('IW_COMMISSIONING_SUBMIT', array['Installer', 'Office', 'Manager', 'Admin'], false, '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', '_iwSubmitCommissioning; expected_version is the submission version'),
  ('COMMISSIONING_REVIEW', array['Office', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-06","mode":"Automated"},{"function_id":"FN-07","mode":"Automated"}]',
   's12', 'operations-contract.js _r1cReviewSubmission + s12 reviewSubmission; Accepted needs an approved active template'),
  ('HANDOVER_CREATE', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-08","mode":"Automated"}]',
   's12', 's12 createHandover (HO-{job}); the command name is the port''s - the reference had no boundary command');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('INSTALLER_WORKFLOW', array['Installer', 'Office', 'Manager', 'Admin'], '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', 'operations-contract.js _r1cRead'),
  ('INSTALLER_MY_WORK', array['Installer', 'Office', 'Manager', 'Admin'], '[{"function_id":"FN-06","mode":"Automated"}]',
   'installer', 'installer/workflow.js _iwMyWork (runIwMyWork)'),
  ('HANDOVER_READINESS', array['Admin', 'Manager', 'Director', 'Office'], '[{"function_id":"FN-08","mode":"Automated"}]',
   's12', 's12 evaluateHandover');

-- -----------------------------------------------------------------------------
-- Installer evidence uploads (storage bucket "evidence", "<job id>/<file>")
-- -----------------------------------------------------------------------------

-- An active installer may upload files for the jobs of the live packages they
-- hold an active allocation on, while FN-06 is enabled. Office staff keep the
-- integration.sql policy.
create function app.installer_can_upload_job_file(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.current_person_id() is not null and app.is_active_actor()
     and app.mode_available('FN-06', 'Automated')
     and app.storage_job_id(p_name) is not null
     and exists (select 1 from public.allocations a join public.work_packages w on w.id = a.work_package_id
                 where a.person_id = app.current_person_id() and a.active and w.status <> 'Cancelled'
                   and w.job_id = app.storage_job_id(p_name))
$$;
grant execute on function app.installer_can_upload_job_file(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  execute $p$create policy evidence_installer_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'evidence' and app.installer_can_upload_job_file(name))$p$;
end
$$;
