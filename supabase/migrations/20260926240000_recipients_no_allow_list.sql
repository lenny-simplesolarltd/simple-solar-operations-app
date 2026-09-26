-- =============================================================================
-- The allow-list stops gating email. Naming a recipient IS the authorisation.
--
-- 20260926210000 made outbound.allowed_recipients a per-action-type rail and
-- let EmailReport out from under it, on the argument that a permitted person
-- who types an address into a screen has already authorised it, and that a
-- second, invisible list only produces silent non-delivery.
--
-- That argument was never specific to reports. A merchant's address, a
-- scaffolder's, a customer's: each is on a record somebody in this business
-- entered and can see. Requiring them ALSO to appear in a settings row that
-- exists nowhere in the UI means the common failure is "the screen said
-- Queued and it never arrived", diagnosable only by reading
-- app.email_claim_decision. That is worse than the mistake it prevented.
--
-- So the rail comes off every email action type, and new types default to
-- off rather than on.
--
-- WHAT THIS GIVES UP, stated plainly: recipients derived from job data are no
-- longer bounded by a list. A wrong address on a merchant record now reaches
-- that address for real. The doors that remain are the function's release mode
-- (FN-03, FN-04, FN-23, FN-24), email.mode = LIVE, a configured sending
-- mailbox, a valid recipient list on the communication, and the payload hash
-- still matching what was approved.
--
-- NOT CHANGED: calendar guests. app.outbound_guard and the guest check in
-- 20260919164000 are a different path with a different failure mode (a
-- calendar invite cannot be unsent or recalled), and nobody has asked for it.
--
-- ROLLBACK:
--   begin;
--   alter table app.outbox_action_types alter column allowlist_required set default true;
--   update app.outbox_action_types set allowlist_required = true where action_type <> 'EmailReport';
--   -- and restore app.email_claim_decision from 20260926210000
--   commit;
-- =============================================================================

alter table app.outbox_action_types
  alter column allowlist_required set default false;

update app.outbox_action_types set allowlist_required = false;

comment on column app.outbox_action_types.allowlist_required is
  'Whether outbound.allowed_recipients gates this type. Off for every type: a permitted person naming a recipient is the authorisation. Kept as a column so a type can be put back under the list in a migration, with a reason, rather than by editing a settings row.';

-- -----------------------------------------------------------------------------
-- The claim decision, with the allow-list branch made explicit.
--
-- It was already conditional, but only by accident: when allowlist_required
-- was false, v_allow stayed NULL and `not t = any (NULL)` filtered every row
-- out, so the comparison below silently found nothing. That is the right
-- answer reached by a route that would break the moment somebody gave v_allow
-- a default. The check now sits inside the same branch as the lookup.
-- -----------------------------------------------------------------------------

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
  v_action app.outbox_action_types;
  v_allow text[];
  v_rec jsonb;
  v_to text[];
  v_bad text[];
begin
  select * into v_action from app.outbox_action_types a where a.action_type = p_out.action_type;

  if coalesce(v_action.allowlist_required, false) then
    -- Misconfiguration: refuse the batch, exactly as the calendar does.
    v_allow := array(select lower(btrim(x)) from unnest(app.setting_text_array('outbound.allowed_recipients')) x);
    if cardinality(v_allow) = 0 then
      perform app.fail('EMAIL_REFUSED: LIVE mode requires outbound.allowed_recipients');
    end if;
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

  -- Both halves of the rail in one branch, so a type that is not under the
  -- list is not silently compared against an empty one.
  if coalesce(v_action.allowlist_required, false) then
    v_bad := array(select t from unnest(v_to) t where not t = any (v_allow));
    if cardinality(v_bad) > 0 then
      return jsonb_build_object('decision', 'review', 'code', 'RECIPIENT_NOT_ALLOWLISTED',
        'detail', array_to_string(v_bad, ', ') || ' not in outbound.allowed_recipients');
    end if;
    perform app.outbound_guard('EMAIL', v_to);
  end if;

  return jsonb_build_object('decision', 'send', 'work', jsonb_build_object(
    'operation', 'send',
    'communication_id', v_comm.id,
    'job_id', v_comm.job_id,
    'company_id', v_comm.company_id,
    'type', v_comm.type,
    'revision', v_comm.revision,
    'from', v_sender,
    'reply_to', coalesce(v_reply, v_sender),
    'to', v_rec -> 'to',
    'subject', v_comm.subject,
    'body', v_comm.body_snapshot,
    'attachment_ids', to_jsonb(coalesce(v_comm.attachment_ids, '{}'::text[])),
    'dedupe_tag', '[SSO-COMM:' || v_comm.id || ']',
    'reconcile_first', (p_out.attempt_count > 0 or p_out.status = 'RetryDue'),
    'delivery_confirmed', false));
end
$$;
