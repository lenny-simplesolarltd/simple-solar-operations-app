-- =============================================================================
-- DEVELOPMENT ONLY - "View as user" preview hook.
--
-- THIS IS NOT A MIGRATION. It lives outside supabase/migrations on purpose, so
-- `supabase db push` can never apply it to the hosted project. It is installed
-- into the LOCAL stack only, by `npm run dev:preview:install`, and is wiped by
-- every `supabase db reset`.
--
-- What it does: lets the real RLS policies evaluate as another staff member
-- when - and only when - the request carries a JWT that
--   (a) is validly signed with this database's JWT secret (PostgREST checks
--       that before any SQL runs; the browser never holds the secret), and
--   (b) contains a `preview_person_id` claim, and
--   (c) whose real `sub` is an active Admin here, and
--   (d) names an active target person.
-- Anything less resolves to NOBODY (fail closed), never to the real user.
-- A preview token is also READ-ONLY at the database: every write is refused.
-- =============================================================================

create schema if not exists app_dev;
revoke all on schema app_dev from public;
grant usage on schema app_dev to authenticated, service_role;

create or replace function app_dev.preview_claimed()
returns boolean language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ? 'preview_person_id', false)
$$;

create or replace function app_dev.preview_target()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  claims   jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_target uuid;
begin
  -- The real signed-in person must be an active Admin in THIS database.
  if not exists (
    select 1 from public.people p
    join public.person_roles pr on pr.person_id = p.id and pr.active and pr.role_code = 'Admin'
    where p.auth_user_id = (claims ->> 'sub')::uuid and p.active
  ) then
    return null;
  end if;
  select p.id into v_target from public.people p
   where p.id = (claims ->> 'preview_person_id')::uuid and p.active;
  return v_target;
exception when others then
  return null;
end
$$;

-- Same body as the production function, plus the preview branch.
create or replace function app.current_person_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select case
    when app_dev.preview_claimed() then app_dev.preview_target()
    else (select p.id from public.people p where p.auth_user_id = (select auth.uid()) and p.active)
  end
$$;

-- Read-only at the database: a preview token can never write, whatever the app does.
create or replace function app_dev.forbid_preview_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if app_dev.preview_claimed() then
    raise exception 'PREVIEW_MODE_READ_ONLY' using errcode = 'P0001';
  end if;
  return null;
end
$$;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop trigger if exists zz_dev_preview_read_only on public.%I', t.tablename);
    execute format('create trigger zz_dev_preview_read_only before insert or update or delete on public.%I for each statement execute function app_dev.forbid_preview_write()', t.tablename);
  end loop;
end
$$;

grant execute on all functions in schema app_dev to authenticated, service_role;
