-- =============================================================================
-- A reply-to address, so a reply reaches a person.
--
-- Production sending will be from a dedicated subdomain - send.simplesolarltd.
-- co.uk - because verifying the ROOT domain in Resend means putting an MX
-- record on it, which would collide with the five Google Workspace MX records
-- and break inbound mail for the whole company. A subdomain keeps Google's
-- records untouched and isolates sending reputation, so a bad send can never
-- harm the domain staff email from.
--
-- But that subdomain has no inbound mail and never will. Without a reply-to,
-- every reply to a report - "this figure looks wrong", "take me off this" -
-- would bounce or vanish. That matters here more than usual: this system's
-- only evidence that anybody received anything is a reply recorded as an
-- acknowledgement, and a transport response is submission, not receipt.
--
-- So the FROM is the subdomain and the REPLY-TO is the real monitored mailbox.
-- Replies land in Google Workspace exactly as they do today.
--
-- Defaults to email.from_mailbox when unset, which preserves today's behaviour
-- exactly: before this, a reply went to the from address because there was
-- nothing else to go to.
--
-- ROLLBACK:
--   begin;
--   -- restore app.email_claim_decision from 20260920250000 (drop 'reply_to')
--   commit;
-- =============================================================================

-- Immutable, versioned settings: a change is a new row, and the old value stays
-- readable as history. Seeded to the mailbox already in use, so nothing moves
-- until somebody decides it should.
insert into public.settings (key, typed_value, scope, version, effective_from, reason)
select 'email.reply_to', '"operations@simplesolarltd.co.uk"'::jsonb, 'Global',
       coalesce(max(s.version), 0) + 1, current_date,
       'Where replies to system email go. Separate from the sender so mail can be sent from a subdomain without losing replies.'
from public.settings s
where s.key = 'email.reply_to' and s.scope = 'Global';

create or replace function app.email_claim_decision(p_out public.outbox)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_comm public.communications;
  v_kind app.communication_kinds;
  v_sender text := nullif(btrim(coalesce(app.setting('email.from_mailbox') #>> '{}', '')), '');
  v_reply text := nullif(btrim(coalesce(app.setting('email.reply_to') #>> '{}', '')), '');
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
  -- A misconfigured reply-to would send replies nowhere, silently, so it is
  -- checked like the sender rather than passed through unexamined.
  if v_reply is not null and v_reply !~ '^[A-Za-z0-9_+.-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' then
    return jsonb_build_object('decision', 'review', 'code', 'REPLY_TO_INVALID',
      'detail', 'settings.email.reply_to is not a valid address');
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
    -- Falls back to the sender, which is exactly what happened before this
    -- existed: a reply went to the address it came from.
    'reply_to', coalesce(v_reply, v_sender),
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
