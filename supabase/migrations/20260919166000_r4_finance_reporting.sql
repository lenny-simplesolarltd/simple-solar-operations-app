-- =============================================================================
-- Backend port, R4: finance (S13 payments beyond R1, Xero adapter), reporting
-- (S14) and archive (S16 FN-13).
--
-- Reference: s13/payments.js, xero/adapter.js, s14/reporting.js,
-- s16/health.js (archive: _s16ArchiveEligibility / _s16ArchiveJob /
-- _s16ReopenArchivedJob), tests/s13, s14, resilience (XO 01-05), s16 10-22.
-- Survey: REF-03 §1.1 (S13, S14, S16), REF-04 §1.8, §4, §7, §8.
--
-- R1 already owns (not redefined here): app.build_invoice_stages (Deposit and
-- Interim at sale, Balance at operational completion, net = round(gross/1.2)),
-- DEPOSIT_CONFIRM / PRE03 manual bank checks, GHL01 + ghl_tasks at
-- operational completion, S06-UNPAID-INTERIM.
--
-- What this file adds
--   S13  Xero invoice intents (outbox XeroInvoice, CAPTURE_ONLY), created in
--        the same transaction as the invoice stage when FN-09 is Automated
--        (trigger on invoice_stages) or on demand (XERO_INTENT_CREATE).
--        Milestone tasks S13-INTERIM-CHASE (FIN02: Friday before the first
--        installation work, interim unpaid) and S13-GHL-PROGRESSION (+ ghl_tasks
--        readiness "payment-complete") via app.s13_run_milestones (scheduler)
--        and after each payment callback.
--   Xero adapter (FN-09, disabled by default) - Xero-specific SQL only:
--        app.xero_envelope, app.xero_dispatch_status, app.xero_prepare_dispatch,
--        app.xero_note_dispatch_outcome, app.xero_retry_policy,
--        app.xero_apply_invoice_callback, app.xero_apply_payment_callback,
--        command XERO_REVIEW_CANCEL_INVOICE (never deletes; review task).
--   S14  app.s14_job_financial_summary, app.s14_reconcile_payments,
--        app.s14_invoice_status, immutable report_snapshots
--        (REPORT_SNAPSHOT_CREATE); reads FINANCE_SUMMARY,
--        PAYMENT_RECONCILIATION, INVOICE_STATUS, XERO_REQUESTS.
--   S16  archive eligibility (read ARCHIVE_ELIGIBILITY), ARCHIVE_JOB,
--        REOPEN_ARCHIVED_JOB with archive_index.
--
-- Worker contract (Xero; the generic outbox protocol app.outbox_claim /
-- app.outbox_record_success / _failure / _uncertain belongs to another module):
--   1. app.xero_dispatch_status() -> live_ready. When false (xero.mode setting
--      is not "LIVE" or FN-09 is not Automated) do NOT claim XeroInvoice rows:
--      the reference leaves intents Pending with no writes ("DISABLED").
--   2. claim XeroInvoice rows with the generic protocol (marks Processing and
--      counts the attempt BEFORE the call).
--   3. app.xero_prepare_dispatch(outbox_id) -> {send:false} when the envelope
--      is blocked (ALREADY_LINKED, CONTACT_NOT_CONFIGURED, ZERO_AMOUNT,
--      STAGE_NOT_FOUND): the row is already moved to NeedsReview, nothing to
--      send. {send:true, envelope} otherwise; invoice_stages.request_id is
--      stamped with the intent id. Send the envelope to the approved
--      Zapier/Xero route (request_id = outbox id, reference <job_ref>-<code>,
--      create_as DRAFT).
--   4. accepted -> generic success with external_id = route request ref;
--      timeout / no response -> generic uncertain (NeedsReview, never retried
--      blindly); other error -> generic failure with app.xero_retry_policy():
--      3 attempts max, next attempt after 2^attempt minutes, then NeedsReview.
--      Call app.xero_note_dispatch_outcome(outbox_id, outcome, detail) in the
--      same transaction for the invoice-stage audit (XeroRequestSent /
--      XeroRequestUncertain / XeroRequestFailed).
--   5. Route callbacks: app.xero_apply_invoice_callback (stores returned
--      xero_invoice_id / invoice_number / status) and
--      app.xero_apply_payment_callback (Payments "Reported"; never a manual
--      bank check). Both idempotent. A human OUTBOX_RESOLVE MarkSucceeded does
--      NOT link the stage: link through the invoice callback.
--
-- Deviations
--   * Paid totals exclude Payments with status Reversed everywhere (the
--     adapter excluded them, s14 summed every status; Reversed is never
--     written by the reference).
--   * An invoice callback with a conflicting Xero id records the review
--     (outbox NeedsReview + audit) and returns status NeedsReview instead of
--     throwing: the reference kept that write because its store had no
--     transaction; a raised error here would roll it back.
--   * No intent is created for a stage already invoiced through the existing
--     route (xero_invoice_id, invoice_number or sent_at set): REF-04 §3 R4
--     "adopt existing invoice IDs"; a new draft would duplicate the invoice.
--   * Archive six-month rule uses the threshold date (completion date + 6
--     calendar months, the reference's own threshold_date) instead of the
--     month-index difference, which passed up to 30 days early.
--   * Archive "no live outbox" uses every outbox row related to the job
--     (app.s15_job_outbox_ids: calendar, communications, correlated rows),
--     not only the job/XI correlation ids.
--   * Owners from task_assignment_rules (REF-03 §11.14), not PERSON-tanya.
--   * XO-REVIEW-CANCEL: one task per stage ever (instance_key rule); the
--     reference re-inserted the same task id and failed on a closed one.
--   * Reference DEV guards, xeroMode config object and fixtures not ported;
--     xero.mode is a setting ("LIVE" enables dispatch; absent = DISABLED).
--
-- Not ported (no reference logic): Phoenix FN-10 (only finance_route
-- validation and S15-CAN-PHOENIX exist), accounting_events (no writer), job
-- costs (summed into the summary only), Payments "Reconciled" (never set),
-- jobs.financial_status (never derived by the reference), backup/service.js
-- (Supabase backups/PITR - plumbing, REF-04 §6).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuration
-- -----------------------------------------------------------------------------

insert into public.task_templates (code, title, task_group, default_priority, due_rule, guidance, template_version) values
  ('S13-INTERIM-CHASE', 'Chase unpaid interim payment', 'Finance', 1, 'at_creation', 'Payment chase outcome', 'S13-1.0'),
  ('XO-REVIEW-CANCEL', 'Review/cancel Xero invoice', 'Finance', 1, 'at_creation',
   'Supported Xero action taken (draft delete, void/credit or local cancel); never deleted automatically', 'XO-1.0')
on conflict (code) do nothing;

-- One un-restored archive entry per job (reference: at most one ARCHIVE-* row
-- without restored_at per job).
create unique index archive_index_open_job_key on public.archive_index (job_id) where restored_at is null;

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Worker / scheduler context (no human actor; the call key correlates audit).
create function app.r4_worker_context(p_service text, p_call_id text)
returns void
language sql
set search_path = ''
as $$
  select set_config('app.executing_service', p_service, true),
         set_config('app.actor_id', '', true),
         set_config('app.command_id', coalesce(p_call_id, ''), true);
$$;

-- Job readable/actionable for finance work: Admin/Manager/Director/Finance
-- organisation-wide, anyone else only on jobs they are assigned to.
create function app.r4_job_access(p_actor jsonb, p_job_id uuid)
returns public.jobs
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  if p_job_id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.has_role(p_actor, 'Admin', 'Manager', 'Director', 'Finance') and not app.is_assigned(p_actor, p_job_id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  return v_job;
end
$$;

-- Read requests: only the listed keys (plus read_type).
create function app.r4_read_keys(p_request jsonb, p_allowed text[])
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_request) loop
    if not (v_key = 'read_type' or v_key = any (p_allowed)) then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;
end
$$;

-- YYYY-MM-DD text -> date, or the given refusal.
create function app.r4_date(p_value text, p_code text)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    perform app.fail(p_code);
  end if;
  begin
    v := p_value::date;
  exception when others then
    perform app.fail(p_code);
  end;
  if to_char(v, 'YYYY-MM-DD') <> p_value then
    perform app.fail(p_code);
  end if;
  return v;
end
$$;

-- Paid total of a stage (Reversed payments excluded - see Deviations).
create function app.s13_stage_paid(p_stage_id uuid)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(p.amount_pence), 0)::bigint from public.payments p
  where p.invoice_stage_id = p_stage_id and p.status <> 'Reversed'
