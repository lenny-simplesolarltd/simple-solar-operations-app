-- =============================================================================
-- Writing an email, and saving the wording to use again.
--
-- Every communication until now was born from a domain event: a merchant
-- order, a scaffold instruction, a scheduled report, a customer document. The
-- office could approve those and record what they sent by hand, but there was
-- no way to simply write to somebody from the operations mailbox - the screen
-- said so, in a banner that had stopped being true.
--
-- Three decisions the owner made, recorded here because the schema encodes
-- them and a later reader will otherwise assume the house default:
--
--   1. NO APPROVAL STEP. Composing is approving. The existing kinds go
--      Draft -> Approved -> Queued because a machine wrote the words and a
--      person had to agree to them. Here a person wrote the words. The row is
--      still created Approved (not skipped) so the audit trail, the payload
--      hash and the "content must match what was approved" check all work
--      unchanged - approved_by is the author, at the moment they sent it.
--   2. ITS OWN GATE, FN-24. Not FN-03 or FN-04: switching ad-hoc email on must
--      not switch merchant or scaffolder email on with it. This is the lesson
--      FN-23 learned when reports borrowed FN-22 and the two requirements
--      turned out to be mutually exclusive.
--   3. MERGE FIELDS. A template may carry {{customer_name}} and friends,
--      resolved against a job or a customer at send time.
--
-- The one that needs stating: an unresolved placeholder is a REFUSAL, not a
-- blank and not a passthrough. "Hi {{customer_name}}," arriving at a customer
-- is worse than an email that did not send, and it cannot be recalled.
--
-- ROLLBACK:
--   begin;
--   drop function if exists app.cmd_adhoc_email_send(jsonb, jsonb);
--   drop function if exists app.cmd_email_template_set(jsonb, jsonb);
--   drop function if exists app.cmd_email_template_delete(jsonb, jsonb);
--   drop function if exists app.read_email_templates(jsonb, jsonb);
--   drop function if exists app.email_merge_apply(text, jsonb);
--   drop function if exists app.email_merge_context(uuid, uuid, jsonb);
--   delete from app.command_registry where command_type in
--     ('ADHOC_EMAIL_SEND', 'EMAIL_TEMPLATE_SET', 'EMAIL_TEMPLATE_DELETE');
--   delete from app.read_registry where read_type = 'EMAIL_TEMPLATES';
--   delete from app.communication_kinds where type = 'AdhocEmail';
--   delete from app.outbox_action_types where action_type = 'EmailAdhoc';
--   delete from public.release_modes where function_id = 'FN-24';
--   drop table if exists public.email_templates;
--   commit;
-- =============================================================================

-- -- 1. The gate -----------------------------------------------------------

insert into public.release_modes (function_id, function_name, mode, mode_record_basis, authorised_job_scope,
                                  target_release, planned_target_mode, current_system, fallback, scope_boundary_notes)
values ('FN-24', 'Ad-hoc email written by a person', 'Disabled',
        'Ad-hoc email migration; disabled until approved', 'None', 'R1', 'Automated',
        'Staff write the email in their own mail client and record it here afterwards',
        'Staff write the email in their own mail client and record it here afterwards',
        'Switch to Automated (scope Pilot or All) to let a person send email from the office mailbox. Independent of FN-03, FN-04 and FN-23: turning this on turns nothing else on.')
on conflict (function_id) do nothing;

-- -- 2. The dispatch registration --------------------------------------------

insert into app.outbox_action_types (action_type, service, function_id, live_setting, max_attempts,
                                     backoff_minutes, stalled_minutes, claim_hook, result_hook, module,
                                     allowlist_required, notes) values
  ('EmailAdhoc', 'EmailService', 'FN-24', 'email.mode', 5, '{1,2,4,8,16}', 15,
   'email_claim_decision', 'email_on_result', 'communications', false,
   'Email a person wrote and sent themselves, from the office mailbox. FN-24 Automated + email.mode LIVE + a configured sender.');

