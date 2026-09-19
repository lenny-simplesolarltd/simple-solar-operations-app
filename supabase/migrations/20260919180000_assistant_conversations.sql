-- =============================================================================
-- SimpleBot conversations (BD-09): persistent, owner-only chat history.
--
-- Conversations are private working notes of ONE staff member. They are not
-- operational records and never the source of truth for jobs, tasks or any
-- other live state: the assistant re-reads those through its tools.
--
-- Ownership: person_id is always the caller (app.current_person_id(), derived
-- from auth.uid()). No role - not Admin, not Manager - can read another
-- person's conversations; cross-user access would need an explicit future
-- policy. Nothing here grants or implies any operational permission.
--
-- Messages are append-only and written ONLY through assistant_append_turn(),
-- which assigns the order atomically and is idempotent per run.
-- Chat content is deliberately not copied into audit_events.
-- =============================================================================

create table public.assistant_conversations (
  id                     uuid primary key default gen_random_uuid(),
  person_id              uuid not null default app.current_person_id() references public.people (id),
  title                  text check (title is null or char_length(title) between 1 and 120),
  title_source           text not null default 'none' check (title_source in ('none', 'auto', 'manual')),
  -- Carried-in handoff summary (conversational memory, never authoritative).
  summary                text check (summary is null or char_length(summary) <= 8000),
  summary_updated_at     timestamptz,
  source_conversation_id uuid references public.assistant_conversations (id) on delete set null,
  -- Optional subject. NOT an authorization mechanism: reading the job still
  -- goes through the job's own RLS every time.
  job_id                 uuid references public.jobs (id) on delete set null,
  message_count          integer not null default 0 check (message_count >= 0),
  estimated_tokens       integer not null default 0 check (estimated_tokens >= 0),
  last_prompt_tokens     integer,
  last_provider          text,
  last_model             text,
  last_message_at        timestamptz,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  created_by             uuid references public.people (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.people (id),
  version                integer not null default 1
);

comment on table public.assistant_conversations is
  'SimpleBot conversations. Owner-only (RLS). Conversational memory, never the source of truth for operational state.';

create index assistant_conversations_owner_recent
  on public.assistant_conversations (person_id, archived_at, last_message_at desc nulls last, created_at desc);
create index assistant_conversations_owner_job
  on public.assistant_conversations (person_id, job_id)
  where job_id is not null;

create trigger assistant_conversations_touch
  before insert or update on public.assistant_conversations
  for each row execute function app.touch_row();

create table public.assistant_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.assistant_conversations (id) on delete cascade,
  seq              integer not null check (seq > 0),
  -- One staff turn; the user message of a run is unique, which makes appends idempotent.
  run_id           uuid not null,
  role             text not null check (role in ('user', 'assistant', 'tool', 'event')),
  -- The provider-neutral transcript message, exactly as the model is sent it.
  content          jsonb not null,
  -- What the drawer shows (tool labels and cards). Never sent to the model.
  ui               jsonb,
  -- User messages: the page hint when it was sent. History, not current context.
  page_context     jsonb,
  status           text not null default 'complete' check (status in ('complete', 'stopped')),
  provider         text,
  model            text,
  estimated_tokens integer not null default 0 check (estimated_tokens >= 0),
  created_at       timestamptz not null default now(),
  unique (conversation_id, seq)
);

create unique index assistant_messages_one_user_message_per_run
  on public.assistant_messages (conversation_id, run_id)
  where role = 'user';

comment on table public.assistant_messages is
  'SimpleBot messages. Append-only; written only by assistant_append_turn(). Readable by the conversation owner only.';

-- Whether the caller owns a conversation. SECURITY DEFINER so policies on
-- assistant_conversations can ask it without querying their own table under
-- RLS (which Postgres rejects as recursion). Identity comes from auth.uid().
create function app.owns_assistant_conversation(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.assistant_conversations c
    where c.id = p_conversation_id
      and c.person_id = app.current_person_id()
  )
$$;

