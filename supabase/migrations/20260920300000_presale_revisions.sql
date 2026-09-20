-- =============================================================================
-- Quote versions: an editable presale that is still a record of what was sold.
--
-- Until now a presale was write-once. `job_id` was unique and a trigger refused
-- every UPDATE and DELETE, so a typo in a phone number and a customer asking
-- "what would a second battery cost?" were equally impossible to answer.
--
-- The fix is NOT to make the row editable. A generated contract has to be
-- traceable to exactly the figures it was generated from, and an emailed
-- quotation has to keep meaning next year. So the table stays append-only and
-- every version is its own immutable row; what changes is that a job may now
-- have more than one, with exactly one current.
--
-- Two kinds of edit, because they mean different things to a customer:
--
--   correction   The quote number does not move. Quote 1 stays Quote 1; the
--                correction number behind it increments. For fixing what was
--                recorded wrongly - a misheard phone number, a wrong note.
--
--   new_version  The quote number increments. Quote 1 becomes Quote 2. For
--                changing what is being SOLD - a second battery, a different
--                panel, a new price. The customer is looking at a new offer
--                and should be able to say which one they accepted.
--
-- Superseding is the only mutation this table will ever accept, and only on a
-- row that has not already been superseded.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Versions
-- -----------------------------------------------------------------------------

alter table public.presales
  -- What the customer sees: "Quote 2". Moves only on a new_version.
  add column quote_number      integer not null default 1 check (quote_number > 0),
  -- What the office sees behind it. Moves on every correction, and resets to 1
  -- when the quote number moves.
  add column correction_number integer not null default 1 check (correction_number > 0),
  add column supersedes        uuid references public.presales (id),
  add column superseded_at     timestamptz,
  -- Deferred, because a revision points the outgoing version at its
  -- replacement before inserting it - the only order that keeps
  -- presales_current_per_job satisfied at every statement boundary.
  add column superseded_by     uuid references public.presales (id)
                               deferrable initially deferred,
  -- Why this version exists, in the words of whoever made it. Required for a
  -- revision; null on the original sale, which needs no justification.
  add column revision_reason   text,
  add constraint presales_superseded_together
    check ((superseded_at is null) = (superseded_by is null));

-- One presale per job was enforced by a unique constraint. It is now enforced
-- by "one UNSUPERSEDED presale per job", which is the same promise for every
-- reader that only ever wanted the current one.
alter table public.presales drop constraint presales_job_id_key;
create unique index presales_current_per_job
  on public.presales (job_id) where superseded_by is null;
create unique index presales_version_per_job
  on public.presales (job_id, quote_number, correction_number);
create index presales_job_history_idx
  on public.presales (job_id, quote_number desc, correction_number desc);

comment on column public.presales.quote_number is
  'Customer-facing quote version. Increments only when what is being sold changes.';
comment on column public.presales.superseded_by is
  'The version that replaced this one. Null means this is the current presale.';

-- -----------------------------------------------------------------------------
-- 2. Immutability, narrowed rather than removed
--
-- app.forbid_mutation() is shared with other tables and is left alone; presales
-- gets its own guard so it can permit exactly one transition.
-- -----------------------------------------------------------------------------

drop trigger presales_immutable on public.presales;

create function app.presale_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PRESALES_IS_IMMUTABLE' using errcode = 'P0001',
      hint = 'A presale is the record of what was sold. It is superseded, never removed.';
  end if;

  -- Being superseded is the only change a presale may undergo, and only once.
  if old.superseded_by is not null then
    raise exception 'PRESALES_IS_IMMUTABLE' using errcode = 'P0001',
      hint = 'This version has already been superseded.';
  end if;

  if new.superseded_by is null or new.superseded_at is null then
    raise exception 'PRESALES_IS_IMMUTABLE' using errcode = 'P0001',
      hint = 'A presale may only be updated to mark it superseded.';
  end if;

  -- Everything else must be untouched. Comparing the rows with the two
  -- permitted columns normalised is cheaper to read, and cannot miss a column
  -- somebody adds later.
  if to_jsonb(new) - 'superseded_by' - 'superseded_at'
     is distinct from to_jsonb(old) - 'superseded_by' - 'superseded_at' then
    raise exception 'PRESALES_IS_IMMUTABLE' using errcode = 'P0001',
      hint = 'Only superseded_by and superseded_at may be set. Make a new version instead.';
  end if;

  return new;