$$;

-- Xero reference stage codes (xero/adapter.js:14). Balance and Final share BAL.
create function app.xero_stage_code(p_stage text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_stage when 'Deposit' then 'DEP' when 'Interim' then 'INT' when 'Balance' then 'BAL'
                      when 'Final' then 'BAL' when 'Variation' then 'VAR' when 'Finance' then 'FIN'
                      when 'RefundReview' then 'REF' else upper(left(p_stage, 3)) end
$$;

-- Normal work allowed (the S15 guard as a boolean, for schedulers that skip).
create function app.r4_normal_work(p_job_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.assert_normal_work(p_job_id);
  return true;
exception when others then
  return false;
end
$$;

-- -----------------------------------------------------------------------------
-- S13: Xero invoice intents (createXeroIntent)
-- -----------------------------------------------------------------------------

-- One capture-only XeroInvoice outbox row per stage (reference XI-{job}-{stage},
-- idempotency key S13-XERO-{job}-{stage}). Never calls Xero.
create function app.s13_xero_intent(p_stage public.invoice_stages)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'S13-XERO-' || p_stage.job_id || '-' || p_stage.stage;
  v_out public.outbox;
begin
  perform app.assert_normal_work(p_stage.job_id);
  select * into v_out from public.outbox where idempotency_key = v_key;
  if found then
    return jsonb_build_object('ok', true, 'created', false, 'intent_id', v_out.id, 'stage', p_stage.stage,
                              'reason', 'Already exists');
  end if;
  -- Deviation: a stage invoiced through the existing route is adopted, not re-requested.
  if p_stage.xero_invoice_id is not null or p_stage.invoice_number is not null or p_stage.sent_at is not null then
    return jsonb_build_object('ok', true, 'created', false, 'intent_id', null, 'stage', p_stage.stage,
                              'reason', 'ALREADY_INVOICED');
  end if;
  insert into public.outbox (idempotency_key, action_type, target, payload_hash, job_revision, attempt_count,
                             next_attempt, response_summary, correlation_id, status)
  values (v_key, 'XeroInvoice', coalesce(p_stage.xero_contact_id, 'NOT_CONFIGURED'),
          jsonb_build_object('job_id', p_stage.job_id, 'stage_id', p_stage.id, 'stage', p_stage.stage,
                             'gross_pence', p_stage.gross_pence)::text,
          p_stage.version, 0, now(), 'CAPTURE_ONLY: no Xero API call',
          'XI-' || p_stage.job_id || '-' || p_stage.stage, 'Pending')
  returning * into v_out;
  perform app.audit('Outbox', v_out.id::text, 'XeroIntentCreated', null, to_jsonb(v_out), 'S13 invoice stage ' || p_stage.stage);
  return jsonb_build_object('ok', true, 'created', true, 'intent_id', v_out.id, 'stage', p_stage.stage);
end
$$;

-- Intents are written in the same transaction as the stage (sale, operational
-- completion) once FN-09 is Automated; before that the existing route invoices.
create function app.invoice_stages_xero_intent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage in ('Deposit', 'Interim', 'Balance') and app.mode_available('FN-09', 'Automated') then
    perform app.s13_xero_intent(new);
  end if;
  return null;
end
$$;

create trigger invoice_stages_xero_intent after insert on public.invoice_stages
  for each row execute function app.invoice_stages_xero_intent();

-- XERO_INTENT_CREATE: explicit intent for one stage (backfill after enabling
-- FN-09). Payload: stage (Deposit | Interim | Balance).
create function app.cmd_xero_intent_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['stage'], array['stage']);
  v_job public.jobs := app.r4_job_access(p_actor, app.ref(p_request, 'job_id'));
  v_stage public.invoice_stages;
  v_r jsonb;
begin
  select * into v_stage from public.invoice_stages s
  where s.job_id = v_job.id and s.stage = app.txt(v_p, 'stage') and s.stage in ('Deposit', 'Interim', 'Balance');
  if not found then
    perform app.fail('S13_REVIEW: stage not found');
  end if;
  v_r := app.s13_xero_intent(v_stage);
  return v_r || jsonb_build_object('status', case when (v_r ->> 'created')::boolean then 'Created' else 'Unchanged' end,
                                   'job_id', v_job.id, 'stage_id', v_stage.id, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- S13: milestone tasks
-- -----------------------------------------------------------------------------

-- createInterimChaseTask: S13-INTERIM-CHASE-{job}, due now, priority 1.
create function app.s13_interim_chase(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'S13-INTERIM-CHASE-' || p_job_id;
  v_id uuid;
begin
  v_id := app.create_task_instance(p_job_id, 'S13-INTERIM-CHASE', v_key, null, null, now(), 1);
  if v_id is null then
    return jsonb_build_object('created', false, 'task_id', (select t.id from public.tasks t where t.instance_key = v_key),
                              'reason', 'Already exists');
  end if;
  return jsonb_build_object('created', true, 'task_id', v_id);
end
$$;

-- createGHLTask: S13-GHL-PROGRESSION (S13-GHL-{job}) + one ghl_tasks row with
-- readiness "payment-complete". S15-guarded as the reference.
create function app.s13_ghl_progression(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'S13-GHL-' || p_job_id;
  v_id uuid;
  v_ghl public.ghl_tasks;
begin
  perform app.assert_normal_work(p_job_id);
  v_id := app.create_task_instance(p_job_id, 'S13-GHL-PROGRESSION', v_key, null, null, null, 2);
  if v_id is null then
    return jsonb_build_object('created', false, 'task_id', (select t.id from public.tasks t where t.instance_key = v_key));
  end if;
  insert into public.ghl_tasks (job_id, task_id, readiness_snapshot)
  values (p_job_id, v_id, '{"stage":"payment-complete"}')
  returning * into v_ghl;
  perform app.audit('GHLTasks', v_ghl.id::text, 'Created', null, to_jsonb(v_ghl), 'S13 payment complete');
  return jsonb_build_object('created', true, 'task_id', v_id, 'ghl_task_id', v_ghl.id);
end
$$;

-- Interim chase is due from FIN02: the stage due date, else the Friday on/before
-- the first installation work (jobs.next_action_at).
create function app.s13_interim_chase_date(p_job public.jobs, p_stage public.invoice_stages)
returns date
language sql stable
set search_path = ''
as $$
  select coalesce(p_stage.due_date,
                  case when p_job.next_action_at is not null then app.friday_before(app.london_date(p_job.next_action_at)) end)
$$;

-- Milestones for one job: interim chase (FIN02 reached, interim outstanding)
-- and GHL progression (financially complete; FN-11 Manual). Skips jobs whose
-- normal work is suppressed, archived jobs and unavailable functions.
create function app.s13_job_milestones(p_job_id uuid, p_today date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_interim public.invoice_stages;
  v_out jsonb := '{}'::jsonb;
  v_chase date;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null or v_job.archived_at is not null or not app.r4_normal_work(p_job_id) then
    return jsonb_build_object('skipped', 'Job archived, cancelled or under reopen review');
  end if;
  select * into v_interim from public.invoice_stages s where s.job_id = p_job_id and s.stage = 'Interim';
  if v_interim.id is not null then
    v_chase := app.s13_interim_chase_date(v_job, v_interim);
    if v_chase is not null and v_chase <= p_today
       and v_interim.status not in ('Paid', 'Confirmed', 'Voided', 'Credited')
       and v_interim.gross_pence - app.s13_stage_paid(v_interim.id) > 0 then
      v_out := v_out || jsonb_build_object('interim_chase', app.s13_interim_chase(p_job_id));
    end if;
  end if;
  if (app.s14_job_financial_summary(p_job_id, p_today) ->> 'financially_complete')::boolean then
    if app.mode_available('FN-11', 'Manual') then
      v_out := v_out || jsonb_build_object('ghl', app.s13_ghl_progression(p_job_id));
    else
      v_out := v_out || jsonb_build_object('ghl', jsonb_build_object('created', false, 'reason', 'FN-11 not Manual'));
    end if;
  end if;
  return v_out;
end
$$;

-- Scheduler (FN-09 Automated): milestones for every live job with stages.
create function app.s13_run_milestones(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_r jsonb;
  v_results jsonb := '[]'::jsonb;
  v_today date := app.london_date(p_now);
begin
  perform app.r4_worker_context('scheduler:S13-milestones', 'S13-MILESTONES-' || to_char(v_today, 'YYYY-MM-DD'));
  if not app.mode_available('FN-09', 'Automated') then
    return jsonb_build_object('ok', true, 'skipped', 'FN-09 not Automated', 'jobs', '[]'::jsonb);
  end if;
  for v_job in select j.id from public.jobs j
               where j.archived_at is null and j.cancellation_at is null
                 and j.workflow_stage not in ('CancellationInProgress', 'Cancelled')
                 and exists (select 1 from public.invoice_stages s where s.job_id = j.id)
               order by j.created_at, j.id loop
    v_r := app.s13_job_milestones(v_job, v_today);
    if v_r <> '{}'::jsonb then
      v_results := v_results || jsonb_build_object('job_id', v_job, 'result', v_r);
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'as_of', v_today, 'jobs', v_results, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Xero adapter (FN-09, disabled by default)
-- -----------------------------------------------------------------------------

create function app.xero_retry_policy()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('action_type', 'XeroInvoice', 'max_attempts', 3,
    'backoff', 'next_attempt = now + 2^attempt minutes', 'uncertain', 'NeedsReview (never retried blindly)',
    'uncertain_when', 'no response, timeout, timed out, uncertain', 'after_max_attempts', 'NeedsReview')
$$;

-- Request envelope for one XeroInvoice intent (_xoEnvelope).
create function app.xero_envelope(p_out public.outbox)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_stage public.invoice_stages;
  v_job public.jobs;
  v_cust public.customers;
  v_code text;
  v_blockers text[] := '{}';
begin
  begin
    v_payload := p_out.payload_hash::jsonb;
  exception when others then
    v_payload := null;
  end;
  if v_payload is not null and coalesce(v_payload ->> 'stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_stage from public.invoice_stages where id = (v_payload ->> 'stage_id')::uuid;
  end if;
  if v_stage.id is null then
    return jsonb_build_object('ok', false, 'reason', 'STAGE_NOT_FOUND', 'intent_id', p_out.id);
  end if;
  select * into v_job from public.jobs where id = v_stage.job_id;
  select * into v_cust from public.customers where id = v_job.customer_id;
  v_code := app.xero_stage_code(v_stage.stage);
  if v_stage.xero_invoice_id is not null then
    v_blockers := v_blockers || ('ALREADY_LINKED:' || v_stage.xero_invoice_id);
  end if;
  if v_stage.xero_contact_id is null or v_stage.xero_contact_id = 'NOT_CONFIGURED' then
    v_blockers := v_blockers || 'CONTACT_NOT_CONFIGURED'::text;
  end if;
  if coalesce(v_stage.gross_pence, 0) <= 0 then
    v_blockers := v_blockers || 'ZERO_AMOUNT'::text;
  end if;
  return jsonb_build_object(
    'ok', true, 'intent_id', p_out.id, 'request_id', p_out.id, 'idempotency_key', p_out.idempotency_key,
    'route', 'Zapier/Xero (existing authorised route)',
    'job_id', v_stage.job_id, 'job_reference', v_job.job_ref, 'stage_id', v_stage.id, 'stage', v_stage.stage,
    'reference', v_job.job_ref || '-' || v_code,
    'contact', jsonb_build_object('xero_contact_id', coalesce(v_stage.xero_contact_id, 'NOT_CONFIGURED'),
                                  'name', btrim(coalesce(v_cust.first_name, '') || ' ' || coalesce(v_cust.last_name, '')),
                                  'email', coalesce(v_cust.email, 'NOT_CONFIGURED')),
    'amounts', jsonb_build_object('net_pence', v_stage.amount_net_pence, 'vat_pence', v_stage.vat_pence,
                                  'gross_pence', v_stage.gross_pence),
    'due_date', v_stage.due_date, 'create_as', 'DRAFT', 'existing_xero_invoice_id', v_stage.xero_invoice_id,
    'blockers', to_jsonb(v_blockers));
end
$$;

-- _xoRequests: the dispatch view (mode, readiness, envelopes).
create function app.xero_dispatch_status(p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_mode text := case when app.setting('xero.mode') #>> '{}' = 'LIVE' then 'LIVE' else 'DISABLED' end;
  v_rm public.release_modes;
  v_env jsonb;
begin
  select * into v_rm from public.release_modes where function_id = 'FN-09';
  select coalesce(jsonb_agg(app.xero_envelope(o) || jsonb_build_object('outbox_status', o.status,
                    'attempts', o.attempt_count, 'next_attempt', o.next_attempt) order by o.created_at, o.id), '[]'::jsonb)
    into v_env
  from public.outbox o where o.action_type = 'XeroInvoice';
  return jsonb_build_object(
    'xero_mode', v_mode,
    'release_mode', jsonb_build_object('mode', v_rm.mode, 'scope', v_rm.authorised_job_scope),
    'live_ready', v_mode = 'LIVE' and app.mode_available('FN-09', 'Automated'),
    'intents', jsonb_array_length(v_env),
    'pending', (select count(*) from jsonb_array_elements(v_env) e where e ->> 'outbox_status' = 'Pending'),
    'due', (select count(*) from public.outbox o where o.action_type = 'XeroInvoice' and o.status in ('Pending', 'RetryDue')
            and (o.next_attempt is null or o.next_attempt <= p_now)),
    'blocked', (select count(*) from jsonb_array_elements(v_env) e
                where (e ->> 'ok')::boolean and jsonb_array_length(e -> 'blockers') > 0),
    'retry_policy', app.xero_retry_policy(),
    'envelopes', v_env);
end
$$;

-- Pre-send step for one claimed intent (_xoDispatch per-row part).
create function app.xero_prepare_dispatch(p_outbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out public.outbox;
  v_out2 public.outbox;
  v_env jsonb;
  v_stage public.invoice_stages;
  v_stage2 public.invoice_stages;
  v_code text;
begin
  perform app.r4_worker_context('worker:XeroAdapter', 'XO-DISPATCH-' || p_outbox_id);
  if coalesce(app.setting('xero.mode') #>> '{}', '') <> 'LIVE' then
    perform app.fail('XO_REFUSED: Xero automation is not enabled (xero.mode)');
  end if;
  if not app.mode_available('FN-09', 'Automated') then
    perform app.fail('XO_REFUSED: FN-09 must be Automated for LIVE dispatch');
  end if;
  select * into v_out from public.outbox where id = p_outbox_id for update;
  if not found then
    perform app.fail('XO_REVIEW: outbox row not found');
  end if;
  if v_out.action_type <> 'XeroInvoice' then
    perform app.fail('XO_REVIEW: not a XeroInvoice intent');
  end if;
  if v_out.status not in ('Pending', 'RetryDue', 'Processing') then
    perform app.fail('XO_REVIEW: intent is not dispatchable', jsonb_build_object('status', v_out.status));
  end if;
  v_env := app.xero_envelope(v_out);
  if not (v_env ->> 'ok')::boolean or jsonb_array_length(v_env -> 'blockers') > 0 then
    v_code := case when not (v_env ->> 'ok')::boolean then v_env ->> 'reason'
                   else (select string_agg(b, ',') from jsonb_array_elements_text(v_env -> 'blockers') b) end;
    update public.outbox set status = 'NeedsReview', next_attempt = null, response_summary = 'NEEDS_REVIEW ' || v_code
    where id = v_out.id returning * into v_out2;
    perform app.audit('Outbox', v_out.id::text, 'XeroIntentBlocked', to_jsonb(v_out), to_jsonb(v_out2), v_code);
    return jsonb_build_object('send', false, 'outbox_id', v_out.id, 'outcome', 'NeedsReview', 'code', v_code);
  end if;
  select * into v_stage from public.invoice_stages where id = (v_env ->> 'stage_id')::uuid for update;
  if v_stage.request_id is distinct from v_out.id::text then
    update public.invoice_stages set request_id = v_out.id::text where id = v_stage.id returning * into v_stage2;
    perform app.audit('InvoiceStages', v_stage.id::text, 'XeroRequestPrepared', to_jsonb(v_stage), to_jsonb(v_stage2), null);
  end if;
  return jsonb_build_object('send', true, 'outbox_id', v_out.id, 'envelope', v_env);
end
$$;

-- Stage audit for the dispatch outcome (Accepted | Uncertain | Failed). The
-- outbox status itself is recorded by the generic protocol.
create function app.xero_note_dispatch_outcome(p_outbox_id uuid, p_outcome text, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out public.outbox;
  v_env jsonb;
  v_action text;
begin
  perform app.r4_worker_context('worker:XeroAdapter', 'XO-DISPATCH-' || p_outbox_id);
  if p_outcome not in ('Accepted', 'Uncertain', 'Failed') then
    perform app.fail('XO_REVIEW: outcome must be Accepted, Uncertain or Failed');
  end if;
  select * into v_out from public.outbox where id = p_outbox_id and action_type = 'XeroInvoice';
  if not found then
    perform app.fail('XO_REVIEW: outbox row not found');
  end if;
  v_env := app.xero_envelope(v_out);
  if not (v_env ->> 'ok')::boolean then
    perform app.fail('XO_REVIEW: invoice stage not found for request');
  end if;
  v_action := case p_outcome when 'Accepted' then 'XeroRequestSent' when 'Uncertain' then 'XeroRequestUncertain'
                             else 'XeroRequestFailed' end;
  perform app.audit('InvoiceStages', v_env ->> 'stage_id', v_action, null,
    jsonb_build_object('request_id', v_out.id, 'reference', v_env ->> 'reference', 'detail', p_detail),
    case p_outcome when 'Accepted' then 'Invoice request submitted to the authorised route'
                   when 'Uncertain' then 'Uncertain outcome - reconcile by reference before retry'
                   else 'Transient failure' end);
  return jsonb_build_object('ok', true, 'action', v_action, 'stage_id', v_env ->> 'stage_id');
end
$$;

-- _xoInvoiceCallback: store the returned invoice id/number/status.
create function app.xero_apply_invoice_callback(p_callback_id text, p_request_id text, p_xero_invoice_id text,
                                                p_invoice_number text default null, p_source_status text default null,
                                                p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_xid text := nullif(btrim(p_xero_invoice_id), '');
  v_out public.outbox;
  v_out2 public.outbox;
  v_env jsonb;
  v_stage public.invoice_stages;
  v_after public.invoice_stages;
  v_src text := coalesce(upper(nullif(btrim(p_source_status), '')), 'DRAFT');
  v_mapped text;
begin
  if nullif(btrim(p_callback_id), '') is null or nullif(btrim(p_request_id), '') is null or v_xid is null then
    perform app.fail('XO_REVIEW: callback_id, request_id and xero_invoice_id required');
  end if;
  perform app.r4_worker_context('worker:XeroAdapter', btrim(p_callback_id));
  if exists (select 1 from public.audit_events a where a.command_id = btrim(p_callback_id)
             and a.action in ('XeroInvoiceLinked', 'XeroInvoiceConflict')) then
    return jsonb_build_object('replay', true, 'request_id', btrim(p_request_id), 'external_calls', 0);
  end if;
  if btrim(p_request_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_out from public.outbox where id = btrim(p_request_id)::uuid and action_type = 'XeroInvoice' for update;
  end if;
  if v_out.id is null then
    perform app.fail('XO_REVIEW: unknown request_id');
  end if;
  v_env := app.xero_envelope(v_out);
  if not (v_env ->> 'ok')::boolean then
    perform app.fail('XO_REVIEW: invoice stage not found for request');
  end if;
  select * into v_stage from public.invoice_stages where id = (v_env ->> 'stage_id')::uuid for update;
  if v_stage.xero_invoice_id is not null and v_stage.xero_invoice_id <> v_xid then
    -- Deviation: recorded, not thrown (see header).
    update public.outbox set status = 'NeedsReview', next_attempt = null,
      response_summary = 'NEEDS_REVIEW CONFLICTING_XERO_ID existing ' || v_stage.xero_invoice_id || ' callback ' || v_xid
    where id = v_out.id returning * into v_out2;
    perform app.audit('Outbox', v_out.id::text, 'XeroInvoiceConflict', to_jsonb(v_out), to_jsonb(v_out2),
                      'Stage already linked to a different Xero invoice; review required');
    return jsonb_build_object('replay', false, 'status', 'NeedsReview',
      'code', 'XO_REVIEW: stage already linked to a different Xero invoice; review required',
      'request_id', v_out.id, 'stage_id', v_stage.id, 'external_calls', 0);
  end if;
  if exists (select 1 from public.invoice_stages s where s.xero_invoice_id = v_xid and s.id <> v_stage.id) then
    perform app.fail('XO_REVIEW: Xero invoice already linked to another stage');
  end if;
  v_mapped := case v_src when 'AUTHORISED' then 'Authorised' when 'PAID' then 'Paid' when 'VOIDED' then 'Voided' else 'Draft' end;
  update public.invoice_stages set
    xero_invoice_id = v_xid,
    invoice_number = coalesce(nullif(btrim(p_invoice_number), ''), invoice_number),
    source_status = v_src, last_synced_at = p_at, request_id = v_out.id::text,
    status = case when status in ('Pending', 'Planned', 'Draft', 'Authorised') then v_mapped else status end
  where id = v_stage.id returning * into v_after;
  update public.outbox set status = 'Succeeded', next_attempt = null, external_id = v_xid,
    response_summary = 'LINKED Xero invoice ' || v_xid || ' (' || v_src || ')'
  where id = v_out.id returning * into v_out2;
  perform app.audit('Outbox', v_out.id::text, 'XeroInvoiceCallback', to_jsonb(v_out), to_jsonb(v_out2), null);
  perform app.audit('InvoiceStages', v_stage.id::text, 'XeroInvoiceLinked', to_jsonb(v_stage), to_jsonb(v_after),
                    'Callback from authorised Zapier/Xero route');
  return jsonb_build_object('replay', false, 'request_id', v_out.id, 'stage_id', v_stage.id, 'xero_invoice_id', v_xid,
                            'status', v_after.status, 'external_calls', 0);
end
$$;

-- _xoPaymentCallback: Payments "Reported", stage PartPaid/Paid. Never touches
-- manual bank checks (Ben's confirmation is never inferred).
create function app.xero_apply_payment_callback(p_callback_id text, p_xero_invoice_id text, p_xero_payment_id text,
                                                p_amount_pence bigint, p_payment_date date default null,
                                                p_evidence text default null, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_xid text := nullif(btrim(p_xero_invoice_id), '');
  v_pid text := nullif(btrim(p_xero_payment_id), '');
  v_stage public.invoice_stages;
  v_after public.invoice_stages;
  v_pay public.payments;
  v_paid bigint;
  v_status text;
  v_milestones jsonb;
begin
  if nullif(btrim(p_callback_id), '') is null or v_xid is null or v_pid is null then
    perform app.fail('XO_REVIEW: callback_id, xero_invoice_id and xero_payment_id required');
  end if;
  if p_amount_pence is null or p_amount_pence <= 0 then
    perform app.fail('XO_REVIEW: amount_pence must be a positive integer');
  end if;
  perform app.r4_worker_context('worker:XeroAdapter', btrim(p_callback_id));
  select * into v_stage from public.invoice_stages where xero_invoice_id = v_xid for update;
  if not found then
    perform app.fail('XO_REVIEW: no invoice stage linked to ' || v_xid);
  end if;
  select * into v_pay from public.payments where xero_payment_id = v_pid;
  if found then
    return jsonb_build_object('replay', true, 'payment_id', v_pay.id, 'stage_id', v_pay.invoice_stage_id, 'external_calls', 0);
  end if;
  insert into public.payments (invoice_stage_id, xero_payment_id, amount_pence, payment_date, status,
                               reconciliation_evidence, last_synced_at)
  values (v_stage.id, v_pid, p_amount_pence, coalesce(p_payment_date, app.london_date(p_at)), 'Reported',
          nullif(btrim(p_evidence), ''), p_at)
  returning * into v_pay;
  v_paid := app.s13_stage_paid(v_stage.id);
  v_status := case when v_paid >= v_stage.gross_pence then 'Paid' else 'PartPaid' end;
  if v_stage.status <> 'Confirmed' then
    update public.invoice_stages set status = v_status, last_synced_at = p_at where id = v_stage.id returning * into v_after;
    perform app.audit('InvoiceStages', v_stage.id::text, 'XeroPaymentApplied', to_jsonb(v_stage), to_jsonb(v_after), null);
  end if;
  perform app.audit('Payments', v_pay.id::text, 'XeroPaymentReported', null,
    jsonb_build_object('stage_id', v_stage.id, 'amount_pence', p_amount_pence, 'paid_total_pence', v_paid, 'stage_status', v_status),
    'Payment reported by Xero; Reported until reconciled. Manual bank confirmation is never inferred from this.');
  -- S13 milestones reached by this payment (same transaction).
  v_milestones := case when app.mode_available('FN-09', 'Automated')
                       then app.s13_job_milestones(v_stage.job_id, app.london_date(p_at)) end;
  return jsonb_build_object('replay', false, 'payment_id', v_pay.id, 'stage_id', v_stage.id, 'paid_total_pence', v_paid,
                            'stage_status', v_status, 'manual_bank_check_touched', false, 'milestones', v_milestones,
                            'external_calls', 0);
end
$$;

-- XERO_REVIEW_CANCEL_INVOICE (_xoReviewCancelInvoice): never deletes; raises
-- the review task whose action text depends on the actual invoice state.
-- Payload: invoice_stage_id, reason.
create function app.cmd_xero_review_cancel_invoice(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['invoice_stage_id', 'reason'], array['invoice_stage_id', 'reason']);
  v_sid text := app.txt(v_p, 'invoice_stage_id');
  v_stage public.invoice_stages;
  v_key text;
  v_existing public.tasks;
  v_action text;
  v_task_id uuid;
begin
  if v_sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('XO_REVIEW: invoice stage not found');
  end if;
  select * into v_stage from public.invoice_stages where id = v_sid::uuid for update;
  if not found then
    perform app.fail('XO_REVIEW: invoice stage not found');
  end if;
  perform app.r4_job_access(p_actor, v_stage.job_id);
  v_key := 'XO-REVIEW-CANCEL-' || v_stage.id;
  select * into v_existing from public.tasks where instance_key = v_key;
  if found then
    return jsonb_build_object('status', 'Unchanged', 'created', false, 'task_id', v_existing.id,
                              'task_status', v_existing.status, 'stage_id', v_stage.id, 'deleted', false, 'external_calls', 0);
  end if;
  v_action := case
    when v_stage.xero_invoice_id is null then 'no Xero invoice linked — cancel locally after review'
    when v_stage.status in ('Authorised', 'Paid', 'PartPaid') or coalesce(v_stage.source_status, '') ~ 'AUTHORISED|PAID'
      then 'void/credit via supported Xero action'
    else 'delete draft via supported Xero action' end;
  v_task_id := app.create_task_instance(v_stage.job_id, 'XO-REVIEW-CANCEL', v_key, null, null, now(), 1,
    'Review/cancel Xero invoice — ' || v_stage.stage || ' '
      || coalesce(v_stage.invoice_number, v_stage.xero_invoice_id, v_stage.id::text) || ' (' || v_action || ')',
    'Finance', 'InvoiceStages', v_stage.id);
  perform app.audit('InvoiceStages', v_stage.id::text, 'ReviewCancelRequested', null,
    jsonb_build_object('task_id', v_task_id, 'action', v_action, 'reason', app.txt(v_p, 'reason')), app.txt(v_p, 'reason'));
  return jsonb_build_object('status', 'Created', 'created', true, 'task_id', v_task_id, 'stage_id', v_stage.id,
                            'action', v_action, 'deleted', false, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- S14 reporting (derivations; only report_snapshots is written)
-- -----------------------------------------------------------------------------

-- jobFinancialSummary. Overdue (definition 1): due_date < as_of AND
-- outstanding > 0. Financially complete: operational_complete_at AND Deposit,
-- Interim and Balance all exist AND each outstanding is exactly 0.
create function app.s14_job_financial_summary(p_job_id uuid, p_as_of date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_today date := coalesce(p_as_of, app.london_date(now()));
  v_rows jsonb;
  v_complete boolean;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('job_id', p_job_id, 'error', 'JOB_NOT_FOUND');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('stage', s.stage, 'due_date', s.due_date, 'invoiced', s.gross_pence,
                    'paid', p.paid, 'outstanding', s.gross_pence - p.paid) order by s.created_at, s.id), '[]'::jsonb)
    into v_rows
  from public.invoice_stages s cross join lateral (select app.s13_stage_paid(s.id) as paid) p
  where s.job_id = p_job_id;
  v_complete := v_job.operational_complete_at is not null
    and (select count(distinct r ->> 'stage') from jsonb_array_elements(v_rows) r
         where r ->> 'stage' in ('Deposit', 'Interim', 'Balance')) = 3
    and not exists (select 1 from jsonb_array_elements(v_rows) r
                    where r ->> 'stage' in ('Deposit', 'Interim', 'Balance') and (r ->> 'outstanding')::bigint <> 0);
  return jsonb_build_object(
    'job_id', p_job_id, 'job_ref', v_job.job_ref, 'as_of', v_today,
    'gross', coalesce(v_job.original_gross_pence, v_job.current_contract_gross_pence, 0),
    'stages_count', jsonb_array_length(v_rows),
    'invoiced', (select coalesce(sum((r ->> 'invoiced')::bigint), 0) from jsonb_array_elements(v_rows) r),
    'total_paid', (select coalesce(sum((r ->> 'paid')::bigint), 0) from jsonb_array_elements(v_rows) r),
    'outstanding', (select coalesce(sum((r ->> 'outstanding')::bigint), 0) from jsonb_array_elements(v_rows) r),
    'overdue_amount', (select coalesce(sum((r ->> 'outstanding')::bigint), 0) from jsonb_array_elements(v_rows) r
                       where (r ->> 'due_date')::date < v_today and (r ->> 'outstanding')::bigint > 0),
    'overdue_stages', (select coalesce(jsonb_agg(r -> 'stage'), '[]'::jsonb) from jsonb_array_elements(v_rows) r
                       where (r ->> 'due_date')::date < v_today and (r ->> 'outstanding')::bigint > 0),
    'total_costs', (select coalesce(sum(c.amount_net_pence + c.vat_pence), 0) from public.job_costs c where c.job_id = p_job_id),
    'financially_complete', v_complete,
    'stage_details', (select coalesce(jsonb_object_agg(r ->> 'stage', jsonb_build_object('invoiced', r -> 'invoiced',
                        'paid', r -> 'paid', 'outstanding', r -> 'outstanding')), '{}'::jsonb) from jsonb_array_elements(v_rows) r),
    'deposit_confirmed', v_job.deposit_bank_confirmed_at is not null,
    'operational_complete', v_job.operational_complete_at is not null);
end
$$;

-- reconcilePayments: OVERPAYMENT, DUPLICATE_PAYMENT_REF (cannot arise while
-- payments_xero_payment_key is unique - kept for imported data),
-- MISSING_EXTERNAL_REF, FINAL_BEFORE_OPERATIONAL (Balance before completion).
create function app.s14_reconcile_payments(p_job_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_stage public.invoice_stages;
  v_paid bigint;
  v_ref text;
  v_ex jsonb := '[]'::jsonb;
begin
  for v_stage in select * from public.invoice_stages s where s.job_id = p_job_id order by s.created_at, s.id loop
    v_paid := app.s13_stage_paid(v_stage.id);
    if v_paid > v_stage.gross_pence then
      v_ex := v_ex || jsonb_build_object('type', 'OVERPAYMENT', 'stage', v_stage.stage, 'stage_id', v_stage.id,
                                         'invoiced', v_stage.gross_pence, 'paid', v_paid, 'excess', v_paid - v_stage.gross_pence);
    end if;
    for v_ref in select p.xero_payment_id from public.payments p
                 where p.invoice_stage_id = v_stage.id and p.status <> 'Reversed' and p.xero_payment_id is not null
                 group by p.xero_payment_id having count(*) > 1 loop
      v_ex := v_ex || jsonb_build_object('type', 'DUPLICATE_PAYMENT_REF', 'stage', v_stage.stage, 'reference', v_ref);
    end loop;
    if v_paid > 0 and not exists (select 1 from public.payments p where p.invoice_stage_id = v_stage.id
                                  and p.status <> 'Reversed' and p.xero_payment_id is not null) then
      v_ex := v_ex || jsonb_build_object('type', 'MISSING_EXTERNAL_REF', 'stage', v_stage.stage, 'stage_id', v_stage.id,
                                         'paid', v_paid);
    end if;
  end loop;
  select * into v_stage from public.invoice_stages s where s.job_id = p_job_id and s.stage = 'Balance' limit 1;
  if v_stage.id is not null and (select j.operational_complete_at from public.jobs j where j.id = p_job_id) is null then
    v_ex := v_ex || jsonb_build_object('type', 'FINAL_BEFORE_OPERATIONAL', 'stage_id', v_stage.id);
  end if;
  return jsonb_build_object('job_id', p_job_id, 'exceptions', v_ex, 'exception_count', jsonb_array_length(v_ex),
                            'needs_review', jsonb_array_length(v_ex) > 0);
end
$$;

-- invoiceStatusReport. Overdue (definition 2, differs from the summary):
-- due_date < today AND status <> 'Confirmed' - a fully Paid stage past its due
-- date still reads overdue here. Both kept as the reference; open question.
create function app.s14_invoice_status(p_job_id uuid, p_today date default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', s.id, 'stage', s.stage, 'gross', s.gross_pence, 'due_date', s.due_date, 'status', s.status,
           'paid', p.paid, 'outstanding', s.gross_pence - p.paid,
           'overdue', s.due_date is not null and s.due_date < coalesce(p_today, app.london_date(now())) and s.status <> 'Confirmed',
           'xero_invoice_id', s.xero_invoice_id,
           'has_xero_intent', exists (select 1 from public.outbox o where o.correlation_id = 'XI-' || s.job_id || '-' || s.stage))
         order by s.created_at, s.id), '[]'::jsonb)
  from public.invoice_stages s cross join lateral (select app.s13_stage_paid(s.id) as paid) p
  where s.job_id = p_job_id
$$;

-- REPORT_SNAPSHOT_CREATE (createReportSnapshot): frozen totals over the listed
-- jobs as of period_end. One snapshot per (report_type, period_start) - a
-- second request returns the existing one (reference RS-{type}-{start}).
-- Payload: report_type, period_start, period_end (YYYY-MM-DD), job_ids[].
create function app.cmd_report_snapshot_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['report_type', 'period_start', 'period_end', 'job_ids'],
                           array['report_type', 'period_start', 'period_end', 'job_ids']);
  v_type text := app.txt(v_p, 'report_type');
  v_start date := app.r4_date(app.txt(v_p, 'period_start'), 'S14_REVIEW: invalid period_start');
  v_end date := app.r4_date(app.txt(v_p, 'period_end'), 'S14_REVIEW: invalid period_end');
  v_ids uuid[] := '{}';
  v_txt text;
  v_snap public.report_snapshots;
  v_sums jsonb;
  v_totals jsonb;
begin
  if v_type !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$' then
    perform app.fail('S14_REVIEW: invalid report_type');
  end if;
  if v_start > v_end then
    perform app.fail('S14_REVIEW: period_start must not be after period_end');
  end if;
  if jsonb_typeof(v_p -> 'job_ids') <> 'array' then
    perform app.fail('S14_REVIEW: job_ids must be a list');
  end if;
  for v_txt in select jsonb_array_elements_text(v_p -> 'job_ids') loop
    if v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.jobs j where j.id = v_txt::uuid) then
      perform app.fail('R1A_JOB_NOT_FOUND', jsonb_build_object('job_id', v_txt));
    end if;
    if not v_txt::uuid = any (v_ids) then
      v_ids := v_ids || v_txt::uuid;
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('report_snapshot:' || v_type || ':' || v_start, 0));
  select * into v_snap from public.report_snapshots r where r.report_type = v_type and r.period_start = v_start
  order by r.created_at limit 1;
  if found then
    return jsonb_build_object('status', 'AlreadyExists', 'created', false, 'snapshot_id', v_snap.id,
                              'snapshot', to_jsonb(v_snap), 'external_calls', 0);
  end if;
  select coalesce(jsonb_agg(app.s14_job_financial_summary(j, v_end)), '[]'::jsonb) into v_sums from unnest(v_ids) j;
  select jsonb_build_object(
      'total_gross', coalesce(sum((s ->> 'gross')::bigint), 0),
      'total_invoiced', coalesce(sum((s ->> 'invoiced')::bigint), 0),
      'total_paid', coalesce(sum((s ->> 'total_paid')::bigint), 0),
      'total_outstanding', coalesce(sum((s ->> 'outstanding')::bigint), 0),
      'total_overdue', coalesce(sum((s ->> 'overdue_amount')::bigint), 0),
      'job_count', count(*),
      'financially_complete', count(*) filter (where (s ->> 'financially_complete')::boolean))
    into v_totals
  from jsonb_array_elements(v_sums) s;
  insert into public.report_snapshots (period_start, period_end, as_of_at, policy_version, report_type, totals_json,
                                       underlying_job_ids, file_id, generated_by)
  values (v_start, v_end, now(), 'S14-1.0', v_type, v_totals, v_ids, null, app.actor_id(p_actor))
  returning * into v_snap;
  perform app.audit('ReportSnapshots', v_snap.id::text, 'Created', null, to_jsonb(v_snap), null);
  return jsonb_build_object('status', 'Created', 'created', true, 'snapshot_id', v_snap.id, 'totals', v_totals,
                            'job_count', cardinality(v_ids), 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- S16 archive (FN-13)
-- -----------------------------------------------------------------------------

create function app.s16_archive_eligibility(p_job_id uuid, p_today date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_today date := coalesce(p_today, app.london_date(now()));
  v_checks jsonb := '[]'::jsonb;
  v_blockers text[] := '{}';
  v_done date;
  v_threshold date;
  v_months int;
  v_n int;
  v_outstanding boolean;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then
    return jsonb_build_object('job_id', p_job_id, 'eligible', false, 'reason', 'JOB_NOT_FOUND',
                              'blockers', jsonb_build_array('Job not found'), 'checks', '[]'::jsonb, 'blocker_count', 1);
  end if;

  if v_job.operational_complete_at is null then
    v_blockers := v_blockers || 'Not operationally complete'::text;
  else
    v_done := app.london_date(v_job.operational_complete_at);
    v_threshold := (v_done + interval '6 months')::date;
    v_months := (extract(year from v_today)::int - extract(year from v_done)::int) * 12
              + extract(month from v_today)::int - extract(month from v_done)::int;
    v_checks := v_checks || jsonb_build_object('check', 'operational_complete', 'value', v_done, 'passed', true)
                         || jsonb_build_object('check', 'months_since_completion', 'value', v_months, 'threshold', 6,
                                               'passed', v_today >= v_threshold, 'threshold_date', v_threshold);
    if v_today < v_threshold then
      v_blockers := v_blockers || ('Less than 6 calendar months since operational completion (' || v_months
                                   || ' months, threshold ' || v_threshold || ')');
    end if;
  end if;

  if v_job.cancellation_at is not null or v_job.workflow_stage in ('CancellationInProgress', 'Cancelled') then
    v_blockers := v_blockers || 'Job is cancelled or cancellation in progress'::text;
  end if;

  select count(*) into v_n from public.tasks t
  where t.job_id = p_job_id and t.status not in ('Complete', 'NotRequired', 'Cancelled');
  v_checks := v_checks || jsonb_build_object('check', 'open_tasks', 'value', v_n, 'passed', v_n = 0);
  if v_n > 0 then v_blockers := v_blockers || (v_n || ' open tasks'); end if;

  select count(*) into v_n from public.issues i where i.job_id = p_job_id and i.status not in ('Resolved', 'Closed');
  v_checks := v_checks || jsonb_build_object('check', 'unresolved_issues', 'value', v_n, 'passed', v_n = 0);
  if v_n > 0 then v_blockers := v_blockers || (v_n || ' unresolved issues'); end if;

  v_checks := v_checks || jsonb_build_object('check', 'handover_status', 'value', v_job.handover_status,
                                             'passed', v_job.handover_status in ('Sent', 'Approved'));
  if v_job.handover_status not in ('Sent', 'Approved') then
    v_blockers := v_blockers || ('Handover not sent/approved: ' || v_job.handover_status);
  end if;

  v_outstanding := exists (select 1 from public.invoice_stages s where s.job_id = p_job_id
                           and s.gross_pence - app.s13_stage_paid(s.id) > 0);
  v_checks := v_checks || jsonb_build_object('check', 'outstanding_payments',
                                             'value', case when v_outstanding then 'Has outstanding' else 'None' end,
                                             'passed', not v_outstanding);
  if v_outstanding then v_blockers := v_blockers || 'Outstanding invoice balances'::text; end if;

  select count(*) into v_n from public.outbox o
  where o.id = any (app.s15_job_outbox_ids(p_job_id)) and o.status not in ('Succeeded', 'Cancelled');
  v_checks := v_checks || jsonb_build_object('check', 'pending_outbox', 'value', v_n, 'passed', v_n = 0);
  if v_n > 0 then v_blockers := v_blockers || (v_n || ' pending outbox items'); end if;

  select count(*) into v_n from public.scaffold_bookings b
  where b.job_id = p_job_id and b.erect_actual_at is not null and b.strip_actual_at is null and b.status <> 'Cancelled';
  v_checks := v_checks || jsonb_build_object('check', 'scaffold_obligations', 'value', v_n, 'passed', v_n = 0);
  if v_n > 0 then v_blockers := v_blockers || 'Scaffold still erected, strip required'::text; end if;

  if v_job.archived_at is not null then
    v_blockers := v_blockers || ('Already archived at ' || app.london_date(v_job.archived_at));
  end if;

  return jsonb_build_object('job_id', p_job_id, 'job_display', coalesce(v_job.display_name, v_job.job_ref),
    'eligible', cardinality(v_blockers) = 0, 'operational_complete_at', v_done,
    'months_since_completion', v_months, 'checks', v_checks, 'blockers', to_jsonb(v_blockers),
    'blocker_count', cardinality(v_blockers));
end
$$;

-- Related record counts for the archive manifest (reference relatedTables).
create function app.s16_archive_counts(p_job_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'Jobs', 1,
    'WorkPackages', (select count(*) from public.work_packages w where w.job_id = p_job_id),
    'Allocations', (select count(*) from public.allocations a join public.work_packages w on w.id = a.work_package_id where w.job_id = p_job_id),
    'Tasks', (select count(*) from public.tasks t where t.job_id = p_job_id),
    'Materials', (select count(*) from public.materials m where m.job_id = p_job_id),
    'Reservations', (select count(*) from public.reservations r join public.materials m on m.id = r.material_id where m.job_id = p_job_id),
    'Orders', (select count(*) from public.orders o where o.job_id = p_job_id),
    'OrderLines', (select count(*) from public.order_lines l join public.orders o on o.id = l.order_id where o.job_id = p_job_id),
    'ScaffoldBookings', (select count(*) from public.scaffold_bookings b where b.job_id = p_job_id),
    'InvoiceStages', (select count(*) from public.invoice_stages s where s.job_id = p_job_id),
    'Payments', (select count(*) from public.payments p join public.invoice_stages s on s.id = p.invoice_stage_id where s.job_id = p_job_id),
    'CommissioningSubmissions', (select count(*) from public.commissioning_submissions c where c.job_id = p_job_id),
    'CommissioningAnswers', (select count(*) from public.commissioning_answers a join public.commissioning_submissions c on c.id = a.submission_id where c.job_id = p_job_id),
    'JobEquipment', (select count(*) from public.job_equipment e where e.job_id = p_job_id),
    'Handover', (select count(*) from public.handover h where h.job_id = p_job_id),
    'Issues', (select count(*) from public.issues i where i.job_id = p_job_id),
    'CalendarLinks', (select count(*) from public.calendar_links c where c.job_id = p_job_id),
    'Communications', (select count(*) from public.communications c where c.job_id = p_job_id),
    'GHLTasks', (select count(*) from public.ghl_tasks g where g.job_id = p_job_id),
    'JobCosts', (select count(*) from public.job_costs c where c.job_id = p_job_id))
$$;

-- ARCHIVE_JOB (_s16ArchiveJob). Logical archive: rows stay in the database
-- (FN-13 "retain active records"); the job is stamped archived_at and a
-- manifest row is written. Payload: reason. expected_version = jobs.version.
create function app.cmd_archive_job(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['reason'], array['reason']);
  v_reason text := app.txt(v_p, 'reason');
  v_job public.jobs;
  v_after public.jobs;
  v_open public.archive_index;
  v_elig jsonb;
  v_counts jsonb;
  v_now timestamptz := now();
  v_entry public.archive_index;
  v_total bigint;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  select * into v_open from public.archive_index a where a.job_id = v_job.id and a.restored_at is null;
  if found then
    return jsonb_build_object('status', 'AlreadyArchived', 'archived', false, 'replay', true, 'job_id', v_job.id,
                              'archive_id', v_open.id, 'detail', 'Already archived', 'external_calls', 0);
  end if;
  v_elig := app.s16_archive_eligibility(v_job.id);
  if not (v_elig ->> 'eligible')::boolean then
    perform app.fail('S16_REVIEW: job not archive-eligible', jsonb_build_object('blockers', v_elig -> 'blockers'));
  end if;
  v_counts := app.s16_archive_counts(v_job.id);
  select sum(value::bigint) into v_total from jsonb_each_text(v_counts);
  insert into public.archive_index (job_id, archive_location, archived_at, record_counts, checksum, schema_version)
  values (v_job.id, 'IN_PLACE', v_now, v_counts,
          encode(sha256(convert_to(jsonb_build_object('job_id', v_job.id, 'counts', v_counts, 'archived_at', v_now)::text, 'UTF8')), 'hex'),
          'S02-1.0')
  returning * into v_entry;
  update public.jobs set archived_at = v_now where id = v_job.id returning * into v_after;
  perform app.audit('Jobs', v_job.id::text, 'S16Archive', jsonb_build_object('archived_at', v_job.archived_at),
                    jsonb_build_object('archived_at', v_now, 'archive_id', v_entry.id), v_reason);
  return jsonb_build_object('status', 'Archived', 'archived', true, 'job_id', v_job.id, 'archive_id', v_entry.id,
    'archived_at', v_now, 'archived_by', app.actor_id(p_actor), 'total_related_rows', v_total,
    'tables_affected', (select count(*) from jsonb_object_keys(v_counts)), 'record_counts', v_counts,
    'checksum', v_entry.checksum, 'version', v_after.version, 'external_calls', 0);
end
$$;

-- REOPEN_ARCHIVED_JOB (_s16ReopenArchivedJob). IDs and history preserved; no
-- external side effects recreated. Payload: reason.
create function app.cmd_reopen_archived_job(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['reason'], array['reason']);
  v_reason text := app.txt(v_p, 'reason');
  v_job public.jobs;
  v_after public.jobs;
  v_entry public.archive_index;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('R1A_STALE_VERSION');
  end if;
  if v_job.archived_at is null then
    perform app.fail('S16_REVIEW: job not archived');
  end if;
  select * into v_entry from public.archive_index a where a.job_id = v_job.id and a.restored_at is null for update;
  if not found then
    perform app.fail('S16_REVIEW: no un-restored archive entry found');
  end if;
  update public.jobs set archived_at = null where id = v_job.id returning * into v_after;
  update public.archive_index set restored_at = now() where id = v_entry.id;
  perform app.audit('Jobs', v_job.id::text, 'S16ReopenFromArchive', jsonb_build_object('archived_at', v_job.archived_at),
                    jsonb_build_object('archived_at', null, 'restored_at', now(), 'archive_id', v_entry.id), v_reason);
  return jsonb_build_object('status', 'Reopened', 'reopened', true, 'job_id', v_job.id, 'archive_id', v_entry.id,
    'reopened_at', now(), 'reopened_by', app.actor_id(p_actor), 'previous_archived_at', v_job.archived_at,
    'workflow_stage', v_job.workflow_stage, 'version', v_after.version,
    'notes', 'IDs and history preserved. No external side effects recreated. Review fresh obligations before resuming normal operations.',
    'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Reads (public.execute_operations_read)
-- -----------------------------------------------------------------------------

create function app.read_finance_summary(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  perform app.r4_read_keys(p_request, array['job_id', 'as_of']);
  v_job := app.r4_job_access(p_actor, app.ref(p_request, 'job_id'));
  return app.s14_job_financial_summary(v_job.id,
    case when p_request ? 'as_of' then app.r4_date(p_request ->> 'as_of', 'S14_REVIEW: invalid as_of') end);
end
$$;

create function app.read_payment_reconciliation(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  perform app.r4_read_keys(p_request, array['job_id']);
  v_job := app.r4_job_access(p_actor, app.ref(p_request, 'job_id'));
  return app.s14_reconcile_payments(v_job.id);
end
$$;

create function app.read_invoice_status(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  perform app.r4_read_keys(p_request, array['job_id']);
  v_job := app.r4_job_access(p_actor, app.ref(p_request, 'job_id'));
  return jsonb_build_object('job_id', v_job.id, 'stages', app.s14_invoice_status(v_job.id));
end
$$;

create function app.read_xero_requests(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.r4_read_keys(p_request, '{}');
  return app.xero_dispatch_status(now());
end
$$;

create function app.read_archive_eligibility(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  perform app.r4_read_keys(p_request, array['job_id']);
  v_job := app.r4_job_access(p_actor, app.ref(p_request, 'job_id'));
  return app.s16_archive_eligibility(v_job.id);
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('XERO_INTENT_CREATE', array['Admin', 'Manager', 'Finance'], false,
   '[{"function_id":"FN-09","mode":"Automated"}]', 'r4_finance',
   's13/payments.js createXeroIntent; job access checked in the handler (Finance is organisation-wide)'),
  ('XERO_REVIEW_CANCEL_INVOICE', array['Admin', 'Manager', 'Office', 'Finance'], false,
   '[]', 'r4_finance',
   'xero/adapter.js _xoReviewCancelInvoice (no mode gate in the reference: used during S15 cancellation)'),
  ('REPORT_SNAPSHOT_CREATE', array['Admin', 'Manager', 'Director', 'Finance'], false,
   '[{"function_id":"FN-09","mode":"Automated"},{"function_id":"FN-12","mode":"Automated"}]', 'r4_reporting',
   's14/reporting.js createReportSnapshot'),
  ('ARCHIVE_JOB', array['Admin', 'Manager', 'Office'], true,
   '[{"function_id":"FN-13","mode":"Automated"}]', 'r4_archive', 's16/health.js _s16ArchiveJob'),
  ('REOPEN_ARCHIVED_JOB', array['Admin', 'Manager', 'Office'], true,
   '[{"function_id":"FN-13","mode":"Automated"}]', 'r4_archive', 's16/health.js _s16ReopenArchivedJob');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('FINANCE_SUMMARY', array['Admin', 'Manager', 'Director', 'Office', 'Finance'],
   '[{"function_id":"FN-09","mode":"Automated"},{"function_id":"FN-12","mode":"Automated"}]', 'r4_reporting',
   's14 jobFinancialSummary; {job_id, as_of?}'),
  ('PAYMENT_RECONCILIATION', array['Admin', 'Manager', 'Director', 'Office', 'Finance'],
   '[{"function_id":"FN-09","mode":"Automated"},{"function_id":"FN-12","mode":"Automated"}]', 'r4_reporting',
   's14 reconcilePayments; {job_id}'),
  ('INVOICE_STATUS', array['Admin', 'Manager', 'Director', 'Office', 'Finance'],
   '[{"function_id":"FN-09","mode":"Automated"},{"function_id":"FN-12","mode":"Automated"}]', 'r4_reporting',
   's14 invoiceStatusReport; {job_id}'),
  ('XERO_REQUESTS', array['Admin', 'Manager', 'Finance'], '[]', 'r4_finance', 'xero/adapter.js _xoRequests'),
  ('ARCHIVE_ELIGIBILITY', array['Admin', 'Manager', 'Office'],
   '[{"function_id":"FN-13","mode":"Automated"}]', 'r4_archive', 's16 _s16ArchiveEligibility; {job_id}');

-- -----------------------------------------------------------------------------
-- Privileges and schedule
-- -----------------------------------------------------------------------------

grant execute on function
  app.xero_dispatch_status(timestamptz), app.xero_prepare_dispatch(uuid), app.xero_note_dispatch_outcome(uuid, text, text),
  app.xero_retry_policy(), app.xero_envelope(public.outbox),
  app.xero_apply_invoice_callback(text, text, text, text, text, timestamptz),
  app.xero_apply_payment_callback(text, text, text, bigint, date, text, timestamptz),
  app.s13_run_milestones(timestamptz), app.s14_job_financial_summary(uuid, date),
  app.s14_reconcile_payments(uuid), app.s14_invoice_status(uuid, date), app.s16_archive_eligibility(uuid, date)
  to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  create extension if not exists pg_cron;
  -- 05:15 UTC, before the London working day; does nothing unless FN-09 is Automated.
  perform cron.schedule('ss-s13-milestones', '15 5 * * *', 'select app.s13_run_milestones()');
end
$$;
