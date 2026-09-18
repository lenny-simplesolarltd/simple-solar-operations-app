-- =============================================================================
-- Identity foundation: people, roles, skills, auth mapping, authorization
-- helpers, RLS, row versioning and the append-only audit log.
--
-- Business semantics are ported from the reference implementation
-- (Sheets/AppSheet/Apps Script). Citations are to that repository:
--   * actor resolution ........ r1-appsheet/adapter.js:16-25, s04/processor.js:39-47
--   * role predicates ......... r1-appsheet/adapter.js:26-29
--   * skills rules ............ resource/planning.js:12-19, 98-113
--   * audit shape ............. schema/tables.json (AuditEvents), s04/processor.js:149-158
--
-- Deliberately NOT ported: People.role (person_roles is the only role
-- authority), commit_id / source_system / source_record_id, calendar_id
-- (Google-specific; belongs to the calendar slice), USEREMAIL / signed-identity
-- plumbing (replaced by auth.uid()).
-- =============================================================================

-- Helpers live in a schema that is not exposed through the Data API.
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Reference vocabularies
-- -----------------------------------------------------------------------------

create table public.roles (
  code        text primary key check (code ~ '^[A-Za-z][A-Za-z0-9]*$'),
  name        text not null,
  description text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
comment on table public.roles is
  'Role vocabulary. Codes are the exact literals used by the reference authorization matrix.';

create table public.skills (
  code       text primary key check (code ~ '^[A-Za-z][A-Za-z0-9]*$'),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.skills is
  'Installer trade competences. Same taxonomy as work-package trades in the reference (Roof, Electrical).';

-- -----------------------------------------------------------------------------
-- People
-- -----------------------------------------------------------------------------

create table public.people (
  id                 uuid primary key default gen_random_uuid(),
  -- Reference id (e.g. PERSON-ben). Kept so reference rules that name people
  -- (PRE03 owner/backup) can be ported without guessing.
  legacy_id          text unique,
  -- A person may exist without a login (e.g. an installer who is only
  -- scheduled). Unique when present: one login maps to exactly one person.
  auth_user_id       uuid unique references auth.users (id) on delete set null,
  -- Stored normalised; the reference matches on trim + lower-case and fails
  -- closed on duplicates, which the unique constraint now guarantees.
  email              text unique check (email = lower(btrim(email)) and email <> ''),
  display_name       text not null check (btrim(display_name) <> ''),
  active             boolean not null default true,
  notification_email text check (notification_email = lower(btrim(notification_email)) and notification_email <> ''),
  capacity_per_day   integer check (capacity_per_day >= 1),
  available_from     date,
  available_to       date,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.people (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.people (id),
  version            integer not null default 1 check (version >= 1),
  constraint people_availability_window check (
    available_from is null or available_to is null or available_from <= available_to
  )
);
comment on table public.people is
  'Staff and partner directory. Roles come only from person_roles; there is intentionally no role column here.';
comment on column public.people.available_from is 'Europe/London local date.';
comment on column public.people.available_to is 'Europe/London local date, inclusive.';

create table public.person_roles (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people (id) on delete restrict,
  role_code  text not null references public.roles (code) on update cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.people (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.people (id),
  version    integer not null default 1 check (version >= 1),
  unique (person_id, role_code)
);
comment on table public.person_roles is
  'Authoritative role assignments. A role is revoked by setting active = false, never by deleting the row.';
create index person_roles_role_code_idx on public.person_roles (role_code) where active;

create table public.person_skills (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.people (id) on delete restrict,
  skill_code      text not null references public.skills (code) on update cascade,
  level           text not null default 'Member' check (level in ('Lead', 'Member', 'Apprentice')),
  certified_until date,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.people (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.people (id),
  version         integer not null default 1 check (version >= 1),
  unique (person_id, skill_code)
);
comment on table public.person_skills is
  'Installer trade competence. No active rows for a person means no skill constraint; any active rows without a match block allocation (reference resource/planning.js:215-217).';

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------

create table public.audit_events (
  id                   uuid primary key default gen_random_uuid(),
  entity_type          text not null,
  entity_id            text not null,
  action               text not null,
  before_json          jsonb,
  after_json           jsonb,
  -- The human who initiated the change (null only for system/seed writes) ...
  initiating_person_id uuid references public.people (id),
  -- ... kept distinct from the service that executed it.
  executing_service    text not null,
  occurred_at          timestamptz not null default now(),
  -- Correlation id: the command_id of the command that caused this event.
  command_id           text,
  reason               text
);
comment on table public.audit_events is
  'Immutable audit log: one event per committed change per entity, with before/after snapshots. Rejected commands are not audited.';
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at);
create index audit_events_command_idx on public.audit_events (command_id) where command_id is not null;
create index audit_events_person_idx on public.audit_events (initiating_person_id, occurred_at);

-- -----------------------------------------------------------------------------
-- Identity + authorization helpers
--
-- SECURITY DEFINER so they can be used inside RLS policies on the very tables
-- they read without recursing. Identity always derives from auth.uid(); no
-- helper accepts a caller-supplied actor.
-- -----------------------------------------------------------------------------

create function app.current_person_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id
  from public.people p
  where p.auth_user_id = (select auth.uid())
    and p.active
$$;
comment on function app.current_person_id() is
  'The active person mapped to the authenticated user, or null. Inactive people resolve to null (fail closed).';

create function app.current_roles()
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(pr.role_code order by pr.role_code), '{}')
  from public.person_roles pr
  join public.roles r on r.code = pr.role_code and r.active
  where pr.person_id = app.current_person_id()
    and pr.active
$$;

create function app.has_any_role(variadic wanted text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.current_roles() && wanted
$$;

-- An actor is an active person with at least one active role
-- (reference: NO_ACTIVE_ROLE is a refusal).
create function app.is_active_actor()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select cardinality(app.current_roles()) > 0
$$;

-- Role predicates, exactly as the reference defines them (adapter.js:26-29).
-- Admin-class bypasses role checks only; it never bypasses versioning,
-- idempotency or audit.
create function app.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_any_role('Admin', 'Manager') $$;

create function app.is_director_class()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_any_role('Admin', 'Manager', 'Director') $$;

create function app.is_office_class()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_any_role('Admin', 'Manager', 'Director', 'Office', 'VariationApprover') $$;

create function app.is_office_manager()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_any_role('Admin', 'Manager', 'Office') $$;

-- "Who am I?" for the application. Returns no row when the authenticated user
-- is not mapped to an active person.
create function public.current_actor()
returns table (person_id uuid, display_name text, email text, roles text[])
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.email, app.current_roles()
  from public.people p
  where p.id = app.current_person_id()
$$;

-- -----------------------------------------------------------------------------
-- Row stamping + optimistic versioning
-- -----------------------------------------------------------------------------

create function app.touch_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version    := 1;
    new.created_at := now();
    new.updated_at := new.created_at;
    new.created_by := app.current_person_id();
    new.updated_by := new.created_by;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'IMMUTABLE_ID' using errcode = 'P0001';
  end if;
  -- A writer may state the version it read; a mismatch is a stale write.
  if new.version is distinct from old.version then
    raise exception 'STALE_VERSION' using
      errcode = 'P0001',
      detail  = format('expected %s, current %s', new.version, old.version);
  end if;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.version    := old.version + 1;
  new.updated_at := now();
  new.updated_by := app.current_person_id();
  return new;
end
$$;

-- -----------------------------------------------------------------------------
-- Audit triggers
-- -----------------------------------------------------------------------------

create function app.audit_row_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_after  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into public.audit_events (
    entity_type, entity_id, action, before_json, after_json,
    initiating_person_id, executing_service, command_id, reason
  ) values (
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id'),
    tg_op,
    v_before,
    v_after,
    app.current_person_id(),
    coalesce(nullif(current_setting('app.executing_service', true), ''), 'db:' || tg_table_name),
    nullif(current_setting('app.command_id', true), ''),
    nullif(current_setting('app.reason', true), '')
  );
  return coalesce(new, old);
end
$$;

create function app.forbid_audit_mutation()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'AUDIT_EVENTS_ARE_IMMUTABLE' using errcode = 'P0001';
end
$$;

create trigger audit_events_no_update_delete
  before update or delete on public.audit_events
  for each row execute function app.forbid_audit_mutation();
create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function app.forbid_audit_mutation();

-- Only Installers may hold skills (reference resource/planning.js:100).
create function app.assert_skill_holder_is_installer()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.active and not exists (
    select 1 from public.person_roles pr
    where pr.person_id = new.person_id and pr.role_code = 'Installer' and pr.active
  ) then
    raise exception 'SKILL_HOLDER_NOT_INSTALLER' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger people_touch before insert or update on public.people
  for each row execute function app.touch_row();
create trigger person_roles_touch before insert or update on public.person_roles
  for each row execute function app.touch_row();
create trigger person_skills_touch before insert or update on public.person_skills
  for each row execute function app.touch_row();

create trigger person_skills_installer_only before insert or update on public.person_skills
  for each row execute function app.assert_skill_holder_is_installer();

create trigger people_audit after insert or update or delete on public.people
  for each row execute function app.audit_row_change();
create trigger person_roles_audit after insert or update or delete on public.person_roles
  for each row execute function app.audit_row_change();
create trigger person_skills_audit after insert or update or delete on public.person_skills
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- auth.users -> people mapping
--
-- A login is linked to the person whose email it has *verified*. Accounts are
-- invite-only; nothing here creates auth users, and people without a login are
-- untouched. An unverified email never links.
-- -----------------------------------------------------------------------------

create function app.link_auth_user_to_person()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;
  if exists (select 1 from public.people where auth_user_id = new.id) then
    return new;
  end if;

  perform set_config('app.executing_service', 'auth:link', true);
  update public.people
     set auth_user_id = new.id
   where email = lower(btrim(new.email))
     and auth_user_id is null
     and active;
  return new;
end
$$;

create trigger link_auth_user_to_person
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function app.link_auth_user_to_person();

-- -----------------------------------------------------------------------------
-- Privileges: fail closed. Nothing for anon; authenticated gets only what RLS
-- then narrows. No DELETE anywhere - rows are deactivated, not removed.
-- -----------------------------------------------------------------------------

revoke all on public.roles, public.skills, public.people, public.person_roles,
              public.person_skills, public.audit_events
  from anon, authenticated;

grant select on public.roles, public.skills, public.audit_events to authenticated;
grant select, insert, update on public.people, public.person_roles, public.person_skills to authenticated;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function public.current_actor() from public, anon;
grant execute on function public.current_actor() to authenticated, service_role;

alter table public.roles         enable row level security;
alter table public.skills        enable row level security;
alter table public.people        enable row level security;
alter table public.person_roles  enable row level security;
alter table public.person_skills enable row level security;
alter table public.audit_events  enable row level security;

-- Vocabularies: readable by any active actor; changed only by migration.
create policy roles_select on public.roles
  for select to authenticated using ((select app.is_active_actor()));
create policy skills_select on public.skills
  for select to authenticated using ((select app.is_active_actor()));

-- People: an active actor can see themselves; office-class staff see the
-- directory. A login with no active role sees nothing (reference: NO_ACTIVE_ROLE).
-- Only Admin-class may create or change people (including the auth link).
create policy people_select on public.people
  for select to authenticated
  using (
    ((select app.is_active_actor()) and id = (select app.current_person_id()))
    or (select app.is_office_class())
  );
create policy people_insert on public.people
  for insert to authenticated with check ((select app.is_admin()));
create policy people_update on public.people
  for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Role assignments: you can see your own; office-class see all.
-- Only Admin-class may grant or revoke, so nobody can grant themselves a role.
create policy person_roles_select on public.person_roles
  for select to authenticated
  using (
    ((select app.is_active_actor()) and person_id = (select app.current_person_id()))
    or (select app.is_office_class())
  );
create policy person_roles_insert on public.person_roles
  for insert to authenticated with check ((select app.is_admin()));
create policy person_roles_update on public.person_roles
  for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Skills: configured by Admin / Manager / Office (reference RP_CONFIG_ROLES).
create policy person_skills_select on public.person_skills
  for select to authenticated
  using (
    ((select app.is_active_actor()) and person_id = (select app.current_person_id()))
    or (select app.is_office_class())
  );
create policy person_skills_insert on public.person_skills
  for insert to authenticated with check ((select app.is_office_manager()));
create policy person_skills_update on public.person_skills
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

-- Audit: readable by Admin-class. Written only by triggers / server-side
-- functions; there is deliberately no insert policy.
create policy audit_events_select on public.audit_events
  for select to authenticated using ((select app.is_admin()));

-- -----------------------------------------------------------------------------
-- Vocabulary data
-- -----------------------------------------------------------------------------

insert into public.roles (code, name, sort_order, description) values
  ('Admin',             'Admin',              10, 'Full access. Bypasses role and assignment checks only - never versioning, idempotency or audit.'),
  ('Manager',           'Manager',            20, 'Treated identically to Admin by the reference authorization rules.'),
  ('Director',          'Director',           30, 'Office-class, plus the only non-admin role that may confirm bank deposits. Eligible owner of PRE03.'),
  ('Office',            'Office',             40, 'Office staff: R1 office commands on jobs they are assigned to; configures skills, leave and teams.'),
  ('VariationApprover', 'Variation approver', 50, 'Office-class. Default owner of variation reviews; the reference requires exactly one active holder.'),
  ('Surveyor',          'Surveyor',           60, 'Field surveyor / salesperson. Named in the reference staff list but given no command access there.'),
  ('Finance',           'Finance',            70, 'Finance reporting. Defined by the reference; no command path uses it yet.'),
  ('Store',             'Store',              80, 'Goods-in, stock balance and quarantine.'),
  ('Installer',         'Installer',          90, 'Installer workflow on work packages where they hold an active allocation. May hold skills.'),
  ('Scaffolder',        'Scaffolder',        100, 'Scaffold partner. Defined by the reference; no command path uses it yet.'),
  ('ReadOnly',          'Read only',         110, 'Defined by the reference; never referenced by any rule.');

insert into public.skills (code, name) values
  ('Roof',       'Roof'),
  ('Electrical', 'Electrical');
