-- =============================================================================
-- Backend port: R2 materials and ordering (FN-03 "Orders and merchant messages").
--
-- Source: reference materials/workflow.js (canonical), docs/MATERIALS-implementation.md,
-- tests/materials.test.cjs; survey ref-04 §0, §1.1, §6, §7, §8. The legacy
-- s07/ordering.js model (ORD-<job>-<merchant>, materials flipped to
-- AlreadyOrdered) is superseded by materials/workflow.js (ref-04 §7) and is
-- not ported.
--
-- Commands (app.command_registry, all FN-03 Automated):
--   MATERIAL_ADD          _matAddRequirement      job-scoped, expected_version = job
--   ORDERS_BUILD          _matBuildOrders         job-scoped
--   ORDER_SEND            _matSendOrder           job-scoped, payload.order_id, expected_version = order
--   ORDER_CONFIRM         _matConfirmOrder (+ survey _matRecordSupplierReply stale replies)
--   ORDER_REVISE          _matReviseOrder (+ survey _matReviseSentOrder MAT06 supersede)
--   ORDER_CANCEL          _matCancelOrder
--   MERCHANT_WEEKLY_LIST  _matWeeklyList          not job-scoped (all merchants, one week)
-- Reads (app.read_registry, public.execute_operations_read):
--   MATERIAL_REQUIREMENTS _matRequirements, ORDER_VIEW _matOrderView, STORE_QUEUE _matStoreQueue
--
-- NOT here: goods-in receipts (_matReceiveDelivery / GOODS_IN_RECEIVE), stock
-- movements, quarantine, reservations - the stock module owns them. For that
-- module this file exposes:
--   app.mat_line_received(order_line_id) -> {good, damaged}
--   app.mat_line_outstanding(order_line_id) -> numeric
--   app.mat_order_fully_received(order_id) -> boolean (order -> Received vs PartReceived)
--   app.mat_store_location() -> uuid (configured usable Store location)
--   app.mat_task / app.mat_complete_tasks / app.mat_day_start / app.mat_day_end /
--   app.mat_next_staffed / app.mat_same_or_next_staffed (MAT04 completion, follow-up
--   delivery task "balance of <order>" due next staffed day end, as the reference).
--
-- Merchant messages are CAPTURED Communications (status Draft, never sent,
-- orders.sent_message_id stays null, no outbox row, no external call), exactly
-- as the reference (ref-04 §0 "Outbound").
--
-- Port notes (conventions, not behaviour changes):
--   * Reference text ids become uuids plus natural keys: one Draft order per
--     job + merchant + work type (partial unique index); one weekly list per
--     merchant + week; communications per order revision are found through
--     communication_jobs (order_id, entity_revision); task instance keys keep
--     the reference shapes with uuids (MAT01-{order}, MAT06-{order}-R{rev},
--     MAT04-{delivery}, MAT05-{merchant}-{week}, MAT06-LIST-{merchant}-{week}).
--   * The CommitJournal / replay / conflict handling is the command ledger of
--     public.execute_command; one transaction per command (zero-write refusals).
--   * DEV sheet guard, pilot_job / release_scope job gate, LOC-store literal
--     and "tanya" owner lookup are not ported: the store location is
--     configuration (setting stock.store_location_id, else the single usable
--     Store location); task owners come from task_assignment_rules.
--   * Tasks: one task per instance key EVER (core rule); the reference would
--     recreate a key whose task was Cancelled.
--   * Staffed days use app.is_staffed_day (ISO weekdays + office-closed
--     holidays); day start/end use setting office.hours (default 09:00-17:00),
--     Europe/London.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Natural keys
-- -----------------------------------------------------------------------------

-- Reference ORD-<job>-<merchant>-<type>: at most one open Draft order per job,
-- merchant and work type (later requirements append to it). Only 'Draft' is
-- constrained: S15 may move several sent orders of the same key to 'Review'.
create unique index orders_mat_one_draft_key on public.orders (job_id, merchant_id, work_type)
  where status = 'Draft';

-- Reference COMM-MAT-WEEKLY-<merchant>-<weekStart>: one list per merchant per week.
create unique index communications_mat_weekly_list_key on public.communications (company_id, covered_week_start)
  where type = 'MerchantDeliveryList';

create index deliveries_mat_expected_idx on public.deliveries (expected_date)
  where actual_received_at is null;

-- -----------------------------------------------------------------------------
-- Value helpers
-- -----------------------------------------------------------------------------

