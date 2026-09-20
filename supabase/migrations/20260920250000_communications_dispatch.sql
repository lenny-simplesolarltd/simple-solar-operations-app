-- =============================================================================
-- Communications: approval, dispatch intent and the manual-send record.
--
-- The outbound spine already exists and is deliberately dormant
-- (20260919104000 scaffold; 20260919164000 outbox protocol). Producers capture
-- a Draft communication and nothing is ever sent: app.mat_capture writes
-- "CAPTURED DRAFT - not sent. FN-03 R2." into the body, app.scf_communication
-- does the same for scaffold instructions. What was missing is the step
-- BETWEEN a captured Draft and a worker: an approval by a named person, an
-- email action type in app.outbox_action_types, and a dispatch decision hook.
--
-- This migration adds exactly that, and adds NO transport. It is deliberately
-- ignorant of Gmail, Resend, SMTP and every other provider: the worker is the
-- only thing that knows, and there is no worker yet. Nothing here can send an
-- email, and with the settings as shipped nothing can even be queued.
--
-- FOUR INDEPENDENT DOORS must all be opened before one byte leaves:
--
--   1. release_modes.<FN>.mode = 'Automated' with scope Pilot/All.
--      Every function ships 'Disabled'. COMMUNICATION_QUEUE checks this, so
--      today it REFUSES and no outbox row is even created. public.outbox_claim
--      checks it again before claiming.
--   2. settings['email.mode'] = 'LIVE'. Ships "CAPTURE": app.outbox_claim
--      reports due rows and leaves them Pending.
--   3. settings['email.from_mailbox'] must be a real mailbox. Ships "": the
--      claim decision returns NeedsReview before any transport is consulted.
--   4. settings['outbound.allowed_recipients'] must contain every recipient.
--      Ships [] (20260919164000), and app.outbound_guard refuses outright on
--      an empty allow-list.
--
-- Two decisions already recorded in the database shape this, and are NOT
-- overridden here:
--
--   * FN-20 "Customer and installer notices" and FN-18 "Manual missing-form
--     reminder" have planned_target_mode 'Manual' - their recorded fallback is
--     "R1 tracked manual sends/outcomes" and "Tanya sends/records two-working-
--     day reminder". public.outbox_claim refuses any type whose function is
--     not Automated, so such a notice can never be auto-dispatched. That is a
--     decision, not a gap. COMMUNICATION_RECORD_SENT is their path: a person
--     sends it from their own mailbox and the system records that they did.
--   * app.outbound_guard already states that a transport response proves
--     submission, never receipt. Receipt stays public.acknowledgements, with
--     recorded_by a person.
--
-- Additive only. No existing table, column or function is dropped or altered.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissions
--
-- Reading communications stays app.is_office_class() (the RLS policy applied
-- in 20260919104000). These three are the ACTIONS, kept apart because
-- approving an outbound message to a merchant is not the same authority as
-- reading one.
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('communication.approve',
   'Approve a captured draft message, so it may be queued or sent. Approving does not send anything.'),
  ('communication.send',
   'Queue an approved message for the email worker. Refused unless the function is Automated.'),
  ('communication.record_send',
   'Record that a person sent a message themselves, from their own mailbox, outside this system.')
on conflict (code) do nothing;

-- Office-class administration. Directors approve but do not queue: dispatch is
-- an operational act. Nobody else gets any of it.
insert into public.role_permissions (role_code, permission_code)
select r.role_code, p.code
from (values ('Admin'), ('Manager'), ('Office')) as r (role_code)
cross join (values ('communication.approve'), ('communication.send'),
                   ('communication.record_send')) as p (code)
union all
select 'Director', 'communication.approve'
on conflict (role_code, permission_code) do nothing;

