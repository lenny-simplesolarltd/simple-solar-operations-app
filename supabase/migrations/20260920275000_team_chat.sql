-- =============================================================================
-- Internal team chat.
--
-- Deliberately NOT built on public.communications / public.outbox. Those exist
-- to send something OUTSIDE the company, where the hard problems are consent,
-- allow-lists, retries and proving what left the building. A message from
-- Tanya to Ben never leaves, has no recipient to protect, and must feel
-- instant. Routing it through a five-minute claim loop would be absurd.
--
-- So chat is its own small spine: conversations, members, messages, reactions.
-- What it DOES share is everything that makes the rest of the system
-- trustworthy - people, roles, permissions, commands, RLS, audit, and the
-- evidence/file store for attachments.
--
-- MEMBERSHIP IS THE WHOLE SECURITY MODEL
--
-- Every policy below reduces to one question: is the actor an active member of
-- this conversation? Not "are they office class", not "do they hold a role" -
-- membership. An Admin is not a member of a conversation they were not added
-- to, and cannot read it. That is the point of a private message.
--
-- The one deliberate exception is communications.chat.admin, which may LIST
-- conversations and their members for administration and retention, and still
-- may NOT read message bodies. Being able to see that a conversation exists is
-- a different power from reading it.
--
-- ON DELETION
--
-- Messages are never removed. Deleting blanks the body and stamps deleted_at,
-- so the conversation keeps its shape and the audit trail keeps its meaning.
-- Editing keeps the original in edit_of_body on the first edit only, which is
-- what "edit history" needs to be honest without becoming a second archive.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissions
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('communications.chat.use',
   'Take part in internal team chat: start conversations, send messages, react.'),
  ('communications.chat.admin',
   'List every conversation and its members for administration and retention. Does NOT grant reading message bodies.')
on conflict (code) do nothing;

-- Everyone who works in the system talks to colleagues. Installers and
-- scaffolders included: being asked "can you check SS-ABCD-1234" is the whole
-- point. ReadOnly is excluded - it is an observer account.
insert into public.role_permissions (role_code, permission_code)
select r.role_code, 'communications.chat.use'
from (values ('Admin'), ('Manager'), ('Director'), ('Office'), ('VariationApprover'),
             ('Surveyor'), ('Finance'), ('Store'), ('Installer'), ('Scaffolder')) as r (role_code)
union all
select 'Admin', 'communications.chat.admin'
on conflict (role_code, permission_code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

create table public.chat_conversations (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('Direct', 'Group')),
  -- Null for a Direct conversation: it is named by who is in it.
  title        text check (title is null or btrim(title) <> ''),
  -- A conversation may be about a job without being part of that job's record.
  job_id       uuid references public.jobs (id) on delete set null,
  -- Two people have exactly one Direct conversation. Held as the sorted pair of
  -- person ids so the uniqueness is enforced by the database, not by hoping.
  direct_key   text unique,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.people (id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.people (id),
  last_message_at timestamptz,
  archived_at  timestamptz,
  version      integer not null default 1 check (version >= 1),
  constraint chat_direct_has_key
    check ((kind = 'Direct') = (direct_key is not null)),
  constraint chat_direct_has_no_title
    check (kind <> 'Direct' or title is null)
);
comment on table public.chat_conversations is
  'Internal conversations between staff. Never leaves the company; no outbox, no recipients.';
create index chat_conversations_job_idx on public.chat_conversations (job_id) where job_id is not null;
create index chat_conversations_recent_idx on public.chat_conversations (last_message_at desc nulls last);

create table public.chat_members (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  person_id       uuid not null references public.people (id) on delete restrict,
  -- Leaving sets active=false rather than deleting: the messages they sent
  -- stay attributable, and rejoining is a new row state, not a new identity.
  active          boolean not null default true,
  -- Drives unread counts. Never decreases.
  last_read_at    timestamptz,
  created_by      uuid references public.people (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.people (id),
  version         integer not null default 1 check (version >= 1),
  unique (conversation_id, person_id)
);
create index chat_members_person_idx on public.chat_members (person_id) where active;

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  author_person_id uuid not null references public.people (id) on delete restrict,
  body            text not null,
  -- Threaded replies inside a conversation. One level is all anybody uses.
  reply_to_id     uuid references public.chat_messages (id) on delete set null,
  -- Job references found in the body, resolved server-side at send time. The
  -- text is never rewritten; this is what the UI links.
  mentioned_job_ids uuid[] not null default '{}',
  -- People named with @. Drives notification, so it is resolved server-side
  -- from person ids the sender may actually see, never parsed in the browser.
  mentioned_person_ids uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  created_by      uuid references public.people (id),
  edited_at       timestamptz,
  -- The body as first sent, kept only on the first edit. "Edited" must mean
  -- something, without turning every typo into a permanent second copy.
  original_body   text,
  deleted_at      timestamptz,
  deleted_by      uuid references public.people (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.people (id),
  version         integer not null default 1 check (version >= 1),
  constraint chat_message_body_present
    check (deleted_at is not null or btrim(body) <> '')
);
comment on column public.chat_messages.body is
  'Plain text. Nothing in this system renders user-authored HTML; the client escapes and linkifies.';
create index chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at desc, id);
create index chat_messages_mentions_idx on public.chat_messages using gin (mentioned_person_ids);

create table public.chat_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  person_id  uuid not null references public.people (id) on delete restrict,
  -- A short grapheme, not arbitrary text: this is a reaction, not a second
  -- message with no audit trail.
  emoji      text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (message_id, person_id, emoji)
);

