-- =============================================================================
-- Backend port, part 4: S06 workflow engine - gates, prebooking/booking task
-- generation, automatic stage transitions; S13 invoice stages at sale.
--
-- Source: s06/gates.js (canonical; NOT the older apps-script/s06 bundle),
-- r1-appsheet/services.js _r1sReevaluatePrebooking, s13/payments.js
-- buildInvoiceStages.
--
-- Business rules preserved:
--   * a gate is a conjunction of task status AND structured evidence state;
--     a Complete task alone never satisfies a gate, nor does the state alone;
--   * "exactly one task for the code on the job", else unsatisfied;
--   * PRE01-PRE04 must be strictly Complete; others Complete, or NotRequired
--     with a note or evidence;
--   * three-way deposit reconciliation (job summary <-> one Confirmed manual
--     bank check <-> the deposit invoice stage);
--   * automatic Prebooking <-> ReadyToBook promotion/demotion, one stage at a
--     time; an early booking cannot skip ReadyToBook;
--   * task generation is idempotent by instance_key and never reassigns,
--     re-dates or reopens an existing task.
--
-- Deviations (flagged in the reference survey):
--   * process_booking_gates never moves BookingInProgress -> Booked; only
--     CONFIRM_BOOKING (Office/Admin/Manager) does (REF-03 §11.5).
--   * every stage transition is audited, not only the first (REF-03 §11.6).
--   * interim invoice Xero intents are not created (R4 / FN-09).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Gate evidence
-- -----------------------------------------------------------------------------

