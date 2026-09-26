-- =============================================================================
-- Programme reports, emailed on a schedule.
--
-- Dan wants the PCH numbers and the day's properties in his inbox rather than
-- having to open the app. That is a reporting need, not a PCH need, so nothing
-- here knows what PCH is.
--
-- Nor does it know what a PROGRAMME is. A subscription names its source as a
-- (kind, id) pair, because the second thing asked for is "send me this form's
-- responses every week" and that has no programme at all. Two nullable foreign
-- keys and a check constraint would have been the other way to write it, and
-- that shape rots the moment a third source appears.
--
-- What each kind means is decided by its own canonical reader - a programme
-- report is operational metrics and property outcomes, a form report is
-- responses - so generalising the schedule does not turn PCH into a form dump.
--
-- WHAT THIS IS NOT
-- ----------------
-- It is not a second way to send email. A due schedule builds a report, writes
-- an ordinary public.communications row and queues it through the SAME
-- app.cmd_communication_queue path every other outbound message uses, so the
-- four doors still decide whether a byte leaves:
--
--   FN-22 Automated · email.mode LIVE · email.from_mailbox set ·
--   every recipient in outbound.allowed_recipients
--
-- With the settings as they stand, the sweep builds the report, records the
-- run, and the queue refuses. That is the system working, and it is why this
-- can be deployed before anybody decides to turn sending on.
--
-- PERIODS ARE UK-LOCAL
-- --------------------
-- A "day" is a Europe/London calendar day and a "week" is a run of seven of
-- them, via app.london_date(). Not the server's day: in BST the server's UTC
-- day ends an hour late, which would put an evening visit in the wrong report.
--
-- SENDING ONCE
-- ------------
-- report_runs is unique on (source kind, source id, type, period start, period
-- end). A second sweep in the same period - a retry, two workers, a manual
-- send racing the cron - finds the run already there and does nothing. Delivery
-- retries belong to the outbox, which already has them; a failed send is the
-- same logical report, never a new one.
--
-- ROLLBACK:
--   begin;
--   select cron.unschedule('ss-reports');
--   drop function if exists app.run_reports(timestamptz);
--   drop function if exists app.report_build(text, uuid, text, date, date, boolean);
--   drop function if exists app.report_require_source(text, uuid);
--   drop function if exists app.read_programme_weekly_report(jsonb, jsonb);
--   drop function if exists app.read_form_response_report(jsonb, jsonb);
--   drop function if exists app.read_report_subscriptions(jsonb, jsonb);
--   drop function if exists app.programme_report_progress(uuid);
--   drop function if exists app.cmd_report_subscription_set(jsonb, jsonb);
--   drop function if exists app.cmd_report_send(jsonb, jsonb);
--   drop table if exists public.report_runs;
--   drop table if exists public.report_subscriptions;
--   delete from app.communication_kinds where type = 'ScheduledReport';
--   delete from app.outbox_action_types where action_type = 'EmailReport';
--   commit;
-- =============================================================================

-- -- Configuration ------------------------------------------------------------

create table public.report_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  -- What is being reported on. The id is checked by the builder for that kind,
  -- not by a foreign key, because the kinds live in different tables.
  source_kind     text not null check (source_kind in ('Programme', 'Form')),
  source_id       uuid not null,
  report_type     text not null check (report_type in ('Daily', 'Weekly')),
  enabled         boolean not null default false,
  -- Explicit, never the server's. Europe/London unless a programme says otherwise.
  timezone        text not null default 'Europe/London' check (btrim(timezone) <> ''),
  -- Local hour the report is sent, once the period it covers has closed.
  send_hour       integer not null default 7 check (send_hour between 0 and 23),
  -- Weekly only: ISO weekday the reporting week STARTS on (1 = Monday).
  -- Configurable because nobody has said which day the week runs; guessing one
  -- would be inventing a business rule and calling it a default.
  week_starts_on  integer not null default 1 check (week_starts_on between 1 and 7),
  /**
   * Who it goes to: [{"name": "...", "email": "..."}]. People are named by
   * address rather than by person id so a client-side recipient - the ones Dan
   * actually asks for - is the same shape as a colleague. Every address is
   * still checked against outbound.allowed_recipients at queue time, so being
   * listed here grants nothing.
   */
  recipients      jsonb not null default '[]'::jsonb,
  last_period_end date,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.people (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.people (id),
  version         integer not null default 1,
  unique (source_kind, source_id, report_type)
);