-- The actor's OWN roles decide, mapped through role_permissions - not
-- app.current_roles(), so a command authorises identically whoever executes
-- the transaction. app.command_registry.roles is the coarse gate;
-- role_permissions is the finer one an administrator can retune without a
-- migration.
create function app.comm_require(p_actor jsonb, p_permission text)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.role_permissions rp
    where rp.permission_code = p_permission
      and rp.role_code = any (array(select jsonb_array_elements_text(coalesce(p_actor -> 'roles', '[]'::jsonb))))
  ) then
    perform app.fail('R1A_PERMISSION_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Settings - the resting state
-- -----------------------------------------------------------------------------

insert into public.settings (key, typed_value, scope, version, effective_from, reason) values
  ('email.mode', '"CAPTURE"'::jsonb, 'Global', 1, '2026-01-01',
   'Per-type live switch for the email action types (app.outbox_action_types.live_setting). Anything other than the exact string LIVE means CAPTURE: due rows are reported and left Pending. CAPTURE is the correct resting state.'),
  ('email.from_mailbox', '""'::jsonb, 'Global', 1, '2026-01-01',
   'The single mailbox operational email is sent FROM, and where replies land. Empty means not configured: the claim decision returns NeedsReview before any transport is consulted. The owner supplies this; it is not guessed.'),
  ('email.transport', '"noop"'::jsonb, 'Global', 1, '2026-01-01',
   'Which transport adapter the worker loads: noop (default - records what it would have sent and reports success to nothing), or a named provider once one is chosen and authorised. Nothing in the database depends on this value; it exists so the choice is recorded configuration rather than a deployment detail.')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Which communication types are dispatchable, and under which function
--
-- A type absent from this table, or present with a null action_type, can be
-- approved and recorded as manually sent but can NEVER be queued. That is how
-- FN-20 / FN-18 notices stay manual by construction rather than by care.
-- -----------------------------------------------------------------------------

create table app.communication_kinds (
  type        text primary key check (btrim(type) <> ''),
  -- Null: this type is never auto-dispatched (a person sends it and records it).
  action_type text references app.outbox_action_types (action_type),
  function_id text check (function_id ~ '^FN-[0-9]{2}$'),
  module      text not null,
  notes       text,
  constraint communication_kinds_dispatchable
    check ((action_type is null) = (function_id is null))
);
comment on table app.communication_kinds is
  'Maps communications.type to its outbox action type and release function. A null action_type means manual-send-and-record only.';

revoke all on app.communication_kinds from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. The email action types
--
-- One per business function, NOT one generic "EmailSend": each keeps its own
-- release gate, its own attempt budget and its own audit service, which is the
-- whole point of the registry design in 20260919164000.
-- -----------------------------------------------------------------------------

insert into app.outbox_action_types (action_type, service, function_id, live_setting, max_attempts,
                                     backoff_minutes, stalled_minutes, claim_hook, result_hook, module, notes) values
  ('EmailOrder', 'EmailService', 'FN-03', 'email.mode', 5, '{1,2,4,8,16}', 15,
   'email_claim_decision', 'email_on_result', 'communications',
   'Merchant orders and order cancellations. FN-03 Automated + email.mode LIVE + a configured sender + an allow-listed recipient.'),
  ('EmailScaffold', 'EmailService', 'FN-04', 'email.mode', 5, '{1,2,4,8,16}', 15,
   'email_claim_decision', 'email_on_result', 'communications',
   'Scaffold erect/strip instructions and cancellations. FN-04 Automated + email.mode LIVE + a configured sender + an allow-listed recipient.');

insert into app.communication_kinds (type, action_type, function_id, module, notes) values
  ('MerchantOrder',             'EmailOrder',    'FN-03', 'materials',
   'app.mat_capture, r2_materials_ordering'),
  ('MerchantOrderCancellation', 'EmailOrder',    'FN-03', 'materials',
   'app.mat_capture, order cancellation'),
  ('ScaffoldInstruction',       'EmailScaffold', 'FN-04', 'scaffold',
   'app.scf_communication, erect instruction'),
  ('ScaffoldStripInstruction',  'EmailScaffold', 'FN-04', 'scaffold',
   'app.scf_communication, strip instruction'),
  ('ScaffoldCancellation',      'EmailScaffold', 'FN-04', 'scaffold',
   'app.scf_communication, cancellation');

-- -----------------------------------------------------------------------------
-- 5. What would be sent, and to whom
-- -----------------------------------------------------------------------------

-- The approved content, canonically. jsonb renders its keys in a stable order,
-- so the text form hashes reproducibly.
create function app.comm_payload(p_comm public.communications)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'communication_id', p_comm.id,
    'type', p_comm.type,
    'revision', p_comm.revision,
    'subject', p_comm.subject,
    'body', p_comm.body_snapshot,
    'recipients', p_comm.recipients_snapshot,
    'attachment_ids', to_jsonb(coalesce(p_comm.attachment_ids, '{}'::text[])))
