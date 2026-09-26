-- =============================================================================
-- Receiving email: a merchant's reply lands in the system that sent to them.
--
-- WHY THIS SHAPE, and it is forced by how MX works:
--
-- MX records are per DOMAIN, not per mailbox. There is no way to route
-- operations@simplesolarltd.co.uk to one provider and the rest of the domain
-- to another - the provider with the lowest-priority MX receives everything.
-- Pointing the root at Resend would take all company mail off Google
-- Workspace, which is exactly what 20260926200000 already refused to do for
-- SENDING.
--
-- So the root domain is not touched. A NEW subdomain carries Resend's MX -
-- it has no mail today, so nothing can break - and Google Workspace forwards
-- operations@ to an address on it. operations@ keeps working exactly as it
-- does now, staff still see every message in Google, and the app receives a
-- copy. Two systems, one mailbox, and neither depends on the other.
--
-- OUTSIDE THIS REPOSITORY, and nothing here works until they are done:
--   1. Verify a receiving subdomain in Resend (e.g. inbound.simplesolarltd.co.uk)
--      and add ONLY the MX record it gives you, on that subdomain. Never on
--      the root.
--   2. In Google Admin, forward operations@simplesolarltd.co.uk to the address
--      on that subdomain. Keep delivery to the Google mailbox as well, or
--      staff stop seeing their own mail.
--   3. Point a Resend webhook for email.received at /api/email/inbound and put
--      its signing secret in RESEND_WEBHOOK_SECRET.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not write acknowledgements.
-- public.acknowledgements records a PERSON's judgement that a supplier
-- confirmed, needs changes, or cannot do it, and it has a recorded_by for that
-- reason. Reading "yeah that's fine unless the scaffold slips" as Confirmed is
-- the judgement, not the transport. An inbound email is evidence somebody can
-- act on; it is not itself an answer.
--
-- ROLLBACK:
--   begin;
--   drop function if exists app.inbound_email_record(jsonb);
--   drop table if exists public.inbound_emails;
--   commit;
-- =============================================================================

create table public.inbound_emails (
  id                  uuid primary key default gen_random_uuid(),
  -- The provider's id for this message. Unique, so a webhook redelivery - which
  -- Svix does on any non-2xx - records the message once rather than twice.
  provider_message_id text not null unique check (btrim(provider_message_id) <> ''),
  from_address        text not null check (btrim(from_address) <> ''),
  from_name           text,
  to_addresses        jsonb not null default '[]'::jsonb,
  subject             text,
  text_body           text,
  html_body           text,
  headers             jsonb not null default '{}'::jsonb,
  attachment_count    integer not null default 0 check (attachment_count >= 0),
  received_at         timestamptz not null,
  /**
   * The message this is a reply to, when it could be established.
   *
   * Null is a normal state, not a failure: somebody emailing the office out of
   * the blue belongs to no thread. matched_by says how the link was made so a
   * reader can tell a certain match from a likely one.
   */
  communication_id    uuid references public.communications (id) on delete set null,
  job_id              uuid references public.jobs (id) on delete set null,
  matched_by          text check (matched_by in ('Tag', 'Sender', 'None')),
  handled_at          timestamptz,
  handled_by          uuid references public.people (id),
  created_at          timestamptz not null default now()
);
comment on table public.inbound_emails is
  'Email received at the office mailbox, forwarded in by the mail provider. Evidence a person acts on - never an acknowledgement, which is a judgement with a recorded_by.';

create index inbound_emails_received_idx on public.inbound_emails (received_at desc);
create index inbound_emails_communication_idx on public.inbound_emails (communication_id);
create index inbound_emails_unhandled_idx on public.inbound_emails (received_at desc) where handled_at is null;

alter table public.inbound_emails enable row level security;

-- Whoever may send email may read what came back. Nobody may write from a
-- client: the only writer is the webhook, through the function below.
create policy inbound_emails_read on public.inbound_emails
  for select to authenticated using (app.has_permission('communication.send'));

/**
 * Records one received message. Called by the webhook with the service key.
 *
 * Idempotent on provider_message_id: a redelivered webhook returns the row it
 * already made. Threading happens here rather than in the route so that a
 * second ingestion path could never thread differently.
 */
create function app.inbound_email_record(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := nullif(btrim(coalesce(p ->> 'provider_message_id', '')), '');
  v_text text := coalesce(p ->> 'text_body', '');
  v_html text := coalesce(p ->> 'html_body', '');
  v_from text := lower(btrim(coalesce(p ->> 'from_address', '')));
  v_tag uuid;
  v_comm public.communications;
  v_matched text := 'None';
  v_row public.inbound_emails;
begin
  if v_id is null or v_from = '' then
    raise exception 'INBOUND_INVALID: provider_message_id and from_address are required';
  end if;

  select * into v_row from public.inbound_emails where provider_message_id = v_id;
  if found then
    return jsonb_build_object('inbound_id', v_row.id, 'already_recorded', true);
  end if;

  -- Every message this system sends carries [SSO-COMM:<id>] in its body, and a
  -- reply quotes it. That is an exact match, not a guess at a subject line.
  v_tag := substring(v_text || ' ' || v_html
                     from '\[SSO-COMM:([0-9a-f-]{36})\]')::uuid;
  if v_tag is not null then
    select * into v_comm from public.communications where id = v_tag;
    if found then v_matched := 'Tag'; end if;
  end if;

  -- Failing that, the most recent message this address was actually written
  -- to, within a month. Weaker, and labelled as such.
  if v_comm.id is null then
    select * into v_comm from public.communications c
    where c.created_at > now() - interval '30 days'
      and exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(c.recipients_snapshot::jsonb) = 'array'
               then c.recipients_snapshot::jsonb else '[]'::jsonb end) r
        where lower(btrim(coalesce(r ->> 'email', ''))) = v_from)
    order by c.created_at desc
    limit 1;
    if found then v_matched := 'Sender'; end if;
  end if;

  insert into public.inbound_emails (provider_message_id, from_address, from_name, to_addresses,
                                     subject, text_body, html_body, headers, attachment_count,
                                     received_at, communication_id, job_id, matched_by)
  values (v_id, v_from, nullif(btrim(coalesce(p ->> 'from_name', '')), ''),
          coalesce(p -> 'to_addresses', '[]'::jsonb),
          nullif(btrim(coalesce(p ->> 'subject', '')), ''),
          nullif(v_text, ''), nullif(v_html, ''),
          coalesce(p -> 'headers', '{}'::jsonb),
          coalesce((p ->> 'attachment_count')::integer, 0),
          coalesce((p ->> 'received_at')::timestamptz, now()),
          v_comm.id, v_comm.job_id, v_matched)
  returning * into v_row;

  return jsonb_build_object('inbound_id', v_row.id, 'already_recorded', false,
                            'matched_by', v_matched, 'communication_id', v_comm.id);
end
$$;

revoke all on function app.inbound_email_record(jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The one door PostgREST can see.
--
-- app.* is not exposed over the API, so the webhook needs a public wrapper.
-- It is granted to service_role ONLY: this is the single write path into
-- inbound_emails, and a signed-in person must not be able to invent received
-- mail. anon and authenticated are revoked explicitly rather than left to the
-- default, because the default has changed between Postgres versions.
-- -----------------------------------------------------------------------------

create function public.inbound_email_record(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.inbound_email_record(p);
end
$$;

revoke all on function public.inbound_email_record(jsonb) from public, anon, authenticated;
grant execute on function public.inbound_email_record(jsonb) to service_role;
