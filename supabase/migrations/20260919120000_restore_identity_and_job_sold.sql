-- =============================================================================
-- RECONCILIATION (forward-only): restore the identity + Job Sold objects
-- alongside the reference-schema tables.
--
-- Migration 20260919110000_drop_identity_and_job_sold (another stream) removed
-- the 14 tables, the app schema, current_actor(), submit_presale(), the
-- auth.users -> people link trigger, and - through CASCADE - every foreign key
-- from the remaining tables to people / jobs / tasks. That is NOT the intended
-- architecture: see docs/DATABASE_OWNERSHIP.md.
--
-- This migration:
--   1. re-creates the identity foundation exactly as accepted (20260918200000);
--   2. re-creates Job Sold exactly as accepted (20260919090000);
--   3. reconnects the other stream's tables to the canonical people / jobs /
--      tasks tables, using the foreign keys that stream itself declared.
--
-- It drops, truncates, renames and replaces NOTHING belonging to the other
-- stream. Their RLS policies, triggers and app.* helpers (is_stock_class,
-- is_finance_class, holds_active_allocation, stamp_setting) were also destroyed
-- by their CASCADE; those are theirs to re-create. Until then their tables keep
-- RLS enabled with no policies, i.e. service-role only.
--
-- Data is re-applied by the (idempotent) seeds, not here.
-- =============================================================================

-- =============================================================================
-- 1. Identity foundation (as 20260918200000)
-- =============================================================================

create schema if not exists app;
<<<<<<< HEAD

revoke all on schema app from public;

=======
revoke all on schema app from public;
>>>>>>> main
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
<<<<<<< HEAD

=======
>>>>>>> main
comment on table public.roles is
  'Role vocabulary. Codes are the exact literals used by the reference authorization matrix.';

create table public.skills (
  code       text primary key check (code ~ '^[A-Za-z][A-Za-z0-9]*$'),
  name       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
<<<<<<< HEAD

=======
>>>>>>> main
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
<<<<<<< HEAD

comment on table public.people is
  'Staff and partner directory. Roles come only from person_roles; there is intentionally no role column here.';

comment on column public.people.available_from is 'Europe/London local date.';

=======
comment on table public.people is
  'Staff and partner directory. Roles come only from person_roles; there is intentionally no role column here.';
comment on column public.people.available_from is 'Europe/London local date.';
>>>>>>> main
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
<<<<<<< HEAD

comment on table public.person_roles is
  'Authoritative role assignments. A role is revoked by setting active = false, never by deleting the row.';

=======
comment on table public.person_roles is
  'Authoritative role assignments. A role is revoked by setting active = false, never by deleting the row.';
>>>>>>> main
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
<<<<<<< HEAD

=======
>>>>>>> main
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
<<<<<<< HEAD

comment on table public.audit_events is
  'Immutable audit log: one event per committed change per entity, with before/after snapshots. Rejected commands are not audited.';

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at);

create index audit_events_command_idx on public.audit_events (command_id) where command_id is not null;

=======
comment on table public.audit_events is
  'Immutable audit log: one event per committed change per entity, with before/after snapshots. Rejected commands are not audited.';
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at);
create index audit_events_command_idx on public.audit_events (command_id) where command_id is not null;
>>>>>>> main
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
<<<<<<< HEAD

=======
>>>>>>> main
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
<<<<<<< HEAD

=======
>>>>>>> main
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
<<<<<<< HEAD

create trigger person_roles_touch before insert or update on public.person_roles
  for each row execute function app.touch_row();

=======
create trigger person_roles_touch before insert or update on public.person_roles
  for each row execute function app.touch_row();
>>>>>>> main
create trigger person_skills_touch before insert or update on public.person_skills
  for each row execute function app.touch_row();

create trigger person_skills_installer_only before insert or update on public.person_skills
  for each row execute function app.assert_skill_holder_is_installer();

create trigger people_audit after insert or update or delete on public.people
  for each row execute function app.audit_row_change();
<<<<<<< HEAD

create trigger person_roles_audit after insert or update or delete on public.person_roles
  for each row execute function app.audit_row_change();

=======
create trigger person_roles_audit after insert or update or delete on public.person_roles
  for each row execute function app.audit_row_change();
>>>>>>> main
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

drop trigger if exists link_auth_user_to_person on auth.users;
<<<<<<< HEAD

=======
>>>>>>> main
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
<<<<<<< HEAD

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

=======
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
>>>>>>> main
alter table public.audit_events  enable row level security;

-- Vocabularies: readable by any active actor; changed only by migration.
create policy roles_select on public.roles
  for select to authenticated using ((select app.is_active_actor()));
<<<<<<< HEAD

=======
>>>>>>> main
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
<<<<<<< HEAD

create policy people_insert on public.people
  for insert to authenticated with check ((select app.is_admin()));

=======
create policy people_insert on public.people
  for insert to authenticated with check ((select app.is_admin()));
>>>>>>> main
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
<<<<<<< HEAD

create policy person_roles_insert on public.person_roles
  for insert to authenticated with check ((select app.is_admin()));

=======
create policy person_roles_insert on public.person_roles
  for insert to authenticated with check ((select app.is_admin()));
>>>>>>> main
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
<<<<<<< HEAD

create policy person_skills_insert on public.person_skills
  for insert to authenticated with check ((select app.is_office_manager()));

=======
create policy person_skills_insert on public.person_skills
  for insert to authenticated with check ((select app.is_office_manager()));
>>>>>>> main
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

<<<<<<< HEAD
=======

>>>>>>> main
-- =============================================================================
-- 2. Job Sold (as 20260919090000)
-- =============================================================================

create table if not exists public.permissions (
  code        text primary key check (code ~ '^[a-z][a-z0-9_.]*$'),
  description text not null,
  created_at  timestamptz not null default now()
);

