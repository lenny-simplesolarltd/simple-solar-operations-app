-- =============================================================================
-- Bulk task operations: authorised override completion, and a batch command
-- queue that the Tasks UI, SimpleBot and any later interface share.
--
-- Nothing here is a second business-rule path. A batch is a durable list of
-- CHILD COMMANDS, each executed through the canonical
-- app.cmd_<type>(request, actor) handler behind the same authorization matrix
-- and the same public.commands idempotency ledger that
-- public.execute_command uses. The batch adds: a frozen target set, per-item
-- result/retry state, and visibility - never a shortcut past a rule.
--
-- Three things the audit of the existing schema settled, and which this
-- migration is built to preserve rather than re-decide:
--
--   1. Completion of a PRE task is a SYSTEM OF RECORD WRITE, not a status
--      flip: PRE01 stamps the deposit invoice stage, PRE02 the job contract,
--      PRE03 a manual_bank_checks row, PRE04 the job's verification fields.
--      So an override CANNOT mean "skip the checks and write the record
--      anyway". It means: stop requiring this TASK, write no business fact.
--      app.cmd_task_override_complete therefore performs no downstream write.
--
--   2. Booking readiness already gates on FACTS, not on task status
--      (app.evaluate_ready_to_book / app.task_satisfaction read
--      invoice_stages.sent_at, the signed contract evidence,
--      app.bank_confirmation_evidence, the job's verification columns). An
--      override-completed task therefore cannot advance a job, and this
--      migration must not add a path that lets it. app.job_override_debt
--      below makes that consequence VISIBLE instead of silent: the task has
--      left the queue, so the unsatisfied requirement has to surface on the
--      job.
--
--   3. Historical non-actionability was, for the task commands, an accident
--      of the import creating no tasks: app.assert_normal_work is called by
--      the booking / materials / scaffold / finance paths but NOT by
--      TASK_COMPLETE, TASK_REOPEN or TASK_REASSIGN. Section 3 closes that as
--      an invariant, narrowly (record_class only - assert_normal_work also
--      suppresses cancellation work, and S15 tasks are completed BY the
--      cancellation flow, so the full assertion would break them).
--
-- Deliberate deviations:
--   * public.outbox is NOT reused. It is an outbound external-effects queue:
--     it carries payload_hash but no payload, is gated on a LIVE/CAPTURE
--     setting per action type, and its rows mean "something must be told to
--     Xero / Google Calendar". Batch items are internal commands with
--     arguments and no external effect; borrowing the table would make both
--     meanings unreadable. The item protocol below reuses the outbox's proven
--     SHAPE (claim with skip-locked, attempt_count, backoff, stalled release,
--     NeedsReview) without reusing its table.
--   * Execution is driven synchronously in bounded chunks by the submitting
--     session (public.run_batch_chunk), with pg_cron only as recovery for
--     items left Pending / RetryDue / stalled. The cron sweep is therefore
--     infrequent (every 5 minutes, matching the stall threshold) and is never
--     the primary path.
--   * A background executor cannot have an auth.uid(). It re-derives the
--     actor from command_batches.actor_person_id through app.batch_actor,
--     which re-runs the SAME liveness checks as app.resolve_actor (person
--     exists, is active, holds at least one active role) at execution time,
--     and then passes that actor through the ordinary
--     app.authorize_command matrix. The queued payload never names its own
--     actor, role or permission, and no service-role capability is exposed to
--     a browser: public.run_batch_chunk refuses a caller who is not the
--     batch's own actor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissions
--
-- The existing catalogue has five permissions and no notion of acting outside
-- your own task list. Two are added; neither is granted to a role that cannot
-- already complete tasks (app.is_office is still required for every command).
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('task.complete.cross_owner',
   'Complete or reopen a task owned by another staff member. The task keeps its owner; the audit records who acted.'),
  ('task.override_complete',
   'Mark a task complete by administrative override, bypassing its overrideable completion requirements. Records no business fact.')
on conflict (code) do nothing;

-- Office covers the operational staff who run the Everyone queues; Director
-- and the admin classes are senior to them. Deliberately NOT granted to
-- Surveyor, Finance, Store, Installer, Scaffolder or ReadOnly.
insert into public.role_permissions (role_code, permission_code) values
  ('Admin',    'task.complete.cross_owner'), ('Admin',    'task.override_complete'),
  ('Manager',  'task.complete.cross_owner'), ('Manager',  'task.override_complete'),
  ('Director', 'task.complete.cross_owner'), ('Director', 'task.override_complete'),
  ('Office',   'task.complete.cross_owner'), ('Office',   'task.override_complete')
on conflict (role_code, permission_code) do nothing;

-- Permission checks below use the existing app.actor_has_permission(actor,
-- code) from the view-port reads, NOT app.has_permission(code): the latter
-- reads the current session's roles, and a background executor has no
-- session. The actor-explicit form is also what makes re-authorizing a queued
-- item as its recorded human actor possible at all.

-- -----------------------------------------------------------------------------
-- 2. How a completed task was completed
--
-- Section 7 of the brief prefers the existing audit tables to denormalising
-- tasks, and audit_events / task_events DO carry the whole story (actor
-- distinct from owner, before/after, command_id, reason). They are kept as
-- the authoritative record. These columns are added because the decision
-- taken with the owner requires the DISTINCTION to be visible wherever a task
-- is listed - the History list, the task screen, the processing centre and
-- SimpleBot - and reading audit_events per row to render a list is neither
-- cheap nor honest about what the list is showing. They are a projection of
-- the audit, written only by app.cmd_task_override_complete.
-- -----------------------------------------------------------------------------

alter table public.tasks
  add column completion_mode   text not null default 'normal'
                               check (completion_mode in ('normal', 'override')),
  add column override_actor_id uuid references public.people (id),
  add column override_reason   text,
  add column override_at       timestamptz,
  -- ["evidence", "completion_note", "ownership", "PRE03_deposit_bank_confirmed", ...]
  add column override_bypassed jsonb;

comment on column public.tasks.completion_mode is
  'normal = completed through the canonical path, so the task''s business facts were recorded. override = an authorised person stopped the task being required; NO business fact was recorded and the job''s readiness gates still report the requirement as unmet.';
comment on column public.tasks.override_reason is
  'Why the override was used. Never a substitute for completion_note, which stays null under override rather than being filled with a fabricated value.';

-- The four override columns travel together, and only on an override.
alter table public.tasks add constraint tasks_override_shape check (
  case when completion_mode = 'override'
       then override_actor_id is not null and nullif(btrim(override_reason), '') is not null
            and override_at is not null and status = 'Complete'
       else override_actor_id is null and override_reason is null
            and override_at is null and override_bypassed is null end);

-- A task that leaves Complete is no longer an override completion, so the
-- projection is cleared. The history is untouched: task_events keeps the
-- OverrideComplete row and audit_events keeps its before/after, which is what
-- "reopening must not erase previous completion history" protects. Done as a
-- trigger rather than by rewriting app.cmd_task_reopen, so EVERY path out of
-- Complete (reopen, cancellation, a future command) stays consistent with the
-- shape constraint above.
create function app.clear_override_on_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'Complete' and old.completion_mode = 'override' then
    new.completion_mode   := 'normal';
    new.override_actor_id := null;
    new.override_reason   := null;
    new.override_at       := null;
    new.override_bypassed := null;
  end if;
  return new;
end
$$;

-- Runs before tasks_stamp's version bump ordering is irrelevant here (both are
-- BEFORE row triggers on different columns); named to sort ahead of it.
create trigger a_tasks_clear_override before update on public.tasks
  for each row when (old.completion_mode = 'override' and new.status is distinct from 'Complete')
  execute function app.clear_override_on_reopen();

create index tasks_override_idx on public.tasks (job_id) where completion_mode = 'override';

-- -----------------------------------------------------------------------------
-- 3. Historical jobs are not actionable - as an invariant, for task commands
--
-- app.assert_normal_work is deliberately NOT used here: it also suppresses
-- work on a cancelling job, and S15 cancellation tasks are completed by that
-- very flow. Only the record_class rule belongs on the task commands.
-- -----------------------------------------------------------------------------

