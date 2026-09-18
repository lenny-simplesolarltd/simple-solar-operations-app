-- =============================================================================
-- Backend port: S15 job cancellation and reinstatement (release R1;
-- FN-01 + FN-17 Manual + FN-20 Manual).
--
--   CANCEL_JOB              s15/cancellation.js Cancel   (+ services.js _r1sCancel)
--   REINSTATE_JOB           s15/cancellation.js Reinstate (+ services.js _r1sReinstate)
--   CANCELLATION_RESOLVE    s15/cancellation.js Resolve  (no adapter binding in the reference)
--   CANCELLATION_CLOSE      s15/cancellation.js Close    (no adapter binding in the reference)
--   REOPEN_REVIEW_COMPLETE  new: completes S15-REOPEN-REVIEW (no reference implementation)
--   app.s15_preview(job)    s15/cancellation.js _s15Preview (read-only)
--
-- Every handler runs inside public.execute_command (actor, authorization
-- matrix, release modes, idempotency). One transaction per command, so the
-- reference CommitJournal Prepared/Applying/RecoveryRequired plan/apply
-- machinery, withLock and the DEV sheet guard are not ported.
--
-- Vocabulary mapping (reference -> port): InvoiceStages stage 'final' ->
-- 'Balance'. Every other status the reference writes (WorkPackages/Orders/
-- Tasks 'Cancelled', Orders 'Review', Reservations 'Released', CalendarLinks
-- 'Error'/'Cancelled', Outbox 'NeedsReview'/'Cancelled', Communications
-- 'Failed') is already allowed by the ported CHECKs; nothing is widened.
--
-- Deviations:
--   * CANCELLATION_RESOLVE / CANCELLATION_CLOSE are exposed as commands so a
--     job can reach Cancelled (REF-03 §11.12).
--   * REOPEN_REVIEW_COMPLETE completes the reinstatement review so a
--     reinstated job can resume normal work (REF-03 §11.11).
--   * Every S15 task status change writes a task event (REF-03 §11.10).
--   * Job effective/new dates are Europe/London dates stored as London
--     midnight in the timestamptz columns (cancellation_at, next_action_at).
--   * No pilot / release_scope check: canonical jobs have neither column
--     (Job Sold design); release modes still gate every S15 command.
--
-- Schema (canonical identity + Job Sold): the S15 actor rule reads
-- person_roles.role_code through the resolved actor; tasks.task_group;
-- task_templates.code; jobs.job_ref (results report job_ref). S15 tasks keep
-- the explicit owner = acting user (no assignment rule). The reference
-- 'S15 cancellation extra' templates are not supported (no trigger_event).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- _s15Date: YYYY-MM-DD (real calendar date) or an ISO instant with zone ->
-- its Europe/London date; anything else S15_DATE_INVALID.
create function app.s15_date(p_value jsonb)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v text := case when p_value is null or jsonb_typeof(p_value) <> 'string' then null else btrim(p_value #>> '{}') end;
  v_date date;
begin
  if v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      v_date := v::date;
    exception when others then
      perform app.fail('S15_DATE_INVALID');
    end;
    if to_char(v_date, 'YYYY-MM-DD') <> v then
      perform app.fail('S15_DATE_INVALID');
    end if;
    return v_date;
  elsif v ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then
    begin
      v_date := app.london_date(v::timestamptz);
    exception when others then
      perform app.fail('S15_DATE_INVALID');
    end;
    return v_date;
  end if;
  perform app.fail('S15_DATE_INVALID');
end
$$;

-- A JSON integer (number or digit string), else null.
create function app.s15_int(p_value jsonb)
returns int
language sql immutable
set search_path = ''
as $$
  select case when p_value is not null and jsonb_typeof(p_value) in ('number', 'string')
                   and btrim(p_value #>> '{}') ~ '^[0-9]{1,9}$'
              then btrim(p_value #>> '{}')::int end
$$;

-- _s15ModesSnapshot: every function S15 governs has exactly one row with the
-- expected target release; Disabled <=> scope None; Manual-only functions are
-- never Automated. Returns {FN-xx: {mode, scope, target_release}}.
create function app.s15_modes()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_defs constant jsonb := '{"FN-01":["R1","Automated"],"FN-02":["R2","Automated"],"FN-03":["R2","Automated"],
    "FN-04":["R2","Automated"],"FN-05":["R2","Automated"],"FN-06":["R3","Automated"],"FN-07":["R3","Automated"],
    "FN-08":["R3","Automated"],"FN-09":["R4","Automated"],"FN-10":["R4","Manual"],"FN-11":["R1","Manual"],
    "FN-12":["R4","Automated"],"FN-17":["R1","Manual"],"FN-20":["R1","Manual"]}';
  v_id text;
  v_row public.release_modes;
  v_out jsonb := '{}';
begin
  for v_id in select jsonb_object_keys(v_defs) order by 1 loop
    if (select count(*) from public.release_modes m where m.function_id = v_id) <> 1 then
      perform app.fail('S15_REFUSED: ReleaseMode ' || v_id);
    end if;
    select * into v_row from public.release_modes m where m.function_id = v_id;
    if v_row.target_release <> v_defs -> v_id ->> 0
       or v_row.mode not in ('Disabled', 'Manual', 'Automated')
       or v_row.authorised_job_scope not in ('None', 'Pilot', 'All') then
      perform app.fail('S15_REFUSED: ReleaseMode ' || v_id);
    end if;
    if (v_row.mode = 'Disabled') <> (v_row.authorised_job_scope = 'None')
       or (v_defs -> v_id ->> 1 = 'Manual' and v_row.mode = 'Automated') then
      perform app.fail('S15_REFUSED: unexpected mode ' || v_id);
    end if;
    v_out := v_out || jsonb_build_object(v_id, jsonb_build_object('mode', v_row.mode,
               'scope', v_row.authorised_job_scope, 'target_release', v_row.target_release));
  end loop;
  return v_out;
end
$$;

-- _s15Scope: mode snapshot, then the S15 actor rule (Admin/Office/Manager),
-- narrower than the adapter's office class. Kept.
create function app.s15_scope(p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_modes jsonb := app.s15_modes();
begin
  if not app.is_office_manager(p_actor) then
    perform app.fail('S15_REFUSED: authenticated office actor required');
  end if;
  return v_modes;
end
$$;

-- Risk flags (s15/cancellation.js:61-68).
create function app.s15_risks(p_job_id uuid)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select array_remove(array[
    case when j.operational_complete_at is not null then 'OPERATIONALLY_COMPLETE' end,
    case when exists (select 1 from public.work_packages w where w.job_id = j.id
                      and (w.actual_start is not null or w.actual_end is not null
                           or w.status not in ('Unscheduled', 'Scheduled', 'Cancelled')))
         then 'WORK_PERFORMED_OR_UNCERTAIN' end,
    case when exists (select 1 from public.payments p join public.invoice_stages s on s.id = p.invoice_stage_id
                      where s.job_id = j.id) or j.deposit_bank_confirmed_at is not null
         then 'PAYMENT_REVIEW' end,
    -- reference stage 'final' = port stage 'Balance'
    case when exists (select 1 from public.invoice_stages s where s.job_id = j.id and s.stage = 'Balance')
         then 'FINAL_INVOICE_REVIEW' end,
    case when exists (select 1 from public.scaffold_bookings b where b.job_id = j.id
                      and b.erect_actual_at is not null and b.strip_actual_at is null)
         then 'SAFE_STRIP_REQUIRED' end,
    case when exists (select 1 from public.stock_movements m where m.job_id = j.id)
           or exists (select 1 from public.reservations r join public.materials m on m.id = r.material_id
                      where m.job_id = j.id and (r.picked_quantity > 0 or r.status = 'Issued'))
         then 'PHYSICAL_STOCK_REVIEW' end,
    case when exists (select 1 from public.commissioning_submissions c where c.job_id = j.id)
           or exists (select 1 from public.handover h where h.job_id = j.id)
         then 'EVIDENCE_HANDOVER_REVIEW' end
  ]::text[], null)
  from public.jobs j where j.id = p_job_id
$$;

-- Package untouched by work: cancel it outright; otherwise review.
create function app.s15_wp_untouched(p_wp public.work_packages)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_wp.status in ('Unscheduled', 'Scheduled') and p_wp.actual_start is null
     and p_wp.actual_end is null and p_wp.installer_confirmation_at is null
$$;

-- Normal open work cancelled by S15 (s15/cancellation.js:105-106).
create function app.s15_task_cancellable(p_task public.tasks)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_task.status in ('Open', 'Waiting', 'InProgress', 'Blocked')
     and p_task.task_group <> 'Cancellation'
     and p_task.related_entity_type is distinct from 'Issues'
     and (p_task.template_code in ('PRE01', 'PRE02', 'BKG01', 'BKG04', 'MAT01', 'MAT05', 'FIN01', 'FIN03', 'GHL01',
                                   'S13-GHL-PROGRESSION', 'S08-PICK-STOCK', 'SCA01')
          or exists (select 1 from public.ghl_tasks g where g.task_id = p_task.id)
          or p_task.task_group in ('Prebooking', 'Booking'))
$$;

create function app.s15_reservation_releasable(p_res public.reservations)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_res.status = 'Active' and p_res.picked_at is null and coalesce(p_res.picked_quantity, 0) = 0
$$;

-- A pure draft order: never sent, referenced, confirmed or received.
create function app.s15_order_draft(p_order public.orders)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_order.status = 'Draft' and p_order.sent_message_id is null and p_order.supplier_reference is null
     and p_order.confirmed_at is null
     and not exists (select 1 from public.receipt_lines r join public.order_lines l on l.id = r.order_line_id
                     where l.order_id = p_order.id)
$$;

-- A never-attempted pending outbox action can be cancelled; anything else is uncertain.
create function app.s15_outbox_unsent(p_out public.outbox)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(p_out.attempt_count, 0) = 0 and p_out.external_id is null and p_out.status = 'Pending'
$$;

-- The job's related outbox rows (_s15Related): outbox of its calendar links and
-- communications (direct or grouped), or correlated to the job, its invoice
-- stages (XI-{job}-{stage}), orders, scaffold bookings or work packages.
create function app.s15_job_outbox_ids(p_job_id uuid)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.id order by o.created_at, o.id), '{}')
  from public.outbox o
  where o.id in (select c.outbox_id from public.calendar_links c where c.job_id = p_job_id)
     or o.id in (select c.outbox_id from public.communications c
                 where c.job_id = p_job_id
                    or c.id in (select cj.communication_id from public.communication_jobs cj where cj.job_id = p_job_id))
     or o.correlation_id = p_job_id::text
     or o.correlation_id in (select 'XI-' || p_job_id || '-' || s.stage from public.invoice_stages s where s.job_id = p_job_id)
     or o.correlation_id in (select r.id::text from public.orders r where r.job_id = p_job_id
                             union all select b.id::text from public.scaffold_bookings b where b.job_id = p_job_id
                             union all select w.id::text from public.work_packages w where w.job_id = p_job_id)
$$;

-- The job's communications (direct or through communication_jobs).
create function app.s15_job_communication_ids(p_job_id uuid)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}') from public.communications c
  where c.job_id = p_job_id
     or c.id in (select cj.communication_id from public.communication_jobs cj where cj.job_id = p_job_id)