create table public.role_permissions (
  id              uuid primary key default gen_random_uuid(),
  role_code       text not null references public.roles (code) on update cascade,
  permission_code text not null references public.permissions (code) on update cascade,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.people (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.people (id),
  version         integer not null default 1 check (version >= 1),
  unique (role_code, permission_code)
);
<<<<<<< HEAD

=======
>>>>>>> main
comment on table public.role_permissions is
  'Which roles hold which permission. Object-level rules (own job, task owner/backup) are enforced separately.';

create function app.has_permission(wanted text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.role_permissions rp
    where rp.permission_code = wanted
      and rp.role_code = any (app.current_roles())
  )
$$;

-- -----------------------------------------------------------------------------
-- Customers
-- -----------------------------------------------------------------------------

create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  first_name        text not null check (btrim(first_name) <> ''),
  last_name         text not null check (btrim(last_name) <> ''),
  address_line1     text not null check (btrim(address_line1) <> ''),
  address_line2     text,
  town              text not null check (btrim(town) <> ''),
  postcode          text not null check (postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
  email             text check (email = lower(btrim(email)) and email <> ''),
  phone             text check (btrim(phone) <> ''),
  alternate_contact text,
  contact_notes     text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.people (id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.people (id),
  version           integer not null default 1 check (version >= 1),
  constraint customers_contact_method check (email is not null or phone is not null)
);
<<<<<<< HEAD

comment on table public.customers is
  'A sale always creates a new customer; the reference never resolves or merges customers at sale.';

=======
comment on table public.customers is
  'A sale always creates a new customer; the reference never resolves or merges customers at sale.';
>>>>>>> main
create index customers_match_idx on public.customers (postcode, lower(last_name));

-- -----------------------------------------------------------------------------
-- Jobs
-- -----------------------------------------------------------------------------

create table public.jobs (
  id                           uuid primary key default gen_random_uuid(),
  -- Human reference SS-XXXX-0000 (letters exclude I and O). Never the primary key.
  job_ref                      text not null unique check (job_ref ~ '^SS-[A-HJ-NP-Z]{4}-[0-9]{4}$'),
  customer_id                  uuid not null references public.customers (id) on delete restrict,
  display_name                 text not null,
  sold_at                      timestamptz not null,
  salesperson_id               uuid not null references public.people (id),
  lead_source                  text,
  quote_reference              text,
  finance_route                text not null check (finance_route in ('Standard', 'Phoenix', 'OtherReview')),
  -- Gross agreed selling price. VAT treatment is decided with the payment workflow.
  original_gross_pence         bigint not null check (original_gross_pence > 0),
  current_contract_gross_pence bigint not null check (current_contract_gross_pence > 0),
  valuation_basis              text,
  roof_required                boolean not null,
  electrical_required          boolean not null,
  scaffold_required            boolean not null,
  workflow_stage               text not null default 'Prebooking' check (workflow_stage in (
    'Prebooking', 'ReadyToBook', 'BookingInProgress', 'Booked', 'AwaitingInstallation',
    'InProgress', 'Aftercare', 'OperationallyComplete', 'CancellationInProgress', 'Cancelled')),
  created_at                   timestamptz not null default now(),
  created_by                   uuid references public.people (id),
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid references public.people (id),
  version                      integer not null default 1 check (version >= 1)
);
<<<<<<< HEAD

create index jobs_customer_idx on public.jobs (customer_id);

create index jobs_salesperson_idx on public.jobs (salesperson_id);

create index jobs_created_by_idx on public.jobs (created_by);

=======
create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_salesperson_idx on public.jobs (salesperson_id);
create index jobs_created_by_idx on public.jobs (created_by);
>>>>>>> main
create index jobs_stage_idx on public.jobs (workflow_stage);

create function app.forbid_job_ref_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.job_ref is distinct from old.job_ref then
    raise exception 'JOB_REF_IS_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end
$$;
<<<<<<< HEAD

=======
>>>>>>> main
create trigger jobs_job_ref_immutable before update on public.jobs
  for each row execute function app.forbid_job_ref_change();

-- -----------------------------------------------------------------------------
-- Presales: the sold document (what PRE04 and booking checks verify against).
-- Immutable once written.
-- -----------------------------------------------------------------------------

create table public.presales (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null unique references public.jobs (id) on delete restrict,
  surveyor_id           uuid not null references public.people (id),
  submitted_at          timestamptz not null,
  roof_notes            text,
  electrical_notes      text,
  design                jsonb not null check (jsonb_typeof(design) = 'object'),
  design_schema_version integer not null check (design_schema_version >= 1),
  catalogue_version     text not null check (btrim(catalogue_version) <> ''),
  system_kwp            numeric(8, 2) not null check (system_kwp >= 0),
  net_panels            integer not null check (net_panels >= 0),
  computed_total_pence  bigint not null check (computed_total_pence >= 0),
  agreed_price_pence    bigint not null check (agreed_price_pence > 0),
  price_breakdown       jsonb not null check (jsonb_typeof(price_breakdown) = 'array'),
  created_at            timestamptz not null default now(),
  created_by            uuid references public.people (id)
);

create function app.forbid_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception '%_IS_IMMUTABLE', upper(tg_table_name) using errcode = 'P0001';
end
$$;
<<<<<<< HEAD

=======
>>>>>>> main
create trigger presales_immutable before update or delete on public.presales
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Task templates, assignment rules, tasks
-- -----------------------------------------------------------------------------

create table public.task_templates (
  code             text primary key check (code ~ '^[A-Z][A-Z0-9-]*$'),
  title            text not null check (btrim(title) <> ''),
  task_group       text not null,
  default_priority integer not null default 0,
  -- Machine-readable; in the reference this was prose and the rule was hard-coded per generator.
  due_rule         text not null check (due_rule in ('at_creation', 'next_staffed_day', 'none')),
  -- Display-only guidance. The reference forbids deriving backend rules from this text.
  guidance         text,
  active           boolean not null default true,
  template_version text not null default '1.0',
  created_at       timestamptz not null default now(),
  created_by       uuid references public.people (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.people (id),
  version          integer not null default 1 check (version >= 1)
);

create table public.task_assignment_rules (
  id                   uuid primary key default gen_random_uuid(),
  template_code        text not null references public.task_templates (code) on update cascade,
  owner_person_id      uuid not null references public.people (id),
  backup_person_id     uuid references public.people (id),
  -- The owner (and backup) must hold one of these roles, or resolution fails.
  eligible_owner_roles text[] not null check (cardinality(eligible_owner_roles) > 0),
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  created_by           uuid references public.people (id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.people (id),
  version              integer not null default 1 check (version >= 1),
  constraint task_assignment_backup_differs check (backup_person_id is null or backup_person_id <> owner_person_id)
);
<<<<<<< HEAD

comment on table public.task_assignment_rules is
  'Explicit, deterministic task ownership. Exactly one active rule per template; never resolved from row order, names or roles lists.';

=======
comment on table public.task_assignment_rules is
  'Explicit, deterministic task ownership. Exactly one active rule per template; never resolved from row order, names or roles lists.';
>>>>>>> main
create unique index task_assignment_one_active_rule
  on public.task_assignment_rules (template_code) where active;

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid references public.jobs (id) on delete restrict,
  template_code        text not null references public.task_templates (code) on update cascade,
  -- One task per key, EVER: a Complete or Cancelled task is never recreated (reference S06 rule).
  instance_key         text not null unique,
  task_group           text not null,
  title                text not null,
  owner_id             uuid not null references public.people (id),
  backup_id            uuid references public.people (id),
  related_entity_type  text,
  related_entity_id    uuid,
  due_at               timestamptz,
  original_due_at      timestamptz,
  priority             integer not null default 0,
  status               text not null default 'Open' check (status in (
    'Blocked', 'Open', 'InProgress', 'Waiting', 'Complete', 'Cancelled', 'NotRequired')),
  blocking_reason      text,
  next_followup_at     timestamptz,
  completed_at         timestamptz,
  completed_by         uuid references public.people (id),
  completion_note      text,
  evidence_id          uuid,
  revision_required    boolean not null default false,
  created_rule_version text not null,
  assignment_rule_id   uuid references public.task_assignment_rules (id),
  created_at           timestamptz not null default now(),
  created_by           uuid references public.people (id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.people (id),
  version              integer not null default 1 check (version >= 1)
);
<<<<<<< HEAD

create index tasks_job_idx on public.tasks (job_id);

create index tasks_owner_open_idx on public.tasks (owner_id) where status in ('Open', 'Waiting', 'InProgress', 'Blocked');

=======
create index tasks_job_idx on public.tasks (job_id);
create index tasks_owner_open_idx on public.tasks (owner_id) where status in ('Open', 'Waiting', 'InProgress', 'Blocked');
>>>>>>> main
create index tasks_backup_open_idx on public.tasks (backup_id) where status in ('Open', 'Waiting', 'InProgress', 'Blocked');

-- -----------------------------------------------------------------------------
-- Commands: idempotency ledger. One row per committed command.
-- -----------------------------------------------------------------------------

create table public.commands (
  command_id      uuid primary key,
  command_type    text not null,
  actor_person_id uuid not null references public.people (id),
  -- sha256 over the canonical {type, actor, payload}. The actor is part of the
  -- fingerprint: the same id replayed by someone else is a conflict.
  fingerprint     text not null,
  result          jsonb,
  created_at      timestamptz not null default now()
);
<<<<<<< HEAD

=======
>>>>>>> main
create trigger commands_immutable before delete on public.commands
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Audit: entities keyed by `code` rather than `id` (task_templates) are audited
-- under that code. Otherwise identical to the identity-foundation function.
-- -----------------------------------------------------------------------------

create or replace function app.audit_row_change()
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
    coalesce(v_after ->> 'id', v_before ->> 'id', v_after ->> 'code', v_before ->> 'code'),
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

-- Row stamping for tables keyed by `code` as well as `id`. Otherwise identical
-- to the identity-foundation function.
create or replace function app.touch_row()
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

  if to_jsonb(new) -> 'id' is distinct from to_jsonb(old) -> 'id'
     or to_jsonb(new) -> 'code' is distinct from to_jsonb(old) -> 'code' then
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
-- Stamping + audit triggers (same machinery as the identity foundation)
-- -----------------------------------------------------------------------------

create trigger role_permissions_touch before insert or update on public.role_permissions
  for each row execute function app.touch_row();
<<<<<<< HEAD

create trigger customers_touch before insert or update on public.customers
  for each row execute function app.touch_row();

create trigger jobs_touch before insert or update on public.jobs
  for each row execute function app.touch_row();

create trigger task_templates_touch before insert or update on public.task_templates
  for each row execute function app.touch_row();

create trigger task_assignment_rules_touch before insert or update on public.task_assignment_rules
  for each row execute function app.touch_row();

=======
create trigger customers_touch before insert or update on public.customers
  for each row execute function app.touch_row();
create trigger jobs_touch before insert or update on public.jobs
  for each row execute function app.touch_row();
create trigger task_templates_touch before insert or update on public.task_templates
  for each row execute function app.touch_row();
create trigger task_assignment_rules_touch before insert or update on public.task_assignment_rules
  for each row execute function app.touch_row();
>>>>>>> main
create trigger tasks_touch before insert or update on public.tasks
  for each row execute function app.touch_row();

create function app.stamp_created()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.created_at := now();
  new.created_by := app.current_person_id();
  return new;
end
$$;
<<<<<<< HEAD

=======
>>>>>>> main
create trigger presales_stamp before insert on public.presales
  for each row execute function app.stamp_created();

create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function app.audit_row_change();
<<<<<<< HEAD

create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function app.audit_row_change();

create trigger jobs_audit after insert or update or delete on public.jobs
  for each row execute function app.audit_row_change();

create trigger presales_audit after insert on public.presales
  for each row execute function app.audit_row_change();

create trigger task_templates_audit after insert or update or delete on public.task_templates
  for each row execute function app.audit_row_change();

create trigger task_assignment_rules_audit after insert or update or delete on public.task_assignment_rules
  for each row execute function app.audit_row_change();

=======
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function app.audit_row_change();
create trigger jobs_audit after insert or update or delete on public.jobs
  for each row execute function app.audit_row_change();
create trigger presales_audit after insert on public.presales
  for each row execute function app.audit_row_change();
create trigger task_templates_audit after insert or update or delete on public.task_templates
  for each row execute function app.audit_row_change();
create trigger task_assignment_rules_audit after insert or update or delete on public.task_assignment_rules
  for each row execute function app.audit_row_change();
>>>>>>> main
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Domain helpers
-- -----------------------------------------------------------------------------

-- Next staffed day at 09:00 Europe/London. Staffed = Mon-Fri (the R1 reference
-- passes no holidays). The reference wrote a literal 09:00Z, an hour out in
-- summer; this is local office time.
create function app.next_staffed_day(from_ts timestamptz)
returns timestamptz
language plpgsql stable set search_path = ''
as $$
declare
  d date := (from_ts at time zone 'Europe/London')::date + 1;
begin
  while extract(isodow from d) in (6, 7) loop
    d := d + 1;
  end loop;
  return (d + time '09:00') at time zone 'Europe/London';
end
$$;

-- SS-XXXX-0000 using the reference alphabet (no I, no O).
create function app.generate_job_ref()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
begin
  for attempt in 1..20 loop
    candidate := 'SS-';
    for i in 1..4 loop
      candidate := candidate || substr(letters, 1 + floor(random() * 24)::int, 1);
    end loop;
    candidate := candidate || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.jobs where job_ref = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'JOB_ID_COLLISION_EXHAUSTED' using errcode = 'P0001';
end
$$;

-- Deterministic task ownership. Fails visibly; never falls back to another person.
create function app.resolve_task_assignment(
  p_template_code text,
  out rule_id uuid,
  out owner_id uuid,
  out backup_id uuid
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.task_assignment_rules;
begin
  select * into r from public.task_assignment_rules
   where template_code = p_template_code and active;
  if not found then
    raise exception 'TASK_ASSIGNMENT_CONFIG' using errcode = 'P0001',
      detail = format('no active assignment rule for %s', p_template_code);
  end if;

  if not exists (
    select 1 from public.people p
    join public.person_roles pr on pr.person_id = p.id and pr.active
    where p.id = r.owner_person_id and p.active and pr.role_code = any (r.eligible_owner_roles)
  ) then
    raise exception 'TASK_ASSIGNMENT_CONFIG' using errcode = 'P0001',
      detail = format('owner for %s must be an active person with an eligible role', p_template_code);
  end if;

  rule_id  := r.id;
  owner_id := r.owner_person_id;
  -- A missing, inactive or ineligible backup is nobody - never somebody else.
  select p.id into backup_id from public.people p
   where p.id = r.backup_person_id and p.active
     and exists (select 1 from public.person_roles pr
                 where pr.person_id = p.id and pr.active and pr.role_code = any (r.eligible_owner_roles));
end
$$;

create function app.create_task(
  p_job_id uuid, p_template_code text, p_now timestamptz
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.task_templates;
  a record;
  v_due timestamptz;
  v_id uuid;
begin
  select * into t from public.task_templates where code = p_template_code and active;
  if not found then
    raise exception 'TASK_TEMPLATE_CONFIG' using errcode = 'P0001',
      detail = format('active template %s is required', p_template_code);
  end if;
  a := app.resolve_task_assignment(p_template_code);
  v_due := case t.due_rule
             when 'at_creation' then p_now
             when 'next_staffed_day' then app.next_staffed_day(p_now)
           end;
  insert into public.tasks (
    job_id, template_code, instance_key, task_group, title, owner_id, backup_id,
    related_entity_type, related_entity_id, due_at, original_due_at, priority,
    created_rule_version, assignment_rule_id
  ) values (
    p_job_id, t.code, t.code || '-' || p_job_id || '-ROOT-nodue', t.task_group, t.title,
    a.owner_id, a.backup_id, 'jobs', p_job_id, v_due, v_due, t.default_priority,
    t.template_version, a.rule_id
  ) returning id into v_id;
  return v_id;
end
$$;

-- Payload helpers ------------------------------------------------------------

create function app.reject(code text, detail text default null, field text default null)
returns void language plpgsql set search_path = ''
as $$
begin
  raise exception '%', code using errcode = 'P0001', detail = coalesce(detail, ''), hint = coalesce(field, '');
end
$$;

-- Strict allow-list: unknown keys are refused (reference R1A_INVALID_FIELDS).
create function app.assert_object(obj jsonb, allowed text[], ctx text)
returns void language plpgsql set search_path = ''
as $$
declare k text;
begin
  if obj is null or jsonb_typeof(obj) <> 'object' then
    perform app.reject('INVALID_FIELDS', ctx || ' must be an object', ctx);
  end if;
  for k in select jsonb_object_keys(obj) loop
    if not (k = any (allowed)) then
      perform app.reject('INVALID_FIELDS', format('unknown field %s.%s', ctx, k), ctx || '.' || k);
    end if;
  end loop;
end
$$;

-- Trimmed text or null. Non-string values are refused.
create function app.text_field(obj jsonb, key text, ctx text, required boolean, max_len integer)
returns text language plpgsql set search_path = ''
as $$
declare v text;
begin
  if obj ? key and jsonb_typeof(obj -> key) not in ('string', 'null') then
    perform app.reject('INVALID_FIELDS', format('%s.%s must be text', ctx, key), ctx || '.' || key);
  end if;
  v := nullif(btrim(obj ->> key), '');
  if v is null and required then
    perform app.reject('REQUIRED_' || upper(key), null, ctx || '.' || key);
  end if;
  if length(v) > max_len then
    perform app.reject('TOO_LONG_' || upper(key), null, ctx || '.' || key);
  end if;
  return v;
end
$$;

create function app.bool_field(obj jsonb, key text, ctx text)
returns boolean language plpgsql set search_path = ''
as $$
begin
  if not (obj ? key) or jsonb_typeof(obj -> key) <> 'boolean' then
    perform app.reject('REQUIRED_' || upper(key), format('%s.%s must be true or false', ctx, key), ctx || '.' || key);
  end if;
  return (obj ->> key)::boolean;
end
$$;

-- -----------------------------------------------------------------------------
-- SOLD_INTAKE
--
-- One transaction: customer -> job -> presale -> PRE tasks -> audit -> result.
-- The actor is ALWAYS app.current_person_id(); nothing in the payload can name
-- the actor. Any rejection raises, so no partial business state can exist.
-- -----------------------------------------------------------------------------

create function public.submit_presale(p_command_id uuid, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor        uuid := app.current_person_id();
  v_now          timestamptz := now();
  v_fingerprint  text;
  v_existing     public.commands;
  c jsonb; s jsonb; sc jsonb; cp jsonb;
  v_first text; v_last text; v_addr1 text; v_addr2 text; v_town text;
  v_postcode text; v_phone text; v_email text;
  v_salesperson uuid; v_lead text; v_quote text; v_route text; v_price bigint;
  v_roof boolean; v_elec boolean; v_scaf boolean; v_roof_notes text; v_elec_notes text;
  v_schema_version integer; v_catalogue text; v_kwp numeric; v_panels integer; v_computed bigint;
  v_customer_id uuid; v_job_id uuid; v_presale_id uuid; v_job_ref text;
  v_result jsonb;
begin
  -- 1. Actor + authorization (checked on replays too).
  if v_actor is null or not app.is_active_actor() then
    perform app.reject('NOT_AUTHENTICATED');
  end if;
  if not app.has_permission('presale.submit') then
    perform app.reject('PERMISSION_DENIED', 'presale.submit is required');
  end if;
  if p_command_id is null then
    perform app.reject('INVALID_COMMAND_ID');
  end if;

  -- 2. Shape: strict allow-lists at every level.
  perform app.assert_object(p_payload, array['customer','sale','scope','design','design_schema_version','catalogue_version','computed'], 'payload');
  c := p_payload -> 'customer'; s := p_payload -> 'sale'; sc := p_payload -> 'scope'; cp := p_payload -> 'computed';
  perform app.assert_object(c,  array['first_name','last_name','address_line1','address_line2','town','postcode','phone','email'], 'customer');
  perform app.assert_object(s,  array['salesperson_id','lead_source','quote_reference','finance_route','agreed_price_pence'], 'sale');
  perform app.assert_object(sc, array['roof_required','electrical_required','scaffold_required','roof_notes','electrical_notes'], 'scope');
  perform app.assert_object(cp, array['system_kwp','net_panels','computed_total_pence','price_breakdown'], 'computed');
  if jsonb_typeof(p_payload -> 'design') is distinct from 'object' then
    perform app.reject('INVALID_FIELDS', 'design must be an object', 'design');
  end if;

  -- 3. Customer: trim; postcode upper-case + valid UK format; email lower-case.
  v_first := app.text_field(c, 'first_name', 'customer', true, 100);
  v_last  := app.text_field(c, 'last_name', 'customer', true, 100);
  v_addr1 := app.text_field(c, 'address_line1', 'customer', true, 200);
  v_addr2 := app.text_field(c, 'address_line2', 'customer', false, 200);
  v_town  := app.text_field(c, 'town', 'customer', true, 100);
  v_postcode := upper(regexp_replace(coalesce(app.text_field(c, 'postcode', 'customer', true, 12), ''), '\s+', '', 'g'));
  if v_postcode !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then
    perform app.reject('INVALID_POSTCODE', null, 'customer.postcode');
  end if;
  v_postcode := left(v_postcode, length(v_postcode) - 3) || ' ' || right(v_postcode, 3);
  v_phone := app.text_field(c, 'phone', 'customer', false, 40);
  v_email := lower(app.text_field(c, 'email', 'customer', false, 254));
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform app.reject('INVALID_EMAIL', null, 'customer.email');
  end if;
  if v_phone is null and v_email is null then
    perform app.reject('CONTACT_METHOD_REQUIRED', 'a phone number or an email address is required', 'customer.phone');
  end if;

  -- 4. Sale.
  v_route := app.text_field(s, 'finance_route', 'sale', true, 20);
  if v_route not in ('Standard', 'Phoenix', 'OtherReview') then
    perform app.reject('INVALID_FINANCE_ROUTE', null, 'sale.finance_route');
  end if;
  if jsonb_typeof(s -> 'agreed_price_pence') is distinct from 'number'
     or (s ->> 'agreed_price_pence') !~ '^[0-9]{1,15}$' then
    perform app.reject('INVALID_GROSS_AMOUNT', 'agreed_price_pence must be a whole number of pence', 'sale.agreed_price_pence');
  end if;
  v_price := (s ->> 'agreed_price_pence')::bigint;
  if v_price <= 0 or v_price > 9007199254740991 then
    perform app.reject('INVALID_GROSS_AMOUNT', 'the agreed price must be greater than zero', 'sale.agreed_price_pence');
  end if;
  v_lead  := app.text_field(s, 'lead_source', 'sale', false, 200);
  v_quote := app.text_field(s, 'quote_reference', 'sale', false, 200);

  -- Salesperson: must be an active Surveyor. Only holders of
  -- presale.submit_on_behalf may name someone other than themselves.
  begin
    v_salesperson := nullif(btrim(s ->> 'salesperson_id'), '')::uuid;
  exception when invalid_text_representation then
    perform app.reject('SALESPERSON_NOT_FOUND', null, 'sale.salesperson_id');
  end;
  if v_salesperson is null then
    perform app.reject('REQUIRED_SALESPERSON_ID', null, 'sale.salesperson_id');
  end if;
  if v_salesperson <> v_actor and not app.has_permission('presale.submit_on_behalf') then
    perform app.reject('SALESPERSON_MUST_BE_SELF', null, 'sale.salesperson_id');
  end if;
  if not exists (
    select 1 from public.people p
    join public.person_roles pr on pr.person_id = p.id and pr.active and pr.role_code = 'Surveyor'
    where p.id = v_salesperson and p.active
  ) then
    perform app.reject('SALESPERSON_NOT_FOUND', 'the salesperson must be an active Surveyor', 'sale.salesperson_id');
  end if;

  -- 5. Scope + designer snapshot.
  v_roof := app.bool_field(sc, 'roof_required', 'scope');
  v_elec := app.bool_field(sc, 'electrical_required', 'scope');
  v_scaf := app.bool_field(sc, 'scaffold_required', 'scope');
  v_roof_notes := app.text_field(sc, 'roof_notes', 'scope', false, 4000);
  v_elec_notes := app.text_field(sc, 'electrical_notes', 'scope', false, 4000);

  if jsonb_typeof(p_payload -> 'design_schema_version') is distinct from 'number'
     or (p_payload ->> 'design_schema_version') !~ '^[0-9]{1,6}$' then
    perform app.reject('INVALID_FIELDS', 'design_schema_version must be a whole number', 'design_schema_version');
  end if;
  v_schema_version := (p_payload ->> 'design_schema_version')::integer;
  v_catalogue := app.text_field(p_payload, 'catalogue_version', 'payload', true, 100);
  if jsonb_typeof(cp -> 'system_kwp') is distinct from 'number'
     or jsonb_typeof(cp -> 'net_panels') is distinct from 'number'
     or jsonb_typeof(cp -> 'computed_total_pence') is distinct from 'number'
     or jsonb_typeof(cp -> 'price_breakdown') is distinct from 'array'
     or (cp ->> 'net_panels') !~ '^[0-9]{1,6}$'
     or (cp ->> 'computed_total_pence') !~ '^[0-9]{1,15}$' then
    perform app.reject('INVALID_FIELDS', 'computed values are malformed', 'computed');
  end if;
  v_kwp := round((cp ->> 'system_kwp')::numeric, 2);
  v_panels := (cp ->> 'net_panels')::integer;
  v_computed := (cp ->> 'computed_total_pence')::bigint;
  if v_kwp < 0 or v_kwp > 999999 then
    perform app.reject('INVALID_FIELDS', 'system_kwp out of range', 'computed.system_kwp');
  end if;

  -- 6. Idempotency. jsonb::text is canonical (sorted keys, normalised numbers).
  v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
    'type', 'SOLD_INTAKE', 'actor', v_actor, 'payload', p_payload)::text, 'UTF8')), 'hex');

  insert into public.commands (command_id, command_type, actor_person_id, fingerprint)
  values (p_command_id, 'SOLD_INTAKE', v_actor, v_fingerprint)
  on conflict (command_id) do nothing;

  if not found then
    -- A concurrent first attempt has committed by the time we get here.
    select * into v_existing from public.commands where command_id = p_command_id;
    if v_existing.fingerprint <> v_fingerprint or v_existing.command_type <> 'SOLD_INTAKE' then
      perform app.reject('COMMAND_ID_CONFLICT', 'this command id was already used with different content');
    end if;
    if v_existing.result is null then
      perform app.reject('COMMAND_IN_PROGRESS');
    end if;
    return v_existing.result || jsonb_build_object('replay', true);
  end if;

  -- 7. Business effects. Audit rows are written by triggers and carry these.
  perform set_config('app.command_id', p_command_id::text, true);
  perform set_config('app.executing_service', 'command:SOLD_INTAKE', true);

  insert into public.customers (first_name, last_name, address_line1, address_line2, town, postcode, email, phone)
  values (v_first, v_last, v_addr1, v_addr2, v_town, v_postcode, v_email, v_phone)
  returning id into v_customer_id;

  v_job_ref := app.generate_job_ref();
  insert into public.jobs (
    job_ref, customer_id, display_name, sold_at, salesperson_id, lead_source, quote_reference,
    finance_route, original_gross_pence, current_contract_gross_pence,
    roof_required, electrical_required, scaffold_required, workflow_stage
  ) values (
    v_job_ref, v_customer_id, v_last || ' – ' || v_postcode, v_now, v_salesperson, v_lead, v_quote,
    v_route, v_price, v_price, v_roof, v_elec, v_scaf, 'Prebooking'
  ) returning id into v_job_id;

  insert into public.presales (
    job_id, surveyor_id, submitted_at, roof_notes, electrical_notes, design, design_schema_version,
    catalogue_version, system_kwp, net_panels, computed_total_pence, agreed_price_pence, price_breakdown
  ) values (
    v_job_id, v_salesperson, v_now, v_roof_notes, v_elec_notes, p_payload -> 'design', v_schema_version,
    v_catalogue, v_kwp, v_panels, v_computed, v_price, cp -> 'price_breakdown'
  ) returning id into v_presale_id;

  -- PRE tasks depend on the finance route (reference s06/gates.js:700-717).
  if v_route = 'Standard' then
    perform app.create_task(v_job_id, 'PRE01', v_now);
  end if;
  perform app.create_task(v_job_id, 'PRE02', v_now);
  if v_route = 'Standard' then
    perform app.create_task(v_job_id, 'PRE03', v_now);
  end if;
  perform app.create_task(v_job_id, 'PRE04', v_now);
  if v_route <> 'Standard' then
    perform app.create_task(v_job_id, 'PRE05', v_now);
  end if;

  -- 8. Result (stored, so a replay returns exactly this).
  select jsonb_build_object(
    'job_id', v_job_id, 'job_ref', v_job_ref, 'customer_id', v_customer_id, 'presale_id', v_presale_id,
    'workflow_stage', 'Prebooking', 'replay', false,
    'customer', jsonb_build_object('display_name', v_first || ' ' || v_last, 'postcode', v_postcode),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', t.template_code, 'title', t.title, 'owner_name', o.display_name,
               'backup_name', b.display_name, 'due_at', t.due_at, 'priority', t.priority)
             order by t.template_code)
      from public.tasks t
      join public.people o on o.id = t.owner_id
      left join public.people b on b.id = t.backup_id
      where t.job_id = v_job_id), '[]'::jsonb)
  ) into v_result;

  update public.commands set result = v_result where command_id = p_command_id;
  return v_result;
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges + RLS. Clients can never write core business tables directly:
-- no INSERT/UPDATE/DELETE grant exists on customers, jobs, presales, tasks or
-- commands. Configuration tables are Admin-editable through RLS and audited.
-- -----------------------------------------------------------------------------