insert into app.communication_kinds (type, action_type, function_id, module, notes) values
  ('AdhocEmail', 'EmailAdhoc', 'FN-24', 'communications',
   'app.cmd_adhoc_email_send. Composed and sent by a person in one act; created Approved because they are the approver.');

-- -- 3. Templates ------------------------------------------------------------

create table public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> '' and length(name) <= 120),
  description text check (length(description) <= 500),
  subject     text not null check (btrim(subject) <> '' and length(subject) <= 300),
  body        text not null check (btrim(body) <> ''),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.people (id),
  version     integer not null default 1 check (version >= 1)
);
comment on table public.email_templates is
  'Reusable wording for ad-hoc email. May contain {{merge_field}} placeholders, resolved at send time against a job or customer. Holding a template grants nothing: FN-24 and the email settings still decide whether anything leaves.';

-- Names are how people pick one, so two templates cannot share one.
create unique index email_templates_name_key on public.email_templates (lower(btrim(name)));

alter table public.email_templates enable row level security;

-- Reading a template is reading office wording, not customer data: anybody who
-- may send a communication may see what there is to send.
create policy email_templates_read on public.email_templates
  for select to authenticated using (app.has_permission('communication.send'));

insert into public.permissions (code, description) values
  ('communication.template.manage',
   'Create, change and delete the saved wording used for ad-hoc email.')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code)
select r.role_code, 'communication.template.manage'
from (values ('Admin'), ('Manager'), ('Office')) as r (role_code)
on conflict (role_code, permission_code) do nothing;

-- -- 4. Merge fields ---------------------------------------------------------

/**
 * Everything a placeholder may resolve to, for one job and/or one customer.
 *
 * Table-driven would be worse here, not better: every key needs its own join
 * and its own formatting, so a registry would only move the same code into
 * strings nobody can typecheck. Adding a field is one line in this function
 * and one row in the catalogue below, which the UI lists.
 *
 * p_extra lets the caller supply values that exist only at send time (the
 * sender's own name). Its keys never override a resolved one.
 */
create function app.email_merge_context(p_job_id uuid, p_customer_id uuid, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_cust public.customers;
  v_out jsonb := '{}'::jsonb;
  v_addr text;
begin
  if p_job_id is not null then
    select * into v_job from public.jobs where id = p_job_id;
    if not found then perform app.fail('JOB_NOT_FOUND'); end if;
  end if;
  -- An explicit customer wins; otherwise the job's, so naming a job is enough.
  select * into v_cust from public.customers
  where id = coalesce(p_customer_id, v_job.customer_id);

  if v_job.id is not null then
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'job_ref', v_job.job_ref,
      'job_name', v_job.display_name));
  end if;

  if v_cust.id is not null then
    v_addr := array_to_string(array_remove(array[
      nullif(btrim(coalesce(v_cust.address_line1, '')), ''),
      nullif(btrim(coalesce(v_cust.address_line2, '')), ''),
      nullif(btrim(coalesce(v_cust.town, '')), ''),
      nullif(btrim(coalesce(v_cust.postcode, '')), '')], null), ', ');
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'customer_name', nullif(btrim(concat_ws(' ', v_cust.first_name, v_cust.last_name)), ''),
      'customer_first_name', nullif(btrim(coalesce(v_cust.first_name, '')), ''),
      'customer_email', nullif(btrim(coalesce(v_cust.email, '')), ''),
      'customer_phone', nullif(btrim(coalesce(v_cust.phone, '')), ''),
      'customer_address', nullif(v_addr, ''),
      'customer_postcode', nullif(btrim(coalesce(v_cust.postcode, '')), '')));
  end if;

  -- Always available, job or no job.
  v_out := v_out || jsonb_build_object('today', to_char(app.london_date(), 'DD Mon YYYY'));

  -- Caller-supplied last, and never over the top of a resolved value.
  return coalesce(p_extra, '{}'::jsonb) || v_out;
end
$$;