create function app.assert_live_job(p_job_id uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if p_job_id is not null and exists (
       select 1 from public.jobs j where j.id = p_job_id and j.record_class <> 'Live') then
    perform app.fail('HISTORICAL_IMPORT: this job is an imported historical record, not live work');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 3b. Cross-owner task commands
--
-- The R1 matrix admits only the task's owner, its backup, or an admin
-- (Admin/Manager). That is why "Everyone" is a read-only surface today: an
-- Office user cannot act on Ben's task at all, by any route. The new
-- permission has to be honoured by the SINGLE command path as well as the
-- batch, or the Tasks screen and the bulk bar would disagree about who may do
-- what - so the matrix itself is widened, in exactly one predicate.
--
-- The task's owner is NOT changed by this: only who may issue the command.
-- -----------------------------------------------------------------------------

create function app.task_actor_allowed(p_actor jsonb, p_task public.tasks)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.actor_id(p_actor) in (p_task.owner_id, coalesce(p_task.backup_id, p_task.owner_id))
     or app.is_admin(p_actor)
     or app.actor_has_permission(p_actor, 'task.complete.cross_owner')
$$;

-- The R1 matrix exactly as 20260919210000 applied it, with one change: the two
-- task-ownership tests call app.task_actor_allowed above.
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
    elsif not app.task_actor_allowed(p_actor, v_task) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    if not app.task_actor_allowed(p_actor, v_task) then
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
        -- Unchanged: recording a call is the call-taker's own act, and is not
        -- what the cross-owner permission is about.
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

-- The read model's task-action flags follow the same rule, so the screen does
-- not offer an action the command would refuse (or hide one it would allow).
-- Replaces the BASE: 20260919170000 renamed the original to
-- read_task_action_availability_base and wrapped it with
-- app.availability_for_reader, which adds `assigned` and tones the flags down
-- for a reader who is not on the job. That wrapper stays exactly as it is.
create or replace function app.read_task_action_availability_base(p_actor jsonb, p_task public.tasks)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_completable boolean := p_task.status in ('Open', 'Waiting', 'InProgress') and not p_task.revision_required;
  v_reopenable boolean := p_task.status in ('Complete', 'NotRequired');
  v_attachable boolean := p_task.template_code = 'PRE02'
    and ((p_task.status = 'Complete' and p_task.evidence_id is null)
         or (p_task.status in ('Open', 'Waiting', 'InProgress') and not p_task.revision_required));
  v_owner_ok boolean := app.task_actor_allowed(p_actor, p_task);
  v_job public.jobs;
begin
  if p_task.job_id is not null then
    select * into v_job from public.jobs where id = p_task.job_id;
  end if;
  return jsonb_build_object(
    'task_id', p_task.id, 'found', true, 'job_id', p_task.job_id, 'status', p_task.status, 'title', p_task.title,
    'template_code', p_task.template_code, 'version', p_task.version,
    'actions', jsonb_build_object(
      'complete', jsonb_build_object('available', v_completable, 'note', case when v_completable then null
        when p_task.status in ('Complete', 'NotRequired', 'Cancelled') then 'Already ' || p_task.status
        else 'Status ' || p_task.status || ' not completable' end),
      'reopen', jsonb_build_object('available', v_reopenable, 'note', case when v_reopenable then null
        else 'Status ' || p_task.status || ' not reopenable' end)),
    'commands', jsonb_build_object(
      'task_complete', app.s17_flag(v_completable and v_owner_ok, 'TASK_COMPLETE', 'Tasks',
                                    case when not v_completable then 'COMPLETE_NOT_AVAILABLE' else 'TASK_OWNER_OR_BACKUP_REQUIRED' end),
      'task_reopen', app.s17_flag(v_reopenable and v_owner_ok, 'TASK_REOPEN', 'Tasks',
                                  case when not v_reopenable then 'REOPEN_NOT_AVAILABLE' else 'TASK_OWNER_OR_BACKUP_REQUIRED' end),
      'task_evidence_attach', app.s17_flag(v_attachable and v_owner_ok, 'TASK_EVIDENCE_ATTACH', 'Tasks',
                                           case when not v_attachable then 'ATTACH_NOT_AVAILABLE' else 'TASK_OWNER_OR_BACKUP_REQUIRED' end),
      'start_job_booking', app.s17_booking_launch(v_job, p_task, app.mode_available('FN-01', 'Automated'), v_owner_ok)));
end
$$;

-- Every command routes through app.authorize_command (registered types) or
-- falls through to app.authorize_command_r1. Adding the class check to the
-- dispatcher covers TASK_COMPLETE, TASK_REOPEN, TASK_EVIDENCE_ATTACH,
-- TASK_REASSIGN, the new override/batch types and every registered command in
-- one place, before any handler runs.
create or replace function app.authorize_command(p_type text, p_request jsonb, p_actor jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg app.command_registry;
  v_job uuid := app.ref(p_request, 'job_id');
begin
  -- A historical record accepts no command, whether addressed by job or by
  -- one of its tasks. (An imported job has no tasks today; this makes that
  -- an invariant rather than a property of the importer.)
  perform app.assert_live_job(v_job);
  if app.ref(p_request, 'task_id') is not null then
    perform app.assert_live_job((select t.job_id from public.tasks t where t.id = app.ref(p_request, 'task_id')));
  end if;

  select * into v_reg from app.command_registry where command_type = p_type;
  if not found then
    perform app.authorize_command_r1(p_type, p_request, p_actor);
    return;
  end if;
  if not app.has_role(p_actor, variadic v_reg.roles) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  if v_reg.job_scoped then
    perform app.authorize_job(p_actor, v_job);
  end if;
  perform app.require_modes(v_reg.modes);
end
$$;

-- -----------------------------------------------------------------------------
-- 4. The completion requirement policy - ONE place, not `if (override)`
--
-- Every rule that stands between a task and Complete is classified here, once,
-- and every caller reads this: the batch preflight, the override command, the
-- bulk bar's summary and SimpleBot. Kinds:
--
--   hard         never bypassable by any override (section 34 of the brief)
--   normal       a business fact the task exists to record. NOT bypassable by
--                supplying a fake value; an override completes the task
--                WITHOUT the fact, and the job stays gated.
--   overrideable bypassable by an authorised override
--
-- Returned per requirement: {code, kind, satisfied, detail}.
-- -----------------------------------------------------------------------------

-- The structured business facts each template's normal completion records.
-- Anything not listed needs only a completion note.
create function app.task_business_requirements(p_code text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case p_code
    when 'PRE01' then '[{"code": "invoice_number", "detail": "Deposit invoice number"},
                        {"code": "invoice_sent", "detail": "Confirmation the invoice was sent"}]'::jsonb
    when 'PRE02' then '[{"code": "contract_id", "detail": "Contract reference"},
                        {"code": "contract_signed", "detail": "Signed status"},
                        {"code": "contract_evidence", "detail": "Signed contract file"}]'::jsonb
    when 'PRE03' then '[{"code": "deposit_bank_confirmed", "detail": "Bank check outcome"},
                        {"code": "deposit_amount", "detail": "Amount received"},
                        {"code": "deposit_received_date", "detail": "Date received"},
                        {"code": "deposit_bank_reference", "detail": "Bank reference"}]'::jsonb
    when 'PRE04' then '[{"code": "customer_details_verified", "detail": "Customer details checked"},
                        {"code": "sold_value_verified", "detail": "Sold value checked"},
                        {"code": "verified_gross_amount", "detail": "Verified gross amount"}]'::jsonb
    when 'PRE05' then '[{"code": "finance_agreement_evidence", "detail": "Provider / agreement evidence"}]'::jsonb
    else '[]'::jsonb end
$$;

-- S15 cancellation work is resolved on the job's Operations tab and
-- TASK_COMPLETE always refuses it; INS01 / INS04 are completed by recording
-- the call (CALL_RECORD). Neither belongs in a completion batch, under any
-- mode - they are not "requirements to bypass", they are the wrong command.
create function app.task_completed_elsewhere(p_task public.tasks)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_task.task_group = 'Cancellation' or p_task.template_code like 'S15-%'
      then 'CANCELLATION_TASK'
    when p_task.template_code in ('INS01', 'INS04')
      then 'CALL_TASK'
    end
$$;

