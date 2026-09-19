-- =============================================================================
-- SimpleBot durable pending actions (BD-07): how a proposed change waits for a
-- human, in Postgres, so confirmation is single-use across every server
-- instance and restart.
--
-- Lifecycle: pending -> claimed -> succeeded | failed      (Confirm)
--            pending -> cancelled                          (Cancel)
--            claimed -> pending                            (transport failure; retry)
-- A pending action past expires_at can never be claimed.
--
-- The server stores the VALIDATED, normalised arguments here when it proposes;
-- on confirmation it executes with these stored arguments (never anything the
-- browser sends back), as the person who claims them - who must be the person
-- it was proposed to. The action id is also the domain command's command_id,
-- so the command ledger's idempotency covers any retry.
--
-- Rows are the proposer's only (RLS); every change goes through the functions
-- below, which derive the actor from auth.uid(). No secrets are stored.
-- =============================================================================

create table public.assistant_pending_actions (
  id               uuid primary key,
  person_id        uuid not null references public.people (id),
  thread_id        uuid not null,
  tool             text not null check (tool ~ '^[a-z][a-z0-9_]{0,79}$'),
  args             jsonb not null,
  args_hash        text not null check (args_hash ~ '^[0-9a-f]{64}$'),
  expected_version integer,
  -- What the staff member was shown (title, summary, changes). Display only.
  preview          jsonb not null,
  status           text not null default 'pending'
                   check (status in ('pending', 'claimed', 'succeeded', 'failed', 'cancelled')),
  outcome_code     text check (outcome_code is null or char_length(outcome_code) <= 80),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  claimed_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  constraint assistant_pending_actions_expiry check (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  constraint assistant_pending_actions_size check (
    octet_length(args::text) <= 200000 and octet_length(preview::text) <= 200000
  )
);
comment on table public.assistant_pending_actions is
  'SimpleBot proposals awaiting a human decision. Owner-only; single-use; the action id is the domain command_id.';
create index assistant_pending_actions_person_idx on public.assistant_pending_actions (person_id, created_at desc);

-- Proposes: records a validated action for the caller.
create function public.assistant_register_pending_action(
  p_id uuid,
  p_thread_id uuid,
  p_tool text,
  p_args jsonb,
  p_args_hash text,
  p_expected_version integer,
  p_preview jsonb,
  p_expires_at timestamptz
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_person uuid := app.current_person_id();
begin
  if v_person is null or not app.is_active_actor() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_id is null or p_thread_id is null or p_args is null or p_preview is null
     or p_expires_at is null or p_expires_at <= now() or p_expires_at > now() + interval '1 hour' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  insert into public.assistant_pending_actions
    (id, person_id, thread_id, tool, args, args_hash, expected_version, preview, expires_at)
  values (p_id, v_person, p_thread_id, p_tool, p_args, p_args_hash, p_expected_version, p_preview, p_expires_at);
end
$$;

-- Decides: atomically claims (confirm) or cancels a pending action. Only the
-- proposer, only while pending and unexpired, and only once - concurrent
-- claims serialise on the row and exactly one wins. On a won confirm, returns
-- the stored action for the server to execute.
--   {outcome: 'ok', tool, args, args_hash, expected_version, thread_id}
--   {outcome: 'already_used' | 'expired' | 'unknown'}
-- Someone else's action is 'unknown', exactly like one that does not exist.
create function public.assistant_claim_pending_action(p_id uuid, p_decision text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_person uuid := app.current_person_id();
  v_row public.assistant_pending_actions;
begin
  if v_person is null or not app.is_active_actor() then
    return jsonb_build_object('outcome', 'unknown');
  end if;
  if p_decision not in ('confirm', 'cancel') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  update public.assistant_pending_actions a set
    status       = case p_decision when 'confirm' then 'claimed' else 'cancelled' end,
    claimed_at   = case p_decision when 'confirm' then now() else a.claimed_at end,
    cancelled_at = case p_decision when 'cancel' then now() else a.cancelled_at end
  where a.id = p_id
    and a.person_id = v_person
    and a.status = 'pending'
    and a.expires_at > now()
  returning a.* into v_row;

  if found then
    return jsonb_build_object(
      'outcome', 'ok', 'tool', v_row.tool, 'args', v_row.args, 'args_hash', v_row.args_hash,
      'expected_version', v_row.expected_version, 'thread_id', v_row.thread_id);
  end if;

  select * into v_row from public.assistant_pending_actions a
  where a.id = p_id and a.person_id = v_person;
  if not found then
    return jsonb_build_object('outcome', 'unknown');
  end if;
  if v_row.status = 'pending' then
    return jsonb_build_object('outcome', 'expired');
  end if;
  return jsonb_build_object('outcome', 'already_used');
end
$$;

-- Hands a claim back after a transport failure (outcome unknown), so the
-- idempotent command can be confirmed again. Never after an outcome was recorded.
create function public.assistant_release_pending_action(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.assistant_pending_actions a set status = 'pending', claimed_at = null
  where a.id = p_id and a.person_id = app.current_person_id() and a.status = 'claimed';
end
$$;

-- Records the terminal outcome of a claimed action.
create function public.assistant_complete_pending_action(p_id uuid, p_succeeded boolean, p_code text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if char_length(coalesce(p_code, '')) > 80 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;
  update public.assistant_pending_actions a set
    status = case when p_succeeded then 'succeeded' else 'failed' end,
    outcome_code = p_code,
    completed_at = now()
  where a.id = p_id and a.person_id = app.current_person_id() and a.status = 'claimed';
end
$$;

revoke all on public.assistant_pending_actions from public, anon, authenticated;
grant select on public.assistant_pending_actions to authenticated;
grant all on public.assistant_pending_actions to service_role;

alter table public.assistant_pending_actions enable row level security;
create policy assistant_pending_actions_owner_select on public.assistant_pending_actions
  for select to authenticated
  using (person_id = (select app.current_person_id()) and (select app.is_active_actor()));

revoke execute on function public.assistant_register_pending_action(uuid, uuid, text, jsonb, text, integer, jsonb, timestamptz),
  public.assistant_claim_pending_action(uuid, text), public.assistant_release_pending_action(uuid),
  public.assistant_complete_pending_action(uuid, boolean, text)
  from public, anon;
grant execute on function public.assistant_register_pending_action(uuid, uuid, text, jsonb, text, integer, jsonb, timestamptz),
  public.assistant_claim_pending_action(uuid, text), public.assistant_release_pending_action(uuid),
  public.assistant_complete_pending_action(uuid, boolean, text)
  to authenticated, service_role;