/** The catalogue the compose screen lists. Documentation, not dispatch. */
create table app.email_merge_fields (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label       text not null,
  description text not null,
  needs       text not null check (needs in ('job', 'customer', 'always', 'sender'))
);
revoke all on app.email_merge_fields from public, anon, authenticated;

insert into app.email_merge_fields (key, label, description, needs) values
  ('customer_name',       'Customer name',       'First and last name together.', 'customer'),
  ('customer_first_name', 'Customer first name', 'For a friendlier opening line.', 'customer'),
  ('customer_email',      'Customer email',      'The address on the customer record.', 'customer'),
  ('customer_phone',      'Customer phone',      'The number on the customer record.', 'customer'),
  ('customer_address',    'Customer address',    'Address lines, town and postcode, comma separated.', 'customer'),
  ('customer_postcode',   'Customer postcode',   'Postcode only.', 'customer'),
  ('job_ref',             'Job reference',       'The SS-XXXX-0000 reference.', 'job'),
  ('job_name',            'Job name',            'The job''s display name.', 'job'),
  ('sender_name',         'Your name',           'The name of whoever presses send.', 'sender'),
  ('today',               'Today''s date',       'Today, as 26 Sep 2026.', 'always');

/**
 * Substitute {{key}} throughout, and report what could not be filled.
 *
 * Unresolved placeholders are returned rather than quietly blanked: the caller
 * refuses the send. A customer receiving "Hi {{customer_name}}," cannot be
 * un-received, and an email that silently drops the name is no better.
 */
create function app.email_merge_apply(p_text text, p_context jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_out text := coalesce(p_text, '');
  v_key text;
  v_missing text[] := '{}';
begin
  for v_key in
    select distinct m[1] from regexp_matches(coalesce(p_text, ''), '\{\{\s*([a-z][a-z0-9_]*)\s*\}\}', 'g') m
  loop
    if p_context ? v_key and nullif(btrim(coalesce(p_context ->> v_key, '')), '') is not null then
      v_out := regexp_replace(v_out, '\{\{\s*' || v_key || '\s*\}\}', p_context ->> v_key, 'g');
    else
      v_missing := v_missing || v_key;
    end if;
  end loop;
  return jsonb_build_object('text', v_out, 'missing', to_jsonb(v_missing));
end
$$;

-- -- 5. Commands -------------------------------------------------------------

/** EMAIL_TEMPLATE_SET {id?, name, subject, body, description?} */
create function app.cmd_email_template_set(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['id', 'name', 'subject', 'body', 'description'],
    array['name', 'subject', 'body']);
  v_id uuid := nullif(btrim(coalesce(v_p ->> 'id', '')), '')::uuid;
  v_name text := btrim(coalesce(v_p ->> 'name', ''));
  v_subject text := btrim(coalesce(v_p ->> 'subject', ''));
  v_body text := coalesce(v_p ->> 'body', '');
  v_desc text := nullif(btrim(coalesce(v_p ->> 'description', '')), '');
  v_me uuid := app.current_person_id();
  v_row public.email_templates;
  v_before jsonb;
  v_unknown text[];
begin
  perform app.comm_require(p_actor, 'communication.template.manage');
  if v_name = '' or v_subject = '' or btrim(v_body) = '' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;

  -- A placeholder nobody can resolve is a typo, and finding it at send time
  -- means finding it in front of a customer. Catch it while it is being typed.
  select coalesce(array_agg(distinct k), '{}') into v_unknown
  from (
    select m[1] k from regexp_matches(v_subject || ' ' || v_body, '\{\{\s*([a-z][a-z0-9_]*)\s*\}\}', 'g') m
  ) s
  where not exists (select 1 from app.email_merge_fields f where f.key = s.k);
  if cardinality(v_unknown) > 0 then
    perform app.fail('EMAIL_TEMPLATE_UNKNOWN_FIELD',
      jsonb_build_object('fields', to_jsonb(v_unknown)));
  end if;

  if v_id is not null then
    select * into v_row from public.email_templates where id = v_id;
    if not found then perform app.fail('EMAIL_TEMPLATE_NOT_FOUND'); end if;
    v_before := to_jsonb(v_row);
    update public.email_templates
    set name = v_name, subject = v_subject, body = v_body, description = v_desc,
        updated_at = now(), updated_by = v_me, version = version + 1
    where id = v_id
    returning * into v_row;
  else
    insert into public.email_templates (name, subject, body, description, created_by, updated_by)
    values (v_name, v_subject, v_body, v_desc, v_me, v_me)
    returning * into v_row;
  end if;

  perform app.audit('email_template', v_row.id::text, 'EMAIL_TEMPLATE_SET', v_before, to_jsonb(v_row));
  return jsonb_build_object('template_id', v_row.id, 'name', v_row.name, 'version', v_row.version);
end
$$;

/** EMAIL_TEMPLATE_DELETE {id} */
create function app.cmd_email_template_delete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['id'], array['id']);
  v_row public.email_templates;