$$;

-- S15 task construction (s15/cancellation.js:80-89): active template required
-- (S15_NOT_CONFIGURED: code); key S15-{command_id}-{code}-{entityId}; group
-- Cancellation; owner = backup = acting user (create_task stores backup null
-- when equal to owner); due now; priority 1; revision_required; Blocked iff a
-- blocking reason. Audited as the S15 action. Returns the id (null if the key
-- already exists).
create function app.s15_task(p_job_id uuid, p_code text, p_entity_type text, p_entity_id uuid,
                             p_title text, p_blocking text, p_action text, p_reason text,
                             p_key_suffix text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := app.context_actor_id();
  v_id uuid;
  v_task public.tasks;
begin
  if not exists (select 1 from public.task_templates t where t.code = p_code and t.active) then
    perform app.fail('S15_NOT_CONFIGURED: ' || p_code);
  end if;
  v_id := app.create_task_instance(p_job_id, p_code,
    'S15-' || app.context_command_id() || '-' || p_code || '-' || p_entity_id || p_key_suffix,
    v_owner, v_owner, now(), 1, p_title, 'Cancellation', p_entity_type, p_entity_id,
    case when p_blocking is null then 'Open' else 'Blocked' end, p_blocking, true, 'S15-1.0');
  if v_id is not null then
    select * into v_task from public.tasks where id = v_id;
    perform app.audit('Tasks', v_id::text, p_action, null, to_jsonb(v_task), p_reason);
  end if;
  return v_id;
end
$$;

-- Common result shape: {ok, status, review, affected, external_calls} plus detail.
create function app.s15_result(p_job_id uuid, p_risks text[])
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'status', j.workflow_stage,
    'review', coalesce(cardinality(p_risks), 0) > 0,
    'risks', to_jsonb(coalesce(p_risks, '{}')),
    'affected', (select count(*) from public.audit_events a where a.command_id = app.context_command_id()),
    'job_id', j.id, 'job_ref', j.job_ref, 'version', j.version, 'workflow_stage', j.workflow_stage,
    'tasks_created', coalesce((select jsonb_agg(jsonb_build_object('task_id', t.id, 'template', t.template_code,
                                  'status', t.status, 'related_entity_type', t.related_entity_type,
                                  'related_entity_id', t.related_entity_id) order by t.created_at, t.instance_key)
                               from public.tasks t
                               where t.instance_key like 'S15-' || app.context_command_id() || '-%'), '[]'::jsonb),
    'external_calls', 0)
  from public.jobs j where j.id = p_job_id
