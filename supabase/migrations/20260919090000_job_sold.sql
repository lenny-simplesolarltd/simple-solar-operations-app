-- =============================================================================
-- Job Sold: permissions, customers, jobs, presales, task templates, tasks,
-- task assignment rules, command idempotency, and the SOLD_INTAKE command.
--
-- Business semantics ported from the reference implementation:
--   * SOLD_INTAKE + field contract .... r1-appsheet/services.js:723-742, 1193-1235
--   * Customer / Job build ............ s05/intake.js:45-120, 146-241
--   * transforms ...................... s05/mapping.js:106-125
--   * Job reference generator ......... s05/mapping.js:219-236
--   * prebooking task generator ....... s06/gates.js:636-717
--   * PRE03 named responsibility ...... s06/gates.js:604-634
--   * staffed days .................... s06/gates.js:235-249
--   * idempotency (hardened rules) .... s04/processor.js:117-141
--
-- Replaced by native Postgres semantics (NOT ported): AppSheet request rows and
-- bots, USEREMAIL()/submitted_by checks, the Intake raw-payload table,
-- MappingRules, CommitJournal + recovery states, Sheet locks, cardinality
-- self-checks, pilot/release gates, Drive file ids, self-healing templates,
-- "first Office row"/name-based task ownership.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Explicit permissions (the enforced successor to the reference PermissionRules
-- table, which its live commands ignored).
-- -----------------------------------------------------------------------------

create table public.permissions (
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
comment on table public.customers is
  'A sale always creates a new customer; the reference never resolves or merges customers at sale.';
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
create index jobs_customer_idx on public.jobs (customer_id);
create index jobs_salesperson_idx on public.jobs (salesperson_id);
create index jobs_created_by_idx on public.jobs (created_by);
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
comment on table public.task_assignment_rules is
  'Explicit, deterministic task ownership. Exactly one active rule per template; never resolved from row order, names or roles lists.';
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
create index tasks_job_idx on public.tasks (job_id);
create index tasks_owner_open_idx on public.tasks (owner_id) where status in ('Open', 'Waiting', 'InProgress', 'Blocked');
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
create trigger customers_touch before insert or update on public.customers
  for each row execute function app.touch_row();
create trigger jobs_touch before insert or update on public.jobs
  for each row execute function app.touch_row();
create trigger task_templates_touch before insert or update on public.task_templates
  for each row execute function app.touch_row();
create trigger task_assignment_rules_touch before insert or update on public.task_assignment_rules
  for each row execute function app.touch_row();
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
create trigger presales_stamp before insert on public.presales
  for each row execute function app.stamp_created();

create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function app.audit_row_change();
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

create policy permissions_select on public.permissions
  for select to authenticated using ((select app.is_active_actor()));
create policy role_permissions_select on public.role_permissions
  for select to authenticated using ((select app.is_active_actor()));
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated with check ((select app.is_admin()));
create policy role_permissions_update on public.role_permissions
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
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
create policy presales_select on public.presales
  for select to authenticated using (exists (select 1 from public.jobs j where j.id = presales.job_id));

create policy task_templates_select on public.task_templates
  for select to authenticated using ((select app.is_active_actor()));
create policy task_templates_insert on public.task_templates
  for insert to authenticated with check ((select app.is_admin()));
create policy task_templates_update on public.task_templates
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy task_assignment_rules_select on public.task_assignment_rules
  for select to authenticated using ((select app.has_permission('task.read.all')));
create policy task_assignment_rules_insert on public.task_assignment_rules
  for insert to authenticated with check ((select app.is_admin()));
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
  ('task.read.all',            'Read every task and the task assignment rules.');

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
