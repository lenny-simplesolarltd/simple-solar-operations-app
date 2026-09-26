-- =============================================================================
-- A period that never sent can be sent again.
--
-- report_runs is keyed on the period, and any existing row meant "already
-- reported". That is right for a report that WENT: nobody wants a client
-- receiving Monday's figures twice. It was wrong for one that did not.
--
-- A run refused by a gate, stopped because the sender had changed, or never
-- claimed by a worker left the period permanently unsendable. "Send now"
-- answered "that period has already been reported. Nothing was sent again."
-- about an email that had never existed, and there was no way to ask for it
-- again short of editing the table.
--
-- Now a repeat is refused when the message actually reached the transport -
-- Sent, or Queued and still in flight - and allowed, BY HAND ONLY, when it did
-- not. The scheduled sweep still never retries: it would re-attempt a broken
-- period every hour for ever, and a person choosing to try again is the right
-- trigger for something that failed.
--
-- A retry rebuilds the SAME run row rather than adding another, so a period
-- keeps one entry in the history instead of one per attempt.
--
-- ROLLBACK:
--   begin;
--   -- restore app.report_build from 20260926180000
--   commit;
-- =============================================================================

create or replace function app.report_build(
  p_source_kind text,
  p_source_id uuid,
  p_report_type text,
  p_from date,
  p_to date,
  p_manual boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.report_subscriptions;
  v_report jsonb;
  v_extra jsonb := '{}'::jsonb;
  v_run public.report_runs;
  v_comm public.communications;
  v_recipients jsonb;
  v_subject text;
  v_name text;
  v_queued jsonb;
  v_refusal text;
  v_retry boolean := false;
begin
  select * into v_sub from public.report_subscriptions
  where source_kind = p_source_kind and source_id = p_source_id and report_type = p_report_type;
  if not found then
    return jsonb_build_object('ok', false, 'detail', 'no subscription');
  end if;

  -- Already reported for this exact period?
  --
  -- Idempotency exists to stop a period being DELIVERED twice, not to stop a
  -- failed one being tried again. A run whose message never reached anybody -
  -- refused by a gate, stopped because the sender had changed, or simply never
  -- claimed - left the period permanently unsendable: "Send now" answered
  -- "that period has already been reported" about an email that does not
  -- exist, and there was no way to ask for it again.
  --
  -- So a repeat is refused when the message actually WENT, and allowed by hand
  -- when it did not. The scheduled sweep never retries: it would re-attempt a
  -- broken period every hour for ever, and a person deciding to try again is
  -- the right trigger.
  --
  -- The key name matters - app.run_reports reads 'already_reported' to decide
  -- whether a sweep did any work.
  select * into v_run from public.report_runs
  where source_kind = p_source_kind and source_id = p_source_id
    and report_type = p_report_type and period_start = p_from and period_end = p_to;
  if found then
    select * into v_comm from public.communications where id = v_run.communication_id;
    if not p_manual or (v_comm.id is not null and v_comm.status in ('Sent', 'Queued', 'Sending')) then
      return jsonb_build_object('ok', true, 'already_reported', true,
                                'run_id', v_run.id, 'status', v_run.status,
                                'delivered', coalesce(v_comm.status = 'Sent', false));
    end if;
    v_retry := true;
  end if;

  if p_source_kind = 'Programme' then
    select name into v_name from public.programmes where id = p_source_id;
    v_report := app.programme_weekly_report_data(p_source_id, p_from, p_to);
    v_extra := jsonb_build_object('progress', app.programme_report_progress(p_source_id));
  else
    select title into v_name from public.forms where id = p_source_id;
    v_report := app.form_response_report_data(p_source_id, p_from, p_to);
  end if;

  v_recipients := v_sub.recipients;
  v_subject := v_name || ' — ' ||
    case p_report_type when 'Daily' then 'daily report, ' || to_char(p_to, 'DD Mon YYYY')
                       else 'weekly report, ' || to_char(p_from, 'DD Mon') || ' to ' || to_char(p_to, 'DD Mon YYYY') end;

  if v_retry then
    -- Same row, rebuilt: the period keeps one history entry rather than
    -- accumulating one per attempt.
    update public.report_runs
    set recipients = v_recipients,
        summary = (v_report - 'lines') || v_extra,
        triggered_by = app.current_person_id(),
        manual = true,
        status = 'Built',
        detail = null,
        communication_id = null
    where id = v_run.id
    returning * into v_run;
  else
    insert into public.report_runs (source_kind, source_id, report_type, period_start, period_end,
                                    recipients, summary, triggered_by, manual)
    values (p_source_kind, p_source_id, p_report_type, p_from, p_to, v_recipients,
            (v_report - 'lines') || v_extra, app.current_person_id(), p_manual)
    returning * into v_run;
  end if;

  if jsonb_array_length(v_recipients) = 0 then
    update public.report_runs set status = 'Refused', detail = 'no recipients configured'
    where id = v_run.id;
    return jsonb_build_object('ok', true, 'run_id', v_run.id, 'status', 'Refused',
                              'detail', 'no recipients configured');
  end if;

  insert into public.communications (type, subject, body_snapshot, recipients_snapshot, status, delivery_date)
  values ('ScheduledReport', v_subject,
          (v_report || v_extra || jsonb_build_object('report_type', p_report_type,
                                                     'source_kind', p_source_kind))::text,
          v_recipients::text, 'Approved', p_to)
  returning * into v_comm;

  update public.report_runs set communication_id = v_comm.id where id = v_run.id;

  -- Hand it to the outbox. A shut gate is an outcome, not a crash: the sweep
  -- must not abandon the other subscriptions, and a person pressing Send now
  -- is owed the reason rather than a failed command.
  begin
    v_queued := app.communication_queue_now(v_comm.id);
    update public.report_runs
    set status = 'Queued',
        detail = 'queued for the email worker; nothing sent yet'
    where id = v_run.id;
    return jsonb_build_object('ok', true, 'run_id', v_run.id, 'communication_id', v_comm.id,
                              'status', 'Queued', 'outbox_id', v_queued ->> 'outbox_id');
  exception when others then
    v_refusal := sqlerrm;
    update public.report_runs set status = 'Refused', detail = v_refusal where id = v_run.id;
    return jsonb_build_object('ok', true, 'run_id', v_run.id, 'communication_id', v_comm.id,
                              'status', 'Refused', 'detail', v_refusal);
  end;
end
$$;

-- -----------------------------------------------------------------------------
-- Scheduled reports need their OWN release function.
--
-- The EmailReport outbox action and the ScheduledReport communication kind were
-- both registered against FN-22, the gate for the Programmes MODULE. But
-- app.mode_available is an exact match, not a ladder:
--
--   FN-22 = Manual      Programmes works. Queueing a report needs 'Automated',
--                       so no report can ever be sent.
--   FN-22 = Automated   A report can be queued. app.programmes_on() is
--                       false, so the whole Programmes module switches off -
--                       its screens, its reads, and the reports themselves.
--
-- The two requirements are mutually exclusive, so scheduled reporting could
-- never be switched on at all. Worse, trying would have taken Programmes down
-- for everybody, which is exactly the sort of thing a release gate exists to
-- prevent rather than cause.
--
-- FN-23 gates emailing a report, whatever its source - a programme's daily
-- figures or a form's responses. A form report has nothing to do with
-- Programmes, so borrowing FN-22 was wrong on those grounds too.
--
-- Ships Disabled. Switching it to Automated is a deliberate act, and still only
-- the first of four doors: email.mode LIVE, a configured sending mailbox and an
-- allow-listed recipient all remain.
-- -----------------------------------------------------------------------------

insert into public.release_modes (function_id, function_name, mode, mode_record_basis, authorised_job_scope,
                                  target_release, planned_target_mode, current_system, fallback, scope_boundary_notes)
values ('FN-23', 'Scheduled reports emailed to recipients', 'Disabled',
        'Reporting v1 migration; disabled until approved', 'None', 'R1', 'Automated',
        'The office reads the report on screen and forwards it by hand',
        'The office reads the report on screen and forwards it by hand',
        'Switch to Automated (scope Pilot or All) to let the worker send reports. Independent of FN-22: Programmes stays on Manual.')
on conflict (function_id) do nothing;

update app.outbox_action_types set function_id = 'FN-23' where action_type = 'EmailReport';
update app.communication_kinds  set function_id = 'FN-23' where type = 'ScheduledReport';