begin
  perform app.comm_require(p_actor, 'communication.template.manage');
  select * into v_row from public.email_templates
  where id = nullif(btrim(coalesce(v_p ->> 'id', '')), '')::uuid;
  if not found then perform app.fail('EMAIL_TEMPLATE_NOT_FOUND'); end if;

  -- Nothing cascades: an email already sent from this wording is a record of
  -- something that happened, and keeps its own copy of the text.
  delete from public.email_templates where id = v_row.id;
  perform app.audit('email_template', v_row.id::text, 'EMAIL_TEMPLATE_DELETE', to_jsonb(v_row), null);
  return jsonb_build_object('deleted', true, 'name', v_row.name);
end
$$;

/**
 * ADHOC_EMAIL_SEND {recipients:[{name?,email}], subject, body, template_id?, job_id?, customer_id?}
 *
 * Composes, approves and queues in one act, because a person wrote it. The
 * worker is what actually sends; this puts it in the outbox and every gate
 * downstream still applies.
 */
create function app.cmd_adhoc_email_send(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request,
    array['recipients', 'subject', 'body', 'template_id', 'job_id', 'customer_id'],
    array['recipients', 'subject', 'body']);
  v_job uuid := nullif(btrim(coalesce(v_p ->> 'job_id', '')), '')::uuid;
  v_cust uuid := nullif(btrim(coalesce(v_p ->> 'customer_id', '')), '')::uuid;
  v_recipients jsonb;
  v_ctx jsonb;
  v_subject jsonb;
  v_body jsonb;
  v_missing text[];
  v_me uuid := app.current_person_id();
  v_my_name text;
  v_comm public.communications;
  v_queued jsonb;
  v_bad jsonb;