$$;

create function app.comm_payload_hash(p_comm public.communications)
returns text
language sql immutable
set search_path = ''
as $$ select encode(sha256(convert_to(app.comm_payload(p_comm)::text, 'UTF8')), 'hex') $$;

-- recipients_snapshot is the contacts as they were when captured:
-- [{"contact_id":..,"name":..,"email":..,"channel":..}] (app.mat_contacts /
-- app.scf_contacts), where a missing address is the literal 'NOT_CONFIGURED'.
-- Returns {ok, to[], unusable[]} or {ok:false, code, detail}. Never raises, so
-- one unreadable snapshot sends its own row to review instead of aborting a
-- whole claim batch.
create function app.comm_recipients(p_comm public.communications)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_raw jsonb;
  v_to text[];
  v_unusable jsonb;
begin
  begin
    v_raw := p_comm.recipients_snapshot::jsonb;
  exception when others then
    v_raw := null;
  end;
  if v_raw is null or jsonb_typeof(v_raw) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'RECIPIENTS_UNREADABLE',
                              'detail', 'recipients_snapshot is not a JSON array');
  end if;
  select coalesce(array_agg(distinct m.mailbox), '{}')
  into v_to
  from (select lower(btrim(e ->> 'email')) mailbox from jsonb_array_elements(v_raw) e) m
  where m.mailbox ~ '^[a-z0-9_+.-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';
  select coalesce(jsonb_agg(jsonb_build_object('name', e ->> 'name', 'email', e ->> 'email')
                            order by e ->> 'name'), '[]'::jsonb)
  into v_unusable
  from jsonb_array_elements(v_raw) e
  where coalesce(lower(btrim(e ->> 'email')), '') !~ '^[a-z0-9_+.-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';
  if cardinality(v_to) = 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_USABLE_RECIPIENT',
                              'detail', 'no contact on this message has a usable email address',
                              'unusable', v_unusable);
  end if;
  return jsonb_build_object('ok', true, 'to', to_jsonb(v_to), 'unusable', v_unusable);
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Claim hook: the safety gate before any transport call
--
-- Same contract as app.calendar_claim_decision: stable, so the dry-run preview
-- can call it; returns send | review | succeed | cancel; raises only for a
-- MISCONFIGURATION, which must fail the whole claim rather than quietly mark
-- one row for review.
-- -----------------------------------------------------------------------------

