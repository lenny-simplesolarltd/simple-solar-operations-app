-- =============================================================================
-- Reference-schema port, part 1: partner directory, resource planning and
-- system configuration.
--
-- Source: reference schema/tables.json (S02-1.0) - Companies, Contacts,
-- PersonAvailability, Teams, TeamMembers, Holidays, Settings, ReleaseModes.
--
-- Conventions for every table ported from tables.json (parts 1-8):
--   * TEXT ids become uuid primary keys; TEXT foreign keys become uuid FKs.
--   * Actor columns (*_by, actor, owner ids) reference public.people.
--   * TIMESTAMP -> timestamptz (UTC instant); DATE -> date (Europe/London
--     local date); DECIMAL -> numeric; *_pence -> bigint (integer pence).
--   * Enumerated vocabularies from the schema notes become CHECK constraints.
--   * *_json TEXT columns become jsonb; delimited id lists become arrays.
--   * Mutable records get row stamping + optimistic versioning
--     (app.touch_row) and row audit (app.audit_row_change), as in Migration 001.
--     Log / ledger tables are append-only.
--   * Not ported: commit_id, source_system (Sheets commit plumbing, replaced by
--     transactions + audit_events.command_id).
--
-- Tables deliberately excluded from this port (owned by the identity-foundation
-- and job-sold migrations): people, roles, person_roles, skills, person_skills,
-- audit_events, customers, jobs, presales, task_templates, tasks,
-- task_assignment_rules, commands, role_permissions.
--
-- Append-only tables reuse app.forbid_mutation() from the job-sold migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Partner directory
-- -----------------------------------------------------------------------------

create table public.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (btrim(name) <> ''),
  type               text not null check (type in ('Merchant', 'Scaffolder', 'FinanceProvider', 'Other')),
  active             boolean not null default true,
  standard_lead_days integer check (standard_lead_days >= 0),
  delivery_weekday   integer check (delivery_weekday between 1 and 7),
  notes              text,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.people (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.people (id),
  version            integer not null default 1 check (version >= 1)
);
comment on table public.companies is 'Merchant, scaffolder and finance provider directory.';
comment on column public.companies.delivery_weekday is 'ISO weekday: 1 = Monday ... 7 = Sunday.';

create table public.contacts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  name              text not null check (btrim(name) <> ''),
  -- Plain text: never inferred from name; phone keeps its leading zero.
  email             text,
  phone             text,
  contact_role      text,
  active            boolean not null default true,
  preferred_channel text,
  verified_at       timestamptz,
  verified_by       uuid references public.people (id),
  created_at        timestamptz not null default now(),
  created_by        uuid references public.people (id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.people (id),
  version           integer not null default 1 check (version >= 1)
);
comment on table public.contacts is 'People at partner companies.';
create index contacts_company_idx on public.contacts (company_id);

-- -----------------------------------------------------------------------------
-- Resource planning
-- -----------------------------------------------------------------------------