end
$$;

create trigger presales_immutable before update or delete on public.presales
  for each row execute function app.presale_guard();

-- -----------------------------------------------------------------------------
-- 3. The current version
-- -----------------------------------------------------------------------------

create function app.presale_current(p_job_id uuid)
returns public.presales
language sql stable security definer set search_path = ''
as $$
  select * from public.presales
  where job_id = p_job_id and superseded_by is null
$$;

/** "Quote 2" - or "Quote 2 (rev 3)" once it has been corrected. */
create function app.presale_quote_label(p_presale public.presales)
returns text language sql immutable set search_path = ''
as $$
  select 'Quote ' || p_presale.quote_number
       || case when p_presale.correction_number > 1
               then ' (rev ' || p_presale.correction_number || ')' else '' end
$$;

-- -----------------------------------------------------------------------------
-- 4. Revising
-- -----------------------------------------------------------------------------

create function app.cmd_presale_revise(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_job public.jobs;
  v_mode text;
  v_reason text;
  v_current public.presales;
  v_payload jsonb := coalesce(p_request -> 'payload', '{}'::jsonb);
  v_computed jsonb;
  v_new public.presales;
  v_new_id uuid;
  v_type text;
begin
  v_job_id := nullif(btrim(p_request ->> 'job_id'), '')::uuid;
  if v_job_id is null then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;

  select * into v_job from public.jobs where id = v_job_id;
  if v_job.id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if v_job.record_class = 'HistoricalImport' then
    perform app.fail('HISTORICAL_IMPORT',
      jsonb_build_object('reason', 'An imported historical record has no presale to revise.'));
  end if;

  v_mode := coalesce(nullif(btrim(v_payload ->> 'mode'), ''), '');
  if v_mode not in ('correction', 'new_version') then
    perform app.fail('PRESALE_MODE_INVALID',
      jsonb_build_object('reason', 'mode must be correction (same quote number) or new_version (next quote number)'));
  end if;

  v_reason := nullif(btrim(v_payload ->> 'reason'), '');
  if v_reason is null then
    perform app.fail('PRESALE_REASON_REQUIRED',
      jsonb_build_object('reason', 'Say why this version exists - it is shown beside the quote.'));
  end if;

  -- Serialise concurrent revisions of the same job: two people revising at
  -- once must not both supersede the same version.
  perform pg_advisory_xact_lock(hashtextextended('presale:' || v_job_id::text, 0));

  v_current := app.presale_current(v_job_id);
  if v_current.id is null then
    perform app.fail('PRESALE_NOT_FOUND',
      jsonb_build_object('reason', 'This job has no presale to revise.'));
  end if;

  -- `computed` is the designer's own snapshot of the figures. It is required
  -- only when the figures actually change: correcting a roof note must not
  -- oblige the caller to re-send a price breakdown, but changing the design or
  -- the price without one would leave the quote's totals disagreeing with
  -- what it is selling.
  v_computed := v_payload -> 'computed';
  if v_payload ? 'design' or v_payload ? 'agreed_price_pence' then
    if v_computed is null or jsonb_typeof(v_computed) <> 'object' then
      perform app.fail('PRESALE_COMPUTED_REQUIRED',
        jsonb_build_object('reason', 'Changing the design or the price needs the recomputed totals with it.'));
    end if;
  end if;
  v_computed := coalesce(v_computed, '{}'::jsonb);

  -- The id is minted before either write, because presales_current_per_job
  -- allows exactly one unsuperseded row per job: the outgoing version has to
  -- be pointed at its replacement BEFORE the replacement exists, or the index
  -- sees two current rows for the width of a statement.
  v_new_id := gen_random_uuid();

  update public.presales
  set superseded_by = v_new_id, superseded_at = now()
  where id = v_current.id;

  insert into public.presales
    (id, job_id, surveyor_id, submitted_at, roof_notes, electrical_notes,
     design, design_schema_version, catalogue_version,
     system_kwp, net_panels, computed_total_pence, agreed_price_pence, price_breakdown,
     created_by, quote_number, correction_number, supersedes, revision_reason)
  values
    (v_new_id, v_job_id, v_current.surveyor_id, now(),
     coalesce(v_payload ->> 'roof_notes', v_current.roof_notes),
     coalesce(v_payload ->> 'electrical_notes', v_current.electrical_notes),
     coalesce(v_payload -> 'design', v_current.design),
     coalesce((v_payload ->> 'design_schema_version')::integer, v_current.design_schema_version),
     coalesce(nullif(btrim(v_payload ->> 'catalogue_version'), ''), v_current.catalogue_version),
     coalesce((v_computed ->> 'system_kwp')::numeric, v_current.system_kwp),
     coalesce((v_computed ->> 'net_panels')::integer, v_current.net_panels),
     coalesce((v_computed ->> 'computed_total_pence')::bigint, v_current.computed_total_pence),
     coalesce((v_payload ->> 'agreed_price_pence')::bigint, v_current.agreed_price_pence),
     coalesce(v_computed -> 'price_breakdown', v_current.price_breakdown),
     app.actor_id(p_actor),
     case v_mode when 'new_version' then v_current.quote_number + 1
                 else v_current.quote_number end,
     case v_mode when 'new_version' then 1
                 else v_current.correction_number + 1 end,
     v_current.id, v_reason)
  returning * into v_new;

  -- The documents of the old version keep their files and their meaning; the
  -- new version queues its own, which supersede them once they are Ready.
  foreach v_type in array app.document_types() loop
    perform app.document_enqueue(
      v_job_id, v_type,
      uuid_in(md5('presale:' || v_new.id::text || ':' || v_type)::cstring),
      'ui', app.actor_id(p_actor));
  end loop;

  perform app.audit('Presale', v_new.id::text, 'Revise',
    to_jsonb(v_current), to_jsonb(v_new));

  return jsonb_build_object(
    'presale_id', v_new.id,
    'job_id', v_job_id,
    'mode', v_mode,
    'quote_number', v_new.quote_number,
    'correction_number', v_new.correction_number,
    'quote_label', app.presale_quote_label(v_new),
    'supersedes', v_current.id,
    'agreed_price_pence', v_new.agreed_price_pence);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('PRESALE_REVISE', array['Admin', 'Manager', 'Director', 'Office', 'Surveyor'], true, '[]', 'presale',
   'Revise a job''s presale. Writes a NEW immutable version and supersedes the current one - it never edits a row. mode=correction keeps the quote number, mode=new_version increments it. Queues fresh documents for the new version.')
on conflict (command_type) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Readers that wanted "the" presale now want the current one
--
-- Both scalar reads in the codebase are replaced here. Everything else asks
-- `exists (... where job_id = ...)`, which is still true of a job with history.
-- -----------------------------------------------------------------------------

create or replace function app.document_enqueue(p_job_id uuid, p_document_type text, p_command_id uuid,
                                                p_source text, p_requested_by uuid)
returns public.document_revisions
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.jobs;
  v_presale public.presales;
  v_open public.document_revisions;
  v_next integer;
  v_row public.document_revisions;
begin
  if not p_document_type = any (app.document_types()) then
    perform app.fail('DOCUMENT_TYPE_UNKNOWN', jsonb_build_object('document_type', p_document_type));
  end if;

  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null then
    perform app.fail('DOCUMENT_JOB_NOT_FOUND');
  end if;
  if v_job.record_class = 'HistoricalImport' then
    perform app.fail('HISTORICAL_IMPORT',
      jsonb_build_object('reason', 'An imported historical job has no presale of record; no customer document can be generated for it.'));
  end if;

  -- The CURRENT version. A superseded quote keeps the documents it produced;
  -- it never generates new ones.
  v_presale := app.presale_current(p_job_id);
  if v_presale.id is null then
    perform app.fail('DOCUMENT_NO_PRESALE',
      jsonb_build_object('reason', 'This job has no presale, so there is no snapshot to generate from.'));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('document:' || p_job_id::text || ':' || p_document_type, 0));

  -- An open revision is only reusable if it is for the same presale version.
  -- A revision queued against Quote 1 must not quietly render Quote 2.
  select * into v_open from public.document_revisions
  where job_id = p_job_id and document_type = p_document_type
    and status in ('Queued', 'Generating') and presale_id = v_presale.id
  order by revision_number desc limit 1;
  if v_open.id is not null then
    return v_open;
  end if;

  -- One queued against an older version is abandoned: nobody wants it now.
  update public.document_revisions
  set status = 'Failed', error_code = 'SUPERSEDED_BEFORE_RENDER',
      error_detail = jsonb_build_object('message', 'A newer quote version replaced this one before it rendered.'),
      claimed_at = null, next_attempt = null
  where job_id = p_job_id and document_type = p_document_type
    and status in ('Queued', 'Generating') and presale_id <> v_presale.id;

  select coalesce(max(revision_number), 0) + 1 into v_next
  from public.document_revisions
  where job_id = p_job_id and document_type = p_document_type;

  insert into public.document_revisions
    (job_id, presale_id, document_type, revision_number, status, command_id, source,
     template_id, template_version, renderer_version, master_sha256,
     next_attempt, requested_by)
  values
    (p_job_id, v_presale.id, p_document_type, v_next, 'Queued', p_command_id, coalesce(p_source, 'ui'),
     case p_document_type when 'QuotationContract' then 'presale/quotation' else 'presale/roi' end,
     'pending', app.document_renderer_version(), repeat('0', 64),
     now(), p_requested_by)
  returning * into v_row;

  return v_row;
