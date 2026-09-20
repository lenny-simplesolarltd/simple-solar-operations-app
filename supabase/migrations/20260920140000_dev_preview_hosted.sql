-- =============================================================================
-- Developer "View as user" preview - HOSTED-SAFE mechanism.
--
-- This is the production-safe equivalent of supabase/dev/user_preview_hook.sql
-- (which is NOT a migration and never reaches hosted). The local hook trusts a
-- `preview_person_id` claim inside the JWT, which would require the app to hold
-- Supabase's JWT signing secret in production - a secret that can mint a session
-- for ANY user. That is deliberately not migrated.
--
-- Instead, the request authenticates completely normally (the developer's own
-- Supabase session; auth.uid() is and stays the developer), and carries an extra
-- request header holding a proof that the DATABASE authenticates for itself with
-- a preview-only secret stored here. The browser never holds that secret, so it
-- cannot mint, edit or extend a proof.
--
-- Identity resolves to the target ONLY when ALL of these hold. Anything less
-- resolves to NOBODY - never to the real developer, so a half-working preview
-- can never quietly show the developer their own Admin data under a staff name:
--
--   (a) the transaction is READ ONLY. PostgREST runs GET requests and STABLE /
--       IMMUTABLE rpc calls in read-only transactions, so this single condition
--       makes hosted preview physically incapable of writing - no triggers, no
--       changes to any application table, nothing touching other schemas.
--   (b) the real authenticated user is an active Admin here, AND is listed in
--       app_preview.allowed_developers (the allow-list is enforced by the
--       database too, not only by the application's env var).
--   (c) the proof's HMAC is reproducible with the secret in app_preview.config,
--       binds that exact real user to that exact target, and has not expired.
--   (d) the named target is an active person.
--
-- Nothing here grants any write, weakens any RLS policy, or uses service_role.
-- The secret and the allow-list are intentionally EMPTY after this migration:
-- preview stays off until an owner inserts both by hand. See docs/DEV_USER_PREVIEW.md.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_preview;
revoke all on schema app_preview from public;
-- No grant to anon/authenticated: nothing in here is callable over the API.
-- The functions below are SECURITY DEFINER and are reached only from
-- app.current_person_id(), which the RLS policies already call.

-- The preview-only signing secret. NOT Supabase's JWT secret: it can do nothing
-- except authenticate a read-only preview proof for an already-Admin developer.
create table if not exists app_preview.config (
  only_row boolean primary key default true check (only_row),
  secret   text not null check (length(secret) >= 32),
  updated_at timestamptz not null default now()
);
comment on table app_preview.config is
  'Single row holding the developer-preview signing secret. Populated by hand, never by a migration, and never readable over the API.';

-- The named developer accounts. Being Admin is not enough, here or in the app.
create table if not exists app_preview.allowed_developers (
  auth_user_id uuid primary key,
  note         text,
  added_at     timestamptz not null default now()
);
comment on table app_preview.allowed_developers is
  'auth.users.id of the developer accounts permitted to start a read-only preview. Populated by hand.';

revoke all on all tables in schema app_preview from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Is this request even asking for a preview? Cheap, and the only thing evaluated
-- on the overwhelming majority of requests, which carry no such header.
-- -----------------------------------------------------------------------------
create or replace function app_preview.requested()
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  return coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb ? 'x-ss-dev-preview',
    false
  );
exception when others then
  return false;
end
$$;

-- -----------------------------------------------------------------------------
-- The target person this request may be read as, or NULL (fail closed).
-- -----------------------------------------------------------------------------
create or replace function app_preview.target()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_proof    text;
  v_parts    text[];
  v_sub      uuid;
  v_target   uuid;
  v_expires  bigint;
  v_secret   text;
  v_expected text;
begin
  -- (a) Read-only transaction, or nothing. This is what makes hosted preview
  -- incapable of writing: a write transaction resolves the actor to nobody, so
  -- every RLS check fails rather than a row being written as the target.
  if current_setting('transaction_read_only', true) is distinct from 'on' then
    return null;
  end if;

  v_proof := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-ss-dev-preview';
  v_sub   := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  if v_proof is null or v_sub is null then
    return null;
  end if;

  -- (b) The REAL user must be an active Admin AND a named developer.
  if not exists (
    select 1
    from public.people p
    join public.person_roles pr
      on pr.person_id = p.id and pr.active and pr.role_code = 'Admin'
    join app_preview.allowed_developers d on d.auth_user_id = p.auth_user_id
    where p.auth_user_id = v_sub and p.active
  ) then
    return null;
  end if;

  -- (c) The proof must be one this database could have produced, for THIS user
  -- and THIS target, and must not have expired.
  v_parts := string_to_array(v_proof, '.');
  if array_length(v_parts, 1) is distinct from 4 or v_parts[1] <> 'v1' then
    return null;
  end if;
  v_target  := v_parts[2]::uuid;
  v_expires := v_parts[3]::bigint;
  if v_expires <= (extract(epoch from clock_timestamp()) * 1000)::bigint then
    return null;
  end if;

  select c.secret into v_secret from app_preview.config c limit 1;
  if v_secret is null then
    return null;
  end if;

  v_expected := encode(
    extensions.hmac(
      'ss-preview:v1:' || v_sub::text || ':' || v_target::text || ':' || v_expires::text,
      v_secret,
      'sha256'
    ),
    'hex'
  );
  if v_expected is distinct from v_parts[4] then
    return null;
  end if;

  -- (d) The target must be a real, active person. Roles are never taken from the
  -- proof: they are read from person_roles for this id, as for anybody else.
  select p.id into v_target
    from public.people p
   where p.id = v_target and p.active;
  return v_target;
exception when others then
  return null;
end
$$;

-- -----------------------------------------------------------------------------
-- Identity. Unchanged for every request that does not carry a preview header -
-- the else-branch is the existing definition, verbatim.
-- -----------------------------------------------------------------------------
create or replace function app.current_person_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select case
    when app_preview.requested() then app_preview.target()
    else (
      select p.id
      from public.people p
      where p.auth_user_id = (select auth.uid())
        and p.active
    )
  end
$$;
comment on function app.current_person_id() is
  'The active person mapped to the authenticated user, or null. Inactive people resolve to null (fail closed). Under an authenticated, read-only developer preview, the previewed person instead - see app_preview.target().';

-- -----------------------------------------------------------------------------
-- cancellation_preview only calculates: it calls app.s15_preview (STABLE) and
-- raises on refusal, and never writes - the cancellation that DOES write is a
-- separate command. It was VOLATILE only by plpgsql default, which made
-- PostgREST run it in a read-write transaction. Marking it STABLE is correct on
-- its own terms, and is what lets a read-only preview call it at all.
-- -----------------------------------------------------------------------------
alter function public.cancellation_preview(uuid, date) stable;