-- Attachments reuse the evidence store rather than inventing a second one.
-- A chat attachment is readable by the conversation's members; it does NOT
-- become readable by everyone who can see the job it came from, and a private
-- job document does not become globally visible by being posted in a chat.
alter table public.evidence
  add column chat_message_id uuid references public.chat_messages (id) on delete set null;
create index evidence_chat_message_idx on public.evidence (chat_message_id)
  where chat_message_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Stamping and audit
--
-- Messages and reactions are NOT row-audited. A busy conversation would drown
-- the audit log, and the messages are themselves the record. Conversations and
-- membership ARE audited: who could see what, and from when, is exactly the
-- kind of question an audit log exists to answer.
-- -----------------------------------------------------------------------------

create trigger chat_conversations_touch before insert or update on public.chat_conversations
  for each row execute function app.touch_row();
create trigger chat_members_touch before insert or update on public.chat_members
  for each row execute function app.touch_row();
create trigger chat_messages_touch before insert or update on public.chat_messages
  for each row execute function app.touch_row();

create trigger chat_conversations_audit after insert or update or delete on public.chat_conversations
  for each row execute function app.audit_row_change();
create trigger chat_members_audit after insert or update or delete on public.chat_members
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- 4. Membership predicates - the single source of truth for who may see what
-- -----------------------------------------------------------------------------

create function app.chat_is_member(p_conversation uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_members m
    where m.conversation_id = p_conversation
      and m.person_id = app.current_person_id()
      and m.active
  )
$$;

/** May list conversations and members, never message bodies. */
create function app.chat_is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.has_permission('communications.chat.admin') $$;

-- The policies below call these, so the signed-in role must be able to execute
-- them. They are security definer and take no caller-supplied identity: both
-- resolve the actor themselves, so granting execute grants nothing beyond
-- answering "may I see this conversation" about yourself.
grant execute on function app.chat_is_member(uuid), app.chat_is_admin()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. RLS - fail closed, membership only
-- -----------------------------------------------------------------------------

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reactions enable row level security;

revoke all on public.chat_conversations from anon, authenticated;
revoke all on public.chat_members from anon, authenticated;
revoke all on public.chat_messages from anon, authenticated;
revoke all on public.chat_reactions from anon, authenticated;
grant select on public.chat_conversations to authenticated;
grant select on public.chat_members to authenticated;
grant select on public.chat_messages to authenticated;
grant select on public.chat_reactions to authenticated;

create policy chat_conversations_select on public.chat_conversations
  for select to authenticated
  using (app.chat_is_member(id) or app.chat_is_admin());

create policy chat_members_select on public.chat_members
  for select to authenticated
  using (app.chat_is_member(conversation_id) or app.chat_is_admin());

-- No admin escape hatch here, deliberately. Listing a conversation is
-- administration; reading it is surveillance.
create policy chat_messages_select on public.chat_messages
  for select to authenticated
  using (app.chat_is_member(conversation_id));

