-- =============================================================================
-- View port C: cross-job list reads for the materials, merchant order and
-- stock screens. The R2 reads are per job (MATERIAL_REQUIREMENTS), per order
-- (ORDER_VIEW) or per product (STOCK_BALANCE); the AppSheet Materials,
-- Merchant Orders and Stock views were lists, so these add the list level.
--
--   MATERIALS_BOARD  jobs with material lines and where they stand
--                    (to order / on order / awaiting confirmation /
--                    confirmed / received / from stock), with lead-time risk
--   ORDERS_LIST      merchant orders across jobs, filterable by status,
--                    merchant and text, with outstanding quantity, next
--                    delivery and whether a merchant acknowledgement is due
--   STOCK_OVERVIEW   every active stock-tracked product with store /
--                    quarantine balance, reserved and available, plus open
--                    stocktakes
--
-- Read-only. Same audience as the R2 reads they summarise (MAT reads: office
-- class + Store, no job-assignment filter; stock: Store, Manager, Admin with
-- FN-05). Balances come from the stock ledger helpers, never stored values.
-- =============================================================================

-- The state of one material line, as MATERIAL_REQUIREMENTS words it.
create function app.material_state(p_material public.materials)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_material.source = 'Stock' then 'Stock'
    when p_material.source = 'AlreadyOrdered' then 'VerifyExternalOrder'
    when o.id is null or o.status = 'Cancelled' then 'ToOrder'
    when o.status = 'Received' then 'Received'
    when o.status = 'PartReceived' then 'PartReceived'
    when o.status = 'Confirmed' then 'Confirmed'
    when o.status = 'Requested' then 'AwaitingConfirmation'
    else 'Drafted'
  end
  from (select 1) one
  left join public.order_lines l on l.id = p_material.order_line_id
  left join public.orders o on o.id = l.order_id
$$;

-- -----------------------------------------------------------------------------
-- MATERIALS_BOARD
-- -----------------------------------------------------------------------------