-- -----------------------------------------------------------------------------
-- Append one completed (or stopped) turn.
--
-- Creates the conversation on first use (lazy creation: pressing New writes
-- nothing). The caller must own the conversation; an id that belongs to
-- someone else is reported as NOT_FOUND. Re-sending the same run is a no-op.
-- Title and job are only filled when still empty, and a manual title is never
-- replaced.
-- -----------------------------------------------------------------------------
create function public.assistant_append_turn(
  p_conversation_id uuid,
  p_run_id          uuid,
  p_messages        jsonb,
  p_provider        text default null,
  p_model           text default null,
  p_title           text default null,
  p_job_id          uuid default null,
  p_prompt_tokens   integer default null
)
returns table (
  conversation_id  uuid,
  appended         boolean,
  message_count    integer,
  estimated_tokens integer,
  title            text,
  version          integer
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_person uuid := app.current_person_id();
  v_conv   public.assistant_conversations%rowtype;
  v_seq    integer;
  v_count  integer;
  v_tokens integer := 0;
  v_msg    jsonb;
begin
  if v_person is null or not app.is_active_actor() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_conversation_id is null or p_run_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_messages) is distinct from 'array'
     or jsonb_array_length(p_messages) not between 1 and 40
     or p_messages -> 0 ->> 'role' is distinct from 'user' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = 'p_messages must be 1-40 messages starting with the user message';
  end if;

  insert into public.assistant_conversations (id, person_id)
  values (p_conversation_id, v_person)
  on conflict (id) do nothing;

  select c.* into v_conv
  from public.assistant_conversations c
  where c.id = p_conversation_id and c.person_id = v_person
  for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.assistant_messages m
    where m.conversation_id = p_conversation_id
      and m.run_id = p_run_id
      and m.role = 'user'
  ) then
    return query select v_conv.id, false, v_conv.message_count,
      v_conv.estimated_tokens, v_conv.title, v_conv.version;
    return;
  end if;

  select coalesce(max(m.seq), 0) into v_seq
  from public.assistant_messages m
  where m.conversation_id = p_conversation_id;

  for v_msg in select value from jsonb_array_elements(p_messages) loop
    if v_msg ->> 'role' not in ('user', 'assistant', 'tool', 'event')
       or jsonb_typeof(v_msg -> 'content') is distinct from 'object' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
    v_seq := v_seq + 1;
    insert into public.assistant_messages (
      conversation_id, seq, run_id, role, content, ui, page_context,
      status, provider, model, estimated_tokens
    ) values (
      p_conversation_id, v_seq, p_run_id, v_msg ->> 'role', v_msg -> 'content',
      nullif(v_msg -> 'ui', 'null'::jsonb),
      nullif(v_msg -> 'page_context', 'null'::jsonb),
      coalesce(v_msg ->> 'status', 'complete'),
      p_provider, p_model,
      greatest(coalesce((v_msg ->> 'estimated_tokens')::integer, 0), 0)
    );
    v_tokens := v_tokens + greatest(coalesce((v_msg ->> 'estimated_tokens')::integer, 0), 0);
  end loop;
  v_count := jsonb_array_length(p_messages);

  update public.assistant_conversations c set
    message_count      = c.message_count + v_count,
    estimated_tokens   = c.estimated_tokens + v_tokens,
    last_message_at    = now(),
    last_provider      = coalesce(p_provider, c.last_provider),
    last_model         = coalesce(p_model, c.last_model),
    last_prompt_tokens = coalesce(p_prompt_tokens, c.last_prompt_tokens),
    archived_at        = null,
    title              = case when c.title is null and nullif(btrim(p_title), '') is not null
                              then left(btrim(p_title), 120) else c.title end,
    title_source       = case when c.title is null and nullif(btrim(p_title), '') is not null
                              then 'auto' else c.title_source end,
    job_id             = coalesce(c.job_id, p_job_id)
  where c.id = p_conversation_id
  returning c.* into v_conv;

  return query select v_conv.id, true, v_conv.message_count,
    v_conv.estimated_tokens, v_conv.title, v_conv.version;
end
$$;

comment on function public.assistant_append_turn(uuid, uuid, jsonb, text, text, text, uuid, integer) is
  'Appends one SimpleBot turn to a conversation the caller owns (creating it on first use). Idempotent per run.';

-- -----------------------------------------------------------------------------
-- Grants and RLS: owner only, and only while an active actor.
-- -----------------------------------------------------------------------------

revoke all on public.assistant_conversations, public.assistant_messages from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_conversations to authenticated;
-- No direct insert/update/delete on messages: appends go through the function,
-- deletes happen only by deleting the conversation.
grant select on public.assistant_messages to authenticated;
grant all on public.assistant_conversations, public.assistant_messages to service_role;

revoke execute on function app.owns_assistant_conversation(uuid) from public, anon;
grant execute on function app.owns_assistant_conversation(uuid) to authenticated, service_role;
revoke execute on function public.assistant_append_turn(uuid, uuid, jsonb, text, text, text, uuid, integer) from public, anon;
grant execute on function public.assistant_append_turn(uuid, uuid, jsonb, text, text, text, uuid, integer) to authenticated, service_role;

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages      enable row level security;

create policy assistant_conversations_owner_select on public.assistant_conversations
  for select to authenticated
  using (person_id = (select app.current_person_id()) and (select app.is_active_actor()));

create policy assistant_conversations_owner_insert on public.assistant_conversations
  for insert to authenticated
  with check (
    person_id = (select app.current_person_id())
    and (select app.is_active_actor())
    -- A handoff may only point at one of your own conversations.
    and (
      source_conversation_id is null
      or app.owns_assistant_conversation(source_conversation_id)
    )
  );

create policy assistant_conversations_owner_update on public.assistant_conversations
  for update to authenticated
  using (person_id = (select app.current_person_id()) and (select app.is_active_actor()))
  with check (person_id = (select app.current_person_id()) and (select app.is_active_actor()));

create policy assistant_conversations_owner_delete on public.assistant_conversations
  for delete to authenticated
  using (person_id = (select app.current_person_id()) and (select app.is_active_actor()));

create policy assistant_messages_owner_select on public.assistant_messages
  for select to authenticated
  using (
    (select app.is_active_actor())
    and app.owns_assistant_conversation(conversation_id)
  );