create function app.bank_confirmation_evidence(p_job_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_stage public.invoice_stages;
  v_stages int;
  v_checks int;
  v_check_id uuid;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null or v_job.deposit_bank_confirmed_at is null or v_job.deposit_bank_confirmed_by is null
     or v_job.deposit_bank_reference is null then
    return jsonb_build_object('pass', false, 'detail', 'Job bank confirmation actor/date/reference missing');
  end if;
  select count(*) into v_stages from public.invoice_stages s where s.job_id = p_job_id and lower(s.stage) = 'deposit';
  select * into v_stage from public.invoice_stages s where s.job_id = p_job_id and lower(s.stage) = 'deposit' limit 1;
  if v_stages <> 1 or not coalesce(v_stage.gross_pence > 0, false) then
    return jsonb_build_object('pass', false, 'detail', 'Canonical deposit InvoiceStage missing or invalid');
  end if;
  select count(*), min(c.id::text)::uuid into v_checks, v_check_id
  from public.manual_bank_checks c
  where c.job_id = p_job_id and lower(c.stage) = 'deposit' and c.outcome = 'Confirmed'
    and c.checked_at = v_job.deposit_bank_confirmed_at and c.checked_by = v_job.deposit_bank_confirmed_by
    and c.amount_pence = v_stage.gross_pence and c.evidence_reference = v_job.deposit_bank_reference;
  if v_checks <> 1 then
    return jsonb_build_object('pass', false, 'detail', 'Exactly one reconciled ManualBankChecks confirmation required');
  end if;
  if v_stage.status <> 'Confirmed' or v_stage.reference is distinct from v_job.deposit_bank_reference then
    return jsonb_build_object('pass', false, 'detail', 'Deposit InvoiceStage is not confirmed to the same bank reference');
  end if;
  return jsonb_build_object('pass', true, 'detail', 'Manual bank check matches InvoiceStage',
                            'stage_id', v_stage.id, 'bank_check_id', v_check_id);
end
$$;

create function app.task_satisfaction(p_job_id uuid, p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_count int;
  v_task public.tasks;
  v_job public.jobs;
  v_stage public.invoice_stages;
  v_stages int;
  v_pass boolean;
  v_bank jsonb;
begin
  select count(*) into v_count from public.tasks t where t.job_id = p_job_id and t.template_code = p_code;
  if v_count <> 1 then
    return jsonb_build_object('pass', false, 'detail',
      case when v_count = 0 then 'Required task missing' else 'Expected one task; found ' || v_count end);
  end if;
  select * into v_task from public.tasks t where t.job_id = p_job_id and t.template_code = p_code;
  select * into v_job from public.jobs where id = p_job_id;

  if p_code in ('PRE01', 'PRE02', 'PRE03', 'PRE04') and v_task.status <> 'Complete' then
    return jsonb_build_object('pass', false, 'task_id', v_task.id,
      'detail', p_code || ' outstanding (' || coalesce(v_task.status, 'missing status') || ')');
  end if;

  if p_code = 'PRE01' then
    select count(*) into v_stages from public.invoice_stages s where s.job_id = p_job_id and lower(s.stage) = 'deposit';
    if v_stages <> 1 then
      return jsonb_build_object('pass', false, 'task_id', v_task.id, 'detail', 'PRE01 deposit invoice stage missing');
    end if;
    select * into v_stage from public.invoice_stages s where s.job_id = p_job_id and lower(s.stage) = 'deposit';
    v_pass := (nullif(btrim(v_stage.invoice_number), '') is not null
               or coalesce(nullif(btrim(v_stage.xero_invoice_id), ''), 'NOT_CONFIGURED') <> 'NOT_CONFIGURED')
              and v_stage.sent_at is not null;
    return jsonb_build_object('pass', v_pass, 'task_id', v_task.id, 'detail',
      case when v_pass then 'PRE01 satisfied (Complete with invoice sent)'
           else 'PRE01 Complete but invoice ID/sent status missing' end);
  end if;

  if p_code = 'PRE02' then
    v_pass := nullif(btrim(v_job.contract_id), '') is not null and v_job.contract_status = 'Signed'
              and v_job.contract_evidence_id is not null and v_job.contract_signed_at is not null;
    return jsonb_build_object('pass', v_pass, 'task_id', v_task.id, 'detail',
      case when v_pass then 'PRE02 satisfied (Complete with signed contract evidence)'
           else 'PRE02 Complete but signed contract reference/evidence missing' end);
  end if;

  if p_code = 'PRE03' then
    v_bank := app.bank_confirmation_evidence(p_job_id);
    return jsonb_build_object('pass', (v_bank ->> 'pass')::boolean, 'task_id', v_task.id, 'detail',
      case when (v_bank ->> 'pass')::boolean then 'PRE03 satisfied (manual bank check reconciled)'
           else 'PRE03 Complete but valid manual bank confirmation missing: ' || (v_bank ->> 'detail') end);
  end if;

  if p_code = 'PRE04' then
    v_pass := v_job.customer_details_verified_at is not null and v_job.customer_details_verified_by is not null
              and v_job.sold_booking_match_status = 'Match'
              and coalesce(v_job.original_gross_pence > 0, false)
              and nullif(btrim(v_job.valuation_basis), '') is not null;
    return jsonb_build_object('pass', v_pass, 'task_id', v_task.id, 'detail',
      case when v_pass then 'PRE04 satisfied (Complete with customer/value verification)'
           else 'PRE04 Complete but customer/value verification missing' end);
  end if;

  v_pass := v_task.status = 'Complete'
            or (v_task.status = 'NotRequired' and (v_task.completion_note is not null or v_task.evidence_id is not null));
  return jsonb_build_object('pass', v_pass, 'task_id', v_task.id, 'detail',
    case when v_pass then p_code || ' satisfied (' || v_task.status || ')'
         else p_code || ' outstanding (' || coalesce(v_task.status, 'missing status') || ')' end);
end
$$;

-- -----------------------------------------------------------------------------
-- ReadyToBook and booking gates
-- -----------------------------------------------------------------------------

create function app.evaluate_ready_to_book(p_job_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_gates jsonb := '[]'::jsonb;
  v_ready boolean := true;
  v_sat jsonb;
  v_contract boolean;

  -- (nested helpers are not available in plpgsql; gates appended inline)
begin
  select * into v_job from public.jobs where id = p_job_id;

  v_gates := v_gates || jsonb_build_object('name', 'sold_linked', 'pass', exists (select 1 from public.presales ps where ps.job_id = v_job.id),
    'blocking', true, 'detail', case when exists (select 1 from public.presales ps where ps.job_id = v_job.id) then 'Presale (sold document) linked' else 'Presale missing' end);

  v_gates := v_gates || jsonb_build_object('name', 'finance_route_valid',
    'pass', v_job.finance_route in ('Standard', 'Phoenix', 'OtherReview'), 'blocking', true,
    'detail', 'Finance route: ' || coalesce(v_job.finance_route, 'missing'));

  v_contract := v_job.contract_status = 'Signed' and v_job.contract_evidence_id is not null
                and v_job.contract_signed_at is not null and nullif(btrim(v_job.contract_id), '') is not null;
  v_gates := v_gates || jsonb_build_object('name', 'signed_contract_evidence', 'pass', v_contract, 'blocking', true,
    'detail', case when v_contract then 'Signed contract evidence recorded' else 'Signed contract evidence missing' end);

  if v_job.finance_route = 'Standard' then
    v_sat := app.task_satisfaction(p_job_id, 'PRE01');
    v_gates := v_gates || jsonb_build_object('name', 'PRE01_satisfied', 'pass', v_sat -> 'pass', 'blocking', true, 'detail', v_sat -> 'detail');
  end if;

  v_sat := app.task_satisfaction(p_job_id, 'PRE02');
  v_gates := v_gates || jsonb_build_object('name', 'PRE02_satisfied', 'pass', v_sat -> 'pass', 'blocking', true, 'detail', v_sat -> 'detail');

  v_sat := app.task_satisfaction(p_job_id, 'PRE04');
  v_gates := v_gates || jsonb_build_object('name', 'PRE04_satisfied', 'pass', v_sat -> 'pass', 'blocking', true, 'detail', v_sat -> 'detail');

  v_gates := v_gates || jsonb_build_object('name', 'customer_value_verified', 'blocking', true,
    'pass', v_job.customer_details_verified_at is not null and v_job.customer_details_verified_by is not null
            and coalesce(v_job.original_gross_pence > 0, false) and v_job.sold_booking_match_status = 'Match'
            and nullif(btrim(v_job.valuation_basis), '') is not null,
    'detail', 'Customer verification actor/time, Match status, valuation basis and sold value must be recorded');

  if v_job.finance_route = 'Standard' then
    v_sat := app.task_satisfaction(p_job_id, 'PRE03');
    v_gates := v_gates || jsonb_build_object('name', 'PRE03_satisfied', 'pass', v_sat -> 'pass', 'blocking', true, 'detail', v_sat -> 'detail');
    v_sat := app.bank_confirmation_evidence(p_job_id);
    v_gates := v_gates || jsonb_build_object('name', 'deposit_confirmation_evidence', 'pass', v_sat -> 'pass', 'blocking', true, 'detail', v_sat -> 'detail');
  else
    v_sat := app.task_satisfaction(p_job_id, 'PRE05');
    v_gates := v_gates || jsonb_build_object('name', 'PRE05_satisfied', 'pass', v_sat -> 'pass', 'blocking', true, 'detail', v_sat -> 'detail');
    v_gates := v_gates || jsonb_build_object('name', 'finance_agreement_evidence', 'blocking', true,
      'pass', exists (select 1 from public.tasks t where t.job_id = p_job_id and t.template_code = 'PRE05' and t.evidence_id is not null),
      'detail', 'PRE05 provider/agreement evidence must be recorded');
  end if;

  select bool_and((g ->> 'pass')::boolean) into v_ready from jsonb_array_elements(v_gates) g;
  return jsonb_build_object('job_id', p_job_id, 'workflow_stage', v_job.workflow_stage, 'ready', v_ready,
    'blocked', not v_ready, 'gates', v_gates, 'summary', case when v_ready then 'ReadyToBook' else 'PrebookingBlocked' end);
end
$$;

create function app.evaluate_booking_gates(p_job_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_customer public.customers;
  v_gates jsonb := '[]'::jsonb;
  v_missing text[];
  v_contract boolean;
  v_deposit jsonb;
  v_code text;
  v_sat jsonb;
  v_ready boolean;
  v_blocked boolean;
begin
  select * into v_job from public.jobs where id = p_job_id;

  v_gates := v_gates || jsonb_build_object('name', 'sold_booking_linked', 'blocking', true,
    'pass', exists (select 1 from public.presales ps where ps.job_id = v_job.id) and v_job.booking_submission_id is not null,
    'detail', case when exists (select 1 from public.presales ps where ps.job_id = v_job.id) and v_job.booking_submission_id is not null
                   then 'Sold and Booking linked' else 'Missing sold or booking submission link' end);

  v_gates := v_gates || jsonb_build_object('name', 'sold_booking_match', 'blocking', true,
    'pass', v_job.sold_booking_match_status = 'Match',
    'detail', 'Match status: ' || coalesce(v_job.sold_booking_match_status, 'missing'));

  select * into v_customer from public.customers where id = v_job.customer_id;
  v_gates := v_gates || jsonb_build_object('name', 'customer_exists', 'blocking', true, 'pass', v_customer.id is not null,
    'detail', case when v_customer.id is not null then 'Customer ' || v_customer.first_name || ' ' || v_customer.last_name
                   else 'No customer linked' end);

  if v_customer.id is not null then
    v_missing := array_remove(array[
      case when nullif(btrim(v_customer.first_name), '') is null then 'first_name' end,
      case when nullif(btrim(v_customer.last_name), '') is null then 'last_name' end,
      case when nullif(btrim(v_customer.address_line1), '') is null then 'address_line1' end,
      case when nullif(btrim(v_customer.town), '') is null then 'town' end,
      case when nullif(btrim(v_customer.postcode), '') is null then 'postcode' end], null);
    v_gates := v_gates || jsonb_build_object('name', 'customer_details_complete', 'blocking', false,
      'pass', cardinality(v_missing) = 0,
      'detail', case when cardinality(v_missing) = 0 then 'All required customer fields present'
                     else 'Missing: ' || array_to_string(v_missing, ', ') end);
  end if;

  -- A booking cannot weaken the signed-evidence prebooking gate.
  v_contract := v_job.contract_status = 'Signed' and v_job.contract_evidence_id is not null
                and v_job.contract_signed_at is not null and nullif(btrim(v_job.contract_id), '') is not null;
  v_gates := v_gates || jsonb_build_object('name', 'contract_status', 'blocking', true, 'pass', v_contract,
    'detail', 'Contract: ' || coalesce(v_job.contract_status, 'missing')
              || case when v_contract then ' with evidence' else ' (signed evidence required)' end);

  v_gates := v_gates || jsonb_build_object('name', 'finance_route_valid', 'blocking', true,
    'pass', v_job.finance_route in ('Standard', 'Phoenix', 'OtherReview'),
    'detail', 'Finance route: ' || coalesce(v_job.finance_route, 'missing'));

  -- Deposit applies only to Standard; finance routes use PRE05.
  v_deposit := case when v_job.finance_route = 'Standard' then app.bank_confirmation_evidence(p_job_id)
                    else jsonb_build_object('pass', true, 'detail', 'Not applicable') end;
  v_gates := v_gates || jsonb_build_object('name', 'deposit_confirmed', 'blocking', true, 'pass', v_deposit -> 'pass',
    'detail', v_deposit -> 'detail');

  v_gates := v_gates || jsonb_build_object('name', 'gross_amount_present', 'blocking', false,
    'pass', coalesce(v_job.original_gross_pence > 0, false),
    'detail', case when coalesce(v_job.original_gross_pence > 0, false)
                   then 'Gross: ' || v_job.original_gross_pence || ' pence' else 'Gross amount missing or zero' end);

  foreach v_code in array
    case when v_job.finance_route = 'Standard' then array['PRE01', 'PRE02', 'PRE03', 'PRE04']
         else array['PRE02', 'PRE04', 'PRE05'] end || array['BKG01', 'BKG02', 'BKG03']
  loop
    v_sat := app.task_satisfaction(p_job_id, v_code);
    v_gates := v_gates || jsonb_build_object('name', 'task_' || v_code, 'blocking', true,
      'pass', v_sat -> 'pass', 'detail', v_sat -> 'detail');
  end loop;

  select bool_and((g ->> 'pass')::boolean),
         bool_or(not (g ->> 'pass')::boolean and (g ->> 'blocking')::boolean)
    into v_ready, v_blocked
  from jsonb_array_elements(v_gates) g;
  v_blocked := coalesce(v_blocked, false);
  return jsonb_build_object('job_id', p_job_id, 'job_ref', v_job.job_ref, 'workflow_stage', v_job.workflow_stage,
    'ready', v_ready, 'blocked', v_blocked, 'needs_review', not v_ready and not v_blocked, 'gates', v_gates,
    'summary', case when v_ready then 'Ready' when v_blocked then 'Blocked' else 'NeedsReview' end);
end
$$;

-- -----------------------------------------------------------------------------
-- Task generation
-- -----------------------------------------------------------------------------

create function app.task_key(p_code text, p_job_id uuid)
returns text
language sql immutable
set search_path = ''
as $$ select p_code || '-' || p_job_id || '-ROOT-nodue' $$;

create function app.task_key_exists(p_key text)
returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from public.tasks t where t.instance_key = p_key) $$;

-- Appends {template, task_id, owner_id, due_at} to created, or the skip.
create function app.push_task_result(p_result jsonb, p_code text, p_key text, p_task_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks t where t.instance_key = p_key;
  if p_task_id is not null then
    return jsonb_set(p_result, '{created}', (p_result -> 'created') || jsonb_build_object(
      'template', p_code, 'task_id', v_task.id, 'owner_id', v_task.owner_id, 'due_at', v_task.due_at));
  end if;
  return jsonb_set(p_result, '{skipped}', (p_result -> 'skipped') || jsonb_build_object(
    'template', p_code, 'task_id', v_task.id, 'reason', 'Already exists (status: ' || v_task.status || ')'));
end
$$;

-- Idempotent backfill run by the gate processor (s06 createTasksForJob).
create function app.create_tasks_for_job(p_job_id uuid, p_booking_gates_ready boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_result jsonb := jsonb_build_object('created', '[]'::jsonb, 'skipped', '[]'::jsonb);
  v_key text;
  v_code text;
  v_next_9 timestamptz := app.london_at(app.next_staffed_date(now()), '09:00');
begin
  perform app.assert_normal_work(p_job_id);
  select * into v_job from public.jobs where id = p_job_id;

  if v_job.finance_route = 'Standard' then
    v_key := app.task_key('PRE01', p_job_id);
    v_result := app.push_task_result(v_result, 'PRE01', v_key,
      case when app.task_key_exists(v_key) then null
           else app.create_task_instance(p_job_id, 'PRE01', v_key, null, null, v_next_9, 1) end);
  end if;

  v_key := app.task_key('PRE02', p_job_id);
  v_result := app.push_task_result(v_result, 'PRE02', v_key,
    case when app.task_key_exists(v_key) then null
         else app.create_task_instance(p_job_id, 'PRE02', v_key, null, null, v_next_9, 1) end);

  if v_job.finance_route = 'Standard' then
    v_key := app.task_key('PRE03', p_job_id);
    v_result := app.push_task_result(v_result, 'PRE03', v_key,
      case when app.task_key_exists(v_key) then null
           else app.create_task_instance(p_job_id, 'PRE03', v_key, null, null, v_next_9, 2) end);
  end if;

  v_key := app.task_key('PRE04', p_job_id);
  v_result := app.push_task_result(v_result, 'PRE04', v_key,
    case when app.task_key_exists(v_key) then null
         else app.create_task_instance(p_job_id, 'PRE04', v_key, null, null, null, 2) end);

  -- The booking checklist, once a booking is linked.
  if v_job.booking_submission_id is not null then
    foreach v_code in array array['BKG01', 'BKG02', 'BKG03'] loop
      v_key := app.task_key(v_code, p_job_id);
      v_result := app.push_task_result(v_result, v_code, v_key,
        case when app.task_key_exists(v_key) then null
             else app.create_task_instance(p_job_id, v_code, v_key, null, null, null, 2) end);
    end loop;
  end if;

  -- BKG04/BKG05 only after confirmation, never pre-created from a match.
  if v_job.workflow_stage = 'Booked' or v_job.booking_approved_at is not null then
    foreach v_code in array array['BKG04', 'BKG05'] loop
      v_key := app.task_key(v_code, p_job_id);
      v_result := app.push_task_result(v_result, v_code, v_key,
        case when app.task_key_exists(v_key) then null
             else app.create_task_instance(p_job_id, v_code, v_key, null, null, now(), 2) end);
    end loop;
  end if;

  -- FIN01 interim draft check: the Friday on/before the install date, 17:00.
  if v_job.next_action_at is not null and p_booking_gates_ready then
    v_key := app.task_key('FIN01', p_job_id);
    v_result := app.push_task_result(v_result, 'FIN01', v_key,
      case when app.task_key_exists(v_key) then null
           else app.create_task_instance(p_job_id, 'FIN01', v_key, null, null,
                                app.london_at(app.friday_before(app.london_date(v_job.next_action_at)), '17:00'), 1) end);
  end if;

  -- Install date set but deposit not confirmed: chase (never blocks install).
  if v_job.next_action_at is not null and v_job.finance_route = 'Standard' and v_job.deposit_bank_confirmed_at is null then
    v_key := 'S06-UNPAID-INTERIM-' || p_job_id;
    v_result := app.push_task_result(v_result, 'S06-UNPAID-INTERIM', v_key,
      case when app.task_key_exists(v_key) then null
           else app.create_task_instance(p_job_id, 'S06-UNPAID-INTERIM', v_key, null, null, v_next_9, 1) end);
  end if;

  return v_result || jsonb_build_object('task_count', jsonb_array_length(v_result -> 'created'));
end
$$;

-- -----------------------------------------------------------------------------
-- Stage transitions
-- -----------------------------------------------------------------------------

create function app.transition_job(p_job_id uuid, p_stage text, p_reason text, p_extra jsonb default '{}'::jsonb)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.jobs;
  v_after public.jobs;
begin
  select * into v_before from public.jobs where id = p_job_id for update;
  update public.jobs set
    workflow_stage = p_stage,
    booking_approved_at = case when p_extra ? 'booking_approved_at' then (p_extra ->> 'booking_approved_at')::timestamptz
                               else booking_approved_at end,
    booking_approved_by = case when p_extra ? 'booking_approved_by' then (p_extra ->> 'booking_approved_by')::uuid
                               else booking_approved_by end
  where id = p_job_id
  returning * into v_after;
  perform app.audit('Jobs', p_job_id::text, 'WorkflowStage:' || p_stage, to_jsonb(v_before), to_jsonb(v_after), p_reason);
  return v_after;
end
$$;

-- Evaluates both gate sets, backfills tasks, then advances ONE stage:
-- Prebooking -> ReadyToBook (ready) or ReadyToBook -> BookingInProgress
-- (booking linked). BookingInProgress -> Booked belongs to CONFIRM_BOOKING.
create function app.process_booking_gates(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_readiness jsonb;
  v_gates jsonb;
  v_tasks jsonb := jsonb_build_object('created', '[]'::jsonb, 'skipped', '[]'::jsonb, 'task_count', 0);
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('error', 'JOB_NOT_FOUND', 'job_id', p_job_id);
  end if;

  v_readiness := app.evaluate_ready_to_book(p_job_id);
  v_gates := app.evaluate_booking_gates(p_job_id);
  if v_job.booking_submission_id is not null or exists (select 1 from public.presales ps where ps.job_id = v_job.id) then
    v_tasks := app.create_tasks_for_job(p_job_id, (v_gates ->> 'ready')::boolean);
  end if;

  if v_job.workflow_stage = 'Prebooking' and (v_readiness ->> 'ready')::boolean then
    perform app.transition_job(p_job_id, 'ReadyToBook', v_readiness ->> 'summary');
    v_readiness := v_readiness || jsonb_build_object('workflow_stage', 'ReadyToBook', 'stage_advanced', true);
  elsif v_job.workflow_stage = 'ReadyToBook' and v_job.booking_submission_id is not null then
    perform app.transition_job(p_job_id, 'BookingInProgress', v_readiness ->> 'summary');
    v_gates := v_gates || jsonb_build_object('workflow_stage', 'BookingInProgress', 'stage_advanced', true);
  end if;

  return jsonb_build_object('job_id', p_job_id, 'job_ref', v_job.job_ref, 'readiness', v_readiness,
    'gates', v_gates, 'tasks', v_tasks, 'success', not (v_gates ->> 'blocked')::boolean);
end
$$;

-- Post-command readiness hook: Prebooking -> run the gate processor;
-- ReadyToBook -> demote to Prebooking when readiness no longer holds. Never
-- touches BookingInProgress or later.
create function app.reevaluate_prebooking(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_readiness jsonb;
begin
  if p_job_id is null then
    return null;
  end if;
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return null;
  end if;
  if v_job.workflow_stage = 'Prebooking' then
    return app.process_booking_gates(p_job_id);
  end if;
  if v_job.workflow_stage = 'ReadyToBook' then
    v_readiness := app.evaluate_ready_to_book(p_job_id);
    if (v_readiness ->> 'ready')::boolean then
      return jsonb_build_object('readiness', v_readiness);
    end if;
    perform app.transition_job(p_job_id, 'Prebooking', coalesce(v_readiness ->> 'summary', 'PrebookingBlocked'));
    return jsonb_build_object('readiness', v_readiness || jsonb_build_object(
      'workflow_stage', 'Prebooking', 'stage_demoted', true, 'ready', false, 'blocked', true));
  end if;
  return null;
end
$$;

-- -----------------------------------------------------------------------------
-- S13: invoice stages at sale
-- -----------------------------------------------------------------------------

-- Deposit and interim stages at sale (25% / 35% by default); the balance
-- stage only once operational completion is recorded. net = round(gross/1.2).
-- Only the interim stage has a due date: the Friday on/before the install date.
create function app.build_invoice_stages(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_stage text;
  v_pct int;
  v_gross bigint;
  v_net bigint;
  v_created text[] := '{}';
begin
  perform app.assert_normal_work(p_job_id);
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null or not coalesce(v_job.original_gross_pence > 0, false) then
    return jsonb_build_object('ok', false, 'reason', 'Job not found or no gross amount');
  end if;
  foreach v_stage in array array['Deposit', 'Interim', 'Balance'] loop
    continue when v_stage = 'Balance' and v_job.operational_complete_at is null;
    continue when exists (select 1 from public.invoice_stages s where s.job_id = p_job_id and s.stage = v_stage);
    v_pct := coalesce((app.setting(case v_stage when 'Deposit' then 'finance.deposit_pct'
                                                when 'Interim' then 'finance.interim_pct'
                                                else 'finance.balance_pct' end) #>> '{}')::int,
                      case v_stage when 'Deposit' then 25 when 'Interim' then 35 else 40 end);
    v_gross := round(v_job.original_gross_pence * v_pct / 100.0);
    v_net := round(v_gross / 1.2);
    insert into public.invoice_stages (job_id, stage, amount_net_pence, vat_pence, gross_pence, due_date, status)
    values (p_job_id, v_stage, v_net, v_gross - v_net, v_gross,
            case when v_stage = 'Interim' and v_job.next_action_at is not null
                 then app.friday_before(app.london_date(v_job.next_action_at)) end,
            'Pending');
    v_created := v_created || v_stage;
  end loop;
  return jsonb_build_object('ok', true, 'stages_created', v_created,
    'final_blocked', v_job.operational_complete_at is null);
end
$$;

-- The sale (public.submit_presale) inserts the job; its invoice stages belong
-- at sale (reference: SOLD_INTAKE -> processJobPayments, milestone tasks off).
-- An AFTER INSERT trigger keeps that in the sale's transaction without
-- changing the Job Sold function.
create function app.jobs_build_invoice_stages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.build_invoice_stages(new.id);
  return null;
end
$$;

create trigger jobs_invoice_stages after insert on public.jobs
  for each row execute function app.jobs_build_invoice_stages();

-- Backfill jobs sold before this migration (skipping any paused by S15).
do $$
declare
  v_job uuid;
begin
  for v_job in select id from public.jobs
               where cancellation_at is null and workflow_stage not in ('CancellationInProgress', 'Cancelled') loop
    perform app.build_invoice_stages(v_job);
  end loop;
end
$$;