comment on table public.report_subscriptions is
  'When a programme''s report is emailed, and to whom. Disabled by default; being listed here grants nothing - outbound.allowed_recipients still decides.';

create trigger report_subscriptions_touch before insert or update
  on public.report_subscriptions for each row execute function app.touch_row();

-- -- What has already been reported --------------------------------------------

create table public.report_runs (
  id               uuid primary key default gen_random_uuid(),
  source_kind      text not null check (source_kind in ('Programme', 'Form')),
  source_id        uuid not null,
  report_type      text not null check (report_type in ('Daily', 'Weekly')),
  period_start     date not null,
  period_end       date not null check (period_end >= period_start),
  communication_id uuid references public.communications (id) on delete set null,
  status           text not null default 'Built'
                   check (status in ('Built', 'Queued', 'Refused', 'Failed')),
  detail           text,
  recipients       jsonb not null default '[]'::jsonb,
  /** The numbers as sent, so a later question about an old report is answerable. */
  summary          jsonb not null default '{}'::jsonb,
  triggered_by     uuid references public.people (id),
  manual           boolean not null default false,
  created_at       timestamptz not null default now(),
  -- The whole point: one report per source, per type, per period. Ever.
  unique (source_kind, source_id, report_type, period_start, period_end)
);

comment on table public.report_runs is
  'One row per source/type/period. The unique key is what stops a retried sweep sending the same report twice.';

alter table public.report_subscriptions enable row level security;
alter table public.report_runs enable row level security;

-- Reading a subscription needs the permission that reads its SOURCE: seeing
-- who gets the PCH report is a programme question, seeing who gets a form's
-- responses is a forms question.
create policy report_subscriptions_read on public.report_subscriptions
  for select to authenticated using (
    case source_kind
      when 'Programme' then app.has_permission('programme.report')
      when 'Form' then app.has_permission('forms.read')
      else false
    end);
create policy report_runs_read on public.report_runs
  for select to authenticated using (
    case source_kind
      when 'Programme' then app.has_permission('programme.report')
      when 'Form' then app.has_permission('forms.read')
      else false
    end);

grant select on public.report_subscriptions, public.report_runs to authenticated;
grant all on public.report_subscriptions, public.report_runs to service_role;

-- -- The weekly report, on the same terms as the daily one ----------------------

/**
 * A reporting week: the same shape as the daily report, over a date range.
 *
 * Deliberately the same field names as read_programme_daily_report, so one
 * renderer draws both and the email layer never decides what a number means.
 */
create or replace function app.programme_weekly_report_data(p_programme_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_programme_id uuid := p_programme_id;
  v_from date := p_from;
  v_to date := p_to;
  v_programme public.programmes;
begin
  select * into v_programme from public.programmes where id = v_programme_id;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;
  if v_to < v_from then perform app.fail('R1A_INVALID_FIELDS'); end if;

  return (
    with visit as (
      select v.*, pp.external_ref, pp.address_line1, pp.postcode, pp.expected_meter_serial,
             pe.display_name as installer
      from public.programme_visits v
      join public.programme_properties pp on pp.id = v.property_id
      left join public.people pe on pe.id = v.installer_id
      where v.programme_id = v_programme.id
        and v.visit_date between v_from and v_to
        and v.review_status <> 'Draft'
    )
    select jsonb_build_object(
      'programme', jsonb_build_object('id', v_programme.id, 'code', v_programme.code,
                                      'name', v_programme.name, 'client_name', v_programme.client_name),
      'from', v_from,
      'to', v_to,
      'properties_attended', (select count(distinct property_id) from visit),
      'visits', (select count(*) from visit),
      'sims_swapped', (select count(*) from visit where app.programme_outcome_is_sim_change(outcome)),
      'no_access', (select count(*) from visit where outcome = 'TenantNotHome'),
      'meters_requiring_replacement', (select count(*) from visit
                                       where outcome = 'MeterDead' or disposition = 'MeterRequiresChanging'),
      'action_required', (select count(*) from visit where disposition = 'ActionRequired'),
      'complete_and_live', (select count(*) from visit where disposition = 'CompleteAndWorking'),
      'awaiting_review', (select count(*) from visit where review_status = 'AwaitingReview'),
      'awaiting_portal_confirmation', (select count(*) from visit
                                       where portal_check_required and portal_verification is null),
      'portal_confirmed_live', (select count(*) from visit where portal_verification = 'ConfirmedLive'),
      'portal_not_live', (select count(*) from visit where portal_verification = 'NotLive'),
      'portal_unable_to_verify', (select count(*) from visit where portal_verification = 'UnableToVerify'),
      'serial_mismatches', (select count(*) from visit where meter_serial_matches is false),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'external_ref', external_ref, 'address', address_line1, 'postcode', postcode,
          'installer', installer, 'outcome', outcome, 'visit_date', visit_date,
          'expected_meter_serial', expected_meter_serial, 'actual_meter_serial', actual_meter_serial,
          'meter_serial_matches', meter_serial_matches, 'meter_reading', meter_reading,
          'new_sim_serial', new_sim_serial, 'csq', csq, 'signal_classification', signal_classification,
          'portal_verification', portal_verification, 'disposition', disposition,
          'review_status', review_status, 'comments', installer_comments)
        order by visit_date, external_ref) from visit), '[]'::jsonb))
  );
