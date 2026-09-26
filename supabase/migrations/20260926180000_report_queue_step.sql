-- =============================================================================
-- Reports never reached the outbox.
--
-- app.report_build created the public.communications row, set it Approved, and
-- stopped. Nothing called the queue - not the manual "Send now", not the hourly
-- sweep - although the header of 20260926090000 says it "queues it through the
-- SAME app.cmd_communication_queue path every other outbound message uses".
-- It did not, and no configuration could have made a report arrive: every run
-- sat at "Ready to send · prepared and approved, but has not been queued"
-- for ever, which is a truthful description of an unfinished pipeline.
--
-- This adds the missing step, and nothing else. Every door that decides whether
-- an email actually leaves is untouched and still shut by default:
--
--   FN-22 must be Automated        app.require_mode, below, refuses otherwise
--   email.mode must be LIVE        read by public.outbox_claim
--   a real sending mailbox         read by public.outbox_claim
--   allow-listed recipients        app.outbound_guard, at send time
--
-- A refusal is RECORDED rather than raised. The scheduled sweep runs unattended
-- and must not lose a whole batch because one subscription's gate is shut, and
-- a person pressing Send now deserves to be told which gate stopped it rather
-- than seeing a failed command. So the run row carries the reason and the
-- screen reads it back.
--
-- app.communication_queue_now carries NO permission check of its own, because
-- its callers already established authority over the SOURCE
-- (programme.manage / forms.send) or are the scheduler, which has no person at
-- all. The checks that remain are the ones about the MESSAGE: dispatchable
-- type, release mode, Approved, readable recipients. cmd_communication_queue
-- keeps its own communication.send check and delegates the rest here, so the
-- staff path is unchanged.
--
-- ROLLBACK:
--   begin;
--   -- restore app.report_build from 20260926090000 (drop the queue step)
--   -- and app.cmd_communication_queue from 20260920250000.
--   drop function if exists app.communication_queue_now(uuid);
--   commit;
-- =============================================================================

create function app.communication_queue_now(p_communication_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_comm public.communications;
  v_after public.communications;
  v_kind app.communication_kinds;
  v_rec jsonb;
  v_hash text;
  v_sender text := coalesce(nullif(btrim(coalesce(app.setting('email.from_mailbox') #>> '{}', '')), ''),
                            'NOT_CONFIGURED');
  v_out public.outbox;
begin
  select * into v_comm from public.communications where id = p_communication_id for update;
  if not found then perform app.fail('COMM_NOT_FOUND'); end if;

  select * into v_kind from app.communication_kinds k where k.type = v_comm.type;
  if not found or v_kind.action_type is null then
    perform app.fail('COMM_NOT_DISPATCHABLE',
      jsonb_build_object('type', v_comm.type,
                         'detail', 'this type is sent by a person and recorded with COMMUNICATION_RECORD_SENT'));
  end if;
  -- The real door, unchanged: every function ships Disabled.
  perform app.require_mode(v_kind.function_id, 'Automated');

  if v_comm.status = 'Queued' then
    return jsonb_build_object('queued', false, 'already_queued', true,
                              'communication_id', v_comm.id, 'outbox_id', v_comm.outbox_id);
  end if;
  if v_comm.status <> 'Approved' then
    perform app.fail('COMM_NOT_APPROVED',
                     jsonb_build_object('status', v_comm.status, 'expected', 'Approved'));
  end if;

  v_rec := app.comm_recipients(v_comm);
  if not (v_rec ->> 'ok')::boolean then
    perform app.fail('COMM_RECIPIENTS_INVALID',
                     jsonb_build_object('code', v_rec ->> 'code', 'detail', v_rec ->> 'detail'));
  end if;

  v_hash := app.comm_payload_hash(v_comm);
  insert into public.outbox (idempotency_key, action_type, target, payload_hash, job_revision,
                             response_summary, correlation_id, status)
  values ('COMM-' || v_comm.id || '-R' || v_comm.revision || '-' || left(v_hash, 16),
          v_kind.action_type, v_sender, v_hash, v_comm.revision,
          'QUEUED: awaiting the email worker; nothing sent', app.context_command_id(), 'Pending')
  returning * into v_out;

  update public.communications
  set status = 'Queued', outbox_id = v_out.id
  where id = v_comm.id
  returning * into v_after;
  perform app.audit('Communications', v_after.id::text, 'CommunicationQueued',
                    to_jsonb(v_comm), to_jsonb(v_after), 'outbox ' || v_out.id);
  return jsonb_build_object('queued', true, 'communication_id', v_after.id, 'outbox_id', v_out.id,
                            'action_type', v_out.action_type, 'function_id', v_kind.function_id,
                            'status', v_after.status, 'version', v_after.version,
                            'sent', false, 'note', 'Queued only. A worker sends it, and only when every gate is open.');
end
$$;

-- The staff command keeps its own permission check and delegates the rest, so
-- there is one implementation of what queueing means.
create or replace function app.cmd_communication_queue(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_comm public.communications;
begin
  perform app.comm_require(p_actor, 'communication.send');
  v_comm := app.comm_load(p_request);
  return app.communication_queue_now(v_comm.id);
end
$$;

-- -----------------------------------------------------------------------------
-- The build now finishes the job: it queues, and records what the queue said.
-- Only the tail of the function changes; everything above it is as shipped.
-- -----------------------------------------------------------------------------

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
begin
  select * into v_sub from public.report_subscriptions
  where source_kind = p_source_kind and source_id = p_source_id and report_type = p_report_type;
  if not found then
    return jsonb_build_object('ok', false, 'detail', 'no subscription');
  end if;

  -- Already reported for this exact period: nothing to do, nothing to send.
  -- The key name matters - app.run_reports reads 'already_reported' to decide
  -- whether a sweep did any work.
  select * into v_run from public.report_runs
  where source_kind = p_source_kind and source_id = p_source_id
    and report_type = p_report_type and period_start = p_from and period_end = p_to;
  if found then
    return jsonb_build_object('ok', true, 'already_reported', true,
                              'run_id', v_run.id, 'status', v_run.status);
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

  insert into public.report_runs (source_kind, source_id, report_type, period_start, period_end,
                                  recipients, summary, triggered_by, manual)
  values (p_source_kind, p_source_id, p_report_type, p_from, p_to, v_recipients,
          (v_report - 'lines') || v_extra, app.current_person_id(), p_manual)
  returning * into v_run;

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