create function app.email_claim_decision(p_out public.outbox)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_comm public.communications;
  v_kind app.communication_kinds;
  v_sender text := nullif(btrim(coalesce(app.setting('email.from_mailbox') #>> '{}', '')), '');
  v_allow text[];
  v_rec jsonb;
  v_to text[];
  v_bad text[];
begin
  -- Misconfiguration: refuse the batch, exactly as the calendar does.
  v_allow := array(select lower(btrim(x)) from unnest(app.setting_text_array('outbound.allowed_recipients')) x);
  if cardinality(v_allow) = 0 then
    perform app.fail('EMAIL_REFUSED: LIVE mode requires outbound.allowed_recipients');
  end if;

  select * into v_comm from public.communications c
  where c.outbox_id = p_out.id order by c.created_at, c.id limit 1;
  if not found then
    return jsonb_build_object('decision', 'review', 'code', 'COMMUNICATION_MISSING',
                              'detail', 'no communications row references outbox ' || p_out.id);
  end if;

  select * into v_kind from app.communication_kinds k where k.type = v_comm.type;
  if not found or v_kind.action_type is null then
    return jsonb_build_object('decision', 'review', 'code', 'TYPE_NOT_DISPATCHABLE',
                              'detail', 'communications.type=' || v_comm.type
                                        || ' is not an automatically dispatched type');
  end if;
  if v_kind.action_type <> p_out.action_type then
    return jsonb_build_object('decision', 'review', 'code', 'ACTION_TYPE_MISMATCH',
                              'detail', 'type ' || v_comm.type || ' dispatches as ' || v_kind.action_type
                                        || ', outbox row is ' || p_out.action_type);
  end if;

  -- Already sent: never send a second copy. Idempotency before anything else.
  if v_comm.status = 'Sent' or nullif(btrim(coalesce(v_comm.external_message_id, '')), '') is not null then
    return jsonb_build_object('decision', 'succeed', 'external_id', v_comm.external_message_id,
                              'summary', 'ALREADY_SENT: communication ' || v_comm.id
                                         || ' is recorded as sent; nothing re-sent');
  end if;
  if v_comm.status <> 'Queued' then
    if p_out.attempt_count = 0 and p_out.status = 'Pending' then
      return jsonb_build_object('decision', 'cancel', 'summary',
        'NOT_QUEUED: communication ' || v_comm.id || ' is ' || v_comm.status
        || '; this row was never sent');
    end if;
    return jsonb_build_object('decision', 'review', 'code', 'NOT_QUEUED_AFTER_ATTEMPT',
      'detail', 'communication ' || v_comm.id || ' is ' || v_comm.status
                || '; a prior attempt may have reached the transport');
  end if;

  -- The content must still be the content that was approved.
  if app.comm_payload_hash(v_comm) <> p_out.payload_hash then
    return jsonb_build_object('decision', 'review', 'code', 'PAYLOAD_CHANGED',
      'detail', 'the message changed after it was approved and queued; re-approve it');
  end if;

  if v_sender is null or v_sender !~ '^[A-Za-z0-9_+.-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' then
    return jsonb_build_object('decision', 'review', 'code', 'SENDER_NOT_CONFIGURED',
      'detail', 'settings email.from_mailbox is not a mailbox');
  end if;
  if nullif(btrim(p_out.target), '') is not null and lower(btrim(p_out.target)) <> lower(v_sender)
     and p_out.target <> 'NOT_CONFIGURED' then
    return jsonb_build_object('decision', 'review', 'code', 'SENDER_CHANGED',
      'detail', 'this row was queued to send from ' || p_out.target || ', the configured sender is now ' || v_sender);
  end if;

  v_rec := app.comm_recipients(v_comm);
  if not (v_rec ->> 'ok')::boolean then
    return jsonb_build_object('decision', 'review', 'code', v_rec ->> 'code', 'detail', v_rec ->> 'detail');
  end if;
  v_to := array(select jsonb_array_elements_text(v_rec -> 'to'));
  v_bad := array(select t from unnest(v_to) t where not t = any (v_allow));
  if cardinality(v_bad) > 0 then
    return jsonb_build_object('decision', 'review', 'code', 'RECIPIENT_NOT_ALLOWLISTED',
      'detail', array_to_string(v_bad, ', ') || ' not in outbound.allowed_recipients');
  end if;
  -- Final authority, and the same function the calendar guests go through. It
  -- cannot raise here: the allow-list is non-empty and every address above is
  -- in it.
  perform app.outbound_guard('EMAIL', v_to);

  return jsonb_build_object('decision', 'send', 'work', jsonb_build_object(
    'operation', 'send',
    'communication_id', v_comm.id,
    'job_id', v_comm.job_id,
    'company_id', v_comm.company_id,
    'type', v_comm.type,
    'revision', v_comm.revision,
    'from', v_sender,
    'to', v_rec -> 'to',
    'subject', v_comm.subject,
    'body', v_comm.body_snapshot,
    'attachment_ids', to_jsonb(coalesce(v_comm.attachment_ids, '{}'::text[])),
    -- A retry must reconcile before it re-sends: the worker searches the
    -- sending mailbox for this tag rather than sending a second copy.
    'dedupe_tag', '[SSO-COMM:' || v_comm.id || ']',
    'reconcile_first', (p_out.attempt_count > 0 or p_out.status = 'RetryDue'),
    'delivery_confirmed', false));
end
$$;

-- -----------------------------------------------------------------------------
-- 7. Result hook: keep the communication in step, audit every attempt
-- -----------------------------------------------------------------------------

create function app.email_on_result(p_before public.outbox, p_after public.outbox, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comm public.communications;
  v_after public.communications;
  v_status text;
begin
  select * into v_comm from public.communications c
  where c.outbox_id = p_after.id order by c.created_at, c.id limit 1;
  if not found then
    return;
  end if;
  v_status := case p_outcome
    when 'Succeeded'  then 'Sent'
    when 'NeedsReview' then 'Uncertain'
    when 'Cancelled'  then 'Failed'
    -- Claimed / RetryDue / Stalled: the message is still Queued. Its state
    -- belongs to the outbox row, which is already audited per attempt.
    else null
  end;
  if v_status is null then
    return;
  end if;
  update public.communications
  set status = v_status,
      sent_at = case when v_status = 'Sent' then coalesce(sent_at, now()) else sent_at end,
      external_message_id = case
        when v_status = 'Sent' then coalesce(nullif(btrim(coalesce(p_after.external_id, '')), ''), external_message_id)
        else external_message_id end
  where id = v_comm.id
  returning * into v_after;
  perform app.audit('Communications', v_after.id::text, 'CommunicationDispatch' || p_outcome,
                    to_jsonb(v_comm), to_jsonb(v_after), p_after.response_summary);
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Commands
-- -----------------------------------------------------------------------------

create function app.comm_load(p_request jsonb)
returns public.communications
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'communication_id');
  v_comm public.communications;
begin
  if v_id is null then
    perform app.fail('COMM_REFUSED: communication_id is required');
  end if;
  select * into v_comm from public.communications where id = v_id for update;
  if not found then
    perform app.fail('COMM_NOT_FOUND', jsonb_build_object('communication_id', v_id));
  end if;
  perform app.r2_optional_version(p_request, v_comm.version);
  return v_comm;
end
$$;

-- A named person takes responsibility for the content. Approving sends nothing
-- and needs no release mode: the office must be able to work through captured
-- drafts while every function is still Disabled.
create function app.cmd_communication_approve(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_comm public.communications;
  v_after public.communications;
  v_reason text := nullif(btrim(coalesce(p_request -> 'payload' ->> 'reason', '')), '');
begin
  perform app.comm_require(p_actor, 'communication.approve');
  v_comm := app.comm_load(p_request);
  if v_comm.status = 'Approved' then
    return jsonb_build_object('approved', false, 'already_approved', true,
                              'communication_id', v_comm.id, 'status', v_comm.status);
  end if;
  if v_comm.status <> 'Draft' then
    perform app.fail('COMM_STATUS_INVALID',
                     jsonb_build_object('status', v_comm.status, 'expected', 'Draft'));
  end if;
  update public.communications
  set status = 'Approved', approved_at = now(), approved_by = app.actor_id(p_actor)
  where id = v_comm.id
  returning * into v_after;
  perform app.audit('Communications', v_after.id::text, 'CommunicationApproved',
                    to_jsonb(v_comm), to_jsonb(v_after), v_reason);
  return jsonb_build_object('approved', true, 'communication_id', v_after.id, 'status', v_after.status,
                            'approved_by', v_after.approved_by, 'version', v_after.version,
                            'sent', false, 'note', 'Approved only. Nothing has been sent.');
end
$$;

-- Approved -> Queued, with one outbox row. This is where the release gate
-- bites: with every function Disabled it refuses and writes nothing, so
-- dispatch intent cannot quietly accumulate to be flushed the moment someone
-- flips email.mode.
create function app.cmd_communication_queue(p_request jsonb, p_actor jsonb)
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
  perform app.comm_require(p_actor, 'communication.send');
  v_comm := app.comm_load(p_request);

  select * into v_kind from app.communication_kinds k where k.type = v_comm.type;
  if not found or v_kind.action_type is null then
    perform app.fail('COMM_NOT_DISPATCHABLE',
      jsonb_build_object('type', v_comm.type,
                         'detail', 'this type is sent by a person and recorded with COMMUNICATION_RECORD_SENT'));
  end if;
  -- The real door. Refuses today: every function ships Disabled.
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
  -- Same content queued twice is the same row (unique idempotency_key); edit
  -- the message and it becomes a different one.
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

-- The FN-20 / FN-18 path: a person sent it from their own mailbox. The system
-- records the FACT, never claims to have sent it, and creates no outbox row.
create function app.cmd_communication_record_sent(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_comm public.communications;
  v_after public.communications;
  v_note text := nullif(btrim(coalesce(p_request -> 'payload' ->> 'note', '')), '');
  v_ref text := nullif(btrim(coalesce(p_request -> 'payload' ->> 'external_reference', '')), '');
  v_sent timestamptz;
begin
  perform app.comm_require(p_actor, 'communication.record_send');
  v_comm := app.comm_load(p_request);
  if v_note is null then
    perform app.fail('COMM_REFUSED: note is required - say in your own words what was sent and to whom');
  end if;
  if v_comm.outbox_id is not null then
    perform app.fail('COMM_REFUSED: this message is queued for the system to send; resolve the outbox row instead');
  end if;
  if v_comm.status not in ('Draft', 'Approved') then
    perform app.fail('COMM_STATUS_INVALID',
                     jsonb_build_object('status', v_comm.status, 'expected', 'Draft or Approved'));
  end if;
  v_sent := coalesce((p_request -> 'payload' ->> 'sent_at')::timestamptz, now());
  if v_sent > now() then
    perform app.fail('COMM_REFUSED: sent_at is in the future');
  end if;
  update public.communications
  set status = 'Sent', sent_at = v_sent,
      -- Prefixed so nothing ever mistakes a human's reference for a transport id.
      external_message_id = case when v_ref is not null then 'manual:' || v_ref else null end
  where id = v_comm.id
  returning * into v_after;
  perform app.audit('Communications', v_after.id::text, 'CommunicationRecordedSentByPerson',
                    to_jsonb(v_comm), to_jsonb(v_after), v_note);
  return jsonb_build_object('recorded', true, 'communication_id', v_after.id, 'status', v_after.status,
                            'sent_at', v_after.sent_at, 'version', v_after.version,
                            'sent_by_system', false,
                            'note', 'Recorded that a person sent this. The system sent nothing and cannot confirm delivery.');
end
$$;

-- -----------------------------------------------------------------------------
-- 9. Reads
--
-- Roles mirror the communications_select RLS policy (app.is_office_class()),
-- so a read through this path shows exactly what a direct select would.
-- -----------------------------------------------------------------------------

create function app.read_communications(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_status text := nullif(btrim(coalesce(p_request ->> 'status', '')), '');
  v_limit int;
begin
  perform app.r2cal_read_keys(p_request, array['job_id', 'status', 'limit']);
  v_job := app.ref(p_request, 'job_id');
  if v_status is not null and v_status not in ('Draft', 'Approved', 'Queued', 'Sent', 'Uncertain', 'Failed') then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_limit := case when coalesce((p_request ->> 'limit')::int, 0) > 0
                  then least((p_request ->> 'limit')::int, 200) else 50 end;
  return jsonb_build_object(
    'job_id', v_job, 'status', v_status,
    'communications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'communication_id', c.id, 'job_id', c.job_id, 'company_id', c.company_id, 'type', c.type,
        'subject', c.subject, 'status', c.status, 'revision', c.revision, 'version', c.version,
        'approved_at', c.approved_at, 'approved_by', c.approved_by, 'sent_at', c.sent_at,
        'external_message_id', c.external_message_id, 'outbox_id', c.outbox_id,
        'outbox_status', o.status, 'outbox_summary', o.response_summary,
        'dispatchable', (k.action_type is not null), 'action_type', k.action_type,
        'function_id', k.function_id, 'created_at', c.created_at) order by c.created_at desc, c.id)
      from (select c.* from public.communications c
            where (v_job is null or c.job_id = v_job)
              and (v_status is null or c.status = v_status)
            order by c.created_at desc, c.id limit v_limit) c
      left join public.outbox o on o.id = c.outbox_id
      left join app.communication_kinds k on k.type = c.type), '[]'::jsonb),
    'retrieved_at', now());
end
$$;

create function app.read_communication(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_comm public.communications;
  v_kind app.communication_kinds;
  v_rec jsonb;
begin
  perform app.r2cal_read_keys(p_request, array['communication_id']);
  v_id := app.ref(p_request, 'communication_id');
  if v_id is null then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  select * into v_comm from public.communications where id = v_id;
  if not found then
    perform app.fail('COMM_NOT_FOUND', jsonb_build_object('communication_id', v_id));
  end if;
  select * into v_kind from app.communication_kinds k where k.type = v_comm.type;
  v_rec := app.comm_recipients(v_comm);
  return jsonb_build_object(
    'communication', to_jsonb(v_comm),
    'dispatchable', (v_kind.action_type is not null),
    'action_type', v_kind.action_type,
    'function_id', v_kind.function_id,
    'recipients', v_rec,
    'payload_hash', app.comm_payload_hash(v_comm),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job_id', cj.job_id, 'order_id', cj.order_id,
                                                          'scaffold_booking_id', cj.scaffold_booking_id,
                                                          'entity_revision', cj.entity_revision)
                                       order by cj.created_at, cj.id)
                      from public.communication_jobs cj where cj.communication_id = v_comm.id), '[]'::jsonb),
    'acknowledgements', coalesce((select jsonb_agg(jsonb_build_object('acknowledgement_id', a.id,
                                                    'response', a.response, 'response_text', a.response_text,
                                                    'acknowledged_revision', a.acknowledged_revision,
                                                    'received_at', a.received_at, 'recorded_by', a.recorded_by)
                                                   order by a.received_at desc, a.id)
                                  from public.acknowledgements a where a.communication_id = v_comm.id), '[]'::jsonb),
    'outbox', (select to_jsonb(o) from public.outbox o where o.id = v_comm.outbox_id),
    'retrieved_at', now());
end
$$;

-- -----------------------------------------------------------------------------
-- 10. Registration
-- -----------------------------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('COMMUNICATION_APPROVE', array['Admin', 'Manager', 'Director', 'Office'], false, '[]', 'communications',
   'A named person approves captured content. No release mode: approving sends nothing, and the office must be able to work while every function is Disabled. Fine authority: communication.approve.'),
  ('COMMUNICATION_QUEUE', array['Admin', 'Manager', 'Office'], false, '[]', 'communications',
   'Approved -> Queued + one outbox row. The mode is required in the HANDLER, from the type''s own function (FN-03 / FN-04), because the registry cannot express a per-row function. Fine authority: communication.send.'),
  ('COMMUNICATION_RECORD_SENT', array['Admin', 'Manager', 'Office'], false, '[]', 'communications',
   'Records that a person sent the message themselves (the FN-20 / FN-18 manual route). Creates no outbox row and claims no delivery. Fine authority: communication.record_send.');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('COMMUNICATIONS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'communications',
   'Captured and sent messages, optionally by job or status. Roles mirror the communications_select RLS policy.'),
  ('COMMUNICATION', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'], '[]', 'communications',
   'One message with its jobs, acknowledgements and outbox row.');