$$;

-- Locks the job, applies the S15 scope and the job-revision check.
create function app.s15_lock_job(p_request jsonb, p_actor jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if not found then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  perform app.s15_scope(p_actor);
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('S15_REVIEW: stale job revision');
  end if;
  return v_job;
end
$$;

-- -----------------------------------------------------------------------------
-- Preview (read-only)
-- -----------------------------------------------------------------------------

-- _s15Preview: risk flags and what CANCEL_JOB would do now, without writes.
-- p_effective_date (default today, London) decides which allocations would be
-- deactivated. Internal (service role); no actor check - callers authorize.
create function app.s15_preview(p_job_id uuid, p_effective_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_date date := coalesce(p_effective_date, app.london_date(now()));
  v_outbox uuid[];
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  v_outbox := app.s15_job_outbox_ids(p_job_id);
  return jsonb_build_object(
    'job_id', v_job.id, 'job_ref', v_job.job_ref, 'workflow_stage', v_job.workflow_stage, 'version', v_job.version,
    'modes', app.s15_modes(),
    'risks', to_jsonb(app.s15_risks(p_job_id)),
    'can_cancel', v_job.workflow_stage not in ('CancellationInProgress', 'Cancelled'),
    'can_reinstate', v_job.workflow_stage = 'Cancelled',
    'effective_date', v_date,
    'would', jsonb_build_object(
      'work_packages_cancel', (select count(*) from public.work_packages w where w.job_id = p_job_id and app.s15_wp_untouched(w)),
      'work_packages_review', (select count(*) from public.work_packages w where w.job_id = p_job_id
                               and not app.s15_wp_untouched(w) and w.status <> 'Cancelled'),
      'allocations_notify', (select count(*) from public.allocations a join public.work_packages w on w.id = a.work_package_id
                             where w.job_id = p_job_id and a.active),
      'allocations_deactivate', (select count(*) from public.allocations a join public.work_packages w on w.id = a.work_package_id
                                 where w.job_id = p_job_id and a.active and (a.end_at is null or a.end_at >= v_date)),
      'tasks_cancel', (select count(*) from public.tasks t where t.job_id = p_job_id and app.s15_task_cancellable(t)),
      'materials_cancel', (select count(*) from public.materials m where m.job_id = p_job_id),
      'reservations_release', (select count(*) from public.reservations r join public.materials m on m.id = r.material_id
                               where m.job_id = p_job_id and app.s15_reservation_releasable(r)),
      'reservations_review', (select count(*) from public.reservations r join public.materials m on m.id = r.material_id
                              where m.job_id = p_job_id and not app.s15_reservation_releasable(r)
                                and r.status not in ('Released', 'Cancelled')),
      'orders_cancel', (select count(*) from public.orders o where o.job_id = p_job_id and o.status <> 'Cancelled' and app.s15_order_draft(o)),
      'orders_review', (select count(*) from public.orders o where o.job_id = p_job_id and o.status <> 'Cancelled' and not app.s15_order_draft(o)),
      'scaffold_strip', (select count(*) from public.scaffold_bookings b where b.job_id = p_job_id and b.status <> 'Cancelled'
                         and b.strip_actual_at is null and b.erect_actual_at is not null),
      'scaffold_acknowledge', (select count(*) from public.scaffold_bookings b where b.job_id = p_job_id and b.status <> 'Cancelled'
                               and b.strip_actual_at is null and b.erect_actual_at is null),
      'calendar_links_review', (select count(*) from public.calendar_links c where c.job_id = p_job_id),
      'outbox_cancel', (select count(*) from public.outbox o where o.id = any (v_outbox)
                        and o.status not in ('Succeeded', 'Cancelled') and app.s15_outbox_unsent(o)),
      'outbox_review', (select count(*) from public.outbox o where o.id = any (v_outbox)
                        and o.status not in ('Succeeded', 'Cancelled') and not app.s15_outbox_unsent(o)),
      'communications_fail', (select count(*) from public.communications c where c.id = any (app.s15_job_communication_ids(p_job_id))
                              and c.status in ('Draft', 'Approved', 'Queued')),
      'invoice_stages_review', (select count(*) from public.invoice_stages s where s.job_id = p_job_id),
      'stock_movements_retained', (select count(*) from public.stock_movements m where m.job_id = p_job_id),
      'signable_task', nullif(btrim(coalesce(v_job.contract_id, '')), '') is not null or v_job.contract_status = 'Signed',
      'phoenix_task', v_job.finance_route = 'Phoenix',
      'finance_task', not exists (select 1 from public.invoice_stages s where s.job_id = p_job_id)),
    'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- CANCEL_JOB
-- -----------------------------------------------------------------------------

create function app.cmd_cancel_job(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_fields constant text[] := array['reason', 'effective_date', 'work_performed', 'material_state', 'scaffold_state',
                                    'finance_review', 'legacy_state'];
  v_p jsonb := app.payload(p_request, c_fields, c_fields);
  c_act constant text := 'S15Cancel';
  v_reason text;
  v_field text;
  v_job public.jobs;
  v_before public.jobs;
  v_modes jsonb;
  v_risks text[];
  v_date date;
  v_outbox_ids uuid[];
  v_comm_ids uuid[];
  v_wp public.work_packages;
  v_wp2 public.work_packages;
  v_alloc public.allocations;
  v_alloc2 public.allocations;
  v_task public.tasks;
  v_task2 public.tasks;
  v_mat public.materials;
  v_mat2 public.materials;
  v_res public.reservations;
  v_res2 public.reservations;
  v_order public.orders;
  v_order2 public.orders;
  v_draft boolean;
  v_sb public.scaffold_bookings;
  v_sb2 public.scaffold_bookings;
  v_link public.calendar_links;
  v_link2 public.calendar_links;
  v_out public.outbox;
  v_out2 public.outbox;
  v_unsent boolean;
  v_comm public.communications;
  v_comm2 public.communications;
  v_inv public.invoice_stages;
  v_ghl_task uuid;
  v_ghl public.ghl_tasks;
begin
  v_job := app.s15_lock_job(p_request, p_actor);
  v_modes := app.s15_modes();
  v_reason := app.txt(v_p, 'reason');
  if v_reason is null then
    perform app.fail('S15_REVIEW: command identity and reason required');
  end if;
  v_risks := app.s15_risks(v_job.id);
  if v_job.workflow_stage in ('Cancelled', 'CancellationInProgress') then
    perform app.fail('S15_REVIEW: cancellation already started; replay original command');
  end if;
  foreach v_field in array array['work_performed', 'material_state', 'scaffold_state', 'finance_review', 'legacy_state'] loop
    if app.txt(v_p, v_field) is null then
      perform app.fail('S15_REVIEW: ' || v_field || ' required');
    end if;
  end loop;
  v_date := app.s15_date(v_p -> 'effective_date');

  -- Snapshot related outbox/communications before this command adds any.
  v_outbox_ids := app.s15_job_outbox_ids(v_job.id);
  v_comm_ids := app.s15_job_communication_ids(v_job.id);

  -- Job -> CancellationInProgress (same Job ID retained).
  v_before := v_job;
  update public.jobs set workflow_stage = 'CancellationInProgress', cancellation_at = app.london_at(v_date, '00:00'),
                         cancellation_by = app.actor_id(p_actor), cancellation_reason = v_reason
  where id = v_job.id returning * into v_job;
  perform app.audit('Jobs', v_job.id::text, c_act, to_jsonb(v_before), to_jsonb(v_job), v_reason);

  -- Work packages: untouched -> Cancelled; performed/uncertain -> Blocked review.
  for v_wp in select * from public.work_packages w where w.job_id = v_job.id
              order by w.sequence, w.created_at, w.id for update loop
    if app.s15_wp_untouched(v_wp) then
      update public.work_packages set status = 'Cancelled', revision = revision + 1
      where id = v_wp.id returning * into v_wp2;
      perform app.audit('WorkPackages', v_wp.id::text, c_act, to_jsonb(v_wp), to_jsonb(v_wp2), v_reason);
    elsif v_wp.status <> 'Cancelled' then
      perform app.s15_task(v_job.id, 'S15-CAN-REVIEW', 'WorkPackages', v_wp.id,
        'Review performed work and retained commissioning responsibility', 'Review', c_act, v_reason);
    end if;
  end loop;

  -- Active allocations: deactivate future/unfinished commitment (history kept);
  -- every active allocation gets an installer notice task.
  for v_alloc in select a.* from public.allocations a join public.work_packages w on w.id = a.work_package_id
                 where w.job_id = v_job.id and a.active order by a.start_at nulls last, a.created_at, a.id
                 for update of a loop
    if v_alloc.end_at is null or v_alloc.end_at >= v_date then
      update public.allocations set active = false, cancellation_reason = v_reason
      where id = v_alloc.id returning * into v_alloc2;
      perform app.audit('Allocations', v_alloc.id::text, c_act, to_jsonb(v_alloc), to_jsonb(v_alloc2), v_reason);
    end if;
    perform app.s15_task(v_job.id, 'S15-CAN-INSTALLER', 'Allocations', v_alloc.id, null, null, c_act, v_reason);
  end loop;

  -- Normal open work is cancelled (issue tasks, install/aftercare/finance work stay open).
  for v_task in select * from public.tasks t where t.job_id = v_job.id and app.s15_task_cancellable(t)
                order by t.created_at, t.id for update loop
    update public.tasks set status = 'Cancelled', completion_note = v_reason
    where id = v_task.id returning * into v_task2;
    perform app.task_event(v_task, v_task2, 'Cancel', v_reason);
    perform app.audit('Tasks', v_task.id::text, c_act, to_jsonb(v_task), to_jsonb(v_task2), v_reason);
  end loop;

  -- Material demand removed.
  for v_mat in select * from public.materials m where m.job_id = v_job.id order by m.created_at, m.id for update loop
    update public.materials set cancelled_quantity = required_quantity, revision = revision + 1
    where id = v_mat.id returning * into v_mat2;
    perform app.audit('Materials', v_mat.id::text, c_act, to_jsonb(v_mat), to_jsonb(v_mat2), v_reason);
  end loop;

  -- Reservations: unpicked Active -> Released; picked/issued -> review, never reversed.
  for v_res in select r.* from public.reservations r join public.materials m on m.id = r.material_id
               where m.job_id = v_job.id order by r.created_at, r.id for update of r loop
    if app.s15_reservation_releasable(v_res) then
      update public.reservations set status = 'Released' where id = v_res.id returning * into v_res2;
      perform app.audit('Reservations', v_res.id::text, c_act, to_jsonb(v_res), to_jsonb(v_res2), v_reason);
    elsif v_res.status not in ('Released', 'Cancelled') then
      perform app.s15_task(v_job.id, 'S15-CAN-STOCK', 'Reservations', v_res.id, null,
        'Review: physical goods; no automatic reversal', c_act, v_reason);
    end if;
  end loop;

  -- Orders: pure drafts -> Cancelled; anything sent/confirmed/received -> Review
  -- with a merchant confirmation obligation on the latest revision.
  for v_order in select * from public.orders o where o.job_id = v_job.id and o.status <> 'Cancelled'
                 order by o.created_at, o.id for update loop
    v_draft := app.s15_order_draft(v_order);
    update public.orders set status = case when v_draft then 'Cancelled' else 'Review' end, revision = revision + 1
    where id = v_order.id returning * into v_order2;
    perform app.audit('Orders', v_order.id::text, c_act, to_jsonb(v_order), to_jsonb(v_order2), v_reason);
    if not v_draft then
      perform app.s15_task(v_job.id, 'S15-CAN-MERCHANT', 'Orders', v_order.id,
        'Merchant confirmed latest cancellation / receive, hold, return or credit goods',
        'Review: latest revision acknowledgement required', c_act, v_reason);
    end if;
  end loop;

  -- Physical stock: movements are never touched; a review task keeps actual cost.
  if exists (select 1 from public.stock_movements m where m.job_id = v_job.id)
     or app.txt(v_p, 'material_state') <> 'None' then
    perform app.s15_task(v_job.id, 'S15-CAN-STOCK', 'Jobs', v_job.id, null,
      'Review: preserve actual movements and costs', c_act, v_reason);
  end if;

  -- Scaffold: status unchanged, revision+1; erected -> safe strip, else acknowledgement.
  for v_sb in select * from public.scaffold_bookings b where b.job_id = v_job.id
              and b.status <> 'Cancelled' and b.strip_actual_at is null order by b.created_at, b.id for update loop
    update public.scaffold_bookings set revision = revision + 1 where id = v_sb.id returning * into v_sb2;
    perform app.audit('ScaffoldBookings', v_sb.id::text, c_act, to_jsonb(v_sb), to_jsonb(v_sb2), v_reason);
    perform app.s15_task(v_job.id, case when v_sb.erect_actual_at is not null then 'S15-CAN-STRIP' else 'S15-CAN-SCAFFOLD' end,
      'ScaffoldBookings', v_sb.id, null, 'Review: acknowledgement / actual safe removal required', c_act, v_reason);
  end loop;
  if app.txt(v_p, 'scaffold_state') <> 'None'
     and not exists (select 1 from public.scaffold_bookings b where b.job_id = v_job.id) then
    -- Deviation: the reference keys this task S15-{cmd}-S15-CAN-REVIEW-{jobId}, the same key as the
    -- late/partial review task below, so both conditions together made its apply step fail with
    -- S15_RECOVERY_REQUIRED; the suffix -SCAFFOLD keeps both tasks (port finding, not in the survey).
    perform app.s15_task(v_job.id, 'S15-CAN-REVIEW', 'Jobs', v_job.id, 'Reconcile external scaffold commitment',
      'Review', c_act, v_reason, '-SCAFFOLD');
  end if;

  -- Calendar links: event IDs retained; removal captured for manual reconciliation.
  for v_link in select * from public.calendar_links c where c.job_id = v_job.id order by c.created_at, c.id for update loop
    insert into public.outbox (idempotency_key, action_type, target, payload_hash, job_revision, attempt_count,
                               next_attempt, external_id, response_summary, correlation_id, status)
    values ('OUT-S15-' || app.context_command_id() || '-' || v_link.id, 'CalendarCancel',
            coalesce(nullif(v_link.calendar_id, ''), 'NOT_CONFIGURED'),
            jsonb_build_object('calendar_link_id', v_link.id, 'action', 'Cancel',
                               'external_event_id', v_link.external_event_id)::text,
            v_job.version, 0, null, v_link.external_event_id,
            'CAPTURE_ONLY / Review: external removal unconfirmed', v_job.id::text, 'NeedsReview')
    returning * into v_out;
    perform app.audit('Outbox', v_out.id::text, c_act, null, to_jsonb(v_out), v_reason);
    update public.calendar_links set status = 'Error', error = 'S15 cancellation removal requires reconciliation',
                                     entity_revision = entity_revision + 1, outbox_id = v_out.id
    where id = v_link.id returning * into v_link2;
    perform app.audit('CalendarLinks', v_link.id::text, c_act, to_jsonb(v_link), to_jsonb(v_link2), v_reason);
    perform app.s15_task(v_job.id, 'S15-CAN-CALENDAR', 'CalendarLinks', v_link.id, null,
      'Review: external removal unconfirmed', c_act, v_reason);
  end loop;

  -- Outbox: never-attempted Pending -> Cancelled; anything uncertain -> NeedsReview + review task.
  for v_out in select * from public.outbox o where o.id = any (v_outbox_ids)
               and o.status not in ('Succeeded', 'Cancelled') order by o.created_at, o.id for update loop
    v_unsent := app.s15_outbox_unsent(v_out);
    update public.outbox set status = case when v_unsent then 'Cancelled' else 'NeedsReview' end, next_attempt = null,
                             response_summary = 'S15 stopped normal action; reconcile uncertain sends before any retry'
    where id = v_out.id returning * into v_out2;
    perform app.audit('Outbox', v_out.id::text, c_act, to_jsonb(v_out), to_jsonb(v_out2), v_reason);
    if not v_unsent then
      perform app.s15_task(v_job.id, 'S15-CAN-REVIEW', 'Outbox', v_out.id, 'Reconcile uncertain normal send',
        'Review', c_act, v_reason);
    end if;
  end loop;

  -- Unsent communications fail; sent/uncertain ones are history.
  for v_comm in select * from public.communications c where c.id = any (v_comm_ids)
                and c.status in ('Draft', 'Approved', 'Queued') order by c.created_at, c.id for update loop
    update public.communications set status = 'Failed' where id = v_comm.id returning * into v_comm2;
    perform app.audit('Communications', v_comm.id::text, c_act, to_jsonb(v_comm), to_jsonb(v_comm2), v_reason);
  end loop;

  -- Finance: invoices and payments are never changed; human review only.
  for v_inv in select * from public.invoice_stages s where s.job_id = v_job.id order by s.created_at, s.id loop
    perform app.s15_task(v_job.id, 'S15-CAN-XERO', 'InvoiceStages', v_inv.id,
      'Review/cancel Xero invoice (' || coalesce(nullif(v_inv.source_status, ''), nullif(v_inv.status, ''), 'unknown') || ')',
      'NOT_CONFIGURED: accounting action policy', c_act, v_reason);
  end loop;
  if not exists (select 1 from public.invoice_stages s where s.job_id = v_job.id) then
    perform app.s15_task(v_job.id, 'S15-CAN-FINANCE', 'Jobs', v_job.id,
      'Review existing finance route, payment receipts, fees and refunds', null, c_act, v_reason);
  end if;
  if nullif(btrim(coalesce(v_job.contract_id, '')), '') is not null or v_job.contract_status = 'Signed' then
    perform app.s15_task(v_job.id, 'S15-CAN-SIGNABLE', 'Jobs', v_job.id, null, null, c_act, v_reason);
  end if;
  if v_job.finance_route = 'Phoenix' then
    perform app.s15_task(v_job.id, 'S15-CAN-PHOENIX', 'Jobs', v_job.id, null,
      'NOT_CONFIGURED: agreement/evidence policy', c_act, v_reason);
  end if;
  perform app.s15_task(v_job.id, 'S15-CAN-CUSTOMER', 'Jobs', v_job.id, null, null, c_act, v_reason);
  perform app.s15_task(v_job.id, 'S15-CAN-SALES', 'Jobs', v_job.id, null, null, c_act, v_reason);
  if app.txt(v_p, 'legacy_state') <> 'None' then
    perform app.s15_task(v_job.id, 'S15-CAN-LEGACY', 'Jobs', v_job.id, null, null, c_act, v_reason);
  end if;

  -- Human GHL cancellation (FN-17 Manual): ids are NOT_CONFIGURED until filled.
  v_ghl_task := app.s15_task(v_job.id, 'S15-CAN-GHL', 'Jobs', v_job.id, null,
    'NOT_CONFIGURED: GHL cancellation IDs', c_act, v_reason);
  if v_ghl_task is not null then
    insert into public.ghl_tasks (job_id, task_id, opportunity_id, target_pipeline_id, target_stage_id, template_id,
                                  readiness_snapshot)
    values (v_job.id, v_ghl_task, null, null, null, null,
            jsonb_build_object('action', 'Cancellation', 'revision', v_job.version, 'mode', v_modes -> 'FN-17',
                               'configuration', 'NOT_CONFIGURED')::text)
    returning * into v_ghl;
    perform app.audit('GHLTasks', v_ghl.id::text, c_act, null, to_jsonb(v_ghl), v_reason);
  end if;

  if cardinality(v_risks) > 0 then
    perform app.s15_task(v_job.id, 'S15-CAN-REVIEW', 'Jobs', v_job.id,
      'Review late/partial cancellation: ' || array_to_string(v_risks, ', '), 'Review', c_act, v_reason);
  end if;
  -- Schema-forced: the reference also created every active template whose
  -- trigger_event = 'S15 cancellation extra'; canonical task_templates have no
  -- trigger_event column, so there are no configurable extra tasks.

  return app.s15_result(v_job.id, v_risks);
end
$$;

-- -----------------------------------------------------------------------------
-- CANCELLATION_RESOLVE
-- -----------------------------------------------------------------------------

-- Deviation: S15 Resolve had no adapter command (REF-03 §11.12); exposed here.
-- Request: {job_id, task_id, expected_version = Jobs.version,
--           payload: {reason, task_version, evidence_reference,
--                     outcome?, confirmed_revision?, actual_date?}}
create function app.cmd_cancellation_resolve(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['reason', 'task_version', 'evidence_reference', 'outcome', 'confirmed_revision', 'actual_date'],
    array['reason']);
  c_act constant text := 'S15Resolve';
  v_reason text := app.txt(v_p, 'reason');
  v_evidence text := app.txt(v_p, 'evidence_reference');
  v_job public.jobs;
  v_before public.jobs;
  v_task public.tasks;
  v_after public.tasks;
  v_ghl public.ghl_tasks;
  v_ghl2 public.ghl_tasks;
  v_revision int;
  v_order public.orders;
  v_order2 public.orders;
  v_sb public.scaffold_bookings;
  v_sb2 public.scaffold_bookings;
  v_link public.calendar_links;
  v_link2 public.calendar_links;
  v_out public.outbox;
  v_out2 public.outbox;
  v_strip date;
begin
  -- Deviation: Resolve is gated like CANCEL_JOB (FN-17 + FN-20 Manual) (REF-03 §11.12).
  perform app.require_mode('FN-17', 'Manual');
  perform app.require_mode('FN-20', 'Manual');
  v_job := app.s15_lock_job(p_request, p_actor);
  if v_reason is null then
    perform app.fail('S15_REVIEW: command identity and reason required');
  end if;
  if v_job.workflow_stage not in ('CancellationInProgress', 'Cancelled') then
    perform app.fail('S15_REVIEW: cancellation not active');
  end if;
  select * into v_task from public.tasks t
  where t.id = app.ref(p_request, 'task_id') and t.job_id = v_job.id and t.task_group = 'Cancellation' for update;
  if v_task.id is null or v_task.status not in ('Open', 'Blocked', 'Waiting', 'InProgress') or v_evidence is null then
    perform app.fail('S15_REVIEW: open cancellation task and evidence required');
  end if;
  if v_task.template_code = 'S15-CAN-GHL' then
    select * into v_ghl from public.ghl_tasks g where g.task_id = v_task.id order by g.created_at limit 1 for update;
    if v_ghl.id is null or v_ghl.opportunity_id is null or v_ghl.target_pipeline_id is null or v_ghl.target_stage_id is null
       or 'NOT_CONFIGURED' in (v_ghl.opportunity_id, v_ghl.target_pipeline_id, v_ghl.target_stage_id) then
      perform app.fail('S15_NOT_CONFIGURED: GHL cancellation IDs');
    end if;
  end if;
  if app.s15_int(v_p -> 'task_version') is distinct from v_task.version then
    perform app.fail('S15_REVIEW: stale task revision');
  end if;
  if v_ghl.id is not null then
    update public.ghl_tasks set completed_at = now(), completed_by = app.actor_id(p_actor), evidence_reference = v_evidence
    where id = v_ghl.id returning * into v_ghl2;
    perform app.audit('GHLTasks', v_ghl.id::text, c_act, to_jsonb(v_ghl), to_jsonb(v_ghl2), v_reason);
  end if;

  -- Confirmation obligations: explicit Confirmed outcome on the entity's CURRENT revision.
  if v_task.template_code in ('S15-CAN-MERCHANT', 'S15-CAN-SCAFFOLD', 'S15-CAN-STRIP', 'S15-CAN-CALENDAR') then
    if v_task.template_code = 'S15-CAN-MERCHANT' then
      select * into v_order from public.orders where id = v_task.related_entity_id for update;
      v_revision := v_order.revision;
    elsif v_task.template_code = 'S15-CAN-CALENDAR' then
      select * into v_link from public.calendar_links where id = v_task.related_entity_id for update;
      v_revision := v_link.entity_revision;
    else
      select * into v_sb from public.scaffold_bookings where id = v_task.related_entity_id for update;
      v_revision := v_sb.revision;
    end if;
    if v_revision is null or app.s15_int(v_p -> 'confirmed_revision') is distinct from v_revision
       or app.txt(v_p, 'outcome') is distinct from 'Confirmed' then
      perform app.fail('S15_REVIEW: latest revision confirmation required; sent is not confirmed');
    end if;
    if v_task.template_code = 'S15-CAN-MERCHANT' then
      update public.orders set status = 'Cancelled', confirmed_revision = v_revision, confirmed_at = now(),
                               confirmed_by = app.actor_id(p_actor)
      where id = v_order.id returning * into v_order2;
      perform app.audit('Orders', v_order.id::text, c_act, to_jsonb(v_order), to_jsonb(v_order2), v_reason);
    elsif v_task.template_code = 'S15-CAN-SCAFFOLD' then
      update public.scaffold_bookings set status = 'Cancelled', confirmed_revision = v_revision
      where id = v_sb.id returning * into v_sb2;
      perform app.audit('ScaffoldBookings', v_sb.id::text, c_act, to_jsonb(v_sb), to_jsonb(v_sb2), v_reason);
    elsif v_task.template_code = 'S15-CAN-STRIP' then
      v_strip := app.s15_date(v_p -> 'actual_date');
      update public.scaffold_bookings set strip_actual_at = v_strip where id = v_sb.id returning * into v_sb2;
      perform app.audit('ScaffoldBookings', v_sb.id::text, c_act, to_jsonb(v_sb), to_jsonb(v_sb2), v_reason);
    else
      update public.calendar_links set status = 'Cancelled', error = null, last_synced_revision = v_revision
      where id = v_link.id returning * into v_link2;
      perform app.audit('CalendarLinks', v_link.id::text, c_act, to_jsonb(v_link), to_jsonb(v_link2), v_reason);
      select * into v_out from public.outbox where id = v_link.outbox_id for update;
      if v_out.id is not null then
        update public.outbox set status = 'Cancelled', response_summary = 'Manual external reconciliation: ' || v_evidence
        where id = v_out.id returning * into v_out2;
        perform app.audit('Outbox', v_out.id::text, c_act, to_jsonb(v_out), to_jsonb(v_out2), v_reason);
      end if;
    end if;
  end if;

  update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.actor_id(p_actor),
                          completion_note = v_reason || '; evidence: ' || v_evidence,
                          revision_required = false, blocking_reason = null
  where id = v_task.id returning * into v_after;
  perform app.task_event(v_task, v_after, 'Complete', v_reason);
  perform app.audit('Tasks', v_task.id::text, c_act, to_jsonb(v_task), to_jsonb(v_after), v_reason);

  -- The job revision advances with every S15 command (reference patch('Jobs', job, {})).
  v_before := v_job;
  update public.jobs set workflow_stage = workflow_stage where id = v_job.id returning * into v_job;
  perform app.audit('Jobs', v_job.id::text, c_act, to_jsonb(v_before), to_jsonb(v_job), v_reason);

  return app.s15_result(v_job.id, app.s15_risks(v_job.id))
      || jsonb_build_object('task', to_jsonb(v_after));
end
$$;

-- -----------------------------------------------------------------------------
-- CANCELLATION_CLOSE
-- -----------------------------------------------------------------------------

-- Deviation: S15 Close had no adapter command (REF-03 §11.12); exposed here.
-- Request: {job_id, expected_version = Jobs.version,
--           payload: {reason, tracked_obligations: [{task_id, reference, reason}]}}
create function app.cmd_cancellation_close(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['reason', 'tracked_obligations'], array['reason']);
  c_act constant text := 'S15Close';
  v_reason text := app.txt(v_p, 'reason');
  v_tracked jsonb := case when jsonb_typeof(v_p -> 'tracked_obligations') = 'array'
                          then v_p -> 'tracked_obligations' else '[]'::jsonb end;
  v_job public.jobs;
  v_before public.jobs;
  v_task public.tasks;
  v_record jsonb;
  v_kept jsonb := '[]'::jsonb;
begin
  -- Deviation: Close is gated like CANCEL_JOB (FN-17 + FN-20 Manual) (REF-03 §11.12).
  perform app.require_mode('FN-17', 'Manual');
  perform app.require_mode('FN-20', 'Manual');
  v_job := app.s15_lock_job(p_request, p_actor);
  if v_reason is null then
    perform app.fail('S15_REVIEW: command identity and reason required');
  end if;
  if v_job.workflow_stage <> 'CancellationInProgress' then
    perform app.fail('S15_REVIEW: cancellation not in progress');
  end if;
  for v_task in select * from public.tasks t where t.job_id = v_job.id and t.task_group = 'Cancellation'
                and t.status not in ('Complete', 'NotRequired') order by t.created_at, t.id loop
    if v_task.template_code in ('S15-CAN-MERCHANT', 'S15-CAN-SCAFFOLD', 'S15-CAN-STRIP', 'S15-CAN-CALENDAR') then
      perform app.fail('S15_REVIEW: confirmation outstanding ' || v_task.id);
    end if;
    select r into v_record from jsonb_array_elements(v_tracked) r
    where jsonb_typeof(r) = 'object' and r ->> 'task_id' = v_task.id::text limit 1;
    if v_task.owner_id is null or v_record is null or app.txt(v_record, 'reference') is null
       or app.txt(v_record, 'reason') is null then
      perform app.fail('S15_REVIEW: unresolved obligation must be explicitly tracked ' || v_task.id);
    end if;
    v_kept := v_kept || jsonb_build_object('task_id', v_task.id, 'template', v_task.template_code,
      'owner_id', v_task.owner_id, 'reference', app.txt(v_record, 'reference'), 'reason', app.txt(v_record, 'reason'));
  end loop;
  v_before := v_job;
  update public.jobs set workflow_stage = 'Cancelled' where id = v_job.id returning * into v_job;
  perform app.audit('Jobs', v_job.id::text, c_act, to_jsonb(v_before),
                    to_jsonb(v_job) || jsonb_build_object('tracked_obligations', v_kept), v_reason);
  return app.s15_result(v_job.id, app.s15_risks(v_job.id)) || jsonb_build_object('tracked_obligations', v_kept);
end
$$;

-- -----------------------------------------------------------------------------
-- REINSTATE_JOB
-- -----------------------------------------------------------------------------

-- Conservative controlled reopen: same Job ID, back to Prebooking, booking
-- approval cleared, fresh Unscheduled packages for cancelled required ones,
-- commitments never resurrected; S15-REOPEN-REVIEW suppresses normal work
-- until REOPEN_REVIEW_COMPLETE.
create function app.cmd_reinstate_job(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['reason', 'new_date', 'risk_review', 'commitment_review', 'finance_review', 'evidence_reference'],
    array['reason', 'new_date', 'commitment_review', 'finance_review', 'evidence_reference']);
  c_act constant text := 'S15Reinstate';
  v_reason text := app.txt(v_p, 'reason');
  v_job public.jobs;
  v_before public.jobs;
  v_risks text[];
  v_new date;
  v_wp public.work_packages;
  v_new_wp public.work_packages;
begin
  v_job := app.s15_lock_job(p_request, p_actor);
  if v_reason is null then
    perform app.fail('S15_REVIEW: command identity and reason required');
  end if;
  v_risks := app.s15_risks(v_job.id);
  if v_job.workflow_stage <> 'Cancelled' then
    perform app.fail('S15_REVIEW: only Cancelled can reopen');
  end if;
  if cardinality(v_risks) > 0 and app.txt(v_p, 'risk_review') is null then
    perform app.fail('S15_REVIEW: late/partial work requires explicit risk review');
  end if;
  if app.txt(v_p, 'commitment_review') is null or app.txt(v_p, 'finance_review') is null
     or app.txt(v_p, 'evidence_reference') is null then
    perform app.fail('S15_REVIEW: commitments, invoice/order reuse and evidence review required');
  end if;
  v_new := app.s15_date(v_p -> 'new_date');
  if v_job.cancellation_at is null then
    perform app.fail('S15_DATE_INVALID');
  end if;
  if v_new <= app.london_date(v_job.cancellation_at) then
    perform app.fail('S15_REVIEW: fresh date after cancellation required');
  end if;

  v_before := v_job;
  update public.jobs set workflow_stage = 'Prebooking', cancellation_at = null, cancellation_by = null,
                         cancellation_reason = null, booking_approved_at = null, booking_approved_by = null,
                         next_action_at = app.london_at(v_new, '00:00')
  where id = v_job.id returning * into v_job;
  perform app.audit('Jobs', v_job.id::text, c_act, to_jsonb(v_before), to_jsonb(v_job), v_reason);

  for v_wp in select * from public.work_packages w where w.job_id = v_job.id and w.status = 'Cancelled' and w.required
              order by w.sequence, w.created_at, w.id loop
    insert into public.work_packages (job_id, trade, required, planned_start, planned_end, status,
                                      commissioning_required, sequence, revision, parent_package_id)
    values (v_job.id, v_wp.trade, true, v_new, v_new, 'Unscheduled', v_wp.commissioning_required, v_wp.sequence,
            v_wp.revision + 1, v_wp.id)
    returning * into v_new_wp;
    perform app.audit('WorkPackages', v_new_wp.id::text, c_act, null, to_jsonb(v_new_wp), v_reason);
  end loop;

  perform app.s15_task(v_job.id, 'S15-REOPEN-REVIEW', 'Jobs', v_job.id,
    'Review fresh dates, booking gates, retained obligations and invoice/order reuse', null, c_act, v_reason);

  return app.s15_result(v_job.id, v_risks);
end
$$;

-- -----------------------------------------------------------------------------
-- REOPEN_REVIEW_COMPLETE
-- -----------------------------------------------------------------------------

-- Deviation: the reference has no way to complete S15-REOPEN-REVIEW
-- (revision_required blocks TASK_COMPLETE, Resolve needs a cancelling stage),
-- so a reinstated job could never resume (REF-03 §11.11). Minimal design:
-- office-manager actor (S15 rule), FN-17 + FN-20 Manual, note required;
-- completes the open review task and clears revision_required. Booking gates
-- are NOT re-run here: staff run BOOKING_GATES once normal work resumes.
-- Request: {job_id, task_id, expected_version = Tasks.version, payload: {note}}
create function app.cmd_reopen_review_complete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['note'], array['note']);
  v_note text := app.txt(v_p, 'note');
  v_job public.jobs;
  v_task public.tasks;
  v_after public.tasks;
begin
  perform app.require_mode('FN-17', 'Manual');
  perform app.require_mode('FN-20', 'Manual');
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  perform app.s15_scope(p_actor);
  if v_note is null then
    perform app.fail('R1A_REQUIRED_NOTE');
  end if;
  select * into v_task from public.tasks t
  where t.id = app.ref(p_request, 'task_id') and t.job_id = v_job.id and t.template_code = 'S15-REOPEN-REVIEW' for update;
  if v_task.id is null or v_task.status in ('Complete', 'NotRequired', 'Cancelled') then
    perform app.fail('S15_REVIEW: open reopen review task required');
  end if;
  if v_job.cancellation_at is not null or v_job.workflow_stage in ('CancellationInProgress', 'Cancelled') then
    perform app.fail('S15_REVIEW: cancellation active');
  end if;
  if v_task.version <> app.expected_version(p_request) then
    perform app.fail('S15_REVIEW: stale task revision');
  end if;
  update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.actor_id(p_actor),
                          completion_note = v_note, revision_required = false, blocking_reason = null
  where id = v_task.id returning * into v_after;
  perform app.task_event(v_task, v_after, 'Complete', v_note);
  perform app.audit('Tasks', v_task.id::text, 'S15ReopenReviewComplete', to_jsonb(v_task), to_jsonb(v_after), v_note);
  return jsonb_build_object(
    'status', 'Completed',
    'task', to_jsonb(v_after),
    'job_id', v_job.id, 'job_ref', v_job.job_ref, 'version', v_job.version, 'workflow_stage', v_job.workflow_stage,
    'normal_work_suppressed', exists (select 1 from public.tasks t where t.job_id = v_job.id
                                      and t.template_code = 'S15-REOPEN-REVIEW'
                                      and t.status not in ('Complete', 'NotRequired')),
    'external_calls', 0);
end
$$;

