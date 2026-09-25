-- =============================================================================
-- A signature question.
--
-- Forms could collect a photograph, but only from a signed-in staff member: a
-- photo becomes canonical evidence, and evidence needs an actor to own it. That
-- is why a form carrying a photo question cannot be sent as a recipient link at
-- all (FORMS_NOT_LINKABLE). Which meant the one case people actually ask for -
-- the CUSTOMER signing something on their own phone, from a link - was the case
-- the app could not do.
--
-- So a signature is deliberately NOT evidence. It is the answer itself: the
-- path the finger drew, as SVG path data, stored in the submission beside every
-- other answer. Nothing to upload, no actor to own it, so a recipient link
-- carries it like any other question - it is not added to
-- app.forms_staff_only_types() for exactly that reason.
--
-- Stored as a STRING rather than an object with the strokes and the canvas
-- size, because app.forms_is_blank() treats an object as filled only if one of
-- its values is a non-empty string - an object of arrays would have counted as
-- blank and "required" would never have fired. One string of path data also
-- means an empty signature is "", which is already blank everywhere.
--
-- The drawing is captured in a fixed 600x200 coordinate space, so the value is
-- self-describing and re-renders at any size without storing dimensions.
--
-- The character allow-list is the important part. This value is drawn back as
-- the `d` attribute of an SVG path, so it is untrusted content going into
-- markup: restricting it to move/line/curve commands, digits and separators
-- means it cannot carry anything else, whatever a client sends.
--
-- ROLLBACK:
--   begin;
--   -- Re-run the previous app.forms_input_types() (without 'signature') and
--   -- the previous app.forms_validate_answers(jsonb, jsonb) from
--   -- 20260919190000_forms.sql / 20260921100000_forms_field_types.sql.
--   -- Any signature already collected stays in form_submissions.answers as an
--   -- ordinary string; nothing needs deleting.
--   commit;
-- =============================================================================

create or replace function app.forms_input_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['short_text', 'long_text', 'email', 'phone', 'number', 'currency', 'date', 'time',
               'yes_no', 'single_choice', 'multiple_choice', 'dropdown', 'scale', 'address', 'confirmation',
               'photo', 'entity', 'signature']
$$;

-- app.forms_staff_only_types() is deliberately unchanged: a signature needs no
-- actor, so a recipient link may carry one.

/** The longest signature this accepts. A normal one is 1-3 KB. */
create function app.forms_signature_max_length()
returns integer
language sql
immutable
set search_path = ''
as $$ select 20000 $$;

grant execute on function app.forms_signature_max_length() to authenticated, service_role;

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
      -- The path a finger drew, in a 600x200 space. Not evidence and not a
      -- file: the answer IS the drawing, which is what lets a recipient link
      -- carry one. The allow-list matters because this is drawn back as an
      -- SVG path's `d` attribute - untrusted content going into markup - so
      -- nothing but move, line and curve commands can survive it.
      when v_type = 'signature' then
        if jsonb_typeof(v_value) <> 'string' then
          perform app.forms_answer_bad(v_id, 'expected a signature');
        end if;
        if char_length(v_value #>> '{}') > app.forms_signature_max_length() then
          perform app.forms_answer_bad(v_id, 'signature is too long');
        end if;
        if (v_value #>> '{}') !~ '^[MLCQmlcq0-9 .,-]+$' then
          perform app.forms_answer_bad(v_id, 'not a signature');
        end if;
        if (v_value #>> '{}') !~ '^[Mm]' then
          perform app.forms_answer_bad(v_id, 'not a signature');
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
