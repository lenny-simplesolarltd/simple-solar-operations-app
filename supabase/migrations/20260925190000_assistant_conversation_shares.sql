-- =============================================================================
-- Sharing a SimpleBot conversation by link.
--
-- A conversation is owner-only: assistant_conversations and assistant_messages
-- are readable by the person whose conversation it is and nobody else. That is
-- right by default and wrong the moment somebody needs a colleague to look at
-- what SimpleBot said about a job.
--
-- A share is an explicit, revocable grant on ONE conversation, created by its
-- owner. The link carries the share id and nothing else: opening it still
-- requires being signed in as a member of staff, so a link forwarded outside
-- the company opens nothing. This is the same shape as a recipient link for a
-- form, minus the anonymity - there is no case for a SimpleBot transcript being
-- readable by the public, and plenty against it, because these conversations
-- quote job and customer data.
--
-- Reading a shared conversation goes through one SECURITY DEFINER function
-- rather than by relaxing the owner policy: the grant is "this conversation,
-- through this live share", not "this person may now read conversations".
--
-- Tool results are not returned. A tool result can hold rows the reply never
-- quoted, and the whole point of a share is that somebody else reads it; the
-- function returns which tool ran and leaves its contents behind the
-- permissions that decided who could see them.
--
-- ROLLBACK:
--   begin;
--   drop function if exists public.assistant_shared_conversation(uuid);
--   drop function if exists public.assistant_share_conversation(uuid);
--   drop function if exists public.assistant_revoke_conversation_share(uuid);
--   drop table if exists public.assistant_conversation_shares;
--   commit;
-- =============================================================================

create table public.assistant_conversation_shares (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  created_by      uuid not null references public.people (id) on delete restrict,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_by      uuid references public.people (id)
);

comment on table public.assistant_conversation_shares is
  'One revocable grant to read one SimpleBot conversation. The link carries this row''s id; opening it still requires a signed-in staff session.';

create index assistant_conversation_shares_conversation_idx
  on public.assistant_conversation_shares (conversation_id)
  where revoked_at is null;

alter table public.assistant_conversation_shares enable row level security;

-- The owner manages their own shares. Readers never touch this table directly:
-- they go through assistant_shared_conversation, which checks the share itself.
create policy assistant_conversation_shares_owner on public.assistant_conversation_shares
  for all to authenticated
  using (
    exists (
      select 1 from public.assistant_conversations c
      join public.people p on p.id = c.person_id
      where c.id = conversation_id and p.auth_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.assistant_conversations c
      join public.people p on p.id = c.person_id
      where c.id = conversation_id and p.auth_user_id = (select auth.uid())
    )
  );

grant select, insert, update on public.assistant_conversation_shares to authenticated;
grant all on public.assistant_conversation_shares to service_role;

/**
 * Creates (or reuses) a live share for a conversation the caller owns.
 *
 * Reused rather than duplicated: a second "create link" for the same
 * conversation should hand back the same link, or revoking one would leave
 * others quietly working.
 */
create function public.assistant_share_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := app.current_person_id();
  v_owner uuid;
  v_share public.assistant_conversation_shares;
begin
  select c.person_id into v_owner
  from public.assistant_conversations c where c.id = p_conversation_id;
  if v_owner is null or v_owner <> v_me then
    perform app.fail('ASSISTANT_CONVERSATION_NOT_FOUND');
  end if;

  select * into v_share from public.assistant_conversation_shares
  where conversation_id = p_conversation_id and revoked_at is null
  order by created_at limit 1;

  if not found then
    insert into public.assistant_conversation_shares (conversation_id, created_by)
    values (p_conversation_id, v_me)
    returning * into v_share;
    perform app.audit('assistant_conversation', p_conversation_id::text,
      'ASSISTANT_CONVERSATION_SHARE', null,
      jsonb_build_object('share_id', v_share.id));
  end if;

  return jsonb_build_object('share_id', v_share.id, 'created_at', v_share.created_at);
end
$$;

/** Revokes every live share on a conversation the caller owns. */
create function public.assistant_revoke_conversation_share(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := app.current_person_id();
  v_owner uuid;
  v_count integer;
begin
  select c.person_id into v_owner
  from public.assistant_conversations c where c.id = p_conversation_id;
  if v_owner is null or v_owner <> v_me then
    perform app.fail('ASSISTANT_CONVERSATION_NOT_FOUND');
  end if;

  update public.assistant_conversation_shares
  set revoked_at = now(), revoked_by = v_me
  where conversation_id = p_conversation_id and revoked_at is null;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform app.audit('assistant_conversation', p_conversation_id::text,
      'ASSISTANT_CONVERSATION_SHARE_REVOKE', null,
      jsonb_build_object('revoked', v_count));
  end if;
  return jsonb_build_object('revoked', v_count);
end
$$;

/**
 * One shared conversation, for any signed-in member of staff holding the link.
 *
 * The share is the grant, so the caller need not be the owner - but they must
 * be a real, active person, and the share must not have been revoked. Tool
 * results are deliberately absent; only the tool's name is returned.
 */
create function public.assistant_shared_conversation(p_share_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Refuses anyone who is not a real, active member of staff.
  v_me uuid := app.current_person_id();
  v_conversation public.assistant_conversations;
  v_shared_by text;
  v_rows jsonb;
begin
  if v_me is null then perform app.fail('ASSISTANT_SHARE_NOT_FOUND'); end if;

  select c.* into v_conversation
  from public.assistant_conversation_shares s
  join public.assistant_conversations c on c.id = s.conversation_id
  where s.id = p_share_id and s.revoked_at is null;
  if not found then perform app.fail('ASSISTANT_SHARE_NOT_FOUND'); end if;

  select p.display_name into v_shared_by
  from public.people p where p.id = v_conversation.person_id;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'role', m.content ->> 'role',
             'text', case when m.content ->> 'role' in ('user', 'assistant')
                       then m.content ->> 'text' else null end,
             'tool', case when m.content ->> 'role' = 'tool'
                       then m.content ->> 'name' else null end,
             'created_at', m.created_at)
           order by m.seq), '[]'::jsonb)
    into v_rows
  from public.assistant_messages m
  where m.conversation_id = v_conversation.id;

  return jsonb_build_object(
    'share_id', p_share_id,
    'title', v_conversation.title,
    'created_at', v_conversation.created_at,
    'shared_by', v_shared_by,
    'messages', v_rows);
end
$$;

revoke execute on function
  public.assistant_share_conversation(uuid),
  public.assistant_revoke_conversation_share(uuid),
  public.assistant_shared_conversation(uuid)
  from public, anon;

grant execute on function
  public.assistant_share_conversation(uuid),
  public.assistant_revoke_conversation_share(uuid),
  public.assistant_shared_conversation(uuid)
  to authenticated, service_role;