revoke all on public.permissions, public.role_permissions, public.customers, public.jobs, public.presales,
              public.task_templates, public.task_assignment_rules, public.tasks, public.commands
  from anon, authenticated;

grant select on public.permissions, public.role_permissions, public.customers, public.jobs, public.presales,
                public.task_templates, public.task_assignment_rules, public.tasks, public.commands
  to authenticated;
<<<<<<< HEAD

grant insert, update on public.role_permissions, public.task_templates, public.task_assignment_rules to authenticated;

grant delete on public.role_permissions to authenticated;

revoke execute on all functions in schema app from public, anon;

grant execute on all functions in schema app to authenticated, service_role;

revoke execute on function public.submit_presale(uuid, jsonb) from public, anon;

grant execute on function public.submit_presale(uuid, jsonb) to authenticated;

alter table public.permissions           enable row level security;

alter table public.role_permissions      enable row level security;

alter table public.customers             enable row level security;

alter table public.jobs                  enable row level security;

alter table public.presales              enable row level security;

alter table public.task_templates        enable row level security;

alter table public.task_assignment_rules enable row level security;

alter table public.tasks                 enable row level security;

alter table public.commands              enable row level security;

drop policy if exists permissions_select on public.permissions;

create policy permissions_select on public.permissions
  for select to authenticated using ((select app.is_active_actor()));