create policy chat_reactions_select on public.chat_reactions
  for select to authenticated
  using (exists (
    select 1 from public.chat_messages m
    where m.id = message_id and app.chat_is_member(m.conversation_id)
  ));

-- -----------------------------------------------------------------------------
-- 6. Helpers
-- -----------------------------------------------------------------------------

/** The stable identity of a two-person conversation, whoever starts it. */
create function app.chat_direct_key(p_a uuid, p_b uuid)
returns text
language sql immutable
set search_path = ''
as $$
  select case when p_a < p_b then p_a::text || ':' || p_b::text
              else p_b::text || ':' || p_a::text end
$$;

/**
 * Job references in a message body, resolved to ids the AUTHOR may see.
 *
 * A reference to a job someone cannot open resolves to nothing, so chat never
 * becomes a way to discover that SS-ABCD-1234 exists. The body is never
 * rewritten - this only tells the UI what is safe to linkify.
 */
create function app.chat_job_refs(p_body text, p_actor jsonb)
returns uuid[]
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ref text;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  for v_ref in
    select distinct upper(m[1])
    -- Case-insensitive: people type ss-abcd-1234. job_ref is stored upper.
    from regexp_matches(coalesce(p_body, ''), '(SS-[A-Za-z]{4}-[0-9]{4})', 'gi') m
  loop
    select j.id into v_id from public.jobs j where j.job_ref = v_ref;
    if v_id is not null and app.can_read_job(p_actor, v_id) then
      v_ids := array_append(v_ids, v_id);
    end if;
  end loop;
  return v_ids;
end
$$;

-- -----------------------------------------------------------------------------
-- 7. Commands
-- -----------------------------------------------------------------------------

/** Open (or find) a conversation. Direct conversations are never duplicated. */
create function app.cmd_chat_start(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_people uuid[];
  v_kind text := coalesce(p_request -> 'payload' ->> 'kind', 'Direct');
  v_title text := nullif(btrim(coalesce(p_request -> 'payload' ->> 'title', '')), '');
  v_job uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'job_id');
  v_key text;
  v_conv public.chat_conversations;
  v_person uuid;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  if v_kind not in ('Direct', 'Group') then
    perform app.fail('CHAT_REFUSED: kind must be Direct or Group');
  end if;

  select coalesce(array_agg(distinct t.val::uuid), '{}') into v_people
  from jsonb_array_elements_text(coalesce(p_request -> 'payload' -> 'person_ids', '[]'::jsonb)) t(val);
  -- The author is always a member; asking to be excluded is a bug, not a wish.
  if not (v_me = any (v_people)) then
    v_people := array_append(v_people, v_me);
  end if;

  -- Everyone named must be a real, active person who is allowed to chat.
  -- Without this, a conversation could be opened "with" a deactivated account
  -- and quietly accumulate messages nobody will ever read.
  foreach v_person in array v_people loop
    if not exists (select 1 from public.people p where p.id = v_person and p.active) then
      perform app.fail('CHAT_MEMBER_INVALID', jsonb_build_object('person_id', v_person));
    end if;
    if not exists (
      select 1 from public.person_roles pr
      join public.role_permissions rp on rp.role_code = pr.role_code
      where pr.person_id = v_person and pr.active
        and rp.permission_code = 'communications.chat.use'
    ) then
      perform app.fail('CHAT_MEMBER_CANNOT_CHAT', jsonb_build_object('person_id', v_person));
    end if;
  end loop;

  if v_kind = 'Direct' then
    if array_length(v_people, 1) <> 2 then
      perform app.fail('CHAT_REFUSED: a direct conversation is exactly two people');
    end if;
    v_key := app.chat_direct_key(v_people[1], v_people[2]);
    select * into v_conv from public.chat_conversations c where c.direct_key = v_key;
    if found then
      -- Re-opening an existing thread, not starting a second one.
      update public.chat_members set active = true
      where conversation_id = v_conv.id and not active;
      return jsonb_build_object('conversation_id', v_conv.id, 'created', false,
                                'kind', v_conv.kind, 'version', v_conv.version);
    end if;
  elsif array_length(v_people, 1) < 2 then
    perform app.fail('CHAT_REFUSED: a group needs at least two people');
  end if;

  insert into public.chat_conversations (kind, title, job_id, direct_key, created_by)
  values (v_kind, case when v_kind = 'Direct' then null else v_title end, v_job, v_key, v_me)
  returning * into v_conv;

  foreach v_person in array v_people loop
    insert into public.chat_members (conversation_id, person_id)
    values (v_conv.id, v_person)
    on conflict (conversation_id, person_id) do nothing;
  end loop;

  return jsonb_build_object('conversation_id', v_conv.id, 'created', true,
                            'kind', v_conv.kind, 'members', array_length(v_people, 1),
                            'version', v_conv.version);
