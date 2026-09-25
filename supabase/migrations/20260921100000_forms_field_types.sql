-- =============================================================================
-- Forms: the generic capabilities an in-app field workflow needs.
--
-- Forms v1 (20260919190000) was built for one delivery model: a recipient with
-- no account follows a link and answers text/choice/number questions. Three
-- capabilities are missing before ANY staff-completed operational form can be
-- built on it, and all three are generic - none of them knows what a programme,
-- a meter or a SIM card is.
--
--   1. Evidence answers. A 'photo' field whose answer is a list of canonical
--      public.evidence ids. The form engine does NOT authorize or upload them:
--      it checks the shape (uuids, unique, within the field's limit) and the
--      CONSUMING command checks that each id is evidence the actor registered
--      against the object being recorded. Forms never gains a second file
--      system, a bucket, or an upload path of its own.
--
--   2. Entity answers. An 'entity' field whose answer is one uuid of a named
--      kind ('programme_property' today). Again the engine checks only the
--      shape; the consuming command checks the row exists, is in scope and is
--      one the actor may act on. The allow-list exists so the builder and the
--      renderer know what to search, not so the engine can authorize.
--
--   3. Conditions over a SET of answers ("op": "in", "values": [...]). Two of
--      the four outcomes of a real visit share the same follow-up questions, so
--      'equals' against a single option cannot express the rule and the
--      alternative is to duplicate every follow-up question per outcome.
--
-- Conditional REQUIREDness needs no new concept: `condition` decides whether a
-- question is shown and `required` applies only to shown questions (both
-- app.forms_validate_answers and its TypeScript mirror already skip hidden
-- fields). "Required when the outcome is X" is therefore a conditional field
-- that is required - which is what it says.
--
-- Plus one delivery model, not a new engine:
--
--   4. Staff submissions. form_submissions.invitation_id becomes nullable so a
--      signed-in staff member can answer a form in the app. Such a row records
--      who answered it and is still immutable, still keyed by its revision's
--      field ids, still validated by app.forms_validate_answers. There is no
--      new submit entry point for clients: a staff submission is only ever
--      created INSIDE another command, through app.forms_staff_submit, so the
--      command that owns the work owns the authorization.
--
-- Because a recipient link cannot authorize an evidence upload or an entity
-- lookup, creating a link for a form that uses a staff-only field type is
-- refused (FORMS_NOT_LINKABLE). One check is enough: an invitation binds to one
-- revision, and revisions are immutable, so a link can never later acquire a
-- field type it was not checked against.
--
-- Additive only. Every existing definition, revision, invitation and submission
-- stays valid and behaves identically: no existing form uses the new types, no
-- existing condition uses the new operator, and every existing submission keeps
-- source 'RecipientLink' with its invitation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The new field types
-- -----------------------------------------------------------------------------

-- Types a recipient with no account cannot answer: both need an authenticated
-- actor (to own an upload, or to be allowed to search a table).
create function app.forms_staff_only_types()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['photo', 'entity'] $$;

-- The entity kinds an 'entity' field may look up. A kind here says only "the
-- builder and renderer know how to search this"; what the answer is allowed to
-- be is decided by the command that consumes the submission.
create function app.forms_entity_kinds()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['programme_property'] $$;

-- How many files one photo field may carry when it does not say.
create function app.forms_photo_default_max()
returns integer
language sql immutable
set search_path = ''
as $$ select 10 $$;

create or replace function app.forms_input_types()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array['short_text', 'long_text', 'email', 'phone', 'number', 'currency', 'date', 'time',
               'yes_no', 'single_choice', 'multiple_choice', 'dropdown', 'scale', 'address', 'confirmation',
               'photo', 'entity']
$$;

-- -----------------------------------------------------------------------------
-- 2. Definition validation
-- -----------------------------------------------------------------------------

create or replace function app.forms_validate_definition(p_def jsonb)
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
  v_op text;
  v_value jsonb;
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
      if v_key not in ('id', 'type', 'label', 'help', 'required', 'options', 'min', 'max',
                       'placeholder', 'condition', 'entity') then
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

    -- The entity kind: required for 'entity', meaningless anywhere else.
    if v_type = 'entity' then
      if not ((v_field ->> 'entity') = any (app.forms_entity_kinds())) then
        perform app.forms_bad(v_id, 'unknown entity kind');
      end if;
    elsif v_field ? 'entity' then
      perform app.forms_bad(v_id, 'only a lookup question names an entity');
    end if;

    -- Bounds: number/currency any numbers; scale integers 0-10; photo a file
    -- count (max only - "at least one" is what `required` already means).
    if v_field ? 'min' or v_field ? 'max' then
      if v_type not in ('number', 'currency', 'scale', 'photo') then
        perform app.forms_bad(v_id, 'only number, currency, scale and photo questions have limits');
      end if;
      if (v_field ? 'min' and jsonb_typeof(v_field -> 'min') <> 'number')
         or (v_field ? 'max' and jsonb_typeof(v_field -> 'max') <> 'number') then
        perform app.forms_bad(v_id, 'limits must be numbers');
      end if;
      if v_type = 'photo' then
        if v_field ? 'min' then perform app.forms_bad(v_id, 'a photo question has a maximum only'); end if;
        if (v_field ->> 'max') !~ '^[0-9]+$'
           or (v_field ->> 'max')::int not between 1 and app.forms_photo_default_max() then
          perform app.forms_bad(v_id, 'a photo question allows 1-10 files');
        end if;
      elsif v_field ? 'min' and v_field ? 'max'
            and (v_field ->> 'min')::numeric >= (v_field ->> 'max')::numeric then
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
         or (select count(*) from jsonb_object_keys(v_cond) k where k not in ('field', 'op', 'value', 'values')) > 0
         or coalesce(v_cond ->> 'op', '') not in ('equals', 'not_equals', 'includes', 'answered', 'in') then
        perform app.forms_bad(v_id, 'invalid condition');
      end if;
      v_op := v_cond ->> 'op';
      if not ((v_cond ->> 'field') = any (v_inputs)) then
        perform app.forms_bad(v_id, 'a condition must refer to an earlier question');
      end if;
      -- Exactly one of value / values, decided by the operator.
      if v_op = 'in' then
        if v_cond ? 'value' then perform app.forms_bad(v_id, '"in" takes a list of values'); end if;
        if jsonb_typeof(v_cond -> 'values') is distinct from 'array'
           or jsonb_array_length(v_cond -> 'values') not between 1 and 50 then
          perform app.forms_bad(v_id, '"in" needs 1-50 values');
        end if;
        if exists (select 1 from jsonb_array_elements(v_cond -> 'values') e
                   where jsonb_typeof(e.value) not in ('string', 'boolean', 'number')) then
          perform app.forms_bad(v_id, 'invalid condition value');
        end if;
        if (select count(distinct e.value) from jsonb_array_elements(v_cond -> 'values') e)
           <> jsonb_array_length(v_cond -> 'values') then
          perform app.forms_bad(v_id, 'a condition value is repeated');
        end if;
      else
        if v_cond ? 'values' then perform app.forms_bad(v_id, 'only "in" takes a list of values'); end if;
        if v_op <> 'answered'
           and coalesce(jsonb_typeof(v_cond -> 'value'), 'null') not in ('string', 'boolean', 'number') then
          perform app.forms_bad(v_id, 'the condition needs a value');
        end if;
      end if;
      select f into v_source from jsonb_array_elements(p_def -> 'fields') f where f ->> 'id' = v_cond ->> 'field';
      if v_op = 'includes' and v_source ->> 'type' <> 'multiple_choice' then
        perform app.forms_bad(v_id, '"includes" only applies to multiple choice');
      end if;
      if v_op = 'in' and v_source ->> 'type' = 'multiple_choice' then
        perform app.forms_bad(v_id, '"in" does not apply to multiple choice');
      end if;
      -- A condition on a choice question must name options that exist.
      if (v_source ->> 'type') = any (app.forms_choice_types()) and v_op <> 'answered' then
        for v_value in
          select case when v_op = 'in' then e.value else v_cond -> 'value' end
          from jsonb_array_elements(case when v_op = 'in' then v_cond -> 'values' else '[null]'::jsonb end) e
        loop
          if not exists (select 1 from jsonb_array_elements(v_source -> 'options') o
                         where o -> 'id' = v_value) then
            perform app.forms_bad(v_id, 'the condition refers to an option that does not exist');
          end if;
        end loop;
      end if;
    end if;

    v_ids := v_ids || v_id;
    if v_type = any (app.forms_input_types()) then v_inputs := v_inputs || v_id; end if;
  end loop;
  return p_def;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. Answer validation
-- -----------------------------------------------------------------------------

create or replace function app.forms_validate_answers(p_def jsonb, p_answers jsonb)
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
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
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
        when 'in' then v_src is not null and (v_cond -> 'values') @> jsonb_build_array(v_src)
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
      -- A list of canonical public.evidence ids. Shape only: whether these are
      -- files the actor may attach to this object is the consuming command's
      -- question, and it is asked again there.
      when v_type = 'photo' then
        if jsonb_typeof(v_value) <> 'array' then perform app.forms_answer_bad(v_id, 'expected a list of files'); end if;
        v_max := coalesce((v_field ->> 'max')::int, app.forms_photo_default_max());
        if jsonb_array_length(v_value) > v_max then
          perform app.forms_answer_bad(v_id, 'too many files');
        end if;
        for v_item in select value from jsonb_array_elements(v_value) loop
          if jsonb_typeof(v_item) <> 'string' or (v_item #>> '{}') !~* v_uuid then
            perform app.forms_answer_bad(v_id, 'not a file reference');
          end if;
        end loop;
        if (select count(distinct e) from jsonb_array_elements(v_value) e) <> jsonb_array_length(v_value) then
          perform app.forms_answer_bad(v_id, 'the same file was added twice');
        end if;
      -- One uuid of the field's entity kind. Existence and scope, again, belong
      -- to the consuming command.
      when v_type = 'entity' then
        if jsonb_typeof(v_value) <> 'string' or (v_value #>> '{}') !~* v_uuid then
          perform app.forms_answer_bad(v_id, 'not a valid selection');
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
-- 4. Staff submissions
-- -----------------------------------------------------------------------------

alter table public.form_submissions
  alter column invitation_id drop not null;

alter table public.form_submissions
  -- 'RecipientLink': answered through a link by someone with no account (v1).
  -- 'Staff': answered in the app by a signed-in person, inside a command.
  add column source       text not null default 'RecipientLink'
    check (source in ('RecipientLink', 'Staff')),
  add column submitted_by uuid references public.people (id),
  add constraint form_submissions_source_consistency check (
    (source = 'RecipientLink' and invitation_id is not null and submitted_by is null)
    or (source = 'Staff' and invitation_id is null and submitted_by is not null));

comment on column public.form_submissions.source is
  'RecipientLink = answered through a recipient link. Staff = answered in the app by a signed-in person, always inside the command that owns the work.';
comment on column public.form_submissions.submitted_by is
  'The person who answered a Staff submission. Resolved from the session by the command, never supplied by the browser.';

create index form_submissions_submitted_by_idx on public.form_submissions (submitted_by, submitted_at desc)
  where submitted_by is not null;

-- Records a staff answer to a published revision and returns the submission id.
--
-- Deliberately NOT a client entry point and deliberately NOT permission-checked
-- here: the only caller is another command handler, which has already decided
-- that this actor may record this piece of work. Adding a forms.* check would
-- be wrong - an installer recording a visit has no Forms administration rights
-- and should not need any.
--
-- The submission id comes from the caller so the owning command's idempotency
-- covers it: a replayed command re-derives the same id and is answered from the
-- ledger without writing a second submission.
create function app.forms_staff_submit(p_submission_id uuid, p_form_id uuid, p_revision_id uuid,
                                       p_answers jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_form public.forms;
  v_rev public.form_revisions;
  v_clean jsonb;
  v_existing public.form_submissions;
begin
  if p_submission_id is null then perform app.fail('FORMS_SUBMISSION_ID_REQUIRED'); end if;
  select * into v_existing from public.form_submissions where id = p_submission_id;
  if found then
    -- The owning command replays. Nothing is written twice.
    return jsonb_build_object('submission_id', v_existing.id, 'revision_id', v_existing.revision_id,
                              'answers', v_existing.answers, 'replayed', true);
  end if;

  select * into v_form from public.forms where id = p_form_id for share;
  if not found then perform app.fail('FORMS_NOT_FOUND'); end if;
  if v_form.kind <> 'form' then perform app.fail('FORMS_TEMPLATE_NOT_SENDABLE'); end if;
  if v_form.status not in ('published') then perform app.fail('FORMS_NOT_PUBLISHED'); end if;

  -- The revision the person actually answered - not necessarily the current
  -- one, so a form published mid-shift does not invalidate a filled-in screen.
  select * into v_rev from public.form_revisions where id = p_revision_id;
  if not found or v_rev.form_id <> v_form.id then perform app.fail('FORMS_REVISION_NOT_FOUND'); end if;

  v_clean := app.forms_validate_answers(v_rev.definition, p_answers);

  insert into public.form_submissions (id, invitation_id, form_id, revision_id, answers, source, submitted_by)
  values (p_submission_id, null, v_form.id, v_rev.id, v_clean, 'Staff', app.actor_id(p_actor));

  -- Identifiers only: answers are never copied into the audit log.
  perform app.audit('form_submission', p_submission_id::text, 'FORMS_SUBMITTED_BY_STAFF', null,
    jsonb_build_object('form_id', v_form.id, 'revision_id', v_rev.id,
                       'revision', v_rev.revision_number, 'submitted_by', app.actor_id(p_actor)));
  return jsonb_build_object('submission_id', p_submission_id, 'revision_id', v_rev.id,
                            'answers', v_clean, 'replayed', false);
end
$$;

-- -----------------------------------------------------------------------------
-- 5. A recipient link cannot carry a staff-only field type
-- -----------------------------------------------------------------------------

create function app.forms_definition_staff_only(p_def jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select exists (select 1 from jsonb_array_elements(p_def -> 'fields') f
                 where f ->> 'type' = any (app.forms_staff_only_types()))
$$;

-- Unchanged except for the FORMS_NOT_LINKABLE check. An invitation binds to one
-- revision and revisions are immutable, so this one gate is complete: a link
-- can never later acquire a field type it was not checked against.
create or replace function app.cmd_forms_invitation_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['invitation_id', 'token_hash', 'form_id', 'recipient_type', 'job_id',
                                            'person_id', 'recipient_label', 'expires_at'],
                           array['invitation_id', 'token_hash', 'form_id', 'recipient_type']);
  v_form public.forms;
  v_rev public.form_revisions;
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

  -- A recipient has no account, so they can own no upload and search no table.
  select * into v_rev from public.form_revisions where id = v_form.current_revision_id;
  if app.forms_definition_staff_only(v_rev.definition) then
    perform app.fail('FORMS_NOT_LINKABLE');
  end if;

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

-- Staff wording for the two new refusals lives with the rest of the Forms
-- wording, in src/features/forms/errors.ts (Forms does not use the R1-R4
-- result catalogue).
