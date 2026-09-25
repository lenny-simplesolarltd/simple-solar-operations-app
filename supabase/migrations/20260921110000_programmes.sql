-- =============================================================================
-- Operational programmes: a contract covering many properties, each visited by
-- a field worker, each visit reviewed by the office.
--
-- The first configured programme is "PCH Meter SIM Replacement 2026"
-- (~1,400 properties, 150-200 visits/day, three weeks), but nothing in this
-- migration is about PCH. A programme is configuration: which form the field
-- visit uses, which of that form's questions carry which canonical value, what
-- the signal thresholds are, and how much of the property list a field worker
-- may see.
--
-- WHAT IS REUSED, NOT REBUILT
-- ---------------------------
--   * the Form Builder. The installer form is an ordinary published form. The
--     generic capabilities it needs (photo answers, entity lookup, conditions
--     over a set) were added to Forms itself in 20260921100000 and are useful
--     to any form. There is no second form engine and no PCH field component.
--   * public.evidence and the private 'evidence' bucket. A programme file is an
--     evidence row with scope 'Programme', registered through the SAME
--     three-step upload (register -> signed URL -> confirm), served through the
--     SAME /api/evidence/<id> route, authorized by the SAME
--     app.can_read_evidence. No PCH bucket, no second file system.
--   * public.execute_command, app.command_registry, the `commands` idempotency
--     ledger and app.audit. Every write below is a command; there is no client
--     write path to any table here (RLS grants SELECT only).
--   * public.permissions / role_permissions. Capability permissions, not role
--     names, decide what the UI offers and what the handlers allow.
--   * public.execute_operations_read / app.read_registry for the aggregates.
--   * the RA01 release-mode register: FN-22, seeded Disabled.
--
-- WHY NOT SIX TABLES
-- ------------------
-- The brief named six concepts. Four are tables here. Two are not, because the
-- architecture already models them better:
--
--   * programme_visit_reviews. A review is a state transition on the visit, and
--     this system already has an immutable, actor-attributed, command-scoped
--     history of state transitions: audit_events. A separate table would be a
--     second, weaker copy of it - and the CURRENT review state has to be on the
--     visit anyway for the board to be one query. So the review outcome lives on
--     programme_visits (review_status, portal_verification, disposition,
--     reviewed_by/at) and its history is app.audit('programme_visit', ...).
--   * programme_actions. Every action the brief describes is a disposition of a
--     visit ("No access - rebook", "Action required", "Meter requires
--     changing"), i.e. a state, not an entity with a life of its own. They are
--     the board's columns. A row per action would duplicate the visit's state
--     and immediately raise "which one is true?". An action's free text and its
--     owner are columns on the visit instead.
--
-- If either later grows a life of its own (an action assigned to someone other
-- than the reviewer, with its own due date and closure), it becomes a table
-- then, from a state that is already audited.
--
-- SYNTHETIC DATA
-- --------------
-- The real property list has not arrived. programmes.synthetic marks a whole
-- programme as development fixtures, and a trigger makes the flag contagious and
-- immutable: a synthetic property or visit can only exist inside a synthetic
-- programme, and a real one can never be moved into a synthetic programme or
-- vice versa. Fixtures therefore cannot leak into the real programme by mistake
-- rather than by remembering not to.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissions
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('programme.read',
   'See operational programmes, the properties you may see, and your own visits.'),
  ('programme.read.all',
   'See every property and every visit in a programme, including other people''s.'),
  ('programme.visit.submit',
   'Record a field visit against a programme property.'),
  ('programme.review',
   'Review submitted visits: portal verification and final disposition.'),
  ('programme.manage',
   'Administer programmes: configuration, property import, assignment and corrections.'),
  ('programme.report',
   'See programme reporting and export it.')
on conflict (code) do nothing;

-- Office class runs the review queue and reporting; Admin/Manager administer;
-- Directors read and report; Installers record visits and see their own.
insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
from public.roles r
cross join (values ('programme.read'), ('programme.read.all'), ('programme.visit.submit'),
                   ('programme.review'), ('programme.manage'), ('programme.report')) as p (code)
where r.code in ('Admin', 'Manager')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
from public.roles r
cross join (values ('programme.read'), ('programme.read.all'), ('programme.review'),
                   ('programme.report')) as p (code)
where r.code = 'Office'
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
from public.roles r
cross join (values ('programme.read'), ('programme.read.all'), ('programme.report')) as p (code)
where r.code = 'Director'
on conflict do nothing;

-- A field worker: their own programme work, and nothing else.
--
-- Installer ONLY. Surveyors are deliberately not granted field submission: no
-- capability here is granted by analogy with another role, and whether Surveyors
-- attend programme visits is a business question that has not been answered yet.
-- Adding them later is one row in this table and no code change.
insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
from public.roles r
cross join (values ('programme.read'), ('programme.visit.submit')) as p (code)
where r.code = 'Installer'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Release gate (existing RA01 register), seeded Disabled
-- -----------------------------------------------------------------------------

insert into public.release_modes (function_id, function_name, mode, mode_record_basis, authorised_job_scope,
                                  target_release, planned_target_mode, current_system, fallback, scope_boundary_notes)
values ('FN-22', 'Operational programmes (properties, field visits, office review)', 'Disabled',
        'Programmes v1 migration; disabled until approved', 'None', 'R1', 'Manual',
        'Spreadsheets and phone calls', 'Spreadsheets and phone calls',
        'Switch to Manual (scope Pilot or All) to enable Programmes for staff')
on conflict (function_id) do nothing;

create function app.programmes_on()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.mode_available('FN-22', 'Manual') $$;

create function public.programmes_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.programmes_on() $$;

-- -----------------------------------------------------------------------------
-- 3. Vocabulary
-- -----------------------------------------------------------------------------

-- The outcomes of a field visit. These are the business outcomes as the client
-- states them today; a form's own option ids are mapped onto them by the
-- programme's outcome_map, so the wording on the form can change without
-- changing what the data means.
create function app.programme_outcomes()
returns text[]
language sql immutable set search_path = ''
as $$
  select array['TenantNotHome', 'SimChangedPortalWorking', 'SimChangedPortalNotWorking', 'MeterDead']
$$;

-- The board's columns, and so the set of final states a visit can be in.
create function app.programme_dispositions()
returns text[]
language sql immutable set search_path = ''
as $$
  select array['AwaitingReview', 'NoAccessRebook', 'ActionRequired', 'MeterRequiresChanging', 'CompleteAndWorking']
$$;

create function app.programme_evidence_categories()
returns text[]
language sql immutable set search_path = ''
as $$ select array['MeterPhoto', 'SimSerialPhoto', 'CsqPhoto', 'CallingCard', 'ProgrammeOther'] $$;

create or replace function app.evidence_categories()
returns text[] language sql immutable set search_path = ''
as $$
  select array['Contract', 'CustomerDetails', 'FinanceAgreement', 'TaskEvidence', 'DeliveryNote', 'Other']
         || app.evidence_installer_categories()
         || app.programme_evidence_categories()
$$;

-- Serial numbers are compared as people read them out: case and punctuation are
-- not differences. Both sides are normalised the same way, always.
create function app.programme_norm_serial(p_value text)
returns text
language sql immutable set search_path = ''
as $$ select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

create function app.programme_norm_postcode(p_value text)
returns text
language sql immutable set search_path = ''
as $$ select nullif(upper(regexp_replace(coalesce(p_value, ''), '\s', '', 'g')), '') $$;

-- -----------------------------------------------------------------------------
-- 4. Tables
-- -----------------------------------------------------------------------------

create table public.programmes (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[A-Z][A-Z0-9-]{1,39}$'),
  name                 text not null check (char_length(btrim(name)) between 1 and 200),
  client_name          text check (client_name is null or char_length(btrim(client_name)) between 1 and 200),
  status               text not null check (status in ('Planning', 'Active', 'Paused', 'Closed')),
  starts_on            date,
  ends_on              date,
  -- The form a field visit is recorded on. A submission stores the exact
  -- revision it answered, so changing the form never reinterprets history.
  visit_form_id        uuid references public.forms (id) on delete restrict,
  -- Which of that form's questions carry which canonical value. The ONLY place
  -- a generic form meets this programme's meaning; the renderer stays generic.
  -- {canonical_key: field_id | [field_id, ...], evidence: {Category: [field_id]}}
  field_map            jsonb not null default '{}'::jsonb,
  -- {form_option_id: canonical_outcome}
  outcome_map          jsonb not null default '{}'::jsonb,
  -- Signal thresholds AS CONFIGURATION, including the fact that one boundary is
  -- not yet confirmed by the client. See app.programme_signal_class.
  signal_config        jsonb not null default
    '{"metric": "csq", "min": 0, "max": 31, "good_min": 14, "bad_max": 4,
      "bad_max_inclusive": true, "boundary_unresolved": true}'::jsonb,
  -- How much of the property list a field worker with programme.read may see.
  property_visibility  text not null default 'Assigned'
    check (property_visibility in ('Assigned', 'AllInProgramme')),
  -- true = development fixtures. Contagious and immutable (see the guard below).
  synthetic            boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  created_by           uuid references public.people (id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.people (id),
  version              integer not null default 1,
  constraint programmes_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
comment on table public.programmes is
  'An operational programme: a contract covering many properties and field visits. Configuration only - no client write path.';
comment on column public.programmes.field_map is
  'Maps the visit form''s field ids onto the canonical visit columns. Programme configuration, so the form renderer needs no programme-specific behaviour.';
comment on column public.programmes.synthetic is
  'true = the whole programme is development fixtures. A synthetic property or visit can exist only here, and the flag can never change.';

create trigger programmes_touch before insert or update on public.programmes
  for each row execute function app.touch_row();

create table public.programme_properties (
  id                    uuid primary key default gen_random_uuid(),
  programme_id          uuid not null references public.programmes (id) on delete restrict,
  -- The client's own identifier for the property (PCH property ID).
  external_ref          text not null check (char_length(btrim(external_ref)) between 1 and 100),
  address_line1         text not null check (char_length(btrim(address_line1)) between 1 and 200),
  address_line2         text,
  town                  text,
  postcode              text,
  postcode_norm         text generated always as (app.programme_norm_postcode(postcode)) stored,
  -- What the client's records say is there now. Compared with what the
  -- installer actually finds.
  expected_meter_serial text,
  expected_serial_norm  text generated always as (app.programme_norm_serial(expected_meter_serial)) stored,
  existing_sim_serial   text,
  notes                 text,
  -- The import row this came from, verbatim, so any later question about the
  -- source can be answered without the spreadsheet.
  source_row            jsonb,
  import_id             uuid,
  -- false = withdrawn from the programme. Not derivable from visits.
  active                boolean not null default true,
  synthetic             boolean not null default false,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.people (id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.people (id),
  version               integer not null default 1,
  unique (programme_id, external_ref)
);
comment on table public.programme_properties is
  'One property in a programme. Searchable by address, postcode, the client''s reference and the expected meter serial.';

create index programme_properties_programme_idx
  on public.programme_properties (programme_id, external_ref);
create index programme_properties_postcode_idx
  on public.programme_properties (programme_id, postcode_norm) where postcode_norm is not null;
create index programme_properties_serial_idx
  on public.programme_properties (expected_serial_norm) where expected_serial_norm is not null;
create index programme_properties_address_idx
  on public.programme_properties using gin (to_tsvector('simple', coalesce(address_line1, '') || ' ' ||
    coalesce(address_line2, '') || ' ' || coalesce(town, '') || ' ' || coalesce(postcode, '')));

create trigger programme_properties_touch before insert or update on public.programme_properties
  for each row execute function app.touch_row();

create table public.programme_assignments (
  id             uuid primary key default gen_random_uuid(),
  programme_id   uuid not null references public.programmes (id) on delete restrict,
  -- Null = the whole programme. A row narrows the assignment to one property.
  property_id    uuid references public.programme_properties (id) on delete restrict,
  person_id      uuid not null references public.people (id) on delete restrict,
  active         boolean not null default true,
  assigned_on    date not null default (now() at time zone 'Europe/London')::date,
  ended_on       date,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.people (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.people (id),
  version        integer not null default 1
);
comment on table public.programme_assignments is
  'Who works a programme, optionally narrowed to one property. Also what programme.read sees when property_visibility is Assigned.';

create unique index programme_assignments_programme_person_key
  on public.programme_assignments (programme_id, person_id) where property_id is null;
create unique index programme_assignments_property_person_key
  on public.programme_assignments (programme_id, property_id, person_id) where property_id is not null;
create index programme_assignments_person_idx on public.programme_assignments (person_id) where active;

create trigger programme_assignments_touch before insert or update on public.programme_assignments
  for each row execute function app.touch_row();

create table public.programme_visits (
  -- Chosen by the client when the visit is started, so evidence has something
  -- to belong to before there are any answers, and so a retry is recognised.
  id                     uuid primary key,
  programme_id           uuid not null references public.programmes (id) on delete restrict,
  property_id            uuid not null references public.programme_properties (id) on delete restrict,
  installer_id           uuid not null references public.people (id) on delete restrict,

  -- The form artifact. The submission is the source record of what the person
  -- actually answered; everything below it is derived from that, server-side.
  form_id                uuid references public.forms (id) on delete restrict,
  form_revision_id       uuid references public.form_revisions (id) on delete restrict,
  submission_id          uuid unique references public.form_submissions (id) on delete restrict,

  -- Canonical, typed, validated values. Operationally important data does not
  -- live only inside form JSON.
  outcome                text check (outcome is null or outcome = any (app.programme_outcomes())),
  actual_meter_serial    text,
  actual_serial_norm     text generated always as (app.programme_norm_serial(actual_meter_serial)) stored,
  meter_reading          numeric(14, 3) check (meter_reading is null or meter_reading >= 0),
  new_sim_serial         text,
  csq                    integer,
  installer_comments     text,

  -- Derived server-side at submission. Never sent by the browser.
  meter_serial_matches   boolean,
  signal_classification  text check (signal_classification is null
                                     or signal_classification in ('Good', 'Advisory', 'Bad')),
  -- Whether the external portal still has to be checked for this visit.
  portal_check_required  boolean not null default false,
  review_required        boolean not null default true,
  -- Why the office is being asked to look: ['MeterSerialMismatch', ...]
  review_reasons         jsonb not null default '[]'::jsonb,
  recommended_disposition text check (recommended_disposition is null
                                      or recommended_disposition = any (app.programme_dispositions())),

  -- Office review.
  review_status          text not null default 'Draft'
                         check (review_status in ('Draft', 'AwaitingReview', 'Reviewed')),
  disposition            text not null default 'AwaitingReview'
                         check (disposition = any (app.programme_dispositions())),
  -- The office's own check of the external PCH portal. Not derivable from CSQ.
  portal_verification    text check (portal_verification is null
                                     or portal_verification in ('ConfirmedLive', 'NotLive', 'UnableToVerify')),
  action_note            text,
  reviewed_by            uuid references public.people (id),
  reviewed_at            timestamptz,

  visit_date             date,
  submitted_at           timestamptz,
  synthetic              boolean not null default false,
  created_at             timestamptz not null default now(),
  created_by             uuid references public.people (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.people (id),
  version                integer not null default 1,

  -- A draft has no answers and is on no board; a submitted visit has all three
  -- of the artifact, the date and the outcome.
  constraint programme_visits_draft_or_submitted check (
    (review_status = 'Draft' and submission_id is null and outcome is null
     and submitted_at is null and visit_date is null and disposition = 'AwaitingReview')
    or (review_status <> 'Draft' and submission_id is not null and outcome is not null
        and submitted_at is not null and visit_date is not null and form_revision_id is not null)),

  -- THE rule the brief is emphatic about: "Complete & Working" is not a
  -- consequence of the outcome or of a good signal. It requires the office to
  -- have confirmed the meter live in the external portal. Proved at the table,
  -- so no command, no drag-and-drop and no future code path can reach that
  -- state without the confirmation.
  -- IS NOT DISTINCT FROM, not "=": portal_verification is nullable, and a CHECK
  -- that evaluates to NULL PASSES. With "=" an unverified visit (null) would
  -- give `false OR null` = null and slip straight through the constraint that
  -- exists to stop it.
  constraint programme_visits_complete_needs_portal check (
    disposition <> 'CompleteAndWorking'
    or portal_verification is not distinct from 'ConfirmedLive'),

  constraint programme_visits_reviewed check (
    (review_status = 'Reviewed') = (reviewed_at is not null)),
  constraint programme_visits_reviewed_by check ((reviewed_at is null) = (reviewed_by is null))
);
comment on table public.programme_visits is
  'One field visit. The form submission is the audit artifact; the typed columns are derived from it server-side and are what operations and reporting read.';
comment on constraint programme_visits_complete_needs_portal on public.programme_visits is
  'A good CSQ does not mean the meter is working. Complete & Working requires portal_verification = ConfirmedLive.';

create index programme_visits_board_idx
  on public.programme_visits (programme_id, disposition, submitted_at desc);
create index programme_visits_property_idx on public.programme_visits (property_id, submitted_at desc);
create index programme_visits_installer_idx on public.programme_visits (installer_id, visit_date desc);
create index programme_visits_date_idx on public.programme_visits (programme_id, visit_date);
create index programme_visits_review_idx
  on public.programme_visits (programme_id, review_status) where review_status = 'AwaitingReview';

create trigger programme_visits_touch before insert or update on public.programme_visits
  for each row execute function app.touch_row();

-- Property import staging: upload -> parse -> map -> validate -> preview -> import.
create table public.programme_imports (
  id             uuid primary key,
  programme_id   uuid not null references public.programmes (id) on delete restrict,
  filename       text not null check (char_length(btrim(filename)) between 1 and 300),
  -- The header labels exactly as the file had them, in file order. Identity is
  -- the column INDEX: real exports repeat header names.
  header         jsonb not null,
  row_count      integer not null default 0 check (row_count >= 0),
  -- {canonical_key: column_index}. Chosen by a person, validated here.
  mapping        jsonb,
  status         text not null default 'Draft'
                 check (status in ('Draft', 'Mapped', 'Applied', 'Discarded')),
  valid_rows     integer,
  invalid_rows   integer,
  created_count  integer,
  updated_count  integer,
  applied_at     timestamptz,
  applied_by     uuid references public.people (id),
  created_at     timestamptz not null default now(),
  created_by     uuid references public.people (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.people (id),
  version        integer not null default 1
);
comment on table public.programme_imports is
  'One property import: the file''s header, its staged rows, the chosen column mapping and what applying it did.';

create trigger programme_imports_touch before insert or update on public.programme_imports
  for each row execute function app.touch_row();

alter table public.programme_properties
  add constraint programme_properties_import_fkey
  foreign key (import_id) references public.programme_imports (id) on delete set null;

create table public.programme_import_rows (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references public.programme_imports (id) on delete cascade,
  -- 1-based row number in the file, excluding the header.
  row_index   integer not null check (row_index >= 1),
  -- The row's cells, positional, as text. Never interpreted before mapping.
  cells       jsonb not null,
  -- After mapping: the canonical values, the problems found, and what applying
  -- would do. All computed in the database, not in the browser.
  mapped      jsonb,
  problems    jsonb not null default '[]'::jsonb,
  action      text check (action is null or action in ('Create', 'Update', 'Skip', 'Invalid')),
  property_id uuid references public.programme_properties (id) on delete set null,
  unique (import_id, row_index)
);
comment on table public.programme_import_rows is
  'Staged import rows. Validation and the create/update decision are computed here so the preview is the real thing.';

create index programme_import_rows_action_idx on public.programme_import_rows (import_id, action, row_index);

-- -----------------------------------------------------------------------------
-- 5. The synthetic-data invariant
-- -----------------------------------------------------------------------------

-- A fixture can only exist inside a fixture programme, and neither side of that
-- can ever change. This makes "never mix synthetic fixtures into production
-- records" a property of the schema rather than a rule someone must remember.
create function app.programme_synthetic_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_programme boolean;
begin
  select p.synthetic into v_programme from public.programmes p where p.id = new.programme_id;
  if v_programme is null then
    raise exception 'PROGRAMME_NOT_FOUND' using errcode = 'P0001';
  end if;
  if new.synthetic is distinct from v_programme then
    raise exception 'PROGRAMME_SYNTHETIC_MISMATCH' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.programme_id is distinct from old.programme_id
                           or new.synthetic is distinct from old.synthetic) then
    raise exception 'PROGRAMME_SYNTHETIC_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger programme_properties_synthetic before insert or update on public.programme_properties
  for each row execute function app.programme_synthetic_guard();
create trigger programme_visits_synthetic before insert or update on public.programme_visits
  for each row execute function app.programme_synthetic_guard();

create function app.programmes_synthetic_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.synthetic is distinct from old.synthetic then
    raise exception 'PROGRAMME_SYNTHETIC_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger programmes_synthetic_immutable before update on public.programmes
  for each row execute function app.programmes_synthetic_immutable();

-- A visit's property must be in the visit's own programme.
create function app.programme_visit_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_programme uuid;
begin
  select p.programme_id into v_programme from public.programme_properties p where p.id = new.property_id;
  if v_programme is distinct from new.programme_id then
    raise exception 'PROGRAMME_PROPERTY_MISMATCH' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.property_id is distinct from old.property_id
                           or new.installer_id is distinct from old.installer_id
                           or (old.submission_id is not null and new.submission_id is distinct from old.submission_id)) then
    raise exception 'PROGRAMME_VISIT_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger programme_visits_consistency before insert or update on public.programme_visits
  for each row execute function app.programme_visit_consistency();

-- -----------------------------------------------------------------------------
-- 6. Signal classification, from programme configuration
-- -----------------------------------------------------------------------------

-- The client's current statement is: 14 or above = signal present/good;
-- roughly 4 to 14 = advisory, an antenna may be needed; 4 or below = bad.
-- "4 or below" and "approximately 4 and 14" disagree about the value 4 itself,
-- so the boundary is CONFIGURATION with an explicit unresolved flag rather than
-- a silent decision in code:
--
--   good_min          : at or above this, 'Good'          (14)
--   bad_max           : the bad/advisory boundary          (4)
--   bad_max_inclusive : whether bad_max itself is 'Bad'    (true = 4 is Bad)
--   boundary_unresolved: true until Dan/Ben confirm bad_max_inclusive.
--
-- Nothing in the code prefers either answer: change the configuration and every
-- future classification follows. Visits already classified keep the answer they
-- were given, which is the honest record of what was decided at the time.
create function app.programme_signal_class(p_config jsonb, p_value integer)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_value >= coalesce((p_config ->> 'good_min')::int, 14) then 'Good'
    when coalesce((p_config ->> 'bad_max_inclusive')::boolean, true)
      then case when p_value <= coalesce((p_config ->> 'bad_max')::int, 4) then 'Bad' else 'Advisory' end
      else case when p_value <  coalesce((p_config ->> 'bad_max')::int, 4) then 'Bad' else 'Advisory' end
    end
$$;

create function public.programme_signal_class(p_programme_id uuid, p_value integer)
returns text
language sql stable security definer
set search_path = ''
as $$
  select app.programme_signal_class(p.signal_config, p_value)
  from public.programmes p where p.id = p_programme_id
$$;

-- What the server requires for an outcome, regardless of what the form said.
-- The form's own conditional rules are a convenience for the person filling it
-- in; these are the rules, and they are applied to the submitted answers again.
create function app.programme_outcome_requirements(p_outcome text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case p_outcome
    when 'TenantNotHome' then
      '{"fields": [], "evidence": ["CallingCard"]}'::jsonb
    when 'MeterDead' then
      '{"fields": ["actual_meter_serial", "meter_reading"], "evidence": ["MeterPhoto"]}'::jsonb
    when 'SimChangedPortalWorking' then
      '{"fields": ["actual_meter_serial", "meter_reading", "new_sim_serial", "csq"],
        "evidence": ["MeterPhoto", "SimSerialPhoto", "CsqPhoto"]}'::jsonb
    when 'SimChangedPortalNotWorking' then
      '{"fields": ["actual_meter_serial", "meter_reading", "new_sim_serial", "csq"],
        "evidence": ["MeterPhoto", "SimSerialPhoto", "CsqPhoto"]}'::jsonb
    end
$$;

create function app.programme_outcome_is_sim_change(p_outcome text)
returns boolean
language sql immutable set search_path = ''
as $$ select p_outcome in ('SimChangedPortalWorking', 'SimChangedPortalNotWorking') $$;

-- -----------------------------------------------------------------------------
-- 7. Evidence: a programme scope on the existing document spine
-- -----------------------------------------------------------------------------

alter table public.evidence
  add column programme_visit_id uuid references public.programme_visits (id) on delete restrict;

alter table public.evidence drop constraint evidence_scope_check;
alter table public.evidence
  add constraint evidence_scope_check check (scope in ('Job', 'Library', 'Programme'));
alter table public.evidence drop constraint evidence_context_type_check;
alter table public.evidence
  add constraint evidence_context_type_check
  check (context_type in ('Task', 'WorkPackage', 'Delivery', 'Job', 'ProgrammeVisit'));
alter table public.evidence
  -- The scope and its link agree, in both directions.
  add constraint evidence_programme_scope check ((scope = 'Programme') = (programme_visit_id is not null)),
  -- A programme document is never evidence of work on a job, and never filed
  -- in the job/library folder tree.
  add constraint evidence_programme_no_job_links check (
    scope <> 'Programme' or (job_id is null and task_id is null and work_package_id is null
                             and submission_id is null and issue_id is null and folder_id is null));

comment on column public.evidence.programme_visit_id is
  'The programme visit this file was captured for. Set only for scope = Programme; the file lives in the same private bucket as every other document.';

create index evidence_programme_visit_idx on public.evidence (programme_visit_id, category)
  where programme_visit_id is not null;

-- Unchanged for Job and Library rows. A Programme row adds one rule: its visit
-- must exist (the FK) and nothing about the link may change afterwards.
create or replace function app.evidence_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder public.file_folders;
begin
  if tg_op = 'DELETE' then
    -- Append-only (reference). Only a registration whose file never arrived may go.
    if old.upload_status <> 'Pending' then
      raise exception 'EVIDENCE_IMMUTABLE' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.job_id is distinct from old.job_id or new.storage_path is distinct from old.storage_path
       or new.scope is distinct from old.scope
       or new.programme_visit_id is distinct from old.programme_visit_id
       or (old.uploaded_by is not null and new.uploaded_by is distinct from old.uploaded_by)
       or (old.upload_status <> 'Pending' and new.upload_status = 'Pending') then
      raise exception 'EVIDENCE_IMMUTABLE' using errcode = 'P0001';
    end if;
    -- A destroyed document is a tombstone: nothing about it changes again.
    if old.purged_at is not null and new.purged_at is not null
       and to_jsonb(new) - 'purged_at' is distinct from to_jsonb(old) - 'purged_at' then
      raise exception 'FILE_ALREADY_DESTROYED' using errcode = 'P0001';
    end if;
  end if;

  -- Filing must stay inside the document's own job (or the library).
  if new.folder_id is not null then
    select * into v_folder from public.file_folders where id = new.folder_id;
    if v_folder.id is null then
      raise exception 'FILE_FOLDER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_folder.scope is distinct from new.scope or v_folder.job_id is distinct from new.job_id then
      raise exception 'FILE_FOLDER_SCOPE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if new.task_id is not null
     and not exists (select 1 from public.tasks t where t.id = new.task_id and t.job_id = new.job_id) then
    raise exception 'R1A_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  if new.work_package_id is not null
     and not exists (select 1 from public.work_packages w where w.id = new.work_package_id and w.job_id = new.job_id) then
    raise exception 'R1C_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  if new.submission_id is not null
     and not exists (select 1 from public.commissioning_submissions s where s.id = new.submission_id and s.job_id = new.job_id) then
    raise exception 'R1C_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  if new.issue_id is not null
     and not exists (select 1 from public.issues i where i.id = new.issue_id and i.job_id = new.job_id) then
    raise exception 'R1C_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Who may see a programme file: anyone who may see the whole programme, and the
-- field worker whose own visit it belongs to. Deliberately NOT "anyone with
-- programme.read": that would let one installer read another's photographs.
create function app.can_read_programme_evidence(p_actor jsonb, p_visit_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.programmes_on() and exists (
    select 1 from public.programme_visits v
    where v.id = p_visit_id
      and (app.actor_has_permission(p_actor, 'programme.read.all')
           or (app.actor_has_permission(p_actor, 'programme.read')
               and v.installer_id = app.actor_id(p_actor))))
$$;

create or replace function app.can_read_evidence(p_actor jsonb, p_e public.evidence)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_actor is not null and p_e.id is not null
    and p_e.upload_status in ('Uploaded', 'Referenced')
    and p_e.purged_at is null
    and (p_e.trashed_at is null or app.actor_has_permission(p_actor, 'file.manage'))
    and case
      when p_e.scope = 'Library' then app.actor_has_permission(p_actor, 'file.library.read')
      when p_e.scope = 'Programme' then app.can_read_programme_evidence(p_actor, p_e.programme_visit_id)
      else (
        (app.has_role(p_actor, 'Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance')
          and app.can_read_job(p_actor, p_e.job_id))
        or (app.has_role(p_actor, 'Store') and p_e.category = 'DeliveryNote')
        or (p_e.category = any (app.evidence_installer_categories())
            and exists (
              select 1
              from public.allocations a
              join public.work_packages w on w.id = a.work_package_id
              where a.person_id = app.actor_id(p_actor) and a.active and w.status <> 'Cancelled' and w.job_id = p_e.job_id
                and case
                      when coalesce(p_e.work_package_id,
                                    (select s.work_package_id from public.commissioning_submissions s
                                     where s.id = p_e.submission_id)) is not null
                        then w.id = coalesce(p_e.work_package_id,
                                             (select s.work_package_id from public.commissioning_submissions s
                                              where s.id = p_e.submission_id))
                      else app.actor_id(p_actor) in (p_e.captured_by, p_e.uploaded_by)
                    end)))
      end
$$;

-- May this actor register an upload against this programme visit? The visit
-- must be their own and still open: once the office has reviewed it, no more
-- files can be attached to it.
create or replace function app.evidence_upload_context(p_actor jsonb, p_type text, p_id uuid, p_category text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_wp public.work_packages;
  v_job public.jobs;
  v_job_id uuid;
  v_reg app.command_registry;
  v_visit public.programme_visits;
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
begin
  -- A company document has no domain object behind it: the permission is the
  -- whole authorization, and there is no job to derive.
  if p_type = 'Library' then
    perform app.file_authorize_write(p_actor, 'Library', null);
    if v_category is not null and not v_category = any (app.evidence_categories()) then
      perform app.fail('EVIDENCE_CATEGORY_INVALID');
    end if;
    return jsonb_build_object('scope', 'Library', 'category', coalesce(v_category, 'Other'));
  end if;

  if p_id is null then
    perform app.fail('EVIDENCE_CONTEXT_INVALID');
  end if;

  if p_type = 'ProgrammeVisit' then
    if not app.programmes_on() then
      perform app.fail('R1A_MODE_DENIED');
    end if;
    select * into v_visit from public.programme_visits where id = p_id;
    if v_visit.id is null then
      perform app.fail('PROGRAMME_VISIT_NOT_FOUND');
    end if;
    -- The person recording the visit owns its evidence. An administrator
    -- correcting a record does so through a command, not by adding photographs
    -- to someone else's visit.
    if v_visit.installer_id <> app.actor_id(p_actor)
       or not app.actor_has_permission(p_actor, 'programme.visit.submit') then
      perform app.fail('PROGRAMME_VISIT_NOT_YOURS');
    end if;
    if v_visit.review_status = 'Reviewed' then
      perform app.fail('PROGRAMME_VISIT_CLOSED');
    end if;
    if v_category is null or not v_category = any (app.programme_evidence_categories()) then
      perform app.fail('EVIDENCE_CATEGORY_INVALID');
    end if;
    return jsonb_build_object('scope', 'Programme', 'programme_visit_id', v_visit.id,
                              'path_prefix', 'programme/' || v_visit.programme_id,
                              'category', v_category);
  end if;

  if p_type = 'Task' then
    select * into v_task from public.tasks where id = p_id;
    if v_task.id is null then
      perform app.fail('R1A_TASK_NOT_FOUND');
    end if;
    if v_task.job_id is null then
      perform app.fail('EVIDENCE_CONTEXT_INVALID');
    end if;
    if not app.is_office(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    if not app.is_assigned(p_actor, v_task.job_id) then
      perform app.fail('R1A_JOB_ACCESS_DENIED');
    end if;
    if app.actor_id(p_actor) not in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))
       and not app.is_admin(p_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    perform app.require_mode('FN-01', 'Automated');
    return jsonb_build_object('scope', 'Job', 'job_id', v_task.job_id, 'task_id', v_task.id,
      'category', case v_task.template_code when 'PRE02' then 'Contract' when 'PRE04' then 'CustomerDetails'
                                            when 'PRE05' then 'FinanceAgreement' else 'TaskEvidence' end);

  elsif p_type = 'WorkPackage' then
    select * into v_wp from public.work_packages where id = p_id;
    if v_wp.id is null then
      perform app.fail('R1C_WORK_PACKAGE_NOT_FOUND');
    end if;
    select * into v_job from public.jobs where id = v_wp.job_id;
    if not app.iw_job_actionable(v_job) then
      perform app.fail('R1C_JOB_NOT_ACTIONABLE');
    end if;
    if not app.iw_allocated(v_wp.id, app.actor_id(p_actor)) and not app.iw_office(p_actor) then
      perform app.fail('R1C_ASSIGNMENT_DENIED');
    end if;
    perform app.require_mode('FN-06', 'Automated');
    if v_category is null or not v_category = any (app.evidence_installer_categories()) then
      perform app.fail('EVIDENCE_CATEGORY_INVALID');
    end if;
    return jsonb_build_object('scope', 'Job', 'job_id', v_wp.job_id, 'work_package_id', v_wp.id, 'category', v_category);

  elsif p_type = 'Delivery' then
    select o.job_id into v_job_id from public.deliveries d join public.orders o on o.id = d.order_id where d.id = p_id;
    if v_job_id is null then
      perform app.fail('R1C_DELIVERY_NOT_FOUND');
    end if;
    select * into v_reg from app.command_registry where command_type = 'GOODS_IN_RECEIVE';
    if v_reg.command_type is null or not app.has_role(p_actor, variadic v_reg.roles) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.require_modes(v_reg.modes);
    return jsonb_build_object('scope', 'Job', 'job_id', v_job_id, 'category', 'DeliveryNote');

  elsif p_type = 'Job' then
    if not exists (select 1 from public.jobs j where j.id = p_id) then
      perform app.fail('R1A_JOB_NOT_FOUND');
    end if;
    if not app.is_office(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    if not app.is_assigned(p_actor, p_id) then
      perform app.fail('R1A_JOB_ACCESS_DENIED');
    end if;
    if v_category is null or not v_category = any (app.evidence_categories()) then
      perform app.fail('EVIDENCE_CATEGORY_INVALID');
    end if;
    return jsonb_build_object('scope', 'Job', 'job_id', p_id, 'category', v_category);
  end if;

  perform app.fail('EVIDENCE_CONTEXT_INVALID');
  return null;
end
$$;

-- Unchanged except that the context may now name a programme visit, and may
-- supply the storage path's prefix. The path is identity, never filing, and no
-- policy parses it; the prefix exists only so a human reading the bucket can
-- tell what a file belongs to.
create or replace function public.evidence_upload_begin(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_key text;
  v_upload_id uuid;
  v_context_id uuid;
  v_folder_id uuid;
  v_type text;
  v_scope text;
  v_job_id uuid;
  v_visit_id uuid;
  v_mime text;
  v_size bigint;
  v_name text;
  v_ext text;
  v_part text;
  v_ctx jsonb;
  v_row public.evidence;
  v_id uuid;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('upload_id', 'context_type', 'context_id', 'category', 'filename', 'mime_type',
                     'size_bytes', 'folder_id') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;

  v_actor := app.resolve_actor();
  v_type := p_request ->> 'context_type';

  if coalesce(p_request ->> 'upload_id', '') !~* v_uuid then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_upload_id := (p_request ->> 'upload_id')::uuid;
  -- A company document has no context object; every other context needs one.
  if v_type <> 'Library' then
    if coalesce(p_request ->> 'context_id', '') !~* v_uuid then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
    v_context_id := (p_request ->> 'context_id')::uuid;
  elsif p_request ? 'context_id' and p_request -> 'context_id' <> 'null'::jsonb then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_folder_id := app.file_uuid(p_request -> 'folder_id', 'folder_id');

  -- File rules first: they need no database state.
  v_mime := lower(btrim(coalesce(p_request ->> 'mime_type', '')));
  if not app.evidence_file_types() ? v_mime then
    perform app.fail('EVIDENCE_TYPE_NOT_ALLOWED');
  end if;
  if coalesce(p_request ->> 'size_bytes', '') !~ '^[0-9]{1,12}$' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_size := (p_request ->> 'size_bytes')::bigint;
  if v_size <= 0 then
    perform app.fail('R1A_UPLOAD_INVALID');
  end if;
  if v_size > app.evidence_max_bytes() then
    perform app.fail('EVIDENCE_TOO_LARGE');
  end if;
  v_name := app.evidence_safe_filename(p_request ->> 'filename');
  if v_name is null or position('.' in v_name) = 0 then
    perform app.fail('EVIDENCE_FILENAME_INVALID');
  end if;
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]+)$'));
  if v_ext is null or not (app.evidence_file_types() -> v_mime) ? v_ext then
    perform app.fail('EVIDENCE_TYPE_NOT_ALLOWED');
  end if;
  -- "invoice.php.pdf": no inner segment may be something a server or browser runs.
  foreach v_part in array (string_to_array(lower(v_name), '.'))[2:] loop
    if v_part in ('php', 'phtml', 'exe', 'dll', 'com', 'bat', 'cmd', 'sh', 'ps1', 'js', 'mjs', 'jsp', 'asp', 'aspx',
                  'cgi', 'pl', 'py', 'rb', 'jar', 'msi', 'scr', 'vbs', 'html', 'htm', 'xhtml', 'svg', 'xml', 'hta') then
      perform app.fail('EVIDENCE_FILENAME_INVALID');
    end if;
  end loop;

  perform set_config('app.actor_id', app.actor_id(v_actor)::text, true);
  perform set_config('app.executing_service', 'evidence:upload', true);
  perform pg_advisory_xact_lock(hashtextextended('evidence-upload:' || v_upload_id, 0));

  -- Current authorization always applies, including to a retry.
  v_ctx := app.evidence_upload_context(v_actor, v_type, v_context_id, p_request ->> 'category');
  v_scope := coalesce(v_ctx ->> 'scope', 'Job');
  v_job_id := (v_ctx ->> 'job_id')::uuid;
  v_visit_id := (v_ctx ->> 'programme_visit_id')::uuid;

  -- Dropping a file into a folder is filing, and filing never crosses a job.
  -- A programme document is not in the job/library folder tree at all.
  if v_folder_id is not null then
    if v_scope = 'Programme' then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
    perform app.file_assert_destination(v_actor, v_scope, v_job_id, v_folder_id);
  end if;

  select * into v_row from public.evidence
  where uploaded_by = app.actor_id(v_actor) and client_upload_id = v_upload_id;
  if v_row.id is not null then
    if v_row.context_type is distinct from nullif(v_type, 'Library')
       or v_row.context_id is distinct from v_context_id
       or v_row.filename <> v_name
       -- once confirmed, size and type are what storage measured, not what was declared
       or (v_row.upload_status = 'Pending'
           and (v_row.mime_type is distinct from v_mime or v_row.size_bytes is distinct from v_size)) then
      perform app.fail('EVIDENCE_UPLOAD_CONFLICT');
    end if;
    -- A retry that names a different folder refiles rather than duplicating.
    if v_row.upload_status = 'Pending' and v_row.folder_id is distinct from v_folder_id then
      update public.evidence set folder_id = v_folder_id where id = v_row.id returning * into v_row;
    end if;
    return jsonb_build_object('evidence_id', v_row.id, 'bucket', 'evidence', 'storage_path', v_row.storage_path,
      'upload_status', v_row.upload_status, 'category', v_row.category, 'replayed', true);
  end if;

  if exists (select 1 from public.evidence where client_upload_id = v_upload_id) then
    perform app.fail('EVIDENCE_UPLOAD_CONFLICT');
  end if;
  if (select count(*) from public.evidence e where e.uploaded_by = app.actor_id(v_actor)
        and e.upload_status = 'Pending' and e.registered_at > now() - interval '1 hour') >= 50 then
    perform app.fail('EVIDENCE_TOO_MANY_PENDING');
  end if;

  v_id := gen_random_uuid();
  insert into public.evidence (id, scope, job_id, task_id, work_package_id, programme_visit_id,
                               context_type, context_id, category,
                               folder_id, storage_path, filename, original_filename, mime_type, size_bytes,
                               upload_status, captured_at, captured_by, uploaded_by, client_upload_id,
                               registered_at, customer_shareable)
  values (v_id, v_scope, v_job_id, (v_ctx ->> 'task_id')::uuid, (v_ctx ->> 'work_package_id')::uuid, v_visit_id,
          nullif(v_type, 'Library'), v_context_id, v_ctx ->> 'category',
          v_folder_id,
          -- Identity, never filing: neither this path nor its prefix ever
          -- changes again, and no policy parses either.
          coalesce(v_ctx ->> 'path_prefix', v_job_id::text, 'library') || '/' || v_id || '/' || v_name, v_name,
          nullif(left(regexp_replace(btrim(coalesce(p_request ->> 'filename', '')), '[[:cntrl:]]', '', 'g'), 255), ''),
          v_mime, v_size, 'Pending', now(), app.actor_id(v_actor), app.actor_id(v_actor), v_upload_id, now(), false)
  returning * into v_row;

  perform app.audit('Evidence', v_row.id::text, 'Register', null,
                    app.evidence_audit_json(v_row) || jsonb_build_object('scope', v_scope, 'folder_id', v_folder_id));

  return jsonb_build_object('evidence_id', v_row.id, 'bucket', 'evidence', 'storage_path', v_row.storage_path,
    'upload_status', v_row.upload_status, 'category', v_row.category, 'replayed', false);
end
$$;

-- Confirms one photo answer: the file must be a registration of THIS visit, by
-- THIS actor, of the expected kind, and its bytes must actually be in storage.
-- Nothing completes before its file is durable, exactly as for job evidence.
create function app.programme_attach_evidence(p_visit_id uuid, p_evidence_id uuid, p_category text)
returns public.evidence
language plpgsql
set search_path = ''
as $$
declare
  v_row public.evidence;
begin
  select * into v_row from public.evidence where id = p_evidence_id for update;
  if v_row.id is null then
    perform app.fail('R1A_UPLOAD_INVALID', jsonb_build_object('reason', 'unregistered upload'));
  end if;
  if v_row.scope <> 'Programme' or v_row.programme_visit_id is distinct from p_visit_id then
    perform app.fail('PROGRAMME_EVIDENCE_NOT_THIS_VISIT');
  end if;
  if v_row.uploaded_by is distinct from app.context_actor_id() then
    perform app.fail('PROGRAMME_EVIDENCE_NOT_YOURS');
  end if;
  if p_category is not null and v_row.category is distinct from p_category then
    perform app.fail('PROGRAMME_EVIDENCE_WRONG_KIND',
                     jsonb_build_object('expected', p_category, 'actual', v_row.category));
  end if;
  if v_row.trashed_at is not null or v_row.purged_at is not null then
    perform app.fail('FILE_IN_TRASH');
  end if;
  if v_row.upload_status = 'Pending' then
    v_row := app.evidence_finalize(v_row.id);
  end if;
  if v_row.attached_at is null then
    update public.evidence set attached_at = now(), attached_by = app.context_actor_id()
    where id = v_row.id returning * into v_row;
    perform app.audit('Evidence', v_row.id::text, 'Attach', null, app.evidence_audit_json(v_row));
  end if;
  return v_row;
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Command helpers
-- -----------------------------------------------------------------------------

create function app.programme_require(p_permission text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not app.has_permission(p_permission) then
    perform app.fail('PROGRAMME_PERMISSION_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end
$$;

create function app.programme_uuid(p_payload jsonb, p_key text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_payload ->> p_key), '');
begin
  if v is null then return null; end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('PROGRAMME_INVALID_' || upper(p_key));
  end if;
  return v::uuid;
end
$$;

create function app.programme_load(p_programme_id uuid)
returns public.programmes
language plpgsql
set search_path = ''
as $$
declare
  v public.programmes;
begin
  if p_programme_id is null then perform app.fail('PROGRAMME_REQUIRED_PROGRAMME_ID'); end if;
  select * into v from public.programmes where id = p_programme_id for share;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;
  return v;
end
$$;

-- Is this person working this programme (or this property in it)?
create function app.programme_assigned(p_person_id uuid, p_programme_id uuid, p_property_id uuid default null)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programme_assignments a
    where a.person_id = p_person_id and a.programme_id = p_programme_id and a.active
      and (a.property_id is null or p_property_id is null or a.property_id = p_property_id))
$$;

-- What programme.read may see of a programme's properties: everything, when the
-- programme says so; otherwise only what the person is assigned to.
create function app.programme_property_visible(p_property public.programme_properties)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.programmes_on() and (
    app.has_permission('programme.read.all')
    or (app.has_permission('programme.read') and exists (
      select 1 from public.programmes p
      where p.id = p_property.programme_id
        and (p.property_visibility = 'AllInProgramme'
               and app.programme_assigned(app.current_person_id(), p.id)
             or app.programme_assigned(app.current_person_id(), p.id, p_property.id)))))
$$;

-- The canonical value of a mapped key: the field map may name one question or
-- several (the same value can be asked under more than one outcome), and the
-- first answered one wins.
create function app.programme_mapped_answer(p_map jsonb, p_key text, p_answers jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_spec jsonb := p_map -> p_key;
  v_field jsonb;
  v_value jsonb;
begin
  if v_spec is null or jsonb_typeof(v_spec) = 'null' then return null; end if;
  if jsonb_typeof(v_spec) = 'string' then
    v_value := p_answers -> (v_spec #>> '{}');
    return case when app.forms_is_blank(v_value) then null else v_value end;
  end if;
  if jsonb_typeof(v_spec) <> 'array' then
    perform app.fail('PROGRAMME_FIELD_MAP_INVALID', jsonb_build_object('key', p_key));
  end if;
  for v_field in select value from jsonb_array_elements(v_spec) loop
    if jsonb_typeof(v_field) <> 'string' then
      perform app.fail('PROGRAMME_FIELD_MAP_INVALID', jsonb_build_object('key', p_key));
    end if;
    v_value := p_answers -> (v_field #>> '{}');
    if not app.forms_is_blank(v_value) then return v_value; end if;
  end loop;
  return null;
end
$$;

-- Every evidence id the field map says belongs to one category.
create function app.programme_mapped_evidence(p_map jsonb, p_category text, p_answers jsonb)
returns uuid[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v_spec jsonb := (p_map -> 'evidence') -> p_category;
  v_field jsonb;
  v_ids uuid[] := '{}';
  v_item jsonb;
begin
  if v_spec is null or jsonb_typeof(v_spec) = 'null' then return v_ids; end if;
  if jsonb_typeof(v_spec) = 'string' then v_spec := jsonb_build_array(v_spec); end if;
  if jsonb_typeof(v_spec) <> 'array' then
    perform app.fail('PROGRAMME_FIELD_MAP_INVALID', jsonb_build_object('key', 'evidence.' || p_category));
  end if;
  for v_field in select value from jsonb_array_elements(v_spec) loop
    for v_item in select value from jsonb_array_elements(coalesce(p_answers -> (v_field #>> '{}'), '[]'::jsonb)) loop
      v_ids := v_ids || (v_item #>> '{}')::uuid;
    end loop;
  end loop;
  return v_ids;
end
$$;

create function app.programme_visit_summary(p_v public.programme_visits)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'programme_id', p_v.programme_id, 'property_id', p_v.property_id, 'installer_id', p_v.installer_id,
    'review_status', p_v.review_status, 'disposition', p_v.disposition, 'outcome', p_v.outcome,
    'actual_meter_serial', p_v.actual_meter_serial, 'meter_reading', p_v.meter_reading,
    'new_sim_serial', p_v.new_sim_serial, 'csq', p_v.csq,
    'meter_serial_matches', p_v.meter_serial_matches, 'signal_classification', p_v.signal_classification,
    'portal_verification', p_v.portal_verification, 'portal_check_required', p_v.portal_check_required,
    'review_reasons', p_v.review_reasons, 'recommended_disposition', p_v.recommended_disposition,
    'submission_id', p_v.submission_id, 'form_revision_id', p_v.form_revision_id,
    'visit_date', p_v.visit_date, 'version', p_v.version)
$$;

-- -----------------------------------------------------------------------------
-- 9. Commands: programme configuration
-- -----------------------------------------------------------------------------

-- The form a programme may use for its visits.
--
-- Validated because public.programme_visit_form serves this form's questions to
-- someone who has programme capabilities but NOT forms.read. The caller of that
-- function names a programme, never a form, so it can never be steered at an
-- arbitrary form - but the form a programme points AT should still be a real,
-- published, non-template form rather than whatever id was typed.
create function app.programme_assert_visit_form(p_form_id uuid)
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  v_form public.forms;
begin
  if p_form_id is null then return; end if;
  select * into v_form from public.forms where id = p_form_id;
  if not found then perform app.fail('PROGRAMME_VISIT_FORM_NOT_FOUND'); end if;
  if v_form.kind <> 'form' then perform app.fail('PROGRAMME_VISIT_FORM_IS_TEMPLATE'); end if;
  if v_form.current_revision_id is null then
    perform app.fail('PROGRAMME_VISIT_FORM_NOT_PUBLISHED');
  end if;
end
$$;

-- PROGRAMME_CREATE {code, name, client_name?, status?, starts_on?, ends_on?,
--                   visit_form_id?, field_map?, outcome_map?, signal_config?,
--                   property_visibility?, synthetic?, notes?}
create function app.cmd_programme_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['code', 'name', 'client_name', 'status', 'starts_on', 'ends_on', 'visit_form_id',
          'field_map', 'outcome_map', 'signal_config', 'property_visibility', 'synthetic', 'notes'],
    array['code', 'name']);
  v_row public.programmes;
begin
  perform app.programme_require('programme.manage');
  perform app.programme_assert_visit_form(app.programme_uuid(v_p, 'visit_form_id'));
  insert into public.programmes (code, name, client_name, status, starts_on, ends_on, visit_form_id,
                                 field_map, outcome_map, signal_config, property_visibility, synthetic, notes)
  values (upper(app.txt(v_p, 'code')), app.txt(v_p, 'name'), app.txt(v_p, 'client_name'),
          coalesce(app.txt(v_p, 'status'), 'Planning'),
          nullif(app.txt(v_p, 'starts_on'), '')::date, nullif(app.txt(v_p, 'ends_on'), '')::date,
          app.programme_uuid(v_p, 'visit_form_id'),
          coalesce(v_p -> 'field_map', '{}'::jsonb), coalesce(v_p -> 'outcome_map', '{}'::jsonb),
          coalesce(v_p -> 'signal_config',
            '{"metric": "csq", "min": 0, "max": 31, "good_min": 14, "bad_max": 4,
               "bad_max_inclusive": true, "boundary_unresolved": true}'::jsonb),
          coalesce(app.txt(v_p, 'property_visibility'), 'Assigned'),
          coalesce((v_p ->> 'synthetic')::boolean, false), app.txt(v_p, 'notes'))
  returning * into v_row;

  perform app.audit('programme', v_row.id::text, 'PROGRAMME_CREATE', null, to_jsonb(v_row));
  return jsonb_build_object('programme_id', v_row.id, 'code', v_row.code, 'version', v_row.version);
end
$$;

-- PROGRAMME_UPDATE {programme_id, ...} + expected_version. `synthetic` and
-- `code` are not changeable: one is a safety invariant, the other an identifier
-- other systems may already quote.
create function app.cmd_programme_update(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['programme_id', 'name', 'client_name', 'status', 'starts_on', 'ends_on', 'visit_form_id',
          'field_map', 'outcome_map', 'signal_config', 'property_visibility', 'notes'],
    array['programme_id']);
  v_id uuid := app.programme_uuid(v_p, 'programme_id');
  v_before public.programmes;
  v_after public.programmes;
begin
  perform app.programme_require('programme.manage');
  select * into v_before from public.programmes where id = v_id for update;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_before.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_before.version));
  end if;
  if v_p ? 'visit_form_id' then
    perform app.programme_assert_visit_form(app.programme_uuid(v_p, 'visit_form_id'));
  end if;

  update public.programmes set
    name                = coalesce(app.txt(v_p, 'name'), v_before.name),
    client_name         = case when v_p ? 'client_name' then app.txt(v_p, 'client_name') else v_before.client_name end,
    status              = coalesce(app.txt(v_p, 'status'), v_before.status),
    starts_on           = case when v_p ? 'starts_on' then nullif(app.txt(v_p, 'starts_on'), '')::date else v_before.starts_on end,
    ends_on             = case when v_p ? 'ends_on' then nullif(app.txt(v_p, 'ends_on'), '')::date else v_before.ends_on end,
    visit_form_id       = case when v_p ? 'visit_form_id' then app.programme_uuid(v_p, 'visit_form_id') else v_before.visit_form_id end,
    field_map           = coalesce(v_p -> 'field_map', v_before.field_map),
    outcome_map         = coalesce(v_p -> 'outcome_map', v_before.outcome_map),
    signal_config       = coalesce(v_p -> 'signal_config', v_before.signal_config),
    property_visibility = coalesce(app.txt(v_p, 'property_visibility'), v_before.property_visibility),
    notes               = case when v_p ? 'notes' then app.txt(v_p, 'notes') else v_before.notes end
  where id = v_before.id
  returning * into v_after;

  perform app.audit('programme', v_after.id::text, 'PROGRAMME_UPDATE', to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('programme_id', v_after.id, 'version', v_after.version);
end
$$;

-- PROGRAMME_ASSIGN {programme_id, person_id, property_id?, note?}
create function app.cmd_programme_assign(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['programme_id', 'person_id', 'property_id', 'note'],
                           array['programme_id', 'person_id']);
  v_programme public.programmes := app.programme_load(app.programme_uuid(v_p, 'programme_id'));
  v_person uuid := app.programme_uuid(v_p, 'person_id');
  v_property uuid := app.programme_uuid(v_p, 'property_id');
  v_row public.programme_assignments;
begin
  perform app.programme_require('programme.manage');
  if not exists (select 1 from public.people p where p.id = v_person and p.active) then
    perform app.fail('PROGRAMME_PERSON_NOT_FOUND');
  end if;
  if v_property is not null and not exists (
       select 1 from public.programme_properties pp
       where pp.id = v_property and pp.programme_id = v_programme.id) then
    perform app.fail('PROGRAMME_PROPERTY_NOT_FOUND');
  end if;

  insert into public.programme_assignments (programme_id, property_id, person_id, note)
  values (v_programme.id, v_property, v_person, app.txt(v_p, 'note'))
  on conflict do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Already assigned (possibly ended): reinstate rather than duplicate.
    update public.programme_assignments set active = true, ended_on = null, note = coalesce(app.txt(v_p, 'note'), note)
    where programme_id = v_programme.id and person_id = v_person
      and property_id is not distinct from v_property
    returning * into v_row;
  end if;

  perform app.audit('programme_assignment', v_row.id::text, 'PROGRAMME_ASSIGN', null, to_jsonb(v_row));
  return jsonb_build_object('assignment_id', v_row.id, 'programme_id', v_programme.id,
                            'person_id', v_person, 'property_id', v_property);
end
$$;

-- PROGRAMME_UNASSIGN {assignment_id, reason?}
create function app.cmd_programme_unassign(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['assignment_id', 'reason'], array['assignment_id']);
  v_before public.programme_assignments;
  v_after public.programme_assignments;
begin
  perform app.programme_require('programme.manage');
  select * into v_before from public.programme_assignments
  where id = app.programme_uuid(v_p, 'assignment_id') for update;
  if not found then perform app.fail('PROGRAMME_ASSIGNMENT_NOT_FOUND'); end if;
  if not v_before.active then perform app.fail('PROGRAMME_ASSIGNMENT_ALREADY_ENDED'); end if;

  update public.programme_assignments
  set active = false, ended_on = app.london_date()
  where id = v_before.id
  returning * into v_after;

  perform app.audit('programme_assignment', v_after.id::text, 'PROGRAMME_UNASSIGN',
                    to_jsonb(v_before), to_jsonb(v_after), app.txt(v_p, 'reason'));
  return jsonb_build_object('assignment_id', v_after.id, 'active', false);
end
$$;

-- PROGRAMME_PROPERTY_UPDATE {property_id, ...} + expected_version
-- An audited correction. programme_id and synthetic are never changeable.
create function app.cmd_programme_property_update(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['property_id', 'external_ref', 'address_line1', 'address_line2', 'town', 'postcode',
          'expected_meter_serial', 'existing_sim_serial', 'notes', 'active'],
    array['property_id']);
  v_before public.programme_properties;
  v_after public.programme_properties;
begin
  perform app.programme_require('programme.manage');
  select * into v_before from public.programme_properties
  where id = app.programme_uuid(v_p, 'property_id') for update;
  if not found then perform app.fail('PROGRAMME_PROPERTY_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_before.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_before.version));
  end if;

  update public.programme_properties set
    external_ref          = coalesce(app.txt(v_p, 'external_ref'), v_before.external_ref),
    address_line1         = coalesce(app.txt(v_p, 'address_line1'), v_before.address_line1),
    address_line2         = case when v_p ? 'address_line2' then app.txt(v_p, 'address_line2') else v_before.address_line2 end,
    town                  = case when v_p ? 'town' then app.txt(v_p, 'town') else v_before.town end,
    postcode              = case when v_p ? 'postcode' then app.txt(v_p, 'postcode') else v_before.postcode end,
    expected_meter_serial = case when v_p ? 'expected_meter_serial' then app.txt(v_p, 'expected_meter_serial')
                                 else v_before.expected_meter_serial end,
    existing_sim_serial   = case when v_p ? 'existing_sim_serial' then app.txt(v_p, 'existing_sim_serial')
                                 else v_before.existing_sim_serial end,
    notes                 = case when v_p ? 'notes' then app.txt(v_p, 'notes') else v_before.notes end,
    active                = coalesce((v_p ->> 'active')::boolean, v_before.active)
  where id = v_before.id
  returning * into v_after;

  perform app.audit('programme_property', v_after.id::text, 'PROGRAMME_PROPERTY_UPDATE',
                    to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('property_id', v_after.id, 'version', v_after.version);
end
$$;

-- -----------------------------------------------------------------------------
-- 10. Commands: the field visit
-- -----------------------------------------------------------------------------

-- PROGRAMME_VISIT_START {visit_id, programme_id, property_id}
-- Opens a draft so photographs have something to belong to before there are any
-- answers. The draft is on no board and in no count; it becomes a visit when it
-- is submitted. Replaying the same command_id returns the same draft.
create function app.cmd_programme_visit_start(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['visit_id', 'programme_id', 'property_id'],
                           array['visit_id', 'programme_id', 'property_id']);
  v_visit_id uuid := app.programme_uuid(v_p, 'visit_id');
  v_programme public.programmes := app.programme_load(app.programme_uuid(v_p, 'programme_id'));
  v_property public.programme_properties;
  v_existing public.programme_visits;
  v_row public.programme_visits;
begin
  perform app.programme_require('programme.visit.submit');
  if v_programme.status not in ('Planning', 'Active') then perform app.fail('PROGRAMME_NOT_ACTIVE'); end if;

  select * into v_existing from public.programme_visits where id = v_visit_id;
  if found then
    if v_existing.installer_id <> app.actor_id(p_actor) then perform app.fail('PROGRAMME_VISIT_NOT_YOURS'); end if;
    return jsonb_build_object('visit_id', v_existing.id, 'review_status', v_existing.review_status,
                              'version', v_existing.version, 'created', false);
  end if;

  select * into v_property from public.programme_properties
  where id = app.programme_uuid(v_p, 'property_id') and programme_id = v_programme.id;
  if not found then perform app.fail('PROGRAMME_PROPERTY_NOT_FOUND'); end if;
  if not v_property.active then perform app.fail('PROGRAMME_PROPERTY_WITHDRAWN'); end if;
  -- A field worker records visits for properties they may see.
  if not app.programme_property_visible(v_property) then
    perform app.fail('PROGRAMME_PROPERTY_NOT_ASSIGNED');
  end if;

  insert into public.programme_visits (id, programme_id, property_id, installer_id, review_status, synthetic)
  values (v_visit_id, v_programme.id, v_property.id, app.actor_id(p_actor), 'Draft', v_programme.synthetic)
  returning * into v_row;

  perform app.audit('programme_visit', v_row.id::text, 'PROGRAMME_VISIT_START', null,
                    app.programme_visit_summary(v_row));
  return jsonb_build_object('visit_id', v_row.id, 'review_status', v_row.review_status,
                            'version', v_row.version, 'created', true);
end
$$;

-- PROGRAMME_VISIT_SUBMIT {visit_id, form_id, revision_id, submission_id, answers}
--                        + expected_version
--
-- The one path from a filled-in form to a visit. It does NOT trust the browser's
-- form logic:
--   * the answers are validated against the revision IN THE DATABASE
--     (app.forms_validate_answers), which drops hidden answers and refuses
--     unknown fields;
--   * the revision must belong to the programme's configured form, and is
--     stored on the visit, so editing the form later cannot reinterpret this
--     submission;
--   * the canonical values are read out of the validated answers through the
--     programme's field map and typed here;
--   * the outcome's requirements (required values AND required evidence) are
--     checked again from app.programme_outcome_requirements, whatever the form
--     said;
--   * every photograph must be a registration of this visit by this person, and
--     its bytes must be in storage, or nothing is written at all.
create function app.cmd_programme_visit_submit(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['visit_id', 'form_id', 'revision_id', 'submission_id', 'answers'],
    array['visit_id', 'form_id', 'revision_id', 'submission_id', 'answers']);
  v_before public.programme_visits;
  v_after public.programme_visits;
  v_programme public.programmes;
  v_property public.programme_properties;
  v_rev public.form_revisions;
  v_submission jsonb;
  v_answers jsonb;
  v_map jsonb;
  v_outcome_raw jsonb;
  v_outcome text;
  v_serial text;
  v_reading numeric;
  v_sim text;
  v_csq integer;
  v_comments text;
  v_property_answer uuid;
  v_requirements jsonb;
  v_field text;
  v_category text;
  v_ids uuid[];
  v_id uuid;
  v_matches boolean;
  v_missing boolean;
  v_signal text;
  v_reasons jsonb := '[]'::jsonb;
  v_recommended text;
begin
  perform app.programme_require('programme.visit.submit');

  select * into v_before from public.programme_visits
  where id = app.programme_uuid(v_p, 'visit_id') for update;
  if not found then perform app.fail('PROGRAMME_VISIT_NOT_FOUND'); end if;
  if v_before.installer_id <> app.actor_id(p_actor) then perform app.fail('PROGRAMME_VISIT_NOT_YOURS'); end if;
  if app.expected_version(p_request) <> v_before.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_before.version));
  end if;
  -- One submission per visit. A retry replays through the command ledger; a
  -- second, different submission for the same visit is a mistake, not a retry.
  if v_before.review_status <> 'Draft' then perform app.fail('PROGRAMME_VISIT_ALREADY_SUBMITTED'); end if;

  select * into v_programme from public.programmes where id = v_before.programme_id for share;
  if v_programme.status not in ('Planning', 'Active') then perform app.fail('PROGRAMME_NOT_ACTIVE'); end if;
  if v_programme.visit_form_id is null then perform app.fail('PROGRAMME_NO_VISIT_FORM'); end if;
  if v_programme.visit_form_id is distinct from app.programme_uuid(v_p, 'form_id') then
    perform app.fail('PROGRAMME_WRONG_FORM');
  end if;

  select * into v_rev from public.form_revisions where id = app.programme_uuid(v_p, 'revision_id');
  if not found or v_rev.form_id <> v_programme.visit_form_id then
    perform app.fail('PROGRAMME_WRONG_FORM_REVISION');
  end if;

  -- The submission is the audit artifact, validated against that revision.
  v_submission := app.forms_staff_submit(app.programme_uuid(v_p, 'submission_id'), v_rev.form_id, v_rev.id,
                                         v_p -> 'answers', p_actor);
  v_answers := v_submission -> 'answers';

  v_map := v_programme.field_map;
  if jsonb_typeof(v_map) <> 'object' or v_map = '{}'::jsonb then
    perform app.fail('PROGRAMME_FIELD_MAP_INVALID', jsonb_build_object('key', 'field_map'));
  end if;

  -- The property, if the form asks for it, must be the visit's own property.
  -- The draft already fixed which property this is; a mismatch means the person
  -- changed the selection after starting, which is a new visit, not this one.
  v_property_answer := nullif(app.programme_mapped_answer(v_map, 'property', v_answers) #>> '{}', '')::uuid;
  if v_property_answer is not null and v_property_answer <> v_before.property_id then
    perform app.fail('PROGRAMME_PROPERTY_MISMATCH');
  end if;

  v_outcome_raw := app.programme_mapped_answer(v_map, 'outcome', v_answers);
  if v_outcome_raw is null then perform app.fail('PROGRAMME_OUTCOME_REQUIRED'); end if;
  v_outcome := v_programme.outcome_map ->> (v_outcome_raw #>> '{}');
  if v_outcome is null or not v_outcome = any (app.programme_outcomes()) then
    perform app.fail('PROGRAMME_UNKNOWN_OUTCOME', jsonb_build_object('answer', v_outcome_raw #>> '{}'));
  end if;

  v_serial   := nullif(btrim(coalesce(app.programme_mapped_answer(v_map, 'actual_meter_serial', v_answers) #>> '{}', '')), '');
  v_sim      := nullif(btrim(coalesce(app.programme_mapped_answer(v_map, 'new_sim_serial', v_answers) #>> '{}', '')), '');
  v_comments := nullif(btrim(coalesce(app.programme_mapped_answer(v_map, 'comments', v_answers) #>> '{}', '')), '');
  begin
    v_reading := nullif(app.programme_mapped_answer(v_map, 'meter_reading', v_answers) #>> '{}', '')::numeric;
    v_csq     := nullif(app.programme_mapped_answer(v_map, 'csq', v_answers) #>> '{}', '')::integer;
  exception when others then
    perform app.fail('PROGRAMME_INVALID_MEASUREMENT');
  end;
  if v_csq is not null and (v_csq < coalesce((v_programme.signal_config ->> 'min')::int, 0)
                            or v_csq > coalesce((v_programme.signal_config ->> 'max')::int, 31)) then
    perform app.fail('PROGRAMME_CSQ_OUT_OF_RANGE',
      jsonb_build_object('min', coalesce((v_programme.signal_config ->> 'min')::int, 0),
                         'max', coalesce((v_programme.signal_config ->> 'max')::int, 31)));
  end if;

  -- The outcome's own requirements, applied to the submitted values - not to
  -- what the browser decided was visible.
  v_requirements := app.programme_outcome_requirements(v_outcome);
  for v_field in select value #>> '{}' from jsonb_array_elements(v_requirements -> 'fields') loop
    -- (assigned first: PL/pgSQL cannot read a CASE expression as an IF condition)
    v_missing := case v_field
                   when 'actual_meter_serial' then v_serial is null
                   when 'meter_reading' then v_reading is null
                   when 'new_sim_serial' then v_sim is null
                   when 'csq' then v_csq is null
                   else false end;
    if v_missing then
      perform app.fail('PROGRAMME_VALUE_REQUIRED', jsonb_build_object('field', v_field, 'outcome', v_outcome));
    end if;
  end loop;

  -- Evidence: required kinds must be present, and every file named by any photo
  -- question must be this visit's, this person's, and actually stored.
  for v_category in select unnest(app.programme_evidence_categories()) loop
    v_ids := app.programme_mapped_evidence(v_map, v_category, v_answers);
    if cardinality(v_ids) = 0
       and (v_requirements -> 'evidence') @> jsonb_build_array(v_category) then
      perform app.fail('PROGRAMME_EVIDENCE_REQUIRED',
                       jsonb_build_object('category', v_category, 'outcome', v_outcome));
    end if;
    foreach v_id in array v_ids loop
      perform app.programme_attach_evidence(v_before.id, v_id, v_category);
    end loop;
  end loop;

  -- Derived assessments.
  v_matches := case
    when v_outcome = 'TenantNotHome' then null
    when v_serial is null then null
    else (select app.programme_norm_serial(v_serial) = pp.expected_serial_norm
          from public.programme_properties pp where pp.id = v_before.property_id
            and pp.expected_serial_norm is not null) end;
  v_signal := app.programme_signal_class(v_programme.signal_config, v_csq);

  if v_matches is false then v_reasons := v_reasons || '["MeterSerialMismatch"]'::jsonb; end if;
  if v_matches is null and v_outcome <> 'TenantNotHome' then
    v_reasons := v_reasons || '["MeterSerialNotComparable"]'::jsonb;
  end if;
  if v_signal = 'Bad' then v_reasons := v_reasons || '["BadSignal"]'::jsonb; end if;
  if v_signal = 'Advisory' then v_reasons := v_reasons || '["AdvisorySignal"]'::jsonb; end if;
  if v_outcome = 'MeterDead' then v_reasons := v_reasons || '["MeterDead"]'::jsonb; end if;
  if v_outcome = 'TenantNotHome' then v_reasons := v_reasons || '["NoAccess"]'::jsonb; end if;
  if v_outcome = 'SimChangedPortalNotWorking' then
    v_reasons := v_reasons || '["InstallerReportsPortalNotWorking"]'::jsonb;
  end if;
  if app.programme_outcome_is_sim_change(v_outcome) then
    v_reasons := v_reasons || '["PortalVerificationRequired"]'::jsonb;
  end if;

  -- A RECOMMENDATION for the reviewer. 'CompleteAndWorking' here still cannot be
  -- applied without portal_verification = 'ConfirmedLive' (table constraint), so
  -- recommending it never bypasses the check - it only says "nothing the
  -- installer reported is wrong".
  v_recommended := case
    when v_outcome = 'TenantNotHome' then 'NoAccessRebook'
    when v_outcome = 'MeterDead' then 'MeterRequiresChanging'
    when v_outcome = 'SimChangedPortalNotWorking' then 'ActionRequired'
    when v_matches is not true then 'ActionRequired'
    when v_signal is distinct from 'Good' then 'ActionRequired'
    else 'CompleteAndWorking' end;

  update public.programme_visits set
    form_id                 = v_rev.form_id,
    form_revision_id        = v_rev.id,
    submission_id           = (v_submission ->> 'submission_id')::uuid,
    outcome                 = v_outcome,
    actual_meter_serial     = v_serial,
    meter_reading           = v_reading,
    new_sim_serial          = v_sim,
    csq                     = v_csq,
    installer_comments      = v_comments,
    meter_serial_matches    = v_matches,
    signal_classification   = v_signal,
    portal_check_required   = app.programme_outcome_is_sim_change(v_outcome),
    review_required         = true,
    review_reasons          = v_reasons,
    recommended_disposition = v_recommended,
    review_status           = 'AwaitingReview',
    disposition             = 'AwaitingReview',
    visit_date              = app.london_date(),
    submitted_at            = now()
  where id = v_before.id
  returning * into v_after;

  perform app.audit('programme_visit', v_after.id::text, 'PROGRAMME_VISIT_SUBMIT',
                    app.programme_visit_summary(v_before), app.programme_visit_summary(v_after));
  return jsonb_build_object('visit_id', v_after.id, 'outcome', v_after.outcome,
                            'submission_id', v_after.submission_id,
                            'meter_serial_matches', v_after.meter_serial_matches,
                            'signal_classification', v_after.signal_classification,
                            'review_reasons', v_after.review_reasons,
                            'recommended_disposition', v_after.recommended_disposition,
                            'review_status', v_after.review_status, 'disposition', v_after.disposition,
                            'version', v_after.version);
end
$$;

-- PROGRAMME_VISIT_REVIEW {visit_id, disposition, portal_verification?,
--                         action_note?, reopen?} + expected_version
--
-- The ONE canonical transition for a visit's disposition. The board's
-- drag-and-drop, the review screen's buttons and any future caller all come
-- through here, so none of them can bypass a rule. In particular:
--   * 'CompleteAndWorking' requires portal_verification = 'ConfirmedLive' -
--     checked here for a clear refusal, and again by the table constraint;
--   * portal verification may only be recorded for a visit where the portal is
--     relevant (a SIM change), so "confirmed live" cannot be attached to a
--     no-access visit to force it complete.
create function app.cmd_programme_visit_review(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['visit_id', 'disposition', 'portal_verification', 'action_note', 'reopen'],
    array['visit_id', 'disposition']);
  v_before public.programme_visits;
  v_after public.programme_visits;
  v_disposition text := app.txt(v_p, 'disposition');
  v_portal text := app.txt(v_p, 'portal_verification');
  v_reopen boolean := coalesce((v_p ->> 'reopen')::boolean, false);
begin
  perform app.programme_require('programme.review');

  select * into v_before from public.programme_visits
  where id = app.programme_uuid(v_p, 'visit_id') for update;
  if not found then perform app.fail('PROGRAMME_VISIT_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_before.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_before.version));
  end if;
  if v_before.review_status = 'Draft' then perform app.fail('PROGRAMME_VISIT_NOT_SUBMITTED'); end if;

  if not v_disposition = any (app.programme_dispositions()) then
    perform app.fail('PROGRAMME_INVALID_DISPOSITION');
  end if;
  -- Putting a visit back in the queue is an explicit act, not a side effect of
  -- naming the queue's own column.
  if v_disposition = 'AwaitingReview' and not v_reopen then
    perform app.fail('PROGRAMME_REOPEN_REQUIRED');
  end if;

  if v_portal is not null then
    if v_portal not in ('ConfirmedLive', 'NotLive', 'UnableToVerify') then
      perform app.fail('PROGRAMME_INVALID_PORTAL_VERIFICATION');
    end if;
    if not v_before.portal_check_required then
      perform app.fail('PROGRAMME_PORTAL_NOT_APPLICABLE');
    end if;
  end if;

  -- A good CSQ is not a working meter. This is the rule the whole review exists
  -- for, so it refuses in words here as well as being impossible at the table.
  if v_disposition = 'CompleteAndWorking'
     and coalesce(v_portal, v_before.portal_verification) is distinct from 'ConfirmedLive' then
    perform app.fail('PROGRAMME_PORTAL_CONFIRMATION_REQUIRED');
  end if;

  update public.programme_visits set
    disposition         = v_disposition,
    portal_verification = coalesce(v_portal, v_before.portal_verification),
    action_note         = case when v_p ? 'action_note' then app.txt(v_p, 'action_note') else v_before.action_note end,
    review_status       = case when v_disposition = 'AwaitingReview' then 'AwaitingReview' else 'Reviewed' end,
    reviewed_by         = case when v_disposition = 'AwaitingReview' then null else app.actor_id(p_actor) end,
    reviewed_at         = case when v_disposition = 'AwaitingReview' then null else now() end
  where id = v_before.id
  returning * into v_after;

  perform app.audit('programme_visit', v_after.id::text,
                    case when v_reopen then 'PROGRAMME_VISIT_REOPEN' else 'PROGRAMME_VISIT_REVIEW' end,
                    app.programme_visit_summary(v_before), app.programme_visit_summary(v_after),
                    app.txt(v_p, 'action_note'));
  return jsonb_build_object('visit_id', v_after.id, 'disposition', v_after.disposition,
                            'portal_verification', v_after.portal_verification,
                            'review_status', v_after.review_status, 'version', v_after.version);
end
$$;

-- -----------------------------------------------------------------------------
-- 11. Commands: property import (upload -> parse -> map -> validate -> preview -> import)
--
-- The browser parses the file (it is the only place the file exists) and stages
-- the rows POSITIONALLY: a header name is a label, the column index is the
-- identity, because real exports repeat header names. Everything after that -
-- mapping, validation, the create/update decision and the import itself - is
-- computed in the database, so the preview is the real thing rather than a
-- second implementation of it.
-- -----------------------------------------------------------------------------

create function app.programme_import_keys()
returns text[]
language sql immutable set search_path = ''
as $$
  select array['external_ref', 'address_line1', 'address_line2', 'town', 'postcode',
               'expected_meter_serial', 'existing_sim_serial', 'notes']
$$;

create function app.programme_import_required_keys()
returns text[]
language sql immutable set search_path = ''
as $$ select array['external_ref', 'address_line1'] $$;

-- PROGRAMME_IMPORT_CREATE {import_id, programme_id, filename, header}
create function app.cmd_programme_import_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['import_id', 'programme_id', 'filename', 'header'],
                           array['import_id', 'programme_id', 'filename', 'header']);
  v_programme public.programmes := app.programme_load(app.programme_uuid(v_p, 'programme_id'));
  v_existing public.programme_imports;
  v_row public.programme_imports;
begin
  perform app.programme_require('programme.manage');
  if jsonb_typeof(v_p -> 'header') <> 'array'
     or jsonb_array_length(v_p -> 'header') not between 1 and 200 then
    perform app.fail('PROGRAMME_IMPORT_HEADER_INVALID');
  end if;

  select * into v_existing from public.programme_imports where id = app.programme_uuid(v_p, 'import_id');
  if found then
    return jsonb_build_object('import_id', v_existing.id, 'status', v_existing.status,
                              'row_count', v_existing.row_count, 'version', v_existing.version);
  end if;

  insert into public.programme_imports (id, programme_id, filename, header)
  values (app.programme_uuid(v_p, 'import_id'), v_programme.id, app.txt(v_p, 'filename'), v_p -> 'header')
  returning * into v_row;

  perform app.audit('programme_import', v_row.id::text, 'PROGRAMME_IMPORT_CREATE', null,
    jsonb_build_object('programme_id', v_programme.id, 'filename', v_row.filename,
                       'columns', jsonb_array_length(v_row.header)));
  return jsonb_build_object('import_id', v_row.id, 'status', v_row.status, 'row_count', 0,
                            'version', v_row.version);
end
$$;

-- PROGRAMME_IMPORT_ADD_ROWS {import_id, from_index, rows}
-- Staged in chunks so 1,400 rows do not become one enormous request. Chunks are
-- idempotent by the command ledger AND by (import_id, row_index), so a repeated
-- chunk cannot double a row.
create function app.cmd_programme_import_add_rows(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['import_id', 'from_index', 'rows'],
                           array['import_id', 'from_index', 'rows']);
  v_import public.programme_imports;
  v_from integer;
  v_width integer;
  v_added integer := 0;
  v_row jsonb;
  v_index integer;
begin
  perform app.programme_require('programme.manage');
  select * into v_import from public.programme_imports
  where id = app.programme_uuid(v_p, 'import_id') for update;
  if not found then perform app.fail('PROGRAMME_IMPORT_NOT_FOUND'); end if;
  if v_import.status <> 'Draft' then perform app.fail('PROGRAMME_IMPORT_NOT_DRAFT'); end if;

  if (v_p ->> 'from_index') !~ '^[0-9]+$' then perform app.fail('PROGRAMME_IMPORT_ROWS_INVALID'); end if;
  v_from := (v_p ->> 'from_index')::int;
  if v_from < 1 then perform app.fail('PROGRAMME_IMPORT_ROWS_INVALID'); end if;
  if jsonb_typeof(v_p -> 'rows') <> 'array' or jsonb_array_length(v_p -> 'rows') not between 1 and 500 then
    perform app.fail('PROGRAMME_IMPORT_ROWS_INVALID');
  end if;
  v_width := jsonb_array_length(v_import.header);

  v_index := v_from;
  for v_row in select value from jsonb_array_elements(v_p -> 'rows') loop
    if jsonb_typeof(v_row) <> 'array' or jsonb_array_length(v_row) <> v_width then
      perform app.fail('PROGRAMME_IMPORT_ROW_WIDTH', jsonb_build_object('row', v_index, 'expected', v_width));
    end if;
    insert into public.programme_import_rows (import_id, row_index, cells)
    values (v_import.id, v_index, v_row)
    on conflict (import_id, row_index) do nothing;
    if found then v_added := v_added + 1; end if;
    v_index := v_index + 1;
  end loop;

  update public.programme_imports
  set row_count = (select count(*) from public.programme_import_rows r where r.import_id = v_import.id)
  where id = v_import.id
  returning * into v_import;

  perform app.audit('programme_import', v_import.id::text, 'PROGRAMME_IMPORT_ADD_ROWS', null,
    jsonb_build_object('from_index', v_from, 'added', v_added, 'row_count', v_import.row_count));
  return jsonb_build_object('import_id', v_import.id, 'row_count', v_import.row_count,
                            'added', v_added, 'version', v_import.version);
end
$$;

-- PROGRAMME_IMPORT_MAP {import_id, mapping} + expected_version
-- Applies the chosen column mapping to every staged row and records, per row,
-- the canonical values, every problem found and what importing would do. The
-- preview reads these rows, so what the person approves is what will happen.
create function app.cmd_programme_import_map(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['import_id', 'mapping'], array['import_id', 'mapping']);
  v_import public.programme_imports;
  v_after public.programme_imports;
  v_mapping jsonb := v_p -> 'mapping';
  v_key text;
  v_width integer;
  v_seen integer[] := '{}';
  v_column integer;
begin
  perform app.programme_require('programme.manage');
  select * into v_import from public.programme_imports
  where id = app.programme_uuid(v_p, 'import_id') for update;
  if not found then perform app.fail('PROGRAMME_IMPORT_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_import.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_import.version));
  end if;
  if v_import.status not in ('Draft', 'Mapped') then perform app.fail('PROGRAMME_IMPORT_NOT_DRAFT'); end if;
  if v_import.row_count = 0 then perform app.fail('PROGRAMME_IMPORT_EMPTY'); end if;

  v_width := jsonb_array_length(v_import.header);
  if jsonb_typeof(v_mapping) <> 'object' then perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID'); end if;
  for v_key in select jsonb_object_keys(v_mapping) loop
    if not v_key = any (app.programme_import_keys()) then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID', jsonb_build_object('key', v_key));
    end if;
    if jsonb_typeof(v_mapping -> v_key) <> 'number' then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID', jsonb_build_object('key', v_key));
    end if;
    v_column := (v_mapping ->> v_key)::int;
    if v_column < 0 or v_column >= v_width then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_INVALID', jsonb_build_object('key', v_key, 'column', v_column));
    end if;
    -- One column cannot mean two things.
    if v_column = any (v_seen) then
      perform app.fail('PROGRAMME_IMPORT_COLUMN_REUSED', jsonb_build_object('column', v_column));
    end if;
    v_seen := v_seen || v_column;
  end loop;
  foreach v_key in array app.programme_import_required_keys() loop
    if not v_mapping ? v_key then
      perform app.fail('PROGRAMME_IMPORT_MAPPING_REQUIRED', jsonb_build_object('key', v_key));
    end if;
  end loop;

  -- One pass over the staged rows: canonical values, problems, and the action.
  with mapped as (
    select r.id, r.row_index,
           (select jsonb_object_agg(m.key, nullif(btrim(coalesce(r.cells ->> (m.value #>> '{}')::int, '')), ''))
            from jsonb_each(v_mapping) m) as values
    from public.programme_import_rows r
    where r.import_id = v_import.id
  ), judged as (
    select m.id, m.row_index, m.values,
           (select pp.id from public.programme_properties pp
            where pp.programme_id = v_import.programme_id
              and pp.external_ref = (m.values ->> 'external_ref')) as existing_id,
           (
             select coalesce(jsonb_agg(problem), '[]'::jsonb) from (
               select jsonb_build_object('field', 'external_ref', 'problem', 'missing') as problem
               where m.values ->> 'external_ref' is null
               union all
               select jsonb_build_object('field', 'external_ref', 'problem', 'too long')
               where char_length(m.values ->> 'external_ref') > 100
               union all
               select jsonb_build_object('field', 'address_line1', 'problem', 'missing')
               where m.values ->> 'address_line1' is null
               union all
               select jsonb_build_object('field', 'address_line1', 'problem', 'too long')
               where char_length(m.values ->> 'address_line1') > 200
               union all
               -- The same reference twice in one file: importing both would make
               -- the second silently overwrite the first.
               select jsonb_build_object('field', 'external_ref', 'problem', 'repeated in this file')
               where m.values ->> 'external_ref' is not null
                 and exists (
                   select 1 from public.programme_import_rows r2
                   join lateral (select nullif(btrim(coalesce(r2.cells ->> (v_mapping ->> 'external_ref')::int, '')), '') as ref) x on true
                   where r2.import_id = v_import.id and r2.row_index < m.row_index
                     and x.ref = (m.values ->> 'external_ref'))
             ) p
           ) as problems
    from mapped m
  )
  update public.programme_import_rows r set
    mapped = j.values,
    problems = j.problems,
    action = case when jsonb_array_length(j.problems) > 0 then 'Invalid'
                  when j.existing_id is not null then 'Update'
                  else 'Create' end,
    property_id = j.existing_id
  from judged j
  where r.id = j.id;

  update public.programme_imports set
    mapping = v_mapping,
    status = 'Mapped',
    valid_rows = (select count(*) from public.programme_import_rows r
                  where r.import_id = v_import.id and r.action in ('Create', 'Update')),
    invalid_rows = (select count(*) from public.programme_import_rows r
                    where r.import_id = v_import.id and r.action = 'Invalid')
  where id = v_import.id
  returning * into v_after;

  perform app.audit('programme_import', v_after.id::text, 'PROGRAMME_IMPORT_MAP',
    jsonb_build_object('mapping', v_import.mapping),
    jsonb_build_object('mapping', v_mapping, 'valid_rows', v_after.valid_rows,
                       'invalid_rows', v_after.invalid_rows));
  return jsonb_build_object('import_id', v_after.id, 'status', v_after.status,
                            'valid_rows', v_after.valid_rows, 'invalid_rows', v_after.invalid_rows,
                            'version', v_after.version);
end
$$;

-- PROGRAMME_IMPORT_APPLY {import_id} + expected_version
-- Creates and updates properties from the valid rows only. Invalid rows are
-- left alone and stay visible, so a partial file can be fixed and re-imported
-- without losing what was already done.
create function app.cmd_programme_import_apply(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['import_id'], array['import_id']);
  v_import public.programme_imports;
  v_after public.programme_imports;
  v_programme public.programmes;
  v_created integer := 0;
  v_updated integer := 0;
  v_row public.programme_import_rows;
  v_property public.programme_properties;
begin
  perform app.programme_require('programme.manage');
  select * into v_import from public.programme_imports
  where id = app.programme_uuid(v_p, 'import_id') for update;
  if not found then perform app.fail('PROGRAMME_IMPORT_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_import.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_import.version));
  end if;
  if v_import.status <> 'Mapped' then perform app.fail('PROGRAMME_IMPORT_NOT_MAPPED'); end if;
  select * into v_programme from public.programmes where id = v_import.programme_id for share;

  for v_row in
    select * from public.programme_import_rows
    where import_id = v_import.id and action in ('Create', 'Update')
    order by row_index
  loop
    insert into public.programme_properties (
      programme_id, external_ref, address_line1, address_line2, town, postcode,
      expected_meter_serial, existing_sim_serial, notes, source_row, import_id, synthetic)
    values (
      v_import.programme_id, v_row.mapped ->> 'external_ref', v_row.mapped ->> 'address_line1',
      v_row.mapped ->> 'address_line2', v_row.mapped ->> 'town', v_row.mapped ->> 'postcode',
      v_row.mapped ->> 'expected_meter_serial', v_row.mapped ->> 'existing_sim_serial',
      v_row.mapped ->> 'notes',
      jsonb_build_object('header', v_import.header, 'cells', v_row.cells, 'row_index', v_row.row_index),
      v_import.id, v_programme.synthetic)
    on conflict (programme_id, external_ref) do update set
      address_line1         = excluded.address_line1,
      address_line2         = excluded.address_line2,
      town                  = excluded.town,
      postcode              = excluded.postcode,
      expected_meter_serial = excluded.expected_meter_serial,
      existing_sim_serial   = excluded.existing_sim_serial,
      notes                 = coalesce(excluded.notes, programme_properties.notes),
      source_row            = excluded.source_row,
      import_id             = excluded.import_id
    returning * into v_property;

    if v_row.action = 'Create' then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
    update public.programme_import_rows set property_id = v_property.id where id = v_row.id;
  end loop;

  update public.programme_imports set
    status = 'Applied', created_count = v_created, updated_count = v_updated,
    applied_at = now(), applied_by = app.actor_id(p_actor)
  where id = v_import.id
  returning * into v_after;

  perform app.audit('programme_import', v_after.id::text, 'PROGRAMME_IMPORT_APPLY',
    jsonb_build_object('status', v_import.status),
    jsonb_build_object('status', 'Applied', 'created', v_created, 'updated', v_updated,
                       'skipped_invalid', v_after.invalid_rows));
  return jsonb_build_object('import_id', v_after.id, 'status', v_after.status,
                            'created', v_created, 'updated', v_updated,
                            'invalid_rows', v_after.invalid_rows, 'version', v_after.version);
end
$$;

-- PROGRAMME_IMPORT_DISCARD {import_id, reason?} + expected_version
create function app.cmd_programme_import_discard(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['import_id', 'reason'], array['import_id']);
  v_import public.programme_imports;
  v_after public.programme_imports;
begin
  perform app.programme_require('programme.manage');
  select * into v_import from public.programme_imports
  where id = app.programme_uuid(v_p, 'import_id') for update;
  if not found then perform app.fail('PROGRAMME_IMPORT_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_import.version then
    perform app.fail('PROGRAMME_STALE_VERSION', jsonb_build_object('current_version', v_import.version));
  end if;
  if v_import.status = 'Applied' then perform app.fail('PROGRAMME_IMPORT_ALREADY_APPLIED'); end if;

  update public.programme_imports set status = 'Discarded' where id = v_import.id returning * into v_after;
  delete from public.programme_import_rows where import_id = v_after.id;

  perform app.audit('programme_import', v_after.id::text, 'PROGRAMME_IMPORT_DISCARD',
                    jsonb_build_object('status', v_import.status), jsonb_build_object('status', 'Discarded'),
                    app.txt(v_p, 'reason'));
  return jsonb_build_object('import_id', v_after.id, 'status', v_after.status);
end
$$;

-- -----------------------------------------------------------------------------
-- 12. Registry
-- -----------------------------------------------------------------------------

-- Any active staff role may call; the handler requires the programme.*
-- permission, so capabilities decide, not role names. Every command needs
-- FN-22 Manual.
insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes)
select t, array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Installer',
                'Store', 'Finance', 'Scaffolder', 'ReadOnly'],
       false, '[{"function_id": "FN-22", "mode": "Manual"}]'::jsonb, 'programmes',
       'Handler requires the programme.* permission (role_permissions).'
from unnest(array['PROGRAMME_CREATE', 'PROGRAMME_UPDATE', 'PROGRAMME_ASSIGN', 'PROGRAMME_UNASSIGN',
                  'PROGRAMME_PROPERTY_UPDATE', 'PROGRAMME_VISIT_START', 'PROGRAMME_VISIT_SUBMIT',
                  'PROGRAMME_VISIT_REVIEW', 'PROGRAMME_IMPORT_CREATE', 'PROGRAMME_IMPORT_ADD_ROWS',
                  'PROGRAMME_IMPORT_MAP', 'PROGRAMME_IMPORT_APPLY', 'PROGRAMME_IMPORT_DISCARD']) as t;

-- -----------------------------------------------------------------------------
-- 13. Reads: the aggregates, through the existing operations-read registry
--
-- Row-level browsing (the board, the review queue, the visit list, property
-- search) is plain SELECT under the RLS policies below, exactly as Forms does.
-- Only the aggregates need a function, because they cross rows.
-- -----------------------------------------------------------------------------

-- The filters every programme read understands. Applied in SQL, so the same
-- filter means the same thing on the dashboard, in the list and in the export.
create function app.programme_visit_filter(p_request jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_request -> 'filters', '{}'::jsonb);
  v_key text;
begin
  if jsonb_typeof(v) <> 'object' then perform app.fail('R1A_INVALID_FIELDS'); end if;
  for v_key in select jsonb_object_keys(v) loop
    if v_key not in ('from', 'to', 'installer_id', 'outcome', 'disposition', 'review_status',
                     'signal_classification', 'portal_verification', 'postcode', 'area') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;
  return v;
end
$$;

create function app.read_programme_dashboard(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_programme_id uuid := app.programme_uuid(coalesce(p_request -> 'payload', p_request), 'programme_id');
  v_f jsonb := app.programme_visit_filter(p_request);
  v_programme public.programmes;
  v_today date := app.london_date();
  v_result jsonb;
begin
  if not app.programmes_on() then perform app.fail('R1A_MODE_DENIED'); end if;
  perform app.programme_require('programme.report');
  select * into v_programme from public.programmes where id = v_programme_id;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;

  with prop as (
    select pp.* from public.programme_properties pp
    where pp.programme_id = v_programme.id and pp.active
  ), visit as (
    select v.* from public.programme_visits v
    where v.programme_id = v_programme.id and v.review_status <> 'Draft'
      and (v_f ->> 'from' is null or v.visit_date >= (v_f ->> 'from')::date)
      and (v_f ->> 'to' is null or v.visit_date <= (v_f ->> 'to')::date)
      and (v_f ->> 'installer_id' is null or v.installer_id = (v_f ->> 'installer_id')::uuid)
      and (v_f ->> 'outcome' is null or v.outcome = v_f ->> 'outcome')
      and (v_f ->> 'disposition' is null or v.disposition = v_f ->> 'disposition')
      and (v_f ->> 'review_status' is null or v.review_status = v_f ->> 'review_status')
      and (v_f ->> 'signal_classification' is null or v.signal_classification = v_f ->> 'signal_classification')
      and (v_f ->> 'portal_verification' is null or v.portal_verification = v_f ->> 'portal_verification')
      and (v_f ->> 'postcode' is null or exists (
            select 1 from prop p where p.id = v.property_id
              and p.postcode_norm like app.programme_norm_postcode(v_f ->> 'postcode') || '%'))
  ), attended as (
    select distinct property_id from visit
  )
  select jsonb_build_object(
    'programme', jsonb_build_object('id', v_programme.id, 'code', v_programme.code, 'name', v_programme.name,
                                    'status', v_programme.status, 'client_name', v_programme.client_name,
                                    'starts_on', v_programme.starts_on, 'ends_on', v_programme.ends_on,
                                    'signal_config', v_programme.signal_config,
                                    'synthetic', v_programme.synthetic),
    'total_properties', (select count(*) from prop),
    'attended', (select count(*) from attended),
    'remaining', (select count(*) from prop) - (select count(*) from attended),
    'visits_total', (select count(*) from visit),
    'visits_today', (select count(*) from visit where visit_date = v_today),
    'sims_changed', (select count(*) from visit where app.programme_outcome_is_sim_change(outcome)),
    'no_access', (select count(*) from visit where outcome = 'TenantNotHome'),
    'meter_dead', (select count(*) from visit where outcome = 'MeterDead'),
    'awaiting_review', (select count(*) from visit where review_status = 'AwaitingReview'),
    'action_required', (select count(*) from visit where disposition = 'ActionRequired'),
    'meter_replacements_required', (select count(*) from visit where disposition = 'MeterRequiresChanging'),
    'no_access_rebook', (select count(*) from visit where disposition = 'NoAccessRebook'),
    'complete_and_working', (select count(*) from visit where disposition = 'CompleteAndWorking'),
    'serial_mismatches', (select count(*) from visit where meter_serial_matches is false),
    'portal_confirmed_live', (select count(*) from visit where portal_verification = 'ConfirmedLive'),
    'portal_not_live', (select count(*) from visit where portal_verification = 'NotLive'),
    'portal_unable_to_verify', (select count(*) from visit where portal_verification = 'UnableToVerify'),
    'portal_outstanding', (select count(*) from visit where portal_check_required and portal_verification is null),
    'csq_bands', jsonb_build_object(
      'good', (select count(*) from visit where signal_classification = 'Good'),
      'advisory', (select count(*) from visit where signal_classification = 'Advisory'),
      'bad', (select count(*) from visit where signal_classification = 'Bad'),
      'not_recorded', (select count(*) from visit where csq is null)),
    'by_day', coalesce((select jsonb_agg(d order by (d ->> 'date'))
                        from (select jsonb_build_object('date', visit_date, 'visits', count(*),
                                'sims_changed', count(*) filter (where app.programme_outcome_is_sim_change(outcome)),
                                'no_access', count(*) filter (where outcome = 'TenantNotHome'),
                                'meter_dead', count(*) filter (where outcome = 'MeterDead')) as d
                              from visit where visit_date is not null group by visit_date) x), '[]'::jsonb),
    'by_installer', coalesce((select jsonb_agg(d order by (d ->> 'visits')::int desc)
                        from (select jsonb_build_object('installer_id', v.installer_id,
                                'installer', pe.display_name, 'visits', count(*),
                                'sims_changed', count(*) filter (where app.programme_outcome_is_sim_change(v.outcome)),
                                'no_access', count(*) filter (where v.outcome = 'TenantNotHome')) as d
                              from visit v left join public.people pe on pe.id = v.installer_id
                              group by v.installer_id, pe.display_name) x), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$$;

-- The read model a PCH daily report needs. Nothing is emailed: the shape of the
-- client's report is still to be agreed with Ben and Dan.
create function app.read_programme_daily_report(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_request -> 'payload', p_request);
  v_programme_id uuid := app.programme_uuid(v_payload, 'programme_id');
  v_date date := coalesce(nullif(btrim(coalesce(v_payload ->> 'date', '')), '')::date, app.london_date());
  v_programme public.programmes;
begin
  if not app.programmes_on() then perform app.fail('R1A_MODE_DENIED'); end if;
  perform app.programme_require('programme.report');
  select * into v_programme from public.programmes where id = v_programme_id;
  if not found then perform app.fail('PROGRAMME_NOT_FOUND'); end if;

  return (
    with visit as (
      select v.*, pp.external_ref, pp.address_line1, pp.postcode, pp.expected_meter_serial,
             pe.display_name as installer
      from public.programme_visits v
      join public.programme_properties pp on pp.id = v.property_id
      left join public.people pe on pe.id = v.installer_id
      where v.programme_id = v_programme.id and v.visit_date = v_date and v.review_status <> 'Draft'
    )
    select jsonb_build_object(
      'programme', jsonb_build_object('id', v_programme.id, 'code', v_programme.code,
                                      'name', v_programme.name, 'client_name', v_programme.client_name),
      'date', v_date,
      'properties_attended', (select count(distinct property_id) from visit),
      'sims_swapped', (select count(*) from visit where app.programme_outcome_is_sim_change(outcome)),
      'no_access', (select count(*) from visit where outcome = 'TenantNotHome'),
      'meters_requiring_replacement', (select count(*) from visit
                                       where outcome = 'MeterDead' or disposition = 'MeterRequiresChanging'),
      'action_required', (select count(*) from visit where disposition = 'ActionRequired'),
      'complete_and_live', (select count(*) from visit where disposition = 'CompleteAndWorking'),
      'awaiting_review', (select count(*) from visit where review_status = 'AwaitingReview'),
      'awaiting_portal_confirmation', (select count(*) from visit
                                       where portal_check_required and portal_verification is null),
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
          'external_ref', external_ref, 'address', address_line1, 'postcode', postcode,
          'installer', installer, 'outcome', outcome,
          'expected_meter_serial', expected_meter_serial, 'actual_meter_serial', actual_meter_serial,
          'meter_serial_matches', meter_serial_matches, 'meter_reading', meter_reading,
          'new_sim_serial', new_sim_serial, 'csq', csq, 'signal_classification', signal_classification,
          'portal_verification', portal_verification, 'disposition', disposition,
          'review_status', review_status, 'comments', installer_comments)
        order by external_ref) from visit), '[]'::jsonb))
  );
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes)
values
  ('PROGRAMME_DASHBOARD',
   array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'],
   '[{"function_id": "FN-22", "mode": "Manual"}]'::jsonb, 'programmes',
   'Handler requires programme.report.'),
  ('PROGRAMME_DAILY_REPORT',
   array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'],
   '[{"function_id": "FN-22", "mode": "Manual"}]'::jsonb, 'programmes',
   'Handler requires programme.report. The read model for a client daily report; nothing is sent.');

-- -----------------------------------------------------------------------------
-- 14. Grants and RLS
--
-- Tables are read-only to clients. Every write above is a command.
-- -----------------------------------------------------------------------------

revoke all on public.programmes, public.programme_properties, public.programme_assignments,
  public.programme_visits, public.programme_imports, public.programme_import_rows
  from public, anon, authenticated;
grant select on public.programmes, public.programme_properties, public.programme_assignments,
  public.programme_visits, public.programme_imports, public.programme_import_rows to authenticated;
grant all on public.programmes, public.programme_properties, public.programme_assignments,
  public.programme_visits, public.programme_imports, public.programme_import_rows to service_role;

alter table public.programmes            enable row level security;
alter table public.programme_properties  enable row level security;
alter table public.programme_assignments enable row level security;
alter table public.programme_visits      enable row level security;
alter table public.programme_imports     enable row level security;
alter table public.programme_import_rows enable row level security;

create policy programmes_select on public.programmes
  for select to authenticated
  using ((select app.programmes_on()) and (select app.has_permission('programme.read')));

-- A field worker sees the properties the programme's policy allows them; office
-- and above see all of them.
create policy programme_properties_select on public.programme_properties
  for select to authenticated
  using (app.programme_property_visible(programme_properties));

create policy programme_assignments_select on public.programme_assignments
  for select to authenticated
  using ((select app.programmes_on())
         and ((select app.has_permission('programme.read.all'))
              or (person_id = (select app.current_person_id())
                  and (select app.has_permission('programme.read')))));

-- Everyone who may see the whole programme sees every visit; a field worker
-- sees their own, including their own drafts.
create policy programme_visits_select on public.programme_visits
  for select to authenticated
  using ((select app.programmes_on())
         and ((select app.has_permission('programme.read.all'))
              or (installer_id = (select app.current_person_id())
                  and (select app.has_permission('programme.read')))));

create policy programme_imports_select on public.programme_imports
  for select to authenticated
  using ((select app.programmes_on()) and (select app.has_permission('programme.manage')));

create policy programme_import_rows_select on public.programme_import_rows
  for select to authenticated
  using ((select app.programmes_on()) and (select app.has_permission('programme.manage'))
         and exists (select 1 from public.programme_imports i where i.id = import_id));

-- These back STORED GENERATED columns and CHECK constraints, which Postgres
-- evaluates as the WRITING role, so every writer needs them. Each returns a
-- constant, or a normalised copy of its argument: nothing is disclosed.
grant execute on function app.programme_norm_serial(text), app.programme_norm_postcode(text),
  app.programme_outcomes(), app.programme_dispositions(), app.programme_evidence_categories()
  to authenticated, service_role;
grant execute on function app.programmes_on(), app.programme_property_visible(public.programme_properties),
  app.programme_assigned(uuid, uuid, uuid), app.can_read_programme_evidence(jsonb, uuid),
  app.programme_signal_class(jsonb, integer), app.programme_outcome_is_sim_change(text)
  to authenticated;
grant execute on function public.programmes_enabled(), public.programme_signal_class(uuid, integer)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 15. Staff wording for the new refusals (append-only extension of the catalogue)
--
-- The generic command runner (src/lib/backend/command.ts) asks the database what
-- to say, so every screen - the review dialog, a drag-and-drop on the board, the
-- installer's form - gets the same words for the same refusal without any of
-- them knowing the codes.
-- -----------------------------------------------------------------------------

alter function app.result_error_catalogue() rename to result_error_catalogue_pre_programmes;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_programmes() || '{
  "PROGRAMME_PERMISSION_DENIED": ["Failed", "You don''t have permission to do that in this programme."],
  "PROGRAMME_NOT_FOUND": ["Failed", "That programme could not be found."],
  "PROGRAMME_NOT_ACTIVE": ["Failed", "This programme is paused or closed, so visits can''t be recorded."],
  "PROGRAMME_STALE_VERSION": ["ActionRequired", "STALE"],
  "PROGRAMME_PROPERTY_NOT_FOUND": ["Failed", "That property could not be found in this programme."],
  "PROGRAMME_PROPERTY_WITHDRAWN": ["Failed", "That property has been withdrawn from the programme."],
  "PROGRAMME_PROPERTY_NOT_ASSIGNED": ["Failed", "You''re not assigned to that property."],
  "PROGRAMME_PROPERTY_MISMATCH": ["ActionRequired", "The property on the form isn''t the one this visit was started for. Start the visit again for the right property."],
  "PROGRAMME_NOT_ASSIGNED": ["Failed", "You''re not assigned to this programme."],
  "PROGRAMME_PERSON_NOT_FOUND": ["Failed", "Choose an active person."],
  "PROGRAMME_ASSIGNMENT_NOT_FOUND": ["Failed", "That assignment could not be found."],
  "PROGRAMME_ASSIGNMENT_ALREADY_ENDED": ["Failed", "That assignment has already ended."],
  "PROGRAMME_VISIT_NOT_FOUND": ["Failed", "That visit could not be found."],
  "PROGRAMME_VISIT_NOT_YOURS": ["Failed", "That visit belongs to someone else."],
  "PROGRAMME_VISIT_NOT_SUBMITTED": ["Failed", "That visit hasn''t been submitted yet."],
  "PROGRAMME_VISIT_ALREADY_SUBMITTED": ["Failed", "This visit has already been submitted. Start a new visit if you need to record another."],
  "PROGRAMME_VISIT_CLOSED": ["Failed", "The office has finished with this visit, so nothing more can be added to it."],
  "PROGRAMME_NO_VISIT_FORM": ["Failed", "This programme has no visit form set up yet."],
  "PROGRAMME_VISIT_FORM_NOT_PUBLISHED": ["Failed", "This programme''s visit form hasn''t been published yet."],
  "PROGRAMME_VISIT_FORM_NOT_FOUND": ["Failed", "That form could not be found."],
  "PROGRAMME_VISIT_FORM_IS_TEMPLATE": ["Failed", "That is a template. Create a form from it, publish it, then use the form."],
  "PROGRAMME_WRONG_FORM": ["Failed", "That isn''t this programme''s visit form. Reload the page and try again."],
  "PROGRAMME_WRONG_FORM_REVISION": ["ActionRequired", "That version of the visit form doesn''t belong to this programme. Reload the page and try again."],
  "PROGRAMME_FIELD_MAP_INVALID": ["Failed", "This programme''s form is not set up correctly. Tell an administrator; nothing was saved."],
  "PROGRAMME_OUTCOME_REQUIRED": ["ActionRequired", "Say what happened at the visit."],
  "PROGRAMME_UNKNOWN_OUTCOME": ["Failed", "That outcome isn''t one this programme recognises. Reload the page and try again."],
  "PROGRAMME_INVALID_MEASUREMENT": ["ActionRequired", "Check the meter reading and the CSQ: they must be numbers."],
  "PROGRAMME_CSQ_OUT_OF_RANGE": ["ActionRequired", "Check the CSQ reading - it''s outside the range this programme allows."],
  "PROGRAMME_VALUE_REQUIRED": ["ActionRequired", "Something this outcome needs is missing. Check the highlighted answers."],
  "PROGRAMME_EVIDENCE_REQUIRED": ["ActionRequired", "A photo this outcome needs is missing. Add it and submit again."],
  "PROGRAMME_EVIDENCE_NOT_THIS_VISIT": ["Failed", "One of those photos belongs to a different visit. Take it again."],
  "PROGRAMME_EVIDENCE_NOT_YOURS": ["Failed", "One of those photos was uploaded by someone else."],
  "PROGRAMME_EVIDENCE_WRONG_KIND": ["Failed", "One of those photos was added as a different kind of evidence. Take it again."],
  "PROGRAMME_INVALID_DISPOSITION": ["Failed", "That isn''t one of the review outcomes."],
  "PROGRAMME_INVALID_PORTAL_VERIFICATION": ["Failed", "Choose whether the meter is live in the portal."],
  "PROGRAMME_PORTAL_NOT_APPLICABLE": ["Failed", "There''s no portal check to record for this visit - no SIM was changed."],
  "PROGRAMME_PORTAL_CONFIRMATION_REQUIRED": ["ActionRequired", "Confirm the meter is live and reporting in the PCH portal first. A good CSQ is not the same as a working meter."],
  "PROGRAMME_REOPEN_REQUIRED": ["ActionRequired", "To put this back in the review queue, choose Reopen."],
  "PROGRAMME_IMPORT_NOT_FOUND": ["Failed", "That import could not be found."],
  "PROGRAMME_IMPORT_NOT_DRAFT": ["Failed", "This import has already been mapped or applied."],
  "PROGRAMME_IMPORT_NOT_MAPPED": ["ActionRequired", "Choose which column means what, then import."],
  "PROGRAMME_IMPORT_ALREADY_APPLIED": ["Failed", "This import has already been applied and can''t be discarded."],
  "PROGRAMME_IMPORT_EMPTY": ["ActionRequired", "That file has no rows to import."],
  "PROGRAMME_IMPORT_HEADER_INVALID": ["ActionRequired", "That file''s header row could not be read."],
  "PROGRAMME_IMPORT_ROWS_INVALID": ["Failed", "The rows could not be read. Try the upload again."],
  "PROGRAMME_IMPORT_ROW_WIDTH": ["ActionRequired", "A row has a different number of columns from the header. Check the file."],
  "PROGRAMME_IMPORT_MAPPING_INVALID": ["ActionRequired", "Check the column choices."],
  "PROGRAMME_IMPORT_MAPPING_REQUIRED": ["ActionRequired", "Choose the columns for the property reference and the address."],
  "PROGRAMME_IMPORT_COLUMN_REUSED": ["ActionRequired", "Two fields are using the same column. Each field needs its own."],
  "PROGRAMME_SYNTHETIC_MISMATCH": ["Failed", "Test fixtures can only be created inside a test programme."],
  "PROGRAMME_SYNTHETIC_IMMUTABLE": ["Failed", "Whether a programme holds test fixtures can''t be changed."],
  "PROGRAMME_VISIT_IMMUTABLE": ["Failed", "A submitted visit''s property, installer and form response can''t be changed."],
  "PROGRAMME_INVALID_PROGRAMME_ID": ["Failed", "That programme reference isn''t valid."],
  "PROGRAMME_INVALID_PROPERTY_ID": ["Failed", "That property reference isn''t valid."],
  "PROGRAMME_INVALID_VISIT_ID": ["Failed", "That visit reference isn''t valid."],
  "PROGRAMME_INVALID_PERSON_ID": ["Failed", "That person reference isn''t valid."],
  "PROGRAMME_INVALID_IMPORT_ID": ["Failed", "That import reference isn''t valid."],
  "PROGRAMME_INVALID_ASSIGNMENT_ID": ["Failed", "That assignment reference isn''t valid."],
  "PROGRAMME_INVALID_SUBMISSION_ID": ["Failed", "That response reference isn''t valid."],
  "PROGRAMME_INVALID_REVISION_ID": ["Failed", "That form version reference isn''t valid."],
  "PROGRAMME_INVALID_FORM_ID": ["Failed", "That form reference isn''t valid."],
  "PROGRAMME_REQUIRED_PROGRAMME_ID": ["Failed", "A programme must be named."],
  "FORMS_NOT_LINKABLE": ["Failed", "This form has photo or lookup questions, which need a signed-in person. It can be completed in the app, but not sent as a recipient link."],
  "FORMS_REQUIRED_MISSING": ["ActionRequired", "Please answer the required questions."],
  "FORMS_INVALID_ANSWER": ["ActionRequired", "Please check your answers."],
  "FORMS_UNKNOWN_FIELD": ["ActionRequired", "This form has changed. Reload the page and try again."],
  "FORMS_REVISION_NOT_FOUND": ["ActionRequired", "The version of this form being answered no longer exists. Reload the page and try again."],
  "FORMS_NOT_PUBLISHED": ["Failed", "This programme''s visit form hasn''t been published yet."]
  }'::jsonb
$$;

-- The chain is only readable if the new link is granted too: functions created
-- here are not executable by clients by default (see the default privileges in
-- 20260919141000), and a catalogue nobody may read turns every refusal into
-- "Something went wrong".
grant execute on function app.result_error_catalogue(), app.result_error_catalogue_pre_programmes()
  to authenticated, service_role;