end
$$;

/** Post a message. Membership is checked here, not inferred from a role. */
create function app.cmd_chat_send(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_conv uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'conversation_id');
  v_body text := btrim(coalesce(p_request -> 'payload' ->> 'body', ''));
  v_reply uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'reply_to_id');
  v_mentions uuid[];
  v_msg public.chat_messages;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  if v_conv is null then
    perform app.fail('CHAT_REFUSED: conversation_id is required');
  end if;
  if v_body = '' then
    perform app.fail('CHAT_REFUSED: a message needs something in it');
  end if;
  if char_length(v_body) > 8000 then
    perform app.fail('CHAT_REFUSED: that message is too long');
  end if;
  if not exists (
    select 1 from public.chat_members m
    where m.conversation_id = v_conv and m.person_id = v_me and m.active
  ) then
    perform app.fail('CHAT_NOT_A_MEMBER');
  end if;
  -- A reply must be to a message in the SAME conversation, or a reply becomes
  -- a way to point at a thread you cannot see.
  if v_reply is not null and not exists (
    select 1 from public.chat_messages m where m.id = v_reply and m.conversation_id = v_conv
  ) then
    perform app.fail('CHAT_REPLY_NOT_IN_CONVERSATION');
  end if;

  -- Mentions are intersected with actual members: @-ing someone who is not in
  -- the conversation must not notify them about a room they cannot open.
  select coalesce(array_agg(distinct m.person_id), '{}') into v_mentions
  from public.chat_members m
  where m.conversation_id = v_conv and m.active
    and m.person_id::text = any (
      array(select jsonb_array_elements_text(coalesce(p_request -> 'payload' -> 'mention_person_ids', '[]'::jsonb)))
    );

  insert into public.chat_messages (conversation_id, author_person_id, body, reply_to_id,
                                    mentioned_job_ids, mentioned_person_ids)
  values (v_conv, v_me, v_body, v_reply, app.chat_job_refs(v_body, p_actor), v_mentions)
  returning * into v_msg;

  update public.chat_conversations set last_message_at = v_msg.created_at where id = v_conv;
  -- Your own message is read by definition.
  update public.chat_members set last_read_at = v_msg.created_at
  where conversation_id = v_conv and person_id = v_me;

  return jsonb_build_object('message_id', v_msg.id, 'conversation_id', v_conv,
                            'created_at', v_msg.created_at,
                            'job_ids', to_jsonb(v_msg.mentioned_job_ids),
                            'mentioned', to_jsonb(v_msg.mentioned_person_ids));
end
$$;

/** Edit your own message. Somebody else's is never yours to change. */
create function app.cmd_chat_edit(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_id uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'message_id');
  v_body text := btrim(coalesce(p_request -> 'payload' ->> 'body', ''));
  v_msg public.chat_messages;
  v_after public.chat_messages;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  select * into v_msg from public.chat_messages where id = v_id for update;
  if not found then perform app.fail('CHAT_MESSAGE_NOT_FOUND'); end if;
  if v_msg.author_person_id <> v_me then perform app.fail('CHAT_NOT_YOUR_MESSAGE'); end if;
  if v_msg.deleted_at is not null then perform app.fail('CHAT_MESSAGE_DELETED'); end if;
  if v_body = '' then perform app.fail('CHAT_REFUSED: a message needs something in it'); end if;

  update public.chat_messages
  set body = v_body,
      edited_at = now(),
      -- Only the first edit records what was originally said.
      original_body = coalesce(original_body, v_msg.body),
      mentioned_job_ids = app.chat_job_refs(v_body, p_actor)
  where id = v_id
  returning * into v_after;

  return jsonb_build_object('message_id', v_after.id, 'edited_at', v_after.edited_at,
                            'job_ids', to_jsonb(v_after.mentioned_job_ids));
end
$$;