-- A text uuid, or null when absent or not a uuid.
create function app.mat_uuid(p_value text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case when btrim(p_value) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then btrim(p_value)::uuid end
$$;

-- _matDate: YYYY-MM-DD (a leading date of an ISO instant is taken as written);
-- blank -> null; anything else MAT_DATE_INVALID.
create function app.mat_date(p_value jsonb)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v text;
  v_date date;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    perform app.fail('MAT_DATE_INVALID');
  end if;
  v := btrim(p_value #>> '{}');
  if v = '' then
    return null;
  end if;
  v := substring(v from '^([0-9]{4}-[0-9]{2}-[0-9]{2})');
  begin
    v_date := v::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null or to_char(v_date, 'YYYY-MM-DD') <> v then
    perform app.fail('MAT_DATE_INVALID');
  end if;
  return v_date;
end
$$;

-- _matTimestamp for instants (received_at): ISO instant; else MAT_DATE_INVALID.
create function app.mat_ts(p_value jsonb)
returns timestamptz
language plpgsql stable
set search_path = ''
as $$
declare
  v_ts timestamptz;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' or btrim(coalesce(p_value #>> '{}', '')) = '' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' or btrim(p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
    perform app.fail('MAT_DATE_INVALID');
  end if;
  begin
    v_ts := btrim(p_value #>> '{}')::timestamptz;
  exception when others then
    v_ts := null;
  end;
  if v_ts is null then
    perform app.fail('MAT_DATE_INVALID');
  end if;
  return v_ts;
end
$$;

-- A number (JSON number or numeric string); absent -> null; else p_code.
create function app.mat_num(p_value jsonb, p_code text)
returns numeric
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    return (p_value #>> '{}')::numeric;
  end if;
  if jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    return btrim(p_value #>> '{}')::numeric;
  end if;
  perform app.fail(p_code);
end
$$;

-- -----------------------------------------------------------------------------
-- Business calendar (materials/workflow.js:55-80, 181-199)
-- -----------------------------------------------------------------------------

-- Monday of the ISO week containing the date (Sunday belongs to the week before).
create function app.mat_monday(p_date date)
returns date
language sql immutable
set search_path = ''
as $$ select p_date - (extract(isodow from p_date)::int - 1) $$;

-- Delivery date = merchant delivery weekday (1-6, default 4 = Thursday) in the
-- week BEFORE the Monday-week of the package's planned start (:181-186).
create function app.mat_delivery_date(p_planned_start date, p_delivery_weekday int)
returns date
language sql immutable
set search_path = ''
as $$
  select app.mat_monday(p_planned_start) - 7
         + (case when p_delivery_weekday between 1 and 6 then p_delivery_weekday else 4 end - 1)
$$;

-- Friday list date for a delivery: Friday of the week before the delivery week (:188).
create function app.mat_list_date(p_delivery date)
returns date
language sql immutable
set search_path = ''
as $$ select app.mat_monday(p_delivery) - 3 $$;

-- The date if staffed, else the nearest earlier staffed day (bounded, as the reference).
create function app.mat_prev_staffed(p_date date)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v date := p_date;
  n int := 0;
begin
  while not app.is_staffed_day(v) and n < 60 loop
    v := v - 1;
    n := n + 1;
  end loop;
  return v;
end
$$;

-- The first staffed day strictly after the date.
create function app.mat_next_staffed(p_date date)
returns date
language plpgsql stable
set search_path = ''
as $$
declare
  v date := p_date + 1;
  n int := 0;
begin
  while not app.is_staffed_day(v) and n < 60 loop
    v := v + 1;
    n := n + 1;
  end loop;
  return v;
end
$$;

create function app.mat_same_or_next_staffed(p_date date)
returns date
language sql stable
set search_path = ''
as $$ select case when app.is_staffed_day(p_date) then p_date else app.mat_next_staffed(p_date) end $$;

-- office.hours start/end (HH:MM), default 09:00 / 17:00 (:73).
create function app.mat_office_time(p_which text)
returns time
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v jsonb := app.setting('office.hours');
  v_start text := case when jsonb_typeof(v) = 'object' then v ->> 'start' end;
  v_end text := case when jsonb_typeof(v) = 'object' then v ->> 'end' end;
begin
  if coalesce(v_start, '') !~ '^[0-9]{2}:[0-9]{2}$' or coalesce(v_end, '') !~ '^[0-9]{2}:[0-9]{2}$' then
    v_start := '09:00';
    v_end := '17:00';
  end if;
  return (case when p_which = 'start' then v_start else v_end end)::time;
end
$$;

create function app.mat_day_start(p_date date)
returns timestamptz
language sql stable
set search_path = ''
as $$ select app.london_at(p_date, app.mat_office_time('start')) $$;

create function app.mat_day_end(p_date date)
returns timestamptz
language sql stable
set search_path = ''
as $$ select app.london_at(p_date, app.mat_office_time('end')) $$;

-- Lead-time risk (:195-199): latest_order_date = previous staffed day on or
-- before (need_by - merchant.standard_lead_days); at risk when already past.
create function app.mat_lead_risk(p_need_by date, p_merchant_id uuid, p_today date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_lead int := coalesce((select c.standard_lead_days from public.companies c where c.id = p_merchant_id), 0);
  v_latest date;
begin
  if p_need_by is null then
    return null;
  end if;
  v_latest := app.mat_prev_staffed(p_need_by - v_lead);
  return jsonb_build_object('latest_order_date', v_latest, 'lead_days', v_lead,
                            'at_risk', v_latest < coalesce(p_today, app.london_date(now())));
end
$$;

-- -----------------------------------------------------------------------------
-- Lookups
-- -----------------------------------------------------------------------------

-- Work type of a package: Roof / Electrical / Other (ReturnVisit and none -> Other) (:189-194).
create function app.mat_work_type(p_work_package_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce((select case when w.trade in ('Roof', 'Electrical', 'Other') then w.trade else 'Other' end
                   from public.work_packages w where w.id = p_work_package_id), 'Other')
$$;

-- Active Merchant company (:99-103).
create function app.mat_merchant(p_company_id uuid)
returns public.companies
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v public.companies;
begin
  select * into v from public.companies c where c.id = p_company_id;
  if v.id is null or v.type <> 'Merchant' or not v.active then
    perform app.fail('MAT_REVIEW: active Merchant company required');
  end if;
  return v;
end
$$;

-- The goods-in store (reference literal LOC-store): setting
-- stock.store_location_id (a usable Store location), else the single usable
-- Store location. Fails visibly when unconfigured or ambiguous.
create function app.mat_store_location()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_setting jsonb := app.setting('stock.store_location_id');
  v_id uuid;
begin
  if v_setting is not null and jsonb_typeof(v_setting) <> 'null' then
    v_id := app.mat_uuid(v_setting #>> '{}');
    if v_id is null or not exists (select 1 from public.stock_locations l
                                   where l.id = v_id and l.type = 'Store' and l.usable) then
      perform app.fail('MAT_CONFIG: stock.store_location_id is not a usable Store location');
    end if;
    return v_id;
  end if;
  if (select count(*) from public.stock_locations l where l.type = 'Store' and l.usable) <> 1 then
    perform app.fail('MAT_CONFIG: exactly one usable Store location required');
  end if;
  select l.id into v_id from public.stock_locations l where l.type = 'Store' and l.usable;
  return v_id;
end
$$;

-- Received quantities for an order line (:273-277). For the stock module too.
create function app.mat_line_received(p_order_line_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('good', coalesce(sum(r.quantity_good), 0), 'damaged', coalesce(sum(r.quantity_damaged), 0))
  from public.receipt_lines r where r.order_line_id = p_order_line_id
$$;

-- quantity - cancelled - good - damaged.
create function app.mat_line_outstanding(p_order_line_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select l.quantity - l.cancelled_quantity
         - coalesce((select sum(r.quantity_good + r.quantity_damaged) from public.receipt_lines r
                     where r.order_line_id = l.id), 0)
  from public.order_lines l where l.id = p_order_line_id
$$;

-- Every line fully received (:508): the order becomes Received, else PartReceived.
create function app.mat_order_fully_received(p_order_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(bool_and(app.mat_line_outstanding(l.id) <= 0), true)
  from public.order_lines l where l.order_id = p_order_id
$$;

-- -----------------------------------------------------------------------------
-- Captured merchant communications (:203-228)
-- -----------------------------------------------------------------------------

create function app.mat_contacts(p_company_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('contact_id', c.id, 'name', c.name,
                                               'email', coalesce(c.email, 'NOT_CONFIGURED'),
                                               'channel', coalesce(c.preferred_channel, 'NOT_CONFIGURED'))
                            order by c.name, c.id), '[]'::jsonb)
  from public.contacts c where c.company_id = p_company_id and c.active
$$;

-- Immutable order snapshot (:206-212), including customer postcode and lines.
create function app.mat_order_snapshot(p_order public.orders)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', p_order.id, 'revision', p_order.revision, 'status', p_order.status, 'job_id', p_order.job_id,
    'job_reference', j.job_ref, 'customer_display', j.display_name, 'postcode', c.postcode,
    'work_type', p_order.work_type, 'requested_delivery_date', p_order.requested_delivery_date,
    'delivery_location_id', p_order.delivery_location_id, 'supplier_reference', p_order.supplier_reference,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'order_line_id', l.id, 'product_id', l.product_id, 'description', l.description_snapshot,
                'quantity', l.quantity, 'cancelled_quantity', l.cancelled_quantity, 'unit', l.unit)
                order by l.created_at, m.created_at nulls last, l.id), '[]'::jsonb)
              from public.order_lines l left join public.materials m on m.id = l.material_id
              where l.order_id = p_order.id),
    'note', 'CAPTURED DRAFT — not sent. FN-03 R2.')
  from public.jobs j join public.customers c on c.id = j.customer_id
  where j.id = p_order.job_id
$$;

-- Inserts a Draft communication (never sent) with the recipients as they are now.
create function app.mat_capture(p_job_id uuid, p_company_id uuid, p_type text, p_subject text, p_body jsonb,
                                p_revision int, p_delivery_date date, p_week_start date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.communications (job_id, company_id, type, subject, body_snapshot, recipients_snapshot,
                                     covered_week_start, delivery_date, revision, status)
  values (p_job_id, p_company_id, p_type, p_subject, p_body::text, app.mat_contacts(p_company_id)::text,
          p_week_start, p_delivery_date, p_revision, 'Draft')
  returning id into v_id;
  return v_id;
end
$$;

-- CommunicationJobs link (reference CJOB-<comm>-<order>), once.
create function app.mat_link(p_communication_id uuid, p_job_id uuid, p_order_id uuid, p_revision int)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.communication_jobs (communication_id, job_id, order_id, entity_revision)
  select p_communication_id, p_job_id, p_order_id, p_revision
  where not exists (select 1 from public.communication_jobs cj
                    where cj.communication_id = p_communication_id and cj.job_id = p_job_id
                      and cj.order_id is not distinct from p_order_id)
$$;

-- The order's communication of a type for a revision (COMM-MAT-<order>-<type>-R<rev>).
create function app.mat_order_comm(p_order_id uuid, p_type text, p_revision int)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select c.id from public.communications c
  join public.communication_jobs cj on cj.communication_id = c.id
  where cj.order_id = p_order_id and c.type = p_type and c.revision = p_revision
  order by c.created_at, c.id limit 1
$$;

-- -----------------------------------------------------------------------------
-- Tasks MAT01-MAT06 (:141-177)
-- -----------------------------------------------------------------------------

-- Creates the task once per instance key (owner from the assignment rule,
-- priority 1, title "<template title> — <suffix>"). Returns {created, task_id, code}.
create function app.mat_task(p_code text, p_job_id uuid, p_entity_type text, p_entity_id uuid,
                             p_instance_key text, p_due_at timestamptz, p_suffix text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := (select t.title from public.task_templates t where t.code = p_code and t.active);
  v_id uuid;
begin
  v_id := app.create_task_instance(p_job_id, p_code, p_instance_key, null, null, p_due_at, 1,
                                   case when v_title is not null and nullif(btrim(p_suffix), '') is not null
                                        then v_title || ' — ' || p_suffix end,
                                   null, p_entity_type, p_entity_id);
  if v_id is not null then
    return jsonb_build_object('created', true, 'task_id', v_id, 'code', p_code);
  end if;
  select t.id into v_id from public.tasks t where t.instance_key = p_instance_key;
  return jsonb_build_object('created', false, 'task_id', v_id, 'code', p_code);
end
$$;

-- Completes the entity's open tasks of the given codes. Returns the task ids.
create function app.mat_complete_tasks(p_entity_type text, p_entity_id uuid, p_codes text[], p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.tasks;
  v_after public.tasks;
  v_done jsonb := '[]'::jsonb;
begin
  for v_before in select * from public.tasks t
                  where t.related_entity_type = p_entity_type and t.related_entity_id = p_entity_id
                    and t.template_code = any (p_codes)
                    and t.status not in ('Complete', 'Cancelled', 'NotRequired')
                  order by t.created_at, t.id for update loop
    update public.tasks set status = 'Complete', completed_at = now(), completed_by = app.context_actor_id(),
                            completion_note = p_note
    where id = v_before.id returning * into v_after;
    perform app.task_event(v_before, v_after, 'Complete', p_note);
    v_done := v_done || jsonb_build_array(v_before.id);
  end loop;
  return v_done;
end
$$;

-- Cancels the entity's open tasks (all codes when p_codes is null), except
-- p_keep_key. p_action is the task-history action ('Cancel' or 'Supersede').
create function app.mat_cancel_tasks(p_entity_type text, p_entity_id uuid, p_codes text[], p_reason text,
                                     p_action text default 'Cancel', p_keep_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.tasks;
  v_after public.tasks;
  v_done jsonb := '[]'::jsonb;
begin
  for v_before in select * from public.tasks t
                  where t.related_entity_type = p_entity_type and t.related_entity_id = p_entity_id
                    and (p_codes is null or t.template_code = any (p_codes))
                    and t.instance_key is distinct from p_keep_key
                    and t.status not in ('Complete', 'Cancelled', 'NotRequired')
                  order by t.created_at, t.id for update loop
    update public.tasks set status = 'Cancelled', completion_note = p_reason
    where id = v_before.id returning * into v_after;
    perform app.task_event(v_before, v_after, p_action, p_reason);
    v_done := v_done || jsonb_build_array(v_before.id);
  end loop;
  return v_done;
end
$$;

-- Moves the delivery's Open tasks (MAT04) to the delivery day end (:426).
create function app.mat_move_delivery_tasks(p_delivery_id uuid, p_date date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.tasks;
  v_after public.tasks;
begin
  for v_before in select * from public.tasks t
                  where t.related_entity_type = 'Deliveries' and t.related_entity_id = p_delivery_id
                    and t.status = 'Open' and t.due_at is distinct from app.mat_day_end(p_date)
                  order by t.created_at, t.id for update loop
    update public.tasks set due_at = app.mat_day_end(p_date) where id = v_before.id returning * into v_after;
    perform app.task_event(v_before, v_after, 'Reschedule', p_reason);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Command target: the order named in payload.order_id, locked, on the
-- envelope's (already authorized) job.
-- -----------------------------------------------------------------------------

create function app.mat_lock_order(p_request jsonb, p_payload jsonb)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders o where o.id = app.mat_uuid(app.txt(p_payload, 'order_id')) for update;
  if v_order.id is null then
    perform app.fail('MAT_REVIEW: order not found');
  end if;
  if v_order.job_id is distinct from app.ref(p_request, 'job_id') then
    perform app.fail('R1A_ORDER_JOB_MISMATCH');
  end if;
  return v_order;
end
$$;

create function app.mat_expect(p_version int, p_request jsonb)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_version <> app.expected_version(p_request) then
    perform app.fail('MAT_STALE: version');
  end if;
end
$$;

-- =============================================================================
-- 1. MATERIAL_ADD (_matAddRequirement, :232-271)
-- =============================================================================

create function app.cmd_material_add(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['source', 'required_quantity', 'product_id', 'description', 'unit',
                                            'merchant_id', 'need_by_date', 'already_ordered_reference', 'notes']);
  v_job public.jobs;
  v_source text := app.txt(v_p, 'source');
  v_qty numeric;
  v_product public.products;
  v_desc text := app.txt(v_p, 'description');
  v_unit text := app.txt(v_p, 'unit');
  v_wp public.work_packages;
  v_wp_id uuid := app.ref(p_request, 'work_package_id');
  v_merchant_id uuid;
  v_merchant public.companies;
  v_need_by date;
  v_ao_ref text := app.txt(v_p, 'already_ordered_reference');
  v_material public.materials;
  v_today date := app.london_date(now());
  v_risk jsonb;
  v_task jsonb;
  v_job_version int;
begin
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  perform app.assert_normal_work(v_job.id);
  if v_source is null or v_source not in ('ToOrder', 'AlreadyOrdered', 'Stock') then
    perform app.fail('MAT_REVIEW: source must be ToOrder, AlreadyOrdered or Stock');
  end if;
  v_qty := app.mat_num(v_p -> 'required_quantity', 'MAT_REVIEW: required_quantity must be > 0');
  if v_qty is null or v_qty <= 0 then
    perform app.fail('MAT_REVIEW: required_quantity must be > 0');
  end if;
  if app.txt(v_p, 'product_id') is not null then
    select * into v_product from public.products pr
    where pr.id = app.mat_uuid(app.txt(v_p, 'product_id')) and pr.active;
    if v_product.id is null then
      perform app.fail('MAT_REVIEW: active product required');
    end if;
    v_unit := coalesce(v_unit, v_product.unit);
  elsif v_desc is null or v_unit is null then
    perform app.fail('MAT_REVIEW: Other materials require description and unit');
  end if;
  if v_wp_id is not null then
    select * into v_wp from public.work_packages w where w.id = v_wp_id;
    if v_wp.id is null or v_wp.job_id <> v_job.id then
      perform app.fail('MAT_REVIEW: work package linkage invalid');
    end if;
  end if;
  if app.txt(v_p, 'merchant_id') is not null then
    v_merchant_id := app.mat_uuid(app.txt(v_p, 'merchant_id'));
    if v_merchant_id is null then
      perform app.fail('MAT_REVIEW: active Merchant company required');
    end if;
  else
    v_merchant_id := v_product.default_supplier_id;
  end if;
  if v_source <> 'Stock' then
    if v_merchant_id is null then
      perform app.fail('MAT_REVIEW: merchant_id required (no product default supplier)');
    end if;
    v_merchant := app.mat_merchant(v_merchant_id);
  elsif v_merchant_id is not null then
    select * into v_merchant from public.companies c where c.id = v_merchant_id;
    if v_merchant.id is null then
      perform app.fail('MAT_REVIEW: active Merchant company required');
    end if;
  end if;
  v_need_by := app.mat_date(v_p -> 'need_by_date');
  if v_need_by is null then
    if v_wp.planned_start is not null then
      v_need_by := app.mat_delivery_date(v_wp.planned_start, v_merchant.delivery_weekday);
    else
      perform app.fail('MAT_REVIEW: need_by_date required when the work package has no planned start');
    end if;
  end if;
  if v_source = 'AlreadyOrdered' and v_ao_ref is null then
    perform app.fail('MAT_REVIEW: already_ordered_reference required');
  end if;
  perform app.mat_expect(v_job.version, p_request);

  insert into public.materials (job_id, work_package_id, product_id, description, required_quantity, unit, source,
                                need_by_date, merchant_id, already_ordered_reference, notes, revision, cancelled_quantity)
  values (v_job.id, v_wp.id, v_product.id, v_desc, v_qty, v_unit, v_source, v_need_by, v_merchant_id,
          v_ao_ref, app.txt(v_p, 'notes'), 1, 0)
  returning * into v_material;
  -- The requirement pins the job version (reference store.update Jobs version+1).
  update public.jobs set updated_at = now() where id = v_job.id returning version into v_job_version;

  if v_source = 'ToOrder' then
    v_risk := app.mat_lead_risk(v_need_by, v_merchant_id, v_today);
  elsif v_source = 'AlreadyOrdered' then
    v_task := app.mat_task('MAT02', v_job.id, 'Materials', v_material.id, 'MAT02-' || v_material.id,
                           app.mat_day_end(app.mat_same_or_next_staffed(v_today)),
                           coalesce(v_merchant.name, '') || ' ref ' || v_ao_ref);
  else
    v_task := app.mat_task('MAT03', v_job.id, 'Materials', v_material.id, 'MAT03-' || v_material.id,
                           app.mat_day_end(app.mat_prev_staffed(v_need_by - 1)),
                           coalesce(v_product.name, v_desc) || ' x' || trim_scale(v_qty)::text);
  end if;
  perform app.audit('Materials', v_material.id::text, 'AddRequirement', null, to_jsonb(v_material));
  return jsonb_build_object('status', 'Created', 'material', to_jsonb(v_material),
    'work_type', app.mat_work_type(v_wp.id), 'lead_time_risk', v_risk, 'task', v_task,
    'job_version', v_job_version, 'external_calls', 0);
end
$$;

-- =============================================================================
-- 2. ORDERS_BUILD (_matBuildOrders, :295-336): one order per merchant + work type
-- =============================================================================

create function app.cmd_orders_build(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_today date := app.london_date(now());
  v_bad uuid;
  v_grp record;
  v_m record;
  v_merchant public.companies;
  v_order public.orders;
  v_before public.orders;
  v_created boolean;
  v_need date;
  v_line_id uuid;
  v_added jsonb;
  v_risk jsonb;
  v_task jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_pending int;
begin
  perform app.payload(p_request, '{}');
  select * into v_job from public.jobs where id = app.ref(p_request, 'job_id') for update;
  perform app.assert_normal_work(v_job.id);

  -- Pending = ToOrder, not on an order line, open quantity > 0. The need-by
  -- date falls back to the package delivery rule: booking intake (S05) may
  -- create lines before a date exists (forced by the widened materials schema).
  create temporary table if not exists pg_temp.mat_pending (
    material_id uuid, merchant_id uuid, work_type text, need_by date, created_at timestamptz) on commit drop;
  truncate pg_temp.mat_pending;
  insert into pg_temp.mat_pending
  select m.id, m.merchant_id, app.mat_work_type(m.work_package_id),
         coalesce(m.need_by_date, case when w.planned_start is not null
                                       then app.mat_delivery_date(w.planned_start, c.delivery_weekday) end),
         m.created_at
  from public.materials m
  left join public.work_packages w on w.id = m.work_package_id
  left join public.companies c on c.id = m.merchant_id
  where m.job_id = v_job.id and m.source = 'ToOrder' and m.order_line_id is null
    and m.required_quantity - m.cancelled_quantity > 0;
  get diagnostics v_pending = row_count;
  perform 1 from public.materials m join pg_temp.mat_pending p on p.material_id = m.id for update of m;

  select p.material_id into v_bad from pg_temp.mat_pending p where p.merchant_id is null order by p.created_at, p.material_id limit 1;
  if v_bad is not null then
    perform app.fail('MAT_REVIEW: material has no merchant', jsonb_build_object('material_id', v_bad));
  end if;
  select p.material_id into v_bad from pg_temp.mat_pending p where p.need_by is null order by p.created_at, p.material_id limit 1;
  if v_bad is not null then
    perform app.fail('MAT_REVIEW: material has no need_by_date', jsonb_build_object('material_id', v_bad));
  end if;

  for v_grp in select p.merchant_id, p.work_type, min(p.need_by) as need_by
               from pg_temp.mat_pending p group by p.merchant_id, p.work_type
               order by p.merchant_id::text, p.work_type loop
    v_merchant := app.mat_merchant(v_grp.merchant_id);
    v_need := v_grp.need_by;
    v_created := false;
    select * into v_order from public.orders o
    where o.job_id = v_job.id and o.merchant_id = v_merchant.id and o.work_type = v_grp.work_type
      and o.status in ('Draft', 'Review')
    order by o.created_at, o.id limit 1 for update;
    v_before := v_order;
    if v_order.id is null then
      insert into public.orders (job_id, merchant_id, work_type, requested_delivery_date, delivery_location_id,
                                 status, revision)
      values (v_job.id, v_merchant.id, v_grp.work_type, v_need, app.mat_store_location(), 'Draft', 1)
      returning * into v_order;
      v_created := true;
    elsif v_order.requested_delivery_date > v_need then
      update public.orders set requested_delivery_date = v_need where id = v_order.id returning * into v_order;
    end if;

    v_added := '[]'::jsonb;
    for v_m in select m.*, p.need_by as eff_need_by, pr.name as product_name, pr.sku, pr.unit_cost_pence
               from pg_temp.mat_pending p join public.materials m on m.id = p.material_id
               left join public.products pr on pr.id = m.product_id
               where p.merchant_id = v_grp.merchant_id and p.work_type = v_grp.work_type
               order by p.created_at, p.material_id loop
      insert into public.order_lines (order_id, material_id, product_id, description_snapshot, quantity, unit,
                                      unit_net_cost_pence, cancelled_quantity)
      values (v_order.id, v_m.id, v_m.product_id,
              coalesce(v_m.description, case when v_m.product_name is not null
                                              then v_m.product_name || ' (' || v_m.sku || ')' end, 'Material'),
              v_m.required_quantity - v_m.cancelled_quantity, v_m.unit, v_m.unit_cost_pence, 0)
      returning id into v_line_id;
      update public.materials set order_line_id = v_line_id, need_by_date = v_m.eff_need_by where id = v_m.id;
      v_added := v_added || jsonb_build_array(v_line_id);
    end loop;

    v_risk := app.mat_lead_risk(v_need, v_merchant.id, v_today);
    v_task := app.mat_task('MAT01', v_job.id, 'Orders', v_order.id, 'MAT01-' || v_order.id,
                           app.mat_day_start(case when (v_risk ->> 'at_risk')::boolean
                                                  then app.mat_same_or_next_staffed(v_today)
                                                  else (v_risk ->> 'latest_order_date')::date end),
                           v_merchant.name || ' ' || v_grp.work_type
                           || case when (v_risk ->> 'at_risk')::boolean then ' — LEAD-TIME RISK' else '' end);
    perform app.audit('Orders', v_order.id::text, case when v_created then 'BuildOrder' else 'AppendOrderLines' end,
                      case when v_created then null else to_jsonb(v_before) end, to_jsonb(v_order));
    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'order_id', v_order.id, 'merchant_id', v_merchant.id, 'merchant', v_merchant.name,
      'work_type', v_grp.work_type, 'created', v_created, 'lines_added', v_added,
      'requested_delivery_date', v_need, 'lead_time_risk', v_risk, 'task', v_task));
  end loop;

  return jsonb_build_object('status', case when jsonb_array_length(v_orders) > 0 then 'Created' else 'NoAction' end,
    'orders', v_orders, 'pending_materials', v_pending, 'external_calls', 0);
end
$$;

-- =============================================================================
-- 3. ORDER_SEND (_matSendOrder, :342-361): immutable snapshot, captured not sent
-- =============================================================================

create function app.cmd_order_send(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['order_id', 'urgent'], array['order_id']);
  v_order public.orders := app.mat_lock_order(p_request, v_p);
  v_after public.orders;
  v_job public.jobs;
  v_merchant public.companies;
  v_urgent boolean := app.yes_flag(v_p -> 'urgent');
  v_today date := app.london_date(now());
  v_comm uuid;
  v_comm_created boolean := false;
  v_completed jsonb;
  v_task jsonb;
begin
  select * into v_job from public.jobs where id = v_order.job_id;
  perform app.assert_normal_work(v_job.id);
  v_merchant := app.mat_merchant(v_order.merchant_id);
  if v_order.status not in ('Draft', 'Review', 'Requested') then
    perform app.fail('MAT_REVIEW: cannot send from ' || v_order.status);
  end if;
  if not exists (select 1 from public.order_lines l where l.order_id = v_order.id and l.quantity - l.cancelled_quantity > 0) then
    perform app.fail('MAT_REVIEW: order has no open lines');
  end if;
  perform app.mat_expect(v_order.version, p_request);

  update public.orders set status = 'Requested' where id = v_order.id returning * into v_after;
  v_comm := app.mat_order_comm(v_order.id, 'MerchantOrder', v_order.revision);
  if v_comm is null then
    v_comm := app.mat_capture(v_job.id, v_merchant.id, 'MerchantOrder',
      'Purchase order ' || v_job.job_ref || ' ' || v_order.work_type || ' rev ' || v_order.revision
        || ' — ' || v_job.display_name || ' (' || v_order.work_type || ')',
      app.mat_order_snapshot(v_after), v_order.revision, v_order.requested_delivery_date, null);
    perform app.mat_link(v_comm, v_job.id, v_order.id, v_order.revision);
    v_comm_created := true;
  end if;
  v_completed := app.mat_complete_tasks('Orders', v_order.id, array['MAT01'],
    'Order snapshot rev ' || v_order.revision || ' captured (send adapter not enabled)');
  v_task := app.mat_task('MAT06', v_job.id, 'Orders', v_order.id, 'MAT06-' || v_order.id || '-R' || v_order.revision,
    case when v_urgent then app.mat_day_end(app.mat_same_or_next_staffed(v_today))
         else app.mat_day_start(app.mat_next_staffed(v_today)) end,
    v_merchant.name || ' rev ' || v_order.revision || case when v_urgent then ' — URGENT' else '' end);
  perform app.audit('Orders', v_order.id::text, 'Send', to_jsonb(v_order), to_jsonb(v_after));
  return jsonb_build_object('status', v_after.status, 'order', to_jsonb(v_after),
    'communication', jsonb_build_object('created', v_comm_created, 'communication_id', v_comm),
    'completed_tasks', v_completed, 'task', v_task, 'sent', false, 'external_calls', 0);
end
$$;

-- =============================================================================
-- 4. ORDER_CONFIRM (_matConfirmOrder, :365-388) - merchant acknowledged the
-- latest revision. A reply naming an earlier revision is recorded but
-- powerless (survey ref-04 §1.1 materials/revisions.js _matRecordSupplierReply).
-- =============================================================================

create function app.cmd_order_confirm(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['order_id', 'supplier_reference', 'confirmed_delivery_date', 'response_text',
                                            'received_at', 'evidence_id', 'acknowledged_revision'], array['order_id']);
  v_order public.orders := app.mat_lock_order(p_request, v_p);
  v_after public.orders;
  v_job public.jobs;
  v_merchant public.companies;
  v_ref text := app.txt(v_p, 'supplier_reference');
  v_date date;
  v_ack_rev numeric;
  v_received timestamptz;
  v_evidence uuid;
  v_comm uuid;
  v_ack public.acknowledgements;
  v_completed jsonb;
  v_delivery public.deliveries;
  v_task jsonb;
begin
  select * into v_job from public.jobs where id = v_order.job_id;
  perform app.assert_normal_work(v_job.id);
  v_merchant := app.mat_merchant(v_order.merchant_id);
  if v_ref is null then
    perform app.fail('MAT_REVIEW: supplier_reference required');
  end if;
  v_date := coalesce(app.mat_date(v_p -> 'confirmed_delivery_date'), v_order.requested_delivery_date);
  v_received := coalesce(app.mat_ts(v_p -> 'received_at'), now());
  if app.txt(v_p, 'evidence_id') is not null then
    v_evidence := app.job_evidence(v_job.id, app.txt(v_p, 'evidence_id'), 'MAT_REVIEW: evidence not found');
  end if;
  v_ack_rev := app.mat_num(v_p -> 'acknowledged_revision', 'MAT_REVIEW: acknowledged_revision invalid');
  if v_ack_rev is not null then
    if v_ack_rev <> trunc(v_ack_rev) or v_ack_rev < 1 or v_ack_rev > v_order.revision then
      perform app.fail('MAT_REVIEW: acknowledged_revision invalid');
    end if;
    if app.mat_order_comm(v_order.id, 'MerchantOrder', v_ack_rev::int) is null then
      perform app.fail('MAT_REVIEW: revision ' || v_ack_rev::int || ' was never sent');
    end if;
  end if;

  -- Stale reply: kept as evidence, no order change, no task completed.
  if v_ack_rev is not null and v_ack_rev < v_order.revision then
    perform app.mat_expect(v_order.version, p_request);
    insert into public.acknowledgements (communication_id, company_id, entity_id, acknowledged_revision, response,
                                         response_text, received_at, recorded_by, evidence_id)
    values (app.mat_order_comm(v_order.id, 'MerchantOrder', v_ack_rev::int), v_merchant.id, v_order.id,
            v_ack_rev::int, 'Confirmed',
            coalesce(app.txt(v_p, 'response_text'), 'Supplier reference ' || v_ref)
              || ' [StaleRefused: superseded by revision ' || v_order.revision || ']',
            v_received, app.actor_id(p_actor), v_evidence)
    returning * into v_ack;
    perform app.audit('Acknowledgements', v_ack.id::text, 'StaleRefused', null, to_jsonb(v_ack),
                      'Reply to revision ' || v_ack_rev::int || ' of ' || v_order.revision);
    return jsonb_build_object('status', 'StaleRefused', 'outcome', 'StaleRefused', 'order', to_jsonb(v_order),
      'acknowledgement_id', v_ack.id, 'acknowledgement_required', true, 'external_calls', 0);
  end if;

  if v_order.status <> 'Requested' then
    perform app.fail('MAT_REVIEW: only a Requested order can be confirmed (status ' || v_order.status || ')');
  end if;
  perform app.mat_expect(v_order.version, p_request);

  update public.orders set status = 'Confirmed', supplier_reference = v_ref, confirmed_revision = revision,
                           confirmed_at = now(), confirmed_by = app.actor_id(p_actor), requested_delivery_date = v_date
  where id = v_order.id returning * into v_after;
  v_comm := app.mat_order_comm(v_order.id, 'MerchantOrder', v_order.revision);
  if v_comm is null then
    v_comm := app.mat_capture(v_job.id, v_merchant.id, 'MerchantOrder',
      'Purchase order ' || v_job.job_ref || ' ' || v_order.work_type || ' rev ' || v_order.revision,
      app.mat_order_snapshot(v_order), v_order.revision, v_date, null);
    perform app.mat_link(v_comm, v_job.id, v_order.id, v_order.revision);
  end if;
  select * into v_ack from public.acknowledgements a
  where a.entity_id = v_order.id and a.acknowledged_revision = v_order.revision order by a.created_at limit 1;
  if v_ack.id is null then
    insert into public.acknowledgements (communication_id, company_id, entity_id, acknowledged_revision, response,
                                         response_text, received_at, recorded_by, evidence_id)
    values (v_comm, v_merchant.id, v_order.id, v_order.revision, 'Confirmed',
            coalesce(app.txt(v_p, 'response_text'), 'Supplier reference ' || v_ref),
            v_received, app.actor_id(p_actor), v_evidence)
    returning * into v_ack;
  end if;
  v_completed := app.mat_complete_tasks('Orders', v_order.id, array['MAT06', 'MAT01'],
                                        'Confirmed rev ' || v_order.revision || ' ref ' || v_ref);

  -- Deviation: the reference creates DEL-<order>-R<rev> on every confirmation,
  -- so re-confirming a revised order duplicated the expected delivery (and its
  -- MAT04 and Friday-list entry). The open expected delivery is reused and
  -- moved to the confirmed date; a new one is created only when none is open.
  select * into v_delivery from public.deliveries d
  where d.order_id = v_order.id and d.actual_received_at is null and d.receipt_status <> 'Cancelled'
  order by d.created_at desc, d.id limit 1 for update;
  if v_delivery.id is null then
    insert into public.deliveries (order_id, expected_date, receipt_status)
    values (v_order.id, v_date, 'Expected') returning * into v_delivery;
  elsif v_delivery.expected_date <> v_date then
    update public.deliveries set expected_date = v_date where id = v_delivery.id returning * into v_delivery;
    perform app.mat_move_delivery_tasks(v_delivery.id, v_date, 'Confirmed rev ' || v_order.revision);
  end if;
  v_task := app.mat_task('MAT04', v_job.id, 'Deliveries', v_delivery.id, 'MAT04-' || v_delivery.id,
                         app.mat_day_end(v_date), v_merchant.name || ' expected ' || v_date);
  perform app.audit('Orders', v_order.id::text, 'Confirm', to_jsonb(v_order), to_jsonb(v_after));
  return jsonb_build_object('status', v_after.status, 'outcome', 'ConfirmedLatest', 'order', to_jsonb(v_after),
    'delivery', to_jsonb(v_delivery), 'acknowledgement_id', v_ack.id, 'completed_tasks', v_completed,
    'task', v_task, 'external_calls', 0);
end
$$;

-- =============================================================================
-- 5. ORDER_REVISE (_matReviseOrder, :392-431 + survey _matReviseSentOrder):
-- new revision -> re-acknowledgement; urgent when inside lead time.
-- =============================================================================

create function app.cmd_order_revise(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['order_id', 'reason', 'requested_delivery_date', 'lines', 'urgent'], array['order_id']);
  v_order public.orders := app.mat_lock_order(p_request, v_p);
  v_after public.orders;
  v_job public.jobs;
  v_merchant public.companies;
  v_reason text := app.txt(v_p, 'reason');
  v_date date;
  v_lines jsonb := v_p -> 'lines';
  v_elem jsonb;
  v_key text;
  v_line public.order_lines;
  v_qty numeric;
  v_cq numeric;
  v_recv numeric;
  v_new_qty numeric;
  v_new_cq numeric;
  v_revision int;
  v_was_sent boolean;
  v_today date := app.london_date(now());
  v_risk jsonb;
  v_urgent boolean := false;
  v_comm uuid;
  v_task jsonb;
  v_superseded jsonb := '[]'::jsonb;
  v_delivery public.deliveries;
  v_subject text;
begin
  select * into v_job from public.jobs where id = v_order.job_id;
  perform app.assert_normal_work(v_job.id);
  v_merchant := app.mat_merchant(v_order.merchant_id);
  if v_reason is null then
    perform app.fail('MAT_REVIEW: reason required');
  end if;
  v_date := app.mat_date(v_p -> 'requested_delivery_date');
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' then
    v_lines := '[]'::jsonb;
  end if;
  if v_date is null and jsonb_array_length(v_lines) = 0 then
    perform app.fail('MAT_REVIEW: requested_delivery_date or lines required');
  end if;
  if v_order.status not in ('Draft', 'Review', 'Requested', 'Confirmed') then
    perform app.fail('MAT_REVIEW: cannot revise from ' || v_order.status);
  end if;
  perform app.mat_expect(v_order.version, p_request);
  v_revision := v_order.revision + 1;

  for v_elem in select * from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(v_elem) <> 'object' then
      perform app.fail('MAT_REVIEW: order line linkage invalid');
    end if;
    for v_key in select jsonb_object_keys(v_elem) loop
      if v_key not in ('order_line_id', 'quantity', 'cancelled_quantity') then
        perform app.fail('R1A_INVALID_FIELDS');
      end if;
    end loop;
    select * into v_line from public.order_lines l
    where l.id = app.mat_uuid(v_elem ->> 'order_line_id') and l.order_id = v_order.id for update;
    if v_line.id is null then
      perform app.fail('MAT_REVIEW: order line linkage invalid');
    end if;
    v_recv := (app.mat_line_received(v_line.id) ->> 'good')::numeric + (app.mat_line_received(v_line.id) ->> 'damaged')::numeric;
    v_qty := app.mat_num(v_elem -> 'quantity', 'MAT_REVIEW: quantity below received');
    v_cq := app.mat_num(v_elem -> 'cancelled_quantity', 'MAT_REVIEW: cancelled_quantity invalid');
    if v_qty is not null and v_qty < v_recv then
      perform app.fail('MAT_REVIEW: quantity below received', jsonb_build_object('order_line_id', v_line.id));
    end if;
    if v_qty is not null and v_qty <= 0 then
      perform app.fail('MAT_REVIEW: quantity must be > 0', jsonb_build_object('order_line_id', v_line.id));
    end if;
    if v_cq is not null and (v_cq < 0 or v_cq > coalesce(v_qty, v_line.quantity) - v_recv) then
      perform app.fail('MAT_REVIEW: cancelled_quantity invalid', jsonb_build_object('order_line_id', v_line.id));
    end if;
    v_new_qty := coalesce(v_qty, v_line.quantity);
    v_new_cq := coalesce(v_cq, v_line.cancelled_quantity);
    if v_new_cq > v_new_qty then
      perform app.fail('MAT_REVIEW: cancelled_quantity invalid', jsonb_build_object('order_line_id', v_line.id));
    end if;
    update public.order_lines set quantity = v_new_qty, cancelled_quantity = v_new_cq where id = v_line.id;
    if v_line.material_id is not null then
      update public.materials set required_quantity = coalesce(v_qty, required_quantity),
                                  cancelled_quantity = coalesce(v_cq, cancelled_quantity), revision = revision + 1
      where id = v_line.material_id;
    end if;
  end loop;

  v_was_sent := v_order.status in ('Requested', 'Confirmed');
  update public.orders set revision = v_revision,
                           requested_delivery_date = coalesce(v_date, requested_delivery_date),
                           status = case when v_was_sent then 'Requested' else status end
  where id = v_order.id returning * into v_after;

  if v_was_sent then
    v_risk := app.mat_lead_risk(v_after.requested_delivery_date, v_merchant.id, v_today);
    v_urgent := app.yes_flag(v_p -> 'urgent') or (v_risk ->> 'at_risk')::boolean;
    -- Deviation: urgent amendments use the spec wording "URGENT UPDATE – delivery
    -- <day> <date>" instead of the reference "(AMENDED)" (ref-04 §7 wording gap).
    v_subject := case when v_urgent
      then 'URGENT UPDATE – delivery ' || to_char(v_after.requested_delivery_date, 'FMDay FMDD FMMonth YYYY')
           || ' — purchase order ' || v_job.job_ref || ' ' || v_order.work_type || ' rev ' || v_revision
           || ' — ' || v_job.display_name
      else 'Purchase order ' || v_job.job_ref || ' ' || v_order.work_type || ' rev ' || v_revision
           || ' (AMENDED) — ' || v_job.display_name end;
    v_comm := app.mat_capture(v_job.id, v_merchant.id, 'MerchantOrder', v_subject,
      app.mat_order_snapshot(v_after) || jsonb_build_object('amendment_reason', v_reason,
                                                            'supersedes_revision', v_order.revision),
      v_revision, v_after.requested_delivery_date, null);
    perform app.mat_link(v_comm, v_job.id, v_order.id, v_revision);
    -- Open confirmations of earlier revisions are superseded, never left to be
    -- "completed" against a stale revision (ref-04 §1.1 _matReviseSentOrder).
    v_superseded := app.mat_cancel_tasks('Orders', v_order.id, array['MAT06'],
      'Superseded by revision ' || v_revision || ' — confirm MAT06-' || v_order.id || '-R' || v_revision || ' instead',
      'Supersede', 'MAT06-' || v_order.id || '-R' || v_revision);
    v_task := app.mat_task('MAT06', v_job.id, 'Orders', v_order.id, 'MAT06-' || v_order.id || '-R' || v_revision,
      case when v_urgent then app.mat_day_end(app.mat_same_or_next_staffed(v_today))
           else app.mat_day_start(app.mat_next_staffed(v_today)) end,
      v_merchant.name || ' rev ' || v_revision || case when v_urgent then ' — URGENT amendment' else ' — amendment' end);
    if v_date is not null then
      for v_delivery in select * from public.deliveries d
                        where d.order_id = v_order.id and d.actual_received_at is null and d.receipt_status <> 'Cancelled'
                        order by d.created_at, d.id for update loop
        update public.deliveries set expected_date = v_date where id = v_delivery.id;
        perform app.mat_move_delivery_tasks(v_delivery.id, v_date, v_reason);
      end loop;
    end if;
  end if;
  perform app.audit('Orders', v_order.id::text, 'Revise', to_jsonb(v_order), to_jsonb(v_after), v_reason);
  return jsonb_build_object('status', v_after.status, 'order', to_jsonb(v_after), 'revision', v_revision,
    'acknowledgement_required', v_was_sent, 'urgent', v_urgent,
    'communication', case when v_comm is null then null
                          else jsonb_build_object('created', true, 'communication_id', v_comm) end,
    'task', v_task, 'superseded_tasks', v_superseded, 'external_calls', 0);
end
$$;

-- =============================================================================
-- 6. ORDER_CANCEL (_matCancelOrder, :435-460)
-- The reference applies no S15 guard here (an order may be cancelled while
-- the job is being cancelled); kept.
-- =============================================================================

create function app.cmd_order_cancel(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['order_id', 'reason'], array['order_id']);
  v_order public.orders := app.mat_lock_order(p_request, v_p);
  v_after public.orders;
  v_job public.jobs;
  v_merchant public.companies;
  v_reason text := app.txt(v_p, 'reason');
  v_revision int;
  v_was_sent boolean;
  v_cancelled jsonb;
  v_delivery public.deliveries;
  v_comm uuid;
  v_task jsonb;
begin
  select * into v_job from public.jobs where id = v_order.job_id;
  select * into v_merchant from public.companies c where c.id = v_order.merchant_id;
  if v_reason is null then
    perform app.fail('MAT_REVIEW: reason required');
  end if;
  if v_order.status = 'Cancelled' then
    perform app.fail('MAT_REVIEW: already cancelled');
  end if;
  if v_order.status in ('PartReceived', 'Received') then
    perform app.fail('MAT_REFUSED: goods received; use return/credit review instead of cancel');
  end if;
  perform app.mat_expect(v_order.version, p_request);
  v_revision := v_order.revision + 1;
  v_was_sent := v_order.status in ('Requested', 'Confirmed');

  update public.orders set status = 'Cancelled', revision = v_revision where id = v_order.id returning * into v_after;
  -- Materials are released back to ToOrder (order_line_id cleared).
  update public.materials m set order_line_id = null, revision = m.revision + 1
  where m.id in (select l.material_id from public.order_lines l where l.order_id = v_order.id and l.material_id is not null);
  update public.order_lines set cancelled_quantity = quantity where order_id = v_order.id;
  update public.deliveries set receipt_status = 'Cancelled'
  where order_id = v_order.id and actual_received_at is null;
  v_cancelled := app.mat_cancel_tasks('Orders', v_order.id, null, v_reason);
  for v_delivery in select * from public.deliveries d where d.order_id = v_order.id order by d.created_at, d.id loop
    v_cancelled := v_cancelled || app.mat_cancel_tasks('Deliveries', v_delivery.id, null, v_reason);
  end loop;
  if v_was_sent and v_merchant.id is not null then
    v_comm := app.mat_capture(v_job.id, v_merchant.id, 'MerchantOrderCancellation',
      'Cancel purchase order ' || v_job.job_ref || ' ' || v_order.work_type || ' (rev ' || v_revision || ')',
      app.mat_order_snapshot(v_after) || jsonb_build_object('cancellation_reason', v_reason),
      v_revision, null, null);
    perform app.mat_link(v_comm, v_job.id, v_order.id, v_revision);
    v_task := app.mat_task('MAT06', v_job.id, 'Orders', v_order.id, 'MAT06-' || v_order.id || '-R' || v_revision,
      app.mat_day_end(app.mat_same_or_next_staffed(app.london_date(now()))),
      v_merchant.name || ' cancellation acknowledgement');
  end if;
  perform app.audit('Orders', v_order.id::text, 'Cancel', to_jsonb(v_order), to_jsonb(v_after), v_reason);
  return jsonb_build_object('status', 'Cancelled', 'order', to_jsonb(v_after), 'cancelled_tasks', v_cancelled,
    'communication', case when v_comm is null then null
                          else jsonb_build_object('created', true, 'communication_id', v_comm) end,
    'task', v_task, 'acknowledgement_required', v_was_sent, 'materials_released', true, 'external_calls', 0);
end
$$;

-- =============================================================================
-- 7. MERCHANT_WEEKLY_LIST (_matWeeklyList, :530-561): Friday list of next
-- week's expected deliveries per merchant; captured; MAT05 + MAT06.
-- =============================================================================

create function app.cmd_merchant_weekly_list(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['list_date']);
  v_list_date date := coalesce(app.mat_date(v_p -> 'list_date'), app.london_date(now()));
  v_week_start date := app.mat_monday(v_list_date) + 7;
  v_week_end date := app.mat_monday(v_list_date) + 13;
  v_friday date := app.mat_monday(v_list_date) + 4;
  v_merchant record;
  v_items jsonb;
  v_comm public.communications;
  v_created boolean;
  v_item jsonb;
  v_t5 jsonb;
  v_t6 jsonb;
  v_lists jsonb := '[]'::jsonb;
begin
  for v_merchant in
    select distinct c.id, c.name
    from public.deliveries d
    join public.orders o on o.id = d.order_id
    join public.jobs j on j.id = o.job_id
    join public.companies c on c.id = o.merchant_id
    where d.actual_received_at is null and d.receipt_status <> 'Cancelled'
      and d.expected_date between v_week_start and v_week_end
      and o.status in ('Requested', 'Confirmed', 'PartReceived') and j.cancellation_at is null
    order by c.id
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'delivery_id', d.id, 'order_id', o.id, 'revision', o.revision,
             'acknowledged', o.confirmed_revision is not distinct from o.revision,
             'job_id', j.id, 'job_reference', j.job_ref, 'customer_display', j.display_name,
             'postcode', cu.postcode, 'work_type', o.work_type, 'delivery_date', d.expected_date,
             'supplier_reference', o.supplier_reference,
             'lines', (select count(*) from public.order_lines l where l.order_id = o.id))
             order by d.expected_date, o.id::text), '[]'::jsonb)
    into v_items
    from public.deliveries d
    join public.orders o on o.id = d.order_id
    join public.jobs j on j.id = o.job_id
    join public.customers cu on cu.id = j.customer_id
    where o.merchant_id = v_merchant.id
      and d.actual_received_at is null and d.receipt_status <> 'Cancelled'
      and d.expected_date between v_week_start and v_week_end
      and o.status in ('Requested', 'Confirmed', 'PartReceived') and j.cancellation_at is null;

    select * into v_comm from public.communications c
    where c.type = 'MerchantDeliveryList' and c.company_id = v_merchant.id and c.covered_week_start = v_week_start;
    v_created := v_comm.id is null;
    if v_created then
      insert into public.communications (job_id, company_id, type, subject, body_snapshot, recipients_snapshot,
                                         covered_week_start, delivery_date, revision, status)
      values (null, v_merchant.id, 'MerchantDeliveryList',
              'Expected deliveries w/c ' || v_week_start || ' — ' || v_merchant.name,
              jsonb_build_object('week_start', v_week_start, 'week_end', v_week_end, 'list_date', v_list_date,
                                 'items', v_items, 'note', 'CAPTURED DRAFT — not sent. FN-03 R2.')::text,
              app.mat_contacts(v_merchant.id)::text, v_week_start,
              (select min((i ->> 'delivery_date')::date) from jsonb_array_elements(v_items) i), 1, 'Draft')
      returning * into v_comm;
      for v_item in select * from jsonb_array_elements(v_items) loop
        perform app.mat_link(v_comm.id, (v_item ->> 'job_id')::uuid, (v_item ->> 'order_id')::uuid,
                             (v_item ->> 'revision')::int);
      end loop;
      perform app.audit('Communications', v_comm.id::text, 'WeeklyList', null, to_jsonb(v_comm));
    end if;
    v_t5 := app.mat_task('MAT05', null, 'Communications', v_comm.id, 'MAT05-' || v_merchant.id || '-' || v_week_start,
                         app.london_at(v_week_start - 3, '12:00'), v_merchant.name || ' w/c ' || v_week_start);
    v_t6 := app.mat_task('MAT06', null, 'Communications', v_comm.id, 'MAT06-LIST-' || v_merchant.id || '-' || v_week_start,
                         app.mat_day_start(app.mat_next_staffed(v_week_start - 3)),
                         v_merchant.name || ' list acknowledgement w/c ' || v_week_start);
    v_lists := v_lists || jsonb_build_array(jsonb_build_object(
      'merchant_id', v_merchant.id, 'merchant', v_merchant.name, 'communication_id', v_comm.id,
      'created', v_created, 'items', jsonb_array_length(v_items),
      'unacknowledged', (select count(*) from jsonb_array_elements(v_items) i where not (i ->> 'acknowledged')::boolean),
      'tasks', jsonb_build_array(v_t5, v_t6)));
  end loop;
  return jsonb_build_object('status', 'Recorded', 'list_date', v_list_date, 'week_start', v_week_start,
    'week_end', v_week_end, 'lists', v_lists, 'external_calls', 0);
end
$$;

-- =============================================================================
-- Reads (:278-291, :565-584)
-- =============================================================================

create function app.mat_read_keys(p_request jsonb, p_allowed text[])
returns void
language plpgsql immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key <> 'read_type' and not v_key = any (p_allowed) then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;
end
$$;

-- Per-material state: ToOrder | Drafted | AwaitingConfirmation | Confirmed |
-- PartReceived | Received | VerifyExternalOrder | Stock.
create function app.read_material_requirements(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_items jsonb;
  v_today date := app.london_date(now());
begin
  perform app.mat_read_keys(p_request, array['job_id']);
  v_job_id := app.ref(p_request, 'job_id');
  if not exists (select 1 from public.jobs j where j.id = v_job_id) then
    return jsonb_build_object('found', false, 'job_id', v_job_id);
  end if;
  select coalesce(jsonb_agg(x.item order by x.created_at, x.id), '[]'::jsonb) into v_items
  from (
    select m.id, m.created_at, jsonb_build_object(
      'material_id', m.id, 'product_id', m.product_id, 'product_name', pr.name, 'description', m.description,
      'quantity', m.required_quantity - m.cancelled_quantity, 'unit', m.unit, 'source', m.source,
      'work_type', app.mat_work_type(m.work_package_id), 'merchant_id', m.merchant_id, 'merchant', c.name,
      'need_by_date', m.need_by_date, 'order_id', o.id, 'order_line_id', l.id, 'order_status', o.status,
      'received_good', coalesce((app.mat_line_received(l.id) ->> 'good')::numeric, 0),
      'received_damaged', coalesce((app.mat_line_received(l.id) ->> 'damaged')::numeric, 0),
      'state', case when m.source = 'Stock' then 'Stock'
                    when m.source = 'AlreadyOrdered' then 'VerifyExternalOrder'
                    when o.id is null or o.status = 'Cancelled' then 'ToOrder'
                    when o.status = 'Received' then 'Received'
                    when o.status = 'PartReceived' then 'PartReceived'
                    when o.status = 'Confirmed' then 'Confirmed'
                    when o.status = 'Requested' then 'AwaitingConfirmation'
                    else 'Drafted' end,
      'lead_time_risk', case when m.source = 'ToOrder' and o.id is null
                             then app.mat_lead_risk(m.need_by_date, m.merchant_id, v_today) end) as item
    from public.materials m
    left join public.products pr on pr.id = m.product_id
    left join public.companies c on c.id = m.merchant_id
    left join public.order_lines l on l.id = m.order_line_id
    left join public.orders o on o.id = l.order_id
    where m.job_id = v_job_id) x;
  return jsonb_build_object('found', true, 'job_id', v_job_id, 'count', jsonb_array_length(v_items),
    'items', v_items,
    'to_order', (select count(*) from jsonb_array_elements(v_items) i where i ->> 'state' = 'ToOrder'));
end
$$;

create function app.read_order_view(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_job public.jobs;
  v_merchant public.companies;
begin
  perform app.mat_read_keys(p_request, array['order_id']);
  select * into v_order from public.orders o where o.id = app.mat_uuid(p_request ->> 'order_id');
  if v_order.id is null then
    return jsonb_build_object('found', false, 'order_id', p_request ->> 'order_id');
  end if;
  select * into v_job from public.jobs where id = v_order.job_id;
  select * into v_merchant from public.companies where id = v_order.merchant_id;
  return jsonb_build_object(
    'found', true, 'order', to_jsonb(v_order),
    'job', jsonb_build_object('id', v_job.id, 'job_reference', v_job.job_ref, 'display_name', v_job.display_name),
    'merchant', jsonb_build_object('id', v_merchant.id, 'name', v_merchant.name,
                                   'standard_lead_days', v_merchant.standard_lead_days,
                                   'delivery_weekday', v_merchant.delivery_weekday,
                                   'contacts', app.mat_contacts(v_merchant.id)),
    'acknowledgement_required', v_order.status in ('Requested', 'Confirmed', 'PartReceived')
                                and coalesce(v_order.confirmed_revision, 0) < v_order.revision,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', l.id, 'material_id', l.material_id, 'product_id', l.product_id,
                'description', l.description_snapshot, 'quantity', l.quantity,
                'cancelled_quantity', l.cancelled_quantity, 'unit', l.unit,
                'received_good', (app.mat_line_received(l.id) ->> 'good')::numeric,
                'received_damaged', (app.mat_line_received(l.id) ->> 'damaged')::numeric,
                'outstanding', app.mat_line_outstanding(l.id)) order by l.created_at, l.id), '[]'::jsonb)
              from public.order_lines l where l.order_id = v_order.id),
    'deliveries', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', d.id, 'expected_date', d.expected_date, 'actual_received_at', d.actual_received_at,
                     'receipt_status', d.receipt_status, 'delivery_note_reference', d.delivery_note_reference,
                     'discrepancy_note', d.discrepancy_note) order by d.created_at, d.id), '[]'::jsonb)
                   from public.deliveries d where d.order_id = v_order.id),
    'communications', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', c.id, 'type', c.type, 'revision', c.revision, 'status', c.status, 'subject', c.subject)
                         order by c.created_at, c.id), '[]'::jsonb)
                       from public.communications c
                       where c.id in (select cj.communication_id from public.communication_jobs cj
                                      where cj.order_id = v_order.id)),
    'acknowledgements', (select coalesce(jsonb_agg(jsonb_build_object(
                           'id', a.id, 'acknowledged_revision', a.acknowledged_revision, 'response', a.response,
                           'response_text', a.response_text, 'received_at', a.received_at)
                           order by a.created_at, a.id), '[]'::jsonb)
                         from public.acknowledgements a where a.entity_id = v_order.id),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'template_code', t.template_code, 'title', t.title, 'status', t.status,
                'due_at', t.due_at, 'owner_id', t.owner_id) order by t.created_at, t.id), '[]'::jsonb)
              from public.tasks t
              where (t.related_entity_type = 'Orders' and t.related_entity_id = v_order.id)
                 or (t.related_entity_type = 'Deliveries'
                     and t.related_entity_id in (select d.id from public.deliveries d where d.order_id = v_order.id))),
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'category', i.category, 'status', i.status)
                                         order by i.created_at, i.id), '[]'::jsonb)
               from public.issues i
               where i.job_id = v_order.job_id and i.responsible_company_id = v_order.merchant_id and i.type = 'Supply'));