create policy role_permissions_select on public.role_permissions
  for select to authenticated using ((select app.is_active_actor()));

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated with check ((select app.is_admin()));

create policy role_permissions_update on public.role_permissions
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

=======
grant insert, update on public.role_permissions, public.task_templates, public.task_assignment_rules to authenticated;
grant delete on public.role_permissions to authenticated;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function public.submit_presale(uuid, jsonb) from public, anon;
grant execute on function public.submit_presale(uuid, jsonb) to authenticated;

alter table public.permissions           enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.customers             enable row level security;
alter table public.jobs                  enable row level security;
alter table public.presales              enable row level security;
alter table public.task_templates        enable row level security;
alter table public.task_assignment_rules enable row level security;
alter table public.tasks                 enable row level security;
alter table public.commands              enable row level security;

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select to authenticated using ((select app.is_active_actor()));
create policy role_permissions_select on public.role_permissions
  for select to authenticated using ((select app.is_active_actor()));
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated with check ((select app.is_admin()));
create policy role_permissions_update on public.role_permissions
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
>>>>>>> main
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated using ((select app.is_admin()));

-- Tasks: authorization is assignment-based, separately from job visibility.
create policy tasks_select on public.tasks
  for select to authenticated using (
    (select app.has_permission('task.read.all'))
    or ((select app.is_active_actor())
        and (owner_id = (select app.current_person_id()) or backup_id = (select app.current_person_id())))
  );