/**
 * Delete a message. The row stays: the body is blanked and stamped, so the
 * conversation keeps its shape and a reply to it still makes sense.
 */
create function app.cmd_chat_delete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_id uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'message_id');
  v_msg public.chat_messages;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  select * into v_msg from public.chat_messages where id = v_id for update;
  if not found then perform app.fail('CHAT_MESSAGE_NOT_FOUND'); end if;
  -- Only the author, or a chat administrator acting for retention.
  if v_msg.author_person_id <> v_me and not app.has_permission('communications.chat.admin') then
    perform app.fail('CHAT_NOT_YOUR_MESSAGE');
  end if;
  if v_msg.deleted_at is not null then
    return jsonb_build_object('message_id', v_id, 'already_deleted', true);
  end if;

  update public.chat_messages
  set body = '', deleted_at = now(), deleted_by = v_me,
      mentioned_job_ids = '{}', mentioned_person_ids = '{}'
  where id = v_id;
  -- Deleting a message IS worth auditing, unlike sending one.
  perform app.audit('ChatMessages', v_id::text, 'ChatMessageDeleted',
                    to_jsonb(v_msg), null,
                    nullif(btrim(coalesce(p_request -> 'payload' ->> 'reason', '')), ''));
  return jsonb_build_object('message_id', v_id, 'deleted', true);
end
$$;

/** Add or remove one of your own reactions. */
create function app.cmd_chat_react(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_id uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'message_id');
  v_emoji text := btrim(coalesce(p_request -> 'payload' ->> 'emoji', ''));
  v_on boolean := coalesce((p_request -> 'payload' ->> 'on')::boolean, true);
  v_conv uuid;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  select conversation_id into v_conv from public.chat_messages where id = v_id;
  if v_conv is null then perform app.fail('CHAT_MESSAGE_NOT_FOUND'); end if;
  if not exists (
    select 1 from public.chat_members m
    where m.conversation_id = v_conv and m.person_id = v_me and m.active
  ) then
    perform app.fail('CHAT_NOT_A_MEMBER');
  end if;
  if v_emoji = '' or char_length(v_emoji) > 8 then
    perform app.fail('CHAT_REFUSED: that is not a reaction');
  end if;

  if v_on then
    insert into public.chat_reactions (message_id, person_id, emoji)
    values (v_id, v_me, v_emoji)
    on conflict (message_id, person_id, emoji) do nothing;
  else
    delete from public.chat_reactions
    where message_id = v_id and person_id = v_me and emoji = v_emoji;
  end if;
  return jsonb_build_object('message_id', v_id, 'emoji', v_emoji, 'on', v_on);
end
$$;

/** Mark a conversation read up to now. Never moves backwards. */
create function app.cmd_chat_mark_read(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_conv uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'conversation_id');
  v_at timestamptz := least(coalesce((p_request -> 'payload' ->> 'at')::timestamptz, now()), now());
  v_row public.chat_members;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  update public.chat_members
  set last_read_at = greatest(coalesce(last_read_at, 'epoch'::timestamptz), v_at)
  where conversation_id = v_conv and person_id = v_me and active
  returning * into v_row;
  if not found then perform app.fail('CHAT_NOT_A_MEMBER'); end if;
  return jsonb_build_object('conversation_id', v_conv, 'last_read_at', v_row.last_read_at);
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Reads
-- -----------------------------------------------------------------------------

create function app.read_chat_conversations(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  return jsonb_build_object(
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_id', c.id, 'kind', c.kind, 'title', c.title, 'job_id', c.job_id,
        'last_message_at', c.last_message_at, 'version', c.version,
        'unread', (select count(*) from public.chat_messages m
                   where m.conversation_id = c.id
                     and m.author_person_id <> v_me
                     and m.deleted_at is null
                     and (mem.last_read_at is null or m.created_at > mem.last_read_at)),
        'last_message', (select jsonb_build_object('body', left(lm.body, 140),
                                                   'author_person_id', lm.author_person_id,
                                                   'created_at', lm.created_at,
                                                   'deleted', lm.deleted_at is not null)
                         from public.chat_messages lm
                         where lm.conversation_id = c.id
                         order by lm.created_at desc, lm.id limit 1),
        'members', (select jsonb_agg(jsonb_build_object('person_id', p.id, 'display_name', p.display_name)
                                     order by p.display_name)
                    from public.chat_members mm
                    join public.people p on p.id = mm.person_id
                    where mm.conversation_id = c.id and mm.active))
        order by c.last_message_at desc nulls last, c.created_at desc)
      from public.chat_conversations c
      join public.chat_members mem
        on mem.conversation_id = c.id and mem.person_id = v_me and mem.active
      where c.archived_at is null), '[]'::jsonb),
    'retrieved_at', now());