end
$$;


-- -- Where a programme stands overall ------------------------------------------

/**
 * Cumulative position, independent of the reporting period, read from the same
 * tables the board reads. The email layer never counts anything itself.
 */
create function app.programme_report_progress(p_programme_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'target', (select target_property_count from public.programmes where id = p_programme_id),
    'properties', (select count(*) from public.programme_properties
                   where programme_id = p_programme_id and active),
    'attended', (select count(distinct property_id) from public.programme_visits
                 where programme_id = p_programme_id and review_status <> 'Draft'),
    'complete_and_live', (select count(distinct property_id) from public.programme_visits
                          where programme_id = p_programme_id and disposition = 'CompleteAndWorking'))
$$;

-- -- The other kind of report: a form's responses -------------------------------

/**
 * What a form collected over a period.
 *
 * Counts and the fact of each response - who it was for, when it arrived, which
 * version they answered. NOT the answers: a form can ask anything, including
 * things nobody intended to email onward, and a subscription is a standing
 * instruction rather than a decision about one form's contents. Whoever reads
 * the report opens the response in the app, where permissions still apply.
 */
/**
 * What a form collected over a period, each response read through the revision
 * it was actually answered on.
 *
 * This is the part that has to be right. A published revision is immutable and
 * a submission names the one it answered, so the labels here come from THAT
 * revision - never from whatever the form says today. Reword a question and
 * republish, and last week's responses still read with last week's words;
 * showing them under the new wording would put answers against questions
 * nobody was asked.
 *
 * Photographs and signatures are left out. They are evidence, they live behind
 * the evidence permissions, and a report is a thing people forward - so no
 * storage path and no signed URL can appear here by construction: the value is
 * never read for those field types at all.
 */
create function app.form_response_report_data(p_form_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_form_id uuid := p_form_id;
  v_from date := p_from;
  v_to date := p_to;
  v_form public.forms;
begin
  select * into v_form from public.forms where id = v_form_id;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;
  if v_to < v_from then perform app.fail('R1A_INVALID_FIELDS'); end if;

  return (
    with response as (
      select s.id, s.submitted_at, s.answers, s.revision_id,
             r.revision_number, r.definition,
             i.recipient_type, i.recipient_label, j.job_ref
      from public.form_submissions s
      join public.form_revisions r on r.id = s.revision_id
      left join public.form_invitations i on i.id = s.invitation_id
      left join public.jobs j on j.id = i.job_id
      where s.form_id = v_form.id
        and (s.submitted_at at time zone 'Europe/London')::date between v_from and v_to
    ), readable as (
      select rs.*,
             (select coalesce(jsonb_agg(jsonb_build_object(
                  'label', f.value ->> 'label',
                  'value', rs.answers ->> (f.value ->> 'id'))
                order by f.ordinality), '[]'::jsonb)
              from jsonb_array_elements(rs.definition -> 'fields')
                   with ordinality as f(value, ordinality)
              where f.value ->> 'type' not in ('photo', 'signature', 'section', 'info')
                and rs.answers ? (f.value ->> 'id')) as fields
      from response rs
    )
    select jsonb_build_object(
      'form', jsonb_build_object('id', v_form.id, 'title', v_form.title,
                                 'status', v_form.status),
      'from', v_from,
      'to', v_to,
      'responses', (select count(*) from response),
      'versions_answered', (select count(distinct revision_number) from response),
      -- Which versions the period spans, so a reader knows the wording moved.
      'versions', coalesce((select jsonb_agg(distinct revision_number order by revision_number)
                            from response), '[]'::jsonb),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'submitted_at', submitted_at, 'version', revision_number,
          'recipient_type', recipient_type, 'recipient', recipient_label,
          'job_ref', job_ref,
          -- Read through the answered revision, never the current one.
          'fields', fields)
        order by submitted_at) from readable), '[]'::jsonb))
  );