-- Jobs: office-class read all; a Surveyor reads their own; anyone assigned a task on it reads it.
create policy jobs_select on public.jobs
  for select to authenticated using (
    (select app.has_permission('job.read.all'))
    or ((select app.has_permission('job.read.own'))
        and (salesperson_id = (select app.current_person_id()) or created_by = (select app.current_person_id())))
    or exists (select 1 from public.tasks t where t.job_id = jobs.id)
  );

-- Customers and presales follow job visibility (the subquery runs under jobs RLS).
create policy customers_select on public.customers
  for select to authenticated using (exists (select 1 from public.jobs j where j.customer_id = customers.id));
<<<<<<< HEAD

=======
>>>>>>> main
create policy presales_select on public.presales
  for select to authenticated using (exists (select 1 from public.jobs j where j.id = presales.job_id));

create policy task_templates_select on public.task_templates
  for select to authenticated using ((select app.is_active_actor()));
<<<<<<< HEAD

create policy task_templates_insert on public.task_templates
  for insert to authenticated with check ((select app.is_admin()));

=======
create policy task_templates_insert on public.task_templates
  for insert to authenticated with check ((select app.is_admin()));
>>>>>>> main
create policy task_templates_update on public.task_templates
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy task_assignment_rules_select on public.task_assignment_rules
  for select to authenticated using ((select app.has_permission('task.read.all')));