create function app.task_completion_requirements(p_task public.tasks, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_req jsonb := '[]'::jsonb;
  v_owner_ok boolean;
  v_business jsonb;
  v_item jsonb;
  v_live boolean;
begin
  v_live := not exists (select 1 from public.jobs j where j.id = p_task.job_id and j.record_class <> 'Live');
  v_owner_ok := app.actor_id(p_actor) in (p_task.owner_id, coalesce(p_task.backup_id, p_task.owner_id))
                or app.is_admin(p_actor);

  -- ---- hard -----------------------------------------------------------------
  v_req := v_req || jsonb_build_object('code', 'live_job', 'kind', 'hard', 'satisfied', v_live,
    'detail', 'An imported historical record is never actionable');
  v_req := v_req || jsonb_build_object('code', 'not_completed_elsewhere', 'kind', 'hard',
    'satisfied', app.task_completed_elsewhere(p_task) is null,
    'detail', case app.task_completed_elsewhere(p_task)
                when 'CANCELLATION_TASK' then 'Cancellation work is resolved on the job''s Operations tab'
                when 'CALL_TASK' then 'A call task is completed by recording the call'
                else 'Completed by this command' end);
  v_req := v_req || jsonb_build_object('code', 'revision_not_required', 'kind', 'hard',
    'satisfied', not p_task.revision_required,
    'detail', 'A task awaiting revision must be revised first');
  v_req := v_req || jsonb_build_object('code', 'status_completable', 'kind', 'hard',
    'satisfied', p_task.status in ('Open', 'Waiting', 'InProgress'),
    'detail', 'Status ' || p_task.status ||
              case when p_task.status = 'Complete' then ' - already complete (a batch treats this as done)' else '' end);

  -- ---- overrideable ---------------------------------------------------------
  v_req := v_req || jsonb_build_object('code', 'ownership', 'kind', 'overrideable', 'satisfied', v_owner_ok,
    'detail', 'Owned by someone else; needs task.complete.cross_owner',
    'permission', 'task.complete.cross_owner',
    'permitted', app.actor_has_permission(p_actor, 'task.complete.cross_owner'));
  -- completion_note is required by app.payload in the normal path. A batch
  -- supplies one; an override does not fabricate one.
  v_req := v_req || jsonb_build_object('code', 'completion_note', 'kind', 'overrideable', 'satisfied', true,
    'detail', 'A completion note is recorded by normal completion');

  -- ---- normal (business facts) ----------------------------------------------
  v_business := app.task_business_requirements(p_task.template_code);
  for v_item in select * from jsonb_array_elements(v_business) loop
    v_req := v_req || (v_item || jsonb_build_object('kind', 'normal', 'satisfied', false,
      'detail', (v_item ->> 'detail') || ' - only the task screen can record this'));
  end loop;

  return v_req;
end
$$;

-- What a batch would do to one task, under one mode. The single preflight
-- primitive: the bulk bar's summary, the override modal's "requirements being
-- bypassed", SimpleBot's preflight and the enqueue itself all read this.
--
-- outcome:
--   ready            the batch can do it
--   already_complete idempotent no-op (counts as done, never re-executed)
--   needs_information a normal business fact only the task screen can record
--   not_permitted    the actor lacks ownership/permission for this mode
--   not_actionable   a hard requirement fails
create function app.task_completion_plan(p_task public.tasks, p_actor jsonb, p_mode text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_req jsonb := app.task_completion_requirements(p_task, p_actor);
  v_item jsonb;
  v_outcome text := 'ready';
  v_bypassed jsonb := '[]'::jsonb;
  v_blocking jsonb := '[]'::jsonb;
begin
  for v_item in select * from jsonb_array_elements(v_req) loop
    if (v_item ->> 'satisfied')::boolean then
      continue;
    end if;
    -- "already complete" is idempotent, not a failure (section 14).
    if v_item ->> 'code' = 'status_completable' and p_task.status = 'Complete' then
      v_outcome := 'already_complete';
      continue;
    end if;
    if v_item ->> 'kind' = 'hard' then
      v_outcome := 'not_actionable';
      v_blocking := v_blocking || v_item;
    elsif v_item ->> 'kind' = 'overrideable' then
      if p_mode = 'override' and coalesce((v_item ->> 'permitted')::boolean, true) then
        v_bypassed := v_bypassed || v_item;
      elsif coalesce((v_item ->> 'permitted')::boolean, false) then
        -- Permitted without an override (cross-owner normal completion).
        v_bypassed := v_bypassed || v_item;
      else
        if v_outcome not in ('not_actionable') then v_outcome := 'not_permitted'; end if;
        v_blocking := v_blocking || v_item;
      end if;
    else -- normal: a business fact
      if p_mode = 'override' then
        v_bypassed := v_bypassed || v_item;
      else
        if v_outcome not in ('not_actionable', 'not_permitted') then v_outcome := 'needs_information'; end if;
        v_blocking := v_blocking || v_item;
      end if;
    end if;
  end loop;

  if p_mode = 'override' and v_outcome = 'ready'
     and not app.actor_has_permission(p_actor, 'task.override_complete') then
    v_outcome := 'not_permitted';
    v_blocking := v_blocking || jsonb_build_object('code', 'override_permission', 'kind', 'hard',
      'satisfied', false, 'detail', 'Needs task.override_complete');
  end if;

  return jsonb_build_object(
    'task_id', p_task.id, 'template_code', p_task.template_code, 'title', p_task.title,
    'job_id', p_task.job_id, 'status', p_task.status, 'version', p_task.version,
    'owner_id', p_task.owner_id, 'owner_name', app.s17_person_name(p_task.owner_id),
    'mode', p_mode, 'outcome', v_outcome,
    'bypassed', v_bypassed, 'blocking', v_blocking, 'requirements', v_req);
end
$$;

-- -----------------------------------------------------------------------------
-- 5. TASK_OVERRIDE_COMPLETE
--
-- A separate command rather than a flag on TASK_COMPLETE, so the canonical
-- completion path is not touched at all and no `if (override) skip...` ever
-- enters it. It writes the task and the audit, and NOTHING else: no invoice
-- stage, no bank check, no job verification column, no evidence row.
-- -----------------------------------------------------------------------------

create function app.cmd_task_override_complete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['override_reason', 'override_category'], array['override_reason']);
  v_task public.tasks;
  v_after public.tasks;
  v_plan jsonb;
  v_reason text := app.txt(v_p, 'override_reason');
  v_readiness jsonb;
begin
  if length(coalesce(v_reason, '')) < 3 then
    perform app.fail('R1A_REQUIRED_OVERRIDE_REASON');
  end if;
  select * into v_task from public.tasks where id = app.ref(p_request, 'task_id') for update;
  if v_task.id is null then
    perform app.fail('R1A_TASK_NOT_FOUND');
  end if;
  if not app.actor_has_permission(p_actor, 'task.override_complete') then
    perform app.fail('TASK_OVERRIDE_DENIED');
  end if;

  -- Already complete: idempotent, whatever the mode it was completed in.
  if v_task.status = 'Complete' then
    return jsonb_build_object('status', 'AlreadyComplete', 'task', to_jsonb(v_task), 'external_calls', 0);
  end if;
  if v_task.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;

  v_plan := app.task_completion_plan(v_task, p_actor, 'override');
  if v_plan ->> 'outcome' = 'not_actionable' then
    perform app.fail('R1A_TASK_NOT_COMPLETABLE', v_plan -> 'blocking');
  end if;
  if v_plan ->> 'outcome' = 'not_permitted' then
    perform app.fail('R1A_TASK_ACCESS_DENIED', v_plan -> 'blocking');
  end if;

  -- The task leaves the queue. completion_note stays NULL: the override
  -- reason is the truth, and a fabricated note would read as recorded work.
  update public.tasks set
    status = 'Complete', completed_at = now(), completed_by = app.actor_id(p_actor),
    completion_note = null, blocking_reason = null,
    completion_mode = 'override', override_actor_id = app.actor_id(p_actor),
    override_reason = v_reason, override_at = now(),
    override_bypassed = v_plan -> 'bypassed'
  where id = v_task.id returning * into v_after;

  perform app.task_event(v_task, v_after, 'OverrideComplete', v_reason);
  perform app.audit('Tasks', v_task.id::text, 'OverrideComplete', to_jsonb(v_task), to_jsonb(v_after), v_reason);

  -- Safe to call: the readiness gates read business facts, so this can only
  -- DEMOTE a job or leave it where it is. It can never promote on an override.
  if v_task.job_id is not null and v_task.template_code in ('PRE01', 'PRE02', 'PRE03', 'PRE04', 'PRE05') then
    v_readiness := app.reevaluate_prebooking(v_task.job_id);
  end if;

  return jsonb_build_object(
    'status', 'OverrideCompleted', 'task', to_jsonb(v_after),
    'bypassed', v_plan -> 'bypassed', 'override_reason', v_reason,
    'job', (select to_jsonb(j) from public.jobs j where j.id = v_task.job_id),
    'readiness', v_readiness -> 'readiness', 'external_calls', 0);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('TASK_OVERRIDE_COMPLETE', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], false,
   '[{"function_id": "FN-01", "mode": "Automated"}]', 'command-batches',
   'Administrative override: marks a task complete without recording its business facts. Needs task.override_complete; cross-owner needs task.complete.cross_owner. Job readiness is unaffected by design.');

-- -----------------------------------------------------------------------------
-- 6. Override debt: what an override left unsatisfied, per job
--
-- An override-completed task disappears from Open, so the requirement it
-- stopped asking for has to remain visible on the job. This is the read the
-- job / booking surfaces and SimpleBot use to answer "why is this job still
-- gated when the task is done?".
-- -----------------------------------------------------------------------------

