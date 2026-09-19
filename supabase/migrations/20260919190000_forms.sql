-- =============================================================================
-- Forms: staff-built forms and templates, immutable published revisions,
-- secure recipient links, and submissions.
--
--   forms              a form or a template. `definition` is the editable DRAFT.
--   form_revisions     immutable snapshot taken on every publish (v1, v2, ...).
--   form_invitations   one recipient link, bound to the exact revision it was
--                      created for. Only a SHA-256 hash of the link token is
--                      stored; the token itself is derived by the app server
--                      (HMAC) and never stored anywhere.
--   form_submissions   one per invitation, immutable, answers keyed by the
--                      revision's field ids.
--
-- Every staff change is a command through public.execute_command (registered
-- in app.command_registry below; handlers app.cmd_forms_*), so it inherits the
-- command core's actor resolution, idempotency ledger, audit context and
-- single-transaction semantics. The manual builder and SimpleBot use the same
-- commands. Handlers check explicit forms.* permissions (role_permissions).
--
-- Recipients have no account: two SECURITY DEFINER entry points
-- (forms_public_open / forms_public_submit) take the raw link token, hash it,
-- and validate every answer here against the immutable revision - the browser's
-- idea of the form is never trusted.
--
-- Release gate: FN-21 "Forms" in public.release_modes, seeded Disabled. Until
-- an administrator sets it to Manual, every Forms command is refused by the
-- command core (R1A_MODE_DENIED), staff reads return nothing (RLS), recipient
-- links answer 'unavailable', and the app hides Forms and offers SimpleBot no
-- Forms tools (public.forms_enabled()).
--
-- Not in this migration (deliberately): file/photo uploads, drawn signatures,
-- delivery by email/SMS (no approved sender yet), autosave, staff-only forms,
-- automatic retention (forms and responses are kept; archiving hides only).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('forms.read',             'See forms, templates, revisions and recipient links.'),
  ('forms.create',           'Create forms (from scratch or from a template).'),
  ('forms.edit',             'Edit form drafts; close, reopen and archive forms.'),
  ('forms.publish',          'Publish a form draft as a new immutable revision.'),
  ('forms.send',             'Create and revoke recipient links.'),
  ('forms.responses.read',   'Read submitted responses.'),
  ('forms.templates.manage', 'Create, edit, duplicate and archive templates.')
on conflict (code) do nothing;

-- Office-class administration; Directors can read. Surveyors, Installers and
-- others receive forms through links and get no administration rights here.
insert into public.role_permissions (role_code, permission_code)
select r.role_code, p.code
from (values ('Admin'), ('Manager'), ('Office')) as r (role_code)
cross join (values ('forms.read'), ('forms.create'), ('forms.edit'), ('forms.publish'),
                   ('forms.send'), ('forms.responses.read'), ('forms.templates.manage')) as p (code)
union all
select 'Director', code from (values ('forms.read'), ('forms.responses.read')) as d (code);

-- -----------------------------------------------------------------------------
-- Release gate (existing RA01 release-mode register)
-- -----------------------------------------------------------------------------

insert into public.release_modes (function_id, function_name, mode, mode_record_basis, authorised_job_scope,
                                  target_release, planned_target_mode, current_system, fallback, scope_boundary_notes)
values ('FN-21', 'Forms (builder, recipient links, SimpleBot forms)', 'Disabled',
        'Forms v1 migration; disabled until approved', 'None', 'R1', 'Manual',
        'No forms module', 'Existing paper/phone/email requests',
        'Switch to Manual (scope Pilot or All) to enable Forms for staff and recipients')
on conflict (function_id) do nothing;

-- Whether Forms is switched on. Any signed-in staff member (and the recipient
-- entry points) may ask; release_modes itself stays Admin-only.
create function app.forms_on()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.mode_available('FN-21', 'Manual') $$;

create function public.forms_enabled()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.forms_on() $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.forms (
  id                          uuid primary key default gen_random_uuid(),
  kind                        text not null check (kind in ('form', 'template')),
  title                       text not null check (char_length(btrim(title)) between 1 and 200),
  description                 text check (description is null or char_length(description) <= 4000),
  -- form: draft (never published) | published | closed (no new responses) | archived
  -- template: active | archived
  status                      text not null,
  -- The editable draft. Published revisions are snapshots in form_revisions.
  definition                  jsonb not null default '{"fields": []}'::jsonb,
  current_revision_id         uuid,
  current_revision_number     integer not null default 0 check (current_revision_number >= 0),
  -- True when the draft differs from the current revision (or none exists).
  has_unpublished_changes     boolean not null default true,
  source_template_id          uuid references public.forms (id) on delete set null,
  source_form_id              uuid references public.forms (id) on delete set null,
  -- Optional subject. Never an authorization mechanism.
  job_id                      uuid references public.jobs (id) on delete set null,
  status_before_archive       text,
  archived_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references public.people (id),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.people (id),
  version                     integer not null default 1,
  constraint forms_status_for_kind check (
    (kind = 'form' and status in ('draft', 'published', 'closed', 'archived'))
    or (kind = 'template' and status in ('active', 'archived'))
  ),
  constraint forms_template_not_published check (kind = 'form' or current_revision_number = 0)
);
comment on table public.forms is
  'Forms and templates. `definition` is the editable draft; recipients only ever see an immutable form_revisions snapshot.';
create index forms_kind_status_idx on public.forms (kind, status, updated_at desc);
create index forms_job_idx on public.forms (job_id) where job_id is not null;

create trigger forms_touch before insert or update on public.forms
  for each row execute function app.touch_row();

create table public.form_revisions (
  id               uuid primary key default gen_random_uuid(),
  form_id          uuid not null references public.forms (id) on delete restrict,
  revision_number  integer not null check (revision_number >= 1),
  title            text not null,
  description      text,
  definition       jsonb not null,
  published_at     timestamptz not null default now(),
  published_by     uuid references public.people (id),
  unique (form_id, revision_number)
);
comment on table public.form_revisions is
  'Immutable published snapshots. Invitations and submissions point here, so an answered form is always read against exactly what the recipient saw.';