end
$$;

create function app.read_chat_messages(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_conv uuid := app.ref(p_request, 'conversation_id');
  v_limit int := case when coalesce((p_request ->> 'limit')::int, 0) > 0
                      then least((p_request ->> 'limit')::int, 200) else 60 end;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  if v_conv is null then perform app.fail('R1A_INVALID_FIELDS'); end if;
  -- Membership, not a role. An administrator reading this read gets nothing.
  if not exists (
    select 1 from public.chat_members m
    where m.conversation_id = v_conv and m.person_id = v_me and m.active
  ) then
    perform app.fail('CHAT_NOT_A_MEMBER');
  end if;

  return jsonb_build_object(
    'conversation_id', v_conv,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'message_id', m.id, 'author_person_id', m.author_person_id,
        'author_name', p.display_name,
        'body', case when m.deleted_at is null then m.body else null end,
        'deleted', m.deleted_at is not null,
        'reply_to_id', m.reply_to_id,
        'job_ids', to_jsonb(m.mentioned_job_ids),
        'mentioned_person_ids', to_jsonb(m.mentioned_person_ids),
        'created_at', m.created_at, 'edited_at', m.edited_at,
        'reactions', (select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'person_id', r.person_id))
                      from public.chat_reactions r where r.message_id = m.id),
        'attachments', (select jsonb_agg(jsonb_build_object('evidence_id', e.id,
                                                            'name', coalesce(e.display_name, e.filename)))
                        from public.evidence e
                        where e.chat_message_id = m.id and e.purged_at is null))
        order by m.created_at, m.id)
      from (select * from public.chat_messages mm
            where mm.conversation_id = v_conv
            order by mm.created_at desc, mm.id desc limit v_limit) m
      join public.people p on p.id = m.author_person_id), '[]'::jsonb),
    'retrieved_at', now());
end
$$;

-- -----------------------------------------------------------------------------
-- 9. Registration
-- -----------------------------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('CHAT_START', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'chat', 'Open or reopen a conversation. Direct conversations are unique per pair by database constraint. Fine authority: communications.chat.use.'),
  ('CHAT_SEND', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'chat', 'Post a message. Membership is required; job references and mentions are resolved server-side against what the author may see.'),
  ('CHAT_EDIT', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'chat', 'Edit your own message. The first edit keeps the original body.'),
  ('CHAT_DELETE', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'chat', 'Blank your own message, or any message with communications.chat.admin. The row stays and the deletion is audited.'),
  ('CHAT_REACT', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'chat', 'Add or remove your own reaction. Not audited: reactions are not business records.'),
  ('CHAT_MARK_READ', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'chat', 'Move your own read marker forward. Never backwards.');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('CHAT_CONVERSATIONS', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   '[]', 'chat', 'Your conversations, newest first, with unread counts.'),
  ('CHAT_MESSAGES', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   '[]', 'chat', 'One conversation you are a member of. Membership is checked in the handler, not by role.');

-- -----------------------------------------------------------------------------
-- 10. Realtime
--
-- Chat must feel immediate, so these two tables are published for Realtime.
-- Subscribers still read through RLS: a client may only receive rows for a
-- conversation it is a member of.
-- -----------------------------------------------------------------------------

-- Guarded: the publication is created by the Supabase platform, and is absent
-- on a bare Postgres (the pglite test harness). Its absence must not stop the
-- schema being created - it only means nothing is streaming there.
-- REPLICA IDENTITY FULL is not optional here. Realtime evaluates this table's
-- RLS policy against the replicated row to decide who may receive the event,
-- and with the default identity only the primary key is replicated - so the
-- policy cannot be evaluated, every event is withheld, and the subscription
-- fails with CHANNEL_ERROR while looking perfectly healthy from the client.
alter table public.chat_messages replica identity full;
alter table public.chat_reactions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chat_messages;
    alter publication supabase_realtime add table public.chat_reactions;
  end if;
end
$$;