end
$$;

create or replace function public.document_backfill(p_limit integer default 25, p_job_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_presale public.presales;
  v_type text;
  v_queued integer := 0;
  v_jobs integer := 0;
begin
  for v_presale in
    select p.*
    from public.presales p
    join public.jobs j on j.id = p.job_id
    where j.record_class <> 'HistoricalImport'
      and p.superseded_by is null
      and (p_job_id is null or p.job_id = p_job_id)
      and not exists (
        select 1 from public.document_revisions r where r.job_id = p.job_id)
    order by p.submitted_at
    limit greatest(1, least(coalesce(p_limit, 25), 200))
  loop
    v_jobs := v_jobs + 1;
    foreach v_type in array app.document_types() loop
      perform app.document_enqueue(
        v_presale.job_id, v_type,
        uuid_in(md5('presale:' || v_presale.id::text || ':' || v_type)::cstring),
        'system', v_presale.created_by);
      v_queued := v_queued + 1;
    end loop;
  end loop;

  return jsonb_build_object('jobs', v_jobs, 'queued', v_queued);
end
$$;

-- app.read_job_overview took the presale id with a scalar subquery, which
-- raises the moment a job has two versions. This is that function VERBATIM -
-- extracted from 20260919149000 rather than retyped - with only the presale
-- read narrowed to the current version, and the quote label added beside it.

create or replace function app.read_job_overview(p_job public.jobs)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := app.london_date(now());
  v_booking_tasks jsonb;
  v_cancel_tasks jsonb;
  v_stages jsonb;
begin
  select coalesce(jsonb_agg(app.s17_task_view(t, v_today) order by t.due_at nulls last, t.created_at, t.id), '[]'::jsonb)
    into v_booking_tasks
  from public.tasks t
  where t.job_id = p_job.id and t.task_group in ('Booking', 'Prebooking') and t.status not in ('Cancelled', 'Complete');

  select coalesce(jsonb_agg(app.s17_task_view(t, v_today) order by t.due_at nulls last, t.created_at, t.id), '[]'::jsonb)
    into v_cancel_tasks
  from public.tasks t
  where t.job_id = p_job.id and t.task_group = 'Cancellation' and t.status not in ('Complete', 'NotRequired');

  select coalesce(jsonb_agg(jsonb_build_object(
           'stage_id', s.id, 'stage', s.stage, 'gross_pence', coalesce(s.gross_pence, 0), 'paid_pence', p.paid,
           'outstanding_pence', coalesce(s.gross_pence, 0) - p.paid, 'due_date', s.due_date, 'status', s.status,
           'xero_invoice_id', s.xero_invoice_id) order by s.due_date nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_stages
  from public.invoice_stages s
  cross join lateral (select coalesce(sum(pay.amount_pence), 0)::bigint as paid
                      from public.payments pay where pay.invoice_stage_id = s.id) p
  where s.job_id = p_job.id;

  return jsonb_build_object(
    'found', true,
    'identity', jsonb_build_object(
      'id', p_job.id, 'job_ref', p_job.job_ref, 'display_name', p_job.display_name, 'customer_id', p_job.customer_id,
      'workflow_stage', p_job.workflow_stage, 'salesperson_id', p_job.salesperson_id,
      'financial_status', p_job.financial_status, 'handover_status', p_job.handover_status, 'version', p_job.version),
    'booking', jsonb_build_object(
      -- The sold document is the Job Sold presale (no jobs.sold_submission_id).
      'presale_id', (select ps.id from public.presales ps
                     where ps.job_id = p_job.id and ps.superseded_by is null),
      'quote_label', (select app.presale_quote_label(ps) from public.presales ps
                      where ps.job_id = p_job.id and ps.superseded_by is null),
      'booking_submission_id', p_job.booking_submission_id,
      'booking_approved_at', app.london_date(p_job.booking_approved_at), 'booking_approved_by', p_job.booking_approved_by,
      'sold_booking_match_status', p_job.sold_booking_match_status,
      'outstanding_tasks', jsonb_array_length(v_booking_tasks), 'tasks', v_booking_tasks),
    'work', jsonb_build_object(
      'roof_required', p_job.roof_required, 'electrical_required', p_job.electrical_required,
      'scaffold_required', p_job.scaffold_required,
      'packages', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', w.id, 'trade', w.trade, 'status', w.status, 'planned_start', w.planned_start,
                     'planned_end', w.planned_end, 'commissioning_required', w.commissioning_required,
                     'actual_start', w.actual_start, 'actual_end', w.actual_end, 'version', w.version)
                     order by w.sequence nulls last, w.created_at, w.id), '[]'::jsonb)
                   from public.work_packages w where w.job_id = p_job.id),
      'allocations', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', a.id, 'work_package_id', a.work_package_id, 'person_id', a.person_id,
                        'person_name', app.s17_person_name(a.person_id), 'role', a.role,
                        'start_at', a.start_at, 'end_at', a.end_at) order by a.start_at nulls last, a.id), '[]'::jsonb)
                      from public.allocations a join public.work_packages w on w.id = a.work_package_id
                      where w.job_id = p_job.id and a.active),
      'calls_count', (select count(*) from public.calls c where c.job_id = p_job.id),
      'unresolved_issues', (select count(*) from public.issues i
                            where i.job_id = p_job.id and i.status not in ('Resolved', 'Closed')),
      'operational_complete_at', app.london_date(p_job.operational_complete_at),
      'customer_happy_at', app.london_date(p_job.customer_happy_at)),
    'materials', jsonb_build_object(
      'materials_count', (select count(*) from public.materials m where m.job_id = p_job.id),
      'required_quantity', (select coalesce(sum(m.required_quantity), 0) from public.materials m where m.job_id = p_job.id),
      'cancelled_quantity', (select coalesce(sum(m.cancelled_quantity), 0) from public.materials m where m.job_id = p_job.id),
      'active_reservations', (select count(*) from public.reservations r join public.materials m on m.id = r.material_id
                              where m.job_id = p_job.id and r.status = 'Active'),
      'orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'merchant_id', o.merchant_id,
                                                              'supplier_reference', o.supplier_reference)
                                           order by o.created_at, o.id), '[]'::jsonb)
                 from public.orders o where o.job_id = p_job.id)),
    'scaffold', jsonb_build_object(
      'scaffold_required', p_job.scaffold_required,
      'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', b.id, 'status', b.status, 'erect_planned_at', b.erect_planned_at,
                     'erect_actual_at', b.erect_actual_at, 'strip_actual_at', b.strip_actual_at,
                     'company_id', b.company_id) order by b.created_at, b.id), '[]'::jsonb)
                   from public.scaffold_bookings b where b.job_id = p_job.id)),
    'commissioning', jsonb_build_object(
      'submissions', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', s.id, 'status', s.status, 'submitted_at', app.london_date(s.submitted_at),
                        'reviewed_at', app.london_date(s.reviewed_at), 'installer_id', s.installer_id,
                        'work_package_id', s.work_package_id) order by s.created_at, s.id), '[]'::jsonb)
                      from public.commissioning_submissions s where s.job_id = p_job.id),
      'equipment_count', (select count(*) from public.job_equipment e where e.job_id = p_job.id),
      'needs_review', exists (select 1 from public.commissioning_submissions s
                              where s.job_id = p_job.id and s.status = 'Submitted')),
    'handover', jsonb_build_object(
      'status', p_job.handover_status,
      -- The ported handover table has completeness_status (no status column).
      'records', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'sent_at', app.london_date(h.sent_at),
                                                               'status', h.completeness_status)
                                            order by h.created_at, h.id), '[]'::jsonb)
                  from public.handover h where h.job_id = p_job.id)),
    'finance', jsonb_build_object(
      'original_gross_pence', coalesce(nullif(p_job.original_gross_pence, 0), p_job.current_contract_gross_pence, 0),
      'deposit_confirmed', p_job.deposit_bank_confirmed_at is not null,
      'deposit_confirmed_at', app.london_date(p_job.deposit_bank_confirmed_at),
      'deposit_confirmed_by', p_job.deposit_bank_confirmed_by,
      'finance_route', p_job.finance_route, 'contract_status', p_job.contract_status,
      'stages', v_stages,
      'total_invoiced', (select coalesce(sum((x ->> 'gross_pence')::bigint), 0) from jsonb_array_elements(v_stages) x),
      'total_paid', (select coalesce(sum((x ->> 'paid_pence')::bigint), 0) from jsonb_array_elements(v_stages) x),
      'total_outstanding', (select coalesce(sum((x ->> 'outstanding_pence')::bigint), 0) from jsonb_array_elements(v_stages) x)),
    'crm', jsonb_build_object(
      'ghl_tasks', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', g.id, 'task_id', g.task_id, 'opportunity_id', g.opportunity_id,
                      'target_pipeline_id', g.target_pipeline_id, 'completed_at', app.london_date(g.completed_at))
                      order by g.created_at, g.id), '[]'::jsonb)
                    from public.ghl_tasks g where g.job_id = p_job.id)),
    'cancellation', jsonb_build_object(
      'is_cancelled', p_job.workflow_stage in ('CancellationInProgress', 'Cancelled'),
      'cancellation_at', app.london_date(p_job.cancellation_at), 'cancellation_by', p_job.cancellation_by,
      'cancellation_reason', p_job.cancellation_reason,
      'open_review_tasks', jsonb_array_length(v_cancel_tasks), 'tasks', v_cancel_tasks),
    'archive', jsonb_build_object('archived_at', app.london_date(p_job.archived_at)),
    'system', jsonb_build_object(
      'pending_outbox', (select count(*) from public.outbox o
                         where o.status not in ('Succeeded', 'Cancelled')
                           and o.correlation_id in (p_job.id::text, 'XI-' || p_job.id || '-deposit',
                                                    'XI-' || p_job.id || '-interim', 'XI-' || p_job.id || '-final')),
      'audit_events', (select count(*) from public.audit_events a where a.entity_id = p_job.id::text)));
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Reading the history
-- -----------------------------------------------------------------------------