alter table public.forms
  add constraint forms_current_revision_fkey
  foreign key (current_revision_id) references public.form_revisions (id) on delete restrict;

create table public.form_invitations (
  id               uuid primary key,
  form_id          uuid not null references public.forms (id) on delete restrict,
  revision_id      uuid not null references public.form_revisions (id) on delete restrict,
  -- sha256 of the link token. The token is never stored.
  token_hash       bytea not null unique check (octet_length(token_hash) = 32),
  recipient_type   text not null check (recipient_type in ('customer', 'surveyor', 'other')),
  -- Customers are referenced through their job (no contact details copied here).
  job_id           uuid references public.jobs (id) on delete restrict,
  person_id        uuid references public.people (id) on delete restrict,
  recipient_label  text check (recipient_label is null or char_length(btrim(recipient_label)) between 1 and 200),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid references public.people (id),
  revoke_reason    text check (revoke_reason is null or char_length(revoke_reason) <= 500),
  submitted_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.people (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.people (id),
  version          integer not null default 1,
  constraint form_invitations_recipient check (
    (recipient_type = 'customer' and job_id is not null)
    or (recipient_type = 'surveyor' and person_id is not null)
    or (recipient_type = 'other' and recipient_label is not null)
  )
);
comment on table public.form_invitations is
  'One recipient link per row, bound to one revision. Revocable, optionally expiring; only the token hash is stored.';
create index form_invitations_form_idx on public.form_invitations (form_id, created_at desc);
create index form_invitations_job_idx on public.form_invitations (job_id) where job_id is not null;

create trigger form_invitations_touch before insert or update on public.form_invitations
  for each row execute function app.touch_row();

create table public.form_submissions (
  -- Chosen by the recipient's page, so a double-click or a retry is recognised.
  id              uuid primary key,
  invitation_id   uuid not null unique references public.form_invitations (id) on delete restrict,
  form_id         uuid not null references public.forms (id) on delete restrict,
  revision_id     uuid not null references public.form_revisions (id) on delete restrict,
  -- {field_id: value}, validated against the revision at submission.
  answers         jsonb not null,
  submitted_at    timestamptz not null default now()
);
comment on table public.form_submissions is
  'Immutable responses, one per invitation, keyed by the answered revision''s field ids.';
create index form_submissions_form_idx on public.form_submissions (form_id, submitted_at desc);

-- Published revisions and submissions never change.
create function app.forms_forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FORMS_IMMUTABLE' using errcode = 'P0001';
end
$$;
create trigger form_revisions_immutable before update or delete on public.form_revisions
  for each row execute function app.forms_forbid_change();
create trigger form_submissions_immutable before update or delete on public.form_submissions
  for each row execute function app.forms_forbid_change();

-- -----------------------------------------------------------------------------
-- Definition and answer validation (declarative; no expressions are executed)
-- -----------------------------------------------------------------------------

create function app.forms_input_types()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array['short_text', 'long_text', 'email', 'phone', 'number', 'currency', 'date', 'time',
               'yes_no', 'single_choice', 'multiple_choice', 'dropdown', 'scale', 'address', 'confirmation']
$$;

create function app.forms_choice_types()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['single_choice', 'multiple_choice', 'dropdown'] $$;

create function app.forms_bad(p_field text, p_problem text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform app.fail('FORMS_INVALID_DEFINITION', jsonb_build_object('field', p_field, 'problem', p_problem));
end
$$;

-- Validates a draft definition. Raises FORMS_INVALID_DEFINITION with
-- {field, problem}; returns the definition unchanged when valid.
create function app.forms_validate_definition(p_def jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_field jsonb;
  v_key text;
  v_id text;
  v_type text;
  v_ids text[] := '{}';
  v_inputs text[] := '{}';
  v_opt jsonb;
  v_opt_ids text[];
  v_cond jsonb;
  v_source jsonb;
begin
  if jsonb_typeof(p_def) is distinct from 'object' then
    perform app.forms_bad(null, 'definition must be an object');
  end if;
  for v_key in select jsonb_object_keys(p_def) loop
    if v_key <> 'fields' then perform app.forms_bad(null, 'unknown key ' || v_key); end if;
  end loop;
  if jsonb_typeof(p_def -> 'fields') is distinct from 'array' then
    perform app.forms_bad(null, 'fields must be a list');
  end if;
  if jsonb_array_length(p_def -> 'fields') > 100 then
    perform app.forms_bad(null, 'at most 100 fields');
  end if;
  if octet_length(p_def::text) > 200000 then
    perform app.forms_bad(null, 'definition too large');
  end if;

  for v_field in select value from jsonb_array_elements(p_def -> 'fields') loop
    if jsonb_typeof(v_field) is distinct from 'object' then
      perform app.forms_bad(null, 'each field must be an object');
    end if;
    v_id := v_field ->> 'id';
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,39}$' then
      perform app.forms_bad(v_id, 'invalid id');
    end if;
    if v_id = any (v_ids) then perform app.forms_bad(v_id, 'duplicate id'); end if;
    for v_key in select jsonb_object_keys(v_field) loop
      if v_key not in ('id', 'type', 'label', 'help', 'required', 'options', 'min', 'max', 'placeholder', 'condition') then
        perform app.forms_bad(v_id, 'unknown key ' || v_key);
      end if;
    end loop;
    v_type := v_field ->> 'type';
    if v_type is null or not (v_type = any (app.forms_input_types()) or v_type in ('section', 'info')) then
      perform app.forms_bad(v_id, 'unknown type');
    end if;
    if jsonb_typeof(v_field -> 'label') is distinct from 'string'
       or char_length(btrim(v_field ->> 'label')) not between 1 and 300 then
      perform app.forms_bad(v_id, 'label must be 1-300 characters');
    end if;
    if v_field ? 'help' and (jsonb_typeof(v_field -> 'help') is distinct from 'string'
                             or char_length(v_field ->> 'help') > 2000) then
      perform app.forms_bad(v_id, 'help must be text up to 2000 characters');
    end if;
    if v_field ? 'placeholder' and (jsonb_typeof(v_field -> 'placeholder') is distinct from 'string'
                                    or char_length(v_field ->> 'placeholder') > 200) then
      perform app.forms_bad(v_id, 'placeholder too long');
    end if;
    if v_field ? 'required' and jsonb_typeof(v_field -> 'required') is distinct from 'boolean' then
      perform app.forms_bad(v_id, 'required must be true or false');
    end if;
    if v_type in ('section', 'info') and coalesce((v_field ->> 'required')::boolean, false) then
      perform app.forms_bad(v_id, 'a section or text block cannot be required');
    end if;

    -- Options: choice types only, 1-50 unique ids.
    if v_type = any (app.forms_choice_types()) then
      if jsonb_typeof(v_field -> 'options') is distinct from 'array'
         or jsonb_array_length(v_field -> 'options') not between 1 and 50 then
        perform app.forms_bad(v_id, 'choices need 1-50 options');
      end if;
      v_opt_ids := '{}';
      for v_opt in select value from jsonb_array_elements(v_field -> 'options') loop
        if jsonb_typeof(v_opt) is distinct from 'object'
           or (select count(*) from jsonb_object_keys(v_opt) k where k not in ('id', 'label')) > 0
           or coalesce(v_opt ->> 'id', '') !~ '^[a-z0-9][a-z0-9_]{0,39}$'
           or jsonb_typeof(v_opt -> 'label') is distinct from 'string'
           or char_length(btrim(v_opt ->> 'label')) not between 1 and 200 then
          perform app.forms_bad(v_id, 'invalid option');
        end if;
        if (v_opt ->> 'id') = any (v_opt_ids) then perform app.forms_bad(v_id, 'duplicate option'); end if;
        v_opt_ids := v_opt_ids || (v_opt ->> 'id');
      end loop;
    elsif v_field ? 'options' then
      perform app.forms_bad(v_id, 'only choice questions have options');
    end if;

    -- Bounds: number/currency any numbers; scale integers 0-10.
    if v_field ? 'min' or v_field ? 'max' then
      if v_type not in ('number', 'currency', 'scale') then
        perform app.forms_bad(v_id, 'only number, currency and scale questions have limits');
      end if;
      if (v_field ? 'min' and jsonb_typeof(v_field -> 'min') <> 'number')
         or (v_field ? 'max' and jsonb_typeof(v_field -> 'max') <> 'number') then
        perform app.forms_bad(v_id, 'limits must be numbers');
      end if;
      if v_field ? 'min' and v_field ? 'max' and (v_field ->> 'min')::numeric >= (v_field ->> 'max')::numeric then
        perform app.forms_bad(v_id, 'min must be less than max');
      end if;
    end if;
    if v_type = 'scale' then
      if not (v_field ? 'min' and v_field ? 'max')
         or (v_field ->> 'min') !~ '^[0-9]+$' or (v_field ->> 'max') !~ '^[0-9]+$'
         or (v_field ->> 'min')::int not between 0 and 1
         or (v_field ->> 'max')::int not between 2 and 10 then
        perform app.forms_bad(v_id, 'a scale runs from 0 or 1 up to 2-10');
      end if;
    end if;

    -- Condition: show this field only when an EARLIER question's answer matches.
    if v_field ? 'condition' then
      v_cond := v_field -> 'condition';
      if jsonb_typeof(v_cond) is distinct from 'object'
         or (select count(*) from jsonb_object_keys(v_cond) k where k not in ('field', 'op', 'value')) > 0
         or coalesce(v_cond ->> 'op', '') not in ('equals', 'not_equals', 'includes', 'answered') then
        perform app.forms_bad(v_id, 'invalid condition');
      end if;
      if not ((v_cond ->> 'field') = any (v_inputs)) then
        perform app.forms_bad(v_id, 'a condition must refer to an earlier question');
      end if;
      if (v_cond ->> 'op') <> 'answered' and coalesce(jsonb_typeof(v_cond -> 'value'), 'null') not in ('string', 'boolean', 'number') then
        perform app.forms_bad(v_id, 'the condition needs a value');
      end if;
      select f into v_source from jsonb_array_elements(p_def -> 'fields') f where f ->> 'id' = v_cond ->> 'field';
      if (v_cond ->> 'op') = 'includes' and v_source ->> 'type' <> 'multiple_choice' then
        perform app.forms_bad(v_id, '"includes" only applies to multiple choice');
      end if;
      if (v_source ->> 'type') = any (app.forms_choice_types()) and (v_cond ->> 'op') <> 'answered'
         and not exists (select 1 from jsonb_array_elements(v_source -> 'options') o where o ->> 'id' = v_cond ->> 'value') then
        perform app.forms_bad(v_id, 'the condition refers to an option that does not exist');
      end if;
    end if;

    v_ids := v_ids || v_id;
    if v_type = any (app.forms_input_types()) then v_inputs := v_inputs || v_id; end if;
  end loop;
  return p_def;
end
$$;

create function app.forms_is_blank(p_value jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_value is null
      or jsonb_typeof(p_value) = 'null'
      or (jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') = '')
      or (jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) = 0)
      or (jsonb_typeof(p_value) = 'object' and not exists (
            select 1 from jsonb_each(p_value) e
            where jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') <> ''))
$$;

create function app.forms_answer_bad(p_field text, p_problem text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform app.fail('FORMS_INVALID_ANSWER', jsonb_build_object('field', p_field, 'problem', p_problem));
end
$$;

-- Validates answers against a (published) definition and returns them with
-- the answers of hidden questions removed. Unknown fields are refused; the
-- browser's view of the form is never trusted.
create function app.forms_validate_answers(p_def jsonb, p_answers jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_field jsonb;
  v_id text;
  v_type text;
  v_value jsonb;
  v_text text;
  v_key text;
  v_visible boolean;
  v_cond jsonb;
  v_src jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_inputs text[];
  v_num numeric;
  v_max integer;
  v_item jsonb;
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    perform app.forms_answer_bad(null, 'answers must be an object');
  end if;
  if octet_length(p_answers::text) > 100000 then
    perform app.forms_answer_bad(null, 'the response is too large');
  end if;
  select coalesce(array_agg(f ->> 'id'), '{}') into v_inputs
  from jsonb_array_elements(p_def -> 'fields') f
  where f ->> 'type' = any (app.forms_input_types());
  for v_key in select jsonb_object_keys(p_answers) loop
    if not v_key = any (v_inputs) then
      perform app.fail('FORMS_UNKNOWN_FIELD', jsonb_build_object('field', v_key));
    end if;
  end loop;

  for v_field in select value from jsonb_array_elements(p_def -> 'fields') loop
    v_id := v_field ->> 'id';
    v_type := v_field ->> 'type';
    continue when not v_type = any (app.forms_input_types());

    -- Visibility: the condition's source must itself be answered (and visible,
    -- which holds because hidden answers were never copied into v_clean).
    v_visible := true;
    v_cond := v_field -> 'condition';
    if v_cond is not null then
      v_src := v_clean -> (v_cond ->> 'field');
      v_visible := case v_cond ->> 'op'
        when 'answered' then not app.forms_is_blank(v_src)
        when 'equals' then v_src is not null and v_src = v_cond -> 'value'
        when 'not_equals' then v_src is not null and v_src <> v_cond -> 'value'
        when 'includes' then v_src is not null and jsonb_typeof(v_src) = 'array' and v_src @> jsonb_build_array(v_cond -> 'value')
        else false end;
    end if;
    continue when not v_visible;

    v_value := p_answers -> v_id;
    if app.forms_is_blank(v_value) or (v_type = 'confirmation' and v_value = 'false'::jsonb) then
      if coalesce((v_field ->> 'required')::boolean, false) then
        perform app.fail('FORMS_REQUIRED_MISSING', jsonb_build_object('field', v_id));
      end if;
      continue;
    end if;

    case
      when v_type in ('short_text', 'long_text', 'email', 'phone', 'date', 'time') then
        if jsonb_typeof(v_value) <> 'string' then perform app.forms_answer_bad(v_id, 'expected text'); end if;
        v_text := btrim(v_value #>> '{}');
        v_max := 500;
        if v_type = 'long_text' then v_max := 5000; end if;
        if char_length(v_text) > v_max then
          perform app.forms_answer_bad(v_id, 'too long');
        end if;
        if v_type = 'email' and (char_length(v_text) > 254 or v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
          perform app.forms_answer_bad(v_id, 'not an email address');
        end if;
        if v_type = 'phone' and v_text !~ '^\+?[0-9 ()-]{6,20}$' then
          perform app.forms_answer_bad(v_id, 'not a phone number');
        end if;
        if v_type = 'date' then
          if v_text !~ '^\d{4}-\d{2}-\d{2}$' then perform app.forms_answer_bad(v_id, 'not a date'); end if;
          begin
            perform v_text::date;
          exception when others then
            perform app.forms_answer_bad(v_id, 'not a date');
          end;
        end if;
        if v_type = 'time' and v_text !~ '^([01]\d|2[0-3]):[0-5]\d$' then
          perform app.forms_answer_bad(v_id, 'not a time');
        end if;
        v_value := to_jsonb(v_text);
      when v_type in ('number', 'currency', 'scale') then
        if jsonb_typeof(v_value) <> 'number' then perform app.forms_answer_bad(v_id, 'expected a number'); end if;
        v_num := (v_value #>> '{}')::numeric;
        if abs(v_num) > 1000000000 then perform app.forms_answer_bad(v_id, 'out of range'); end if;
        if v_type = 'currency' and (v_num < 0 or v_num <> round(v_num, 2)) then
          perform app.forms_answer_bad(v_id, 'not an amount in pounds and pence');
        end if;
        if v_type = 'scale' and v_num <> trunc(v_num) then perform app.forms_answer_bad(v_id, 'expected a whole number'); end if;
        if (v_field ? 'min' and v_num < (v_field ->> 'min')::numeric)
           or (v_field ? 'max' and v_num > (v_field ->> 'max')::numeric) then
          perform app.forms_answer_bad(v_id, 'out of range');
        end if;
      when v_type in ('yes_no', 'confirmation') then
        if jsonb_typeof(v_value) <> 'boolean' then perform app.forms_answer_bad(v_id, 'expected yes or no'); end if;
      when v_type in ('single_choice', 'dropdown') then
        if jsonb_typeof(v_value) <> 'string'
           or not exists (select 1 from jsonb_array_elements(v_field -> 'options') o where o -> 'id' = v_value) then
          perform app.forms_answer_bad(v_id, 'not one of the options');
        end if;
      when v_type = 'multiple_choice' then
        if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > 50 then
          perform app.forms_answer_bad(v_id, 'expected a list of options');
        end if;
        for v_item in select value from jsonb_array_elements(v_value) loop
          if not exists (select 1 from jsonb_array_elements(v_field -> 'options') o where o -> 'id' = v_item) then
            perform app.forms_answer_bad(v_id, 'not one of the options');
          end if;
        end loop;
        if (select count(distinct e) from jsonb_array_elements(v_value) e) <> jsonb_array_length(v_value) then
          perform app.forms_answer_bad(v_id, 'an option was chosen twice');
        end if;
      when v_type = 'address' then
        if jsonb_typeof(v_value) <> 'object' then perform app.forms_answer_bad(v_id, 'expected an address'); end if;
        for v_key in select jsonb_object_keys(v_value) loop
          if v_key not in ('line1', 'line2', 'town', 'postcode')
             or jsonb_typeof(v_value -> v_key) <> 'string'
             or char_length(v_value ->> v_key) > 200 then
            perform app.forms_answer_bad(v_id, 'invalid address');
          end if;
        end loop;
        if coalesce((v_field ->> 'required')::boolean, false)
           and (app.forms_is_blank(v_value -> 'line1') or app.forms_is_blank(v_value -> 'postcode')) then
          perform app.fail('FORMS_REQUIRED_MISSING', jsonb_build_object('field', v_id));
        end if;
    end case;
    v_clean := v_clean || jsonb_build_object(v_id, v_value);
  end loop;
  return v_clean;
end
$$;

-- -----------------------------------------------------------------------------
-- Command helpers
-- -----------------------------------------------------------------------------

create function app.forms_require(p_permission text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not app.has_permission(p_permission) then
    perform app.fail('FORMS_PERMISSION_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end
$$;

-- A job the caller may see, by the same rules as jobs RLS (all jobs, or
-- their own sales). Linking a job never grants anything by itself.
create function app.forms_job_visible(p_job_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job_id
      and (app.has_permission('job.read.all')
           or (app.has_permission('job.read.own')
               and (j.salesperson_id = app.current_person_id() or j.created_by = app.current_person_id())))
  )
$$;

create function app.forms_uuid(p_payload jsonb, p_key text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(p_payload ->> p_key), '');
begin
  if v is null then return null; end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('FORMS_INVALID_' || upper(p_key));
  end if;
  return v::uuid;
end
$$;

-- Loads a form for change, locked, checking the caller's expected version.
create function app.forms_lock(p_form_id uuid, p_request jsonb)
returns public.forms
language plpgsql
set search_path = ''
as $$
declare
  v_form public.forms;
begin
  if p_form_id is null then perform app.fail('FORMS_REQUIRED_FORM_ID'); end if;
  select * into v_form from public.forms where id = p_form_id for update;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_form.version then
    perform app.fail('FORMS_STALE_VERSION', jsonb_build_object('current_version', v_form.version));
  end if;
  return v_form;
end
$$;

create function app.forms_summary(p_form public.forms)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', p_form.kind, 'title', p_form.title, 'status', p_form.status,
    'revision', p_form.current_revision_number,
    'questions', (select count(*) from jsonb_array_elements(p_form.definition -> 'fields') f
                  where f ->> 'type' = any (app.forms_input_types())),
    'job_id', p_form.job_id, 'version', p_form.version)
$$;

create function app.forms_result(p_form public.forms)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('form_id', p_form.id, 'kind', p_form.kind, 'status', p_form.status,
                            'revision', p_form.current_revision_number, 'version', p_form.version)
$$;

-- -----------------------------------------------------------------------------
-- Command handlers: app.cmd_<type>(request, actor) -> result
-- -----------------------------------------------------------------------------

-- FORMS_CREATE {kind, title, description?, definition?, source_template_id?,
--               source_form_id?, job_id?}
-- A form from scratch or from a template (copies its definition), or a
-- template from scratch or from a form ("save as template") or another
-- template ("duplicate"). Copies are independent: later edits to either side
-- never change the other.
create function app.cmd_forms_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['kind', 'title', 'description', 'definition',
                                            'source_template_id', 'source_form_id', 'job_id'],
                           array['kind', 'title']);
  v_kind text := v_p ->> 'kind';
  v_source_template uuid := app.forms_uuid(v_p, 'source_template_id');
  v_source_form uuid := app.forms_uuid(v_p, 'source_form_id');
  v_job uuid := app.forms_uuid(v_p, 'job_id');
  v_def jsonb := v_p -> 'definition';
  v_source public.forms;
  v_form public.forms;
begin
  if v_kind not in ('form', 'template') then perform app.fail('FORMS_INVALID_KIND'); end if;
  perform app.forms_require(case v_kind when 'form' then 'forms.create' else 'forms.templates.manage' end);
  if v_source_template is not null and v_source_form is not null then
    perform app.fail('FORMS_ONE_SOURCE_ONLY');
  end if;

  if v_source_template is not null or v_source_form is not null then
    perform app.forms_require('forms.read');
    select * into v_source from public.forms
    where id = coalesce(v_source_template, v_source_form);
    if not found then perform app.fail('FORMS_SOURCE_NOT_FOUND'); end if;
    if v_source_template is not null and v_source.kind <> 'template' then
      perform app.fail('FORMS_SOURCE_NOT_TEMPLATE');
    end if;
    if v_source.status = 'archived' and v_source.kind = 'template' and v_kind = 'form' then
      perform app.fail('FORMS_TEMPLATE_ARCHIVED');
    end if;
    if v_def is null then v_def := v_source.definition; end if;
  end if;
  v_def := app.forms_validate_definition(coalesce(v_def, '{"fields": []}'::jsonb));

  if v_job is not null then
    if v_kind <> 'form' then perform app.fail('FORMS_TEMPLATE_NO_JOB'); end if;
    if not app.forms_job_visible(v_job) then perform app.fail('FORMS_JOB_NOT_FOUND'); end if;
  end if;
  if char_length(coalesce(app.txt(v_p, 'title'), '')) not between 1 and 200 then
    perform app.fail('FORMS_INVALID_TITLE');
  end if;

  insert into public.forms (kind, title, description, status, definition,
                            source_template_id, source_form_id, job_id)
  values (v_kind, app.txt(v_p, 'title'), app.txt(v_p, 'description'),
          case v_kind when 'form' then 'draft' else 'active' end, v_def,
          case when v_source.kind = 'template' then v_source.id end,
          case when v_source.kind = 'form' then v_source.id end,
          v_job)
  returning * into v_form;

  perform app.audit('form', v_form.id::text, 'FORMS_CREATE', null, app.forms_summary(v_form));
  return app.forms_result(v_form);
end
$$;

-- FORMS_UPDATE_DRAFT {form_id, title?, description?, definition?, job_id?} + expected_version
-- Edits only the draft. Published revisions, and every link and response
-- that points at them, are untouched.
create function app.cmd_forms_update_draft(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['form_id', 'title', 'description', 'definition', 'job_id'],
                           array['form_id']);
  v_before public.forms := app.forms_lock(app.forms_uuid(v_p, 'form_id'), p_request);
  v_after public.forms;
  v_rev public.form_revisions;
  v_title text := coalesce(app.txt(v_p, 'title'), v_before.title);
  v_description text := case when v_p ? 'description' then app.txt(v_p, 'description') else v_before.description end;
  v_def jsonb := case when v_p ? 'definition' then app.forms_validate_definition(v_p -> 'definition')
                      else v_before.definition end;
  v_job uuid := case when v_p ? 'job_id' then app.forms_uuid(v_p, 'job_id') else v_before.job_id end;
begin
  perform app.forms_require(case v_before.kind when 'form' then 'forms.edit' else 'forms.templates.manage' end);
  if v_before.status = 'archived' then perform app.fail('FORMS_ARCHIVED'); end if;
  if char_length(v_title) > 200 then perform app.fail('FORMS_INVALID_TITLE'); end if;
  if v_job is distinct from v_before.job_id and v_job is not null then
    if v_before.kind <> 'form' then perform app.fail('FORMS_TEMPLATE_NO_JOB'); end if;
    if not app.forms_job_visible(v_job) then perform app.fail('FORMS_JOB_NOT_FOUND'); end if;
  end if;

  select * into v_rev from public.form_revisions where id = v_before.current_revision_id;
  update public.forms set
    title = v_title,
    description = v_description,
    definition = v_def,
    job_id = v_job,
    has_unpublished_changes = v_rev.id is null
      or v_rev.title is distinct from v_title
      or v_rev.description is distinct from v_description
      or v_rev.definition is distinct from v_def
  where id = v_before.id
  returning * into v_after;

  perform app.audit('form', v_after.id::text, 'FORMS_UPDATE_DRAFT', app.forms_summary(v_before), app.forms_summary(v_after));
  return app.forms_result(v_after);
end
$$;

-- FORMS_PUBLISH {form_id} + expected_version: the draft becomes revision n+1.
create function app.cmd_forms_publish(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['form_id'], array['form_id']);
  v_before public.forms := app.forms_lock(app.forms_uuid(v_p, 'form_id'), p_request);
  v_after public.forms;
  v_rev public.form_revisions;
begin
  perform app.forms_require('forms.publish');
  if v_before.kind <> 'form' then perform app.fail('FORMS_TEMPLATE_NOT_PUBLISHABLE'); end if;
  if v_before.status not in ('draft', 'published') then perform app.fail('FORMS_NOT_PUBLISHABLE_STATUS'); end if;
  if not exists (select 1 from jsonb_array_elements(v_before.definition -> 'fields') f
                 where f ->> 'type' = any (app.forms_input_types())) then
    perform app.fail('FORMS_NO_QUESTIONS');
  end if;
  if v_before.current_revision_id is not null and not v_before.has_unpublished_changes then
    perform app.fail('FORMS_NO_CHANGES');
  end if;
  perform app.forms_validate_definition(v_before.definition);

  insert into public.form_revisions (form_id, revision_number, title, description, definition, published_by)
  values (v_before.id, v_before.current_revision_number + 1, v_before.title, v_before.description,
          v_before.definition, app.actor_id(p_actor))
  returning * into v_rev;

  update public.forms set
    status = 'published',
    current_revision_id = v_rev.id,
    current_revision_number = v_rev.revision_number,
    has_unpublished_changes = false
  where id = v_before.id
  returning * into v_after;

  perform app.audit('form', v_after.id::text, 'FORMS_PUBLISH', app.forms_summary(v_before),
                    app.forms_summary(v_after) || jsonb_build_object('revision_id', v_rev.id));
  return app.forms_result(v_after) || jsonb_build_object('revision_id', v_rev.id);
end
$$;

-- FORMS_SET_STATUS {form_id, status} + expected_version
--   forms:     published <-> closed; any -> archived; archived -> restored
--   templates: active <-> archived
create function app.cmd_forms_set_status(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['form_id', 'status'], array['form_id', 'status']);
  v_before public.forms := app.forms_lock(app.forms_uuid(v_p, 'form_id'), p_request);
  v_to text := v_p ->> 'status';
  v_after public.forms;
  v_new text;
begin
  perform app.forms_require(case v_before.kind when 'form' then 'forms.edit' else 'forms.templates.manage' end);
  if v_before.kind = 'template' then
    if v_to not in ('active', 'archived') or v_to = v_before.status then perform app.fail('FORMS_INVALID_STATUS_CHANGE'); end if;
    v_new := v_to;
  elsif v_to = 'archived' then
    if v_before.status = 'archived' then perform app.fail('FORMS_INVALID_STATUS_CHANGE'); end if;
    v_new := 'archived';
  elsif v_to = 'restore' then
    if v_before.status <> 'archived' then perform app.fail('FORMS_INVALID_STATUS_CHANGE'); end if;
    v_new := case when v_before.current_revision_id is null then 'draft' else 'closed' end;
  elsif v_to = 'closed' then
    if v_before.status <> 'published' then perform app.fail('FORMS_INVALID_STATUS_CHANGE'); end if;
    v_new := 'closed';
  elsif v_to = 'published' then
    if v_before.status <> 'closed' then perform app.fail('FORMS_INVALID_STATUS_CHANGE'); end if;
    v_new := 'published';
  else
    perform app.fail('FORMS_INVALID_STATUS_CHANGE');
  end if;

  update public.forms set
    status = v_new,
    status_before_archive = case when v_new = 'archived' then v_before.status else null end,
    archived_at = case when v_new = 'archived' then now() else null end
  where id = v_before.id
  returning * into v_after;

  perform app.audit('form', v_after.id::text, 'FORMS_SET_STATUS', app.forms_summary(v_before), app.forms_summary(v_after));
  return app.forms_result(v_after);
end
$$;

-- FORMS_INVITATION_CREATE {invitation_id, token_hash, form_id, recipient_type,
--                          job_id?, person_id?, recipient_label?, expires_at?}
-- Binds a new link to the form's CURRENT published revision. The app server
-- derives the token from invitation_id with a server-only secret and sends
-- only its SHA-256 here.
create function app.cmd_forms_invitation_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['invitation_id', 'token_hash', 'form_id', 'recipient_type', 'job_id',
                                            'person_id', 'recipient_label', 'expires_at'],
                           array['invitation_id', 'token_hash', 'form_id', 'recipient_type']);
  v_form public.forms;
  v_inv public.form_invitations;
  v_type text := v_p ->> 'recipient_type';
  v_job uuid := app.forms_uuid(v_p, 'job_id');
  v_person uuid := app.forms_uuid(v_p, 'person_id');
  v_label text := app.txt(v_p, 'recipient_label');
  v_expires timestamptz;
begin
  perform app.forms_require('forms.send');
  if coalesce(v_p ->> 'token_hash', '') !~ '^[0-9a-f]{64}$' then perform app.fail('FORMS_INVALID_TOKEN_HASH'); end if;
  select * into v_form from public.forms where id = app.forms_uuid(v_p, 'form_id') for share;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;
  if v_form.kind <> 'form' then perform app.fail('FORMS_TEMPLATE_NOT_SENDABLE'); end if;
  if v_form.status <> 'published' then perform app.fail('FORMS_NOT_PUBLISHED'); end if;

  if v_type = 'customer' then
    if v_job is null then perform app.fail('FORMS_CUSTOMER_NEEDS_JOB'); end if;
    v_person := null;
  elsif v_type = 'surveyor' then
    if v_person is null
       or not exists (select 1 from public.people p where p.id = v_person and p.active)
       or not app.person_has_active_role(v_person, array['Surveyor']) then
      perform app.fail('FORMS_SURVEYOR_NOT_FOUND');
    end if;
  elsif v_type = 'other' then
    if v_label is null then perform app.fail('FORMS_RECIPIENT_LABEL_REQUIRED'); end if;
    v_person := null;
  else
    perform app.fail('FORMS_INVALID_RECIPIENT_TYPE');
  end if;
  if v_label is not null and char_length(v_label) > 200 then perform app.fail('FORMS_INVALID_RECIPIENT_LABEL'); end if;
  if v_job is not null and not app.forms_job_visible(v_job) then perform app.fail('FORMS_JOB_NOT_FOUND'); end if;

  if app.txt(v_p, 'expires_at') is not null then
    begin
      v_expires := (v_p ->> 'expires_at')::timestamptz;
    exception when others then
      perform app.fail('FORMS_INVALID_EXPIRY');
    end;
    if v_expires <= now() or v_expires > now() + interval '366 days' then
      perform app.fail('FORMS_INVALID_EXPIRY');
    end if;
  end if;

  insert into public.form_invitations (id, form_id, revision_id, token_hash, recipient_type,
                                       job_id, person_id, recipient_label, expires_at)
  values (app.forms_uuid(v_p, 'invitation_id'), v_form.id, v_form.current_revision_id,
          decode(v_p ->> 'token_hash', 'hex'), v_type, v_job, v_person, v_label, v_expires)
  returning * into v_inv;

  perform app.audit('form_invitation', v_inv.id::text, 'FORMS_INVITATION_CREATE', null,
    jsonb_build_object('form_id', v_form.id, 'revision', v_form.current_revision_number,
                       'recipient_type', v_type, 'job_id', v_job, 'person_id', v_person,
                       'expires_at', v_expires));
  return jsonb_build_object('invitation_id', v_inv.id, 'form_id', v_form.id,
                            'revision_id', v_inv.revision_id, 'revision', v_form.current_revision_number,
                            'expires_at', v_inv.expires_at, 'version', v_inv.version);
end
$$;

-- FORMS_INVITATION_REVOKE {invitation_id, reason?}: the link stops working at once.
create function app.cmd_forms_invitation_revoke(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['invitation_id', 'reason'], array['invitation_id']);
  v_before public.form_invitations;
  v_after public.form_invitations;
begin
  perform app.forms_require('forms.send');
  select * into v_before from public.form_invitations
  where id = app.forms_uuid(v_p, 'invitation_id') for update;
  if not found then perform app.fail('FORMS_INVITATION_NOT_FOUND'); end if;
  if v_before.revoked_at is not null then perform app.fail('FORMS_ALREADY_REVOKED'); end if;
  if v_before.submitted_at is not null then perform app.fail('FORMS_ALREADY_SUBMITTED'); end if;
  if app.txt(v_p, 'reason') is not null and char_length(app.txt(v_p, 'reason')) > 500 then
    perform app.fail('FORMS_INVALID_REASON');
  end if;

  update public.form_invitations set
    revoked_at = now(), revoked_by = app.actor_id(p_actor), revoke_reason = app.txt(v_p, 'reason')
  where id = v_before.id
  returning * into v_after;

  perform app.audit('form_invitation', v_after.id::text, 'FORMS_INVITATION_REVOKE',
                    jsonb_build_object('revoked', false), jsonb_build_object('revoked', true),
                    app.txt(v_p, 'reason'));
  return jsonb_build_object('invitation_id', v_after.id, 'revoked_at', v_after.revoked_at);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes)
select t, array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Installer',
                'Store', 'Finance', 'Scaffolder', 'ReadOnly'],
       false, '[{"function_id": "FN-21", "mode": "Manual"}]'::jsonb, 'forms',
       'Any active staff role may call; the handler requires the forms.* permission (role_permissions).'
from unnest(array['FORMS_CREATE', 'FORMS_UPDATE_DRAFT', 'FORMS_PUBLISH', 'FORMS_SET_STATUS',
                  'FORMS_INVITATION_CREATE', 'FORMS_INVITATION_REVOKE']) as t;

-- -----------------------------------------------------------------------------
-- Recipient entry points (no staff account). The raw token is hashed here;
-- a malformed or unknown token is simply not found.
-- -----------------------------------------------------------------------------

create function app.forms_invitation_by_token(p_token text)
returns public.form_invitations
language plpgsql stable
set search_path = ''
as $$
declare
  v_inv public.form_invitations;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into v_inv from public.form_invitations
  where token_hash = sha256(convert_to(p_token, 'UTF8'));
  return v_inv;
end
$$;

create function app.forms_link_state(p_inv public.form_invitations, p_form public.forms)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when p_inv.id is null then 'not_found'
    when p_inv.submitted_at is not null then 'submitted'
    when p_inv.revoked_at is not null then 'revoked'
    when p_inv.expires_at is not null and p_inv.expires_at <= now() then 'expired'
    when p_form.status in ('closed', 'archived') then 'closed'
    else 'open' end
$$;

-- What a recipient's page needs, and nothing more: the state of the link and,
-- when it is open, the exact revision it was created for.
create function public.forms_public_open(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_inv public.form_invitations := app.forms_invitation_by_token(p_token);
  v_form public.forms;
  v_rev public.form_revisions;
  v_state text;
begin
  if not app.forms_on() then return jsonb_build_object('state', 'unavailable'); end if;
  if v_inv.id is null then return jsonb_build_object('state', 'not_found'); end if;
  select * into v_form from public.forms where id = v_inv.form_id;
  v_state := app.forms_link_state(v_inv, v_form);
  select * into v_rev from public.form_revisions where id = v_inv.revision_id;
  return jsonb_build_object(
    'state', v_state,
    'title', v_rev.title,
    'description', case when v_state = 'open' then v_rev.description end,
    'definition', case when v_state = 'open' then v_rev.definition end,
    'submitted_at', v_inv.submitted_at);
end
$$;

-- Submits once. The same submission id again (a double-click or a retry) is
-- recognised and answered as already done; a different one is refused.
create function public.forms_public_submit(p_token text, p_submission_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.form_invitations := app.forms_invitation_by_token(p_token);
  v_form public.forms;
  v_rev public.form_revisions;
  v_clean jsonb;
  v_state text;
  v_existing public.form_submissions;
begin
  if not app.forms_on() then return jsonb_build_object('ok', false, 'state', 'unavailable'); end if;
  if v_inv.id is null then return jsonb_build_object('ok', false, 'state', 'not_found'); end if;
  if p_submission_id is null then perform app.fail('FORMS_SUBMISSION_ID_REQUIRED'); end if;

  -- One submission per link, even under concurrent requests.
  select * into v_inv from public.form_invitations where id = v_inv.id for update;
  select * into v_existing from public.form_submissions where invitation_id = v_inv.id;
  if found then
    return jsonb_build_object('ok', v_existing.id = p_submission_id, 'state', 'submitted',
                              'submitted_at', v_existing.submitted_at);
  end if;

  select * into v_form from public.forms where id = v_inv.form_id;
  v_state := app.forms_link_state(v_inv, v_form);
  if v_state <> 'open' then return jsonb_build_object('ok', false, 'state', v_state); end if;

  select * into v_rev from public.form_revisions where id = v_inv.revision_id;
  v_clean := app.forms_validate_answers(v_rev.definition, p_answers);

  perform set_config('app.executing_service', 'forms:public-link', true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.command_id', '', true);

  insert into public.form_submissions (id, invitation_id, form_id, revision_id, answers)
  values (p_submission_id, v_inv.id, v_inv.form_id, v_inv.revision_id, v_clean);
  update public.form_invitations set submitted_at = now() where id = v_inv.id;

  -- Identifiers only: answers are not copied into the audit log.
  perform app.audit('form_submission', p_submission_id::text, 'FORMS_SUBMITTED', null,
    jsonb_build_object('form_id', v_inv.form_id, 'revision_id', v_inv.revision_id, 'invitation_id', v_inv.id));
  return jsonb_build_object('ok', true, 'state', 'submitted', 'submitted_at', now());
end
$$;

-- -----------------------------------------------------------------------------
-- Grants and RLS. Tables are read-only to clients; every write is a command
-- or a recipient entry point above.
-- -----------------------------------------------------------------------------

revoke all on public.forms, public.form_revisions, public.form_invitations, public.form_submissions
  from public, anon, authenticated;
grant select on public.forms, public.form_revisions, public.form_submissions to authenticated;
-- Everything but the token hash.
grant select (id, form_id, revision_id, recipient_type, job_id, person_id, recipient_label, expires_at,
              revoked_at, revoked_by, revoke_reason, submitted_at, created_at, created_by, updated_at,
              updated_by, version)
  on public.form_invitations to authenticated;
grant all on public.forms, public.form_revisions, public.form_invitations, public.form_submissions to service_role;

alter table public.forms            enable row level security;
alter table public.form_revisions   enable row level security;
alter table public.form_invitations enable row level security;
alter table public.form_submissions enable row level security;

create policy forms_select on public.forms
  for select to authenticated using ((select app.forms_on()) and (select app.has_permission('forms.read')));
create policy form_revisions_select on public.form_revisions
  for select to authenticated using ((select app.forms_on()) and (select app.has_permission('forms.read')));
create policy form_invitations_select on public.form_invitations
  for select to authenticated using ((select app.forms_on()) and (select app.has_permission('forms.read')));
create policy form_submissions_select on public.form_submissions
  for select to authenticated using ((select app.forms_on()) and (select app.has_permission('forms.responses.read')));

grant execute on function app.forms_job_visible(uuid), app.forms_on() to authenticated;
grant execute on function public.forms_enabled() to authenticated, service_role;
grant execute on function public.forms_public_open(text), public.forms_public_submit(text, uuid, jsonb)
  to anon, authenticated, service_role;