end
$$;

-- -- The same reports, without the staff permission gate -----------------------
--
-- A scheduled report is built by a background job that has no actor to require
-- a permission of. The data and the gate are therefore separate: these compute,
-- the reads below check who is asking and then call them. One implementation of
-- what a number means, two callers with different authority.

create function app.programme_daily_report_data(p_programme_id uuid, p_date date)
returns jsonb
language sql stable
set search_path = ''
as $$
  select app.programme_weekly_report_data(p_programme_id, p_date, p_date)
         - 'from' - 'to' || jsonb_build_object('date', p_date)
$$;

/** The staff read: same numbers, with the module gate and the permission. */
create or replace function app.read_programme_weekly_report(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_request -> 'payload', p_request);
  v_programme_id uuid := app.programme_uuid(v_payload, 'programme_id');
  v_to date := coalesce(nullif(btrim(coalesce(v_payload ->> 'to', '')), '')::date, app.london_date());
  v_from date := coalesce(nullif(btrim(coalesce(v_payload ->> 'from', '')), '')::date, v_to - 6);
begin
  if not app.programmes_on() then perform app.fail('R1A_MODE_DENIED'); end if;
  perform app.programme_require('programme.report');
  return app.programme_weekly_report_data(v_programme_id, v_from, v_to);
end
$$;

/** The staff read for a form's responses. */
create function app.read_form_response_report(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_request -> 'payload', p_request);
  v_form_id uuid := (v_payload ->> 'form_id')::uuid;
  v_to date := coalesce(nullif(btrim(coalesce(v_payload ->> 'to', '')), '')::date, app.london_date());
  v_from date := coalesce(nullif(btrim(coalesce(v_payload ->> 'from', '')), '')::date, v_to);
begin
  perform app.forms_require('forms.read');
  return app.form_response_report_data(v_form_id, v_from, v_to);
end
$$;

-- -- Registering the report as an ordinary outbound message ---------------------

insert into app.outbox_action_types (action_type, service, function_id, live_setting, max_attempts,
                                     backoff_minutes, stalled_minutes, claim_hook, result_hook, module, notes) values
  ('EmailReport', 'EmailService', 'FN-22', 'email.mode', 5, '{1,2,4,8,16}', 15,
   'email_claim_decision', 'email_on_result', 'reporting',
   'Scheduled reports, whatever their source. FN-22 Automated + email.mode LIVE + a configured sender + allow-listed recipients.');

insert into app.communication_kinds (type, action_type, function_id, module, notes) values
  ('ScheduledReport', 'EmailReport', 'FN-22', 'reporting',
   'app.run_reports, daily and weekly reports for a programme or a form.');

-- -- Building and queueing one report, whatever its source ----------------------

/**
 * Builds one closed period for one subscription, once.
 *
 * Returns what happened rather than raising: the sweep runs many subscriptions
 * and one refusal must not abandon the rest. A refusal is recorded on the run -
 * "the report exists, nothing was sent, here is why".
 */
