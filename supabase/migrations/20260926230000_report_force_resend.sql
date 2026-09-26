-- =============================================================================
-- "Send now" must be able to send.
--
-- 20260926220000 let a FAILED period be retried by hand. A period that actually
-- went was still a dead end: the button answered "that period has already been
-- sent. Nothing was sent again." and there was no way, short of editing the
-- table, to put the same report in front of somebody who needed it again -
-- a recipient added after the send, a mailbox that bounced it, an address that
-- simply lost it.
--
-- Idempotency still holds where it earns its keep: the scheduled sweep NEVER
-- repeats a period, so no clock can mail a client twice. Only a person, having
-- been told the period already went, can ask for it again, and only by saying
-- so explicitly - p_force does not default to true anywhere.
--
-- A forced re-send rebuilds the SAME run row, as a retry does, so the period
-- keeps one entry in the history. The communication it sent before is left
-- alone: what went out on the day is a record of something that happened, and
-- re-sending does not unsend it.
--
-- ROLLBACK:
--   begin;
--   drop function if exists app.report_build(text, uuid, text, date, date, boolean, boolean);
--   -- restore app.report_build and app.cmd_report_send from 20260926220000
--   commit;
-- =============================================================================

-- A new parameter with a default would OVERLOAD rather than replace, leaving
-- the six-argument form in place and making every existing call ambiguous.
drop function if exists app.report_build(text, uuid, text, date, date, boolean);

create function app.report_build(
  p_source_kind text,
  p_source_id uuid,
  p_report_type text,
  p_from date,
  p_to date,
  p_manual boolean default false,
  p_force boolean default false
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
  v_resent boolean := false;
begin
  select * into v_sub from public.report_subscriptions
  where source_kind = p_source_kind and source_id = p_source_id and report_type = p_report_type;
  if not found then
    return jsonb_build_object('ok', false, 'detail', 'no subscription');
  end if;

  -- Already reported for this exact period?
  --
  -- Three cases, not two:
  --   the sweep            - never repeats, whatever state the run is in.
  --   a person, no force   - repeats a run that never reached the transport,
  --                          refuses one that did, and says which.
  --   a person, forced     - repeats either, because they were shown the
  --                          refusal and asked for it anyway.
  --
  -- The key name matters - app.run_reports reads 'already_reported' to decide
  -- whether a sweep did any work.
  select * into v_run from public.report_runs
  where source_kind = p_source_kind and source_id = p_source_id
    and report_type = p_report_type and period_start = p_from and period_end = p_to;
  if found then
    select * into v_comm from public.communications where id = v_run.communication_id;
    if not p_manual
       or (not coalesce(p_force, false)
           and v_comm.id is not null
           and v_comm.status in ('Sent', 'Queued', 'Sending')) then
      return jsonb_build_object('ok', true, 'already_reported', true,
                                'run_id', v_run.id, 'status', v_run.status,
                                'delivered', coalesce(v_comm.status = 'Sent', false),
                                -- The caller offers "send it again" only when a
                                -- forced repeat would actually be allowed.
                                'can_force', p_manual);
    end if;
    v_retry := true;
    v_resent := coalesce(v_comm.status = 'Sent', false);
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
  -- Say so on the envelope. A second copy of a report somebody already has,
  -- arriving with an identical subject, reads as the system sending twice.
  if v_resent then
    v_subject := v_subject || ' (re-sent)';
  end if;

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
                              'status', 'Queued', 'resent', v_resent,
                              'outbox_id', v_queued ->> 'outbox_id');
  exception when others then
    v_refusal := sqlerrm;
    update public.report_runs set status = 'Refused', detail = v_refusal where id = v_run.id;
    return jsonb_build_object('ok', true, 'run_id', v_run.id, 'communication_id', v_comm.id,
                              'status', 'Refused', 'detail', v_refusal);
  end;
end
$$;

-- -----------------------------------------------------------------------------
-- REPORT_SEND carries the flag. app.payload rejects any key not on its allow
-- list, so 'force' has to be declared here or the command fails as invalid.
-- -----------------------------------------------------------------------------
create or replace function app.cmd_report_send(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['source_kind', 'source_id', 'report_type', 'from', 'to', 'force'],
    array['source_kind', 'source_id', 'report_type']);
  v_kind text := v_p ->> 'source_kind';
  v_source uuid := (v_p ->> 'source_id')::uuid;
  v_type text := v_p ->> 'report_type';
  v_to date := coalesce(nullif(btrim(coalesce(v_p ->> 'to', '')), '')::date, app.london_date() - 1);
  v_from date;
  v_force boolean := coalesce((v_p ->> 'force')::boolean, false);
begin
  perform app.report_require_source(v_kind, v_source);
  if v_type not in ('Daily', 'Weekly') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'report_type'));
  end if;
  v_from := coalesce(nullif(btrim(coalesce(v_p ->> 'from', '')), '')::date,
                     case v_type when 'Daily' then v_to else v_to - 6 end);
  return app.report_build(v_kind, v_source, v_type, v_from, v_to, true, v_force);
end
$$;