create function app.read_presale_versions(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_job public.jobs;
  v_rows jsonb;
begin
  v_job_id := nullif(btrim(p_request ->> 'job_id'), '')::uuid;
  if v_job_id is null then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  select * into v_job from public.jobs where id = v_job_id;
  if v_job.id is null or not app.can_read_job(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_NOT_VISIBLE');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'presale_id', p.id,
    'quote_number', p.quote_number,
    'correction_number', p.correction_number,
    'quote_label', app.presale_quote_label(p),
    'is_current', p.superseded_by is null,
    'submitted_at', p.submitted_at,
    'system_kwp', p.system_kwp,
    'net_panels', p.net_panels,
    'agreed_price_pence', p.agreed_price_pence,
    'revision_reason', p.revision_reason,
    'superseded_at', p.superseded_at,
    'surveyor', (select display_name from public.people where id = p.created_by))
    order by p.quote_number desc, p.correction_number desc), '[]'::jsonb)
  into v_rows
  from public.presales p where p.job_id = v_job_id;

  return jsonb_build_object('job_id', v_job_id, 'versions', v_rows);
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('PRESALE_VERSIONS', array['Admin', 'Manager', 'Director', 'Office', 'Surveyor', 'Finance'], '[]', 'presale',
   'Every quote version of one job, newest first, with which is current and why each exists.')
on conflict (read_type) do nothing;
