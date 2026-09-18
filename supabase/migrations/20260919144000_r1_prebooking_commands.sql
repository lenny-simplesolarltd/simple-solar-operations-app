-- =============================================================================
-- Backend port, part 5: R1 prebooking commands.
--
--   (SOLD_INTAKE is public.submit_presale from the Job Sold migration)
--   TASK_COMPLETE        services.js _r1sTaskComplete (PRE01-PRE05 evidence rules)
--   TASK_REOPEN          services.js _r1sTaskReopen
--   TASK_EVIDENCE_ATTACH services.js _r1sTaskEvidenceAttach (PRE02)
--   DEPOSIT_CONFIRM      services.js _r1sDepositConfirm (legacy Director route)
--   BOOKING_GATES        services.js _r1sBookingGates
--   CONFIRM_BOOKING      services.js _r1sConfirmBooking + s06 confirmBookingFromEvaluatedGates
--
-- Every handler runs inside public.execute_command, which has already
-- resolved the actor, applied the authorization matrix and release modes,
-- and handled command_id idempotency. A raised refusal rolls everything back.
--
-- Deviations:
--   * evidence is a Supabase Storage path ("evidence_path") validated before
--     any write; the AppSheet upload-retry machinery is not ported.
--   * PRE05 accepts a same-job evidence upload/id and validates it (the
--     reference stored an unvalidated id - REF-03 §11.3).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared financial helpers
-- -----------------------------------------------------------------------------

-- The current contract value when set, else the sold value.
create function app.canonical_gross_pence(p_job public.jobs)
returns bigint
language plpgsql immutable
set search_path = ''
as $$
begin
  if not coalesce(p_job.original_gross_pence > 0, false) then
    perform app.fail('R1A_SOLD_VALUE_REQUIRED');
  end if;
  return case when coalesce(p_job.current_contract_gross_pence > 0, false)
              then p_job.current_contract_gross_pence else p_job.original_gross_pence end;
end
$$;

-- The job's single deposit invoice stage (never client-supplied), locked.
create function app.deposit_stage(p_job_id uuid, p_require_amount boolean default true)
returns public.invoice_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage public.invoice_stages;
begin
  if (select count(*) from public.invoice_stages s where s.job_id = p_job_id and lower(s.stage) = 'deposit') <> 1 then
    perform app.fail('R1A_DEPOSIT_STAGE_MISSING');
  end if;
  select * into v_stage from public.invoice_stages s
  where s.job_id = p_job_id and lower(s.stage) = 'deposit' for update;
  if p_require_amount and not coalesce(v_stage.gross_pence > 0, false) then
    perform app.fail('R1A_DEPOSIT_AMOUNT_REQUIRED');
  end if;
  return v_stage;
end
$$;

-- GBP amount -> pence for deposits (allow zero only for "not received").
create function app.deposit_amount_pence(p_value jsonb, p_allow_zero boolean)
returns bigint
language plpgsql immutable
set search_path = ''
as $$
declare
  v_pence bigint;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value #>> '{}' = '' then
    perform app.fail('R1A_REQUIRED_DEPOSIT_AMOUNT');
  end if;
  v_pence := app.pounds_to_pence(p_value, 'R1A_INVALID_DEPOSIT_AMOUNT');
  if v_pence is null or v_pence < 0 or (not p_allow_zero and v_pence = 0) then
    perform app.fail('R1A_INVALID_DEPOSIT_AMOUNT');
  end if;
  return v_pence;
end
$$;

-- Bank receipt date YYYY-MM-DD -> noon UTC; not more than a day ahead.
create function app.deposit_received_at(p_value jsonb)
returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_value #>> '{}', ''));
  v_at timestamptz;
begin
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    perform app.fail('R1A_INVALID_DEPOSIT_RECEIVED_DATE');
  end if;
  begin
    v_at := (v_text || 'T12:00:00Z')::timestamptz;
  exception when others then
    perform app.fail('R1A_INVALID_DEPOSIT_RECEIVED_DATE');
  end;
  if to_char(v_at at time zone 'UTC', 'YYYY-MM-DD') <> v_text or v_at > now() + interval '1 day' then
    perform app.fail('R1A_INVALID_DEPOSIT_RECEIVED_DATE');
  end if;
  return v_at;
end
$$;