create function app.read_materials_board(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_view text := coalesce(app.req_text(p_request, 'view'), 'action');
  v_query text := app.req_text(p_request, 'q');
  v_q text := lower(coalesce(app.req_text(p_request, 'q'), ''));
  v_limit int := app.req_limit(p_request, 100, 300);
  v_today date := app.london_date(now());
  v_rows jsonb;
  v_total int;
begin
  perform app.req_keys(p_request, array['view', 'q', 'limit']);
  if v_view not in ('action', 'all') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'view'));
  end if;

  with lines as (
    select m.job_id, app.material_state(m) as state, m.need_by_date,
           (m.required_quantity - coalesce(m.cancelled_quantity, 0)) > 0 as live,
           m.source = 'ToOrder' and m.order_line_id is null and m.need_by_date is not null
             and coalesce((app.mat_lead_risk(m.need_by_date, m.merchant_id, v_today) ->> 'at_risk')::boolean, false)
             as at_risk
    from public.materials m
  ), per_job as (
    select l.job_id,
           count(*) filter (where l.live) as lines,
           count(*) filter (where l.live and l.state = 'ToOrder') as to_order,
           count(*) filter (where l.live and l.state = 'Drafted') as drafted,
           count(*) filter (where l.live and l.state = 'AwaitingConfirmation') as awaiting_confirmation,
           count(*) filter (where l.live and l.state = 'Confirmed') as confirmed,
           count(*) filter (where l.live and l.state in ('Received', 'PartReceived')) as received,
           count(*) filter (where l.live and l.state = 'PartReceived') as part_received,
           count(*) filter (where l.live and l.state = 'Stock') as from_stock,
           count(*) filter (where l.live and l.state = 'VerifyExternalOrder') as external,
           count(*) filter (where l.live and l.at_risk) as at_risk,
           min(l.need_by_date) filter (where l.live and l.state not in ('Received')) as next_need_by
    from lines l group by l.job_id
  ), rows as (
    select p.next_need_by, j.job_ref, jsonb_build_object(
             'job_id', j.id, 'job_ref', j.job_ref, 'workflow_stage', j.workflow_stage,
             'customer_name', app.s17_customer_name(c.first_name, c.last_name), 'postcode', c.postcode,
             'lines', p.lines, 'to_order', p.to_order, 'drafted', p.drafted,
             'awaiting_confirmation', p.awaiting_confirmation, 'confirmed', p.confirmed,
             'received', p.received, 'part_received', p.part_received, 'from_stock', p.from_stock,
             'external', p.external, 'at_risk', p.at_risk, 'next_need_by', p.next_need_by,
             'install_date', (select min(w.planned_start) from public.work_packages w
                              where w.job_id = j.id and w.status <> 'Cancelled')) as row
    from per_job p
    join public.jobs j on j.id = p.job_id
    left join public.customers c on c.id = j.customer_id
    where j.archived_at is null
      and (v_view = 'all'
           or p.to_order + p.drafted + p.awaiting_confirmation + p.external + p.part_received + p.at_risk > 0)
      and (v_query is null or exists (
            select 1 from unnest(array[j.job_ref, app.s17_customer_name(c.first_name, c.last_name), c.postcode]) f(v)
            where strpos(lower(coalesce(app.s17_clean(f.v), '')), v_q) > 0))
  )
  select (select count(*) from rows),
         coalesce((select jsonb_agg(row order by next_need_by nulls last, job_ref)
                   from (select * from rows order by next_need_by nulls last, job_ref limit v_limit) x), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('view', v_view, 'q', v_query, 'as_of', v_today, 'count', jsonb_array_length(v_rows),
                            'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows), 'jobs', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- ORDERS_LIST
-- -----------------------------------------------------------------------------

create function app.read_orders_list(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_statuses text[];
  v_merchant uuid := app.req_uuid(p_request, 'merchant_id');
  v_job uuid := app.req_uuid(p_request, 'job_id');
  v_query text := app.req_text(p_request, 'q');
  v_q text := lower(coalesce(app.req_text(p_request, 'q'), ''));
  v_limit int := app.req_limit(p_request, 100, 300);
  v_rows jsonb;
  v_total int;
  v_counts jsonb;
begin
  perform app.req_keys(p_request, array['status', 'merchant_id', 'job_id', 'q', 'limit']);
  if app.req_text(p_request, 'status') is not null then
    v_statuses := string_to_array(app.req_text(p_request, 'status'), ',');
    if exists (select 1 from unnest(v_statuses) s
               where s not in ('Draft', 'Review', 'Requested', 'Confirmed', 'PartReceived', 'Received', 'Cancelled')) then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'status'));
    end if;
  end if;

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_counts
  from (select o.status, count(*) as n from public.orders o group by o.status) s;

  with rows as (
    select o.created_at, o.id, jsonb_build_object(
      'id', o.id, 'version', o.version, 'status', o.status, 'revision', o.revision,
      'confirmed_revision', o.confirmed_revision, 'work_type', o.work_type,
      'supplier_reference', o.supplier_reference, 'requested_delivery_date', o.requested_delivery_date,
      'created_at', o.created_at,
      'acknowledgement_required', o.status in ('Requested', 'Confirmed', 'PartReceived')
                                  and coalesce(o.confirmed_revision, 0) < o.revision,
      'job_id', j.id, 'job_ref', j.job_ref, 'customer_name', app.s17_customer_name(c.first_name, c.last_name),
      'postcode', c.postcode,
      'merchant_id', co.id, 'merchant', co.name,
      'line_count', (select count(*) from public.order_lines l where l.order_id = o.id),
      'outstanding', (select coalesce(sum(app.mat_line_outstanding(l.id)), 0) from public.order_lines l where l.order_id = o.id),
      'next_delivery', (select jsonb_build_object('id', d.id, 'expected_date', d.expected_date, 'receipt_status', d.receipt_status)
                        from public.deliveries d
                        where d.order_id = o.id and d.actual_received_at is null
                          and coalesce(d.receipt_status, 'Expected') not in ('Cancelled', 'Received')
                        order by d.expected_date nulls last, d.created_at limit 1)) as row
    from public.orders o
    left join public.jobs j on j.id = o.job_id
    left join public.customers c on c.id = j.customer_id
    left join public.companies co on co.id = o.merchant_id
    where (v_statuses is null or o.status = any (v_statuses))
      and (v_merchant is null or o.merchant_id = v_merchant)
      and (v_job is null or o.job_id = v_job)
      and (v_query is null or exists (
            select 1 from unnest(array[j.job_ref, co.name, o.supplier_reference,
                                       app.s17_customer_name(c.first_name, c.last_name), c.postcode]) f(v)
            where strpos(lower(coalesce(app.s17_clean(f.v), '')), v_q) > 0))
  )
  select (select count(*) from rows),
         coalesce((select jsonb_agg(row order by created_at desc, id)
                   from (select * from rows order by created_at desc, id limit v_limit) x), '[]'::jsonb)
    into v_total, v_rows;

  return jsonb_build_object('status', v_statuses, 'counts', v_counts, 'count', jsonb_array_length(v_rows),
                            'total', v_total, 'truncated', v_total > jsonb_array_length(v_rows),
                            'merchants', (select coalesce(jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name)
                                                                    order by co.name), '[]'::jsonb)
                                          from public.companies co where co.type = 'Merchant' and co.active),
                            'orders', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- STOCK_OVERVIEW