begin
  perform app.comm_require(p_actor, 'communication.send');
  perform app.require_mode('FN-24', 'Automated');

  if jsonb_typeof(v_p -> 'recipients') <> 'array'
     or jsonb_array_length(v_p -> 'recipients') = 0 then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'recipients'));
  end if;

  -- Normalised here so the snapshot is the same shape every other kind uses.
  select jsonb_agg(jsonb_build_object(
           'name', nullif(btrim(coalesce(e ->> 'name', '')), ''),
           'email', lower(btrim(coalesce(e ->> 'email', '')))))
  into v_recipients
  from jsonb_array_elements(v_p -> 'recipients') e;

  select jsonb_agg(r) into v_bad from jsonb_array_elements(v_recipients) r
  where not (r ->> 'email') ~ '^[a-z0-9_+.-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';
  if v_bad is not null then
    perform app.fail('EMAIL_RECIPIENT_INVALID', jsonb_build_object('recipients', v_bad));
  end if;

  select btrim(coalesce(display_name, '')) into v_my_name from public.people where id = v_me;
  v_ctx := app.email_merge_context(v_job, v_cust,
    jsonb_strip_nulls(jsonb_build_object('sender_name', nullif(v_my_name, ''))));

  v_subject := app.email_merge_apply(v_p ->> 'subject', v_ctx);
  v_body := app.email_merge_apply(v_p ->> 'body', v_ctx);
  select coalesce(array_agg(distinct x), '{}') into v_missing
  from (select jsonb_array_elements_text(v_subject -> 'missing') x
        union select jsonb_array_elements_text(v_body -> 'missing')) s;
  if cardinality(v_missing) > 0 then
    -- Refused, not blanked. See the header.
    perform app.fail('EMAIL_MERGE_UNRESOLVED', jsonb_build_object('fields', to_jsonb(v_missing)));
  end if;

  -- Approved on creation: the person composing it is the approver. Recorded
  -- explicitly so the audit trail names them rather than leaving it null.
  insert into public.communications (job_id, type, subject, body_snapshot, recipients_snapshot,
                                     status, approved_at, approved_by, created_by)
  values (v_job, 'AdhocEmail', v_subject ->> 'text', v_body ->> 'text', v_recipients::text,
          'Approved', now(), v_me, v_me)
  returning * into v_comm;

  perform app.audit('communication', v_comm.id::text, 'ADHOC_EMAIL_SEND', null, to_jsonb(v_comm));

  -- A shut door is an outcome the sender is owed, not a crash that loses what
  -- they typed: the communication survives and can be queued later.
  begin
    v_queued := app.communication_queue_now(v_comm.id);
    return jsonb_build_object('ok', true, 'communication_id', v_comm.id,
                              'status', 'Queued', 'outbox_id', v_queued ->> 'outbox_id',
                              'recipients', jsonb_array_length(v_recipients));
  exception when others then
    return jsonb_build_object('ok', true, 'communication_id', v_comm.id,
                              'status', 'Approved', 'detail', sqlerrm,
                              'recipients', jsonb_array_length(v_recipients));
  end;
end
$$;

/**
 * EMAIL_TEMPLATES {} - everything the compose screen needs in one read.
 *
 * The saved wording, the placeholders it may use, and the two facts about
 * sending that the screen must not guess: which mailbox it goes from, and
 * whether FN-24 is open. A screen that assumed the address would print the
 * wrong one the day somebody changed the setting.
 */
create function app.read_email_templates(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
begin
  if not app.has_permission('communication.send') then
    perform app.fail('R1A_PERMISSION_DENIED', jsonb_build_object('permission', 'communication.send'));
  end if;
  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'description', t.description,
               'subject', t.subject, 'body', t.body, 'version', t.version,
               'updatedAt', t.updated_at)
             order by lower(t.name))
      from public.email_templates t), '[]'::jsonb),
    'mergeFields', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', f.key, 'label', f.label, 'description', f.description, 'needs', f.needs)
             order by f.needs, f.key)
      from app.email_merge_fields f), '[]'::jsonb),
    'canManage', app.has_permission('communication.template.manage'),
    'sendingMailbox', nullif(btrim(coalesce(app.setting('email.from_mailbox') #>> '{}', '')), ''),
    'replyTo', nullif(btrim(coalesce(app.setting('email.reply_to') #>> '{}', '')), ''),
    'canSend', app.mode_available('FN-24', 'Automated'));
end
$$;

-- -- 6. Registration ---------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('EMAIL_TEMPLATE_SET', array['Admin', 'Manager', 'Office'], false, '[]'::jsonb, 'communications',
   'Handler requires communication.template.manage. Saving wording sends nothing.'),
  ('EMAIL_TEMPLATE_DELETE', array['Admin', 'Manager', 'Office'], false, '[]'::jsonb, 'communications',
   'Handler requires communication.template.manage.'),
  ('ADHOC_EMAIL_SEND', array['Admin', 'Manager', 'Office'], false,
   '[{"function_id": "FN-24", "mode": "Automated"}]'::jsonb, 'communications',
   'Handler requires communication.send and re-checks FN-24. Composes, approves and queues in one act.');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('EMAIL_TEMPLATES', array['Admin', 'Manager', 'Director', 'Office'], '[]'::jsonb, 'communications',
   'Handler requires communication.send. The saved wording and the merge fields it may use.');