-- Single write path for a successful manual deposit verification (PRE03
-- TASK_COMPLETE and DEPOSIT_CONFIRM): reconcile the amount against the
-- canonical deposit stage, record exactly one Confirmed bank check (reusing an
-- identical one), stamp the job summary and the stage. Never touches contract
-- or invoice amounts.
create function app.record_deposit_confirmation(p_job_id uuid, p_amount_pence bigint,
                                                p_received_at timestamptz, p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app.context_actor_id();
  v_ref text := nullif(btrim(p_reference), '');
  v_stage public.invoice_stages;
  v_job public.jobs;
  v_check public.manual_bank_checks;
begin
  if v_ref is null then
    perform app.fail('R1A_REQUIRED_DEPOSIT_BANK_REFERENCE');
  end if;
  v_stage := app.deposit_stage(p_job_id);
  if p_amount_pence <> v_stage.gross_pence then
    perform app.fail('R1A_DEPOSIT_AMOUNT_MISMATCH');
  end if;
  select * into v_check from public.manual_bank_checks c
  where c.job_id = p_job_id and lower(c.stage) = 'deposit' and c.outcome = 'Confirmed' and c.checked_by = v_actor
    and c.amount_pence = p_amount_pence and c.evidence_reference = v_ref and c.checked_at = p_received_at
  limit 1;
  if v_check.id is null then
    insert into public.manual_bank_checks (job_id, stage, checked_at, checked_by, amount_pence, outcome,
                                           evidence_reference, command_id)
    values (p_job_id, 'Deposit', p_received_at, v_actor, p_amount_pence, 'Confirmed', v_ref, app.context_command_id())
    returning * into v_check;
  end if;
  if not (v_stage.status = 'Confirmed' and v_stage.reference = v_ref) then
    update public.invoice_stages set status = 'Confirmed', reference = v_ref where id = v_stage.id
    returning * into v_stage;
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not (v_job.deposit_bank_confirmed_at is not distinct from p_received_at
          and v_job.deposit_bank_confirmed_by is not distinct from v_actor
          and v_job.deposit_bank_reference is not distinct from v_ref) then
    update public.jobs set deposit_bank_confirmed_at = p_received_at, deposit_bank_confirmed_by = v_actor,
                           deposit_bank_reference = v_ref
    where id = p_job_id returning * into v_job;
  end if;
  return jsonb_build_object('job', to_jsonb(v_job), 'stage', to_jsonb(v_stage), 'bank_check', to_jsonb(v_check));
end
$$;

-- PRE02: record the signed contract on the job (Signed + reference + evidence).
create function app.apply_pre02_contract(p_job_id uuid, p_evidence_id uuid, p_contract_id text)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_ref text;
begin
  select * into v_job from public.jobs where id = p_job_id for update;
  v_ref := coalesce(nullif(btrim(p_contract_id), ''), nullif(btrim(v_job.contract_id), ''));
  if v_ref is null then
    perform app.fail('R1A_REQUIRED_CONTRACT_ID');
  end if;
  if v_job.contract_status = 'Signed' and v_job.contract_evidence_id = p_evidence_id
     and v_job.contract_signed_at is not null and v_job.contract_id = v_ref then
    return v_job;
  end if;
  update public.jobs set contract_status = 'Signed', contract_id = v_ref, contract_evidence_id = p_evidence_id,
                         contract_signed_at = coalesce(contract_signed_at, now())
  where id = p_job_id returning * into v_job;
  return v_job;
end
$$;

-- -----------------------------------------------------------------------------
-- TASK_COMPLETE
-- -----------------------------------------------------------------------------

-- services.js _r1sContractSignedFlag.
create function app.pre02_contract_signed(p_value jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select app.yes_flag(p_value) or lower(btrim(coalesce(p_value #>> '{}', ''))) = 'signed'
$$;

-- services.js _r1sPre02AwaitingSignature: "sent is not signed".
create function app.pre02_awaiting_signature(p_payload jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when app.pre02_contract_signed(p_payload -> 'contract_signed') then false
    when p_payload -> 'contract_signed' = 'false'::jsonb then true
    when lower(btrim(coalesce(p_payload ->> 'contract_signed', ''))) in
         ('no', 'false', '0', 'n', 'sent', 'awaiting', 'awaiting_signature', 'awaiting-signature') then true
    else lower(btrim(coalesce(p_payload ->> 'outcome', ''))) in
         ('awaiting_signature', 'awaiting-signature', 'awaitingsignature', 'sent', 'awaiting')
  end
$$;

-- Records a negative/partial outcome: the task moves to Waiting with a
-- machine-readable blocking_reason and a follow-up on the next staffed day.
create function app.task_follow_up(p_task public.tasks, p_note text, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after public.tasks;
begin
  update public.tasks set status = 'Waiting', completed_at = null, completed_by = null, completion_note = p_note,
                          blocking_reason = p_reason,
                          next_followup_at = app.london_at(app.next_staffed_date(now()), '09:00')
  where id = p_task.id returning * into v_after;
  perform app.task_event(p_task, v_after, 'FollowUp', p_note);
  perform app.audit('Tasks', p_task.id::text, 'FollowUp', to_jsonb(p_task), to_jsonb(v_after), p_note);
  return v_after;
end
$$;

create function app.cmd_task_complete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_task public.tasks;
  v_after public.tasks;
  v_job public.jobs;
  v_note text;
  v_code text;
  v_evidence uuid;
  v_outcome text;
  v_stage public.invoice_stages;
  v_amount bigint;
  v_received timestamptz;
  v_check public.manual_bank_checks;
  v_recorded jsonb;
  v_verified bigint;
  v_readiness jsonb;
  v_follow text;
begin
  v_p := app.payload(p_request,
    array['completion_note', 'evidence_id', 'evidence_path', 'invoice_number', 'invoice_sent', 'outcome',
          'contract_id', 'contract_signed', 'customer_details_verified', 'sold_value_verified',
          'verified_gross_amount', 'deposit_bank_confirmed', 'deposit_amount', 'deposit_received_date',
          'deposit_bank_reference'],
    array['completion_note']);
  v_note := app.txt(v_p, 'completion_note');
  v_outcome := lower(app.txt(v_p, 'outcome'));

  select * into v_task from public.tasks where id = app.ref(p_request, 'task_id') for update;
  if v_task.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_task.status not in ('Open', 'Waiting', 'InProgress') or v_task.revision_required then
    perform app.fail('R1A_TASK_NOT_COMPLETABLE');
  end if;
  v_code := v_task.template_code;
  if v_code in ('PRE01', 'PRE02', 'PRE03', 'PRE04', 'PRE05') and v_task.job_id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  v_evidence := v_task.evidence_id;

  -- ---- PRE01: deposit invoice sent ------------------------------------------
  if v_code = 'PRE01' then
    if v_outcome in ('failed', 'failure', 'follow_up', 'follow-up', 'followup') then
      v_after := app.task_follow_up(v_task, v_note, 'PRE01_INVOICE_SEND_FAILED');
      v_follow := 'FollowUpRequired';
    else
      if app.txt(v_p, 'invoice_number') is null then
        perform app.fail('R1A_REQUIRED_INVOICE_NUMBER');
      end if;
      if not (app.yes_flag(v_p -> 'invoice_sent') or lower(app.txt(v_p, 'invoice_sent')) = 'sent') then
        perform app.fail('R1A_REQUIRED_INVOICE_SENT');
      end if;
      v_stage := app.deposit_stage(v_task.job_id, false);
      update public.invoice_stages set invoice_number = app.txt(v_p, 'invoice_number'), sent_at = now(),
        status = case when status in ('Confirmed', 'Paid', 'PartPaid', 'Voided', 'Credited') then status else 'Sent' end
      where id = v_stage.id returning * into v_stage;
    end if;

  -- ---- PRE02: contract sent / signed ----------------------------------------
  elsif v_code = 'PRE02' then
    if app.txt(v_p, 'contract_id') is null then
      perform app.fail('R1A_REQUIRED_CONTRACT_ID');
    end if;
    if app.pre02_awaiting_signature(v_p) then
      -- Sent is not signed: record Sent on the job, never Complete.
      select * into v_job from public.jobs where id = v_task.job_id for update;
      if v_job.contract_status = 'Signed' and v_job.contract_evidence_id is not null then
        perform app.fail('R1A_CONTRACT_ALREADY_SIGNED');
      end if;
      if not (v_job.contract_status = 'Sent' and v_job.contract_id = app.txt(v_p, 'contract_id')) then
        update public.jobs set contract_status = 'Sent', contract_id = app.txt(v_p, 'contract_id') where id = v_job.id;
      end if;
      v_after := app.task_follow_up(v_task, v_note, 'PRE02_AWAITING_SIGNATURE');
      v_follow := 'FollowUpRequired';
    else
      if not app.pre02_contract_signed(v_p -> 'contract_signed') then
        perform app.fail('R1A_REQUIRED_CONTRACT_SIGNED');
      end if;
      if app.txt(v_p, 'evidence_path') is not null then
        v_evidence := app.ensure_evidence(v_task.job_id, 'Contract', app.txt(v_p, 'evidence_path'));
        if app.txt(v_p, 'evidence_id') is not null and app.txt(v_p, 'evidence_id') <> v_evidence::text then
          perform app.fail('R1A_EVIDENCE_CONFLICT');
        end if;
      else
        v_evidence := app.job_evidence(v_task.job_id, coalesce(app.txt(v_p, 'evidence_id'), v_task.evidence_id::text),
                                       'R1A_REQUIRED_CONTRACT_EVIDENCE');
      end if;
    end if;

  -- ---- PRE03: explicit manual bank check -------------------------------------
  elsif v_code = 'PRE03' then
    if not app.yes_flag(v_p -> 'deposit_bank_confirmed') and not app.no_flag(v_p -> 'deposit_bank_confirmed') then
      perform app.fail('R1A_REQUIRED_DEPOSIT_BANK_CONFIRMED');
    end if;
    v_stage := app.deposit_stage(v_task.job_id);
    if app.no_flag(v_p -> 'deposit_bank_confirmed') then
      -- Explicit "not received": recorded, never Complete.
      v_amount := case when app.txt(v_p, 'deposit_amount') is null then 0
                       else app.deposit_amount_pence(v_p -> 'deposit_amount', true) end;
      v_received := case when app.txt(v_p, 'deposit_received_date') is null then now()
                         else app.deposit_received_at(v_p -> 'deposit_received_date') end;
      insert into public.manual_bank_checks (job_id, stage, checked_at, checked_by, amount_pence, outcome,
                                             evidence_reference, command_id)
      values (v_task.job_id, 'Deposit', v_received, app.actor_id(p_actor), v_amount, 'NotReceived',
              app.txt(v_p, 'deposit_bank_reference'), app.context_command_id())
      returning * into v_check;
      v_after := app.task_follow_up(v_task, v_note, 'PRE03_DEPOSIT_NOT_RECEIVED');
      v_follow := 'FollowUpRequired';
    else
      if app.txt(v_p, 'deposit_amount') is null then
        perform app.fail('R1A_REQUIRED_DEPOSIT_AMOUNT');
      end if;
      if app.txt(v_p, 'deposit_received_date') is null then
        perform app.fail('R1A_REQUIRED_DEPOSIT_RECEIVED_DATE');
      end if;
      if app.txt(v_p, 'deposit_bank_reference') is null then
        perform app.fail('R1A_REQUIRED_DEPOSIT_BANK_REFERENCE');
      end if;
      v_amount := app.deposit_amount_pence(v_p -> 'deposit_amount', false);
      v_received := app.deposit_received_at(v_p -> 'deposit_received_date');
      if v_amount <> v_stage.gross_pence then
        insert into public.manual_bank_checks (job_id, stage, checked_at, checked_by, amount_pence, outcome,
                                               evidence_reference, command_id)
        values (v_task.job_id, 'Deposit', v_received, app.actor_id(p_actor), v_amount, 'AmountMismatch',
                app.txt(v_p, 'deposit_bank_reference'), app.context_command_id())
        returning * into v_check;
        v_after := app.task_follow_up(v_task, v_note, 'PRE03_DEPOSIT_AMOUNT_MISMATCH');
        v_follow := 'FollowUpRequired';
      else
        -- Documentary evidence is optional and never replaces the bank check.
        v_recorded := app.record_deposit_confirmation(v_task.job_id, v_amount, v_received,
                                                      app.txt(v_p, 'deposit_bank_reference'));
      end if;
    end if;

  -- ---- PRE04: customer details and sold value --------------------------------
  elsif v_code = 'PRE04' then
    if not app.yes_flag(v_p -> 'customer_details_verified') and not app.no_flag(v_p -> 'customer_details_verified') then
      perform app.fail('R1A_REQUIRED_CUSTOMER_DETAILS_VERIFIED');
    end if;
    if not app.yes_flag(v_p -> 'sold_value_verified') and not app.no_flag(v_p -> 'sold_value_verified') then
      perform app.fail('R1A_REQUIRED_SOLD_VALUE_VERIFIED');
    end if;
    select * into v_job from public.jobs where id = v_task.job_id for update;
    if app.no_flag(v_p -> 'customer_details_verified') then
      v_follow := 'PRE04_CUSTOMER_DETAILS_MISMATCH';
    elsif app.no_flag(v_p -> 'sold_value_verified') then
      v_follow := 'PRE04_SOLD_VALUE_MISMATCH';
    else
      if app.txt(v_p, 'verified_gross_amount') is null then
        perform app.fail('R1A_REQUIRED_VERIFIED_GROSS_AMOUNT');
      end if;
      v_verified := app.pounds_to_pence(v_p -> 'verified_gross_amount');
      if v_verified <> app.canonical_gross_pence(v_job) then
        v_follow := 'PRE04_VALUE_MISMATCH';
      end if;
    end if;
    if v_follow is not null then
      if v_job.sold_booking_match_status <> 'Review' then
        update public.jobs set sold_booking_match_status = 'Review' where id = v_job.id;
      end if;
      v_after := app.task_follow_up(v_task, v_note, v_follow);
      v_follow := 'FollowUpRequired';
    else
      -- Documentary upload optional; structured verification is authoritative.
      if app.txt(v_p, 'evidence_path') is not null then
        v_evidence := app.ensure_evidence(v_task.job_id, 'CustomerDetails', app.txt(v_p, 'evidence_path'));
      elsif app.txt(v_p, 'evidence_id') is not null then
        v_evidence := app.job_evidence(v_task.job_id, app.txt(v_p, 'evidence_id'), 'R1A_EVIDENCE_NOT_FOUND');
      end if;
      if not (v_job.customer_details_verified_at is not null and v_job.customer_details_verified_by is not null
              and v_job.sold_booking_match_status = 'Match' and nullif(btrim(v_job.valuation_basis), '') is not null) then
        update public.jobs set
          customer_details_verified_at = coalesce(customer_details_verified_at, now()),
          customer_details_verified_by = coalesce(customer_details_verified_by, app.actor_id(p_actor)),
          sold_booking_match_status = 'Match',
          valuation_basis = coalesce(nullif(btrim(valuation_basis), ''), 'Standard')
        where id = v_job.id;
      end if;
    end if;

  -- ---- PRE05 and every other template: note (+ optional evidence) ------------
  else
    if app.txt(v_p, 'evidence_path') is not null and v_task.job_id is not null then
      v_evidence := app.ensure_evidence(v_task.job_id,
        case when v_code = 'PRE05' then 'FinanceAgreement' else 'TaskEvidence' end, app.txt(v_p, 'evidence_path'));
    elsif app.txt(v_p, 'evidence_id') is not null and v_task.job_id is not null then
      v_evidence := app.job_evidence(v_task.job_id, app.txt(v_p, 'evidence_id'), 'R1A_EVIDENCE_NOT_FOUND');
    end if;
  end if;

  if v_follow is null then
    update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.actor_id(p_actor),
                            completion_note = v_note, evidence_id = v_evidence, blocking_reason = null
    where id = v_task.id returning * into v_after;
    perform app.task_event(v_task, v_after, 'Complete', v_note);
    if v_code = 'PRE02' then
      perform app.apply_pre02_contract(v_task.job_id, v_evidence, app.txt(v_p, 'contract_id'));
    end if;
    perform app.audit('Tasks', v_task.id::text, 'Complete', to_jsonb(v_task), to_jsonb(v_after), v_note);
  end if;

  if v_task.job_id is not null and v_code in ('PRE01', 'PRE02', 'PRE03', 'PRE04', 'PRE05') then
    v_readiness := app.reevaluate_prebooking(v_task.job_id);
  end if;

  select * into v_after from public.tasks where id = v_task.id;
  select * into v_job from public.jobs where id = v_task.job_id;
  return jsonb_build_object(
    'status', coalesce(v_follow, 'Completed'),
    'task', to_jsonb(v_after),
    'job', case when v_job.id is not null then to_jsonb(v_job) end,
    'invoice_stage', case when v_code in ('PRE01', 'PRE03') and v_task.job_id is not null then
                       (select to_jsonb(s) from public.invoice_stages s where s.job_id = v_task.job_id and lower(s.stage) = 'deposit') end,
    'bank_check', coalesce(to_jsonb(v_check), v_recorded -> 'bank_check'),
    'readiness', v_readiness -> 'readiness',
    'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- TASK_REOPEN
-- -----------------------------------------------------------------------------

-- Complete/NotRequired -> Open. Keeps completion_note, evidence_id and all
-- history; clears only completed_at/by. Gating PRE tasks re-evaluate
-- readiness (a ReadyToBook job may be demoted).
create function app.cmd_task_reopen(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['reopen_reason'], array['reopen_reason']);
  v_task public.tasks;
  v_after public.tasks;
  v_readiness jsonb;
begin
  select * into v_task from public.tasks where id = app.ref(p_request, 'task_id') for update;
  if v_task.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_task.status not in ('Complete', 'NotRequired') then
    perform app.fail('R1A_TASK_NOT_REOPENABLE');
  end if;
  update public.tasks set status = 'Open', completed_at = null, completed_by = null
  where id = v_task.id returning * into v_after;
  perform app.task_event(v_task, v_after, 'Reopen', app.txt(v_p, 'reopen_reason'));
  if v_task.job_id is not null and v_task.template_code in ('PRE01', 'PRE02', 'PRE03', 'PRE04', 'PRE05') then
    v_readiness := app.reevaluate_prebooking(v_task.job_id);
  end if;
  perform app.audit('Tasks', v_task.id::text, 'Reopen', to_jsonb(v_task), to_jsonb(v_after), app.txt(v_p, 'reopen_reason'));
  select * into v_after from public.tasks where id = v_task.id;
  return jsonb_build_object('status', 'Reopened', 'task', to_jsonb(v_after),
    'job', (select to_jsonb(j) from public.jobs j where j.id = v_task.job_id),
    'readiness', v_readiness -> 'readiness', 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- TASK_EVIDENCE_ATTACH (PRE02 only)
-- -----------------------------------------------------------------------------

-- Pending (open PRE02): store the signed-contract evidence on the task, do
-- not complete it. Repair (Complete PRE02 without evidence): attach, stamp
-- the job contract and re-evaluate readiness; completion fields untouched.
create function app.cmd_task_evidence_attach(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  perform app.audit('Tasks', v_task.id::text, 'EvidenceAttach', to_jsonb(v_task), to_jsonb(v_after),
                    app.txt(v_p, 'evidence_path'));
  return jsonb_build_object(
    'status', case when v_mode = 'Pending' then 'EvidenceUploaded' else 'Attached' end,
    'completion_required', v_mode = 'Pending',
    'task', (select to_jsonb(t) from public.tasks t where t.id = v_task.id),
    'job', (select to_jsonb(j) from public.jobs j where j.id = v_task.job_id),
    'evidence_id', v_evidence, 'readiness', v_readiness -> 'readiness', 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- DEPOSIT_CONFIRM (legacy Director route, FN-15 Manual)
-- -----------------------------------------------------------------------------

-- Same facts and the same recorder as PRE03; never completes the PRE03 task.
create function app.cmd_deposit_confirm(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['reference', 'deposit_bank_confirmed', 'deposit_amount', 'deposit_received_date'],
                           array['reference', 'deposit_bank_confirmed', 'deposit_amount', 'deposit_received_date']);
  v_job public.jobs;
  v_before public.jobs;
  v_amount bigint;
  v_received timestamptz;
  v_recorded jsonb;
  v_readiness jsonb;
begin
  if not app.yes_flag(v_p -> 'deposit_bank_confirmed') then
    perform app.fail('R1A_DEPOSIT_NOT_CONFIRMED');
  end if;
  v_amount := app.deposit_amount_pence(v_p -> 'deposit_amount', false);
  v_received := app.deposit_received_at(v_p -> 'deposit_received_date');
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if v_job.deposit_bank_confirmed_at is not null
     and (app.bank_confirmation_evidence(v_job.id) ->> 'pass')::boolean then
    return jsonb_build_object('status', 'AlreadyConfirmed', 'job', to_jsonb(v_job), 'readiness', null, 'external_calls', 0);
  end if;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  v_before := v_job;
  v_recorded := app.record_deposit_confirmation(v_job.id, v_amount, v_received, app.txt(v_p, 'reference'));
  v_readiness := app.reevaluate_prebooking(v_job.id);
  select * into v_job from public.jobs where id = v_job.id;
  perform app.audit('Jobs', v_job.id::text, 'DepositConfirm', to_jsonb(v_before), to_jsonb(v_job), app.txt(v_p, 'reference'));
  return jsonb_build_object('status', 'Confirmed', 'job', to_jsonb(v_job), 'bank_check', v_recorded -> 'bank_check',
    'readiness', v_readiness -> 'readiness', 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- BOOKING_GATES (explicit re-evaluation)
-- -----------------------------------------------------------------------------

create function app.cmd_booking_gates(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_before public.jobs;
  v_res jsonb;
begin
  perform app.payload(p_request, '{}');
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  v_before := v_job;
  v_res := app.process_booking_gates(v_job.id);
  select * into v_job from public.jobs where id = v_job.id;
  perform app.audit('Jobs', v_job.id::text, 'BookingGates', to_jsonb(v_before), to_jsonb(v_job),
                    v_res #>> '{gates,summary}');
  return jsonb_build_object(
    'status', case when v_job.workflow_stage = 'ReadyToBook' then 'ReadyToBook'
                   when v_job.workflow_stage = 'BookingInProgress' then 'BookingInProgress'
                   when (v_res #>> '{gates,blocked}')::boolean then 'Blocked' else 'NeedsReview' end,
    'readiness', v_res -> 'readiness', 'gates', v_res -> 'gates', 'tasks', v_res -> 'tasks',
    'success', v_res -> 'success', 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- CONFIRM_BOOKING
-- -----------------------------------------------------------------------------

-- BookingInProgress -> Booked when the canonical booking gates pass; stamps
-- the approval and creates BKG04/BKG05 once. There is no override.
create function app.cmd_confirm_booking(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['submitted_by']);
  v_job public.jobs;
  v_gates jsonb;
  v_owner uuid;
  v_created jsonb := '[]'::jsonb;
  v_code text;
  v_task_id uuid;
begin
  if app.txt(v_p, 'submitted_by') is not null
     and lower(app.txt(v_p, 'submitted_by')) not in (lower(p_actor ->> 'id'), p_actor ->> 'email') then
    perform app.fail('R1A_ACTOR_MISMATCH');
  end if;
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  -- Already confirmed: report it, never transition again or re-create tasks.
  if v_job.workflow_stage = 'Booked' or v_job.booking_approved_at is not null then
    return jsonb_build_object('status', 'AlreadyBooked', 'job_id', v_job.id, 'job_ref', v_job.job_ref,
      'version', v_job.version, 'workflow_stage', v_job.workflow_stage,
      'booking_approved_at', v_job.booking_approved_at, 'booking_approved_by', v_job.booking_approved_by,
      'tasks_created', '[]'::jsonb, 'external_calls', 0);
  end if;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_job.workflow_stage <> 'BookingInProgress' then
    perform app.fail('R1A_STAGE_NOT_BOOKING_IN_PROGRESS');
  end if;
  v_gates := app.evaluate_booking_gates(v_job.id);
  if not (v_gates ->> 'ready')::boolean then
    perform app.fail('R1A_BOOKING_GATES_NOT_SATISFIED', jsonb_build_object(
      'job_id', v_job.id, 'job_ref', v_job.job_ref,
      'outstanding', (select jsonb_agg(g -> 'name') from jsonb_array_elements(v_gates -> 'gates') g
                      where not (g ->> 'pass')::boolean)));
  end if;

  -- Owners come from the BKG04/BKG05 assignment rules.
  v_owner := null;
  v_job := app.transition_job(v_job.id, 'Booked', 'Booking confirmed',
    jsonb_build_object('booking_approved_at', now(), 'booking_approved_by', app.actor_id(p_actor)));
  foreach v_code in array array['BKG04', 'BKG05'] loop
    v_task_id := app.create_task_instance(v_job.id, v_code, app.task_key(v_code, v_job.id), v_owner, null, now(), 2);
    if v_task_id is not null then
      v_created := v_created || to_jsonb(v_code);
    end if;
  end loop;
  select * into v_job from public.jobs where id = v_job.id;
  return jsonb_build_object('status', 'Booked', 'job_id', v_job.id, 'job_ref', v_job.job_ref,
    'version', v_job.version, 'workflow_stage', v_job.workflow_stage,
    'booking_approved_at', v_job.booking_approved_at, 'booking_approved_by', v_job.booking_approved_by,
    'tasks_created', v_created, 'external_calls', 0);
end
$$;