-- -----------------------------------------------------------------------------

create function app.read_stock_overview(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_query text := app.req_text(p_request, 'q');
  v_q text := lower(coalesce(app.req_text(p_request, 'q'), ''));
  v_store public.stock_locations;
  v_quarantine public.stock_locations;
  v_rows jsonb;
begin
  perform app.req_keys(p_request, array['q']);
  -- Without a configured store the ledger has nowhere to count from.
  begin
    v_store := app.stock_location('Store');
    v_quarantine := app.stock_location('Quarantine');
  exception when others then
    return jsonb_build_object('configured', false, 'products', '[]'::jsonb, 'stocktakes', '[]'::jsonb,
                              'message', sqlerrm);
  end;

  select coalesce(jsonb_agg(x.row order by x.name, x.sku), '[]'::jsonb) into v_rows
  from (
    select p.name, p.sku, jsonb_build_object(
      'product_id', p.id, 'sku', p.sku, 'name', p.name, 'category', p.category, 'unit', p.unit,
      'version', p.version,
      'store_balance', app.stock_balance(p.id, v_store.id),
      'quarantine_balance', app.stock_balance(p.id, v_quarantine.id),
      'reserved', app.stock_reserved(p.id, v_store.id),
      'available', app.stock_balance(p.id, v_store.id) - app.stock_reserved(p.id, v_store.id),
      'has_opening', exists (select 1 from public.stock_movements m
                             where m.product_id = p.id and m.movement_type = 'Opening')) as row
    from public.products p
    where p.active and p.stock_tracked
      and (v_query is null or strpos(lower(p.name || ' ' || p.sku || ' ' || coalesce(p.category, '')), v_q) > 0)
  ) x;

  return jsonb_build_object(
    'configured', true, 'store_location_id', v_store.id, 'quarantine_location_id', v_quarantine.id,
    'products', v_rows,
    'stocktakes', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', s.id, 'status', s.status, 'location_id', s.location_id, 'location', l.name,
                     'cut_off_at', s.cut_off_at,
                     'lines', (select count(*) from public.stocktake_lines sl where sl.stocktake_id = s.id),
                     'counted', (select count(*) from public.stocktake_lines sl
                                 where sl.stocktake_id = s.id and sl.counted_quantity is not null),
                     'variances', (select count(*) from public.stocktake_lines sl
                                   where sl.stocktake_id = s.id and coalesce(sl.variance, 0) <> 0),
                     'items', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'product_id', sl.product_id, 'name', pr.name, 'sku', pr.sku, 'unit', pr.unit,
                                 'expected', sl.expected_quantity_at_cutoff, 'counted', sl.counted_quantity,
                                 'variance', sl.variance, 'reason', sl.reason) order by pr.name), '[]'::jsonb)
                               from public.stocktake_lines sl join public.products pr on pr.id = sl.product_id
                               where sl.stocktake_id = s.id))
                     order by s.created_at), '[]'::jsonb)
                   from public.stocktakes s left join public.stock_locations l on l.id = s.location_id
                   where s.status <> 'Approved'));
end
$$;

-- -----------------------------------------------------------------------------
-- Registry
-- -----------------------------------------------------------------------------

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('MATERIALS_BOARD', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Store'], '[]', 'view-port',
   'Jobs with material lines and their ordering state.'),
  ('ORDERS_LIST', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Store'], '[]', 'view-port',
   'Merchant orders across jobs.'),
  ('STOCK_OVERVIEW', array['Store', 'Manager', 'Admin'],
   '[{"function_id": "FN-05", "mode": "Automated"}]', 'view-port',
   'Stock-tracked products with balances, reservations and open stocktakes.');
