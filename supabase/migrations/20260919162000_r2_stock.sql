-- =============================================================================
-- Backend port, R2 stock (FN-05; goods-in also FN-03).
--
-- Sources (reference D:\projets\simple-solar-operations):
--   materials/workflow.js  _matReceiveDelivery (goods-in), _matStockBalance,
--                          _matQuarantineStock, MAT03/MAT04 task rules
--   r1-appsheet/operations-contract.js  GOODS_IN_RECEIVE, STOCK_QUARANTINE,
--                          GOODS_IN_DETAIL / STOCK_BALANCE reads, R1C_* boundary codes
--   s08/picking.js         ledger availability, deterministic pick keys
--   REF-04 §1.2            stock/workflow.js (_stkOpeningCount, _stkReserve,
--                          _stkPick, _stkIssue, stocktakes). That file is not in
--                          the local reference checkout; its rules are ported
--                          from the survey table (codes STK_*).
--
-- Commands (app.command_registry):
--   GOODS_IN_RECEIVE     Store/Office/Manager/Admin   FN-03 + FN-05
--   STOCK_QUARANTINE     Store/Manager/Admin          FN-05
--   STOCK_OPENING_COUNT  Store/Manager/Admin          FN-05
--   STOCK_RESERVE        Store/Office/Manager/Admin   FN-05
--   STOCK_PICK           Store/Office/Manager/Admin   FN-05
--   STOCK_ISSUE          Store/Office/Manager/Admin   FN-05
--   STOCKTAKE_START      Store/Manager/Admin          FN-05
--   STOCKTAKE_COUNT      Store/Manager/Admin          FN-05
--   STOCKTAKE_APPROVE    Store/Manager/Admin          FN-05
-- Reads (app.read_registry, public.execute_operations_read):
--   GOODS_IN_DETAIL      Store/Office/Manager/Admin   FN-03 + FN-05
--   STOCK_BALANCE        Store/Manager/Admin          FN-05
--   STOCK_JOB_PICKING    Store/Office/Manager/Admin   FN-05
--
-- Stock balances are never stored: balance(location) = sum(qty in) - sum(qty
-- out) over public.stock_movements (append-only); available = store balance -
-- active reservations. Fixed locations LOC-store / LOC-quarantine /
-- LOC-external are replaced by configuration: settings
-- stock.store_location_id / stock.quarantine_location_id /
-- stock.supplier_location_id, else exactly one stock_locations row of type
-- Store / Quarantine / Supplier (job_id null). Anything else fails visibly
-- (STOCK_CONFIG: ...). Job-site locations (type JobSite) are created on demand,
-- one per job (reference LOC-site-<job>).
--
-- Deviations:
--   * Delivery-note evidence is a Supabase Storage path (payload
--     delivery_note_path) instead of Drive file id + filename.
--   * received_by is the authenticated actor (the boundary already forced this,
--     operations-contract.js:377).
--   * Supply issues get their office owner from the ISS02 assignment rule, not
--     "first Office person / name contains tanya" (REF-04 §0 owner resolution).
--   * A re-reservation after an issue creates a new reservation row instead of
--     re-activating RES-STK-<material> (which would reuse the issue movement
--     key ISSUE-<reservation>; REF-04 §8 Q11). At most one Active per material.
--   * S08 legacy executePick (flip material.source to AlreadyOrdered, one
--     S08-PICK-STOCK task owned by PERSON-tanya) is superseded by the
--     reserve/pick/issue model and MAT03 (REF-04 §7 "legacy s07/s08/s09
--     coexist"); its availability evaluation is the STOCK_JOB_PICKING read.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ported-table adjustments
-- -----------------------------------------------------------------------------

-- The reference raises goods-in discrepancies as Issues type 'Supply'
-- (materials/workflow.js:514), outside the schema's Variation/Remedial/Complaint.
alter table public.issues drop constraint issues_type_check;
alter table public.issues add constraint issues_type_check
  check (type in ('Variation', 'Remedial', 'Complaint', 'Supply'));

-- Stocktake lines exist from the start (every active stock-tracked product,
-- stock/workflow.js per REF-04 §1.2) and are counted later, so the count and
-- variance are null until counted. count_basis records whether the count is
-- against the cut-off ledger (AtCutOff) or the ledger at count time (AtCount,
-- in which case expected_quantity_at_cutoff holds the balance at count time).
alter table public.stocktake_lines alter column counted_quantity drop not null;
alter table public.stocktake_lines alter column variance drop not null;
alter table public.stocktake_lines
  add column count_basis text check (count_basis in ('AtCutOff', 'AtCount')),
  add column counted_at  timestamptz,
  add column counted_by  uuid references public.people (id);

-- Natural keys replacing the reference's deterministic ids.
create unique index receipt_lines_delivery_line_key on public.receipt_lines (delivery_id, order_line_id); -- RL-<delivery>-<line>
create unique index reservations_active_material_key on public.reservations (material_id) where status = 'Active';
create unique index stock_locations_job_site_key on public.stock_locations (job_id) where type = 'JobSite';
create unique index stocktakes_open_location_key on public.stocktakes (location_id) where status <> 'Approved';

-- Stocktake variance follow-up (module default code, not seeded in the reference).
insert into public.task_templates (code, title, task_group, default_priority, due_rule, guidance, template_version) values
  ('STK-COUNT', 'Investigate stocktake variance', 'Materials', 1, 'none',
   'Explain each non-zero stocktake variance before approval', '1.0')
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Envelope keys a stock command may not carry (reference _r1cKeys + explicit
-- work_package_id / job_id refusals).
create function app.stock_envelope(p_request jsonb, p_job_allowed boolean)
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  foreach v_key in array array['task_id', 'issue_id', 'work_package_id', 'old_allocation_id'] loop
    if nullif(btrim(p_request ->> v_key), '') is not null then
      perform app.fail('R1C_INVALID_FIELDS');
    end if;
  end loop;
  if not p_job_allowed and nullif(btrim(p_request ->> 'job_id'), '') is not null then
    perform app.fail('R1C_INVALID_FIELDS');
  end if;
end
$$;

-- Payload allow-list (reference _r1cKeys -> R1C_INVALID_FIELDS).
create function app.stock_payload(p_value jsonb, p_allowed text[])
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb := coalesce(p_value, '{}'::jsonb);
  v_key text;
begin
  if jsonb_typeof(v) <> 'object' then
    perform app.fail('R1C_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(v) loop
    if not v_key = any (p_allowed) then
      perform app.fail('R1C_INVALID_FIELDS');
    end if;
  end loop;
  return v;
end
$$;

-- expected_version: positive safe integer or digit string (_r1cVersion).
create function app.stock_expected_version(p_request jsonb)
returns int
language plpgsql immutable
set search_path = ''
as $$
declare
  v jsonb := p_request -> 'expected_version';
begin
  if v is not null and jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^[1-9][0-9]{0,8}$' then
    return (v #>> '{}')::int;
  end if;
  if v is not null and jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[1-9][0-9]{0,8}$' then
    return (v #>> '{}')::int;
  end if;
  perform app.fail('R1C_EXPECTED_VERSION_REQUIRED');
end
$$;

-- A uuid from a payload value, or null when absent/blank/not a uuid.
create function app.stock_uuid(p_value jsonb)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case when p_value is not null and jsonb_typeof(p_value) = 'string'
                   and btrim(p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then btrim(p_value #>> '{}')::uuid end
$$;

-- A stock quantity: JSON number, >= 0 (or > 0), at most 3 decimals
-- (stock/workflow.js:35-39 per REF-04 §1.2). Null when absent.
create function app.stock_qty(p_value jsonb, p_code text, p_positive boolean default true)
returns numeric
language plpgsql immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' then
    perform app.fail(p_code);
  end if;
  v := (p_value #>> '{}')::numeric;
  if v < 0 or (p_positive and v = 0) or v <> round(v, 3) then
    perform app.fail(p_code);
  end if;
  return v;
end
$$;

-- Office hours boundary ('start' | 'end') from settings office.hours.
create function app.stock_office_time(p_which text)
returns time
language plpgsql stable
set search_path = ''
as $$
declare
  v jsonb := app.setting('office.hours');
begin
  if v is not null and jsonb_typeof(v) = 'string' then
    v := (v #>> '{}')::jsonb;
  end if;
  if v is not null and (v ->> p_which) ~ '^[0-9]{2}:[0-9]{2}$' then
    return (v ->> p_which)::time;
  end if;
  return case when p_which = 'start' then time '09:00' else time '17:00' end;
end
$$;

-- Configured stock location of a type (Store / Quarantine / Supplier).
-- Replaces the reference's LOC-store / LOC-quarantine / LOC-external.
create function app.stock_location(p_type text)
returns public.stock_locations
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_key text := 'stock.' || lower(p_type) || '_location_id';
  v_setting jsonb := app.setting(v_key);
  v_loc public.stock_locations;
  v_n int;
begin
  if v_setting is not null and jsonb_typeof(v_setting) <> 'null' then
    select * into v_loc from public.stock_locations
    where id::text = btrim(v_setting #>> '{}') and type = p_type and job_id is null;
    if not found then
      perform app.fail('STOCK_CONFIG: ' || v_key || ' must name a ' || p_type || ' location');
    end if;
  else
    select count(*) into v_n from public.stock_locations where type = p_type and job_id is null;
    if v_n <> 1 then
      perform app.fail('STOCK_CONFIG: exactly one ' || p_type || ' location required (or set ' || v_key || ')');
    end if;
    select * into v_loc from public.stock_locations where type = p_type and job_id is null;
  end if;
  if p_type = 'Store' and not v_loc.usable then
    perform app.fail('STOCK_CONFIG: store location must be usable');
  end if;
  if p_type = 'Quarantine' and v_loc.usable then
    perform app.fail('STOCK_CONFIG: quarantine location must not be usable');
  end if;
  return v_loc;
end
$$;

-- The job's site location (created on demand; reference LOC-site-<job>).
create function app.stock_site_location(p_job_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.stock_locations where type = 'JobSite' and job_id = p_job_id;
  if v_id is null then
    insert into public.stock_locations (name, type, job_id, usable)
    select 'Site ' || j.job_ref, 'JobSite', j.id, false from public.jobs j where j.id = p_job_id
    on conflict (job_id) where type = 'JobSite' do nothing;
    select id into v_id from public.stock_locations where type = 'JobSite' and job_id = p_job_id;
  end if;
  return v_id;
end
$$;

-- Ledger balance of a product at a location, optionally as at an instant.
create function app.stock_balance(p_product_id uuid, p_location_id uuid, p_as_at timestamptz default null)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(case when m.to_location_id = p_location_id then m.quantity else 0 end)
                - sum(case when m.from_location_id = p_location_id then m.quantity else 0 end), 0)
  from public.stock_movements m
  where m.product_id = p_product_id
    and (m.to_location_id = p_location_id or m.from_location_id = p_location_id)
    and (p_as_at is null or m.movement_at <= p_as_at)
$$;

create function app.stock_reserved(p_product_id uuid, p_location_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(r.quantity), 0) from public.reservations r
  where r.product_id = p_product_id and r.location_id = p_location_id and r.status = 'Active'
$$;

-- available = store balance - active reservations (quarantine never counts).
create function app.stock_available(p_product_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select app.stock_balance(p_product_id, (app.stock_location('Store')).id)
       - app.stock_reserved(p_product_id, (app.stock_location('Store')).id)
$$;

-- Quantity already issued to site for a material requirement.
create function app.stock_material_issued(p_material_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(m.quantity), 0)
  from public.reservations r
  join public.stock_movements m on m.idempotency_key = 'ISSUE-' || r.id::text
  where r.material_id = p_material_id
$$;

-- Received good/damaged for an order line (_matReceivedForLine).
create function app.stock_line_received(p_order_line_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(r.quantity_good + r.quantity_damaged), 0)
  from public.receipt_lines r where r.order_line_id = p_order_line_id
$$;

-- Stock-tracked, active product (R1C_STOCK_PRODUCT_REQUIRED), locked (the
-- reference "pins" the product so concurrent quantity commands serialise).
create function app.stock_product(p_value jsonb)
returns public.products
language plpgsql security definer
set search_path = ''
as $$
declare
  v_product public.products;
  v_id uuid := app.stock_uuid(p_value);
begin
  if v_id is not null then
    select * into v_product from public.products where id = v_id for update;
  end if;
  if v_product.id is null or not v_product.active or not v_product.stock_tracked then
    perform app.fail('R1C_STOCK_PRODUCT_REQUIRED');
  end if;
  return v_product;
end
$$;

-- Bump the product version (reference pins Products on every quantity command).
create function app.stock_pin_product(p_product_id uuid)
returns int
language sql security definer
set search_path = ''
as $$
  update public.products set updated_at = now() where id = p_product_id returning version
$$;

-- Job accepts stock work: not archived / cancelling / cancelled / in reopen
-- review (reference _r1cJob -> R1C_JOB_NOT_ACTIONABLE).
create function app.stock_job_actionable(p_job_id uuid)
returns public.jobs
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.job_actionable(v_job) or v_job.cancellation_at is not null
     or exists (select 1 from public.tasks t where t.job_id = p_job_id and t.template_code = 'S15-REOPEN-REVIEW'
                and t.status not in ('Complete', 'NotRequired')) then
    perform app.fail('R1C_JOB_NOT_ACTIONABLE');
  end if;
  return v_job;
end
$$;

-- Complete the open tasks of a template for an entity (_matCompleteTasks).
-- Matched by related entity or by the reference instance key <CODE>-<id>, so
-- tasks created by the materials module are found whatever entity label it used.
create function app.stock_complete_tasks(p_template_code text, p_entity_id uuid, p_note text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_after public.tasks;
  v_done jsonb := '[]'::jsonb;
begin
  for v_task in
    select * from public.tasks t
    where t.template_code = p_template_code
      and (t.related_entity_id = p_entity_id or t.instance_key = p_template_code || '-' || p_entity_id::text)
      and t.status not in ('Complete', 'Cancelled', 'NotRequired')
    order by t.created_at
    for update
  loop
    update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.context_actor_id(),
                            completion_note = p_note, blocking_reason = null
    where id = v_task.id returning * into v_after;
    perform app.task_event(v_task, v_after, 'Complete', p_note);
    perform app.audit('Tasks', v_task.id::text, 'Complete', to_jsonb(v_task), to_jsonb(v_after), p_note);
    v_done := v_done || to_jsonb(v_task.id);
  end loop;
  return v_done;
end
$$;

-- Insert one ledger movement (quantity > 0; idempotency key unique).
create function app.stock_move(p_product_id uuid, p_quantity numeric, p_from uuid, p_to uuid, p_type text,
                               p_key text, p_job_id uuid default null, p_reason text default null,
                               p_receipt_line_id uuid default null, p_evidence_id uuid default null,
                               p_id uuid default null)
returns public.stock_movements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_mov public.stock_movements;
begin
  if exists (select 1 from public.stock_movements m where m.idempotency_key = p_key) then
    perform app.fail('STK_REVIEW: movement already recorded', jsonb_build_object('idempotency_key', p_key));
  end if;
  insert into public.stock_movements (id, product_id, quantity, from_location_id, to_location_id, movement_type,
                                      job_id, receipt_line_id, reason, evidence_id, movement_at, idempotency_key)
  values (coalesce(p_id, gen_random_uuid()), p_product_id, p_quantity, p_from, p_to, p_type,
          p_job_id, p_receipt_line_id, p_reason, p_evidence_id, now(), p_key)
  returning * into v_mov;
  return v_mov;
end
$$;

-- -----------------------------------------------------------------------------
-- GOODS_IN_RECEIVE (operations-contract.js GOODS_IN_RECEIVE -> _matReceiveDelivery)
-- Good -> store, damaged -> quarantine (stock-tracked products only); short
-- and damaged raise separate Supply issues; incomplete orders get a follow-up
-- delivery and MAT04.
-- -----------------------------------------------------------------------------

create function app.cmd_goods_in_receive(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_version int;
  v_delivery_id uuid;
  v_delivery public.deliveries;
  v_delivery_after public.deliveries;
  v_order public.orders;
  v_order_after public.orders;
  v_job public.jobs;
  v_store public.stock_locations;
  v_quarantine public.stock_locations;
  v_supplier public.stock_locations;
  v_note_ref text;
  v_evidence uuid;
  v_line jsonb;
  v_lines jsonb;
  v_norm jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_key text;
  v_q text;
  v_good numeric;
  v_damaged numeric;
  v_short numeric;
  v_ol public.order_lines;
  v_ol_id uuid;
  v_product public.products;
  v_line_ev uuid;
  v_rl_id uuid;
  v_good_id uuid;
  v_dmg_id uuid;
  v_mov_ids uuid[];
  v_rl_ids jsonb := '[]'::jsonb;
  v_movs jsonb := '[]'::jsonb;
  v_findings jsonb := '[]'::jsonb;
  v_short_list jsonb := '[]'::jsonb;
  v_issue_ids jsonb := '[]'::jsonb;
  v_f jsonb;
  v_issue public.issues;
  v_complete boolean;
  v_status text;
  v_disc text;
  v_completed jsonb;
  v_next public.deliveries;
  v_follow uuid;
  v_title text;
  v_issue_owner uuid;
begin
  -- Boundary (_r1cExecute / _r1cAccess / _r1cValidate).
  perform app.stock_envelope(p_request, true);
  v_p := app.stock_payload(p_request -> 'payload',
           array['delivery_id', 'delivery_note_reference', 'delivery_note_path', 'discrepancy_note', 'lines']);
  v_version := app.stock_expected_version(p_request);
  v_delivery_id := app.stock_uuid(v_p -> 'delivery_id');
  if v_delivery_id is not null then
    select * into v_delivery from public.deliveries where id = v_delivery_id for update;
  end if;
  if v_delivery.id is null then
    perform app.fail('R1C_DELIVERY_NOT_FOUND');
  end if;
  select * into v_order from public.orders where id = v_delivery.order_id for update;
  if not found then
    perform app.fail('R1C_ORDER_NOT_FOUND');
  end if;
  v_job := app.stock_job_actionable(v_order.job_id);
  if app.ref(p_request, 'job_id') is distinct from v_job.id then
    perform app.fail('R1C_JOB_MISMATCH');
  end if;
  if v_order.version <> v_version then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_lines := v_p -> 'lines';
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    perform app.fail('R1C_RECEIPT_LINES_REQUIRED');
  end if;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    perform app.stock_payload(v_line, array['order_line_id', 'quantity_good', 'quantity_damaged', 'quantity_short', 'evidence_id']);
    if coalesce(v_line ->> 'order_line_id', '') = any (v_seen) then
      perform app.fail('R1C_DUPLICATE_RECEIPT_LINE');
    end if;
    v_seen := v_seen || coalesce(v_line ->> 'order_line_id', '');
    foreach v_q in array array['quantity_good', 'quantity_damaged', 'quantity_short'] loop
      if v_line -> v_q is not null and (jsonb_typeof(v_line -> v_q) <> 'number' or (v_line ->> v_q)::numeric < 0) then
        perform app.fail('R1C_INVALID_QUANTITY');
      end if;
    end loop;
    if nullif(btrim(v_line ->> 'evidence_id'), '') is not null then
      perform app.job_evidence(v_job.id, v_line ->> 'evidence_id', 'R1C_CROSS_JOB_EVIDENCE');
    end if;
  end loop;

  -- Workflow (_matReceiveDelivery).
  v_note_ref := app.txt(v_p, 'delivery_note_reference');
  if v_note_ref is null then
    perform app.fail('MAT_REVIEW: delivery_note_reference required');
  end if;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_good := coalesce((v_line ->> 'quantity_good')::numeric, 0);
    v_damaged := coalesce((v_line ->> 'quantity_damaged')::numeric, 0);
    v_short := coalesce((v_line ->> 'quantity_short')::numeric, 0);
    if v_good + v_damaged + v_short = 0 then
      perform app.fail('MAT_REVIEW: receipt quantities must be >= 0 and not all zero');
    end if;
  end loop;
  if v_delivery.actual_received_at is not null then
    perform app.fail('MAT_REVIEW: delivery already received; record a further delivery instead');
  end if;
  if v_order.status not in ('Confirmed', 'PartReceived', 'Requested') then
    perform app.fail('MAT_REVIEW: order status ' || v_order.status || ' cannot receive');
  end if;
  perform app.assert_normal_work(v_job.id);
  v_store := app.stock_location('Store');
  v_quarantine := app.stock_location('Quarantine');
  v_supplier := app.stock_location('Supplier');
  if app.txt(v_p, 'delivery_note_path') is not null then
    v_evidence := app.ensure_evidence(v_job.id, 'DeliveryNote', app.txt(v_p, 'delivery_note_path'));
  end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_good := coalesce((v_line ->> 'quantity_good')::numeric, 0);
    v_damaged := coalesce((v_line ->> 'quantity_damaged')::numeric, 0);
    v_short := coalesce((v_line ->> 'quantity_short')::numeric, 0);
    v_ol_id := app.stock_uuid(v_line -> 'order_line_id');
    v_ol := null;
    if v_ol_id is not null then
      select * into v_ol from public.order_lines where id = v_ol_id;
    end if;
    if v_ol.id is null or v_ol.order_id <> v_order.id then
      perform app.fail('MAT_REVIEW: order line linkage invalid', jsonb_build_object('order_line_id', v_line ->> 'order_line_id'));
    end if;
    if v_good + v_damaged + v_short > v_ol.quantity - v_ol.cancelled_quantity - app.stock_line_received(v_ol.id) then
      perform app.fail('MAT_REVIEW: receipt exceeds outstanding quantity', jsonb_build_object('order_line_id', v_ol.id));
    end if;
    v_line_ev := case when nullif(btrim(v_line ->> 'evidence_id'), '') is not null
                      then app.job_evidence(v_job.id, v_line ->> 'evidence_id', 'R1C_CROSS_JOB_EVIDENCE') end;
    v_rl_id := gen_random_uuid();
    v_mov_ids := '{}';
    v_product := null;
    if v_ol.product_id is not null then
      select * into v_product from public.products where id = v_ol.product_id;
    end if;
    v_good_id := case when v_product.stock_tracked and v_good > 0 then gen_random_uuid() end;
    v_dmg_id := case when v_product.stock_tracked and v_damaged > 0 then gen_random_uuid() end;
    if v_good_id is not null then v_mov_ids := v_mov_ids || v_good_id; end if;
    if v_dmg_id is not null then v_mov_ids := v_mov_ids || v_dmg_id; end if;
    insert into public.receipt_lines (id, delivery_id, order_line_id, quantity_good, quantity_damaged, evidence_id,
                                      stock_movement_ids)
    values (v_rl_id, v_delivery.id, v_ol.id, v_good, v_damaged, coalesce(v_line_ev, v_evidence),
            nullif(v_mov_ids, '{}'));
    v_rl_ids := v_rl_ids || to_jsonb(v_rl_id);
    if v_good_id is not null then
      perform app.stock_move(v_product.id, v_good, v_supplier.id, v_store.id, 'Receipt',
                             'MOV-RCPT-' || v_rl_id || '-GOOD', v_job.id, 'Receipt ' || v_note_ref,
                             v_rl_id, coalesce(v_line_ev, v_evidence), v_good_id);
      v_movs := v_movs || jsonb_build_object('movement_id', v_good_id, 'product_id', v_product.id,
                                             'quantity', v_good, 'to', v_store.id);
    end if;
    if v_dmg_id is not null then
      perform app.stock_move(v_product.id, v_damaged, v_supplier.id, v_quarantine.id, 'Damage',
                             'MOV-RCPT-' || v_rl_id || '-DMG', v_job.id, 'Damaged on receipt ' || v_note_ref,
                             v_rl_id, coalesce(v_line_ev, v_evidence), v_dmg_id);
      v_movs := v_movs || jsonb_build_object('movement_id', v_dmg_id, 'product_id', v_product.id,
                                             'quantity', v_damaged, 'to', v_quarantine.id);
    end if;
    if v_damaged > 0 then
      v_findings := v_findings || jsonb_build_object('kind', 'DamagedGoods', 'quantity', v_damaged, 'line_id', v_ol.id,
                                                     'unit', v_ol.unit, 'description', v_ol.description_snapshot);
    end if;
    if v_short > 0 then
      v_short_list := v_short_list || jsonb_build_object('order_line_id', v_ol.id, 'short_by', v_short);
    end if;
  end loop;
  -- Short findings follow damaged ones (materials/workflow.js:509).
  for v_f in select * from jsonb_array_elements(v_short_list) loop
    select * into v_ol from public.order_lines where id = (v_f ->> 'order_line_id')::uuid;
    v_findings := v_findings || jsonb_build_object('kind', 'ShortDelivery', 'quantity', v_f -> 'short_by', 'line_id', v_ol.id,
                                                   'unit', v_ol.unit, 'description', v_ol.description_snapshot);
  end loop;

  select bool_and(app.stock_line_received(l.id) >= l.quantity - l.cancelled_quantity) into v_complete
  from public.order_lines l where l.order_id = v_order.id;
  v_complete := coalesce(v_complete, true);

  if jsonb_array_length(v_findings) > 0 then
    v_issue_owner := app.rule_owner('ISS02');
  end if;
  for v_f in select * from jsonb_array_elements(v_findings) loop
    insert into public.issues (job_id, type, category, description, raised_at, raised_by, responsible_company_id,
                               office_owner_id, severity, status, due_at, blocks_completion, blocks_strip, approval_status)
    values (v_job.id, 'Supply', v_f ->> 'kind',
            (v_f ->> 'kind') || ': ' || (v_f ->> 'quantity') || ' ' || coalesce(v_f ->> 'unit', '') || ' of '
              || (v_f ->> 'description') || ' on delivery ' || v_note_ref,
            now(), app.actor_id(p_actor), v_order.merchant_id, v_issue_owner, 'Normal', 'Open',
            app.london_at(app.next_staffed_date(now()), app.stock_office_time('start')), false, false, 'NotRequired')
    returning * into v_issue;
    insert into public.issue_events (issue_id, event_type, actor, occurred_at, note, previous_status, new_status)
    values (v_issue.id, 'Opened', app.actor_id(p_actor), now(), v_issue.description, null, 'Open');
    perform app.audit('Issues', v_issue.id::text, 'Create', null, to_jsonb(v_issue), v_issue.category);
    v_issue_ids := v_issue_ids || to_jsonb(v_issue.id);
  end loop;

  v_status := case when jsonb_array_length(v_findings) > 0 then 'Discrepancy'
                   when v_complete then 'Received' else 'Partial' end;
  if jsonb_array_length(v_findings) > 0 then
    select coalesce(app.txt(v_p, 'discrepancy_note'),
                    string_agg((f ->> 'kind') || ' ' || (f ->> 'quantity') || ' on ' || (f ->> 'line_id'), '; '))
      into v_disc from jsonb_array_elements(v_findings) f;
  else
    v_disc := app.txt(v_p, 'discrepancy_note');
  end if;
  update public.deliveries set actual_received_at = now(), received_by = app.actor_id(p_actor),
                               delivery_note_reference = v_note_ref, receipt_status = v_status, discrepancy_note = v_disc
  where id = v_delivery.id returning * into v_delivery_after;
  update public.orders set status = case when v_complete then 'Received' else 'PartReceived' end
  where id = v_order.id returning * into v_order_after;
  v_completed := app.stock_complete_tasks('MAT04', v_delivery.id,
    'Received ' || v_note_ref || case when jsonb_array_length(v_findings) > 0 then ' with discrepancies (see issues)' else '' end);

  if not v_complete then
    insert into public.deliveries (order_id, expected_date, receipt_status, discrepancy_note)
    values (v_order.id, v_order.requested_delivery_date, 'Expected', 'Balance of order outstanding')
    returning * into v_next;
    select title into v_title from public.task_templates where code = 'MAT04';
    v_follow := app.create_task_instance(v_job.id, 'MAT04', 'MAT04-' || v_next.id, null, null,
      app.london_at(app.next_staffed_date(now()), app.stock_office_time('end')), null,
      v_title || ' — balance of order ' || coalesce(v_order.supplier_reference, v_order.id::text), null,
      'Deliveries', v_next.id);
  end if;

  perform app.audit('Deliveries', v_delivery.id::text, 'Receive', to_jsonb(v_delivery), to_jsonb(v_delivery_after), v_disc);
  perform app.audit('Orders', v_order.id::text, 'GOODS_IN_RECEIVE', to_jsonb(v_order), to_jsonb(v_order_after), v_note_ref);

  return jsonb_build_object(
    'status', v_status, 'delivery', to_jsonb(v_delivery_after), 'order', to_jsonb(v_order_after),
    'receipt_lines', v_rl_ids, 'stock_movements', v_movs, 'issues', v_issue_ids, 'short', v_short_list,
    'complete', v_complete, 'completed_tasks', v_completed, 'follow_up_delivery_id', v_next.id,
    'follow_up_task', v_follow, 'evidence_id', v_evidence, 'expected_version', v_order_after.version,
    'replay', false, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- STOCK_QUARANTINE (_matQuarantineStock): one-way usable store -> quarantine;
-- never release/dispose/adjust. expected_balance must equal the store balance.
-- -----------------------------------------------------------------------------

create function app.cmd_stock_quarantine(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_version int;
  v_product public.products;
  v_store public.stock_locations;
  v_quarantine public.stock_locations;
  v_qty numeric;
  v_reason text;
  v_evidence uuid;
  v_balance numeric;
  v_mov public.stock_movements;
  v_pinned int;
begin
  perform app.stock_envelope(p_request, false);
  v_p := app.stock_payload(p_request -> 'payload', array['product_id', 'quantity', 'expected_balance', 'reason', 'evidence_id']);
  v_version := app.stock_expected_version(p_request);
  v_product := app.stock_product(v_p -> 'product_id');
  if v_product.version <> v_version then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_store := app.stock_location('Store');
  v_quarantine := app.stock_location('Quarantine');
  v_reason := app.txt(v_p, 'reason');
  if v_p -> 'quantity' is null or jsonb_typeof(v_p -> 'quantity') <> 'number'
     or (v_p ->> 'quantity')::numeric <= 0 or v_reason is null then
    perform app.fail('MAT_REVIEW: positive quantity and reason required');
  end if;
  v_qty := (v_p ->> 'quantity')::numeric;
  if nullif(btrim(v_p ->> 'evidence_id'), '') is not null then
    select e.id into v_evidence from public.evidence e where e.id = app.stock_uuid(v_p -> 'evidence_id');
    if v_evidence is null then
      perform app.fail('MAT_REVIEW: evidence not found');
    end if;
  end if;
  v_balance := app.stock_balance(v_product.id, v_store.id);
  if v_p -> 'expected_balance' is null or jsonb_typeof(v_p -> 'expected_balance') <> 'number'
     or (v_p ->> 'expected_balance')::numeric <> v_balance then
    perform app.fail('MAT_STALE: stock balance', jsonb_build_object('store_balance', v_balance));
  end if;
  if v_qty > v_balance then
    perform app.fail('MAT_REVIEW: insufficient stock');
  end if;
  v_mov := app.stock_move(v_product.id, v_qty, v_store.id, v_quarantine.id, 'Damage',
                          'SM-QUARANTINE-' || app.context_command_id(), null, v_reason, null, v_evidence);
  v_pinned := app.stock_pin_product(v_product.id);
  perform app.audit('StockMovements', v_mov.id::text, 'Quarantine', null, to_jsonb(v_mov), v_reason);
  return jsonb_build_object('status', 'Quarantined', 'movement_id', v_mov.id, 'store_balance', v_balance - v_qty,
                            'quarantine_balance', app.stock_balance(v_product.id, v_quarantine.id),
                            'expected_version', v_pinned, 'replay', false, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- STOCK_OPENING_COUNT (_stkOpeningCount, REF-04 §1.2): once per product +
-- location; Opening movement from the balancing (Supplier) location.
-- -----------------------------------------------------------------------------

create function app.cmd_stock_opening_count(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_version int;
  v_product public.products;
  v_location public.stock_locations;
  v_supplier public.stock_locations;
  v_qty numeric;
  v_reason text;
  v_key text;
  v_mov public.stock_movements;
  v_pinned int;
begin
  perform app.stock_envelope(p_request, false);
  v_p := app.stock_payload(p_request -> 'payload', array['product_id', 'location_id', 'quantity', 'reason']);
  v_version := app.stock_expected_version(p_request);
  v_product := app.stock_product(v_p -> 'product_id');
  if v_product.version <> v_version then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  v_supplier := app.stock_location('Supplier');
  if nullif(btrim(v_p ->> 'location_id'), '') is null then
    v_location := app.stock_location('Store');
  else
    select * into v_location from public.stock_locations
    where id = app.stock_uuid(v_p -> 'location_id') and job_id is null and type in ('Store', 'Quarantine');
    if v_location.id is null then
      perform app.fail('STK_REVIEW: opening count location must be a Store or Quarantine location');
    end if;
  end if;
  v_reason := app.txt(v_p, 'reason');
  if v_reason is null then
    perform app.fail('STK_REVIEW: reason required');
  end if;
  v_qty := app.stock_qty(v_p -> 'quantity', 'STK_REVIEW: positive quantity required');
  if v_qty is null then
    perform app.fail('STK_REVIEW: positive quantity required');
  end if;
  v_key := 'OPEN-' || v_product.id || '-' || v_location.id;
  if exists (select 1 from public.stock_movements m where m.idempotency_key = v_key) then
    perform app.fail('STK_REVIEW: opening count already recorded');
  end if;
  v_mov := app.stock_move(v_product.id, v_qty, v_supplier.id, v_location.id, 'Opening', v_key, null, v_reason);
  v_pinned := app.stock_pin_product(v_product.id);
  perform app.audit('StockMovements', v_mov.id::text, 'OpeningCount', null, to_jsonb(v_mov), v_reason);
  return jsonb_build_object('status', 'Recorded', 'movement_id', v_mov.id, 'location_id', v_location.id,
                            'balance', app.stock_balance(v_product.id, v_location.id),
                            'expected_version', v_pinned, 'replay', false, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Reservations, picking and issue (_stkReserve / _stkPick / _stkIssue).
-- -----------------------------------------------------------------------------

-- Material of a Stock requirement on the request's job (R1C_JOB_MISMATCH).
create function app.stock_material(p_request jsonb, p_material_id uuid)
returns public.materials
language plpgsql security definer
set search_path = ''
as $$
declare
  v_material public.materials;
begin
  if p_material_id is not null then
    select * into v_material from public.materials where id = p_material_id for update;
  end if;
  if v_material.id is null then
    perform app.fail('STK_REVIEW: material not found');
  end if;
  if app.ref(p_request, 'job_id') is distinct from v_material.job_id then
    perform app.fail('R1C_JOB_MISMATCH');
  end if;
  perform app.stock_job_actionable(v_material.job_id);
  perform app.assert_normal_work(v_material.job_id);
  return v_material;
end
$$;

create function app.cmd_stock_reserve(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_material public.materials;
  v_product public.products;
  v_store public.stock_locations;
  v_outstanding numeric;
  v_qty numeric;
  v_available numeric;
  v_res public.reservations;
begin
  perform app.stock_envelope(p_request, true);
  v_p := app.stock_payload(p_request -> 'payload', array['material_id', 'product_id', 'quantity', 'expected_available']);
  v_material := app.stock_material(p_request, app.stock_uuid(v_p -> 'material_id'));
  if v_material.source <> 'Stock' then
    perform app.fail('STK_REVIEW: material source must be Stock');
  end if;
  if v_material.product_id is null then
    perform app.fail('STK_REVIEW: material has no stock product');
  end if;
  if nullif(btrim(v_p ->> 'product_id'), '') is not null
     and app.stock_uuid(v_p -> 'product_id') is distinct from v_material.product_id then
    perform app.fail('STK_REVIEW: substitution refused: an approved substitution needs a material revision');
  end if;
  v_product := app.stock_product(to_jsonb(v_material.product_id::text));
  v_store := app.stock_location('Store');
  if exists (select 1 from public.reservations r where r.material_id = v_material.id and r.status = 'Active') then
    perform app.fail('STK_REVIEW: material already has an active reservation');
  end if;
  v_outstanding := v_material.required_quantity - v_material.cancelled_quantity - app.stock_material_issued(v_material.id);
  if v_outstanding <= 0 then
    perform app.fail('STK_REVIEW: nothing outstanding to reserve');
  end if;
  v_qty := coalesce(app.stock_qty(v_p -> 'quantity', 'R1C_INVALID_QUANTITY'), v_outstanding);
  if v_qty > v_outstanding then
    perform app.fail('STK_REVIEW: quantity exceeds outstanding requirement');
  end if;
  v_available := app.stock_available(v_product.id);
  if v_p -> 'expected_available' is not null and jsonb_typeof(v_p -> 'expected_available') <> 'null'
     and (jsonb_typeof(v_p -> 'expected_available') <> 'number' or (v_p ->> 'expected_available')::numeric <> v_available) then
    perform app.fail('STK_STALE: available', jsonb_build_object('available', v_available));
  end if;
  if v_qty > v_available then
    perform app.fail('STK_INSUFFICIENT', jsonb_build_object('available', v_available, 'requested', v_qty));
  end if;
  insert into public.reservations (material_id, product_id, location_id, quantity, status)
  values (v_material.id, v_product.id, v_store.id, v_qty, 'Active')
  returning * into v_res;
  perform app.stock_pin_product(v_product.id);
  perform app.audit('Reservations', v_res.id::text, 'Reserve', null, to_jsonb(v_res), null);
  return jsonb_build_object('status', 'Reserved', 'reservation', to_jsonb(v_res),
                            'available', v_available - v_qty, 'expected_version', v_res.version,
                            'replay', false, 'external_calls', 0);
end
$$;

-- Active reservation, locked and version-checked, on the request's job.
create function app.stock_reservation(p_request jsonb, p_p jsonb)
returns public.reservations
language plpgsql security definer
set search_path = ''
as $$
declare
  v_res public.reservations;
  v_id uuid := app.stock_uuid(p_p -> 'reservation_id');
  v_version int := app.stock_expected_version(p_request);
begin
  if v_id is not null then
    select * into v_res from public.reservations where id = v_id for update;
  end if;
  if v_res.id is null then
    perform app.fail('STK_REVIEW: reservation not found');
  end if;
  perform app.stock_material(p_request, v_res.material_id);
  if v_res.version <> v_version then
    perform app.fail('R1C_STALE_VERSION');
  end if;
  if v_res.status <> 'Active' then
    perform app.fail('STK_REVIEW: reservation must be Active');
  end if;
  return v_res;
end
$$;

-- Picking records what was picked; goods stay in store and stay reserved.
create function app.cmd_stock_pick(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_res public.reservations;
  v_after public.reservations;
  v_qty numeric;
begin
  perform app.stock_envelope(p_request, true);
  v_p := app.stock_payload(p_request -> 'payload', array['reservation_id', 'picked_quantity']);
  v_res := app.stock_reservation(p_request, v_p);
  v_qty := app.stock_qty(v_p -> 'picked_quantity', 'STK_REVIEW: picked quantity must be > 0 and <= reserved');
  if v_qty is null or v_qty > v_res.quantity then
    perform app.fail('STK_REVIEW: picked quantity must be > 0 and <= reserved');
  end if;
  update public.reservations set picked_quantity = v_qty, picked_at = now(), picked_by = app.actor_id(p_actor)
  where id = v_res.id returning * into v_after;
  perform app.audit('Reservations', v_res.id::text, 'Pick', to_jsonb(v_res), to_jsonb(v_after), null);
  return jsonb_build_object('status', 'Picked', 'reservation', to_jsonb(v_after),
                            'expected_version', v_after.version, 'replay', false, 'external_calls', 0);
end
$$;

-- Issue: one Issue movement store -> job site (key ISSUE-<reservation>);
-- reservation Issued; completes MAT03.
create function app.cmd_stock_issue(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_res public.reservations;
  v_after public.reservations;
  v_material public.materials;
  v_store public.stock_locations;
  v_qty numeric;
  v_balance numeric;
  v_site uuid;
  v_mov public.stock_movements;
  v_completed jsonb;
begin
  perform app.stock_envelope(p_request, true);
  v_p := app.stock_payload(p_request -> 'payload', array['reservation_id', 'quantity', 'expected_balance']);
  v_res := app.stock_reservation(p_request, v_p);
  select * into v_material from public.materials where id = v_res.material_id;
  perform app.stock_product(to_jsonb(v_res.product_id::text));
  if v_res.picked_quantity <= 0 then
    perform app.fail('STK_REVIEW: pick before issue');
  end if;
  v_qty := coalesce(app.stock_qty(v_p -> 'quantity', 'R1C_INVALID_QUANTITY'), v_res.picked_quantity);
  if v_qty > v_res.picked_quantity then
    perform app.fail('STK_REVIEW: issue quantity exceeds picked');
  end if;
  v_store := app.stock_location('Store');
  v_balance := app.stock_balance(v_res.product_id, v_res.location_id);
  if v_p -> 'expected_balance' is not null and jsonb_typeof(v_p -> 'expected_balance') <> 'null'
     and (jsonb_typeof(v_p -> 'expected_balance') <> 'number' or (v_p ->> 'expected_balance')::numeric <> v_balance) then
    perform app.fail('STK_STALE: stock balance', jsonb_build_object('store_balance', v_balance));
  end if;
  if v_qty > v_balance then
    perform app.fail('STK_INSUFFICIENT', jsonb_build_object('store_balance', v_balance, 'requested', v_qty));
  end if;
  v_site := app.stock_site_location(v_material.job_id);
  v_mov := app.stock_move(v_res.product_id, v_qty, v_res.location_id, v_site, 'Issue', 'ISSUE-' || v_res.id,
                          v_material.job_id, 'Issue to site for material ' || v_material.id);
  -- Partial issue still closes the reservation (reference; REF-04 §8 Q11).
  update public.reservations set status = 'Issued' where id = v_res.id returning * into v_after;
  v_completed := app.stock_complete_tasks('MAT03', v_material.id, 'Issued ' || v_qty || ' to site');
  perform app.stock_pin_product(v_res.product_id);
  perform app.audit('Reservations', v_res.id::text, 'Issue', to_jsonb(v_res), to_jsonb(v_after), null);
  perform app.audit('StockMovements', v_mov.id::text, 'Issue', null, to_jsonb(v_mov), null);
  return jsonb_build_object('status', 'Issued', 'reservation', to_jsonb(v_after), 'movement_id', v_mov.id,
                            'site_location_id', v_site, 'store_balance', v_balance - v_qty,
                            'outstanding', v_material.required_quantity - v_material.cancelled_quantity
                                           - app.stock_material_issued(v_material.id),
                            'completed_tasks', v_completed, 'replay', false, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Stocktakes (_stkStartStocktake / _stkCountLine / _stkApproveStocktake):
-- Draft -> Review -> Approved only; adjustments only via an approved stocktake.
-- -----------------------------------------------------------------------------

create function app.cmd_stocktake_start(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_location public.stock_locations;
  v_take public.stocktakes;
  v_now timestamptz := now();
begin
  perform app.stock_envelope(p_request, false);
  v_p := app.stock_payload(p_request -> 'payload', array['location_id']);
  if nullif(btrim(v_p ->> 'location_id'), '') is null then
    v_location := app.stock_location('Store');
  else
    select * into v_location from public.stock_locations
    where id = app.stock_uuid(v_p -> 'location_id') and job_id is null and type in ('Store', 'Quarantine')
    for update;
    if v_location.id is null then
      perform app.fail('STK_REVIEW: stocktake location must be a Store or Quarantine location');
    end if;
  end if;
  perform 1 from public.stock_locations where id = v_location.id for update;
  if exists (select 1 from public.stocktakes s where s.location_id = v_location.id and s.status <> 'Approved') then
    perform app.fail('STK_REVIEW: an open stocktake already exists for this location');
  end if;
  if not exists (select 1 from public.products p where p.active and p.stock_tracked) then
    perform app.fail('STK_REVIEW: no active stock-tracked products');
  end if;
  insert into public.stocktakes (location_id, counted_at, cut_off_at, status, counted_by)
  values (v_location.id, v_now, v_now, 'Draft', app.actor_id(p_actor))
  returning * into v_take;
  insert into public.stocktake_lines (stocktake_id, product_id, expected_quantity_at_cutoff)
  select v_take.id, p.id, app.stock_balance(p.id, v_location.id, v_now)
  from public.products p where p.active and p.stock_tracked;
  perform app.audit('Stocktakes', v_take.id::text, 'Start', null, to_jsonb(v_take), null);
  return jsonb_build_object('status', 'Draft', 'stocktake', to_jsonb(v_take),
    'lines', (select jsonb_agg(jsonb_build_object('product_id', l.product_id,
                                                  'expected_quantity_at_cutoff', l.expected_quantity_at_cutoff)
                               order by l.product_id)
              from public.stocktake_lines l where l.stocktake_id = v_take.id),
    'replay', false, 'external_calls', 0);
end
$$;

create function app.cmd_stocktake_count(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_take public.stocktakes;
  v_after_take public.stocktakes;
  v_line public.stocktake_lines;
  v_after public.stocktake_lines;
  v_basis text;
  v_counted numeric;
  v_expected numeric;
  v_reason text;
  v_task uuid;
begin
  perform app.stock_envelope(p_request, false);
  v_p := app.stock_payload(p_request -> 'payload', array['stocktake_id', 'product_id', 'counted_quantity', 'count_basis', 'reason']);
  select * into v_take from public.stocktakes where id = app.stock_uuid(v_p -> 'stocktake_id') for update;
  if v_take.id is null then
    perform app.fail('STK_REVIEW: stocktake not found');
  end if;
  if v_take.status not in ('Draft', 'Review') then
    perform app.fail('STK_REVIEW: stocktake is approved');
  end if;
  select * into v_line from public.stocktake_lines
  where stocktake_id = v_take.id and product_id = app.stock_uuid(v_p -> 'product_id') for update;
  if v_line.id is null then
    perform app.fail('STK_REVIEW: product not on this stocktake');
  end if;
  v_counted := app.stock_qty(v_p -> 'counted_quantity', 'R1C_INVALID_QUANTITY', false);
  if v_counted is null then
    perform app.fail('R1C_INVALID_QUANTITY');
  end if;
  v_basis := coalesce(app.txt(v_p, 'count_basis'), 'AtCutOff');
  if v_basis not in ('AtCutOff', 'AtCount') then
    perform app.fail('STK_REVIEW: count_basis must be AtCutOff or AtCount');
  end if;
  if v_basis = 'AtCutOff' then
    if exists (select 1 from public.stock_movements m
               where m.product_id = v_line.product_id and m.movement_at > v_take.cut_off_at
                 and v_take.location_id in (m.from_location_id, m.to_location_id)) then
      perform app.fail('STK_REVIEW: movements after cut-off; count AtCount');
    end if;
    v_expected := app.stock_balance(v_line.product_id, v_take.location_id, v_take.cut_off_at);
  else
    v_expected := app.stock_balance(v_line.product_id, v_take.location_id);
  end if;
  v_reason := app.txt(v_p, 'reason');
  if v_counted <> v_expected and v_reason is null then
    perform app.fail('STK_REVIEW: variance reason required');
  end if;
  update public.stocktake_lines
  set expected_quantity_at_cutoff = v_expected, counted_quantity = v_counted, variance = v_counted - v_expected,
      reason = v_reason, count_basis = v_basis, counted_at = now(), counted_by = app.actor_id(p_actor)
  where id = v_line.id returning * into v_after;
  if v_after.variance <> 0 then
    v_task := app.create_task_instance(null, 'STK-COUNT', 'STK-COUNT-' || v_take.id, null, null,
      app.london_at(app.next_staffed_date(now()), app.stock_office_time('end')), null, null, null,
      'Stocktakes', v_take.id);
  end if;
  v_after_take := v_take;
  if v_take.status = 'Draft'
     and not exists (select 1 from public.stocktake_lines l where l.stocktake_id = v_take.id and l.counted_quantity is null) then
    update public.stocktakes set status = 'Review' where id = v_take.id returning * into v_after_take;
    perform app.audit('Stocktakes', v_take.id::text, 'Review', to_jsonb(v_take), to_jsonb(v_after_take), null);
  end if;
  perform app.audit('StocktakeLines', v_line.id::text, 'Count', to_jsonb(v_line), to_jsonb(v_after), v_reason);
  return jsonb_build_object('status', v_after_take.status, 'line', to_jsonb(v_after), 'task', v_task,
                            'replay', false, 'external_calls', 0);
end
$$;

create function app.cmd_stocktake_approve(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p jsonb;
  v_take public.stocktakes;
  v_after public.stocktakes;
  v_line public.stocktake_lines;
  v_supplier public.stock_locations;
  v_mov public.stock_movements;
  v_movs jsonb := '[]'::jsonb;
  v_completed jsonb;
begin
  perform app.stock_envelope(p_request, false);
  v_p := app.stock_payload(p_request -> 'payload', array['stocktake_id']);
  select * into v_take from public.stocktakes where id = app.stock_uuid(v_p -> 'stocktake_id') for update;
  if v_take.id is null then
    perform app.fail('STK_REVIEW: stocktake not found');
  end if;
  if v_take.status <> 'Review' then
    perform app.fail('STK_REVIEW: only a stocktake in Review can be approved');
  end if;
  v_supplier := app.stock_location('Supplier');
  for v_line in select * from public.stocktake_lines l where l.stocktake_id = v_take.id and l.variance <> 0
                order by l.product_id for update loop
    perform 1 from public.products where id = v_line.product_id for update;
    if v_line.variance > 0 then
      v_mov := app.stock_move(v_line.product_id, v_line.variance, v_supplier.id, v_take.location_id, 'Adjustment',
                              'ADJ-' || v_line.id, null, 'Stocktake adjustment: ' || v_line.reason);
    else
      v_mov := app.stock_move(v_line.product_id, -v_line.variance, v_take.location_id, v_supplier.id, 'Adjustment',
                              'ADJ-' || v_line.id, null, 'Stocktake adjustment: ' || v_line.reason);
    end if;
    update public.stocktake_lines set adjustment_movement_id = v_mov.id where id = v_line.id;
    perform app.stock_pin_product(v_line.product_id);
    perform app.audit('StockMovements', v_mov.id::text, 'Adjustment', null, to_jsonb(v_mov), v_line.reason);
    v_movs := v_movs || jsonb_build_object('movement_id', v_mov.id, 'product_id', v_line.product_id,
                                           'variance', v_line.variance);
  end loop;
  update public.stocktakes set status = 'Approved', approved_by = app.actor_id(p_actor)
  where id = v_take.id returning * into v_after;
  v_completed := app.stock_complete_tasks('STK-COUNT', v_take.id, 'Stocktake approved');
  perform app.audit('Stocktakes', v_take.id::text, 'Approve', to_jsonb(v_take), to_jsonb(v_after), null);
  return jsonb_build_object('status', 'Approved', 'stocktake', to_jsonb(v_after), 'adjustments', v_movs,
                            'completed_tasks', v_completed, 'replay', false, 'external_calls', 0);
end
$$;

-- -----------------------------------------------------------------------------
-- Reads (operations-contract.js _r1cRead)
-- -----------------------------------------------------------------------------

create function app.stock_read_payload(p_request jsonb, p_allowed text[])
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('read_type', 'payload') then
      perform app.fail('R1C_INVALID_FIELDS');
    end if;
  end loop;
  return app.stock_payload(p_request -> 'payload', p_allowed);
end
$$;

create function app.read_goods_in_detail(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.stock_read_payload(p_request, array['delivery_id']);
  v_delivery public.deliveries;
  v_order public.orders;
  v_job public.jobs;
begin
  select * into v_delivery from public.deliveries where id = app.stock_uuid(v_p -> 'delivery_id');
  if v_delivery.id is null then
    perform app.fail('R1C_DELIVERY_NOT_FOUND');
  end if;
  select * into v_order from public.orders where id = v_delivery.order_id;
  if v_order.id is null then
    perform app.fail('R1C_ORDER_NOT_FOUND');
  end if;
  v_job := app.stock_job_actionable(v_order.job_id);
  return jsonb_build_object(
    'job_id', v_job.id, 'job_ref', v_job.job_ref, 'job_label', v_job.display_name,
    'delivery_id', v_delivery.id, 'order_id', v_order.id, 'expected_version', v_order.version,
    'order_status', v_order.status, 'receipt_status', v_delivery.receipt_status,
    'expected_date', v_delivery.expected_date,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'material_id', l.material_id, 'product_id', l.product_id,
        'description', l.description_snapshot, 'quantity', l.quantity, 'cancelled_quantity', l.cancelled_quantity,
        'unit', l.unit,
        'received_good', (select coalesce(sum(r.quantity_good), 0) from public.receipt_lines r where r.order_line_id = l.id),
        'received_damaged', (select coalesce(sum(r.quantity_damaged), 0) from public.receipt_lines r where r.order_line_id = l.id),
        'outstanding', l.quantity - l.cancelled_quantity - app.stock_line_received(l.id))
        order by l.created_at, l.id)
      from public.order_lines l where l.order_id = v_order.id), '[]'::jsonb));
end
$$;

create function app.read_stock_balance(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.stock_read_payload(p_request, array['product_id']);
  v_product public.products;
  v_store public.stock_locations := app.stock_location('Store');
  v_quarantine public.stock_locations := app.stock_location('Quarantine');
  v_reserved numeric;
  v_balance numeric;
begin
  select * into v_product from public.products where id = app.stock_uuid(v_p -> 'product_id');
  if v_product.id is null or not v_product.active or not v_product.stock_tracked then
    perform app.fail('R1C_STOCK_PRODUCT_REQUIRED');
  end if;
  v_balance := app.stock_balance(v_product.id, v_store.id);
  v_reserved := app.stock_reserved(v_product.id, v_store.id);
  return jsonb_build_object('product_id', v_product.id, 'name', v_product.name, 'expected_version', v_product.version,
                            'store_location_id', v_store.id, 'quarantine_location_id', v_quarantine.id,
                            'store_balance', v_balance,
                            'quarantine_balance', app.stock_balance(v_product.id, v_quarantine.id),
                            'reserved', v_reserved, 'available', v_balance - v_reserved);
end
$$;

-- Job picking view (s08 evaluatePickRequirements / _stkJobPicking).
create function app.read_stock_job_picking(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.stock_read_payload(p_request, array['job_id']);
  v_job public.jobs;
  v_items jsonb;
begin
  select * into v_job from public.jobs where id = app.stock_uuid(v_p -> 'job_id');
  if v_job.id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  select coalesce(jsonb_agg(x order by x ->> 'material_id'), '[]'::jsonb) into v_items from (
    select jsonb_build_object(
      'material_id', m.id, 'product_id', m.product_id, 'product_name', p.name,
      'required', m.required_quantity - m.cancelled_quantity,
      'reserved', coalesce(r.quantity, 0), 'picked', coalesce(r.picked_quantity, 0),
      'reservation_id', r.id, 'reservation_version', r.version,
      'issued', app.stock_material_issued(m.id),
      'outstanding', m.required_quantity - m.cancelled_quantity - app.stock_material_issued(m.id),
      'available', case when p.stock_tracked and p.active then app.stock_available(p.id) end,
      'ready', coalesce(p.stock_tracked and p.active, false)
               and m.required_quantity - m.cancelled_quantity - app.stock_material_issued(m.id) > 0
               and coalesce(r.quantity, 0) + app.stock_available(p.id)
                   >= m.required_quantity - m.cancelled_quantity - app.stock_material_issued(m.id),
      'issues', to_jsonb(array_remove(array[
                  case when m.product_id is null then 'Missing product_id' end,
                  case when p.id is not null and not (p.stock_tracked and p.active) then 'Product not stock-tracked' end], null))) x
    from public.materials m
    left join public.products p on p.id = m.product_id
    left join public.reservations r on r.material_id = m.id and r.status = 'Active'
    where m.job_id = v_job.id and m.source = 'Stock') s;
  return jsonb_build_object('job_id', v_job.id, 'job_ref', v_job.job_ref, 'items', v_items,
    'summary', case when jsonb_array_length(v_items) = 0 then 'NoAction'
                    when exists (select 1 from jsonb_array_elements(v_items) i
                                 where (i ->> 'outstanding')::numeric > 0 and not (i ->> 'ready')::boolean) then 'Blocked'
                    when exists (select 1 from jsonb_array_elements(v_items) i where (i ->> 'ready')::boolean) then 'Ready'
                    else 'NoAction' end);
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('GOODS_IN_RECEIVE', array['Store', 'Office', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-03","mode":"Automated"},{"function_id":"FN-05","mode":"Automated"}]', 'stock',
   'materials/workflow.js _matReceiveDelivery via operations-contract.js; job_id must match the order (R1C_JOB_MISMATCH)'),
  ('STOCK_QUARANTINE', array['Store', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'materials/workflow.js _matQuarantineStock'),
  ('STOCK_OPENING_COUNT', array['Store', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'stock/workflow.js _stkOpeningCount (REF-04 §1.2)'),
  ('STOCK_RESERVE', array['Store', 'Office', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'stock/workflow.js _stkReserve (REF-04 §1.2)'),
  ('STOCK_PICK', array['Store', 'Office', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'stock/workflow.js _stkPick (REF-04 §1.2)'),
  ('STOCK_ISSUE', array['Store', 'Office', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'stock/workflow.js _stkIssue (REF-04 §1.2)'),
  ('STOCKTAKE_START', array['Store', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'stock/workflow.js _stkStartStocktake (REF-04 §1.2)'),
  ('STOCKTAKE_COUNT', array['Store', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'stock/workflow.js _stkCountLine (REF-04 §1.2)'),
  ('STOCKTAKE_APPROVE', array['Store', 'Manager', 'Admin'], false,
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'stock/workflow.js _stkApproveStocktake (REF-04 §1.2)');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('GOODS_IN_DETAIL', array['Store', 'Office', 'Manager', 'Admin'],
   '[{"function_id":"FN-03","mode":"Automated"},{"function_id":"FN-05","mode":"Automated"}]', 'stock',
   'operations-contract.js _r1cRead GOODS_IN_DETAIL'),
  ('STOCK_BALANCE', array['Store', 'Manager', 'Admin'],
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 'operations-contract.js _r1cRead STOCK_BALANCE'),
  ('STOCK_JOB_PICKING', array['Store', 'Office', 'Manager', 'Admin'],
   '[{"function_id":"FN-05","mode":"Automated"}]', 'stock', 's08/picking.js evaluatePickRequirements / _stkJobPicking');