create table public.person_availability (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references public.people (id) on delete restrict,
  type        text not null check (type in ('Leave', 'Sick', 'Training', 'Unavailable', 'Available')),
  from_date   date not null,
  -- Inclusive; null means a single day.
  to_date     date,
  reason      text,
  approved_by uuid references public.people (id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.people (id),
  version     integer not null default 1 check (version >= 1),
  constraint person_availability_window check (to_date is null or from_date <= to_date)
);
comment on table public.person_availability is
  'Leave and other unavailability periods (resource planning). Dates are Europe/London local dates; to_date is inclusive, null = single day.';
create index person_availability_person_idx on public.person_availability (person_id, from_date) where active;

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  trade      text not null check (trade in ('Roof', 'Electrical', 'Mixed')),
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  created_by uuid references public.people (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.people (id),
  version    integer not null default 1 check (version >= 1)
);
comment on table public.teams is 'Flexible installer teams (no fixed crews invented).';

create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete restrict,
  person_id  uuid not null references public.people (id) on delete restrict,
  role       text not null check (role in ('Lead', 'Member', 'Apprentice')),
  from_date  date,
  to_date    date,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.people (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.people (id),
  version    integer not null default 1 check (version >= 1),
  constraint team_members_window check (from_date is null or to_date is null or from_date <= to_date)
);
comment on table public.team_members is 'Team membership with role.';
-- The reference id was TM-<team_id>-<person_id>: one membership row per pair.
create unique index team_members_team_person_key on public.team_members (team_id, person_id);
create index team_members_person_idx on public.team_members (person_id);

-- -----------------------------------------------------------------------------
-- System configuration
-- -----------------------------------------------------------------------------

create table public.holidays (
  id            uuid primary key default gen_random_uuid(),
  local_date    date not null unique,
  description   text not null,
  office_closed boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.people (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.people (id),
  version       integer not null default 1 check (version >= 1)
);
comment on table public.holidays is 'Office closure calendar (Europe/London local dates).';

create table public.settings (
  id             uuid primary key default gen_random_uuid(),
  key            text not null check (btrim(key) <> ''),
  typed_value    jsonb not null,
  scope          text not null,
  -- Configuration version, not a row-stamping version: a change is a new row.
  version        integer not null check (version >= 1),
  effective_from date not null,
  changed_by     uuid references public.people (id),
  reason         text,
  created_at     timestamptz not null default now(),
  unique (key, scope, version)
);
comment on table public.settings is
  'Versioned system configuration values. Rows are immutable; a change inserts the next version.';

create table public.release_modes (
  id                               uuid primary key default gen_random_uuid(),
  function_id                      text not null unique check (function_id ~ '^FN-[0-9]{2}$'),
  function_name                    text not null,
  mode                             text not null check (mode in ('Disabled', 'Manual', 'Automated')),
  mode_record_basis                text not null,
  -- RA01: pilot / non-pilot boundary.
  authorised_job_scope             text not null,
  target_release                   text not null check (target_release in ('R1', 'R2', 'R3', 'R4')),
  planned_target_mode              text not null check (planned_target_mode in ('Disabled', 'Manual', 'Automated')),
  -- RA01: existing route description and manual fallback procedure.
  current_system                   text not null,
  fallback                         text not null,
  external_ids_protected_reference text,
  activation_time                  timestamptz,
  approved_version                 text,
  ben_approval_reference           text,
  scope_boundary_notes             text,
  created_at                       timestamptz not null default now(),
  created_by                       uuid references public.people (id),
  updated_at                       timestamptz not null default now(),
  updated_by                       uuid references public.people (id),
  version                          integer not null default 1 check (version >= 1)
);
comment on table public.release_modes is 'RA01 per-function release mode tracking (FN-01 ... FN-20).';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger companies_touch before insert or update on public.companies
  for each row execute function app.touch_row();
create trigger contacts_touch before insert or update on public.contacts
  for each row execute function app.touch_row();
create trigger person_availability_touch before insert or update on public.person_availability
  for each row execute function app.touch_row();
create trigger teams_touch before insert or update on public.teams
  for each row execute function app.touch_row();
create trigger team_members_touch before insert or update on public.team_members
  for each row execute function app.touch_row();
create trigger release_modes_touch before insert or update on public.release_modes
  for each row execute function app.touch_row();
create trigger holidays_touch before insert or update on public.holidays
  for each row execute function app.touch_row();

-- Settings rows are immutable versions: stamp the author server-side.
create function app.stamp_setting()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.created_at := now();
  new.changed_by := app.current_person_id();
  return new;
end
$$;

create trigger settings_stamp before insert on public.settings
  for each row execute function app.stamp_setting();

create trigger companies_audit after insert or update or delete on public.companies
  for each row execute function app.audit_row_change();
create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function app.audit_row_change();
create trigger person_availability_audit after insert or update or delete on public.person_availability
  for each row execute function app.audit_row_change();
create trigger teams_audit after insert or update or delete on public.teams
  for each row execute function app.audit_row_change();
create trigger team_members_audit after insert or update or delete on public.team_members
  for each row execute function app.audit_row_change();
create trigger holidays_audit after insert or update or delete on public.holidays
  for each row execute function app.audit_row_change();
create trigger settings_audit after insert on public.settings
  for each row execute function app.audit_row_change();
create trigger release_modes_audit after insert or update or delete on public.release_modes
  for each row execute function app.audit_row_change();

create trigger settings_no_update_delete before update or delete on public.settings
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Privileges + RLS (fail closed; no DELETE - rows are deactivated)
-- -----------------------------------------------------------------------------

revoke all on public.companies, public.contacts, public.person_availability, public.teams,
              public.team_members, public.holidays, public.settings, public.release_modes
  from anon, authenticated;

grant select, insert, update on public.companies, public.contacts, public.person_availability,
                                public.teams, public.team_members, public.holidays,
                                public.release_modes
  to authenticated;
grant select, insert on public.settings to authenticated;

revoke execute on function app.stamp_setting() from public, anon;

alter table public.companies           enable row level security;
alter table public.contacts            enable row level security;
alter table public.person_availability enable row level security;
alter table public.teams               enable row level security;
alter table public.team_members        enable row level security;
alter table public.holidays            enable row level security;
alter table public.settings            enable row level security;
alter table public.release_modes       enable row level security;

-- Directory + calendar: readable by any active actor; maintained by
-- Admin / Manager / Office.
create policy companies_select on public.companies
  for select to authenticated using ((select app.is_active_actor()));
create policy companies_insert on public.companies
  for insert to authenticated with check ((select app.is_office_manager()));
create policy companies_update on public.companies
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy contacts_select on public.contacts
  for select to authenticated using ((select app.is_active_actor()));
create policy contacts_insert on public.contacts
  for insert to authenticated with check ((select app.is_office_manager()));
create policy contacts_update on public.contacts
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy holidays_select on public.holidays
  for select to authenticated using ((select app.is_active_actor()));
create policy holidays_insert on public.holidays
  for insert to authenticated with check ((select app.is_office_manager()));
create policy holidays_update on public.holidays
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

-- Resource planning: configured by Admin / Manager / Office (reference
-- RP_CONFIG_ROLES); a person sees their own rows, office-class see all.
create policy person_availability_select on public.person_availability
  for select to authenticated
  using (
    ((select app.is_active_actor()) and person_id = (select app.current_person_id()))
    or (select app.is_office_class())
  );
create policy person_availability_insert on public.person_availability
  for insert to authenticated with check ((select app.is_office_manager()));
create policy person_availability_update on public.person_availability
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy teams_select on public.teams
  for select to authenticated using ((select app.is_active_actor()));
create policy teams_insert on public.teams
  for insert to authenticated with check ((select app.is_office_manager()));
create policy teams_update on public.teams
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy team_members_select on public.team_members
  for select to authenticated using ((select app.is_active_actor()));
create policy team_members_insert on public.team_members
  for insert to authenticated with check ((select app.is_office_manager()));
create policy team_members_update on public.team_members
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

-- System configuration: Admin-class only.
create policy settings_select on public.settings
  for select to authenticated using ((select app.is_admin()));
create policy settings_insert on public.settings
  for insert to authenticated with check ((select app.is_admin()));

create policy release_modes_select on public.release_modes
  for select to authenticated using ((select app.is_admin()));
create policy release_modes_insert on public.release_modes
  for insert to authenticated with check ((select app.is_admin()));
create policy release_modes_update on public.release_modes
  for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
<<<<<<< HEAD
=======

>>>>>>> main