<<<<<<< HEAD

create policy task_assignment_rules_insert on public.task_assignment_rules
  for insert to authenticated with check ((select app.is_admin()));

=======
create policy task_assignment_rules_insert on public.task_assignment_rules
  for insert to authenticated with check ((select app.is_admin()));
>>>>>>> main
create policy task_assignment_rules_update on public.task_assignment_rules
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy commands_select on public.commands
  for select to authenticated using (
    (select app.is_admin())
    or ((select app.is_active_actor()) and actor_person_id = (select app.current_person_id()))
  );

-- -----------------------------------------------------------------------------
-- Configuration data
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('presale.submit',           'Submit a Presale / Job Sold.'),
  ('presale.submit_on_behalf', 'Submit a Presale naming another active Surveyor as the salesperson.'),
  ('job.read.own',             'Read jobs where you are the salesperson or the submitter.'),
  ('job.read.all',             'Read every job, its customer and its presale.'),
  ('task.read.all',            'Read every task and the task assignment rules.')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('Surveyor', 'presale.submit'),
  ('Surveyor', 'job.read.own'),
  ('Office',   'presale.submit'), ('Office',   'presale.submit_on_behalf'),
  ('Admin',    'presale.submit'), ('Admin',    'presale.submit_on_behalf'),
  ('Manager',  'presale.submit'), ('Manager',  'presale.submit_on_behalf'),
  ('Office',   'job.read.all'),   ('Admin',    'job.read.all'),   ('Manager', 'job.read.all'),
  ('Director', 'job.read.all'),   ('VariationApprover', 'job.read.all'),
  ('Office',   'task.read.all'),  ('Admin',    'task.read.all'),  ('Manager', 'task.read.all'),
  ('Director', 'task.read.all');