create function app.report_build(
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
  v_subject text;
  v_name text;
  v_recipients jsonb;
begin
  select * into v_sub from public.report_subscriptions
  where source_kind = p_source_kind and source_id = p_source_id and report_type = p_report_type;
  if not found then return jsonb_build_object('ok', false, 'detail', 'no subscription'); end if;

  -- Already reported for this exact period: nothing to do, nothing to send.
  select * into v_run from public.report_runs
  where source_kind = p_source_kind and source_id = p_source_id
    and report_type = p_report_type and period_start = p_from and period_end = p_to;
  if found then
    return jsonb_build_object('ok', true, 'already_reported', true,
                              'run_id', v_run.id, 'status', v_run.status);
  end if;

  if p_source_kind = 'Programme' then
    select name into v_name from public.programmes where id = p_source_id;
    if v_name is null then return jsonb_build_object('ok', false, 'detail', 'programme not found'); end if;
    v_report := case p_report_type
      when 'Daily' then app.programme_daily_report_data(p_source_id, p_to)
      else app.programme_weekly_report_data(p_source_id, p_from, p_to)
    end;
    v_extra := jsonb_build_object('progress', app.programme_report_progress(p_source_id));
  elsif p_source_kind = 'Form' then
    select title into v_name from public.forms where id = p_source_id;
    if v_name is null then return jsonb_build_object('ok', false, 'detail', 'form not found'); end if;
    v_report := app.form_response_report_data(p_source_id, p_from, p_to);
  else
    return jsonb_build_object('ok', false, 'detail', 'unknown source kind');
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
  return jsonb_build_object('ok', true, 'run_id', v_run.id, 'communication_id', v_comm.id,
                            'status', 'Built');
end
$$;

-- -- The sweep -----------------------------------------------------------------

/**
 * Runs every subscription whose period has closed and whose local send hour has
 * passed. Safe to call as often as you like: the run table decides.
 */
create function app.run_reports(p_at timestamptz default now())
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_sub public.report_subscriptions;
  v_local date;
  v_hour integer;
  v_from date;
  v_to date;
  v_built integer := 0;
  v_skipped integer := 0;
  v_result jsonb;
begin
  for v_sub in select * from public.report_subscriptions where enabled loop
    -- A switched-off module reports nothing, however the subscription is set.
    if v_sub.source_kind = 'Programme' and not app.programmes_on() then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_local := (p_at at time zone v_sub.timezone)::date;
    v_hour := extract(hour from (p_at at time zone v_sub.timezone))::int;
    if v_hour < v_sub.send_hour then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_sub.report_type = 'Daily' then
      -- Yesterday, local: today has not finished.
      v_to := v_local - 1;
      v_from := v_to;
    else
      -- The most recent complete week, ending the day before one restarts.
      v_to := v_local - 1;
      while extract(isodow from v_to + 1)::int <> v_sub.week_starts_on loop
        v_to := v_to - 1;
      end loop;
      v_from := v_to - 6;
    end if;

    v_result := app.report_build(v_sub.source_kind, v_sub.source_id, v_sub.report_type,
                                 v_from, v_to, false);
    if coalesce((v_result ->> 'already_reported')::boolean, false) then
      v_skipped := v_skipped + 1;
    else
      v_built := v_built + 1;
      update public.report_subscriptions set last_period_end = v_to where id = v_sub.id;
    end if;
  end loop;

  return jsonb_build_object('built', v_built, 'skipped', v_skipped, 'at', p_at);
end
$$;

grant execute on function app.run_reports(timestamptz) to service_role;

/**
 * The sweep, callable by name from the service role.
 *
 * app.* is not reachable over PostgREST, and a scheduler-driven function that
 * cannot be invoked in a test is a function nobody checks.
 */
create function public.run_reports_at(p_at timestamptz default now())
returns jsonb
language sql
security definer
set search_path = ''
as $$ select app.run_reports(p_at) $$;

revoke execute on function public.run_reports_at(timestamptz) from public, anon, authenticated;
grant execute on function public.run_reports_at(timestamptz) to service_role;

-- -- Who may configure what ------------------------------------------------------

/** Scheduling a report needs authority over its SOURCE, not a reporting role. */
create function app.report_require_source(p_source_kind text, p_source_id uuid)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if p_source_kind = 'Programme' then
    if not app.programmes_on() then perform app.fail('R1A_MODE_DENIED'); end if;
    perform app.programme_require('programme.manage');
  elsif p_source_kind = 'Form' then
    perform app.forms_require('forms.send');
  else
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'source_kind'));
  end if;
end
$$;

-- -- Staff commands -------------------------------------------------------------