end
$$;

-- Expected deliveries (default today .. +14 days) and open MAT03/MAT04 store tasks.
create function app.read_store_queue(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_from date;
  v_to date;
begin
  perform app.mat_read_keys(p_request, array['from', 'to']);
  v_from := coalesce(app.mat_date(p_request -> 'from'), app.london_date(now()));
  v_to := coalesce(app.mat_date(p_request -> 'to'), v_from + 14);
  return jsonb_build_object('from', v_from, 'to', v_to,
    'expected_deliveries', (select coalesce(jsonb_agg(jsonb_build_object(
        'delivery_id', d.id, 'order_id', d.order_id, 'expected_date', d.expected_date, 'merchant', c.name,
        'work_type', o.work_type, 'job_id', o.job_id, 'order_status', o.status,
        'supplier_reference', o.supplier_reference) order by d.expected_date, d.created_at, d.id), '[]'::jsonb)
      from public.deliveries d
      join public.orders o on o.id = d.order_id
      left join public.companies c on c.id = o.merchant_id
      where d.actual_received_at is null and d.receipt_status <> 'Cancelled'
        and d.expected_date between v_from and v_to),
    'open_store_tasks', (select coalesce(jsonb_agg(jsonb_build_object(
        'task_id', t.id, 'template_code', t.template_code, 'title', t.title, 'due_at', t.due_at,
        'related_entity_id', t.related_entity_id, 'job_id', t.job_id) order by t.due_at nulls last, t.id), '[]'::jsonb)
      from public.tasks t
      where t.template_code in ('MAT03', 'MAT04') and t.status in ('Open', 'InProgress', 'Waiting', 'Blocked')));
end
$$;

-- =============================================================================
-- Registration
-- =============================================================================

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('MATERIAL_ADD', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-03","mode":"Automated"}]',
   'materials', 'materials/workflow.js _matAddRequirement; expected_version = job; work_package_id in envelope'),
  ('ORDERS_BUILD', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-03","mode":"Automated"}]',
   'materials', 'materials/workflow.js _matBuildOrders'),
  ('ORDER_SEND', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-03","mode":"Automated"}]',
   'materials', 'materials/workflow.js _matSendOrder; payload.order_id; expected_version = order'),
  ('ORDER_CONFIRM', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-03","mode":"Automated"}]',
   'materials', 'materials/workflow.js _matConfirmOrder + revisions.js stale replies'),
  ('ORDER_REVISE', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-03","mode":"Automated"}]',
   'materials', 'materials/workflow.js _matReviseOrder + revisions.js MAT06 supersede'),
  ('ORDER_CANCEL', array['Admin', 'Manager', 'Office'], true, '[{"function_id":"FN-03","mode":"Automated"}]',
   'materials', 'materials/workflow.js _matCancelOrder'),
  ('MERCHANT_WEEKLY_LIST', array['Admin', 'Manager', 'Office'], false, '[{"function_id":"FN-03","mode":"Automated"}]',
   'materials', 'materials/workflow.js _matWeeklyList (Friday list, all merchants)');

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('MATERIAL_REQUIREMENTS', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Store'], '[]',
   'materials', 'materials/workflow.js _matRequirements; {job_id}'),
  ('ORDER_VIEW', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Store'], '[]',
   'materials', 'materials/workflow.js _matOrderView; {order_id}'),
  ('STORE_QUEUE', array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Store'], '[]',
   'materials', 'materials/workflow.js _matStoreQueue; {from?, to?}');
