-- =============================================================================
-- Editing a customer's contact details, and a job's lead source.
--
-- These were the one genuine hole in the command surface. Every other thing
-- staff do to a job - move it, change its installer, record a call, book it,
-- commission it, order its materials, scaffold it - has had an audited command
-- since R1. Correcting a customer's phone number did not. There was no
-- command, no UI, and public.customers carried a SELECT policy and nothing
-- else, so the detail captured at intake was the detail forever.
--
-- What this adds is deliberately narrow:
--
--   * CUSTOMER_UPDATE changes only reachable contact details - phone, email,
--     alternate contact, contact notes. It does NOT change the customer's name
--     or address. Those are identity: the job's reference, its postcode and
--     the whole identity spine in 20260919120000 are derived from them, and a
--     correction there is a different operation with different consequences.
--   * JOB_SALE_UPDATE changes only lead_source - where the enquiry came from.
--     It does NOT touch agreed_price_pence, finance_route, quote_reference or
--     salesperson_id. Those are the agreed commercial terms; they are changed
--     where the contract is visible, not from a sentence.
--
-- Both are anchored to a job the actor can already see. That is what makes
-- them safe to expose: the job carries the visibility rule (app.can_read_job),
-- the historical refusal, and a natural way for a person - or SimpleBot - to
-- say which customer they mean. Neither command grants any new read.
--
-- Nothing bypasses anything. public.customers and public.jobs keep their
-- SELECT-only policies for clients; these handlers run inside
-- public.execute_command, which is security definer, so the write happens
-- through the command path and nowhere else. Versioning and the audit trail
-- are the existing customers_touch/customers_audit and jobs_touch/jobs_audit
-- triggers - this migration adds no new audit call because the tables already
-- record every field that changes.
--
-- Additive only: no column, table, function or policy is dropped or replaced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissions
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('customer.edit',
   'Correct a customer''s contact details - phone, email, alternate contact and contact notes. Not their name or address.'),
  ('job.sale.edit',
   'Change where a job''s enquiry came from (lead source). Not the agreed price, finance route or quote reference.')
on conflict (code) do nothing;

-- The office answers the phone, so the office corrects the number.
insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
from public.roles r
cross join (values ('customer.edit'), ('job.sale.edit')) as p (code)
where r.code in ('Admin', 'Manager', 'Director', 'Office')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. The job these edits hang off
-- -----------------------------------------------------------------------------