create function app.job_override_debt(p_job_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', t.id, 'template_code', t.template_code, 'title', t.title,
           'override_at', t.override_at, 'override_reason', t.override_reason,
           'override_by', app.s17_person_name(t.override_actor_id),
           'owner_name', app.s17_person_name(t.owner_id),
           'unrecorded', coalesce((select jsonb_agg(b -> 'detail')
                                   from jsonb_array_elements(app.task_business_requirements(t.template_code)) b),
                                  '[]'::jsonb))
           order by t.override_at desc), '[]'::jsonb)
  from public.tasks t
  where t.job_id = p_job_id and t.completion_mode = 'override' and t.status = 'Complete'
$$;

-- -----------------------------------------------------------------------------
-- 7. Batch tables
--
-- A batch is one operation over a FROZEN set of tasks. The target set is
-- resolved to explicit ids at preflight (section 40): a task created after
-- submission is never touched, and the count confirmed by the person is the
-- count executed.
-- -----------------------------------------------------------------------------

create table public.command_batches (
  id               uuid primary key default gen_random_uuid(),
  -- The submitting command's command_id: re-submitting the same batch is the
  -- ordinary commands-ledger replay, never a second batch.
  command_id       uuid not null unique,
  operation        text not null check (operation in
                     ('TASK_BATCH_COMPLETE', 'TASK_BATCH_OVERRIDE_COMPLETE',
                      'TASK_BATCH_REOPEN', 'TASK_BATCH_REASSIGN')),
  actor_person_id  uuid not null references public.people (id),
  -- Where the request came from. The ACTOR is the human in every case.
  source           text not null default 'ui' check (source in ('ui', 'simplebot', 'system')),
  -- Shared arguments: completion_note / override_reason / reopen_reason /
  -- owner_id + backup_id. Validated at submit, replayed per item.
  payload          jsonb not null default '{}'::jsonb,
  -- What the person asked for, kept for the record. Never re-resolved.
  selector         jsonb,
  status           text not null default 'Queued'
                   check (status in ('Queued', 'Processing', 'Completed', 'CompletedWithErrors', 'Cancelled')),
  total            integer not null default 0 check (total >= 0),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
comment on table public.command_batches is
  'One bulk operation over a frozen set of tasks. Each child item executes the canonical command for its type.';
create index command_batches_actor_idx on public.command_batches (actor_person_id, created_at desc);
create index command_batches_open_idx on public.command_batches (created_at) where status in ('Queued', 'Processing');

create table public.command_batch_items (
  id               uuid primary key default gen_random_uuid(),
  batch_id         uuid not null references public.command_batches (id) on delete restrict,
  task_id          uuid not null references public.tasks (id) on delete restrict,
  sequence         integer not null,
  -- Frozen at enqueue and used as the child command's command_id, so a retry
  -- (worker, refresh, duplicate click, SimpleBot) is answered by the existing
  -- commands ledger instead of acting twice.
  command_id       uuid not null unique,
  command_type     text not null,
  -- The task version seen at preflight (section 41).
  expected_version integer,
  status           text not null default 'Pending'
                   check (status in ('Pending', 'Processing', 'Succeeded', 'RetryDue',
                                     'NeedsReview', 'Failed', 'Cancelled', 'Skipped')),
  attempt_count    integer not null default 0 check (attempt_count >= 0),
  next_attempt     timestamptz,
  claimed_at       timestamptz,
  -- Why it is not Pending any more.
  outcome          jsonb,
  error_code       text,
  error_detail     text,
  -- Set at enqueue when preflight already knew this item could not run.
  preflight        jsonb,
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,
  unique (batch_id, task_id)
);
comment on table public.command_batch_items is
  'One child command of a batch. command_id is frozen at enqueue: every execution attempt is idempotent through public.commands.';
create index command_batch_items_batch_idx on public.command_batch_items (batch_id, sequence);
create index command_batch_items_due_idx on public.command_batch_items (next_attempt)
  where status in ('Pending', 'RetryDue');
create index command_batch_items_claimed_idx on public.command_batch_items (claimed_at) where status = 'Processing';

-- Retry policy, matching the outbox's proven shape.
create function app.batch_max_attempts() returns int
language sql immutable set search_path = '' as $$ select 5 $$;
create function app.batch_backoff_minutes() returns int[]
language sql immutable set search_path = '' as $$ select array[1, 2, 4, 8, 16] $$;
create function app.batch_stalled_minutes() returns int
language sql immutable set search_path = '' as $$ select 5 $$;

-- Rolled-up counts. Derived, never stored: a count column and a set of item
-- rows that disagree is the kind of thing nobody notices until it matters.
create function app.batch_progress(p_batch_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', count(*),
    'succeeded', count(*) filter (where status = 'Succeeded'),
    'failed', count(*) filter (where status = 'Failed'),
    'needs_review', count(*) filter (where status = 'NeedsReview'),
    'retrying', count(*) filter (where status = 'RetryDue'),
    'processing', count(*) filter (where status = 'Processing'),
    'pending', count(*) filter (where status = 'Pending'),
    'cancelled', count(*) filter (where status = 'Cancelled'),
    'skipped', count(*) filter (where status = 'Skipped'),
    'settled', count(*) filter (where status not in ('Pending', 'Processing', 'RetryDue')))
  from public.command_batch_items where batch_id = p_batch_id
$$;

-- Moves the batch to a terminal status once nothing is left to run.
create function app.batch_settle(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.batch_progress(p_batch_id);
  v_status text;
begin
  if (v_p ->> 'pending')::int > 0 or (v_p ->> 'processing')::int > 0 or (v_p ->> 'retrying')::int > 0 then
    return v_p;
  end if;
  v_status := case when (v_p ->> 'failed')::int > 0 or (v_p ->> 'needs_review')::int > 0
                   then 'CompletedWithErrors' else 'Completed' end;
  update public.command_batches
     set status = v_status, finished_at = coalesce(finished_at, now())
   where id = p_batch_id and status in ('Queued', 'Processing');
  return v_p;
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Submitting a batch
--
-- Goes through public.execute_command like everything else, so the submission
-- itself is authorized, fingerprinted and idempotent. It writes the batch and
-- its frozen items and RETURNS: nothing is executed here.
-- -----------------------------------------------------------------------------

-- The child command type each batch operation runs per task.
create function app.batch_child_type(p_operation text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_operation
    when 'TASK_BATCH_COMPLETE' then 'TASK_COMPLETE'
    when 'TASK_BATCH_OVERRIDE_COMPLETE' then 'TASK_OVERRIDE_COMPLETE'
    when 'TASK_BATCH_REOPEN' then 'TASK_REOPEN'
    when 'TASK_BATCH_REASSIGN' then 'TASK_REASSIGN' end
$$;

-- What one item's request envelope looks like. Built from the batch, never
-- from anything a caller (or a model) sends at execution time.
create function app.batch_item_request(p_batch public.command_batches, p_item public.command_batch_items)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'command_id', p_item.command_id,
    'command_type', p_item.command_type,
    'task_id', p_item.task_id,
    'job_id', (select t.job_id from public.tasks t where t.id = p_item.task_id),
    'expected_version', p_item.expected_version,
    'payload', case p_batch.operation
      when 'TASK_BATCH_COMPLETE' then
        jsonb_build_object('completion_note', p_batch.payload ->> 'completion_note')
      when 'TASK_BATCH_OVERRIDE_COMPLETE' then
        jsonb_build_object('override_reason', p_batch.payload ->> 'override_reason')
        || coalesce(case when p_batch.payload ? 'override_category'
                    then jsonb_build_object('override_category', p_batch.payload ->> 'override_category') end, '{}'::jsonb)
      when 'TASK_BATCH_REOPEN' then
        jsonb_build_object('reopen_reason', p_batch.payload ->> 'reopen_reason')
      when 'TASK_BATCH_REASSIGN' then
        jsonb_build_object('owner_id', p_batch.payload ->> 'owner_id', 'reason', p_batch.payload ->> 'reason')
        || coalesce(case when p_batch.payload ? 'backup_id'
                    then jsonb_build_object('backup_id', p_batch.payload ->> 'backup_id') end, '{}'::jsonb)
      end))
$$;

-- The plan for one task under a batch operation: which outcome, and can the
-- item be enqueued as runnable?
create function app.batch_task_plan(p_operation text, p_task public.tasks, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_owner_ok boolean := app.actor_id(p_actor) in (p_task.owner_id, coalesce(p_task.backup_id, p_task.owner_id))
                        or app.is_admin(p_actor);
  v_cross boolean := app.actor_has_permission(p_actor, 'task.complete.cross_owner');
  v_live boolean := not exists (select 1 from public.jobs j where j.id = p_task.job_id and j.record_class <> 'Live');
  v_base jsonb := jsonb_build_object(
    'task_id', p_task.id, 'template_code', p_task.template_code, 'title', p_task.title,
    'job_id', p_task.job_id, 'status', p_task.status, 'version', p_task.version,
    'owner_id', p_task.owner_id, 'owner_name', app.s17_person_name(p_task.owner_id),
    'bypassed', '[]'::jsonb, 'blocking', '[]'::jsonb);
begin
  if p_operation in ('TASK_BATCH_COMPLETE', 'TASK_BATCH_OVERRIDE_COMPLETE') then
    return app.task_completion_plan(p_task, p_actor,
      case when p_operation = 'TASK_BATCH_OVERRIDE_COMPLETE' then 'override' else 'normal' end);
  end if;

  if not v_live then
    return v_base || jsonb_build_object('outcome', 'not_actionable',
      'blocking', jsonb_build_array(jsonb_build_object('code', 'live_job', 'kind', 'hard', 'satisfied', false,
        'detail', 'An imported historical record is never actionable')));
  end if;
  if not (v_owner_ok or v_cross) then
    return v_base || jsonb_build_object('outcome', 'not_permitted',
      'blocking', jsonb_build_array(jsonb_build_object('code', 'ownership', 'kind', 'overrideable', 'satisfied', false,
        'detail', 'Owned by someone else; needs task.complete.cross_owner')));
  end if;

  if p_operation = 'TASK_BATCH_REOPEN' then
    if p_task.status in ('Open', 'Waiting', 'InProgress', 'Blocked') then
      return v_base || jsonb_build_object('outcome', 'already_open');
    end if;
    if p_task.status not in ('Complete', 'NotRequired') then
      return v_base || jsonb_build_object('outcome', 'not_actionable',
        'blocking', jsonb_build_array(jsonb_build_object('code', 'status_reopenable', 'kind', 'hard',
          'satisfied', false, 'detail', 'Status ' || p_task.status || ' is not reopenable')));
    end if;
    return v_base || jsonb_build_object('outcome', 'ready');
  end if;

  -- TASK_BATCH_REASSIGN
  if p_task.status in ('Complete', 'NotRequired', 'Cancelled') then
    return v_base || jsonb_build_object('outcome', 'not_actionable',
      'blocking', jsonb_build_array(jsonb_build_object('code', 'status_open', 'kind', 'hard', 'satisfied', false,
        'detail', 'Only an open task can be reassigned')));
  end if;
  return v_base || jsonb_build_object('outcome', 'ready');
end
$$;

-- Resolve a selector to task ids under the actor's own visibility, ordered
-- stably. The selector vocabulary is app.read_tasks' (scope / status / due /
-- queue / owner_id / job_id / q) plus code_prefix, which the Tasks UI and
-- SimpleBot both need ("all PRE tasks for this job").
create function app.resolve_task_selector(p_selector jsonb, p_actor jsonb, p_limit int default 500)
returns uuid[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_read jsonb;
  v_prefix text := nullif(btrim(coalesce(p_selector ->> 'code_prefix', '')), '');
  v_ids uuid[];
begin
  -- The read model is the authority on what this actor may see; it raises
  -- R1A_ROLE_DENIED / R1A_JOB_ACCESS_DENIED exactly as the Tasks page does.
  v_read := app.read_tasks(
    (p_selector - 'code_prefix') || jsonb_build_object('limit', p_limit), p_actor);
  select coalesce(array_agg((t ->> 'id')::uuid order by t ->> 'id'), '{}')
  into v_ids
  from jsonb_array_elements(v_read -> 'tasks') t
  where v_prefix is null or upper(t ->> 'template_code') like upper(v_prefix) || '%';
  return v_ids;
end
$$;

create function app.cmd_task_batch_submit(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['operation', 'task_ids', 'selector', 'completion_note', 'override_reason', 'override_category',
          'reopen_reason', 'owner_id', 'backup_id', 'reason', 'source'],
    array['operation']);
  v_op text := app.txt(v_p, 'operation');
  v_source text := coalesce(app.txt(v_p, 'source'), 'ui');
  v_child text;
  v_ids uuid[];
  v_batch public.command_batches;
  v_task public.tasks;
  v_plan jsonb;
  v_plans jsonb := '[]'::jsonb;
  v_id uuid;
  v_seq int := 0;
  v_queued int := 0;
  v_shared jsonb := '{}'::jsonb;
begin
  v_child := app.batch_child_type(v_op);
  if v_child is null then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'operation'));
  end if;
  if v_source not in ('ui', 'simplebot', 'system') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'source'));
  end if;

  -- ---- shared arguments, validated once at submit ---------------------------
  if v_op = 'TASK_BATCH_COMPLETE' then
    if app.txt(v_p, 'completion_note') is null then
      perform app.fail('R1A_REQUIRED_COMPLETION_NOTE');
    end if;
    v_shared := jsonb_build_object('completion_note', app.txt(v_p, 'completion_note'));
  elsif v_op = 'TASK_BATCH_OVERRIDE_COMPLETE' then
    if length(coalesce(app.txt(v_p, 'override_reason'), '')) < 3 then
      perform app.fail('R1A_REQUIRED_OVERRIDE_REASON');
    end if;
    if not app.actor_has_permission(p_actor, 'task.override_complete') then
      perform app.fail('TASK_OVERRIDE_DENIED');
    end if;
    v_shared := jsonb_build_object('override_reason', app.txt(v_p, 'override_reason'));
    if app.txt(v_p, 'override_category') is not null then
      v_shared := v_shared || jsonb_build_object('override_category', app.txt(v_p, 'override_category'));
    end if;
  elsif v_op = 'TASK_BATCH_REOPEN' then
    if length(coalesce(app.txt(v_p, 'reopen_reason'), '')) < 3 then
      perform app.fail('R1A_REQUIRED_REOPEN_REASON');
    end if;
    v_shared := jsonb_build_object('reopen_reason', app.txt(v_p, 'reopen_reason'));
  else -- TASK_BATCH_REASSIGN
    if app.ref(v_p, 'owner_id') is null then
      perform app.fail('R1A_REQUIRED_OWNER_ID');
    end if;
    if length(coalesce(app.txt(v_p, 'reason'), '')) < 3 then
      perform app.fail('R1A_REQUIRED_REASON');
    end if;
    v_shared := jsonb_build_object('owner_id', app.ref(v_p, 'owner_id')::text, 'reason', app.txt(v_p, 'reason'));
    if app.ref(v_p, 'backup_id') is not null then
      v_shared := v_shared || jsonb_build_object('backup_id', app.ref(v_p, 'backup_id')::text);
    end if;
  end if;

  -- ---- the target set, frozen here ------------------------------------------
  if v_p ? 'task_ids' then
    if jsonb_typeof(v_p -> 'task_ids') <> 'array' then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'task_ids'));
    end if;
    select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}') into v_ids
    from jsonb_array_elements(v_p -> 'task_ids') e;
  elsif v_p ? 'selector' then
    v_ids := app.resolve_task_selector(v_p -> 'selector', p_actor);
  else
    perform app.fail('R1A_REQUIRED_TASK_IDS');
  end if;

  if coalesce(cardinality(v_ids), 0) = 0 then
    perform app.fail('BATCH_EMPTY_SELECTION');
  end if;
  if cardinality(v_ids) > 500 then
    perform app.fail('BATCH_TOO_LARGE', jsonb_build_object('count', cardinality(v_ids), 'max', 500));
  end if;

  insert into public.command_batches (command_id, operation, actor_person_id, source, payload, selector, total)
  values ((app.context_command_id())::uuid, v_op, app.actor_id(p_actor), v_source, v_shared,
          v_p -> 'selector', cardinality(v_ids))
  returning * into v_batch;

  -- ---- one item per task, classified now ------------------------------------
  foreach v_id in array v_ids loop
    v_seq := v_seq + 1;
    select * into v_task from public.tasks where id = v_id;
    if v_task.id is null then
      insert into public.command_batch_items (batch_id, task_id, sequence, command_id, command_type,
                                              status, error_code, error_detail, settled_at)
      values (v_batch.id, v_id, v_seq, gen_random_uuid(), v_child, 'Failed',
              'R1A_TASK_NOT_FOUND', 'The task no longer exists', now());
      continue;
    end if;

    v_plan := app.batch_task_plan(v_op, v_task, p_actor);
    v_plans := v_plans || v_plan;

    insert into public.command_batch_items (
      batch_id, task_id, sequence, command_id, command_type, expected_version,
      status, preflight, error_code, error_detail, settled_at)
    values (
      v_batch.id, v_id, v_seq, gen_random_uuid(), v_child, v_task.version,
      case v_plan ->> 'outcome'
        when 'ready' then 'Pending'
        when 'already_complete' then 'Skipped'
        when 'already_open' then 'Skipped'
        when 'not_permitted' then 'Failed'
        when 'not_actionable' then 'Failed'
        else 'Failed' end,
      v_plan,
      case when v_plan ->> 'outcome' <> 'ready'
           then coalesce(v_plan #>> '{blocking,0,code}', v_plan ->> 'outcome') end,
      case when v_plan ->> 'outcome' <> 'ready'
           then coalesce(v_plan #>> '{blocking,0,detail}',
                         case v_plan ->> 'outcome'
                           when 'already_complete' then 'Already complete'
                           when 'already_open' then 'Already open'
                           when 'needs_information' then 'Needs information only the task screen can record'
                           else v_plan ->> 'outcome' end) end,
      case when v_plan ->> 'outcome' <> 'ready' then now() end);

    if v_plan ->> 'outcome' = 'ready' then
      v_queued := v_queued + 1;
    end if;
  end loop;

  perform app.batch_settle(v_batch.id);
  perform app.audit('CommandBatches', v_batch.id::text, 'Submitted', null,
                    to_jsonb(v_batch) || jsonb_build_object('queued', v_queued), v_shared ->> 'reason');

  return jsonb_build_object(
    'status', case when v_queued > 0 then 'Queued' else 'NothingToDo' end,
    'batch_id', v_batch.id, 'operation', v_op, 'queued', v_queued,
    'progress', app.batch_progress(v_batch.id),
    'items', v_plans, 'external_calls', 0);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('TASK_BATCH_SUBMIT', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], false,
   '[{"function_id": "FN-01", "mode": "Automated"}]', 'command-batches',
   'Creates a batch over a frozen set of tasks and enqueues one child command per task. Executes nothing; per-item authorization is re-checked at execution.');