-- Titles verbatim from the reference seed (schema/config-seed.json).
insert into public.task_templates (code, title, task_group, default_priority, due_rule, guidance) values
  ('PRE01', 'Send deposit invoice',                             'Prebooking', 1, 'at_creation',      'Confirmed invoice ID and sent status'),
  ('PRE02', 'Check contract sent/signed',                       'Prebooking', 1, 'at_creation',      'Signable reference and signed evidence'),
  ('PRE03', 'Confirm bank deposit',                             'Prebooking', 2, 'next_staffed_day', 'Verified amount/date'),
  ('PRE04', 'Check customer details and sold/presale amount',   'Prebooking', 2, 'none',             'Checked fields and source references'),
  ('PRE05', 'Check finance agreement approval',                 'Prebooking', 2, 'none',             'Provider/agreement evidence');

-- Task assignment rules reference people, so they are seeded after the staff
-- directory: see supabase/seeds/002_task_assignment_rules.sql.

-- =============================================================================
-- 3. Reconnect the reference-schema tables to the canonical tables.
--    One source of truth: no parallel Person / Job / Task models.
-- =============================================================================

do $$
declare
  fk record;
  v_name text;
begin
  for fk in
    select * from (values
    ('companies', 'created_by', 'people', 'id', ''),
    ('companies', 'updated_by', 'people', 'id', ''),
    ('contacts', 'verified_by', 'people', 'id', ''),
    ('contacts', 'created_by', 'people', 'id', ''),
    ('contacts', 'updated_by', 'people', 'id', ''),
    ('person_availability', 'person_id', 'people', 'id', 'on delete restrict'),
    ('person_availability', 'approved_by', 'people', 'id', ''),
    ('person_availability', 'created_by', 'people', 'id', ''),
    ('person_availability', 'updated_by', 'people', 'id', ''),
    ('teams', 'created_by', 'people', 'id', ''),
    ('teams', 'updated_by', 'people', 'id', ''),
    ('team_members', 'person_id', 'people', 'id', 'on delete restrict'),
    ('team_members', 'created_by', 'people', 'id', ''),
    ('team_members', 'updated_by', 'people', 'id', ''),
    ('holidays', 'created_by', 'people', 'id', ''),
    ('holidays', 'updated_by', 'people', 'id', ''),
    ('settings', 'changed_by', 'people', 'id', ''),
    ('release_modes', 'created_by', 'people', 'id', ''),
    ('release_modes', 'updated_by', 'people', 'id', ''),
    ('intake', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('mapping_rules', 'created_by', 'people', 'id', ''),
    ('mapping_rules', 'updated_by', 'people', 'id', ''),
    ('customer_changes', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('customer_changes', 'resolved_by', 'people', 'id', ''),
    ('work_packages', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('work_packages', 'installer_confirmation_by', 'people', 'id', ''),
    ('work_packages', 'created_by', 'people', 'id', ''),
    ('work_packages', 'updated_by', 'people', 'id', ''),
    ('allocations', 'person_id', 'people', 'id', 'on delete restrict'),
    ('allocations', 'created_by', 'people', 'id', ''),
    ('allocations', 'updated_by', 'people', 'id', ''),
    ('task_dependencies', 'task_id', 'tasks', 'id', 'on delete restrict'),
    ('task_dependencies', 'prerequisite_task_id', 'tasks', 'id', 'on delete restrict'),
    ('task_events', 'task_id', 'tasks', 'id', 'on delete restrict'),
    ('task_events', 'old_owner', 'people', 'id', ''),
    ('task_events', 'new_owner', 'people', 'id', ''),
    ('task_events', 'actor', 'people', 'id', ''),
    ('calls', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('calls', 'task_id', 'tasks', 'id', 'on delete restrict'),
    ('calls', 'person_id', 'people', 'id', ''),
    ('calls', 'attempted_by', 'people', 'id', ''),
    ('issues', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('issues', 'raised_by', 'people', 'id', ''),
    ('issues', 'responsible_person_id', 'people', 'id', ''),
    ('issues', 'office_owner_id', 'people', 'id', ''),
    ('issues', 'approved_by', 'people', 'id', ''),
    ('issues', 'closed_by', 'people', 'id', ''),
    ('issues', 'created_by', 'people', 'id', ''),
    ('issues', 'updated_by', 'people', 'id', ''),
    ('issue_events', 'actor', 'people', 'id', ''),
    ('products', 'created_by', 'people', 'id', ''),
    ('products', 'updated_by', 'people', 'id', ''),
    ('stock_locations', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('stock_locations', 'created_by', 'people', 'id', ''),
    ('stock_locations', 'updated_by', 'people', 'id', ''),
    ('materials', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('materials', 'created_by', 'people', 'id', ''),
    ('materials', 'updated_by', 'people', 'id', ''),
    ('orders', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('orders', 'confirmed_by', 'people', 'id', ''),
    ('orders', 'created_by', 'people', 'id', ''),
    ('orders', 'updated_by', 'people', 'id', ''),
    ('deliveries', 'received_by', 'people', 'id', ''),
    ('reservations', 'picked_by', 'people', 'id', ''),
    ('reservations', 'created_by', 'people', 'id', ''),
    ('reservations', 'updated_by', 'people', 'id', ''),
    ('stock_movements', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('stocktakes', 'counted_by', 'people', 'id', ''),
    ('stocktakes', 'approved_by', 'people', 'id', ''),
    ('panel_use', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('panel_use', 'reported_by', 'people', 'id', ''),
    ('panel_use', 'reviewed_by', 'people', 'id', ''),
    ('scaffold_bookings', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('scaffold_bookings', 'strip_authorised_by', 'people', 'id', ''),
    ('scaffold_bookings', 'created_by', 'people', 'id', ''),
    ('scaffold_bookings', 'updated_by', 'people', 'id', ''),
    ('communications', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('communications', 'approved_by', 'people', 'id', ''),
    ('communications', 'created_by', 'people', 'id', ''),
    ('communications', 'updated_by', 'people', 'id', ''),
    ('communication_jobs', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('acknowledgements', 'recorded_by', 'people', 'id', ''),
    ('calendar_links', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('calendar_links', 'created_by', 'people', 'id', ''),
    ('calendar_links', 'updated_by', 'people', 'id', ''),
    ('commissioning_templates', 'approved_by', 'people', 'id', ''),
    ('commissioning_templates', 'created_by', 'people', 'id', ''),
    ('commissioning_templates', 'updated_by', 'people', 'id', ''),
    ('commissioning_questions', 'created_by', 'people', 'id', ''),
    ('commissioning_questions', 'updated_by', 'people', 'id', ''),
    ('commissioning_submissions', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('commissioning_submissions', 'installer_id', 'people', 'id', ''),
    ('commissioning_submissions', 'reviewed_by', 'people', 'id', ''),
    ('commissioning_submissions', 'created_by', 'people', 'id', ''),
    ('commissioning_submissions', 'updated_by', 'people', 'id', ''),
    ('evidence', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('evidence', 'captured_by', 'people', 'id', ''),
    ('technical_details', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('technical_details', 'technical_review_by', 'people', 'id', ''),
    ('technical_details', 'created_by', 'people', 'id', ''),
    ('technical_details', 'updated_by', 'people', 'id', ''),
    ('job_equipment', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('job_equipment', 'created_by', 'people', 'id', ''),
    ('job_equipment', 'updated_by', 'people', 'id', ''),
    ('handover', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('handover', 'reviewed_by', 'people', 'id', ''),
    ('handover', 'approved_by', 'people', 'id', ''),
    ('handover', 'created_by', 'people', 'id', ''),
    ('handover', 'updated_by', 'people', 'id', ''),
    ('finance_plans', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('finance_plans', 'created_by', 'people', 'id', ''),
    ('finance_plans', 'updated_by', 'people', 'id', ''),
    ('invoice_stages', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('invoice_stages', 'created_by', 'people', 'id', ''),
    ('invoice_stages', 'updated_by', 'people', 'id', ''),
    ('manual_bank_checks', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('manual_bank_checks', 'checked_by', 'people', 'id', ''),
    ('accounting_events', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('accounting_events', 'reviewed_by', 'people', 'id', ''),
    ('accounting_events', 'created_by', 'people', 'id', ''),
    ('accounting_events', 'updated_by', 'people', 'id', ''),
    ('job_costs', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('job_costs', 'created_by', 'people', 'id', ''),
    ('job_costs', 'updated_by', 'people', 'id', ''),
    ('ghl_tasks', 'job_id', 'jobs', 'id', 'on delete restrict'),
    ('ghl_tasks', 'task_id', 'tasks', 'id', 'on delete restrict'),
    ('ghl_tasks', 'completed_by', 'people', 'id', ''),
    ('report_snapshots', 'generated_by', 'people', 'id', ''),
    ('health_checks', 'next_action_task_id', 'tasks', 'id', 'on delete restrict'),
    ('archive_index', 'job_id', 'jobs', 'id', 'on delete restrict')
    ) as t (tbl, col, ref_tbl, ref_col, on_delete)
  loop
    v_name := fk.tbl || '_' || fk.col || '_fkey';
    if to_regclass('public.' || fk.tbl) is null
       or not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = fk.tbl and column_name = fk.col)
       or exists (select 1 from pg_constraint
                  where conrelid = ('public.' || fk.tbl)::regclass and conname = v_name) then
      continue;
    end if;
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I (%I) %s',
                   fk.tbl, v_name, fk.col, fk.ref_tbl, fk.ref_col, fk.on_delete);
  end loop;
end
$$;