/** REPORT_SUBSCRIPTION_SET {source_kind, source_id, report_type, enabled?, send_hour?, week_starts_on?, recipients?, timezone?} */
create function app.cmd_report_subscription_set(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['source_kind', 'source_id', 'report_type', 'enabled', 'send_hour',
          'week_starts_on', 'recipients', 'timezone', 'notes'],
    array['source_kind', 'source_id', 'report_type']);
  v_kind text := v_p ->> 'source_kind';
  v_source uuid := (v_p ->> 'source_id')::uuid;
  v_type text := v_p ->> 'report_type';
  v_recipients jsonb := coalesce(v_p -> 'recipients', '[]'::jsonb);
  v_entry jsonb;
  v_before public.report_subscriptions;
  v_after public.report_subscriptions;
begin
  perform app.report_require_source(v_kind, v_source);
  if v_type not in ('Daily', 'Weekly') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'report_type'));
  end if;
  if jsonb_typeof(v_recipients) <> 'array' or jsonb_array_length(v_recipients) > 50 then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'recipients'));
  end if;
  -- Server-side address validation: a typo here is an email nobody receives.
  for v_entry in select value from jsonb_array_elements(v_recipients) loop
    if jsonb_typeof(v_entry) <> 'object'
       or coalesce(v_entry ->> 'email', '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'recipients.email'));
    end if;
  end loop;

  select * into v_before from public.report_subscriptions
  where source_kind = v_kind and source_id = v_source and report_type = v_type;

  insert into public.report_subscriptions as s
    (source_kind, source_id, report_type, enabled, timezone, send_hour, week_starts_on,
     recipients, notes, created_by)
  values (v_kind, v_source, v_type,
          coalesce((v_p ->> 'enabled')::boolean, false),
          coalesce(nullif(btrim(coalesce(v_p ->> 'timezone', '')), ''), 'Europe/London'),
          coalesce((v_p ->> 'send_hour')::int, 7),
          coalesce((v_p ->> 'week_starts_on')::int, 1),
          v_recipients, app.txt(v_p, 'notes'), app.actor_id(p_actor))
  on conflict (source_kind, source_id, report_type) do update set
    enabled        = coalesce((v_p ->> 'enabled')::boolean, s.enabled),
    timezone       = coalesce(nullif(btrim(coalesce(v_p ->> 'timezone', '')), ''), s.timezone),
    send_hour      = coalesce((v_p ->> 'send_hour')::int, s.send_hour),
    week_starts_on = coalesce((v_p ->> 'week_starts_on')::int, s.week_starts_on),
    recipients     = case when v_p ? 'recipients' then v_recipients else s.recipients end,
    notes          = coalesce(app.txt(v_p, 'notes'), s.notes),
    updated_by     = app.actor_id(p_actor)
  returning * into v_after;

  perform app.audit('report_subscription', v_after.id::text, 'REPORT_SUBSCRIPTION_SET',
    to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('subscription_id', v_after.id, 'enabled', v_after.enabled,
                            'version', v_after.version);
end
$$;

/** REPORT_SUBSCRIPTION_DELETE {source_kind, source_id, report_type} - removes the instruction, keeps the history. */
create function app.cmd_report_subscription_delete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['source_kind', 'source_id', 'report_type'],
                           array['source_kind', 'source_id', 'report_type']);
  v_kind text := v_p ->> 'source_kind';
  v_source uuid := (v_p ->> 'source_id')::uuid;
  v_type text := v_p ->> 'report_type';
  v_before public.report_subscriptions;
begin
  perform app.report_require_source(v_kind, v_source);
  select * into v_before from public.report_subscriptions
  where source_kind = v_kind and source_id = v_source and report_type = v_type;
  if not found then
    perform app.fail('REPORT_SUBSCRIPTION_NOT_FOUND');
  end if;

  -- The runs stay. What was reported, to whom, and when is a record of
  -- something that happened; deleting the instruction does not unhappen it.
  delete from public.report_subscriptions where id = v_before.id;

  perform app.audit('report_subscription', v_before.id::text, 'REPORT_SUBSCRIPTION_DELETE',
    to_jsonb(v_before), null);
  return jsonb_build_object('deleted', true, 'report_type', v_type);
end
$$;

/** REPORT_SEND {source_kind, source_id, report_type, from?, to?} - the same builder the sweep uses. */
create function app.cmd_report_send(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['source_kind', 'source_id', 'report_type', 'from', 'to'],
    array['source_kind', 'source_id', 'report_type']);
  v_kind text := v_p ->> 'source_kind';
  v_source uuid := (v_p ->> 'source_id')::uuid;
  v_type text := v_p ->> 'report_type';
  v_to date := coalesce(nullif(btrim(coalesce(v_p ->> 'to', '')), '')::date, app.london_date() - 1);
  v_from date;
begin
  perform app.report_require_source(v_kind, v_source);
  if v_type not in ('Daily', 'Weekly') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'report_type'));
  end if;
  v_from := coalesce(nullif(btrim(coalesce(v_p ->> 'from', '')), '')::date,
                     case v_type when 'Daily' then v_to else v_to - 6 end);
  return app.report_build(v_kind, v_source, v_type, v_from, v_to, true);