-- -----------------------------------------------------------------------------
-- 9. Executing a batch
--
-- Each item runs the canonical handler behind the canonical authorization,
-- with the actor re-derived from the batch and re-checked for liveness. The
-- commands ledger row is written exactly as public.execute_command writes it,
-- so an item and a hand-submitted command of the same id are the same fact.
-- -----------------------------------------------------------------------------

-- The batch's actor, re-checked now. Same failure codes and same rules as
-- app.resolve_actor - the person may have been deactivated or lost their roles
-- since the batch was submitted, and then the remaining items must not run.
create function app.batch_actor(p_person_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_person public.people;
  v_roles text[];
begin
  select * into v_person from public.people p where p.id = p_person_id;
  if not found then
    perform app.fail('R1A_UNKNOWN_OR_DUPLICATE_ACTOR');
  end if;
  if not v_person.active then
    perform app.fail('R1A_INACTIVE_ACTOR');
  end if;
  select coalesce(array_agg(distinct pr.role_code order by pr.role_code), '{}') into v_roles
  from public.person_roles pr join public.roles r on r.code = pr.role_code and r.active
  where pr.person_id = v_person.id and pr.active;
  if cardinality(v_roles) = 0 then
    perform app.fail('R1A_NO_ACTIVE_ROLE');
  end if;
  return jsonb_build_object('id', v_person.id, 'email', v_person.email, 'roles', to_jsonb(v_roles));
end
$$;

-- How a raised error is treated. Transient errors retry; a conflict is not
-- overwritten; a rule refusal is never retried in a loop.
create function app.batch_error_class(p_sqlstate text, p_message text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    -- Deadlock, serialization failure, lock not available: safe to retry.
    when p_sqlstate in ('40001', '40P01', '55P03') then 'RetryDue'
    -- Connection / resource problems.
    when p_sqlstate like '08%' or p_sqlstate = '53300' or p_sqlstate = '57014' then 'RetryDue'
    when p_sqlstate <> 'P0001' then 'NeedsReview'
    -- Business refusals (app.fail).
    when p_message like 'R1A_STALE_VERSION%' then 'NeedsReview'
    when p_message like 'R1A_COMMAND_CONFLICT%' then 'NeedsReview'
    when p_message like 'R1A_ROLE_DENIED%' or p_message like '%ACCESS_DENIED%'
      or p_message like 'TASK_OVERRIDE_DENIED%' or p_message like 'R1A_MODE_%'
      or p_message like 'HISTORICAL_IMPORT%' or p_message like 'R1A_TASK_NOT_FOUND%'
      or p_message like 'R1A_TASK_NOT_COMPLETABLE%' or p_message like 'R1A_TASK_NOT_REOPENABLE%'
      or p_message like 'R1A_INACTIVE_ACTOR%' or p_message like 'R1A_NO_ACTIVE_ROLE%'
      or p_message like 'R1A_UNKNOWN_OR_DUPLICATE_ACTOR%' or p_message like 'TASK_NOT_OPEN%'
      or p_message like 'TASK_OWNER_NOT_ELIGIBLE%' or p_message like 'R1A_REQUIRED_%'
      then 'Failed'
    else 'NeedsReview' end
$$;

-- Runs one claimed item. Raises nothing: the outcome is written to the item.
create function app.batch_run_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.command_batch_items;
  v_batch public.command_batches;
  v_actor jsonb;
  v_request jsonb;
  v_task public.tasks;
  v_prior public.commands;
  v_fingerprint text;
  v_result jsonb;
  v_status text;
  v_next timestamptz;
  v_backoff int[];
  v_sqlstate text;
  v_message text;
begin
  select * into v_item from public.command_batch_items where id = p_item_id;
  select * into v_batch from public.command_batches where id = v_item.batch_id;

  begin
    -- Re-derive and re-check the human actor. Never auth.uid(), never a
    -- payload-supplied identity.
    v_actor := app.batch_actor(v_batch.actor_person_id);
    v_request := app.batch_item_request(v_batch, v_item);

    perform set_config('app.actor_id', v_batch.actor_person_id::text, true);
    perform set_config('app.command_id', v_item.command_id::text, true);
    perform set_config('app.executing_service',
                       'batch:' || v_batch.source || ':' || v_item.command_type, true);

    -- Idempotency: the item's command_id may already be in the ledger (a
    -- retry after a lost result). Same content -> the stored result, no write.
    select * into v_prior from public.commands where command_id = v_item.command_id;
    if found then
      v_result := v_prior.result;
    else
      -- Current authorization always applies, exactly as on the direct path.
      perform app.authorize_command(v_item.command_type, v_request, v_actor);

      -- A target that has already reached the wanted state is a no-op, not a
      -- stale-version failure (sections 13/14/41).
      select * into v_task from public.tasks where id = v_item.task_id for update;
      if v_task.id is null then
        perform app.fail('R1A_TASK_NOT_FOUND');
      end if;
      if v_item.command_type in ('TASK_COMPLETE', 'TASK_OVERRIDE_COMPLETE')
         and v_task.status = 'Complete' then
        update public.command_batch_items
           set status = 'Succeeded', settled_at = now(), claimed_at = null,
               outcome = jsonb_build_object('status', 'AlreadyComplete', 'idempotent', true)
         where id = v_item.id;
        return jsonb_build_object('item_id', v_item.id, 'status', 'Succeeded', 'idempotent', true);
      end if;
      if v_item.command_type = 'TASK_REOPEN'
         and v_task.status in ('Open', 'Waiting', 'InProgress') then
        update public.command_batch_items
           set status = 'Succeeded', settled_at = now(), claimed_at = null,
               outcome = jsonb_build_object('status', 'AlreadyOpen', 'idempotent', true)
         where id = v_item.id;
        return jsonb_build_object('item_id', v_item.id, 'status', 'Succeeded', 'idempotent', true);
      end if;
      -- Someone else moved the row since preflight: do not overwrite.
      if v_task.version <> v_item.expected_version then
        perform app.fail('R1A_STALE_VERSION');
      end if;

      execute format('select app.%I($1, $2)', 'cmd_' || lower(v_item.command_type))
        into v_result using v_request, v_actor;

      v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
        'type', v_item.command_type, 'actor', v_batch.actor_person_id,
        'request', v_request - 'command_id')::text, 'UTF8')), 'hex');
      insert into public.commands (command_id, command_type, actor_person_id, fingerprint, result)
      values (v_item.command_id, v_item.command_type, v_batch.actor_person_id, v_fingerprint, v_result)
      on conflict (command_id) do nothing;
    end if;

    update public.command_batch_items
       set status = 'Succeeded', settled_at = now(), claimed_at = null, outcome = v_result
     where id = v_item.id;
    return jsonb_build_object('item_id', v_item.id, 'status', 'Succeeded');

  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_status := app.batch_error_class(v_sqlstate, v_message);
    v_backoff := app.batch_backoff_minutes();
    if v_status = 'RetryDue' then
      if v_item.attempt_count + 1 >= app.batch_max_attempts() then
        v_status := 'NeedsReview';
      else
        v_next := now() + make_interval(mins =>
          v_backoff[least(v_item.attempt_count + 1, cardinality(v_backoff))]);
      end if;
    end if;
    update public.command_batch_items
       set status = v_status,
           attempt_count = v_item.attempt_count + 1,
           next_attempt = v_next,
           claimed_at = null,
           error_code = v_message,
           error_detail = v_sqlstate,
           settled_at = case when v_status in ('Failed', 'NeedsReview') then now() end
     where id = v_item.id;
    return jsonb_build_object('item_id', v_item.id, 'status', v_status, 'error', v_message);
  end;
