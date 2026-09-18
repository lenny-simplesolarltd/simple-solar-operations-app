-- =============================================================================
-- Backend port, R2: scaffold commitments (FN-04).
--
-- Sources (canonical): scaffold/workflow.js (booking lifecycle, revisions,
-- acknowledgements, chase, weekly lists, complaints, read models);
-- s09/scaffold.js (requirement evaluation, erect date from install date minus
-- the scaffolder's lead days rolled back off non-working days);
-- docs/SCAFFOLD-implementation.md, docs/S09-implementation.md,
-- tests/scaffold.test.cjs, tests/s09.test.cjs; REF-04 §0, §1.3, §7, §8.
--
-- Commands (app.command_registry, handlers app.cmd_<lower(type)>):
--   SCAFFOLDER_CONFIGURE      _scfConfigureScaffolder (not FN-04 gated, as the reference)
--   SCAFFOLD_REQUEST          _scfRequest + s09 createScaffoldBooking (adopts the
--                             booking-intake Draft/Planned row instead of creating
--                             a parallel booking)
--   SCAFFOLD_CONFIRM_ERECT    _scfConfirmErect
--   SCAFFOLD_RECORD_ERECTED   _scfRecordErected
--   SCAFFOLD_AUTHORISE_STRIP  _scfAuthoriseStrip
--   SCAFFOLD_PLAN_STRIP       _scfPlanStrip
--   SCAFFOLD_CONFIRM_STRIP    _scfConfirmStrip
--   SCAFFOLD_RECORD_STRIPPED  _scfRecordStripped
--   SCAFFOLD_CHANGE_DATES     _scfChangeDates
--   SCAFFOLD_CANCEL           _scfCancel
--   SCAFFOLD_COMPLAINT        _scfComplaint
--   SCAFFOLD_CHASE            _scfChase (scheduler-safe, idempotent per revision)
--   SCAFFOLD_WEEKLY_LIST      _scfWeeklyList (Friday list, one Draft per company/week)
-- Reads (app.read_registry, public.execute_operations_read):
--   SCAFFOLD_REQUIREMENT      s09 evaluateScaffoldRequirement (+ proposed erect date)
--   SCAFFOLD_BOOKING          _scfBookingView
--   SCAFFOLDERS               _scfScaffolders
-- (Planner rows _scfPlannerRows are already served by the S17 planner read.)
--
-- Business rules preserved: planned / confirmed / actual are distinct fields;
-- every date move is a new revision needing re-acknowledgement (a confirmed
-- booking falls back to Requested / StripPlanned); acknowledgements are per
-- revision; erected scaffold can never be cancelled (safe strip instead);
-- strip authorisation needs customer happy + erected + no open strip-blocking
-- issue; an actual strip never closes a complaint; SCA01-SCA05 due rules
-- (London office hours from settings office.hours, staffed days from
-- office.staffed_weekdays + holidays); scaffolder messages are CAPTURED as
-- communications rows with status Draft - nothing is sent, no outbox row.
--
-- Not ported: DEV sheet/environment guard, pilot_job / release_scope job
-- gate (canonical jobs have neither; FN-04 still gates every mutation),
-- the synthetic-scaffolder fence (COMP-scaffold-dev / S09 / SCF-fixture
-- source_system and the "dev scaffold|synthetic|test" name refusal), the
-- CommitJournal (one transaction + the commands ledger: same command_id and
-- content replays, different content is R1A_COMMAND_CONFLICT), "Tanya" owner
-- lookup (task_assignment_rules decide owners), the COMP-scaffold-dev
-- hard-wired scaffolder (resolved from payload / booking / the single active
-- Scaffolder company instead).
--
-- Deviations:
--   * Deviation (REF-04 §7): a blocked strip authorisation is a refusal
--     (SCF_STRIP_BLOCKED, blockers in DETAIL) that writes nothing, so the same
--     command_id can be retried once the blocker clears; the reference
--     committed its journal on Blocked and replayed Blocked forever.
--   * The s09 erect date rolls back off non-staffed days (office weekdays +
--     office-closed holidays via app.is_staffed_day), not only Sat/Sun, and the
--     install date is the earliest live work package planned_start (falling
--     back to jobs.next_action_at): next_action_at now includes the scaffold
--     date itself (booking intake), which would make the rule circular.
--   * SCAFFOLD_REQUEST does not bump the canonical jobs row version (the
--     reference touched Jobs only to bump it); the job row lock (app.authorize_job)
--     serialises requests and the active-booking check runs under it.
--   * Missing contact email/phone is stored as null (not the literal
--     NOT_CONFIGURED); snapshots still render NOT_CONFIGURED.
--   * SCA05 relates to its Communications row (the reference labelled it
--     ScaffoldBookings with a communication id).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema alignment (ported table public.scaffold_bookings)
-- -----------------------------------------------------------------------------

-- Status vocabulary used here: the reference's (scaffold/workflow.js:15) plus
-- the booking-intake statuses Draft (no date yet) and Planned (date from the
-- booking form, not yet requested from the scaffolder). No CHECK constraint and
-- no one-active-booking-per-job unique index are added: the S15 cancellation
-- module deliberately handles several live bookings per job and other modules'
-- fixtures seed other statuses, so "one active booking per job" is enforced by
-- SCAFFOLD_REQUEST under the job row lock, as the reference did.
-- One captured weekly list per scaffolder per week (reference COMM-SCF-WEEKLY-{company}-{week}).
create unique index communications_scaffold_weekly_key on public.communications (company_id, covered_week_start)
  where type = 'ScaffoldWeeklyList';

-- -----------------------------------------------------------------------------
-- Calendar / value helpers
-- -----------------------------------------------------------------------------

-- office.hours start or end ('HH:MM'), default 09:00 / 17:00.
create function app.scf_office_time(p_which text)
returns time
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hours jsonb := app.setting('office.hours');
begin
  if jsonb_typeof(v_hours) = 'string' then
    begin
      v_hours := (v_hours #>> '{}')::jsonb;
    exception when others then
      v_hours := null;
    end;
  end if;
  if jsonb_typeof(v_hours) = 'object' and v_hours ->> 'start' ~ '^\d{2}:\d{2}$' and v_hours ->> 'end' ~ '^\d{2}:\d{2}$' then
    return (v_hours ->> p_which)::time;
  end if;
  return case when p_which = 'end' then time '17:00' else time '09:00' end;
end
$$;

create function app.scf_day_start(p_date date)
returns timestamptz
language sql stable
set search_path = ''
as $$ select app.london_at(p_date, app.scf_office_time('start')) $$;

create function app.scf_day_end(p_date date)
returns timestamptz
language sql stable
set search_path = ''
as $$ select app.london_at(p_date, app.scf_office_time('end')) $$;

-- The date itself when staffed, else the previous staffed day (reference _scfPrevStaffed, 60-day bound).
create function app.scf_prev_staffed(p_date date)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v_day date := p_date;
  n int := 0;
begin
  while not app.is_staffed_day(v_day) and n < 60 loop
    v_day := v_day - 1;
    n := n + 1;
  end loop;
  return v_day;
end
$$;

-- s09 calculateErectDate: install date minus lead days, rolled back to a staffed day.
create function app.scf_erect_date(p_install date, p_lead_days int)
returns date
language sql stable
set search_path = ''
as $$ select case when p_install is null then null else app.scf_prev_staffed(p_install - coalesce(p_lead_days, 0)) end $$;

-- Monday on or before the date; a Sunday rolls forward to the coming Monday.
create function app.scf_week_start(p_date date)
returns date
language sql immutable
set search_path = ''
as $$ select case when extract(isodow from p_date) = 7 then p_date + 1 else p_date - (extract(isodow from p_date)::int - 1) end $$;

-- YYYY-MM-DD (a longer value keeps its date prefix), null when absent, else SCF_DATE_INVALID.
create function app.scf_date(p_payload jsonb, p_key text)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := app.txt(p_payload, p_key);
  m text[];
begin
  if v is null then
    return null;
  end if;
  m := regexp_match(v, '^(\d{4})-(\d{2})-(\d{2})');
  if m is null then
    perform app.fail('SCF_DATE_INVALID');
  end if;
  begin
    return make_date(m[1]::int, m[2]::int, m[3]::int);
  exception when others then
    perform app.fail('SCF_DATE_INVALID');
  end;
end
$$;

-- Non-negative integer pence (JSON integer or digit string), null when absent.
create function app.scf_pence(p_payload jsonb, p_key text)
returns bigint
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb := p_payload -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
    return null;
  end if;
  if jsonb_typeof(v) in ('number', 'string') and btrim(v #>> '{}') ~ '^[0-9]{1,15}$' then
    return btrim(v #>> '{}')::bigint;
  end if;
  perform app.fail('SCF_REVIEW: ' || p_key || ' must be a non-negative integer');
end
$$;

create function app.scf_uuid(p_value text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case when btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then btrim(p_value)::uuid end
$$;

-- The envelope keys a scaffold command may not carry.
create function app.scf_envelope(p_request jsonb, p_allow_job boolean)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_request ?| array['task_id', 'issue_id', 'work_package_id', 'old_allocation_id']
     or (not p_allow_job and p_request ? 'job_id') then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Directory helpers
-- -----------------------------------------------------------------------------

-- An active Scaffolder company (reference _scfScaffolder).
create function app.scf_scaffolder(p_company_id uuid)
returns public.companies
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_company public.companies;
begin
  select * into v_company from public.companies c where c.id = p_company_id;
  if v_company.id is null or v_company.type <> 'Scaffolder' or not v_company.active then
    perform app.fail('SCF_REVIEW: active Scaffolder company required');
  end if;
  return v_company;
end
$$;

-- Recipients snapshot (reference _scfContactsSnapshot).
create function app.scf_contacts(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'contact_id', c.id, 'name', c.name,
           'email', coalesce(nullif(btrim(c.email), ''), 'NOT_CONFIGURED'),
           'channel', coalesce(nullif(btrim(c.preferred_channel), ''), 'NOT_CONFIGURED'))
         order by c.created_at, c.id), '[]'::jsonb)
  from public.contacts c
  where c.company_id = p_company_id and c.active
$$;

-- -----------------------------------------------------------------------------
-- Booking helpers
-- -----------------------------------------------------------------------------

-- The booking named by payload.booking_id, locked, belonging to request.job_id.
create function app.scf_booking(p_request jsonb, p_payload jsonb)
returns public.scaffold_bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.scf_uuid(app.txt(p_payload, 'booking_id'));
  v_booking public.scaffold_bookings;
begin
  if v_id is not null then
    select * into v_booking from public.scaffold_bookings where id = v_id for update;
  end if;
  if v_booking.id is null then
    perform app.fail('SCF_REVIEW: scaffold booking not found');
  end if;
  if v_booking.job_id is distinct from app.ref(p_request, 'job_id') then
    perform app.fail('R1A_SCAFFOLD_BOOKING_JOB_MISMATCH');
  end if;
  return v_booking;
end
$$;

create function app.scf_expect_version(p_booking public.scaffold_bookings, p_request jsonb)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_booking.version <> app.expected_version(p_request) then
    perform app.fail('SCF_STALE: version');
  end if;
end
$$;

-- Instruction body snapshot (reference _scfInstructionBody).
create function app.scf_body(p_booking public.scaffold_bookings, p_company public.companies, p_job public.jobs)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'scaffold_booking_id', p_booking.id, 'job_id', p_job.id, 'job_reference', p_job.job_ref,
    'customer_display', p_job.display_name, 'company', p_company.name, 'revision', p_booking.revision,
    'erect_planned_at', p_booking.erect_planned_at, 'strip_forecast_at', p_booking.strip_forecast_at,
    'strip_planned_at', p_booking.strip_planned_at, 'access_notes', p_booking.access_notes,
    'scope_file_id', p_booking.scope_file_id, 'note', 'CAPTURED DRAFT — not sent. FN-04 R2.')
$$;

-- The captured communication of a type for a booking revision, if any.
create function app.scf_find_communication(p_booking_id uuid, p_type text, p_revision int)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select c.id from public.communications c
  join public.communication_jobs cj on cj.communication_id = c.id
  where cj.scaffold_booking_id = p_booking_id and c.type = p_type and c.revision = p_revision
  order by c.created_at, c.id limit 1
$$;

-- Captured scaffolder communication (Draft, never sent), one per booking +
-- type + revision (reference COMM-SCF-{booking}-{type}-R{rev}).
create function app.scf_communication(p_booking public.scaffold_bookings, p_company public.companies,
                                      p_type text, p_subject text, p_body jsonb, p_revision int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := app.scf_find_communication(p_booking.id, p_type, p_revision);
begin
  if v_id is not null then
    return jsonb_build_object('created', false, 'communication_id', v_id);
  end if;
  insert into public.communications (job_id, company_id, type, subject, body_snapshot, attachment_ids,
                                     recipients_snapshot, revision, status)
  values (p_booking.job_id, p_company.id, p_type, p_subject, p_body::text,
          case when p_booking.scope_file_id is not null then array[p_booking.scope_file_id] end,
          app.scf_contacts(p_company.id)::text, p_revision, 'Draft')
  returning id into v_id;
  insert into public.communication_jobs (communication_id, job_id, scaffold_booking_id, entity_revision)
  values (v_id, p_booking.job_id, p_booking.id, p_revision);
  return jsonb_build_object('created', true, 'communication_id', v_id);
end
$$;

-- Scaffolder acknowledgement of the booking's current revision (reference
-- ACK-SCF-{booking}-R{rev}: one per revision).
create function app.scf_acknowledge(p_booking public.scaffold_bookings, p_company public.companies,
                                    p_communication_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_received timestamptz := now();
  v_evidence uuid;
begin
  select a.id into v_id from public.acknowledgements a
  where a.entity_id = p_booking.id and a.acknowledged_revision = p_booking.revision
  order by a.created_at, a.id limit 1;
  if v_id is not null then
    return jsonb_build_object('created', false, 'acknowledgement_id', v_id);
  end if;
  if app.txt(p_payload, 'received_at') is not null then
    begin
      v_received := app.txt(p_payload, 'received_at')::timestamptz;
    exception when others then
      perform app.fail('SCF_DATE_INVALID');
    end;
  end if;
  if app.txt(p_payload, 'evidence_id') is not null then
    v_evidence := app.job_evidence(p_booking.job_id, app.txt(p_payload, 'evidence_id'), 'SCF_REVIEW: evidence not found');
  end if;
  insert into public.acknowledgements (communication_id, company_id, entity_id, acknowledged_revision, response,
                                       response_text, received_at, recorded_by, evidence_id)
  values (p_communication_id, p_company.id, p_booking.id, p_booking.revision, 'Confirmed',
          app.txt(p_payload, 'response_text'), v_received, app.context_actor_id(), v_evidence)
  returning id into v_id;
  return jsonb_build_object('created', true, 'acknowledgement_id', v_id);
end
$$;

-- -----------------------------------------------------------------------------
-- Task helpers (SCA01-SCA05)
-- -----------------------------------------------------------------------------

-- One task per instance key (reference _scfTask); owner from the template's
-- assignment rule; title = template title [— suffix].
create function app.scf_task(p_code text, p_job_id uuid, p_related_type text, p_related_id uuid,
                             p_instance_key text, p_due_at timestamptz, p_suffix text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_id uuid;
begin
  select t.id into v_id from public.tasks t where t.instance_key = p_instance_key;
  if v_id is not null then
    return jsonb_build_object('created', false, 'task_id', v_id, 'code', p_code);
  end if;
  select tt.title into v_title from public.task_templates tt where tt.code = p_code and tt.active;
  if v_title is null then
    perform app.fail('SCF_CONFIG: TaskTemplate ' || p_code || ' missing/inactive');
  end if;
  v_id := app.create_task_instance(p_job_id, p_code, p_instance_key, null, null, p_due_at, 1,
                                   v_title || coalesce(' — ' || p_suffix, ''), null,
                                   p_related_type, p_related_id, 'Open', null, false, 'SCF-1.0');
  return jsonb_build_object('created', true, 'task_id', v_id, 'code', p_code);
end
$$;

-- Complete the open booking tasks of the given codes (reference _scfCompleteTasks).
create function app.scf_complete_tasks(p_booking_id uuid, p_codes text[], p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_after public.tasks;
  v_done jsonb := '[]'::jsonb;
begin
  for v_task in
    select * from public.tasks t
    where t.related_entity_type = 'ScaffoldBookings' and t.related_entity_id = p_booking_id
      and t.template_code = any (p_codes) and t.status not in ('Complete', 'Cancelled', 'NotRequired')
    order by t.created_at, t.id for update
  loop
    update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.context_actor_id(),
                            completion_note = p_note
    where id = v_task.id returning * into v_after;
    perform app.task_event(v_task, v_after, 'Complete', p_note);
    v_done := v_done || to_jsonb(v_task.id);
  end loop;
  return v_done;
end
$$;

-- Cancel every open booking task (reference _scfCancelTasks).
create function app.scf_cancel_tasks(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_after public.tasks;
  v_done jsonb := '[]'::jsonb;
begin
  for v_task in
    select * from public.tasks t
    where t.related_entity_type = 'ScaffoldBookings' and t.related_entity_id = p_booking_id
      and t.status not in ('Complete', 'Cancelled', 'NotRequired')
    order by t.created_at, t.id for update
  loop
    update public.tasks set status = 'Cancelled', completion_note = p_reason
    where id = v_task.id returning * into v_after;
    perform app.task_event(v_task, v_after, 'Cancel', p_reason);
    v_done := v_done || to_jsonb(v_task.id);
  end loop;
  return v_done;
end
$$;

-- Strip authorisation blockers (reference _scfStripBlockers).
create function app.scf_strip_blockers(p_job public.jobs, p_booking public.scaffold_bookings)
returns text[]
language sql stable security definer
set search_path = ''
as $$
  select array_remove(array[
    case when p_job.customer_happy_at is null then 'CUSTOMER_NOT_HAPPY' end,
    case when p_booking.status <> 'Erected' then 'NOT_ERECTED' end,
    (select 'STRIP_BLOCKING_ISSUES:' || string_agg(i.id::text, ',' order by i.created_at, i.id)
     from public.issues i
     where i.job_id = p_job.id and i.blocks_strip and i.status not in ('Resolved', 'Closed')
     having count(*) > 0)], null)
$$;

-- Install date for the s09 erect-date rule: earliest live work package start,
-- else the job's next action date.
create function app.scf_install_date(p_job public.jobs)
returns date
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select min(w.planned_start) from public.work_packages w
     where w.job_id = p_job.id and w.status <> 'Cancelled' and w.planned_start is not null),
    app.london_date(p_job.next_action_at))
$$;

-- The scaffolder when exactly one active Scaffolder company exists, else null.
create function app.scf_single_scaffolder()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select case when count(*) = 1 then min(c.id::text)::uuid end
  from public.companies c where c.type = 'Scaffolder' and c.active
$$;

-- s09 evaluateScaffoldRequirement.
create function app.scf_requirement(p_job public.jobs)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_active public.scaffold_bookings;
  v_company uuid;
  v_lead int;
  v_install date;
begin
  if not p_job.scaffold_required then
    return jsonb_build_object('job_id', p_job.id, 'required', false, 'ready', false, 'summary', 'NotRequired');
  end if;
  select * into v_active from public.scaffold_bookings b
  where b.job_id = p_job.id and b.status <> 'Cancelled' order by b.created_at, b.id limit 1;
  if v_active.id is not null and v_active.status not in ('Draft', 'Planned') then
    return jsonb_build_object('job_id', p_job.id, 'required', true, 'ready', false,
                              'existing_booking_id', v_active.id, 'status', v_active.status, 'summary', 'AlreadyBooked');
  end if;
  v_company := coalesce(v_active.company_id, app.scf_single_scaffolder());
  select c.standard_lead_days into v_lead from public.companies c
  where c.id = v_company and c.type = 'Scaffolder' and c.active;
  v_install := app.scf_install_date(p_job);
  return jsonb_build_object('job_id', p_job.id, 'required', true, 'ready', true, 'summary', 'Ready',
    'existing_booking_id', v_active.id, 'status', v_active.status,
    'company_id', v_company, 'install_date', v_install,
    'proposed_erect_date', coalesce(v_active.erect_planned_at, app.scf_erect_date(v_install, v_lead)),
    'erect_date_source', case when v_active.erect_planned_at is not null then 'booking_intake'
                              when v_install is not null then 'lead_days' end);
end
$$;

-- =============================================================================
-- Commands
-- =============================================================================

-- ---- SCAFFOLDER_CONFIGURE ---------------------------------------------------
-- Real scaffolder entry with values supplied by the business (reference
-- _scfConfigureScaffolder). Nothing is invented.
create function app.cmd_scaffolder_configure(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_contact jsonb;
  v_name text;
  v_lead int;
  v_company public.companies;
  v_before public.companies;
  v_row public.contacts;
  v_row_before public.contacts;
  v_cid uuid;
  v_cname text;
begin
  perform app.scf_envelope(p_request, false);
  v_p := app.payload(p_request, array['company_id', 'name', 'standard_lead_days', 'notes', 'contact'], array['name']);
  v_name := app.txt(v_p, 'name');
  if v_p ? 'standard_lead_days' and jsonb_typeof(v_p -> 'standard_lead_days') <> 'null' then
    if btrim(v_p ->> 'standard_lead_days') !~ '^[0-9]{1,2}$' or (v_p ->> 'standard_lead_days')::int > 60 then
      perform app.fail('SCF_REVIEW: standard_lead_days 0-60');
    end if;
    v_lead := (v_p ->> 'standard_lead_days')::int;
  end if;
  v_contact := v_p -> 'contact';
  if v_contact is not null and jsonb_typeof(v_contact) not in ('object', 'null') then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  if jsonb_typeof(v_contact) = 'object' and exists (select 1 from jsonb_object_keys(v_contact) k
       where k not in ('contact_id', 'name', 'email', 'phone', 'contact_role', 'preferred_channel')) then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;

  if app.txt(v_p, 'company_id') is not null then
    select * into v_before from public.companies where id = app.scf_uuid(app.txt(v_p, 'company_id')) for update;
    if v_before.id is null then
      perform app.fail('SCF_REVIEW: company not found');
    end if;
    if v_before.type <> 'Scaffolder' then
      perform app.fail('SCF_REFUSED: company exists with another type');
    end if;
    update public.companies set name = v_name, active = true, standard_lead_days = v_lead,
                                notes = app.txt(v_p, 'notes')
    where id = v_before.id returning * into v_company;
    perform app.audit('Companies', v_company.id::text, 'ConfigureScaffolder', to_jsonb(v_before), to_jsonb(v_company), null);
  else
    insert into public.companies (name, type, active, standard_lead_days, notes)
    values (v_name, 'Scaffolder', true, v_lead, app.txt(v_p, 'notes'))
    returning * into v_company;
    perform app.audit('Companies', v_company.id::text, 'ConfigureScaffolder', null, to_jsonb(v_company), null);
  end if;

  if jsonb_typeof(v_contact) = 'object' and app.txt(v_contact, 'name') is not null then
    v_cname := app.txt(v_contact, 'name');
    v_cid := app.scf_uuid(app.txt(v_contact, 'contact_id'));
    if app.txt(v_contact, 'contact_id') is not null then
      select * into v_row_before from public.contacts where id = v_cid for update;
      if v_row_before.id is null then
        perform app.fail('SCF_REVIEW: contact not found');
      end if;
    else
      -- Natural key (reference CONT-{company}-{slug(name)}): same company, same name.
      select * into v_row_before from public.contacts c
      where c.company_id = v_company.id and lower(btrim(c.name)) = lower(v_cname)
      order by c.created_at, c.id limit 1 for update;
    end if;
    if v_row_before.id is not null then
      if v_row_before.company_id <> v_company.id then
        perform app.fail('SCF_REFUSED: contact belongs to another company');
      end if;
      update public.contacts set name = v_cname, email = lower(app.txt(v_contact, 'email')),
                                 phone = app.txt(v_contact, 'phone'),
                                 contact_role = coalesce(app.txt(v_contact, 'contact_role'), 'Scaffolding'),
                                 active = true, preferred_channel = app.txt(v_contact, 'preferred_channel')
      where id = v_row_before.id returning * into v_row;
      perform app.audit('Contacts', v_row.id::text, 'ConfigureScaffolderContact', to_jsonb(v_row_before), to_jsonb(v_row), null);
    else
      insert into public.contacts (company_id, name, email, phone, contact_role, active, preferred_channel)
      values (v_company.id, v_cname, lower(app.txt(v_contact, 'email')), app.txt(v_contact, 'phone'),
              coalesce(app.txt(v_contact, 'contact_role'), 'Scaffolding'), true, app.txt(v_contact, 'preferred_channel'))
      returning * into v_row;
      perform app.audit('Contacts', v_row.id::text, 'ConfigureScaffolderContact', null, to_jsonb(v_row), null);
    end if;
  end if;

  return jsonb_build_object('status', case when v_before.id is null then 'Created' else 'Updated' end,
                            'company_id', v_company.id, 'company', to_jsonb(v_company),
                            'contact', case when v_row.id is not null then to_jsonb(v_row) end, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_REQUEST -------------------------------------------------------
-- Request erect from the scaffolder: adopts the booking-intake Draft/Planned
-- row when there is one (never a parallel booking), otherwise creates the
-- job's booking. expected_version is the job's.
create function app.cmd_scaffold_request(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_job public.jobs;
  v_before public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_company public.companies;
  v_company_id uuid;
  v_erect date;
  v_source text;
  v_forecast date;
  v_cost bigint;
  v_task jsonb;
  v_comm jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request,
    array['company_id', 'erect_planned_at', 'strip_forecast_at', 'access_notes', 'scope_file_id', 'quoted_cost_pence']);
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  perform app.assert_normal_work(v_job.id);
  if not v_job.scaffold_required then
    perform app.fail('SCF_REVIEW: job does not require scaffold');
  end if;
  v_erect := app.scf_date(v_p, 'erect_planned_at');
  v_forecast := app.scf_date(v_p, 'strip_forecast_at');
  v_cost := app.scf_pence(v_p, 'quoted_cost_pence');

  select * into v_before from public.scaffold_bookings b
  where b.job_id = v_job.id and b.status <> 'Cancelled' order by b.created_at, b.id limit 1 for update;
  if v_before.id is not null and v_before.status not in ('Draft', 'Planned') then
    perform app.fail('SCF_REVIEW: job already has an active scaffold booking',
                     jsonb_build_object('scaffold_booking_id', v_before.id, 'status', v_before.status));
  end if;
  if v_job.version <> app.expected_version(p_request) then
    perform app.fail('SCF_STALE: version');
  end if;

  -- Scaffolder: named in the request, else the one on the intake booking,
  -- else the single active Scaffolder company (never a hard-wired id).
  if app.txt(v_p, 'company_id') is not null then
    v_company_id := app.scf_uuid(app.txt(v_p, 'company_id'));
    if v_company_id is null then
      perform app.fail('SCF_REVIEW: active Scaffolder company required');
    end if;
  else
    v_company_id := coalesce(v_before.company_id, app.scf_single_scaffolder());
    if v_company_id is null then
      perform app.fail('SCF_REVIEW: scaffolder company_id required');
    end if;
  end if;
  v_company := app.scf_scaffolder(v_company_id);

  if v_erect is not null then
    v_source := 'payload';
  elsif v_before.erect_planned_at is not null then
    v_erect := v_before.erect_planned_at;
    v_source := 'booking_intake';
  else
    v_erect := app.scf_erect_date(app.scf_install_date(v_job), v_company.standard_lead_days);
    v_source := 'lead_days';
  end if;
  if v_erect is null then
    perform app.fail('SCF_REVIEW: erect_planned_at required');
  end if;
  v_forecast := coalesce(v_forecast, v_before.strip_forecast_at);
  if v_forecast is not null and v_forecast < v_erect then
    perform app.fail('SCF_REVIEW: strip forecast before erect');
  end if;

  if v_before.id is not null then
    update public.scaffold_bookings set
      company_id = v_company.id, erect_planned_at = v_erect, strip_forecast_at = v_forecast,
      access_notes = coalesce(app.txt(v_p, 'access_notes'), access_notes),
      scope_file_id = coalesce(app.txt(v_p, 'scope_file_id'), scope_file_id),
      quoted_cost_pence = coalesce(v_cost, quoted_cost_pence), status = 'Requested'
    where id = v_before.id returning * into v_after;
  else
    insert into public.scaffold_bookings (job_id, company_id, erect_planned_at, strip_forecast_at, status, revision,
                                          access_notes, scope_file_id, quoted_cost_pence)
    values (v_job.id, v_company.id, v_erect, v_forecast, 'Requested', 1,
            app.txt(v_p, 'access_notes'), app.txt(v_p, 'scope_file_id'), v_cost)
    returning * into v_after;
  end if;

  v_task := app.scf_task('SCA01', v_job.id, 'ScaffoldBookings', v_after.id,
                         'SCA01-' || v_after.id || '-R' || v_after.revision,
                         app.scf_day_start(app.scf_prev_staffed(v_erect - coalesce(v_company.standard_lead_days, 0))),
                         v_company.name || ' erect ' || v_erect);
  v_comm := app.scf_communication(v_after, v_company, 'ScaffoldInstruction',
                                  'Scaffold erect instruction — ' || v_job.display_name || ' (rev ' || v_after.revision || ')',
                                  app.scf_body(v_after, v_company, v_job), v_after.revision);
  perform app.audit('ScaffoldBookings', v_after.id::text, 'Request',
                    case when v_before.id is not null then to_jsonb(v_before) end, to_jsonb(v_after), null);
  return jsonb_build_object('status', 'Requested', 'booking', to_jsonb(v_after),
                            'adopted_intake_booking', v_before.id is not null, 'erect_date_source', v_source,
                            'task', v_task, 'communication', v_comm, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_CONFIRM_ERECT -------------------------------------------------
create function app.cmd_scaffold_confirm_erect(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_job public.jobs;
  v_company public.companies;
  v_comm uuid;
  v_ack jsonb;
  v_done jsonb;
  v_task jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'response_text', 'received_at', 'evidence_id'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  select * into v_job from public.jobs where id = v_b.job_id;
  perform app.assert_normal_work(v_job.id);
  v_company := app.scf_scaffolder(v_b.company_id);
  if v_b.status not in ('Requested', 'Confirmed') then
    perform app.fail('SCF_REVIEW: cannot confirm erect from ' || v_b.status);
  end if;
  perform app.scf_expect_version(v_b, p_request);

  update public.scaffold_bookings set erect_confirmed_at = now(), confirmed_revision = revision, status = 'Confirmed'
  where id = v_b.id returning * into v_after;
  v_comm := (app.scf_communication(v_b, v_company, 'ScaffoldInstruction',
                                   'Scaffold erect instruction — ' || v_job.display_name || ' (rev ' || v_b.revision || ')',
                                   app.scf_body(v_b, v_company, v_job), v_b.revision) ->> 'communication_id')::uuid;
  v_ack := app.scf_acknowledge(v_b, v_company, v_comm, v_p);
  v_done := app.scf_complete_tasks(v_b.id, array['SCA01'], 'Scaffolder confirmed revision ' || v_b.revision);
  v_task := app.scf_task('SCA02', v_b.job_id, 'ScaffoldBookings', v_b.id, 'SCA02-' || v_b.id || '-R' || v_b.revision,
                         app.scf_day_end(v_b.erect_planned_at), 'expected ' || v_b.erect_planned_at);
  perform app.audit('ScaffoldBookings', v_b.id::text, 'ConfirmErect', to_jsonb(v_b), to_jsonb(v_after), null);
  return jsonb_build_object('status', v_after.status, 'booking', to_jsonb(v_after), 'acknowledgement', v_ack,
                            'completed_tasks', v_done, 'task', v_task, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_RECORD_ERECTED ------------------------------------------------
create function app.cmd_scaffold_record_erected(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_actual date;
  v_done jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'erect_actual_at'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  perform app.assert_normal_work(v_b.job_id);
  v_actual := app.scf_date(v_p, 'erect_actual_at');
  if v_actual is null then
    perform app.fail('SCF_REVIEW: erect_actual_at required');
  end if;
  if v_b.status not in ('Requested', 'Confirmed') then
    perform app.fail('SCF_REVIEW: cannot record erected from ' || v_b.status);
  end if;
  perform app.scf_expect_version(v_b, p_request);
  if v_actual > app.london_date(now()) then
    perform app.fail('SCF_REVIEW: erect_actual_at cannot be in the future');
  end if;
  update public.scaffold_bookings set erect_actual_at = v_actual, status = 'Erected'
  where id = v_b.id returning * into v_after;
  v_done := app.scf_complete_tasks(v_b.id, array['SCA01', 'SCA02'], 'Erected ' || v_actual
              || case when v_actual is distinct from v_b.erect_planned_at then ' (planned ' || coalesce(v_b.erect_planned_at::text, 'none') || ')' else '' end);
  perform app.audit('ScaffoldBookings', v_b.id::text, 'RecordErected', to_jsonb(v_b), to_jsonb(v_after), null);
  return jsonb_build_object('status', v_after.status, 'booking', to_jsonb(v_after), 'completed_tasks', v_done,
                            'late', coalesce(v_actual > v_b.erect_planned_at, false), 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_AUTHORISE_STRIP -----------------------------------------------
create function app.cmd_scaffold_authorise_strip(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_job public.jobs;
  v_blockers text[];
  v_task jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  select * into v_job from public.jobs where id = v_b.job_id;
  perform app.assert_normal_work(v_job.id);
  perform app.scf_expect_version(v_b, p_request);
  v_blockers := app.scf_strip_blockers(v_job, v_b);
  if cardinality(v_blockers) > 0 then
    -- Deviation (REF-04 §7): refuse (nothing written, retryable) instead of committing a Blocked result.
    perform app.fail('SCF_STRIP_BLOCKED', jsonb_build_object('status', 'Blocked', 'blockers', to_jsonb(v_blockers),
                                                             'scaffold_booking_id', v_b.id));
  end if;
  update public.scaffold_bookings set strip_authorised_at = now(), strip_authorised_by = app.actor_id(p_actor),
                                      status = 'StripAuthorised'
  where id = v_b.id returning * into v_after;
  v_task := app.scf_task('SCA03', v_b.job_id, 'ScaffoldBookings', v_b.id, 'SCA03-' || v_b.id || '-R' || v_b.revision,
                         app.scf_day_start(app.next_staffed_date(now())), null);
  perform app.audit('ScaffoldBookings', v_b.id::text, 'AuthoriseStrip', to_jsonb(v_b), to_jsonb(v_after), null);
  return jsonb_build_object('status', v_after.status, 'booking', to_jsonb(v_after), 'task', v_task, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_PLAN_STRIP ----------------------------------------------------
create function app.cmd_scaffold_plan_strip(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_job public.jobs;
  v_company public.companies;
  v_strip date;
  v_comm jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'strip_planned_at'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  select * into v_job from public.jobs where id = v_b.job_id;
  perform app.assert_normal_work(v_job.id);
  v_company := app.scf_scaffolder(v_b.company_id);
  v_strip := app.scf_date(v_p, 'strip_planned_at');
  if v_strip is null then
    perform app.fail('SCF_REVIEW: strip_planned_at required');
  end if;
  if v_b.status not in ('StripAuthorised', 'StripPlanned', 'StripConfirmed') then
    perform app.fail('SCF_REVIEW: strip must be authorised before planning (status ' || v_b.status || ')');
  end if;
  if v_b.erect_actual_at is not null and v_strip < v_b.erect_actual_at then
    perform app.fail('SCF_REVIEW: strip before erect');
  end if;
  perform app.scf_expect_version(v_b, p_request);
  update public.scaffold_bookings set strip_planned_at = v_strip, revision = revision + 1, status = 'StripPlanned'
  where id = v_b.id returning * into v_after;
  v_comm := app.scf_communication(v_after, v_company, 'ScaffoldStripInstruction',
                                  'Scaffold strip instruction — ' || v_job.display_name || ' (rev ' || v_after.revision || ')',
                                  app.scf_body(v_after, v_company, v_job), v_after.revision);
  perform app.audit('ScaffoldBookings', v_b.id::text, 'PlanStrip', to_jsonb(v_b), to_jsonb(v_after), null);
  return jsonb_build_object('status', v_after.status, 'booking', to_jsonb(v_after), 'communication', v_comm,
                            'acknowledgement_required', true, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_CONFIRM_STRIP -------------------------------------------------
create function app.cmd_scaffold_confirm_strip(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_job public.jobs;
  v_company public.companies;
  v_comm uuid;
  v_ack jsonb;
  v_done jsonb;
  v_task jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'response_text', 'received_at', 'evidence_id'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  select * into v_job from public.jobs where id = v_b.job_id;
  perform app.assert_normal_work(v_job.id);
  v_company := app.scf_scaffolder(v_b.company_id);
  if v_b.status not in ('StripPlanned', 'StripConfirmed') or v_b.strip_planned_at is null then
    perform app.fail('SCF_REVIEW: strip must be planned before confirmation');
  end if;
  perform app.scf_expect_version(v_b, p_request);
  update public.scaffold_bookings set strip_confirmed_at = now(), confirmed_revision = revision, status = 'StripConfirmed'
  where id = v_b.id returning * into v_after;
  v_comm := (app.scf_communication(v_b, v_company, 'ScaffoldStripInstruction',
                                   'Scaffold strip instruction — ' || v_job.display_name || ' (rev ' || v_b.revision || ')',
                                   app.scf_body(v_b, v_company, v_job), v_b.revision) ->> 'communication_id')::uuid;
  v_ack := app.scf_acknowledge(v_b, v_company, v_comm, v_p);
  v_done := app.scf_complete_tasks(v_b.id, array['SCA03'],
              'Strip booked ' || v_b.strip_planned_at || ', confirmed revision ' || v_b.revision);
  v_task := app.scf_task('SCA04', v_b.job_id, 'ScaffoldBookings', v_b.id, 'SCA04-' || v_b.id || '-R' || v_b.revision,
                         app.scf_day_end(v_b.strip_planned_at), 'expected ' || v_b.strip_planned_at);
  perform app.audit('ScaffoldBookings', v_b.id::text, 'ConfirmStrip', to_jsonb(v_b), to_jsonb(v_after), null);
  return jsonb_build_object('status', v_after.status, 'booking', to_jsonb(v_after), 'acknowledgement', v_ack,
                            'completed_tasks', v_done, 'task', v_task, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_RECORD_STRIPPED -----------------------------------------------
-- Actual removal. Complaints stay open (an actual strip never closes one).
create function app.cmd_scaffold_record_stripped(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_actual date;
  v_cost bigint;
  v_evidence uuid;
  v_done jsonb;
  v_open jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'strip_actual_at', 'actual_cost_pence', 'invoice_reference', 'evidence_id'],
                     array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  perform app.assert_normal_work(v_b.job_id);
  v_actual := app.scf_date(v_p, 'strip_actual_at');
  if v_actual is null then
    perform app.fail('SCF_REVIEW: strip_actual_at required');
  end if;
  if v_b.status not in ('StripAuthorised', 'StripPlanned', 'StripConfirmed') then
    perform app.fail('SCF_REVIEW: strip must be authorised before recording removal (status ' || v_b.status || ')');
  end if;
  if v_b.erect_actual_at is null then
    perform app.fail('SCF_REVIEW: erect_actual_at missing');
  end if;
  if v_actual < v_b.erect_actual_at then
    perform app.fail('SCF_REVIEW: strip before erect');
  end if;
  perform app.scf_expect_version(v_b, p_request);
  if v_actual > app.london_date(now()) then
    perform app.fail('SCF_REVIEW: strip_actual_at cannot be in the future');
  end if;
  v_cost := app.scf_pence(v_p, 'actual_cost_pence');
  if app.txt(v_p, 'evidence_id') is not null then
    v_evidence := app.job_evidence(v_b.job_id, app.txt(v_p, 'evidence_id'), 'SCF_REVIEW: evidence not found');
  end if;
  update public.scaffold_bookings set strip_actual_at = v_actual, status = 'Stripped',
                                      actual_cost_pence = coalesce(v_cost, actual_cost_pence),
                                      invoice_reference = coalesce(app.txt(v_p, 'invoice_reference'), invoice_reference)
  where id = v_b.id returning * into v_after;
  v_done := app.scf_complete_tasks(v_b.id, array['SCA03', 'SCA04'],
              'Stripped ' || v_actual || coalesce(' evidence ' || v_evidence, ''));
  select coalesce(jsonb_agg(i.id order by i.created_at, i.id), '[]'::jsonb) into v_open
  from public.issues i
  where i.job_id = v_b.job_id and i.responsible_company_id = v_b.company_id and i.status not in ('Resolved', 'Closed');
  perform app.audit('ScaffoldBookings', v_b.id::text, 'RecordStripped', to_jsonb(v_b), to_jsonb(v_after), null);
  return jsonb_build_object('status', v_after.status, 'booking', to_jsonb(v_after), 'completed_tasks', v_done,
                            'open_complaints', v_open, 'late', coalesce(v_actual > v_b.strip_planned_at, false),
                            'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_CHANGE_DATES --------------------------------------------------
-- A move is a new revision that needs re-acknowledgement.
create function app.cmd_scaffold_change_dates(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_job public.jobs;
  v_company public.companies;
  v_reason text;
  v_erect date;
  v_strip date;
  v_rev int;
  v_tasks jsonb := '[]'::jsonb;
  v_comms jsonb := '[]'::jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'erect_planned_at', 'strip_planned_at', 'reason'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  select * into v_job from public.jobs where id = v_b.job_id;
  perform app.assert_normal_work(v_job.id);
  v_company := app.scf_scaffolder(v_b.company_id);
  v_reason := app.txt(v_p, 'reason');
  if v_reason is null then
    perform app.fail('SCF_REVIEW: reason required');
  end if;
  v_erect := app.scf_date(v_p, 'erect_planned_at');
  v_strip := app.scf_date(v_p, 'strip_planned_at');
  if v_erect is null and v_strip is null then
    perform app.fail('SCF_REVIEW: erect_planned_at or strip_planned_at required');
  end if;
  if v_b.status in ('Cancelled', 'Stripped') then
    perform app.fail('SCF_REVIEW: cannot move a ' || v_b.status || ' booking');
  end if;
  -- Port: an intake Draft/Planned booking is not yet with the scaffolder; SCAFFOLD_REQUEST sets its dates.
  if v_b.status in ('Draft', 'Planned') then
    perform app.fail('SCF_REVIEW: booking not yet requested');
  end if;
  if v_erect is not null and v_b.erect_actual_at is not null then
    perform app.fail('SCF_REVIEW: scaffold already erected; erect date cannot move');
  end if;
  if v_strip is not null and v_b.status not in ('StripAuthorised', 'StripPlanned', 'StripConfirmed') then
    perform app.fail('SCF_REVIEW: strip not yet authorised');
  end if;
  perform app.scf_expect_version(v_b, p_request);
  v_rev := v_b.revision + 1;
  update public.scaffold_bookings set
    revision = v_rev,
    erect_planned_at = coalesce(v_erect, erect_planned_at),
    strip_planned_at = coalesce(v_strip, strip_planned_at),
    status = case when v_erect is not null and status = 'Confirmed' then 'Requested'
                  when v_strip is not null and status = 'StripConfirmed' then 'StripPlanned'
                  else status end
  where id = v_b.id returning * into v_after;
  if v_erect is not null then
    v_tasks := v_tasks || app.scf_task('SCA01', v_b.job_id, 'ScaffoldBookings', v_b.id, 'SCA01-' || v_b.id || '-R' || v_rev,
      app.scf_day_start(app.scf_prev_staffed(v_erect - coalesce(v_company.standard_lead_days, 0))),
      'revised erect ' || v_erect || ' (rev ' || v_rev || ')');
    v_comms := v_comms || app.scf_communication(v_after, v_company, 'ScaffoldInstruction',
      'Scaffold erect instruction — ' || v_job.display_name || ' (rev ' || v_rev || ')',
      app.scf_body(v_after, v_company, v_job), v_rev);
  end if;
  if v_strip is not null then
    v_tasks := v_tasks || app.scf_task('SCA03', v_b.job_id, 'ScaffoldBookings', v_b.id, 'SCA03-' || v_b.id || '-R' || v_rev,
      app.scf_day_start(app.next_staffed_date(now())), 'revised strip ' || v_strip || ' (rev ' || v_rev || ')');
    v_comms := v_comms || app.scf_communication(v_after, v_company, 'ScaffoldStripInstruction',
      'Scaffold strip instruction — ' || v_job.display_name || ' (rev ' || v_rev || ')',
      app.scf_body(v_after, v_company, v_job), v_rev);
  end if;
  perform app.audit('ScaffoldBookings', v_b.id::text, 'ChangeDates', to_jsonb(v_b), to_jsonb(v_after), v_reason);
  return jsonb_build_object('status', v_after.status, 'booking', to_jsonb(v_after), 'revision', v_rev,
                            'acknowledgement_required', true, 'tasks', v_tasks, 'communications', v_comms,
                            'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_CANCEL --------------------------------------------------------
-- Before erection only: erected scaffold must be stripped safely instead.
create function app.cmd_scaffold_cancel(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_job public.jobs;
  v_company public.companies;
  v_reason text;
  v_cancelled jsonb;
  v_comm jsonb;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'reason'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  select * into v_job from public.jobs where id = v_b.job_id;
  select * into v_company from public.companies where id = v_b.company_id;
  v_reason := app.txt(v_p, 'reason');
  if v_reason is null then
    perform app.fail('SCF_REVIEW: reason required');
  end if;
  if v_b.status = 'Cancelled' then
    perform app.fail('SCF_REVIEW: already cancelled');
  end if;
  if v_b.erect_actual_at is not null and v_b.strip_actual_at is null then
    perform app.fail('SCF_REFUSED: scaffold is erected; arrange safe strip and confirm removal instead of cancelling');
  end if;
  perform app.scf_expect_version(v_b, p_request);
  update public.scaffold_bookings set status = 'Cancelled', revision = revision + 1
  where id = v_b.id returning * into v_after;
  v_cancelled := app.scf_cancel_tasks(v_b.id, v_reason);
  if v_company.id is not null then
    v_comm := app.scf_communication(v_after, v_company, 'ScaffoldCancellation',
      'Scaffold booking cancelled — ' || v_job.display_name || ' (rev ' || v_after.revision || ')',
      app.scf_body(v_after, v_company, v_job) || jsonb_build_object('reason', v_reason), v_after.revision);
  end if;
  perform app.audit('ScaffoldBookings', v_b.id::text, 'Cancel', to_jsonb(v_b), to_jsonb(v_after), v_reason);
  return jsonb_build_object('status', 'Cancelled', 'booking', to_jsonb(v_after), 'cancelled_tasks', v_cancelled,
                            'communication', v_comm, 'acknowledgement_required', v_comm is not null, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_COMPLAINT -----------------------------------------------------
-- Issues row (type Complaint, responsible company = scaffolder); never closed by a strip.
create function app.cmd_scaffold_complaint(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_b public.scaffold_bookings;
  v_after public.scaffold_bookings;
  v_category text;
  v_severity text;
  v_blocks boolean;
  v_issue public.issues;
begin
  perform app.scf_envelope(p_request, true);
  v_p := app.payload(p_request, array['booking_id', 'category', 'description', 'severity', 'blocks_strip',
                                      'blocks_completion', 'evidence_folder_id'], array['booking_id']);
  v_b := app.scf_booking(p_request, v_p);
  perform app.assert_normal_work(v_b.job_id);
  v_category := app.txt(v_p, 'category');
  if v_category is null or v_category not in ('MissedAppointment', 'Access', 'Damage', 'UnsafeConcern', 'Other') then
    perform app.fail('SCF_REVIEW: category must be one of MissedAppointment/Access/Damage/UnsafeConcern/Other');
  end if;
  if app.txt(v_p, 'description') is null then
    perform app.fail('SCF_REVIEW: description required');
  end if;
  v_severity := coalesce(app.txt(v_p, 'severity'), case when v_category = 'UnsafeConcern' then 'High' else 'Normal' end);
  v_blocks := case when v_p ? 'blocks_strip' and jsonb_typeof(v_p -> 'blocks_strip') <> 'null'
                   then app.yes_flag(v_p -> 'blocks_strip') else v_category = 'UnsafeConcern' end;
  insert into public.issues (job_id, type, category, description, raised_at, raised_by, responsible_company_id,
                             office_owner_id, severity, status, due_at, blocks_completion, blocks_strip,
                             approval_status, evidence_folder_id)
  values (v_b.job_id, 'Complaint', v_category, app.txt(v_p, 'description'), now(), app.actor_id(p_actor),
          v_b.company_id, app.rule_owner('ISS02'), v_severity, 'Open',
          app.scf_day_start(app.next_staffed_date(now())), app.yes_flag(v_p -> 'blocks_completion'), v_blocks,
          'NotRequired', app.txt(v_p, 'evidence_folder_id'))
  returning * into v_issue;
  insert into public.issue_events (issue_id, event_type, actor, occurred_at, note, previous_status, new_status)
  values (v_issue.id, 'Created', app.actor_id(p_actor), now(), 'Scaffold complaint: ' || v_category, null, 'Open');
  update public.scaffold_bookings set related_issue_ids = coalesce(related_issue_ids, '{}') || v_issue.id
  where id = v_b.id returning * into v_after;
  perform app.audit('Issues', v_issue.id::text, 'ScaffoldComplaint', null, to_jsonb(v_issue), null);
  return jsonb_build_object('status', 'Created', 'issue_id', v_issue.id, 'issue', to_jsonb(v_issue),
                            'booking', to_jsonb(v_after), 'blocks_strip', v_blocks, 'external_calls', 0);
end
$$;

-- ---- SCAFFOLD_CHASE ---------------------------------------------------------
-- Planned erect/strip date passed without an actual -> SCA02/SCA04 CHASE task,
-- once per booking revision. Scheduler-safe.
create function app.cmd_scaffold_chase(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.scaffold_bookings;
  v_today date := app.london_date(now());
  v_created jsonb := '[]'::jsonb;
  v_r jsonb;
  v_considered int := 0;
begin
  perform app.scf_envelope(p_request, false);
  perform app.payload(p_request, '{}'::text[]);
  for v_b in
    select b.* from public.scaffold_bookings b join public.jobs j on j.id = b.job_id
    where b.status <> 'Cancelled' and j.cancellation_at is null
    order by b.created_at, b.id
  loop
    v_considered := v_considered + 1;
    if v_b.erect_planned_at is not null and v_b.erect_actual_at is null and v_b.erect_planned_at < v_today
       and v_b.status in ('Requested', 'Confirmed') then
      v_r := app.scf_task('SCA02', v_b.job_id, 'ScaffoldBookings', v_b.id,
                          'SCA02-' || v_b.id || '-R' || v_b.revision || '-CHASE', app.scf_day_start(v_today),
                          'CHASE: erect planned ' || v_b.erect_planned_at || ' not recorded');
      if (v_r ->> 'created')::boolean then v_created := v_created || v_r; end if;
    end if;
    if v_b.strip_planned_at is not null and v_b.strip_actual_at is null and v_b.strip_planned_at < v_today
       and v_b.status in ('StripPlanned', 'StripConfirmed') then
      v_r := app.scf_task('SCA04', v_b.job_id, 'ScaffoldBookings', v_b.id,
                          'SCA04-' || v_b.id || '-R' || v_b.revision || '-CHASE', app.scf_day_start(v_today),
                          'CHASE: strip planned ' || v_b.strip_planned_at || ' not recorded');
      if (v_r ->> 'created')::boolean then v_created := v_created || v_r; end if;
    end if;
  end loop;
  return jsonb_build_object('status', 'Recorded', 'considered', v_considered, 'created', v_created, 'external_calls', 0);
end
$$;

-- Weekly-list rows in [p_from, p_to]: unerected planned erects and authorised,
-- unstripped planned strips of live bookings on jobs not being cancelled.
create function app.scf_week_items(p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_id', b.company_id, 'booking_id', b.id, 'job_id', b.job_id, 'revision', b.revision,
           'item', jsonb_build_object('kind', k.kind, 'date', k.d, 'booking_id', b.id, 'job_id', j.id,
                                      'job_reference', j.job_ref, 'customer_display', j.display_name,
                                      'revision', b.revision,
                                      'acknowledged', b.confirmed_revision is not distinct from b.revision,
                                      'access_notes', b.access_notes))
         order by k.d, b.id, k.kind), '[]'::jsonb)
  from public.scaffold_bookings b
  join public.jobs j on j.id = b.job_id
  cross join lateral (values
    ('Erect', case when b.erect_actual_at is null then b.erect_planned_at end),
    ('Strip', case when b.strip_authorised_at is not null and b.strip_actual_at is null then b.strip_planned_at end)) k(kind, d)
  where b.status <> 'Cancelled' and j.cancellation_at is null and k.d between p_from and p_to
$$;

-- ---- SCAFFOLD_WEEKLY_LIST ---------------------------------------------------
-- The Friday list: next week's erects and authorised strips per scaffolder,
-- one captured Draft per company per week, SCA05 due Friday 12:00 London.
create function app.cmd_scaffold_weekly_list(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_week date;
  v_end date;
  v_company public.companies;
  v_items jsonb;
  v_comm uuid;
  v_created boolean;
  v_task jsonb;
  v_lists jsonb := '[]'::jsonb;
  v_unassigned int;
  v_rows jsonb;
begin
  perform app.scf_envelope(p_request, false);
  v_p := app.payload(p_request, array['week_start']);
  v_week := app.scf_week_start(coalesce(app.scf_date(v_p, 'week_start'), app.london_date(now()) + 7));
  v_end := v_week + 6;
  v_rows := app.scf_week_items(v_week, v_end);

  -- A booking with no scaffolder yet (intake Draft/Planned) cannot be listed: reported, not guessed.
  select count(distinct e.value ->> 'booking_id') into v_unassigned
  from jsonb_array_elements(v_rows) e where e.value ->> 'company_id' is null;

  for v_company in
    select c.* from public.companies c
    where c.id in (select (e.value ->> 'company_id')::uuid from jsonb_array_elements(v_rows) e)
    order by c.id
  loop
    select jsonb_agg(e.value -> 'item' order by e.ordinality) into v_items
    from jsonb_array_elements(v_rows) with ordinality e
    where (e.value ->> 'company_id')::uuid = v_company.id;
    select c.id into v_comm from public.communications c
    where c.type = 'ScaffoldWeeklyList' and c.company_id = v_company.id and c.covered_week_start = v_week;
    v_created := v_comm is null;
    if v_created then
      insert into public.communications (job_id, company_id, type, subject, body_snapshot, recipients_snapshot,
                                         covered_week_start, revision, status)
      values (null, v_company.id, 'ScaffoldWeeklyList',
              'Scaffold erect/strip list w/c ' || v_week || ' — ' || v_company.name,
              jsonb_build_object('week_start', v_week, 'week_end', v_end, 'items', v_items,
                                 'note', 'CAPTURED DRAFT — not sent. FN-04 R2.')::text,
              app.scf_contacts(v_company.id)::text, v_week, 1, 'Draft')
      returning id into v_comm;
      insert into public.communication_jobs (communication_id, job_id, scaffold_booking_id, entity_revision)
      select distinct v_comm, (e.value ->> 'job_id')::uuid, (e.value ->> 'booking_id')::uuid, (e.value ->> 'revision')::int
      from jsonb_array_elements(v_rows) e where (e.value ->> 'company_id')::uuid = v_company.id;
    end if;
    v_task := app.scf_task('SCA05', null, 'Communications', v_comm, 'SCA05-' || v_company.id || '-' || v_week,
                           app.london_at(v_week - 3, time '12:00'), v_company.name || ' w/c ' || v_week);
    v_lists := v_lists || jsonb_build_object('company_id', v_company.id, 'company', v_company.name,
      'communication_id', v_comm, 'created', v_created, 'items', jsonb_array_length(v_items),
      'unacknowledged', (select count(*) from jsonb_array_elements(v_items) e where not (e.value ->> 'acknowledged')::boolean),
      'task', v_task);
  end loop;
  return jsonb_build_object('status', 'Recorded', 'week_start', v_week, 'week_end', v_end, 'lists', v_lists,
                            'unassigned_bookings', v_unassigned, 'external_calls', 0);
end
$$;

-- =============================================================================
-- Reads
-- =============================================================================

create function app.scf_read_keys(p_request jsonb, p_allowed text[])
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_object_keys(p_request) k where k <> 'read_type' and not k = any (p_allowed)) then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
end
$$;

-- SCAFFOLD_REQUIREMENT {job_id}
create function app.read_scaffold_requirement(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  perform app.scf_read_keys(p_request, array['job_id']);
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id');
  if v_job.id is null then
    return jsonb_build_object('job_id', p_request ->> 'job_id', 'required', false, 'ready', false, 'error', 'JOB_NOT_FOUND');
  end if;
  return app.scf_requirement(v_job);
end
$$;

-- SCAFFOLD_BOOKING {booking_id} (reference _scfBookingView)
create function app.read_scaffold_booking(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_b public.scaffold_bookings;
  v_job public.jobs;
  v_company public.companies;
begin
  perform app.scf_read_keys(p_request, array['booking_id']);
  select * into v_b from public.scaffold_bookings where id = app.scf_uuid(p_request ->> 'booking_id');
  if v_b.id is null then
    return jsonb_build_object('found', false, 'booking_id', p_request ->> 'booking_id');
  end if;
  select * into v_job from public.jobs where id = v_b.job_id;
  select * into v_company from public.companies where id = v_b.company_id;
  return jsonb_build_object(
    'found', true, 'booking', to_jsonb(v_b),
    'job', jsonb_build_object('id', v_job.id, 'job_reference', v_job.job_ref, 'display_name', v_job.display_name,
                              'customer_happy_at', v_job.customer_happy_at, 'workflow_stage', v_job.workflow_stage),
    'company', case when v_company.id is not null then jsonb_build_object('id', v_company.id, 'name', v_company.name,
                 'standard_lead_days', v_company.standard_lead_days, 'contacts', app.scf_contacts(v_company.id)) end,
    'acknowledgement_required', v_b.status not in ('Cancelled', 'Stripped', 'Draft', 'Planned')
                                and coalesce(v_b.confirmed_revision, 0) < v_b.revision,
    'strip_blockers', case when v_b.status = 'Erected' then to_jsonb(app.scf_strip_blockers(v_job, v_b)) else '[]'::jsonb end,
    'next_action', case v_b.status
      when 'Draft' then 'Choose scaffolder and erect date; request scaffold'
      when 'Planned' then 'Request scaffold from scaffolder'
      when 'Requested' then 'Send instruction; record scaffolder confirmation (SCA01)'
      when 'Confirmed' then 'Record actual erect (SCA02)'
      when 'Erected' then case when v_job.customer_happy_at is not null then 'Authorise strip'
                               else 'Awaiting customer happy before strip authorisation' end
      when 'StripAuthorised' then 'Book strip date (SCA03)'
      when 'StripPlanned' then 'Record scaffolder strip confirmation'
      when 'StripConfirmed' then 'Record actual removal (SCA04)'
      when 'Stripped' then 'Complete'
      else 'Cancelled' end,
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'template_code', t.template_code, 'title', t.title,
                'status', t.status, 'due_at', t.due_at, 'owner_id', t.owner_id) order by t.created_at, t.id), '[]'::jsonb)
              from public.tasks t where t.related_entity_type = 'ScaffoldBookings' and t.related_entity_id = v_b.id),
    'communications', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'revision', c.revision,
                'status', c.status, 'subject', c.subject) order by c.created_at, c.id), '[]'::jsonb)
              from public.communications c
              where exists (select 1 from public.communication_jobs cj where cj.communication_id = c.id
                            and cj.scaffold_booking_id = v_b.id)),
    'acknowledgements', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'acknowledged_revision', a.acknowledged_revision,
                'response', a.response, 'received_at', a.received_at) order by a.created_at, a.id), '[]'::jsonb)
              from public.acknowledgements a where a.entity_id = v_b.id),
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'category', i.category, 'status', i.status,
                'blocks_strip', i.blocks_strip, 'severity', i.severity) order by i.created_at, i.id), '[]'::jsonb)
              from public.issues i
              where i.id = any (coalesce(v_b.related_issue_ids, '{}'))
                 or (i.job_id = v_b.job_id and i.responsible_company_id = v_b.company_id)));
end
$$;

-- SCAFFOLDERS {} (reference _scfScaffolders)
create function app.read_scaffolders(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.scf_read_keys(p_request, '{}'::text[]);
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'company_id', c.id, 'name', c.name, 'active', c.active, 'standard_lead_days', c.standard_lead_days,
            'contacts', app.scf_contacts(c.id),
            'configured', exists (select 1 from public.contacts x where x.company_id = c.id and x.active
                                  and nullif(btrim(x.email), '') is not null))
          order by c.name, c.id), '[]'::jsonb)
          from public.companies c where c.type = 'Scaffolder');
end
$$;

-- =============================================================================
-- Registry
-- =============================================================================

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('SCAFFOLDER_CONFIGURE', array['Admin', 'Manager'], false, '[]', 'scaffold',
   'scaffold/workflow.js _scfConfigureScaffolder (not FN-04 gated in the reference)'),
  ('SCAFFOLD_REQUEST', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfRequest + s09/scaffold.js createScaffoldBooking'),
  ('SCAFFOLD_CONFIRM_ERECT', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfConfirmErect'),
  ('SCAFFOLD_RECORD_ERECTED', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfRecordErected'),
  ('SCAFFOLD_AUTHORISE_STRIP', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfAuthoriseStrip'),
  ('SCAFFOLD_PLAN_STRIP', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfPlanStrip'),
  ('SCAFFOLD_CONFIRM_STRIP', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfConfirmStrip'),
  ('SCAFFOLD_RECORD_STRIPPED', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfRecordStripped'),
  ('SCAFFOLD_CHANGE_DATES', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfChangeDates'),
  ('SCAFFOLD_CANCEL', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfCancel'),
  ('SCAFFOLD_COMPLAINT', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfComplaint'),
  ('SCAFFOLD_CHASE', array['Admin', 'Manager', 'Office'], false, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfChase'),
  ('SCAFFOLD_WEEKLY_LIST', array['Admin', 'Manager', 'Office'], false, '[{"function_id":"FN-04","mode":"Automated"}]', 'scaffold',
   'scaffold/workflow.js _scfWeeklyList');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('SCAFFOLD_REQUIREMENT', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'scaffold',
   's09/scaffold.js evaluateScaffoldRequirement'),
  ('SCAFFOLD_BOOKING', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'scaffold',
   'scaffold/workflow.js _scfBookingView'),
  ('SCAFFOLDERS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'scaffold',
   'scaffold/workflow.js _scfScaffolders');