-- The permission gate for both commands. Mirrors app.help_require: the coarse
-- role check already happened in app.authorize_command; this is the permission
-- the handler itself insists on, so the registry can never be the only thing
-- standing between someone and a customer's details.
create function app.customer_edit_require(p_permission text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if app.current_person_id() is null or not app.has_permission(p_permission) then
    perform app.fail('R1A_ROLE_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end
$$;

-- Resolves the request's job_id to a job the actor may see and may act on,
-- and returns it locked. Shared by both commands so the refusals are identical.
--
-- Historical jobs are refused outright. An imported record is an archive of
-- what the previous system held; correcting it would misrepresent the import
-- rather than fix anything, and the standing rule is that HistoricalImport
-- stays non-mutable.
create function app.customer_edit_job(p_request jsonb, p_actor jsonb)
returns public.jobs
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_job public.jobs;
begin
  begin
    v_id := nullif(btrim(p_request ->> 'job_id'), '')::uuid;
  exception when others then
    perform app.fail('R1A_INVALID_FIELDS');
  end;
  if v_id is null then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;

  select * into v_job from public.jobs where id = v_id for update;
  if not found then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.can_read_job(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  if v_job.record_class = 'HistoricalImport' then
    perform app.fail('CUSTOMER_EDIT_HISTORICAL');
  end if;
  return v_job;
end
$$;

-- A contact field a person typed. Returns a refusal code, or null when usable.
-- Deliberately permissive about shape - UK numbers are written a dozen ways
-- and this is a correction path, not a validator - but strict about the things
-- that mean the value is not a contact detail at all.
create function app.contact_value_problem(p_field text, p_value text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_value, '');
begin
  if v <> btrim(v) then
    return 'CUSTOMER_CONTACT_INVALID';
  end if;
  if v ~ '[[:cntrl:]]' then
    return 'CUSTOMER_CONTACT_INVALID';
  end if;
  if p_field = 'contact_notes' then
    if char_length(v) > 2000 then return 'CUSTOMER_CONTACT_TOO_LONG'; end if;
    return null;
  end if;
  if char_length(v) > 200 then
    return 'CUSTOMER_CONTACT_TOO_LONG';
  end if;
  if p_field = 'email' and v <> '' then
    -- One @, something either side, no whitespace. Anything further belongs to
    -- whatever actually sends the mail, not to a correction.
    if v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return 'CUSTOMER_EMAIL_INVALID';
    end if;
  end if;
  if p_field = 'phone' and v <> '' then
    -- Digits and the punctuation people write between them.
    if v !~ '^[0-9 ()+.-]{6,}$' then
      return 'CUSTOMER_PHONE_INVALID';
    end if;
  end if;
  return null;
end
$$;

-- Reads one optional contact field out of the payload. Returns the value to
-- store when the key is present, and p_current when it is not, so a command
-- that names one field leaves the rest alone. An empty string clears.
create function app.contact_field(p_payload jsonb, p_field text, p_current text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_raw text;
  v_problem text;
begin
  if not (p_payload ? p_field) then
    return p_current;
  end if;
  if jsonb_typeof(p_payload -> p_field) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_payload -> p_field) <> 'string' then
    perform app.fail('CUSTOMER_CONTACT_INVALID');
  end if;
  v_raw := p_payload ->> p_field;
  v_problem := app.contact_value_problem(p_field, v_raw);
  if v_problem is not null then
    perform app.fail(v_problem, jsonb_build_object('field', p_field));
  end if;
  return nullif(v_raw, '');
end
$$;

-- -----------------------------------------------------------------------------
-- 3. CUSTOMER_UPDATE
-- -----------------------------------------------------------------------------

-- CUSTOMER_UPDATE {job_id, payload: {phone?, email?, alternate_contact?,
-- contact_notes?}} + expected_version (the CUSTOMER's version, not the job's).
--
-- At least one field must be named, and the result must leave the customer
-- reachable: a customer with neither a phone number nor an email address is
-- the state that made 7 historical records unimportable, and nothing here
-- should be able to create another one.
create function app.cmd_customer_update(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['phone', 'email', 'alternate_contact', 'contact_notes']);
  v_job public.jobs;
  v_before public.customers;
  v_after public.customers;
  v_phone text;
  v_email text;
  v_alt text;
  v_notes text;
begin
  perform app.customer_edit_require('customer.edit');
  v_job := app.customer_edit_job(p_request, p_actor);

  if not (v_p ? 'phone' or v_p ? 'email' or v_p ? 'alternate_contact' or v_p ? 'contact_notes') then
    perform app.fail('CUSTOMER_NO_CHANGE');
  end if;

  select * into v_before from public.customers where id = v_job.customer_id for update;
  if not found then
    perform app.fail('CUSTOMER_NOT_FOUND');
  end if;
  if app.expected_version(p_request) <> v_before.version then
    perform app.fail('R1A_STALE_VERSION', jsonb_build_object('current_version', v_before.version));
  end if;

  v_phone := app.contact_field(v_p, 'phone', v_before.phone);
  v_email := app.contact_field(v_p, 'email', v_before.email);
  v_alt   := app.contact_field(v_p, 'alternate_contact', v_before.alternate_contact);
  v_notes := app.contact_field(v_p, 'contact_notes', v_before.contact_notes);

  if v_phone is null and v_email is null then
    perform app.fail('CUSTOMER_CONTACT_REQUIRED');
  end if;

  if v_phone is not distinct from v_before.phone
     and v_email is not distinct from v_before.email
     and v_alt is not distinct from v_before.alternate_contact
     and v_notes is not distinct from v_before.contact_notes then
    perform app.fail('CUSTOMER_NO_CHANGE');
  end if;

  update public.customers
     set phone = v_phone,
         email = v_email,
         alternate_contact = v_alt,
         contact_notes = v_notes
   where id = v_before.id
  returning * into v_after;

  return jsonb_build_object(
    'customer_id', v_after.id,
    'job_id', v_job.id,
    'job_ref', v_job.job_ref,
    'version', v_after.version,
    'changed', (
      select coalesce(jsonb_agg(f), '[]'::jsonb) from (
        select 'phone' as f where v_after.phone is distinct from v_before.phone
        union all select 'email' where v_after.email is distinct from v_before.email
        union all select 'alternate_contact' where v_after.alternate_contact is distinct from v_before.alternate_contact
        union all select 'contact_notes' where v_after.contact_notes is distinct from v_before.contact_notes
      ) s
    )
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 4. JOB_SALE_UPDATE
-- -----------------------------------------------------------------------------

-- JOB_SALE_UPDATE {job_id, payload: {lead_source}} + expected_version (the
-- job's). lead_source is free text in the schema and stays free text here -
-- the business names its own channels - but it is trimmed, length-capped and
-- must actually differ.
create function app.cmd_job_sale_update(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['lead_source'], array['lead_source']);
  v_job public.jobs;
  v_after public.jobs;
  v_lead text;
begin
  perform app.customer_edit_require('job.sale.edit');
  v_job := app.customer_edit_job(p_request, p_actor);

  if app.expected_version(p_request) <> v_job.version then
    perform app.fail('R1A_STALE_VERSION', jsonb_build_object('current_version', v_job.version));
  end if;

  if jsonb_typeof(v_p -> 'lead_source') = 'null' then
    v_lead := null;
  else
    v_lead := btrim(coalesce(app.txt(v_p, 'lead_source'), ''));
    if v_lead ~ '[[:cntrl:]]' or char_length(v_lead) > 200 then
      perform app.fail('JOB_LEAD_SOURCE_INVALID');
    end if;
    v_lead := nullif(v_lead, '');
  end if;

  if v_lead is not distinct from v_job.lead_source then
    perform app.fail('JOB_SALE_NO_CHANGE');
  end if;

  update public.jobs set lead_source = v_lead where id = v_job.id
  returning * into v_after;

  return jsonb_build_object(
    'job_id', v_after.id,
    'job_ref', v_after.job_ref,
    'version', v_after.version,
    'lead_source', v_after.lead_source,
    'previous_lead_source', v_job.lead_source
  );
end
$$;

-- -----------------------------------------------------------------------------
-- 5. Registry
-- -----------------------------------------------------------------------------

-- job_scoped false: the office corrects contact details for jobs they are not
-- personally assigned to, which is the whole point. Visibility is still
-- enforced - app.customer_edit_job calls app.can_read_job - and the handlers
-- require their own permission, which only the office roles hold.
insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes)
values
  ('CUSTOMER_UPDATE',
   array['Admin', 'Manager', 'Director', 'Office'], false, '[]'::jsonb, 'customers',
   'Contact details only (phone, email, alternate contact, notes). Never name or address. Requires customer.edit; job visibility via app.can_read_job; HistoricalImport refused. Not release-gated.'),
  ('JOB_SALE_UPDATE',
   array['Admin', 'Manager', 'Director', 'Office'], false, '[]'::jsonb, 'jobs',
   'lead_source only. Never agreed price, finance route or quote reference. Requires job.sale.edit; job visibility via app.can_read_job; HistoricalImport refused. Not release-gated.')
on conflict (command_type) do nothing;