end
$$;

-- Claims and runs up to p_limit due items of one batch. Each item commits with
-- the surrounding transaction; nothing holds a transaction open across the
-- whole batch (section 45).
create function app.batch_run_chunk(p_batch_id uuid, p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_ids uuid[];
  v_id uuid;
  v_ran jsonb := '[]'::jsonb;
begin
  update public.command_batches
     set status = 'Processing', started_at = coalesce(started_at, now())
   where id = p_batch_id and status = 'Queued';

  -- Claim in one statement, so a concurrent caller (the session and the
  -- recovery sweep at the same moment) can never take the same item: the rows
  -- this call locked are exactly the rows it runs.
  with due as (
    select i.id from public.command_batch_items i
    where i.batch_id = p_batch_id
      and i.status in ('Pending', 'RetryDue')
      and (i.next_attempt is null or i.next_attempt <= now())
    order by i.sequence
    limit v_limit
    for update skip locked),
  claimed as (
    update public.command_batch_items i
       set status = 'Processing', claimed_at = now()
      from due where i.id = due.id
    returning i.id)
  select coalesce(array_agg(id), '{}') into v_ids from claimed;

  foreach v_id in array v_ids loop
    v_ran := v_ran || app.batch_run_item(v_id);
  end loop;

  return jsonb_build_object('batch_id', p_batch_id, 'ran', jsonb_array_length(v_ran),
                            'items', v_ran, 'progress', app.batch_settle(p_batch_id));
end
$$;

-- The session-driven entry point: the submitting person's own browser drives
-- the batch in chunks straight after submitting it. A caller may only drive a
-- batch they themselves submitted - this is not a way to run someone else's
-- work, and it exposes no service-role capability.
create function public.run_batch_chunk(p_batch_id uuid, p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_batch public.command_batches;
begin
  select * into v_batch from public.command_batches where id = p_batch_id;
  if not found then
    perform app.fail('BATCH_NOT_FOUND');
  end if;
  if v_batch.actor_person_id <> app.actor_id(v_actor) then
    perform app.fail('BATCH_ACCESS_DENIED');
  end if;
  if v_batch.status in ('Completed', 'CompletedWithErrors', 'Cancelled') then
    return jsonb_build_object('batch_id', p_batch_id, 'ran', 0,
                              'items', '[]'::jsonb, 'progress', app.batch_progress(p_batch_id));
  end if;
  return app.batch_run_chunk(p_batch_id, p_limit);
end
$$;

-- -----------------------------------------------------------------------------
-- 10. Recovery only
--
-- Releases items whose worker died mid-flight, and picks up anything the
-- submitting session never finished (tab closed, transport lost). It is not
-- the primary path: the session normally settles a batch within seconds, and
-- this runs every 5 minutes, matching the stall threshold.
-- -----------------------------------------------------------------------------

create function app.batch_release_stalled(p_minutes int default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int := coalesce(p_minutes, app.batch_stalled_minutes());
  v_count int;
begin
  with stalled as (
    select i.id from public.command_batch_items i
    where i.status = 'Processing'
      and coalesce(i.claimed_at, i.created_at) <= now() - make_interval(mins => v_min)
    for update skip locked)
  update public.command_batch_items i
     set status = 'RetryDue', claimed_at = null, next_attempt = now(),
         error_code = coalesce(i.error_code, 'BATCH_STALLED'),
         error_detail = 'Processing for more than ' || v_min || ' minutes; released for retry'
    from stalled where i.id = stalled.id;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

create function app.run_batch_recovery(p_batches int default 20, p_limit int default 25)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released int := app.batch_release_stalled();
  v_batch uuid;
  v_done jsonb := '[]'::jsonb;
begin
  for v_batch in
    select distinct b.id from public.command_batches b
    join public.command_batch_items i on i.batch_id = b.id
    where b.status in ('Queued', 'Processing')
      and i.status in ('Pending', 'RetryDue')
      and (i.next_attempt is null or i.next_attempt <= now())
    order by b.id
    limit greatest(coalesce(p_batches, 20), 1)
  loop
    v_done := v_done || app.batch_run_chunk(v_batch, p_limit);
  end loop;
  -- Batches whose items all settled but whose header never caught up.
  update public.command_batches b set status = case
      when exists (select 1 from public.command_batch_items i where i.batch_id = b.id
                   and i.status in ('Failed', 'NeedsReview')) then 'CompletedWithErrors'
      else 'Completed' end,
    finished_at = coalesce(b.finished_at, now())
  where b.status in ('Queued', 'Processing')
    and not exists (select 1 from public.command_batch_items i where i.batch_id = b.id
                    and i.status in ('Pending', 'Processing', 'RetryDue'));
  return jsonb_build_object('released', v_released, 'batches', jsonb_array_length(v_done), 'ran', v_done);
end
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ss-batch-recovery', '*/5 * * * *', 'select app.run_batch_recovery()');
  end if;
exception when others then
  raise notice 'pg_cron not available: batch recovery must be scheduled by hand';
end
$$;

-- -----------------------------------------------------------------------------
-- 11. Retry and cancel
-- -----------------------------------------------------------------------------

-- Re-queues items a person may safely retry. A permanent refusal (role,
-- access, historical, invariant) is NEVER re-queued: retrying it is a loop.
create function app.cmd_batch_retry(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['batch_id', 'item_ids'], array['batch_id']);
  v_batch public.command_batches;
  v_count int;
begin
  select * into v_batch from public.command_batches where id = app.ref(v_p, 'batch_id') for update;
  if not found then
    perform app.fail('BATCH_NOT_FOUND');
  end if;
  if v_batch.actor_person_id <> app.actor_id(p_actor) and not app.is_admin(p_actor) then
    perform app.fail('BATCH_ACCESS_DENIED');
  end if;

  update public.command_batch_items i
     set status = 'Pending', next_attempt = now(), attempt_count = 0,
         claimed_at = null, settled_at = null,
         -- The version is re-read at execution; a conflict re-evaluates rather
         -- than overwriting (section 41).
         expected_version = (select t.version from public.tasks t where t.id = i.task_id)
   where i.batch_id = v_batch.id
     and i.status = 'NeedsReview'
     and (not (v_p ? 'item_ids')
          or i.id::text in (select jsonb_array_elements_text(v_p -> 'item_ids')));
  get diagnostics v_count = row_count;

  if v_count > 0 then
    update public.command_batches set status = 'Queued', finished_at = null where id = v_batch.id;
  end if;
  perform app.audit('CommandBatches', v_batch.id::text, 'Retried', null,
                    jsonb_build_object('requeued', v_count), null);
  return jsonb_build_object('status', 'Requeued', 'batch_id', v_batch.id, 'requeued', v_count,
                            'progress', app.batch_progress(v_batch.id), 'external_calls', 0);
end
$$;

-- Cancels what has not started. Committed items stay committed (section 44).
create function app.cmd_batch_cancel(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['batch_id'], array['batch_id']);
  v_batch public.command_batches;
  v_count int;
begin
  select * into v_batch from public.command_batches where id = app.ref(v_p, 'batch_id') for update;
  if not found then
    perform app.fail('BATCH_NOT_FOUND');
  end if;
  if v_batch.actor_person_id <> app.actor_id(p_actor) and not app.is_admin(p_actor) then
    perform app.fail('BATCH_ACCESS_DENIED');
  end if;
  -- Only rows nothing has claimed: an item already Processing is left alone
  -- and settles normally.
  update public.command_batch_items
     set status = 'Cancelled', settled_at = now(),
         error_code = 'BATCH_CANCELLED', error_detail = 'Cancelled before it started'
   where batch_id = v_batch.id and status in ('Pending', 'RetryDue');
  get diagnostics v_count = row_count;
  update public.command_batches set status = 'Cancelled', finished_at = now()
   where id = v_batch.id and not exists (
     select 1 from public.command_batch_items i where i.batch_id = v_batch.id and i.status = 'Processing');
  perform app.audit('CommandBatches', v_batch.id::text, 'Cancelled', to_jsonb(v_batch),
                    jsonb_build_object('cancelled', v_count), null);
  return jsonb_build_object('status', 'Cancelled', 'batch_id', v_batch.id, 'cancelled', v_count,
                            'progress', app.batch_progress(v_batch.id), 'external_calls', 0);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('BATCH_RETRY', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], false,
   '[{"function_id": "FN-01", "mode": "Automated"}]', 'command-batches',
   'Re-queues a batch''s NeedsReview items. Permanent refusals are never re-queued.'),
  ('BATCH_CANCEL', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], false,
   '[{"function_id": "FN-01", "mode": "Automated"}]', 'command-batches',
   'Cancels a batch''s not-yet-started items. Committed items stay committed.');

-- -----------------------------------------------------------------------------
-- 12. Reads for the processing centre
-- -----------------------------------------------------------------------------

-- BATCH_PREFLIGHT: what WOULD happen, before anything is written. Takes the
-- same target set as the submit (explicit ids or a selector) and returns the
-- resolved count plus a per-task plan. Nothing is frozen by a preflight; the
-- submit freezes its own set.
create function app.read_batch_preflight(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_op text := p_request ->> 'operation';
  v_ids uuid[];
  v_id uuid;
  v_task public.tasks;
  v_plan jsonb;
  v_plans jsonb := '[]'::jsonb;
  v_counts jsonb;
begin
  perform app.req_keys(p_request, array['operation', 'task_ids', 'selector']);
  if app.batch_child_type(v_op) is null then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'operation'));
  end if;
  if p_request ? 'task_ids' then
    select coalesce(array_agg(distinct (e #>> '{}')::uuid), '{}') into v_ids
    from jsonb_array_elements(p_request -> 'task_ids') e;
  elsif p_request ? 'selector' then
    v_ids := app.resolve_task_selector(p_request -> 'selector', p_actor);
  else
    perform app.fail('R1A_REQUIRED_TASK_IDS');
  end if;

  foreach v_id in array coalesce(v_ids, '{}') loop
    select * into v_task from public.tasks where id = v_id;
    if v_task.id is null then
      v_plans := v_plans || jsonb_build_object('task_id', v_id, 'outcome', 'not_found');
    else
      v_plan := app.batch_task_plan(v_op, v_task, p_actor);
      v_plans := v_plans || (v_plan || jsonb_build_object(
        'job_ref', (select j.job_ref from public.jobs j where j.id = v_task.job_id)));
    end if;
  end loop;

  select jsonb_object_agg(outcome, n) into v_counts
  from (select p ->> 'outcome' as outcome, count(*) as n
        from jsonb_array_elements(v_plans) p group by 1) s;

  return jsonb_build_object('operation', v_op, 'total', coalesce(cardinality(v_ids), 0),
                            'counts', coalesce(v_counts, '{}'::jsonb), 'items', v_plans);
end
$$;

-- BATCHES: the person's recent operations (an admin sees everyone's).
create function app.read_batches(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_limit int := app.req_limit(p_request, 25, 100);
  v_all boolean := coalesce((p_request ->> 'all')::boolean, false) and app.is_admin(p_actor);
  v_rows jsonb;
begin
  perform app.req_keys(p_request, array['limit', 'all', 'active']);
  select coalesce(jsonb_agg(r order by created_at desc), '[]'::jsonb) into v_rows
  from (
    select b.created_at, jsonb_build_object(
      'batch_id', b.id, 'operation', b.operation, 'status', b.status, 'source', b.source,
      'requested_by', app.s17_person_name(b.actor_person_id),
      'is_mine', b.actor_person_id = app.actor_id(p_actor),
      'created_at', b.created_at, 'started_at', b.started_at, 'finished_at', b.finished_at,
      'total', b.total, 'progress', app.batch_progress(b.id),
      'reason', coalesce(b.payload ->> 'override_reason', b.payload ->> 'reopen_reason',
                         b.payload ->> 'reason', b.payload ->> 'completion_note')) as r
    from public.command_batches b
    where (v_all or b.actor_person_id = app.actor_id(p_actor))
      and (not coalesce((p_request ->> 'active')::boolean, false) or b.status in ('Queued', 'Processing'))
    order by b.created_at desc
    limit v_limit) s;
  return jsonb_build_object('batches', v_rows, 'count', jsonb_array_length(v_rows));
end
$$;

-- BATCH_DETAIL: one operation's child rows.
create function app.read_batch_detail(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_batch public.command_batches;
  v_items jsonb;
begin
  perform app.req_keys(p_request, array['batch_id']);
  select * into v_batch from public.command_batches where id = app.req_uuid(p_request, 'batch_id');
  if not found then
    perform app.fail('BATCH_NOT_FOUND');
  end if;
  if v_batch.actor_person_id <> app.actor_id(p_actor) and not app.is_admin(p_actor) then
    perform app.fail('BATCH_ACCESS_DENIED');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id, 'task_id', i.task_id, 'sequence', i.sequence, 'status', i.status,
    'template_code', t.template_code, 'title', t.title,
    'job_id', t.job_id, 'job_ref', j.job_ref,
    'owner_name', app.s17_person_name(t.owner_id),
    'completion_mode', t.completion_mode,
    'attempt_count', i.attempt_count, 'next_attempt', i.next_attempt,
    'error_code', i.error_code, 'error_detail', i.error_detail,
    'retryable', i.status = 'NeedsReview',
    'settled_at', i.settled_at) order by i.sequence), '[]'::jsonb)
  into v_items
  from public.command_batch_items i
  left join public.tasks t on t.id = i.task_id
  left join public.jobs j on j.id = t.job_id
  where i.batch_id = v_batch.id;

  return jsonb_build_object(
    'batch_id', v_batch.id, 'operation', v_batch.operation, 'status', v_batch.status,
    'source', v_batch.source, 'requested_by', app.s17_person_name(v_batch.actor_person_id),
    'is_mine', v_batch.actor_person_id = app.actor_id(p_actor),
    'created_at', v_batch.created_at, 'started_at', v_batch.started_at, 'finished_at', v_batch.finished_at,
    'payload', v_batch.payload - 'owner_id', 'selector', v_batch.selector,
    'progress', app.batch_progress(v_batch.id), 'items', v_items);
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('BATCH_PREFLIGHT', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]'::jsonb, 'command-batches',
   'What a bulk operation would do to each task in the target set. Writes nothing.'),
  ('BATCHES', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]'::jsonb, 'command-batches',
   'Recent bulk operations for the processing centre.'),
  ('BATCH_DETAIL', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]'::jsonb, 'command-batches',
   'One bulk operation with its child results.');