end
$$;

/** REPORT_SUBSCRIPTIONS {source_kind, source_id} - configuration and recent runs. */
create function app.read_report_subscriptions(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_request -> 'payload', p_request);
  v_kind text := v_payload ->> 'source_kind';
  v_source uuid := (v_payload ->> 'source_id')::uuid;
begin
  if v_kind = 'Programme' then
    if not app.programmes_on() then perform app.fail('R1A_MODE_DENIED'); end if;
    perform app.programme_require('programme.report');
  elsif v_kind = 'Form' then
    perform app.forms_require('forms.read');
  else
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'source_kind'));
  end if;

  return jsonb_build_object(
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'source_kind', s.source_kind, 'source_id', s.source_id,
        'report_type', s.report_type, 'enabled', s.enabled, 'timezone', s.timezone,
        'send_hour', s.send_hour, 'week_starts_on', s.week_starts_on,
        'recipients', s.recipients, 'last_period_end', s.last_period_end, 'version', s.version)
      order by s.report_type)
      from public.report_subscriptions s
      where s.source_kind = v_kind and s.source_id = v_source), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'report_type', r.report_type, 'period_start', r.period_start,
        'period_end', r.period_end, 'status', r.status, 'detail', r.detail,
        'manual', r.manual, 'created_at', r.created_at,
        -- The delivery story, from the canonical rows rather than from the
        -- report's own optimism: a communication that is merely Approved has
        -- not been sent, and the outbox is what knows whether it left.
        'communication_status', c.status,
        'outbox_status', o.status,
        'outbox_attempts', o.attempt_count,
        'delivery_detail', o.response_summary,
        'sent_at', c.sent_at,
        'summary', r.summary)
      order by r.created_at desc)
      from (select * from public.report_runs
            where source_kind = v_kind and source_id = v_source
            order by created_at desc limit 20) r
      left join public.communications c on c.id = r.communication_id
      left join public.outbox o on o.id = c.outbox_id), '[]'::jsonb));
end
$$;

-- -- Registration ---------------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes)
select t, array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Installer',
                'Store', 'Finance', 'Scaffolder', 'ReadOnly'],
       false, '[]'::jsonb, 'reporting',
       'Handler requires authority over the SOURCE (programme.manage or forms.send). Building a report sends nothing: the queue decides that.'
from unnest(array['REPORT_SUBSCRIPTION_SET', 'REPORT_SUBSCRIPTION_DELETE', 'REPORT_SEND']) as t;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('PROGRAMME_WEEKLY_REPORT',
   array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'],
   '[{"function_id": "FN-22", "mode": "Manual"}]'::jsonb, 'programmes',
   'Handler requires programme.report. The same shape as the daily report, over a configured week.'),
  ('FORM_RESPONSE_REPORT',
   array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'],
   '[]'::jsonb, 'forms',
   'Handler requires forms.read. Counts and the fact of each response; never the answers.'),
  ('REPORT_SUBSCRIPTIONS',
   array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'],
   '[]'::jsonb, 'reporting',
   'Handler requires authority over the source. What is scheduled, and what has run.');

-- -- Scheduling ----------------------------------------------------------------
--
-- Hourly, because each subscription decides its own local send hour and one UTC
-- time cannot be 07:00 in London on both sides of a DST change.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return;
  end if;
  create extension if not exists pg_cron;
  perform cron.schedule('ss-reports', '10 * * * *', 'select app.run_reports()');
end
$$;