-- -----------------------------------------------------------------------------
-- 13. Staff wording
-- -----------------------------------------------------------------------------

alter function app.result_error_catalogue() rename to result_error_catalogue_pre_batches;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_batches() || '{
  "TASK_OVERRIDE_DENIED": ["Failed", "You do not have permission to complete a task by override."],
  "R1A_REQUIRED_OVERRIDE_REASON": ["ActionRequired", "Say why this task is being completed by override (at least a few words)."],
  "R1A_REQUIRED_REOPEN_REASON": ["ActionRequired", "Say why these tasks are being reopened (at least a few words)."],
  "R1A_REQUIRED_TASK_IDS": ["ActionRequired", "Select at least one task."],
  "R1A_REQUIRED_OWNER_ID": ["ActionRequired", "Choose who the tasks should move to."],
  "BATCH_EMPTY_SELECTION": ["ActionRequired", "Nothing matched the selection, so there was nothing to do."],
  "BATCH_TOO_LARGE": ["ActionRequired", "That is more than 500 tasks. Narrow the filters and run it in smaller batches."],
  "BATCH_NOT_FOUND": ["Failed", "That operation no longer exists."],
  "BATCH_ACCESS_DENIED": ["Failed", "That operation belongs to someone else."],
  "BATCH_STALLED": ["ActionRequired", "This item was interrupted and has been queued to run again."]
}'::jsonb
$$;

grant execute on function app.result_error_catalogue(), app.result_error_catalogue_pre_batches()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 14. Privileges and RLS
--
-- The batch tables are read through the registered reads (SECURITY DEFINER,
-- actor-scoped), never selected directly by a browser. RLS is enabled and
-- deliberately grants nothing: there is no client-side path to them.
-- -----------------------------------------------------------------------------

alter table public.command_batches enable row level security;
alter table public.command_batch_items enable row level security;
revoke all on public.command_batches, public.command_batch_items from public, anon, authenticated;

create trigger command_batches_audit
  after insert or update or delete on public.command_batches
  for each row execute function app.audit_row_change();

revoke execute on function public.run_batch_chunk(uuid, int) from public, anon;
grant execute on function public.run_batch_chunk(uuid, int) to authenticated;
-- The recovery sweep is pg_cron's (and a migration/operator's); never a client's.
revoke execute on function app.run_batch_recovery(int, int) from public, anon, authenticated;
